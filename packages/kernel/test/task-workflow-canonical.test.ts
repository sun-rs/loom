import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  ConflictError,
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

function startTask(fixture: ReturnType<typeof createTaskFixture>) {
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

test("Task workflow cannot display Done before canonical completion", () => {
  const fixture = createTaskFixture();
  try {
    assert.throws(
      () =>
        fixture.kernel.updateTaskWorkflowStatus(fixture.humanActor, {
          basedOnRoomSeq: fixture.created.event.roomSeq,
          idempotencyKey: "premature-done",
          taskId: fixture.created.task.taskId,
          workflowStatus: "done",
        }),
      ConflictError,
    );
    const [task] = fixture.kernel.listTasks(fixture.humanActor, {
      roomId: fixture.roomId,
    });
    assert.equal(task?.state, "todo");
    assert.equal(task?.workflowStatus, "todo");
    assert.equal(task?.completedAt, undefined);
  } finally {
    fixture.cleanup();
  }
});

test("a rejected board move cannot strand the running Worker", () => {
  const fixture = createTaskFixture();
  try {
    const { execution, started } = startTask(fixture);
    assert.throws(
      () =>
        fixture.kernel.updateTaskWorkflowStatus(fixture.humanActor, {
          basedOnRoomSeq: started.event.roomSeq,
          idempotencyKey: "premature-review",
          taskId: fixture.created.task.taskId,
          workflowStatus: "in_review",
        }),
      ConflictError,
    );
    const progress = fixture.kernel.progressTask(execution, {
      basedOnRoomSeq: started.event.roomSeq,
      idempotencyKey: "progress-after-rejected-move",
      leaseMs: 30_000,
      progress: "The canonical execution remains current",
      taskId: fixture.created.task.taskId,
    });
    assert.equal(progress.task.state, "in_progress");
    assert.equal(progress.task.workflowStatus, "in_progress");
  } finally {
    fixture.cleanup();
  }
});

test("Closed and reopened workflow actions use canonical lifecycle and exact idempotency", () => {
  const fixture = createTaskFixture();
  try {
    const closed = fixture.kernel.updateTaskWorkflowStatus(fixture.humanActor, {
      basedOnRoomSeq: fixture.created.event.roomSeq,
      idempotencyKey: "close-from-board",
      taskId: fixture.created.task.taskId,
      workflowStatus: "closed",
    });
    assert.equal(closed.event.type, "task.cancelled");
    assert.equal(closed.task.state, "cancelled");
    assert.equal(closed.task.workflowStatus, "closed");
    assert.throws(
      () =>
        fixture.kernel.updateTaskWorkflowStatus(fixture.humanActor, {
          basedOnRoomSeq: closed.event.roomSeq,
          idempotencyKey: "close-from-board",
          taskId: fixture.created.task.taskId,
          workflowStatus: "todo",
        }),
      IdempotencyConflictError,
    );
    const reopened = fixture.kernel.updateTaskWorkflowStatus(
      fixture.humanActor,
      {
        basedOnRoomSeq: closed.event.roomSeq,
        idempotencyKey: "reopen-from-board",
        taskId: fixture.created.task.taskId,
        workflowStatus: "todo",
      },
    );
    assert.equal(reopened.event.type, "task.reopened");
    assert.equal(reopened.task.state, "todo");
    assert.equal(reopened.task.workflowStatus, "todo");
  } finally {
    fixture.cleanup();
  }
});

test("a Human Room manager can apply the same canonical status action exposed by the Raft board", () => {
  const fixture = createTaskFixture();
  try {
    const closed = fixture.kernel.updateTaskWorkflowStatus(
      fixture.managerActor,
      {
        basedOnRoomSeq: fixture.created.event.roomSeq,
        idempotencyKey: "manager-close-from-board",
        taskId: fixture.created.task.taskId,
        workflowStatus: "closed",
      },
    );
    assert.equal(closed.event.type, "task.cancelled");
    assert.equal(closed.task.state, "cancelled");
  } finally {
    fixture.cleanup();
  }
});

test("Done workflow action completes only a frozen submitted Task", () => {
  const fixture = createTaskFixture();
  try {
    const { execution, started } = startTask(fixture);
    const submitted = fixture.kernel.submitTask(execution, {
      basedOnRoomSeq: started.event.roomSeq,
      idempotencyKey: "submit-task",
      summary: "Frozen delivery is ready for Human completion",
      taskId: fixture.created.task.taskId,
    });
    const done = fixture.kernel.updateTaskWorkflowStatus(fixture.humanActor, {
      basedOnRoomSeq: submitted.event.roomSeq,
      idempotencyKey: "complete-from-board",
      taskId: fixture.created.task.taskId,
      workflowStatus: "done",
    });
    assert.equal(done.event.type, "task.completed");
    assert.equal(done.task.state, "completed");
    assert.equal(done.task.workflowStatus, "done");
    assert.ok(done.task.completedAt);
  } finally {
    fixture.cleanup();
  }
});

test("schema migration repairs legacy Task workflow divergence and rejects new divergence", () => {
  const fixture = createTaskFixture();
  try {
    fixture.kernel.close();
    const legacyDatabase = new DatabaseSync(fixture.databasePath);
    legacyDatabase.exec(
      "DROP TRIGGER IF EXISTS trg_tasks_workflow_authority_v48",
    );
    legacyDatabase.exec("PRAGMA user_version = 47");
    legacyDatabase
      .prepare("UPDATE tasks SET workflow_status = 'done' WHERE task_id = ?")
      .run(fixture.created.task.taskId);
    legacyDatabase.close();

    const migratedKernel = new RoomKernel({
      databasePath: fixture.databasePath,
      now: () => new Date("2026-09-05T01:05:00.000Z"),
    });
    migratedKernel.initialize();
    const [task] = migratedKernel.listTasks(fixture.humanActor, {
      roomId: fixture.roomId,
    });
    assert.equal(task?.state, "todo");
    assert.equal(task?.workflowStatus, "todo");
    migratedKernel.close();

    const guardedDatabase = new DatabaseSync(fixture.databasePath);
    assert.throws(
      () =>
        guardedDatabase
          .prepare(
            "UPDATE tasks SET workflow_status = 'done' WHERE task_id = ?",
          )
          .run(fixture.created.task.taskId),
      /canonical Task state/,
    );
    guardedDatabase.close();
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});
