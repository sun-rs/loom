import { RoomKernel } from "../src/room-kernel.ts";
import assert from "node:assert/strict";
import test from "node:test";
import {
  roleInstanceFixture,
  startInstanceRun,
  startInstanceRunFromQueue,
} from "./role-instance-fixture.ts";

for (const route of ["origin", "target"] as const) {
  test(`native final accepts current Run ${route} progress without changing causal sequence`, () => {
    const f = roleInstanceFixture();
    try {
      const w = startInstanceRun(f),
        delivery = f.kernel.syncWorker(w.execution, {});
      f.kernel.acknowledgeWorkerCursor(w.execution, {
        throughSeq: delivery.cursorAfter,
      });
      if (route === "target")
        f.kernel.workerTargetContext.read(w.execution, { channel: "#home" });
      const progress = f.kernel.postWorkerMessage(w.execution, {
        body: "progress only",
        idempotencyKey: "progress",
        ...(route === "target" ? { channel: "#home" } : {}),
      });
      assert.ok("event" in progress);
      assert.equal(
        f.db
          .prepare("SELECT count(*) AS n FROM run_attempt_final_replies")
          .get()!.n,
        0,
      );
      const final = f.kernel.submitWorkerFinalOutput(w.execution, {
        body: "finished answer",
        basedOnRoomSeq: w.scope.toSeq,
      });
      assert.ok(
        "event" in final,
        "current Run progress must not hold its native final",
      );
      assert.equal(final.event.payload.basedOnRoomSeq, w.scope.toSeq);
      const replay = f.kernel.submitWorkerFinalOutput(w.execution, {
        body: "finished answer",
        basedOnRoomSeq: w.scope.toSeq,
      });
      assert.ok("event" in replay && replay.deduplicated);
      assert.equal(
        f.db
          .prepare("SELECT count(*) AS n FROM run_attempt_final_replies")
          .get()!.n,
        1,
      );
    } finally {
      f.close();
    }
  });
}
for (const order of ["before-own", "after-own"] as const) {
  test(`native final still holds a Human message ${order}`, () => {
    const f = roleInstanceFixture();
    try {
      const w = startInstanceRun(f),
        d = f.kernel.syncWorker(w.execution, {});
      f.kernel.acknowledgeWorkerCursor(w.execution, {
        throughSeq: d.cursorAfter,
      });
      const human = () =>
        f.kernel.postMessage(f.actor, {
          roomId: f.home.roomId,
          body: "new Human fact",
          recipients: [],
          idempotencyKey: "new-human",
        });
      if (order === "before-own") human();
      f.kernel.workerTargetContext.read(w.execution, { channel: "#home" });
      const p = f.kernel.postWorkerMessage(w.execution, {
        channel: "#home",
        body: "own progress",
        idempotencyKey: "progress",
      });
      assert.ok("event" in p);
      if (order === "after-own") human();
      const final = f.kernel.submitWorkerFinalOutput(w.execution, {
        body: "finished answer",
        basedOnRoomSeq: w.scope.toSeq,
      });
      assert.ok("state" in final && final.state === "held");
      assert.equal(
        f.db
          .prepare("SELECT count(*) AS n FROM run_attempt_final_replies")
          .get()!.n,
        0,
      );
    } finally {
      f.close();
    }
  });
}

test("unattributed historical progress is never adopted by an idempotent replay", () => {
  const f = roleInstanceFixture();
  try {
    const w = startInstanceRun(f),
      d = f.kernel.syncWorker(w.execution, {});
    f.kernel.acknowledgeWorkerCursor(w.execution, {
      throughSeq: d.cursorAfter,
    });
    const p = f.kernel.postWorkerMessage(w.execution, {
      body: "progress",
      idempotencyKey: "progress",
    });
    assert.ok("event" in p);
    f.db
      .prepare("DELETE FROM worker_run_message_writes WHERE event_id=?")
      .run(p.event.eventId);
    const replay = f.kernel.postWorkerMessage(w.execution, {
      body: "progress",
      idempotencyKey: "progress",
    });
    assert.ok("event" in replay && replay.deduplicated);
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM worker_run_message_writes").get()!.n,
      0,
    );
    const final = f.kernel.submitWorkerFinalOutput(w.execution, {
      body: "final",
      basedOnRoomSeq: w.scope.toSeq,
    });
    assert.ok("state" in final && final.state === "held");
  } finally {
    f.close();
  }
});

