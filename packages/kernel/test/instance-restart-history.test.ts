import assert from "node:assert/strict";
import test from "node:test";
import {
  roleInstanceFixture,
  startInstanceRun,
  startInstanceRunFromQueue,
} from "./role-instance-fixture.ts";

test("new generation recovers bounded current-Room history once, including own reply, without rewinding cursors", () => {
  const f = roleInstanceFixture();
  try {
    const first = startInstanceRun(f);
    f.kernel.presentWorkerMessages(first.execution);
    f.kernel.markPresentedDeliverySent(f.host, { ...first.scope });
    const reply = f.kernel.postWorkerMessage(first.execution, {
      basedOnRoomSeq: first.scope.toSeq,
      body: "previous decision",
      idempotencyKey: "answer",
    });
    assert.ok("event" in reply);
    first.finish(0);
    const cursors = () =>
      f.db
        .prepare("SELECT * FROM subscription_cursors WHERE participant_id=?")
        .all(f.instance.instanceId);
    const before = cursors();
    f.kernel.roles.resetInstanceSession(f.actor, {
      instanceId: f.instance.instanceId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "reset",
    });
    assert.deepEqual(cursors(), before);
    const second = startInstanceRun(f);
    const restored = f.kernel.presentWorkerMessages(second.execution);
    assert.ok(
      restored.events.some((e) => e.payload.body === "previous decision"),
    );
    assert.ok(restored.events.length <= 20);
    assert.deepEqual(cursors(), before);
    f.kernel.markPresentedDeliverySent(f.host, { ...second.scope });
    f.kernel.instanceSessions.record(f.host, {
      runAttemptId: second.run.runAttemptId,
      runtimeRunId: second.runtime.runtimeRunId,
    });
    assert.equal(
      f.kernel.presentWorkerMessages(second.execution).contentDigest,
      restored.contentDigest,
    );
    assert.ok(
      "event" in
        f.kernel.postWorkerMessage(second.execution, {
          basedOnRoomSeq: second.scope.toSeq,
          body: "new decision",
          idempotencyKey: "restored-answer",
        }),
    );
    second.finish(0);
    const third = startInstanceRun(f);
    assert.ok(
      !f.kernel
        .presentWorkerMessages(third.execution)
        .events.some((e) => e.payload.body === "previous decision"),
    );
  } finally {
    f.close();
  }
});

test("private-box restart recovery stays in that box, and long history uses the existing shared budget", () => {
  const f = roleInstanceFixture();
  try {
    for (let i = 0; i < 30; i++)
      f.kernel.postMessage(f.actor, {
        roomId: f.privateBox.roomId,
        body: `private ${i}`,
        recipients: [
          { participantId: f.instance.instanceId, reason: "mention" },
        ],
        idempotencyKey: `p${i}`,
      });
    const first = startInstanceRunFromQueue(f);
    first.finish(0);
    f.kernel.roles.resetInstanceSession(f.actor, {
      instanceId: f.instance.instanceId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "reset",
    });
    const channel = startInstanceRun(f);
    const cw = f.kernel.presentWorkerMessages(channel.execution);
    assert.ok(
      !cw.events.some((e) => String(e.payload.body).startsWith("private")),
    );
    f.kernel.markPresentedDeliverySent(f.host, { ...channel.scope });
    channel.finish(0);
    f.kernel.postMessage(f.actor, {
      roomId: f.privateBox.roomId,
      body: "continue private",
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
      idempotencyKey: "next-private",
    });
    const second = startInstanceRunFromQueue(f);
    const restored = f.kernel.presentWorkerMessages(second.execution);
    const bodies = restored.events.map((e) => e.payload.body).filter(Boolean);
    assert.ok(bodies.includes("private 29"));
    assert.ok(bodies.includes("continue private"));
    assert.ok(bodies.length <= 20);
    assert.ok((restored.catchUpOmittedCount ?? 0) > 0);
    f.kernel.markPresentedDeliverySent(f.host, second.scope);
    assert.ok(
      "event" in
        f.kernel.postWorkerMessage(second.execution, {
          basedOnRoomSeq: second.scope.toSeq,
          body: "private restored",
          idempotencyKey: "private-restored",
        }),
    );
  } finally {
    f.close();
  }
});

test("deployment does not restore history into a previously reset legacy session", () => {
  const f = roleInstanceFixture();
  try {
    const first = startInstanceRun(f);
    f.kernel.presentWorkerMessages(first.execution);
    f.kernel.markPresentedDeliverySent(f.host, first.scope);
    assert.ok(
      "event" in
        f.kernel.postWorkerMessage(first.execution, {
          basedOnRoomSeq: first.scope.toSeq,
          body: "old answer",
          idempotencyKey: "old-answer",
        }),
    );
    first.finish(0);
    f.kernel.roles.resetInstanceSession(f.actor, {
      instanceId: f.instance.instanceId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "legacy-reset",
    });
    // Historical resets did not opt into bounded recovery. No migration/backfill.
    f.db
      .prepare(
        "UPDATE room_events SET payload_json=json_remove(payload_json,'$.historyRecovery') WHERE type='instance.session_reset'",
      )
      .run();
    const next = startInstanceRun(f);
    const rendered = f.kernel.presentWorkerMessages(next.execution);
    assert.ok(
      !rendered.events.some((e) => e.roomSeq === first.scope.toSeq),
      "service upgrade must not replay the old request into an existing session",
    );
  } finally {
    f.close();
  }
});
