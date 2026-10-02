import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach } from "node:test";

import {
  AuthenticatedHostContext,
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  RoomKernel,
} from "../src/index.ts";
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { force: true, recursive: true });
  }
});

function createClock(initial = "2026-08-25T00:00:00.000Z") {
  let now = new Date(initial).getTime();
  return {
    now: () => new Date(now),
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-kernel-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "room.db");
  const clock = createClock();
  const kernel = new RoomKernel({ databasePath, now: clock.now });
  kernel.initialize();

  const humanProvisioning = kernel.provisionPrincipal({
    handle: "sun",
    kind: "human",
  });
  const agentProvisioning = kernel.provisionPrincipal({
    handle: "codex",
    kind: "agent",
  });
  const otherAgentProvisioning = kernel.provisionPrincipal({
    handle: "opencode",
    kind: "agent",
  });
  const human = humanProvisioning.principal;
  const agent = agentProvisioning.principal;
  const otherAgent = otherAgentProvisioning.principal;
  const humanActor = kernel.authenticateAccessToken(
    humanProvisioning.accessToken,
  );
  const agentActor = kernel.authenticateAccessToken(
    agentProvisioning.accessToken,
  );
  const otherAgentActor = kernel.authenticateAccessToken(
    otherAgentProvisioning.accessToken,
  );
  const room = kernel.createRoom(humanActor, {
    name: "Kernel test",
    slug: "kernel-test",
  });
  kernel.addMember(humanActor, {
    principalId: agent.principalId,
    roomId: room.roomId,
  });
  kernel.addMember(humanActor, {
    principalId: otherAgent.principalId,
    roomId: room.roomId,
  });

  return {
    agent,
    agentActor,
    clock,
    databasePath,
    human,
    humanAccessToken: humanProvisioning.accessToken,
    humanActor,
    kernel,
    otherAgent,
    otherAgentActor,
    room,
  };
}

function authenticateHost(
  kernel: RoomKernel,
  hostId: string,
  participantIds: string[],
): AuthenticatedHostContext {
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({ hostId, participantIds }).accessToken,
  );
  kernel.heartbeatHost(host);
  return host;
}

function startWorkerExecution(
  kernel: RoomKernel,
  label: string,
  participantId: string,
  roomId: string,
) {
  const host = authenticateHost(kernel, `${label}-host`, [participantId]);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, host, {
    recoveryDescriptor: fakeRecovery(`${label}-runtime`),
    runAttemptId: run.runAttemptId,
    runtimeRunId: `${label}-runtime`,
  });
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: `${label}-consumer`,
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
  return { activation, execution, host };
}

function fakeRecovery(recoveryKey: string) {
  return {
    driver: "fake-runtime",
    metadata: {},
    recoveryKey,
  };
}

function prepareAndMarkRunAttemptRunning(
  kernel: RoomKernel,
  host: AuthenticatedHostContext,
  input: Parameters<RoomKernel["markRunAttemptRunning"]>[1],
): void {
  kernel.prepareRunAttemptRuntime(host, input);
  kernel.markRunAttemptRunning(host, input);
}

test("Task creation defaults to Human-only across Worker and access-token facades", () => {
  const f = createFixture();
  try {
    const message = f.kernel.postMessage(f.humanActor, {
      roomId: f.room.roomId,
      body: "查一下时间",
      idempotencyKey: "wake",
      recipients: [{ participantId: f.agent.principalId, reason: "mention" }],
    });
    const run = startWorkerExecution(
      f.kernel,
      "policy",
      f.agent.principalId,
      f.room.roomId,
    );
    const basis = run.activation.toSeq;
    assert.throws(
      () =>
        f.kernel.createWorkerTask(run.execution, {
          title: "time",
          basedOnRoomSeq: basis,
          idempotencyKey: "worker-create",
          leaseMs: 30000,
        }),
      /Human.*Task|Task.*Human/,
    );
    assert.throws(
      () =>
        f.kernel.claimMessageAsTask(run.execution, {
          messageId: message.event.aggregateId,
          rationale: "Human supposedly approved",
          basedOnRoomSeq: basis,
          idempotencyKey: "worker-convert",
          leaseMs: 30000,
        }),
      /Human.*Task|Task.*Human/,
    );
    assert.throws(
      () =>
        f.kernel.createTask(f.agentActor, {
          roomId: f.room.roomId,
          title: "bypass",
          basedOnRoomSeq: basis,
          idempotencyKey: "token-create",
        }),
      /Human.*Task|Task.*Human/,
    );
    assert.throws(
      () =>
        f.kernel.workerTaskManagement.convert(run.execution, {
          messageId: message.event.aggregateId,
          basedOnRoomSeq: basis,
          idempotencyKey: "convert-facade",
        }),
      /Human/,
    );
    assert.throws(
      () =>
        f.kernel.workerTaskManagement.batch(
          run.execution,
          "create",
          {
            titles: ["one", "two"],
            basedOnRoomSeq: basis,
            idempotencyKey: "batch-create",
          },
          30000,
        ),
      /Human/,
    );
    assert.equal(
      f.kernel.listTasks(f.humanActor, { roomId: f.room.roomId }).length,
      0,
    );
    const created = f.kernel.createTask(f.humanActor, {
      roomId: f.room.roomId,
      title: "Human work",
      basedOnRoomSeq: latest(f),
      idempotencyKey: "human-create",
    });
    assert.equal(created.task.title, "Human work");
  } finally {
    f.kernel.close();
  }
});

