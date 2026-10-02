import assert from "node:assert/strict";
import test from "node:test";
import { confirmPost } from "../src/activation-read-coverage.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
} from "./role-instance-fixture.ts";

const post = (f: ReturnType<typeof roleInstanceFixture>, key: string) =>
  f.kernel.postMessage(f.actor, {
    roomId: f.home.roomId,
    body: key,
    idempotencyKey: key,
    recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
  });
const queued = (f: ReturnType<typeof roleInstanceFixture>) =>
  f.db
    .prepare(
      "SELECT * FROM activations WHERE participant_id=? AND state='queued'",
    )
    .all(f.instance.instanceId);
function read(
  f: ReturnType<typeof roleInstanceFixture>,
  work: ReturnType<typeof startInstanceRun>,
  limit = 100,
) {
  const result = f.kernel.workerReads.history(work.execution, {
    channel: "#home",
    limit,
  });
  if (result.readReceiptId)
    assert.equal(
      f.kernel.workerReads.acknowledgeReadDelivery(work.execution, {
        readReceiptId: result.readReceiptId,
      }).received,
      true,
    );
  return result;
}

test("a successful run covers a later directed message it read and explicitly replied to; no second run or Inbox ACK", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    const later = post(f, "later");
    read(f, work);
    const follow = queued(f)[0]!;
    f.kernel.postWorkerMessage(work.execution, {
      channel: "#home",
      body: "handled later",
      idempotencyKey: "reply",
      basedOnRoomSeq: later.event.roomSeq,
    });
    work.finish(0);
    assert.equal(
      f.db
        .prepare("SELECT state FROM activations WHERE activation_id=?")
        .get(follow.activation_id!)?.state,
      "cancelled",
    );
    assert.equal(
      f.kernel.leaseNextActivation(f.host, { leaseMs: 10000 }),
      null,
    );
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM run_attempts").get()?.n,
      1,
    );
    assert.equal(
      f.db
        .prepare("SELECT state FROM inbox_items WHERE event_id=?")
        .get(later.event.eventId)?.state,
      "pending",
    );
  } finally {
    f.close();
  }
});

test("read-only completion requires a subsequent check receipt; history alone is not completion", () => {
  for (const confirm of [false, true]) {
    const f = roleInstanceFixture();
    try {
      const work = startInstanceRun(f);
      post(f, "later");
      read(f, work);
      if (confirm) {
        const readConfirmationId = f.kernel.freezeWorkerReadConfirmation(
          work.execution,
        );
        f.kernel.acknowledgeWorkerCursor(work.execution, {
          throughSeq: work.activation.toSeq,
          readConfirmationId,
        });
      }
      work.finish(0);
      assert.equal(queued(f).length, confirm ? 0 : 1);
    } finally {
      f.close();
    }
  }
});

function confirm(
  f: ReturnType<typeof roleInstanceFixture>,
  work: ReturnType<typeof startInstanceRun>,
) {
  const readConfirmationId = f.kernel.freezeWorkerReadConfirmation(
    work.execution,
  );
  f.kernel.acknowledgeWorkerCursor(work.execution, {
    throughSeq: work.activation.toSeq,
    readConfirmationId,
  });
}

test("a MAX read position cannot hide a hole or an unread tail in the queued interval", () => {
  for (const hole of [true, false]) {
    const f = roleInstanceFixture();
    try {
      const work = startInstanceRun(f);
      post(f, "one");
      if (hole) {
        post(f, "two");
        read(f, work, 1);
      } else {
        read(f, work);
        post(f, "two");
      }
      confirm(f, work);
      work.finish(0);
      assert.equal(queued(f).length, 1);
      assert.ok(f.kernel.leaseNextActivation(f.host, { leaseMs: 10000 }));
    } finally {
      f.close();
    }
  }
});

test("confirmation tokens cannot cover later reads or be forged", () => {
  for (const forged of [false, true]) {
    const f = roleInstanceFixture();
    try {
      const work = startInstanceRun(f);
      post(f, "one");
      read(f, work);
      const token = f.kernel.freezeWorkerReadConfirmation(work.execution);
      if (!forged) {
        post(f, "two");
        read(f, work);
      }
      f.kernel.acknowledgeWorkerCursor(work.execution, {
        throughSeq: work.activation.toSeq,
        readConfirmationId: forged
          ? "00000000-0000-4000-8000-000000000001"
          : token,
      });
      work.finish(0);
      assert.equal(queued(f).length, 1);
    } finally {
      f.close();
    }
  }
});

test("a confirmed read from a failed run does not consume a later notification", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    post(f, "one");
    read(f, work);
    confirm(f, work);
    work.finish(1);
    assert.equal(queued(f).length, 1);
  } finally {
    f.close();
  }
});