test("ordinary final flag does not gain trusted final-output freshness", () => {
  const f = roleInstanceFixture();
  try {
    const w = startInstanceRun(f),
      d = f.kernel.syncWorker(w.execution, {});
    f.kernel.acknowledgeWorkerCursor(w.execution, {
      throughSeq: d.cursorAfter,
    });
    f.kernel.postWorkerMessage(w.execution, {
      body: "progress",
      idempotencyKey: "progress",
    });
    const final = f.kernel.postWorkerMessage(w.execution, {
      body: "ordinary final",
      final: true,
    });
    assert.ok("state" in final && final.state === "held");
  } finally {
    f.close();
  }
});

for (const route of ["origin", "target"] as const)
  test(`provenance failure rolls back ${route} message and effects`, () => {
    const f = roleInstanceFixture();
    try {
      const w = startInstanceRun(f);
      if (route === "target")
        f.kernel.workerTargetContext.read(w.execution, { channel: "#home" });
      const before = f.db
        .prepare("SELECT * FROM room_events ORDER BY room_id,room_seq")
        .all();
      f.db.exec(
        "CREATE TRIGGER reject_provenance BEFORE INSERT ON worker_run_message_writes BEGIN SELECT RAISE(ABORT,'provenance failure'); END",
      );
      assert.throws(
        () =>
          f.kernel.postWorkerMessage(w.execution, {
            body: "must roll back",
            ...(route === "target" ? { channel: "#home" } : {}),
          }),
        /provenance failure/,
      );
      assert.deepEqual(
        f.db
          .prepare("SELECT * FROM room_events ORDER BY room_id,room_seq")
          .all(),
        before,
      );
      assert.equal(
        f.db
          .prepare(
            "SELECT count(*) n FROM messages WHERE body='must roll back'",
          )
          .get()!.n,
        0,
      );
    } finally {
      f.close();
    }
  });

test("same activation retry cannot adopt the previous Run's progress", () => {
  const f = roleInstanceFixture();
  try {
    const w = startInstanceRun(f);
    const p = f.kernel.postWorkerMessage(w.execution, {
      body: "previous attempt progress",
      idempotencyKey: "progress",
    });
    assert.ok("event" in p);
    f.kernel.recordRuntimeTermination(f.host, {
      runAttemptId: w.run.runAttemptId,
      runtimeRunId: w.runtime.runtimeRunId,
      exit: { code: 1 },
    });
    f.kernel.finishRunAttempt(f.host, {
      runAttemptId: w.run.runAttemptId,
      state: "failed",
      exitCode: 1,
    });
    f.kernel.retryActivation(f.host, {
      activationId: w.activation.activationId,
      error: "retry",
      retryAfterMs: 0,
    });
    const next = startInstanceRunFromQueue(f);
    assert.equal(next.activation.activationId, w.activation.activationId);
    assert.notEqual(next.run.runAttemptId, w.run.runAttemptId);
    const d = f.kernel.syncWorker(next.execution, {});
    f.kernel.acknowledgeWorkerCursor(next.execution, {
      throughSeq: d.cursorAfter,
    });
    const final = f.kernel.submitWorkerFinalOutput(next.execution, {
      body: "final",
      basedOnRoomSeq: next.scope.toSeq,
    });
    assert.ok("state" in final && final.state === "held");
    assert.equal(
      f.db
        .prepare(
          "SELECT run_attempt_id FROM worker_run_message_writes WHERE event_id=?",
        )
        .get(p.event.eventId)!.run_attempt_id,
      w.run.runAttemptId,
    );
  } finally {
    f.close();
  }
});

test("schema 83 upgrade preserves events without backfilling write provenance", () => {
  const f = roleInstanceFixture();
  try {
    const w = startInstanceRun(f);
    const p = f.kernel.postWorkerMessage(w.execution, {
      body: "historical progress",
    });
    assert.ok("event" in p);
    const before = f.db
      .prepare("SELECT * FROM room_events ORDER BY room_id,room_seq")
      .all();
    f.db.exec("DROP TABLE worker_run_message_writes; PRAGMA user_version=83");
    const upgraded = new RoomKernel({
      databasePath: f.db.prepare("PRAGMA database_list").get()!.file as string,
    });
    try {
      upgraded.initialize();
      assert.equal(f.db.prepare("PRAGMA user_version").get()!.user_version, 84);
      assert.equal(
        f.db.prepare("SELECT count(*) n FROM worker_run_message_writes").get()!
          .n,
        0,
      );
      assert.deepEqual(
        f.db
          .prepare("SELECT * FROM room_events ORDER BY room_id,room_seq")
          .all(),
        before,
      );
      assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      upgraded.close();
    }
  } finally {
    f.close();
  }
});
