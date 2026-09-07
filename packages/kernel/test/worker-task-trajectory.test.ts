import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ForbiddenError, RoomKernel } from "../src/index.ts";

const TASK_CREATED_AT = "2026-09-05T01:00:00.000Z";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-worker-task-trajectory-"));
  let clock = new Date(TASK_CREATED_AT);
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now: () => clock,
  });
  kernel.initialize();
  const human = kernel.provisionPrincipal({
    handle: "trajectory-human",
    kind: "human",
  });
  const humanActor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(humanActor, {
    name: "Supervision visibility",
    slug: "supervision-visibility",
  });
  const agent = (handle: string) => {
    const provisioned = kernel.provisionPrincipal({ handle, kind: "agent" });
    kernel.addMember(humanActor, {
      principalId: provisioned.principal.principalId,
      roomId: room.roomId,
    });
    return provisioned.principal.principalId;
  };
  const ownerId = agent("trajectory-owner");
  const reviewerId = agent("trajectory-reviewer");
  const collaboratorId = agent("trajectory-collaborator");
  const outsiderId = agent("trajectory-outsider");
  const created = kernel.createTask(humanActor, {
    assigneeId: ownerId,
    collaboratorIds: [collaboratorId],
    dependencyTaskIds: [],
    idempotencyKey: "create-supervised-task",
    reviewerIds: [reviewerId],
    roomId: room.roomId,
    title: "Record supervised tool calls",
  });
  return {
    cleanup() {
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
    collaboratorId,
    created,
    humanActor,
    kernel,
    outsiderId,
    ownerId,
    reviewerId,
    roomId: room.roomId,
    setClock(iso: string) {
      clock = new Date(iso);
    },
  };
}

type Fixture = ReturnType<typeof fixture>;

function activate(state: Fixture, participantId: string, label: string) {
  const { kernel, roomId } = state;
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: `${label}-host`,
      participantIds: [participantId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 86_400_000 });
  assert.ok(activation, `${label} must have an Activation`);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    recoveryDescriptor: {
      driver: "fake-runtime",
      metadata: {},
      recoveryKey: `${label}-runtime`,
    },
    runAttemptId: run.runAttemptId,
    runtimeRunId: `${label}-runtime`,
  };
  kernel.prepareRunAttemptRuntime(host, runtime);
  kernel.markRunAttemptRunning(host, runtime);
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: `${label}-worker`,
    hostId: host.hostId,
    participantId,
    roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const delivery = kernel.syncWorker(execution, {});
  kernel.acknowledgeWorkerCursor(execution, {
    throughSeq: delivery.cursorAfter,
  });
  return { activation, execution, host, runtime, toSeq: activation.toSeq };
}

function appendEntry(
  state: Fixture,
  session: ReturnType<typeof activate>,
  producerSequence: number,
  entry: { kind: "tool_start"; toolInput?: string; toolName: string },
  observedAt: string,
) {
  return state.kernel.appendRunTrajectory(session.host, {
    entry,
    observedAt,
    producerSequence,
    runAttemptId: session.runtime.runAttemptId,
    runtimeRunId: session.runtime.runtimeRunId,
  });
}

test("a Task reviewer reads the owner's recorded tool calls newest first with bounded paging", () => {
  const state = fixture();
  try {
    const owner = activate(state, state.ownerId, "owner");
    const claimed = state.kernel.claimTask(owner.execution, {
      basedOnRoomSeq: owner.toSeq,
      idempotencyKey: "claim-supervised-task",
      leaseMs: 86_400_000,
      taskId: state.created.task.taskId,
    });
    const started = state.kernel.startTask(owner.execution, {
      basedOnRoomSeq: claimed.event.roomSeq,
      idempotencyKey: "start-supervised-task",
      leaseMs: 86_400_000,
      taskId: state.created.task.taskId,
    });

    state.setClock("2026-09-05T01:05:00.000Z");
    appendEntry(
      state,
      owner,
      1,
      { kind: "tool_start", toolInput: "npm test", toolName: "Bash" },
      "2026-09-05T01:05:00.000Z",
    );
    appendEntry(
      state,
      owner,
      2,
      { kind: "tool_start", toolInput: "src/index.ts", toolName: "Edit" },
      "2026-09-05T01:05:01.000Z",
    );
    appendEntry(
      state,
      owner,
      3,
      { kind: "tool_start", toolInput: "npm run typecheck", toolName: "Bash" },
      "2026-09-05T01:05:02.000Z",
    );

    state.kernel.submitTask(owner.execution, {
      basedOnRoomSeq: started.event.roomSeq,
      idempotencyKey: "submit-supervised-task",
      summary: "The commands and edits are recorded in the trajectory.",
      taskId: state.created.task.taskId,
    });

    const reviewer = activate(state, state.reviewerId, "reviewer");
    const page = state.kernel.listWorkerTaskTrajectory(reviewer.execution, {
      limit: 2,
      taskId: state.created.task.taskId,
    });
    assert.equal(page.taskId, state.created.task.taskId);
    assert.equal(page.ownerParticipantId, state.ownerId);
    assert.deepEqual(
      page.entries.map((record) =>
        record.entry.kind === "tool_start" ? record.entry.toolInput : undefined,
      ),
      ["npm run typecheck", "src/index.ts"],
      "the reviewer reads the owner's tool calls newest first",
    );
    assert.equal(page.nextBeforeSequence, page.entries.at(-1)?.serverSequence);

    const second = state.kernel.listWorkerTaskTrajectory(reviewer.execution, {
      beforeSequence: page.nextBeforeSequence!,
      limit: 2,
      taskId: state.created.task.taskId,
    });
    assert.deepEqual(
      second.entries.map((record) =>
        record.entry.kind === "tool_start" ? record.entry.toolInput : undefined,
      ),
      ["npm test"],
    );
    assert.equal(second.nextBeforeSequence, undefined);
  } finally {
    state.cleanup();
  }
});

