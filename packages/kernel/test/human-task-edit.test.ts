import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  ConflictError,
  ExecutionFencedError,
  IdempotencyConflictError,
  RoomKernel,
} from "../src/index.ts";

function createTaskFixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-task-workflow-owner-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({
    databasePath,
    now: () => new Date("2026-09-05T01:00:00.000Z"),
  });
  kernel.initialize();
  const human = kernel.provisionPrincipal({
    handle: "workflow-human",
    kind: "human",
  });
  const agent = kernel.provisionPrincipal({
    handle: "workflow-agent",
    kind: "agent",
  });
  const manager = kernel.provisionPrincipal({
    handle: "workflow-manager",
    kind: "human",
  });
  const humanActor = kernel.authenticateAccessToken(human.accessToken);
  const managerActor = kernel.authenticateAccessToken(manager.accessToken);
  const room = kernel.createRoom(humanActor, {
    name: "Task workflow owner",
    slug: "task-workflow-owner",
  });
  kernel.addMember(humanActor, {
    principalId: agent.principal.principalId,
    roomId: room.roomId,
  });
  kernel.addMember(humanActor, {
    principalId: manager.principal.principalId,
    roomId: room.roomId,
  });
  const latestRoomSeq = kernel.sync(humanActor, {
    consumerId: "workflow-fixture-role",
    roomId: room.roomId,
  }).latestRoomSeq;
  kernel.setRoomMemberRole(humanActor, {
    basedOnRoomSeq: latestRoomSeq,
    idempotencyKey: "promote-workflow-manager",
    principalId: manager.principal.principalId,
    role: "admin",
    roomId: room.roomId,
  });
  const created = kernel.createTask(humanActor, {
    assigneeId: agent.principal.principalId,
    idempotencyKey: "create-task",
    roomId: room.roomId,
    title: "Keep one Task business truth",
  });
  return {
    agentId: agent.principal.principalId,
    cleanup() {
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
    created,
    databasePath,
    directory,
    humanActor,
    kernel,
    managerActor,
    roomId: room.roomId,
  };
}

