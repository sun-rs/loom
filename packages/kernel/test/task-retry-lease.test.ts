import assert from "node:assert/strict";
import test from "node:test";
import {
  roleInstanceFixture,
  startInstanceRun,
  startInstanceRunFromQueue,
} from "./role-instance-fixture.ts";
import { resolveWorkerTaskCommandCausality } from "../src/worker-task-command-identity.ts";

for (const elapsed of [100, 2000])
  test(`P94: replacement Run reacquires Task after ${elapsed}ms; transport retries remain exact`, () => {
    let now = Date.now();
    const f = roleInstanceFixture({ now: () => new Date(now) });
    try {
      const task = f.kernel.createTask(f.actor, {
        roomId: f.home.roomId,
        title: "Durable work",
        assigneeId: f.instance.instanceId,
        basedOnRoomSeq: f.head(f.home.roomId),
        idempotencyKey: "task",
      }).task;
      const first = startInstanceRun(f);
      const command = (scope: typeof first.scope, operation: string) => ({
        taskId: task.taskId,
        leaseMs: 1000,
        ...resolveWorkerTaskCommandCausality(f.db, scope, {
          operation,
          subjectId: task.taskId,
        }),
      });
      f.kernel.getWorkerTask(first.execution, { taskId: task.taskId });
      const oldClaim = command(first.scope, "task-claim");
      f.kernel.claimTask(first.execution, oldClaim);
      const oldStart = command(first.scope, "task-start");
      f.kernel.startTask(first.execution, oldStart);
      assert.throws(
        () =>
          f.kernel.claimTask(first.execution, {
            ...command(first.scope, "task-claim"),
            idempotencyKey: "different-key-same-run",
          }),
        /already has an active claim/,
      );
      f.kernel.recordRuntimeTermination(f.host, {
        runAttemptId: first.run.runAttemptId,
        runtimeRunId: first.runtime.runtimeRunId,
        exit: { code: 1 },
      });
      f.kernel.finishRunAttempt(f.host, {
        runAttemptId: first.run.runAttemptId,
        state: "failed",
        exitCode: 1,
      });
      f.kernel.retryActivation(f.host, {
        activationId: first.activation.activationId,
        error: "temporary failure",
        retryAfterMs: 0,
      });
      now += elapsed;
      const next = startInstanceRunFromQueue(f);
      assert.equal(next.activation.activationId, first.activation.activationId);
      f.kernel.getWorkerTask(next.execution, { taskId: task.taskId });
      // Explicit old receipts remain receipts, never implicit lease renewals.
      const replay = f.kernel.claimTask(next.execution, oldClaim);
      assert.equal(replay.deduplicated, true);
      const claim = command(next.scope, "task-claim");
      const renewed = f.kernel.claimTask(next.execution, claim);
      assert.equal(renewed.deduplicated, false);
      assert.ok(Date.parse(renewed.task.claimUntil!) > now);
      assert.equal(
        f.kernel.claimTask(next.execution, claim).deduplicated,
        true,
      );
      const start = command(next.scope, "task-start");
      assert.equal(
        f.kernel.startTask(next.execution, start).deduplicated,
        false,
      );
      assert.equal(
        f.kernel.startTask(next.execution, start).deduplicated,
        true,
      );
      assert.throws(() =>
        f.kernel.progressTask(first.execution, {
          ...command(first.scope, "task-progress"),
          progress: "old writer",
        }),
      );
      f.kernel.progressTask(next.execution, {
        ...command(next.scope, "task-progress"),
        progress: "verified",
      });
      const submit = {
        ...command(next.scope, "task-submit"),
        summary: "actual delivery",
      };
      assert.equal(
        f.kernel.submitTask(next.execution, submit).task.state,
        "submitted",
      );
      assert.equal(
        f.kernel.submitTask(next.execution, submit).deduplicated,
        true,
      );
      next.finish(0);
    } finally {
      f.close();
    }
  });