test("coverage is not settled before ACK and actual runtime termination", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    post(f, "one");
    read(f, work);
    assert.throws(
      () =>
        f.kernel.completeActivation(f.host, {
          activationId: work.activation.activationId,
          consumerId: "worker",
        }),
      /acknowledg/i,
    );
    confirm(f, work);
    assert.throws(
      () =>
        f.kernel.completeActivation(f.host, {
          activationId: work.activation.activationId,
          consumerId: "worker",
        }),
      /terminal proof/,
    );
    assert.equal(queued(f).length, 1);
    work.finish(0);
    assert.equal(queued(f).length, 0);
  } finally {
    f.close();
  }
});

test("cross-room reads and replies do not consume private-box work", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    f.kernel.postMessage(f.actor, {
      roomId: f.privateBox.roomId,
      body: "private",
      idempotencyKey: "private",
      recipients: [{ participantId: f.instance.instanceId, reason: "dm" }],
    });
    assert.throws(
      () =>
        f.kernel.workerReads.history(work.execution, {
          channel: f.privateBox.roomId,
          limit: 100,
        }),
      /private box isolation/,
    );
    confirm(f, work);
    work.finish(0);
    assert.equal(queued(f).length, 1);
    assert.equal(
      f.kernel.leaseNextActivation(f.host, { leaseMs: 10000 })?.roomId,
      f.privateBox.roomId,
    );
  } finally {
    f.close();
  }
});

test("unknown Inbox reasons and task reasons stay queued even when read and confirmed", () => {
  for (const reason of ["task_assignment", "future_reason"]) {
    const f = roleInstanceFixture();
    try {
      const work = startInstanceRun(f);
      const later = post(f, "one");
      read(f, work);
      confirm(f, work);
      // Simulate a future protocol reason with no optimizer support.
      f.db
        .prepare("UPDATE inbox_items SET reason=? WHERE event_id=?")
        .run(reason, later.event.eventId);
      work.finish(0);
      assert.equal(queued(f).length, 1);
    } finally {
      f.close();
    }
  }
});

test("source completion replay stays idempotent and later messages still execute", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    post(f, "one");
    read(f, work);
    confirm(f, work);
    work.finish(0);
    const count = () =>
      f.db
        .prepare(
          "SELECT count(*) n FROM room_events WHERE type IN ('activation.finished','activation.cancelled')",
        )
        .get()?.n;
    assert.equal(count(), 2);
    f.kernel.completeActivation(f.host, {
      activationId: work.activation.activationId,
      consumerId: "worker",
    });
    assert.equal(count(), 2);
    post(f, "new after completion");
    assert.equal(queued(f).length, 1);
    assert.ok(f.kernel.scheduleNextPlacement({ leaseMs: 10000 }));
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM run_attempts").get()?.n,
      1,
    );
  } finally {
    f.close();
  }
});

test("thread reads are not confirmed by a top-level reply", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    const root = f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "root",
      idempotencyKey: "root",
      recipients: [],
    });
    const thread = f.kernel.createThread(f.actor, {
      roomId: f.home.roomId,
      rootMessageId: root.event.aggregateId,
      recipientIds: [],
      idempotencyKey: "thread",
      basedOnRoomSeq: f.head(f.home.roomId),
    }).thread;
    const later = f.kernel.replyThread(f.actor, {
      roomId: f.home.roomId,
      threadId: thread.threadId,
      body: "thread request",
      recipientIds: [f.instance.instanceId],
      idempotencyKey: "thread-request",
      basedOnRoomSeq: f.head(f.home.roomId),
    });
    const shown = f.kernel.workerReads.history(work.execution, {
      channel: "#home",
      threadId: thread.threadId,
      limit: 100,
    });
    assert.ok(shown.readReceiptId);
    f.kernel.workerReads.acknowledgeReadDelivery(work.execution, {
      readReceiptId: shown.readReceiptId,
    });
    // Use the shared committed-post settlement: routing still has its independent target guard.
    const { event } = f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "not a thread reply",
      idempotencyKey: "top",
      recipients: [],
    });
    confirmPost(f.db, work.scope, event, later.event.roomSeq);
    work.finish(0);
    assert.equal(queued(f).length, 1);
  } finally {
    f.close();
  }
});

