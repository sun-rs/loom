import assert from "node:assert/strict";
import test from "node:test";
import { RoomKernel, KERNEL_SCHEMA_VERSION } from "../src/room-kernel.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
  startInstanceRunFromQueue,
} from "./role-instance-fixture.ts";

for (const followUp of [false, true]) {
  test(`recovery closes committed final without replay; follow-up=${followUp}`, () => {
    let now = Date.now();
    const f = roleInstanceFixture({ now: () => new Date(now) });
    try {
      const w = startInstanceRun(f);
      const d = f.kernel.syncWorker(w.execution, {});
      f.kernel.acknowledgeWorkerCursor(w.execution, {
        throughSeq: d.cursorAfter,
      });
      const final = f.kernel.submitWorkerFinalOutput(w.execution, {
        body: "finished once",
        basedOnRoomSeq: w.scope.toSeq,
      });
      assert.ok("event" in final);
      if (followUp)
        f.kernel.postMessage(f.actor, {
          roomId: f.home.roomId,
          body: "new request",
          idempotencyKey: "follow-up",
          recipients: [
            { participantId: f.instance.instanceId, reason: "mention" },
          ],
        });
      now += 600001;
      f.kernel.heartbeatHost(f.host);
      f.kernel.leaseNextActivation(f.host, { leaseMs: 30000 });
      assert.equal(
        f.db
          .prepare("SELECT state FROM activations WHERE activation_id=?")
          .get(w.activation.activationId)!.state,
        "quarantined",
      );
      const recovery = f.kernel.leaseNextRuntimeRecovery(f.host, {
        driverIds: ["fake"],
        leaseMs: 30000,
      });
      assert.ok(recovery);
      f.kernel.recordRecoveredRuntimeTermination(f.host, {
        runtimeProcessId: recovery.runtimeProcessId,
        recoveryAttemptCount: recovery.recoveryAttemptCount,
        exit: { code: null, signal: "SIGKILL" },
      });
      if (!followUp)
        f.kernel.resolveActivationQuarantine(f.host, {
          activationId: w.activation.activationId,
        });
      let automaticNext;
      const recovered = new RoomKernel({
        databasePath: String(f.db.prepare("PRAGMA database_list").get()!.file),
        now: () => new Date(now),
      });
      try {
        recovered.initialize();
        if (followUp)
          automaticNext = recovered.leaseNextActivation(f.host, {
            leaseMs: 30000,
          });
      } finally {
        recovered.close();
      }
      assert.equal(
        f.db
          .prepare("SELECT state FROM activations WHERE activation_id=?")
          .get(w.activation.activationId)!.state,
        "completed",
      );
      const next = followUp
        ? automaticNext
        : f.kernel.leaseNextActivation(f.host, { leaseMs: 30000 });
      if (followUp) {
        assert.ok(next);
        assert.notEqual(next.activationId, w.activation.activationId);
        assert.ok(next.fromSeq > w.scope.toSeq);
      } else assert.equal(next, null);
      assert.equal(
        f.db.prepare("SELECT count(*) n FROM run_attempts").get()!.n,
        1,
      );
      assert.equal(
        f.db.prepare("SELECT count(*) n FROM worker_run_message_writes").get()!
          .n,
        1,
      );
      const old = f.db
        .prepare(
          "SELECT state,exit_signal FROM run_attempts WHERE run_attempt_id=?",
        )
        .get(w.run.runAttemptId)!;
      assert.equal(old.exit_signal, "SIGKILL");
      assert.notEqual(old.state, "exited");
      assert.equal(
        f.db
          .prepare(
            "SELECT count(*) n FROM room_events WHERE aggregate_id=? AND type='activation.finished'",
          )
          .get(w.activation.activationId)!.n,
        1,
      );
    } finally {
      f.close();
    }
  });
}