function startTask(
  fixture: ReturnType<typeof createTaskFixture>,
  viaStatus = false,
) {
  const { agentId, created, kernel, roomId } = fixture;
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "workflow-host",
      participantIds: [agentId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    recoveryDescriptor: {
      driver: "fake-runtime",
      metadata: {},
      recoveryKey: "workflow-runtime",
    },
    runAttemptId: run.runAttemptId,
    runtimeRunId: "workflow-runtime",
  };
  kernel.prepareRunAttemptRuntime(host, runtime);
  kernel.markRunAttemptRunning(host, runtime);
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: "workflow-worker",
    hostId: host.hostId,
    participantId: agentId,
    roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const delivery = kernel.syncWorker(execution, {});
  kernel.acknowledgeWorkerCursor(execution, {
    throughSeq: delivery.cursorAfter,
  });
  if (viaStatus)
    return {
      execution,
      started: kernel.workerTaskManagement.status(
        execution,
        {
          taskId: created.task.taskId,
          basedOnRoomSeq: activation.toSeq,
          idempotencyKey: "worker-start-manual",
          status: "in_progress",
        },
        30000,
      ),
    };
  const claimed = kernel.claimTask(execution, {
    basedOnRoomSeq: activation.toSeq,
    idempotencyKey: "claim-task",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const started = kernel.startTask(execution, {
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: "start-task",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  return { execution, started };
}

test("Human manager can move between all five statuses without inventing Runtime or submission evidence", () => {
  const f = createTaskFixture();
  try {
    let task = f.created.task;
    const statuses = [
      "todo",
      "in_progress",
      "in_review",
      "done",
      "closed",
    ] as const;
    for (const from of statuses)
      for (const to of statuses) {
        for (const status of [from, to]) {
          const seq = f.kernel.sync(f.humanActor, {
            roomId: f.roomId,
            consumerId: "edit-test",
          }).latestRoomSeq;
          const r = f.kernel.updateTaskWorkflowStatus(f.humanActor, {
            taskId: task.taskId,
            basedOnRoomSeq: seq,
            idempotencyKey: `${from}-${to}-${status}-${seq}`,
            workflowStatus: status,
          });
          task = r.task;
          assert.equal(task.workflowStatus, status);
          assert.equal(task.claimedBy, undefined);
          assert.equal(task.submissionSummary, undefined);
        }
      }
  } finally {
    f.cleanup();
  }
});
test("Human can assign in non-done states; done rejects assignment and unassignment without events", () => {
  const f = createTaskFixture();
  try {
    for (const status of [
      "todo",
      "in_progress",
      "in_review",
      "done",
      "closed",
    ] as const) {
      const seq = () =>
        f.kernel.sync(f.humanActor, {
          roomId: f.roomId,
          consumerId: "assign-test",
        }).latestRoomSeq;
      const taskId = f.created.task.taskId;
      f.kernel.updateTaskWorkflowStatus(f.humanActor, {
        taskId,
        basedOnRoomSeq: seq(),
        idempotencyKey: `status-${status}`,
        workflowStatus: status,
      });
      if (status === "done") {
        const before = seq();
        for (const assigneeId of [f.created.task.creatorId, f.agentId]) {
          assert.throws(
            () =>
              f.kernel.assignTask(f.managerActor, {
                taskId,
                basedOnRoomSeq: seq(),
                idempotencyKey: `done-assign-${assigneeId}`,
                assigneeId,
              }),
            /reopen/i,
          );
        }
        assert.throws(
          () =>
            f.kernel.unassignTask(f.managerActor, {
              taskId,
              basedOnRoomSeq: seq(),
              idempotencyKey: "done-unassign",
            }),
          /reopen/i,
        );
        assert.equal(seq(), before);
        continue;
      }
      for (const assigneeId of [f.created.task.creatorId, f.agentId]) {
        const r = f.kernel.assignTask(f.managerActor, {
          taskId,
          basedOnRoomSeq: seq(),
          idempotencyKey: `assign-${status}-${assigneeId}`,
          assigneeId,
        });
        assert.equal(r.task.assigneeId, assigneeId);
        assert.equal(r.task.workflowStatus, status);
      }
      const r = f.kernel.unassignTask(f.managerActor, {
        taskId,
        basedOnRoomSeq: seq(),
        idempotencyKey: `unassign-${status}`,
      });
      assert.equal(r.task.assigneeId, undefined);
      assert.equal(r.task.workflowStatus, status);
    }
  } finally {
    f.cleanup();
  }
});

test("Human editing fences the old Worker and retains durable stop proof across repeated edits", () => {
  const f = createTaskFixture();
  try {
    const { execution, started } = startTask(f);
    const taskId = f.created.task.taskId;
    const edited = f.kernel.updateTaskWorkflowStatus(f.humanActor, {
      taskId,
      basedOnRoomSeq: started.event.roomSeq,
      idempotencyKey: "human-review",
      workflowStatus: "in_review",
    });
    assert.equal(edited.task.state, "submitted");
    assert.equal(edited.task.claimedBy, undefined);
    assert.throws(() =>
      f.kernel.progressTask(execution, {
        taskId,
        basedOnRoomSeq: started.event.roomSeq,
        idempotencyKey: "old-progress",
        leaseMs: 30000,
        progress: "must not overwrite Human",
      }),
    );
    const reopened = f.kernel.updateTaskWorkflowStatus(f.humanActor, {
      taskId,
      basedOnRoomSeq: edited.event.roomSeq,
      idempotencyKey: "human-todo",
      workflowStatus: "todo",
    });
    assert.equal(reopened.task.state, "todo");
    assert.throws(
      () =>
        f.kernel.claimTask(execution, {
          taskId,
          basedOnRoomSeq: reopened.event.roomSeq,
          idempotencyKey: "old-claim",
          leaseMs: 30000,
        }),
      ExecutionFencedError,
    );
    const db = new DatabaseSync(f.databasePath);
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM activation_cancellation_requests WHERE task_id=? AND resolved_at IS NULL",
        )
        .get(taskId)?.n,
      1,
    );
    assert.equal(
      db.prepare("SELECT state FROM run_attempts LIMIT 1").get()?.state,
      "running",
    );
    db.close();
  } finally {
    f.cleanup();
  }
});
test("Human edits replay exactly and reject conflicting retries and stale cards", () => {
  const f = createTaskFixture();
  try {
    const input = {
      taskId: f.created.task.taskId,
      basedOnRoomSeq: f.created.event.roomSeq,
      idempotencyKey: "edit-once",
      workflowStatus: "done" as const,
    };
    const r = f.kernel.updateTaskWorkflowStatus(f.humanActor, input);
    assert.equal(
      f.kernel.updateTaskWorkflowStatus(f.humanActor, input).event.eventId,
      r.event.eventId,
    );
    assert.throws(
      () =>
        f.kernel.updateTaskWorkflowStatus(f.humanActor, {
          ...input,
          workflowStatus: "todo",
        }),
      IdempotencyConflictError,
    );
    assert.throws(
      () =>
        f.kernel.assignTask(f.humanActor, {
          taskId: input.taskId,
          basedOnRoomSeq: input.basedOnRoomSeq,
          idempotencyKey: "stale-assign",
          assigneeId: f.agentId,
        }),
      /stale/i,
    );
  } finally {
    f.cleanup();
  }
});

test("Worker can acquire a real claim after Human marks an idle Task in progress", () => {
  const f = createTaskFixture();
  try {
    const edited = f.kernel.updateTaskWorkflowStatus(f.humanActor, {
      taskId: f.created.task.taskId,
      basedOnRoomSeq: f.created.event.roomSeq,
      idempotencyKey: "manual-progress",
      workflowStatus: "in_progress",
    });
    assert.equal(edited.task.claimedBy, undefined);
    const { started } = startTask(f, true);
    assert.equal(started.task.claimedBy, f.agentId);
    assert.ok(started.task.claimUntil);
    assert.equal(started.event.type, "task.started");
  } finally {
    f.cleanup();
  }
});

test("Raft todo-to-progress on an unassigned Task takes Human responsibility without a Runtime lease", () => {
  const f = createTaskFixture();
  try {
    const cleared = f.kernel.unassignTask(f.humanActor, {
      taskId: f.created.task.taskId,
      basedOnRoomSeq: f.created.event.roomSeq,
      idempotencyKey: "unassigned-start",
    });
    const r = f.kernel.updateTaskWorkflowStatus(f.humanActor, {
      taskId: cleared.task.taskId,
      basedOnRoomSeq: cleared.event.roomSeq,
      idempotencyKey: "human-start",
      workflowStatus: "in_progress",
    });
    assert.equal(r.task.assigneeId, f.created.task.creatorId);
    assert.equal(r.task.claimedBy, undefined);
  } finally {
    f.cleanup();
  }
});

test("Human reopening a completed task changes status without waking Agents", () => {
  const f = createTaskFixture();
  const db = new DatabaseSync(f.databasePath);
  try {
    const seq = () =>
      f.kernel.sync(f.humanActor, {
        roomId: f.roomId,
        consumerId: "reopen-read",
      }).latestRoomSeq;
    f.kernel.updateTaskWorkflowStatus(f.humanActor, {
      taskId: f.created.task.taskId,
      basedOnRoomSeq: seq(),
      idempotencyKey: "complete-before-reopen",
      workflowStatus: "done",
    });
    const before = db.prepare("SELECT count(*) AS n FROM activations").get()!.n;
    const result = f.kernel.updateTaskWorkflowStatus(f.humanActor, {
      taskId: f.created.task.taskId,
      basedOnRoomSeq: seq(),
      idempotencyKey: "quiet-reopen",
      workflowStatus: "todo",
    });
    assert.equal(result.task.workflowStatus, "todo");
    assert.deepEqual(result.activationIds, []);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM activations").get()!.n,
      before,
    );
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM inbox_items WHERE event_id=?")
        .get(result.event.eventId)!.n,
      0,
    );
  } finally {
    db.close();
    f.cleanup();
  }
});