test("recovered queued notifications use durable proof, but a session reset invalidates it", () => {
  for (const reset of [false, true]) {
    const f = roleInstanceFixture();
    try {
      const work = startInstanceRun(f);
      post(f, "one");
      read(f, work);
      confirm(f, work);
      const id = queued(f)[0]!.activation_id!;
      // Fault fixture: temporarily quarantined follow-up, restored by recovery only after source completion.
      f.db
        .prepare(
          "UPDATE activations SET state='quarantined' WHERE activation_id=?",
        )
        .run(id);
      work.finish(0);
      if (reset)
        f.kernel.roles.resetInstanceSession(f.actor, {
          instanceId: f.instance.instanceId,
          basedOnRoomSeq: f.head(f.home.roomId),
          idempotencyKey: "reset",
        });
      f.db
        .prepare("UPDATE activations SET state='queued' WHERE activation_id=?")
        .run(id);
      const placement = f.kernel.scheduleNextPlacement({ leaseMs: 10000 });
      assert.equal(placement === null, !reset);
      assert.equal(
        f.db
          .prepare("SELECT state FROM activations WHERE activation_id=?")
          .get(id)?.state,
        reset ? "leased" : "cancelled",
      );
    } finally {
      f.close();
    }
  }
});

test("a business obligation prevents consumption even after exact read confirmation", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    post(f, "one");
    read(f, work);
    confirm(f, work);
    const id = queued(f)[0]!.activation_id!;
    const task = f.kernel.createTask(f.actor, {
      roomId: f.home.roomId,
      title: "explicit durable task",
      assigneeId: f.instance.instanceId,
      collaboratorIds: [],
      reviewerIds: [],
      dependencyTaskIds: [],
      idempotencyKey: "task",
    });
    work.finish(0);
    assert.equal(
      f.db
        .prepare("SELECT state FROM activations WHERE activation_id=?")
        .get(id)?.state,
      "queued",
    );
    assert.notEqual(
      f.db
        .prepare("SELECT state FROM tasks WHERE task_id=?")
        .get(task.task.taskId)?.state,
      "completed",
    );
  } finally {
    f.close();
  }
});

test("deduplicated committed posts cannot enlarge the coverage receipt", async () => {
  const { settleHeldDraftReplyIntent } =
    await import("../src/held-message-drafts.ts");
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    const later = post(f, "one");
    read(f, work);
    settleHeldDraftReplyIntent({
      database: f.db,
      scope: work.scope,
      intent: { basedOnRoomSeq: later.event.roomSeq, final: false },
      result: { event: later.event, deduplicated: true },
      acknowledge: () => {},
      recordFinal: () => {},
      confirmReadCoverage: (scope, event, seq) =>
        confirmPost(f.db, scope, event, seq),
    });
    work.finish(0);
    assert.equal(queued(f).length, 1);
  } finally {
    f.close();
  }
});

test("schema 79 creates empty provenance instead of converting historical MAX reads into completion proof", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    post(f, "one");
    read(f, work);
    work.finish(1);
    assert.ok(
      Number(
        f.db
          .prepare("SELECT count(*) n FROM worker_message_presentations")
          .get()?.n,
      ) > 0,
    );
    f.db.exec("DROP TABLE worker_run_read_receipts; PRAGMA user_version=78");
    f.kernel.initialize();
    assert.equal(f.db.prepare("PRAGMA user_version").get()?.user_version, 81);
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM worker_run_read_receipts").get()?.n,
      0,
    );
    assert.equal(queued(f).length, 1);
  } finally {
    f.close();
  }
});

test("a held unsent reply is not a completed business action even if the run later checks and exits", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    const later = post(f, "new request");
    const held = f.kernel.postWorkerMessage(work.execution, {
      channel: "#home",
      body: "unsent response",
      idempotencyKey: "held",
      basedOnRoomSeq: later.event.roomSeq,
    });
    assert.ok("state" in held && held.state === "held");
    read(f, work);
    confirm(f, work);
    work.finish(0);
    assert.equal(queued(f).length, 1);
  } finally {
    f.close();
  }
});

test("late tools after --final cannot consume a new Human message during process wind-down", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    read(f, work);
    const reply = f.kernel.postWorkerMessage(work.execution, {
      channel: "#home",
      body: "finished",
      idempotencyKey: "final",
      basedOnRoomSeq: work.activation.toSeq,
      final: true,
    });
    assert.ok("event" in reply);
    post(f, "arrived after final");
    read(f, work);
    confirm(f, work);
    work.finish(0);
    assert.equal(queued(f).length, 1);
  } finally {
    f.close();
  }
});

test("a server-side history response lost before CLI output cannot be confirmed by a later check", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    post(f, "unreceived");
    f.kernel.workerReads.history(work.execution, {
      channel: "#home",
      limit: 100,
    });
    confirm(f, work);
    work.finish(0);
    assert.equal(queued(f).length, 1);
  } finally {
    f.close();
  }
});
