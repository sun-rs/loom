import assert from "node:assert/strict";
import test from "node:test";
import {
  roleInstanceFixture,
  startInstanceRun,
  startInstanceRunFromQueue,
} from "./role-instance-fixture.ts";

function createdInPriorTurn(f: ReturnType<typeof roleInstanceFixture>) {
  const policy = (enabled: boolean) =>
    f.kernel.updateWorkspaceRoom(f.actor, {
      roomId: f.home.roomId,
      name: f.home.name,
      visibility: "private",
      allowInstanceTaskCreation: enabled,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: `policy-${enabled}`,
    });
  policy(true);
  const first = startInstanceRun(f);
  const task = f.kernel.createWorkerTask(first.execution, {
    title: "Continue later",
    assigneeId: f.instance.instanceId,
    basedOnRoomSeq: first.activation.toSeq,
    leaseMs: 600000,
    idempotencyKey: "create-old-task",
  }).task;
  first.finish(0);
  policy(false);
  return task;
}

test("P91: an explicitly read owned Task continues across turns with creation disabled; channel chat does not finish it", () => {
  const f = roleInstanceFixture();
  try {
    const task = createdInPriorTurn(f);
    // An unrelated channel reply is not required to finish the outstanding Task.
    const chat = startInstanceRun(f);
    f.kernel.postWorkerMessage(chat.execution, {
      body: "I can also answer in the channel",
      basedOnRoomSeq: chat.activation.toSeq,
      idempotencyKey: "channel-reply",
    });
    chat.finish(0);
    assert.equal(
      f.kernel.listTasks(f.actor, { roomId: f.home.roomId })[0]?.state,
      "claimed",
    );
    const next = startInstanceRun(f);
    const start = {
      taskId: task.taskId,
      basedOnRoomSeq: next.activation.toSeq,
      leaseMs: 600000,
      idempotencyKey: "continue-start",
    };
    assert.throws(
      () => f.kernel.startTask(next.execution, start),
      /not linked/,
    );
    f.kernel.getWorkerTask(next.execution, { taskId: task.taskId });
    const started = f.kernel.startTask(next.execution, start);
    assert.equal(started.task.state, "in_progress");
    const progressed = f.kernel.progressTask(next.execution, {
      taskId: task.taskId,
      basedOnRoomSeq: started.event.roomSeq,
      leaseMs: 600000,
      idempotencyKey: "progress",
      progress: "verified",
    });
    const submitted = f.kernel.submitTask(next.execution, {
      taskId: task.taskId,
      basedOnRoomSeq: progressed.event.roomSeq,
      idempotencyKey: "submit",
      summary: "verified delivery",
    });
    assert.equal(submitted.task.state, "submitted");
    assert.equal(
      f.kernel.submitTask(next.execution, {
        taskId: task.taskId,
        basedOnRoomSeq: progressed.event.roomSeq,
        idempotencyKey: "submit",
        summary: "verified delivery",
      }).deduplicated,
      true,
    );
    next.finish(0);
    assert.equal(
      f.kernel.completeTask(f.actor, {
        taskId: task.taskId,
        basedOnRoomSeq: f.head(f.home.roomId),
        idempotencyKey: "accept",
      }).task.state,
      "completed",
    );
  } finally {
    f.close();
  }
});

test("P91: reading an old Task in the private box does not grant channel Task execution", () => {
  const f = roleInstanceFixture();
  try {
    const task = createdInPriorTurn(f);
    f.kernel.postMessage(f.actor, {
      roomId: f.privateBox.roomId,
      body: "private",
      idempotencyKey: "private-wake",
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
    });
    const work = startInstanceRunFromQueue(f);
    assert.equal(work.scope.roomId, f.privateBox.roomId);
    assert.throws(
      () => f.kernel.getWorkerTask(work.execution, { taskId: task.taskId }),
      /scope/,
    );
    assert.throws(
      () =>
        f.kernel.startTask(work.execution, {
          taskId: task.taskId,
          basedOnRoomSeq: work.activation.toSeq,
          leaseMs: 600000,
          idempotencyKey: "private-start",
        }),
      /scope/,
    );
  } finally {
    f.close();
  }
});

test("old Task reads preserve freshness fences", () => {
  const f = roleInstanceFixture();
  try {
    const task = createdInPriorTurn(f);
    const next = startInstanceRun(f);
    f.kernel.getWorkerTask(next.execution, { taskId: task.taskId });
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "New requirement before starting",
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
      idempotencyKey: "new-requirement",
    });
    assert.throws(
      () =>
        f.kernel.startTask(next.execution, {
          taskId: task.taskId,
          basedOnRoomSeq: next.activation.toSeq,
          leaseMs: 600000,
          idempotencyKey: "stale-start",
        }),
      { code: "stale_context" },
    );
    assert.equal(
      f.kernel.getWorkerTask(next.execution, { taskId: task.taskId }).state,
      "claimed",
    );
  } finally {
    f.close();
  }
});

test("Human converts a historical message; a fresh read permits claiming it in a later turn", () => {
  const f = roleInstanceFixture();
  try {
    const historical = f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "Review the old design",
      recipients: [],
      idempotencyKey: "old-message",
    });
    const task = f.kernel.createTask(f.actor, {
      roomId: f.home.roomId,
      sourceMessageId: historical.event.aggregateId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "convert-old",
    }).task;
    assert.equal(task.title, "Review the old design");
    assert.equal(task.sourceMessageId, historical.event.aggregateId);
    // First notification was read but left unclaimed. A later chat can pick it up.
    const first = startInstanceRun(f);
    f.kernel.getWorkerTask(first.execution, { taskId: task.taskId });
    first.finish(0);
    const next = startInstanceRun(f);
    const input = {
      taskId: task.taskId,
      basedOnRoomSeq: next.activation.toSeq,
      leaseMs: 600000,
      idempotencyKey: "claim-historical",
    };
    assert.throws(
      () => f.kernel.claimTask(next.execution, input),
      /not linked/,
    );
    f.kernel.getWorkerTask(next.execution, { taskId: task.taskId });
    assert.equal(
      f.kernel.claimTask(next.execution, input).task.assigneeId,
      f.instance.instanceId,
    );
  } finally {
    f.close();
  }
});

test("reading an old Task assigned to B does not let A claim it", () => {
  const f = roleInstanceFixture();
  try {
    const second = f.kernel.roles.instantiate(f.actor, {
      roleId: f.role.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "second",
    }).instance;
    const next = startInstanceRun(f);
    const task = f.kernel.createTask(f.actor, {
      roomId: f.home.roomId,
      title: "B's work",
      assigneeId: second.instanceId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "b-task",
    }).task;
    f.kernel.getWorkerTask(next.execution, { taskId: task.taskId });
    assert.throws(
      () =>
        f.kernel.claimTask(next.execution, {
          taskId: task.taskId,
          basedOnRoomSeq: next.activation.toSeq,
          leaseMs: 600000,
          idempotencyKey: "steal",
        }),
      /owned by another/,
    );
  } finally {
    f.close();
  }
});