function latest(f: ReturnType<typeof createFixture>) {
  const db = new DatabaseSync(f.databasePath);
  try {
    return (
      Number(
        db
          .prepare("SELECT next_seq FROM rooms WHERE room_id=?")
          .get(f.room.roomId)!.next_seq,
      ) - 1
    );
  } finally {
    db.close();
  }
}

test("Human can enable autonomous creation and disable it without preventing existing Task execution", () => {
  const f = createFixture();
  try {
    const update = (allowInstanceTaskCreation: boolean, key: string) =>
      f.kernel.updateWorkspaceRoom(f.humanActor, {
        roomId: f.room.roomId,
        name: f.room.name,
        visibility: "private",
        allowInstanceTaskCreation,
        basedOnRoomSeq: latest(f),
        idempotencyKey: key,
      });
    assert.equal(update(true, "enable").room.allowInstanceTaskCreation, true);
    f.kernel.postMessage(f.humanActor, {
      roomId: f.room.roomId,
      body: "work",
      idempotencyKey: "wake",
      recipients: [{ participantId: f.agent.principalId, reason: "mention" }],
    });
    const run = startWorkerExecution(
      f.kernel,
      "enabled",
      f.agent.principalId,
      f.room.roomId,
    );
    const command = {
      title: "durable",
      assigneeId: f.agent.principalId,
      basedOnRoomSeq: run.activation.toSeq,
      leaseMs: 30000,
      idempotencyKey: "create",
    };
    const created = f.kernel.createWorkerTask(run.execution, command);
    assert.equal(created.task.state, "claimed");
    update(false, "disable");
    assert.equal(
      f.kernel.createWorkerTask(run.execution, command).deduplicated,
      true,
    );
    assert.throws(
      () =>
        f.kernel.createWorkerTask(run.execution, {
          ...command,
          idempotencyKey: "new",
        }),
      /Human/,
    );
    assert.equal(
      f.kernel.listTasks(f.humanActor, { roomId: f.room.roomId }).length,
      1,
    );
  } finally {
    f.kernel.close();
  }
});

test("with autonomous creation off an instance can claim a Human-created open Task", () => {
  const f = createFixture();
  try {
    const created = f.kernel.createTask(f.humanActor, {
      roomId: f.room.roomId,
      title: "Authorized",
      basedOnRoomSeq: latest(f),
      idempotencyKey: "human",
    });
    const run = startWorkerExecution(
      f.kernel,
      "human-task",
      f.agent.principalId,
      f.room.roomId,
    );
    const claimed = f.kernel.claimTask(run.execution, {
      taskId: created.task.taskId,
      basedOnRoomSeq: run.activation.toSeq,
      idempotencyKey: "claim",
      leaseMs: 30000,
    });
    assert.equal(claimed.task.assigneeId, f.agent.principalId);
    assert.equal(claimed.task.state, "claimed");
  } finally {
    f.kernel.close();
  }
});

test("schema 79 migration defaults existing Channels off and preserves existing Tasks", () => {
  const f = createFixture();
  const task = f.kernel.createTask(f.humanActor, {
    roomId: f.room.roomId,
    title: "preserved",
    basedOnRoomSeq: latest(f),
    idempotencyKey: "old-task",
  }).task;
  f.kernel.close();
  const db = new DatabaseSync(f.databasePath);
  db.exec(
    "ALTER TABLE rooms DROP COLUMN allow_instance_task_creation; PRAGMA user_version=79",
  );
  db.close();
  const upgraded = new RoomKernel({ databasePath: f.databasePath });
  try {
    upgraded.initialize();
    const read = new DatabaseSync(f.databasePath);
    try {
      assert.equal(
        read
          .prepare(
            "SELECT allow_instance_task_creation FROM rooms WHERE room_id=?",
          )
          .get(f.room.roomId)?.allow_instance_task_creation,
        0,
      );
      assert.equal(
        read.prepare("SELECT title FROM tasks WHERE task_id=?").get(task.taskId)
          ?.title,
        "preserved",
      );
      assert.equal(read.prepare("PRAGMA user_version").get()?.user_version, 81);
    } finally {
      read.close();
    }
  } finally {
    upgraded.close();
  }
});