test("schema 88 final markers retain history without invented recovery scope", () => {
  const f = roleInstanceFixture();
  try {
    const w = startInstanceRun(f),
      d = f.kernel.syncWorker(w.execution, {});
    f.kernel.acknowledgeWorkerCursor(w.execution, {
      throughSeq: d.cursorAfter,
    });
    f.kernel.submitWorkerFinalOutput(w.execution, {
      body: "historical",
      basedOnRoomSeq: w.scope.toSeq,
    });
    const before = f.db
      .prepare("SELECT * FROM room_events ORDER BY room_id,room_seq")
      .all();
    const path = String(f.db.prepare("PRAGMA database_list").get()!.file);
    f.db.exec(
      "ALTER TABLE run_attempt_final_replies DROP COLUMN consumer_id; ALTER TABLE run_attempt_final_replies DROP COLUMN delivery_to_seq; PRAGMA user_version=88",
    );
    const upgraded = new RoomKernel({ databasePath: path });
    try {
      upgraded.initialize();
      assert.equal(
        f.db.prepare("PRAGMA user_version").get()!.user_version,
        KERNEL_SCHEMA_VERSION,
      );
      assert.deepEqual(
        {
          ...f.db
            .prepare(
              "SELECT consumer_id,delivery_to_seq FROM run_attempt_final_replies",
            )
            .get(),
        },
        { consumer_id: null, delivery_to_seq: null },
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

for (const missing of [
  "final",
  "ack",
  "consumer",
  "range",
  "generation",
] as const) {
  test(`recovery does not invent missing ${missing} evidence`, () => {
    let now = Date.now();
    const f = roleInstanceFixture({ now: () => new Date(now) });
    try {
      const w = startInstanceRun(f);
      const d = f.kernel.syncWorker(w.execution, {});
      f.kernel.acknowledgeWorkerCursor(w.execution, {
        throughSeq: d.cursorAfter,
      });
      if (missing === "final")
        f.kernel.postWorkerMessage(w.execution, { body: "progress only" });
      else
        f.kernel.submitWorkerFinalOutput(w.execution, {
          body: "done",
          basedOnRoomSeq: w.scope.toSeq,
        });
      // Remove/change one persisted proof to model incomplete historical evidence.
      if (missing === "ack") f.db.exec("DELETE FROM subscription_cursors");
      if (missing === "consumer")
        f.db.exec("UPDATE run_attempt_final_replies SET consumer_id=NULL");
      if (missing === "range")
        f.db.exec("UPDATE run_attempt_final_replies SET delivery_to_seq=1");
      if (missing === "generation")
        f.db.exec(
          "UPDATE worker_run_message_writes SET session_generation=999",
        );
      now += 600001;
      f.kernel.heartbeatHost(f.host);
      f.kernel.leaseNextActivation(f.host, { leaseMs: 30000 });
      assert.throws(
        () =>
          f.kernel.resolveActivationQuarantine(f.host, {
            activationId: w.activation.activationId,
          }),
        /unverified runtime termination/,
      );
      const recovery = f.kernel.leaseNextRuntimeRecovery(f.host, {
        driverIds: ["fake"],
        leaseMs: 30000,
      })!;
      assert.ok(recovery);
      f.kernel.recordRecoveredRuntimeTermination(f.host, {
        runtimeProcessId: recovery.runtimeProcessId,
        recoveryAttemptCount: recovery.recoveryAttemptCount,
        exit: { code: null, signal: "SIGKILL" },
      });
      f.kernel.resolveActivationQuarantine(f.host, {
        activationId: w.activation.activationId,
      });
      assert.equal(
        f.db
          .prepare("SELECT state FROM activations WHERE activation_id=?")
          .get(w.activation.activationId)!.state,
        "queued",
      );
      assert.equal(
        f.db
          .prepare(
            "SELECT count(*) n FROM room_events WHERE aggregate_id=? AND type='activation.finished'",
          )
          .get(w.activation.activationId)!.n,
        0,
      );
    } finally {
      f.close();
    }
  });
}

test("recovery never uses a prior attempt's final to complete a newer attempt", () => {
  let now = Date.now();
  const f = roleInstanceFixture({ now: () => new Date(now) });
  try {
    const old = startInstanceRun(f),
      d = f.kernel.syncWorker(old.execution, {});
    f.kernel.acknowledgeWorkerCursor(old.execution, {
      throughSeq: d.cursorAfter,
    });
    f.kernel.submitWorkerFinalOutput(old.execution, {
      body: "previous attempt",
      basedOnRoomSeq: old.scope.toSeq,
    });
    f.kernel.recordRuntimeTermination(f.host, {
      runAttemptId: old.run.runAttemptId,
      runtimeRunId: old.runtime.runtimeRunId,
      exit: { code: 1 },
    });
    f.kernel.finishRunAttempt(f.host, {
      runAttemptId: old.run.runAttemptId,
      state: "failed",
      exitCode: 1,
    });
    f.kernel.retryActivation(f.host, {
      activationId: old.activation.activationId,
      error: "explicit retry",
      retryAfterMs: 0,
    });
    const current = startInstanceRunFromQueue(f);
    now += 600001;
    f.kernel.heartbeatHost(f.host);
    f.kernel.leaseNextActivation(f.host, { leaseMs: 30000 });
    const recovery = f.kernel.leaseNextRuntimeRecovery(f.host, {
      driverIds: ["fake"],
      leaseMs: 30000,
    })!;
    assert.ok(recovery);
    f.kernel.recordRecoveredRuntimeTermination(f.host, {
      runtimeProcessId: recovery.runtimeProcessId,
      recoveryAttemptCount: recovery.recoveryAttemptCount,
      exit: { code: null, signal: "SIGKILL" },
    });
    f.kernel.resolveActivationQuarantine(f.host, {
      activationId: current.activation.activationId,
    });
    assert.equal(
      f.db
        .prepare("SELECT state FROM activations WHERE activation_id=?")
        .get(current.activation.activationId)!.state,
      "queued",
    );
  } finally {
    f.close();
  }
});
