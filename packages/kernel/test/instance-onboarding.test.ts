import assert from "node:assert/strict";
import test from "node:test";
import "../src/index.ts";
import {
  roleInstanceFixture,
  startInstanceRunFromQueue,
} from "./role-instance-fixture.ts";

for (const privateFirst of [false, true]) {
  test(`ordinary onboarding is once per Channel, private session first=${privateFirst}`, () => {
    const f = roleInstanceFixture();
    try {
      const old = f.kernel.postMessage(f.actor, {
        roomId: f.home.roomId,
        body: "old decision",
        recipients: [],
        idempotencyKey: "old",
      }).event;
      const thread = f.kernel.createThread(f.actor, {
        roomId: f.home.roomId,
        rootMessageId: old.aggregateId,
        recipientIds: [],
        basedOnRoomSeq: f.head(f.home.roomId),
        idempotencyKey: "thread",
      }).thread;
      f.kernel.replyThread(f.actor, {
        roomId: f.home.roomId,
        threadId: thread.threadId,
        body: "unfollowed detail",
        recipientIds: [],
        basedOnRoomSeq: f.head(f.home.roomId),
        idempotencyKey: "reply",
      });
      const b = f.kernel.roles.instantiate(f.actor, {
        roleId: f.role.roleId,
        channelId: f.home.roomId,
        basedOnRoomSeq: f.head(f.home.roomId),
        idempotencyKey: "late",
      });
      const wake = (roomId: string, body: string) =>
        f.kernel.postMessage(f.actor, {
          roomId,
          body,
          recipients: [
            { participantId: b.instance.instanceId, reason: "mention" },
          ],
          idempotencyKey: body,
        });
      const start = () =>
        startInstanceRunFromQueue({ ...f, instance: b.instance });
      if (privateFirst) {
        const box = f.kernel.openDirectRoom(f.actor, {
          workspaceId: f.workspace.workspace.workspaceId,
          peerPrincipalId: b.instance.instanceId,
          basedOnControlRoomSeq: f.head(f.controlRoomId),
          idempotencyKey: "box",
        });
        wake(box.roomId, "private only");
        const run = start();
        assert.deepEqual(
          f.kernel
            .presentWorkerMessages(run.execution)
            .events.filter((e) => e.type === "message.posted")
            .map((e) => e.payload.body),
          ["private only"],
        );
        f.kernel.markPresentedDeliverySent(f.host, run.scope);
        f.kernel.instanceSessions.record(f.host, {
          runAttemptId: run.runtime.runAttemptId,
          runtimeRunId: run.runtime.runtimeRunId,
        });
        run.finish(0);
      }
      wake(f.home.roomId, "current request");
      const run = start();
      const first = f.kernel.presentWorkerMessages(run.execution);
      assert.deepEqual(
        first.events
          .filter((e) => e.type === "message.posted")
          .map((e) => e.payload.body),
        ["old decision", "current request"],
      );
      assert.deepEqual(
        first.directedSeqs,
        [run.activation.toSeq],
        "history is context, not a new request",
      );
      assert.equal(
        f.db
          .prepare(
            "SELECT count(*) n FROM worker_message_presentations WHERE participant_id=? AND room_id=?",
          )
          .get(b.instance.instanceId, f.home.roomId)!.n,
        0,
        "rendering alone is not reading",
      );
      f.kernel.markPresentedDeliverySent(f.host, run.scope);
      assert.equal(
        f.kernel.presentWorkerMessages(run.execution).contentDigest,
        first.contentDigest,
        "accepted rendering remains frozen",
      );
      f.kernel.postWorkerMessage(run.execution, {
        body: "done",
        basedOnRoomSeq: run.activation.toSeq,
        idempotencyKey: "done",
      });
      run.finish(0);
      wake(f.home.roomId, "next request");
      const next = start();
      assert.deepEqual(
        f.kernel
          .presentWorkerMessages(next.execution)
          .events.filter((e) => e.type === "message.posted")
          .map((e) => e.payload.body),
        ["next request"],
      );
    } finally {
      f.close();
    }
  });
}

for (const bound of [false, true]) {
  test(`failed first delivery retries pre-join context only without native binding: bound=${bound}`, () => {
    const f = roleInstanceFixture();
    try {
      f.kernel.postMessage(f.actor, {
        roomId: f.home.roomId,
        body: "older context",
        recipients: [],
        idempotencyKey: "older",
      });
      const b = f.kernel.roles.instantiate(f.actor, {
        roleId: f.role.roleId,
        channelId: f.home.roomId,
        basedOnRoomSeq: f.head(f.home.roomId),
        idempotencyKey: "late",
      });
      f.kernel.postMessage(f.actor, {
        roomId: f.home.roomId,
        body: "request",
        recipients: [
          { participantId: b.instance.instanceId, reason: "mention" },
        ],
        idempotencyKey: "request",
      });
      const run = startInstanceRunFromQueue({ ...f, instance: b.instance });
      f.kernel.presentWorkerMessages(run.execution);
      f.kernel.markPresentedDeliverySent(f.host, run.scope);
      if (bound)
        f.kernel.instanceSessions.record(f.host, {
          runAttemptId: run.runtime.runAttemptId,
          runtimeRunId: run.runtime.runtimeRunId,
        });
      f.kernel.recordRuntimeTermination(f.host, {
        runAttemptId: run.runtime.runAttemptId,
        runtimeRunId: run.runtime.runtimeRunId,
        exit: { code: 1 },
      });
      f.kernel.finishRunAttempt(f.host, {
        runAttemptId: run.runtime.runAttemptId,
        state: "failed",
        exitCode: 1,
      });
      f.kernel.retryActivation(f.host, {
        activationId: run.activation.activationId,
        error: "test failure",
        retryAfterMs: 0,
      });
      const retry = startInstanceRunFromQueue({ ...f, instance: b.instance });
      const texts = f.kernel
        .presentWorkerMessages(retry.execution)
        .events.filter((e) => e.type === "message.posted")
        .map((e) => e.payload.body);
      assert.deepEqual(
        texts,
        bound ? ["request"] : ["older context", "request"],
      );
    } finally {
      f.close();
    }
  });
}