test("Task trajectory excludes other participants and activity older than the Task", () => {
  const state = fixture();
  try {
    const owner = activate(state, state.ownerId, "owner");
    const claimed = state.kernel.claimTask(owner.execution, {
      basedOnRoomSeq: owner.toSeq,
      idempotencyKey: "claim-supervised-task",
      leaseMs: 86_400_000,
      taskId: state.created.task.taskId,
    });
    const started = state.kernel.startTask(owner.execution, {
      basedOnRoomSeq: claimed.event.roomSeq,
      idempotencyKey: "start-supervised-task",
      leaseMs: 86_400_000,
      taskId: state.created.task.taskId,
    });
    state.setClock("2026-09-05T01:05:00.000Z");
    appendEntry(
      state,
      owner,
      1,
      { kind: "tool_start", toolInput: "npm test", toolName: "Bash" },
      "2026-09-05T01:05:00.000Z",
    );
    state.setClock("2026-09-04T23:00:00.000Z");
    appendEntry(
      state,
      owner,
      2,
      { kind: "tool_start", toolInput: "older work", toolName: "Bash" },
      "2026-09-04T23:00:00.000Z",
    );
    state.setClock("2026-09-05T01:05:00.000Z");
    state.kernel.submitTask(owner.execution, {
      basedOnRoomSeq: started.event.roomSeq,
      idempotencyKey: "submit-supervised-task",
      summary: "The commands and edits are recorded in the trajectory.",
      taskId: state.created.task.taskId,
    });

    const reviewer = activate(state, state.reviewerId, "reviewer");
    appendEntry(
      state,
      reviewer,
      1,
      { kind: "tool_start", toolInput: "reviewer notes", toolName: "Read" },
      "2026-09-05T01:06:00.000Z",
    );
    const page = state.kernel.listWorkerTaskTrajectory(reviewer.execution, {
      limit: 50,
      taskId: state.created.task.taskId,
    });
    assert.deepEqual(
      page.entries.map((record) =>
        record.entry.kind === "tool_start" ? record.entry.toolInput : undefined,
      ),
      ["npm test"],
      "only the owner's activity recorded after the Task existed is visible",
    );
    for (const record of page.entries) {
      assert.equal(record.participantId, state.ownerId);
      assert.equal(record.roomId, state.roomId);
    }

    const collaborator = activate(state, state.collaboratorId, "collaborator");
    assert.equal(
      state.kernel.listWorkerTaskTrajectory(collaborator.execution, {
        limit: 50,
        taskId: state.created.task.taskId,
      }).entries.length,
      1,
      "a named collaborator shares the owner's supervision surface",
    );

    assert.equal(
      state.kernel.listWorkerTaskTrajectory(owner.execution, {
        limit: 50,
        taskId: state.created.task.taskId,
      }).entries.length,
      1,
      "the owner reads its own recorded trajectory",
    );
  } finally {
    state.cleanup();
  }
});

test("supervision visibility does not survive losing the Task role", () => {
  const state = fixture();
  try {
    const owner = activate(state, state.ownerId, "owner");
    const collaborator = activate(state, state.collaboratorId, "collaborator");
    const claimed = state.kernel.claimTask(owner.execution, {
      basedOnRoomSeq: owner.toSeq,
      idempotencyKey: "claim-supervised-task",
      leaseMs: 86_400_000,
      taskId: state.created.task.taskId,
    });
    const started = state.kernel.startTask(owner.execution, {
      basedOnRoomSeq: claimed.event.roomSeq,
      idempotencyKey: "start-supervised-task",
      leaseMs: 86_400_000,
      taskId: state.created.task.taskId,
    });
    state.setClock("2026-09-05T01:05:00.000Z");
    appendEntry(
      state,
      owner,
      1,
      { kind: "tool_start", toolInput: "npm test", toolName: "Bash" },
      "2026-09-05T01:05:00.000Z",
    );
    assert.equal(
      state.kernel.listWorkerTaskTrajectory(collaborator.execution, {
        limit: 50,
        taskId: state.created.task.taskId,
      }).entries.length,
      1,
    );
    state.kernel.releaseTask(owner.execution, {
      basedOnRoomSeq: started.event.roomSeq,
      idempotencyKey: "release-supervised-task",
      taskId: state.created.task.taskId,
    });
    assert.throws(
      () =>
        state.kernel.listWorkerTaskTrajectory(collaborator.execution, {
          limit: 50,
          taskId: state.created.task.taskId,
        }),
      (error: unknown) =>
        error instanceof ForbiddenError &&
        error.message.includes("is not an owner, collaborator, or reviewer"),
      "a released Task revokes the former collaborator's supervision surface",
    );
  } finally {
    state.cleanup();
  }
});

test("an Agent outside every Task role is never activated for that Task", () => {
  const state = fixture();
  try {
    const host = state.kernel.authenticateHostAccessToken(
      state.kernel.provisionHostCredential({
        hostId: "outsider-host",
        participantIds: [state.outsiderId],
      }).accessToken,
    );
    state.kernel.heartbeatHost(host);
    assert.equal(
      state.kernel.leaseNextActivation(host, { leaseMs: 86_400_000 }),
      null,
      "an Agent in no Task role receives no Activation, so it has no Worker scope at all",
    );
  } finally {
    state.cleanup();
  }
});
