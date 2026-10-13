import assert from "node:assert/strict";
import test from "node:test";
import {
  roleInstanceFixture,
  startInstanceRun,
} from "./role-instance-fixture.ts";

function setup(explicitTarget = true) {
  const f = roleInstanceFixture();
  const work = startInstanceRun(f);
  f.kernel.presentWorkerMessages(work.execution);
  f.kernel.markPresentedDeliverySent(f.host, {
    activationId: work.activation.activationId,
    consumerId: "worker",
    runAttemptId: work.run.runAttemptId,
  });
  const post = (key: string) =>
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: key,
      idempotencyKey: key,
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
    });
  const hold = (final = true) => {
    const result = f.kernel.postWorkerMessage(work.execution, {
      ...(explicitTarget ? { channel: "#home" } : {}),
      body: "old answer",
      ...(final ? { final: true as const } : {}),
      idempotencyKey: "initial-draft",
      basedOnRoomSeq: work.activation.toSeq,
    });
    assert.ok("state" in result && result.state === "held");
    return result;
  };
  const revise = (heldDraftId: string, body = "revised after review") =>
    f.kernel.postWorkerMessage(work.execution, {
      reviseDraftId: heldDraftId,
      body,
    });
  const receipt = (held: unknown) => {
    const id = (held as { readReceiptId?: string }).readReceiptId;
    assert.equal(
      typeof id,
      "string",
      "a held window needs its own output receipt",
    );
    return id!;
  };
  const received = (held: unknown) =>
    f.kernel.workerReads.acknowledgeReadDelivery(work.execution, {
      readReceiptId: receipt(held),
    });
  const queued = () =>
    f.db
      .prepare(
        "SELECT * FROM activations WHERE participant_id=? AND state='queued'",
      )
      .all(f.instance.instanceId);
  return { f, work, post, hold, revise, receipt, received, queued };
}

for (const explicitTarget of [true, false])
  test(`P96: delivered held context plus first successful revision covers its exact later message without advancing ACK (target=${explicitTarget})`, () => {
    const c = setup(explicitTarget);
    try {
      const later = c.post("later");
      const held = c.hold();
      assert.equal(c.received(held).received, true);
      const result = c.revise(held.heldDraftId);
      assert.ok("event" in result && !result.deduplicated);
      c.work.finish(0);
      assert.equal(c.queued().length, 0);
      assert.equal(
        c.f.kernel.leaseNextActivation(c.f.host, { leaseMs: 10000 }),
        null,
      );
      assert.equal(
        c.f.db.prepare("SELECT count(*) n FROM run_attempts").get()?.n,
        1,
      );
      assert.equal(
        c.f.db
          .prepare(
            "SELECT last_seq FROM subscription_cursors WHERE consumer_id='worker'",
          )
          .get()?.last_seq,
        c.work.activation.toSeq,
      );
      assert.equal(
        c.f.db
          .prepare("SELECT state FROM inbox_items WHERE event_id=?")
          .get(later.event.eventId)?.state,
        "pending",
      );
      assert.equal(
        c.f.db
          .prepare(
            "SELECT count(*) n FROM worker_run_read_receipts WHERE confirmed=1 AND room_seq=?",
          )
          .get(later.event.roomSeq)?.n,
        1,
      );
    } finally {
      c.f.close();
    }
  });

for (const mode of [
  "lost-output",
  "abandoned",
  "ordinary-replacement",
  "reheld",
] as const)
  test(`held context does not cover later work after ${mode}`, () => {
    const c = setup();
    try {
      c.post("later");
      const held = c.hold();
      // Even the negative path must offer a real receipt, not pass because the feature is absent.
      c.receipt(held);
      if (mode !== "lost-output") c.received(held);
      if (mode === "ordinary-replacement")
        c.f.kernel.postWorkerMessage(c.work.execution, {
          channel: "#home",
          body: "ordinary replacement",
          basedOnRoomSeq: c.work.activation.toSeq,
        });
      else if (mode === "reheld") {
        c.post("new tail");
        const result = c.revise(held.heldDraftId);
        assert.ok("state" in result && result.state === "held");
      } else if (mode === "lost-output") c.revise(held.heldDraftId);
      c.work.finish(0);
      assert.equal(c.queued().length, 1);
      assert.equal(
        c.f.db
          .prepare(
            "SELECT count(*) n FROM worker_run_read_receipts WHERE confirmed=1",
          )
          .get()?.n,
        0,
      );
    } finally {
      c.f.close();
    }
  });