test("status in_progress renews an expired owned claim without changing durable ownership", () => {
  let now = Date.now();
  const f = roleInstanceFixture({ now: () => new Date(now) });
  try {
    const task = f.kernel.createTask(f.actor, {
      roomId: f.home.roomId,
      title: "Continue via status",
      assigneeId: f.instance.instanceId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "task",
    }).task;
    const first = startInstanceRun(f);
    f.kernel.getWorkerTask(first.execution, { taskId: task.taskId });
    f.kernel.workerTaskManagement.status(
      first.execution,
      f.kernel.workerTaskManagement.resolveStatus(first.execution, {
        taskId: task.taskId,
        status: "in_progress",
      }),
      1000,
    );
    f.kernel.recordRuntimeTermination(f.host, {
      runAttemptId: first.run.runAttemptId,
      runtimeRunId: first.runtime.runtimeRunId,
      exit: { code: 1 },
    });
    f.kernel.finishRunAttempt(f.host, {
      runAttemptId: first.run.runAttemptId,
      state: "failed",
      exitCode: 1,
    });
    f.kernel.retryActivation(f.host, {
      activationId: first.activation.activationId,
      error: "temporary failure",
      retryAfterMs: 0,
    });
    now += 2000;
    const next = startInstanceRunFromQueue(f);
    f.kernel.getWorkerTask(next.execution, { taskId: task.taskId });
    const renewed = f.kernel.workerTaskManagement.status(
      next.execution,
      f.kernel.workerTaskManagement.resolveStatus(next.execution, {
        taskId: task.taskId,
        status: "in_progress",
      }),
      1000,
    );
    assert.ok(Date.parse(renewed.task.claimUntil!) > now);
    assert.equal(renewed.task.assigneeId, f.instance.instanceId);
    const seq = f.head(f.home.roomId);
    assert.equal(
      f.kernel.workerTaskManagement.status(
        next.execution,
        f.kernel.workerTaskManagement.resolveStatus(next.execution, {
          taskId: task.taskId,
          status: "in_progress",
        }),
        1000,
      ).deduplicated,
      true,
    );
    assert.equal(f.head(f.home.roomId), seq);
  } finally {
    f.close();
  }
});

test("batch claim uses a fresh acquisition identity on replacement Run, retaining its retry receipt", () => {
  let now = Date.now();
  const f = roleInstanceFixture({ now: () => new Date(now) });
  try {
    const task = f.kernel.createTask(f.actor, {
      roomId: f.home.roomId,
      title: "Batch resume",
      assigneeId: f.instance.instanceId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "task",
    }).task;
    const first = startInstanceRun(f);
    f.kernel.getWorkerTask(first.execution, { taskId: task.taskId });
    const input = { taskIds: [task.taskId] };
    const original = f.kernel.workerTaskManagement.batch(
      first.execution,
      "claim",
      input,
      1000,
    );
    assert.equal(original.response.results[0]?.success, true);
    f.kernel.recordRuntimeTermination(f.host, {
      runAttemptId: first.run.runAttemptId,
      runtimeRunId: first.runtime.runtimeRunId,
      exit: { code: 1 },
    });
    f.kernel.finishRunAttempt(f.host, {
      runAttemptId: first.run.runAttemptId,
      state: "failed",
      exitCode: 1,
    });
    f.kernel.retryActivation(f.host, {
      activationId: first.activation.activationId,
      error: "temporary failure",
      retryAfterMs: 0,
    });
    now += 2000;
    const next = startInstanceRunFromQueue(f);
    f.kernel.getWorkerTask(next.execution, { taskId: task.taskId });
    const renewed = f.kernel.workerTaskManagement.batch(
      next.execution,
      "claim",
      input,
      1000,
    );
    assert.equal(renewed.response.deduplicated, false);
    assert.equal(renewed.response.results[0]?.success, true);
    assert.ok(Date.parse(renewed.response.results[0]!.claimUntil!) > now);
    const head = f.head(f.home.roomId);
    assert.equal(
      f.kernel.workerTaskManagement.batch(next.execution, "claim", input, 1000)
        .response.deduplicated,
      true,
    );
    assert.equal(f.head(f.home.roomId), head);
  } finally {
    f.close();
  }
});
