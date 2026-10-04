import assert from "node:assert/strict";
import test from "node:test";
import { WorkerApplicationService } from "../src/index.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
} from "../../kernel/test/role-instance-fixture.ts";

async function fixture(present = true, sent = true) {
  const f = roleInstanceFixture();
  const service = new WorkerApplicationService({ kernel: f.kernel });
  await service.start();
  const work = startInstanceRun(f);
  f.kernel.presentWorkerMessages(work.execution);
  if (sent)
    f.kernel.markPresentedDeliverySent(f.host, {
      activationId: work.activation.activationId,
      consumerId: "worker",
      runAttemptId: work.run.runAttemptId,
    });
  const credential = service.issueActivationCredential(f.host, work.scope);
  const send = async (path: string, body: unknown) => {
    const response = await fetch(
      service.origin +
        (path.startsWith("/") ? path : "/v1/worker/messages/" + path),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    return {
      status: response.status,
      body: (await response.json()) as {
        event: { actorId: string; roomId: string };
        deduplicated: boolean;
        state: string;
        heldDraftId: string;
      },
    };
  };
  if (present)
    assert.equal((await send("/v1/worker/message-present", {})).status, 200);
  return {
    f,
    work,
    send,
    close: async () => {
      await service.close();
      f.close();
    },
  };
}

test("final output is strict, original-bound, durable-idempotent and conflicts on changed content", async () => {
  const x = await fixture();
  try {
    assert.equal(
      (
        await x.send("final-output", {
          basedOnRoomSeq: x.work.scope.toSeq,
          body: "FAKE answer",
          actorId: "owner",
        })
      ).status,
      400,
    );
    const first = await x.send("final-output", {
      basedOnRoomSeq: x.work.scope.toSeq,
      body: "FAKE answer",
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.event.actorId, x.f.instance.instanceId);
    assert.equal(first.body.event.roomId, x.f.home.roomId);
    assert.equal(
      (
        await x.send("final-output", {
          basedOnRoomSeq: x.work.scope.toSeq,
          body: "FAKE answer",
        })
      ).body.deduplicated,
      true,
    );
    assert.equal(
      (
        await x.send("final-output", {
          basedOnRoomSeq: x.work.scope.toSeq,
          body: "changed",
        })
      ).status,
      409,
    );
    assert.equal(
      x.f.db
        .prepare("SELECT count(*) n FROM messages WHERE body='FAKE answer'")
        .get()!.n,
      1,
    );
    assert.ok(
      Number(
        x.f.db
          .prepare(
            "SELECT last_seq FROM subscription_cursors WHERE room_id=? AND participant_id=? AND consumer_id=?",
          )
          .get(x.work.scope.roomId, x.work.scope.participantId, "worker")
          ?.last_seq,
      ) >= x.work.scope.toSeq,
    );
    x.work.finish(0);
    assert.notEqual(
      (
        await x.send("final-output", {
          basedOnRoomSeq: x.work.scope.toSeq,
          body: "FAKE answer",
        })
      ).status,
      200,
    );
  } finally {
    await x.close();
  }
});

test("prior tool final blocks output without making a held draft", async () => {
  const x = await fixture();
  try {
    assert.equal(
      (await x.send("post", { body: "FAKE tool", final: true })).status,
      200,
    );
    assert.equal(
      (
        await x.send("final-output", {
          basedOnRoomSeq: x.work.scope.toSeq,
          body: "FAKE output",
        })
      ).status,
      409,
    );
    assert.equal(
      x.f.db.prepare("SELECT count(*) n FROM held_message_drafts").get()!.n,
      0,
    );
  } finally {
    await x.close();
  }
});

test("final output marker rejects a later tool final transaction; ordinary tool finals retain their semantics", async () => {
  for (const source of ["final-output", "post"]) {
    const x = await fixture();
    try {
      assert.equal(
        (
          await x.send(source, {
            body: "FAKE first",
            ...(source === "post"
              ? { final: true }
              : { basedOnRoomSeq: x.work.scope.toSeq }),
          })
        ).status,
        200,
      );
      const held = await x.send("post", { body: "FAKE second", final: true });
      assert.equal(held.body.state, "held");
      const reheld = await x.send("post", {
        sendDraft: true,
        heldDraftId: held.body.heldDraftId,
      });
      assert.equal(reheld.body.state, "held");
      const resend = await x.send("post", {
        sendDraft: true,
        heldDraftId: reheld.body.heldDraftId,
        anyway: true,
        idempotencyKey: "explicit-anyway",
      });
      assert.equal(
        resend.status,
        source === "final-output" ? 409 : 200,
        JSON.stringify(resend.body),
      );
      assert.equal(
        x.f.db
          .prepare("SELECT count(*) n FROM messages WHERE body='FAKE second'")
          .get()!.n,
        source === "final-output" ? 0 : 1,
      );
    } finally {
      await x.close();
    }
  }
});

test("new Human facts hold output without final marker or ACK", async () => {
  const x = await fixture();
  try {
    const before = x.f.db.prepare("SELECT * FROM subscription_cursors").all();
    x.f.kernel.postMessage(x.f.actor, {
      roomId: x.f.home.roomId,
      body: "new fact",
      idempotencyKey: "new-fact",
      recipients: [],
    });
    const result = await x.send("final-output", {
      basedOnRoomSeq: x.work.scope.toSeq,
      body: "FAKE held",
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.state, "held");
    assert.deepEqual(
      x.f.db.prepare("SELECT * FROM subscription_cursors").all(),
      before,
    );
    assert.equal(
      x.f.db.prepare("SELECT count(*) n FROM run_attempt_final_replies").get()!
        .n,
      0,
    );
  } finally {
    await x.close();
  }
});

test("a Worker-supplied platform-looking key cannot mint trusted final-output provenance", async () => {
  const x = await fixture();
  try {
    const first = await x.send("post", {
      body: "FAKE spoof",
      final: true,
      idempotencyKey: `final-output:v1:${x.work.run.runAttemptId}`,
    });
    assert.equal(first.status, 200);
    assert.equal(
      x.f.db
        .prepare(
          "SELECT submission_kind FROM run_attempt_final_replies WHERE run_attempt_id=?",
        )
        .get(x.work.run.runAttemptId)!.submission_kind,
      null,
    );
    assert.equal(
      (
        await x.send("final-output", {
          basedOnRoomSeq: x.work.scope.toSeq,
          body: "FAKE spoof",
        })
      ).status,
      409,
    );
  } finally {
    await x.close();
  }
});

for (const kind of ["missing", "wrong", "unpresented"] as const)
  test(`final output rejects ${kind} causal evidence without publication or ACK`, async () => {
    const x = await fixture(kind !== "unpresented");
    try {
      const before = x.f.db.prepare("SELECT * FROM subscription_cursors").all();
      const path = "final-output";
      const result = await x.send(path, {
        body: "FAKE refused",
        ...(kind === "missing"
          ? {}
          : {
              basedOnRoomSeq: x.work.scope.toSeq + (kind === "wrong" ? 1 : 0),
            }),
      });
      assert.notEqual(result.status, 200);
      assert.equal(
        x.f.db
          .prepare("SELECT count(*) n FROM messages WHERE body='FAKE refused'")
          .get()!.n,
        0,
      );
      assert.deepEqual(
        x.f.db.prepare("SELECT * FROM subscription_cursors").all(),
        before,
      );
    } finally {
      await x.close();
    }
  });

test("echoing a known sequence does not invent Host delivery evidence", async () => {
  const x = await fixture(true, false);
  try {
    const before = x.f.db.prepare("SELECT * FROM subscription_cursors").all();
    const result = await x.send("final-output", {
      body: "FAKE unconfirmed",
      basedOnRoomSeq: x.work.scope.toSeq,
    });
    assert.equal(result.status, 200);
    assert.deepEqual(
      x.f.db.prepare("SELECT * FROM subscription_cursors").all(),
      before,
    );
    assert.throws(() =>
      x.f.kernel.submitWorkerFinalOutput(x.work.execution, {
        body: "wrong",
        basedOnRoomSeq: x.work.scope.toSeq + 1,
      }),
    );
  } finally {
    await x.close();
  }
});