test("a held notice's 20-message cap never covers its omitted earlier message", () => {
  const c = setup();
  try {
    for (let i = 0; i < 21; i++) c.post(`later-${i}`);
    const held = c.hold();
    assert.equal(held.newerMessages.length, 20);
    c.received(held);
    c.revise(held.heldDraftId);
    c.work.finish(0);
    assert.equal(c.queued().length, 1);
    assert.equal(
      c.f.db
        .prepare(
          "SELECT count(*) n FROM worker_run_read_receipts WHERE confirmed=1",
        )
        .get()?.n,
      20,
    );
  } finally {
    c.f.close();
  }
});

test("history output receipts cannot substitute for a lost held output receipt", () => {
  const c = setup();
  try {
    c.post("later");
    const held = c.hold();
    c.receipt(held);
    const history = c.f.kernel.workerReads.history(c.work.execution, {
      channel: "#home",
      limit: 100,
    });
    assert.ok(history.readReceiptId);
    c.f.kernel.workerReads.acknowledgeReadDelivery(c.work.execution, {
      readReceiptId: history.readReceiptId,
    });
    c.revise(held.heldDraftId);
    c.work.finish(0);
    assert.equal(c.queued().length, 1);
  } finally {
    c.f.close();
  }
});

test("legacy NULL held proof is never backfilled by replaying an old hold", () => {
  const c = setup();
  try {
    c.post("later");
    const held = c.hold();
    c.f.db.exec(
      "ALTER TABLE held_message_drafts DROP COLUMN read_proof_json; PRAGMA user_version=81",
    );
    c.f.kernel.initialize();
    assert.equal(c.f.db.prepare("PRAGMA user_version").get()?.user_version, 87);
    assert.equal(
      c.f.db
        .prepare(
          "SELECT read_proof_json FROM held_message_drafts WHERE held_draft_id=?",
        )
        .get(held.heldDraftId)?.read_proof_json,
      null,
    );
    const replay = c.hold();
    assert.equal(replay.heldDraftId, held.heldDraftId);
    assert.equal(
      (replay as { readReceiptId?: string }).readReceiptId,
      undefined,
    );
  } finally {
    c.f.close();
  }
});

test("successful revision replay cannot confirm a receipt delivered only after the first commit", () => {
  const c = setup();
  try {
    c.post("later");
    const held = c.hold(false);
    const receipt = c.receipt(held);
    const sent = c.revise(held.heldDraftId);
    assert.ok("event" in sent);
    assert.equal(
      c.f.kernel.workerReads.acknowledgeReadDelivery(c.work.execution, {
        readReceiptId: receipt,
      }).received,
      false,
    );
    const history = c.f.kernel.workerReads.history(c.work.execution, {
      channel: "#home",
      limit: 100,
    });
    assert.ok(history.readReceiptId);
    c.f.kernel.workerReads.acknowledgeReadDelivery(c.work.execution, {
      readReceiptId: history.readReceiptId,
    });
    const replay = c.revise(held.heldDraftId);
    assert.ok("event" in replay && replay.deduplicated);
    c.work.finish(0);
    assert.equal(c.queued().length, 1);
    assert.equal(
      c.f.db
        .prepare(
          "SELECT count(*) n FROM worker_run_read_receipts WHERE confirmed=1",
        )
        .get()?.n,
      0,
    );
  } finally {
    c.f.close();
  }
});

test("a successful held revision cannot cover a later unread tail through replay or history receipt overlap", () => {
  const c = setup();
  try {
    const first = c.post("later");
    const held = c.hold(false);
    const history = c.f.kernel.workerReads.history(c.work.execution, {
      channel: "#home",
      limit: 100,
    });
    assert.ok(history.readReceiptId);
    c.f.kernel.workerReads.acknowledgeReadDelivery(c.work.execution, {
      readReceiptId: history.readReceiptId,
    });
    c.received(held);
    c.revise(held.heldDraftId);
    c.post("tail");
    const next = c.f.kernel.workerReads.history(c.work.execution, {
      channel: "#home",
      limit: 100,
    });
    assert.ok(next.readReceiptId);
    c.f.kernel.workerReads.acknowledgeReadDelivery(c.work.execution, {
      readReceiptId: next.readReceiptId,
    });
    const replay = c.revise(held.heldDraftId);
    assert.ok("event" in replay && replay.deduplicated);
    c.work.finish(0);
    assert.equal(c.queued().length, 1);
    assert.deepEqual(
      c.f.db
        .prepare(
          "SELECT room_seq FROM worker_run_read_receipts WHERE confirmed=1",
        )
        .all()
        .map((r) => r.room_seq),
      [first.event.roomSeq],
    );
  } finally {
    c.f.close();
  }
});

for (const mode of ["failed-source", "session-reset", "private-box"] as const)
  test(`held revision proof does not bypass ${mode} isolation`, () => {
    const c = setup();
    try {
      c.post("later");
      const held = c.hold(false);
      c.received(held);
      c.revise(held.heldDraftId);
      const candidate = c.queued()[0]!;
      if (mode === "session-reset")
        c.f.db
          .prepare(
            "UPDATE activations SET state='quarantined' WHERE activation_id=?",
          )
          .run(candidate.activation_id!);
      if (mode === "private-box")
        c.f.kernel.postMessage(c.f.actor, {
          roomId: c.f.privateBox.roomId,
          body: "private",
          idempotencyKey: "private",
          recipients: [
            { participantId: c.f.instance.instanceId, reason: "dm" },
          ],
        });
      c.work.finish(mode === "failed-source" ? 1 : 0);
      if (mode === "session-reset") {
        c.f.kernel.roles.resetInstanceSession(c.f.actor, {
          instanceId: c.f.instance.instanceId,
          basedOnRoomSeq: c.f.head(c.f.home.roomId),
          idempotencyKey: "reset",
        });
        c.f.db
          .prepare(
            "UPDATE activations SET state='queued' WHERE activation_id=?",
          )
          .run(candidate.activation_id!);
      }
      assert.equal(c.queued().length, 1);
      const leased = c.f.kernel.leaseNextActivation(c.f.host, {
        leaseMs: 10000,
      });
      assert.ok(leased);
      assert.equal(
        leased.roomId,
        mode === "private-box" ? c.f.privateBox.roomId : c.f.home.roomId,
      );
    } finally {
      c.f.close();
    }
  });

test("a failed revision and a forged receipt never create consumption confirmation", () => {
  const c = setup();
  try {
    c.post("later");
    const held = c.hold();
    assert.equal(
      c.f.kernel.workerReads.acknowledgeReadDelivery(c.work.execution, {
        readReceiptId: "00000000-0000-4000-8000-000000000001",
      }).received,
      false,
    );
    c.received(held);
    assert.throws(() =>
      c.f.kernel.postWorkerMessage(c.work.execution, {
        reviseDraftId: held.heldDraftId,
        body: "wrong target",
        channel: c.f.privateBox.roomId,
      }),
    );
    c.work.finish(0);
    assert.equal(c.queued().length, 1);
    assert.equal(
      c.f.db
        .prepare(
          "SELECT count(*) n FROM worker_run_read_receipts WHERE confirmed=1",
        )
        .get()?.n,
      0,
    );
  } finally {
    c.f.close();
  }
});
