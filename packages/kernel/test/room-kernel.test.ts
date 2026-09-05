import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach } from "node:test";

import {
  ActivationCancellationRequestedError,
  AuthenticatedHostContext,
  ConflictError,
  ExecutionFencedError,
  ForbiddenError,
  IdempotencyConflictError,
  KERNEL_SCHEMA_VERSION,
  LeaseConflictError,
  RoomKernel,
  StaleContextError,
  TaskSubmissionProofError,
  UnauthenticatedError,
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

test("message mutation atomically derives event, Inbox, Activation, and content-free Outbox", () => {
  const { agent, agentActor, humanActor, kernel, room } = createFixture();

  const result = kernel.postMessage(humanActor, {
    body: "Please inspect task #1",
    idempotencyKey: "user-message-1",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });

  assert.equal(result.deduplicated, false);
  assert.equal(result.event.type, "message.posted");

  const inbox = kernel.listInbox(agentActor, {
    roomId: room.roomId,
  });
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0]?.eventId, result.event.eventId);
  assert.equal(inbox[0]?.state, "pending");

  const activations = kernel.listActivations({
    participantId: agent.principalId,
    roomId: room.roomId,
  });
  assert.equal(activations.length, 1);
  assert.equal(activations[0]?.fromSeq, result.event.roomSeq);
  assert.equal(activations[0]?.toSeq, result.event.roomSeq);
  assert.equal(activations[0]?.state, "queued");

  const outbox = kernel.listOutbox();
  const wake = outbox.at(-1);
  assert.equal(wake?.topic, "activation.requested");
  assert.equal(wake?.payload.activationId, activations[0]?.activationId);
  assert.equal("body" in (wake?.payload ?? {}), false);

  kernel.close();
});

test("Task status menu cannot replace canonical execution and submission commands", () => {
  const { agent, humanActor, kernel, room } = createFixture();
  const created = kernel.createTask(humanActor, {
    assigneeId: agent.principalId,
    idempotencyKey: "workflow-created",
    roomId: room.roomId,
    title: "Move through the Raft board",
  });
  const activationsBefore = kernel.listActivations({
    participantId: agent.principalId,
    roomId: room.roomId,
  }).length;

  for (const workflowStatus of ["in_progress", "in_review", "done"] as const) {
    assert.throws(
      () =>
        kernel.updateTaskWorkflowStatus(humanActor, {
          basedOnRoomSeq: created.event.roomSeq,
          idempotencyKey: `workflow-${workflowStatus}`,
          taskId: created.task.taskId,
          workflowStatus,
        }),
      ConflictError,
    );
  }
  const [task] = kernel.listTasks(humanActor, { roomId: room.roomId });
  assert.equal(task?.state, "todo");
  assert.equal(task?.workflowStatus, "todo");
  assert.equal(
    kernel.listActivations({
      participantId: agent.principalId,
      roomId: room.roomId,
    }).length,
    activationsBefore,
  );

  kernel.close();
});

test("ordinary Task editors cannot use the board to bypass Task ownership", () => {
  const { agentActor, humanActor, kernel, room } = createFixture();
  const created = kernel.createTask(humanActor, {
    idempotencyKey: "ordinary-workflow-created",
    roomId: room.roomId,
    title: "Respect ordinary Raft transitions",
  });
  assert.throws(
    () =>
      kernel.updateTaskWorkflowStatus(agentActor, {
        basedOnRoomSeq: created.event.roomSeq,
        idempotencyKey: "ordinary-workflow-progress",
        taskId: created.task.taskId,
        workflowStatus: "in_progress",
      }),
    ForbiddenError,
  );
  assert.throws(
    () =>
      kernel.updateTaskWorkflowStatus(agentActor, {
        basedOnRoomSeq: created.event.roomSeq,
        idempotencyKey: "ordinary-workflow-close",
        taskId: created.task.taskId,
        workflowStatus: "closed",
      }),
    ForbiddenError,
  );

  kernel.close();
});

test("a Human Room message wakes every joined Agent by membership", () => {
  const { agent, humanActor, kernel, otherAgent, room } = createFixture();

  const result = kernel.postRoomMessage(humanActor, {
    body: "Everyone in this Room should receive the message",
    idempotencyKey: "room-membership-delivery",
    recipients: [],
    roomId: room.roomId,
  });

  assert.equal(result.activationIds.length, 2);
  assert.deepEqual(
    kernel
      .listActivations({ roomId: room.roomId })
      .map(({ participantId, reason }) => ({ participantId, reason }))
      .sort((left, right) =>
        left.participantId.localeCompare(right.participantId),
      ),
    [
      { participantId: agent.principalId, reason: "room_policy" },
      { participantId: otherAgent.principalId, reason: "room_policy" },
    ].sort((left, right) =>
      left.participantId.localeCompare(right.participantId),
    ),
  );

  kernel.close();
});

test("a Human mention raises one Room Agent attention without filtering delivery", () => {
  const { agent, humanActor, kernel, otherAgent, room } = createFixture();

  const result = kernel.postRoomMessage(humanActor, {
    body: "@codex please lead; opencode should still receive the Room message",
    idempotencyKey: "room-mention-attention",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });

  assert.equal(result.activationIds.length, 2);
  assert.deepEqual(
    kernel
      .listActivations({ roomId: room.roomId })
      .map(({ participantId, reason }) => ({ participantId, reason }))
      .sort((left, right) =>
        left.participantId.localeCompare(right.participantId),
      ),
    [
      { participantId: agent.principalId, reason: "mention" },
      { participantId: otherAgent.principalId, reason: "room_policy" },
    ].sort((left, right) =>
      left.participantId.localeCompare(right.participantId),
    ),
  );

  kernel.close();
});

test("Room Agent activity exposes idle, waking, working, and error without provider output", () => {
  const { agent, humanActor, kernel, otherAgent, room } = createFixture();
  assert.deepEqual(
    kernel
      .listRoomAgentActivity(humanActor, { roomId: room.roomId })
      .map(({ participantId, state }) => ({ participantId, state })),
    [
      { participantId: agent.principalId, state: "idle" },
      { participantId: otherAgent.principalId, state: "idle" },
    ].sort((left, right) =>
      left.participantId.localeCompare(right.participantId),
    ),
  );

  kernel.postRoomMessage(humanActor, {
    body: "Wake the Room",
    idempotencyKey: "activity-wake-room",
    recipients: [],
    roomId: room.roomId,
  });
  assert.deepEqual(
    kernel
      .listRoomAgentActivity(humanActor, { roomId: room.roomId })
      .map(({ state }) => state),
    ["waking", "waking"],
  );

  const host = authenticateHost(kernel, "activity-host", [
    agent.principalId,
    otherAgent.principalId,
  ]);
  const leased = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(leased);
  assert.equal(
    kernel
      .listRoomAgentActivity(humanActor, { roomId: room.roomId })
      .find(({ participantId }) => participantId === leased.participantId)
      ?.state,
    "working",
  );
  kernel.quarantineActivation(host, {
    activationId: leased.activationId,
    error: "runtime reply was not proven",
  });
  const failed = kernel
    .listRoomAgentActivity(humanActor, { roomId: room.roomId })
    .find(({ participantId }) => participantId === leased.participantId);
  assert.equal(failed?.state, "error");
  assert.equal(failed?.lastError, "runtime reply was not proven");

  kernel.close();
});

test("idempotent retry does not duplicate any derived state", () => {
  const { agent, agentActor, humanActor, kernel, room } = createFixture();
  const command = {
    body: "Run the checks",
    idempotencyKey: "stable-command-id",
    recipients: [
      { participantId: agent.principalId, reason: "task_assigned" as const },
    ],
    roomId: room.roomId,
  };

  const first = kernel.postMessage(humanActor, command);
  const second = kernel.postMessage(humanActor, command);

  assert.equal(second.deduplicated, true);
  assert.equal(second.event.eventId, first.event.eventId);
  assert.equal(
    kernel.listInbox(agentActor, {
      roomId: room.roomId,
    }).length,
    1,
  );
  assert.equal(
    kernel.listActivations({
      participantId: agent.principalId,
      roomId: room.roomId,
    }).length,
    1,
  );
  assert.equal(
    kernel
      .listOutbox()
      .filter((entry) => entry.topic === "activation.requested").length,
    1,
  );

  kernel.close();
});

test("an idempotency key cannot be reused with different recipients", () => {
  const { agent, humanActor, kernel, otherAgent, otherAgentActor, room } =
    createFixture();

  kernel.postMessage(humanActor, {
    body: "Inspect this",
    idempotencyKey: "recipient-sensitive-key",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });

  assert.throws(
    () =>
      kernel.postMessage(humanActor, {
        body: "Inspect this",
        idempotencyKey: "recipient-sensitive-key",
        recipients: [
          { participantId: otherAgent.principalId, reason: "mention" },
        ],
        roomId: room.roomId,
      }),
    IdempotencyConflictError,
  );
  assert.equal(
    kernel.listInbox(otherAgentActor, {
      roomId: room.roomId,
    }).length,
    0,
  );

  kernel.close();
});

test("a non-member cannot post or create partial derived state", () => {
  const { agent, agentActor, kernel, room } = createFixture();
  const outsiderProvisioning = kernel.provisionPrincipal({
    handle: "outsider",
    kind: "human",
  });
  const outsiderActor = kernel.authenticateAccessToken(
    outsiderProvisioning.accessToken,
  );

  assert.throws(
    () =>
      kernel.postMessage(outsiderActor, {
        body: "I should not enter this room",
        idempotencyKey: "outsider-message",
        recipients: [{ participantId: agent.principalId, reason: "mention" }],
        roomId: room.roomId,
      }),
    ForbiddenError,
  );
  assert.equal(
    kernel.listInbox(agentActor, {
      roomId: room.roomId,
    }).length,
    0,
  );

  kernel.close();
});

test("host authority comes only from an authenticated scoped context", () => {
  const { agent, humanActor, kernel, otherAgent, room } = createFixture();
  kernel.postMessage(humanActor, {
    body: "Only the assigned Host may lease this Activation",
    idempotencyKey: "host-authentication-message",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });

  const provisioning = kernel.provisionHostCredential({
    hostId: "authenticated-host",
    participantIds: [agent.principalId],
  });
  const host = kernel.authenticateHostAccessToken(provisioning.accessToken);
  const otherHost = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "other-host",
      participantIds: [otherAgent.principalId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  kernel.heartbeatHost(otherHost);

  assert.throws(
    () =>
      new AuthenticatedHostContext(
        "authenticated-host",
        [agent.principalId],
        "forged-credential",
        "forged-instance",
      ),
    /cannot be forged/,
  );
  assert.equal(
    kernel.leaseNextActivation(otherHost, { leaseMs: 1_000 }),
    null,
    "a Host credential cannot lease another participant's lane",
  );
  const activation = kernel.leaseNextActivation(host, { leaseMs: 1_000 });
  assert.equal(activation?.participantId, agent.principalId);
  assert.equal(activation?.leaseOwner, "authenticated-host");
  kernel.revokeHostCredential(provisioning.credentialId);
  assert.equal(kernel.listHosts()[0]?.state, "offline");
  assert.throws(
    () => kernel.heartbeatHost(host),
    UnauthenticatedError,
    "revocation fences an already issued context",
  );
  assert.throws(
    () => kernel.authenticateHostAccessToken(provisioning.accessToken),
    UnauthenticatedError,
    "revocation fences future authentication",
  );

  kernel.close();
});

test("revoking an old Host credential does not mark a rotated live Host offline", () => {
  const { agent, kernel } = createFixture();
  const oldCredential = kernel.provisionHostCredential({
    hostId: "rotated-host",
    participantIds: [agent.principalId],
  });
  const currentCredential = kernel.provisionHostCredential({
    hostId: "rotated-host",
    participantIds: [agent.principalId],
  });
  const currentHost = kernel.authenticateHostAccessToken(
    currentCredential.accessToken,
  );
  kernel.heartbeatHost(currentHost);

  kernel.revokeHostCredential(oldCredential.credentialId);
  assert.equal(kernel.listHosts()[0]?.state, "online");
  kernel.revokeHostCredential(currentCredential.credentialId);
  assert.equal(kernel.listHosts()[0]?.state, "offline");

  kernel.close();
});

test("a newer daemon instance fences an older context for the same Host credential", () => {
  const { agent, clock, humanActor, kernel, room } = createFixture();
  kernel.postMessage(humanActor, {
    body: "Fence the previous daemon generation",
    idempotencyKey: "host-instance-fencing-message",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });
  const credential = kernel.provisionHostCredential({
    hostId: "generation-host",
    participantIds: [agent.principalId],
  });
  const first = kernel.authenticateHostAccessToken(credential.accessToken);
  const replacement = kernel.authenticateHostAccessToken(
    credential.accessToken,
  );
  assert.notEqual(first.instanceId, replacement.instanceId);
  assert.equal(kernel.heartbeatHost(first).instanceId, first.instanceId);
  assert.throws(() => kernel.heartbeatHost(replacement), ConflictError);

  clock.advance(1_001);
  assert.equal(
    kernel.heartbeatHost(replacement, { takeoverAfterMs: 1_000 }).instanceId,
    replacement.instanceId,
  );
  assert.throws(
    () => kernel.leaseNextActivation(first, { leaseMs: 1_000 }),
    UnauthenticatedError,
  );
  assert.ok(kernel.leaseNextActivation(replacement, { leaseMs: 1_000 }));

  kernel.close();
});

test("initialization migrates legacy Host heartbeat rows to credential-bound offline state", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-host-migration-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "room.db");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE agent_hosts (
      host_id TEXT PRIMARY KEY,
      participant_ids_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('online', 'draining', 'offline')),
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_seen_ms INTEGER NOT NULL
    ) STRICT;
    INSERT INTO agent_hosts VALUES(
      'legacy-host',
      '["legacy-participant"]',
      'online',
      '2026-08-24T00:00:00.000Z',
      '2026-08-24T00:00:00.000Z',
      1787529600000
    );
  `);
  legacy.close();

  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  assert.equal(kernel.listHosts()[0]?.state, "offline");
  kernel.close();
});

test("initialization rejects a database created by a newer Kernel schema", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-newer-schema-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "room.db");
  const newer = new DatabaseSync(databasePath);
  newer.exec("PRAGMA user_version = 999");
  newer.close();

  const kernel = new RoomKernel({ databasePath });
  assert.throws(() => kernel.initialize(), /newer Kernel schema/);
  kernel.close();
});

test("initialization migrates schema v2 Tasks to waiting_input without losing rows", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-task-v3-migration-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "room.db");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    PRAGMA user_version = 2;
    CREATE TABLE principals (
      principal_id TEXT PRIMARY KEY,
      handle TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('human', 'agent', 'service')),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE rooms (
      room_id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      next_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_seq > 0),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE memberships (
      room_id TEXT NOT NULL REFERENCES rooms(room_id),
      principal_id TEXT NOT NULL REFERENCES principals(principal_id),
      joined_at TEXT NOT NULL,
      PRIMARY KEY (room_id, principal_id)
    ) STRICT;
    CREATE TABLE room_events (
      event_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(room_id),
      room_seq INTEGER NOT NULL CHECK (room_seq > 0),
      type TEXT NOT NULL,
      actor_id TEXT NOT NULL REFERENCES principals(principal_id),
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      schema_version INTEGER NOT NULL CHECK (schema_version > 0),
      created_at TEXT NOT NULL,
      UNIQUE (room_id, room_seq),
      UNIQUE (room_id, idempotency_key)
    ) STRICT;
    CREATE TABLE tasks (
      task_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(room_id),
      creator_id TEXT NOT NULL REFERENCES principals(principal_id),
      assignee_id TEXT NOT NULL REFERENCES principals(principal_id),
      title TEXT NOT NULL,
      description TEXT,
      state TEXT NOT NULL CHECK (state IN ('todo', 'claimed', 'in_progress', 'submitted', 'completed')),
      claimed_by TEXT REFERENCES principals(principal_id),
      claim_until TEXT,
      claim_until_ms INTEGER,
      last_progress TEXT,
      submission_summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      submitted_at TEXT,
      completed_at TEXT
    ) STRICT;
    INSERT INTO principals VALUES
      ('human-v2', 'human-v2', 'human', '2026-08-25T00:00:00.000Z'),
      ('agent-v2', 'agent-v2', 'agent', '2026-08-25T00:00:00.000Z');
    INSERT INTO rooms VALUES(
      'room-v2', 'room-v2', 'Room v2', 2, '2026-08-25T00:00:00.000Z'
    );
    INSERT INTO memberships VALUES
      ('room-v2', 'human-v2', '2026-08-25T00:00:00.000Z'),
      ('room-v2', 'agent-v2', '2026-08-25T00:00:00.000Z');
    INSERT INTO room_events VALUES(
      'event-room-v2', 'room-v2', 1, 'room.created', 'human-v2', 'room',
      'room-v2', '{}', 'room.create:room-v2', 1,
      '2026-08-25T00:00:00.000Z'
    );
    INSERT INTO tasks(
      task_id, room_id, creator_id, assignee_id, title, state, created_at, updated_at
    ) VALUES(
      'task-v2', 'room-v2', 'human-v2', 'agent-v2', 'Preserve me', 'todo',
      '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z'
    );
  `);
  legacy.close();

  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  kernel.close();

  const migrated = new DatabaseSync(databasePath);
  assert.equal(
    (migrated.prepare("PRAGMA user_version").get() as { user_version: number })
      .user_version,
    KERNEL_SCHEMA_VERSION,
  );
  migrated
    .prepare(
      "UPDATE tasks SET state = 'waiting_input' WHERE task_id = 'task-v2'",
    )
    .run();
  assert.equal(
    (
      migrated
        .prepare("SELECT state FROM tasks WHERE task_id = 'task-v2'")
        .get() as { state: string }
    ).state,
    "waiting_input",
  );
  const taskColumns = migrated.prepare("PRAGMA table_info(tasks)").all() as {
    name: string;
    notnull: number;
  }[];
  assert.equal(
    taskColumns.find((column) => column.name === "assignee_id")?.notnull,
    0,
  );
  assert.ok(taskColumns.some((column) => column.name === "blocked_reason"));
  assert.ok(taskColumns.some((column) => column.name === "task_number"));
  const anchoredTask = migrated
    .prepare(
      "SELECT task_number, source_message_id, thread_id FROM tasks WHERE task_id = 'task-v2'",
    )
    .get() as {
    source_message_id: string;
    task_number: number;
    thread_id: string;
  };
  assert.equal(anchoredTask.task_number, 1);
  assert.ok(
    migrated
      .prepare(
        "SELECT 1 FROM messages WHERE message_id = ? AND room_id = 'room-v2'",
      )
      .get(anchoredTask.source_message_id),
  );
  assert.ok(
    migrated
      .prepare(
        "SELECT 1 FROM threads WHERE thread_id = ? AND root_message_id = ?",
      )
      .get(anchoredTask.thread_id, anchoredTask.source_message_id),
  );
  assert.ok(
    migrated
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'task_dependencies'",
      )
      .get(),
  );
  assert.deepEqual(migrated.prepare("PRAGMA foreign_key_check").all(), []);
  migrated.close();
});

test("schema v5 Task coordination migration preserves InputRequest foreign keys", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-task-v6-migration-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "room.db");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA user_version = 5;
    CREATE TABLE principals (
      principal_id TEXT PRIMARY KEY,
      handle TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('human', 'agent', 'service')),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE rooms (
      room_id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      next_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_seq > 0),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE memberships (
      room_id TEXT NOT NULL REFERENCES rooms(room_id),
      principal_id TEXT NOT NULL REFERENCES principals(principal_id),
      joined_at TEXT NOT NULL,
      PRIMARY KEY (room_id, principal_id)
    ) STRICT;
    CREATE TABLE room_events (
      event_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(room_id),
      room_seq INTEGER NOT NULL CHECK (room_seq > 0),
      type TEXT NOT NULL,
      actor_id TEXT NOT NULL REFERENCES principals(principal_id),
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      schema_version INTEGER NOT NULL CHECK (schema_version > 0),
      created_at TEXT NOT NULL,
      UNIQUE (room_id, room_seq),
      UNIQUE (room_id, idempotency_key)
    ) STRICT;
    CREATE TABLE tasks (
      task_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(room_id),
      creator_id TEXT NOT NULL REFERENCES principals(principal_id),
      assignee_id TEXT NOT NULL REFERENCES principals(principal_id),
      title TEXT NOT NULL,
      description TEXT,
      state TEXT NOT NULL CHECK (state IN ('todo', 'claimed', 'in_progress', 'waiting_input', 'submitted', 'completed')),
      claimed_by TEXT REFERENCES principals(principal_id),
      claim_until TEXT,
      claim_until_ms INTEGER,
      last_progress TEXT,
      submission_summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      submitted_at TEXT,
      completed_at TEXT
    ) STRICT;
    CREATE TABLE input_requests (
      input_request_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(room_id),
      task_id TEXT NOT NULL REFERENCES tasks(task_id),
      requester_id TEXT NOT NULL REFERENCES principals(principal_id),
      responder_id TEXT NOT NULL REFERENCES principals(principal_id),
      question TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'resolved')),
      answer TEXT,
      resolved_by TEXT REFERENCES principals(principal_id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT
    ) STRICT;
    INSERT INTO principals VALUES
      ('human-v5', 'human-v5', 'human', '2026-08-25T00:00:00.000Z'),
      ('agent-v5', 'agent-v5', 'agent', '2026-08-25T00:00:00.000Z');
    INSERT INTO rooms VALUES(
      'room-v5', 'room-v5', 'Room v5', 2, '2026-08-25T00:00:00.000Z'
    );
    INSERT INTO memberships VALUES
      ('room-v5', 'human-v5', '2026-08-25T00:00:00.000Z'),
      ('room-v5', 'agent-v5', '2026-08-25T00:00:00.000Z');
    INSERT INTO room_events VALUES(
      'event-room-v5', 'room-v5', 1, 'room.created', 'human-v5', 'room',
      'room-v5', '{}', 'room.create:room-v5', 1,
      '2026-08-25T00:00:00.000Z'
    );
    INSERT INTO tasks(
      task_id, room_id, creator_id, assignee_id, title, state, created_at, updated_at
    ) VALUES(
      'task-v5', 'room-v5', 'human-v5', 'agent-v5', 'Preserve Task',
      'waiting_input', '2026-08-25T00:00:00.000Z',
      '2026-08-25T00:00:00.000Z'
    );
    INSERT INTO input_requests(
      input_request_id, room_id, task_id, requester_id, responder_id,
      question, state, created_at, updated_at
    ) VALUES(
      'input-v5', 'room-v5', 'task-v5', 'agent-v5', 'human-v5',
      'Preserve InputRequest?', 'pending', '2026-08-25T00:00:00.000Z',
      '2026-08-25T00:00:00.000Z'
    );
  `);
  legacy.close();

  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  kernel.close();

  const migrated = new DatabaseSync(databasePath);
  const migratedTask = migrated
    .prepare(
      "SELECT task_id, assignee_id, state FROM tasks WHERE task_id = 'task-v5'",
    )
    .get() as { assignee_id: string; state: string; task_id: string };
  assert.equal(migratedTask.task_id, "task-v5");
  assert.equal(migratedTask.assignee_id, "agent-v5");
  assert.equal(migratedTask.state, "waiting_input");
  assert.equal(
    (
      migrated
        .prepare(
          "SELECT task_id FROM input_requests WHERE input_request_id = 'input-v5'",
        )
        .get() as { task_id: string }
    ).task_id,
    "task-v5",
  );
  migrated
    .prepare("UPDATE tasks SET assignee_id = NULL WHERE task_id = 'task-v5'")
    .run();
  assert.deepEqual(migrated.prepare("PRAGMA foreign_key_check").all(), []);
  migrated.close();
});

test("rapid events coalesce into one queued Activation per participant lane", () => {
  const { agent, agentActor, humanActor, kernel, room } = createFixture();

  const first = kernel.postMessage(humanActor, {
    body: "First",
    idempotencyKey: "message-first",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });
  const second = kernel.postMessage(humanActor, {
    body: "Second",
    idempotencyKey: "message-second",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });

  const activations = kernel.listActivations({
    participantId: agent.principalId,
    roomId: room.roomId,
  });
  assert.equal(activations.length, 1);
  assert.equal(activations[0]?.fromSeq, first.event.roomSeq);
  assert.equal(activations[0]?.toSeq, second.event.roomSeq);
  assert.equal(
    kernel.listInbox(agentActor, {
      roomId: room.roomId,
    }).length,
    2,
  );

  kernel.close();
});

test("an event arriving while leased creates durable follow-up work", () => {
  const { agent, humanActor, kernel, room } = createFixture();
  const host = authenticateHost(kernel, "host-a", [agent.principalId]);

  kernel.postMessage(humanActor, {
    body: "First",
    idempotencyKey: "leased-first",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });
  const leased = kernel.leaseNextActivation(host, {
    leaseMs: 30_000,
  });
  assert.equal(leased?.state, "leased");

  kernel.postMessage(humanActor, {
    body: "Arrived while busy",
    idempotencyKey: "leased-second",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });

  const activations = kernel.listActivations({
    participantId: agent.principalId,
    roomId: room.roomId,
  });
  assert.equal(activations.length, 2);
  assert.deepEqual(activations.map((activation) => activation.state).sort(), [
    "leased",
    "queued",
  ]);

  kernel.close();
});

test("only one host leases an Activation and an expired lease is recoverable", () => {
  const { agent, agentActor, clock, databasePath, humanActor, kernel, room } =
    createFixture();
  kernel.postMessage(humanActor, {
    body: "Lease me",
    idempotencyKey: "lease-message",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });

  const competingKernel = new RoomKernel({ databasePath, now: clock.now });
  competingKernel.initialize();
  const hostA = authenticateHost(kernel, "host-a", [agent.principalId]);
  const hostB = authenticateHost(kernel, "host-b", [agent.principalId]);
  const first = kernel.leaseNextActivation(hostA, {
    leaseMs: 1_000,
  });
  const loser = competingKernel.leaseNextActivation(hostB, {
    leaseMs: 1_000,
  });
  assert.ok(first);
  assert.equal(loser, null);

  clock.advance(1_001);
  const recovered = competingKernel.leaseNextActivation(hostB, {
    leaseMs: 1_000,
  });
  assert.equal(recovered?.activationId, first.activationId);
  assert.equal(recovered?.leaseOwner, "host-b");
  assert.equal(recovered?.attemptCount, 2);

  assert.throws(
    () =>
      kernel.completeActivation(hostA, {
        activationId: first.activationId,
        consumerId: "host-a-runtime",
      }),
    LeaseConflictError,
  );
  const delivery = competingKernel.sync(agentActor, {
    consumerId: "host-b-runtime",
    roomId: room.roomId,
  });
  competingKernel.acknowledgeCursor(agentActor, {
    consumerId: "host-b-runtime",
    roomId: room.roomId,
    throughSeq: delivery.cursorAfter,
  });
  competingKernel.completeActivation(hostB, {
    activationId: first.activationId,
    consumerId: "host-b-runtime",
  });

  competingKernel.close();
  kernel.close();
});

test("a RuntimeProcess is durably prepared before its RunAttempt becomes running", () => {
  const { agent, humanActor, kernel, room } = createFixture();
  const host = authenticateHost(kernel, "prepared-host", [agent.principalId]);
  kernel.postMessage(humanActor, {
    body: "Persist the runtime capability before launch",
    idempotencyKey: "prepared-runtime-message",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });
  const activation = kernel.leaseNextActivation(host, {
    leaseMs: 1_000,
  });
  assert.ok(activation);
  const runAttempt = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const descriptor = {
    driver: "prepared-runtime",
    metadata: { token: "opaque" },
    recoveryKey: "prepared-runtime-1",
  };

  const prepared = kernel.prepareRunAttemptRuntime(host, {
    recoveryDescriptor: descriptor,
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "prepared-runtime-1",
  });
  assert.equal(prepared.state, "prepared");
  assert.equal(
    kernel.listRunAttempts({ roomId: room.roomId })[0]?.state,
    "starting",
  );

  kernel.markRunAttemptRunning(host, {
    recoveryDescriptor: descriptor,
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "prepared-runtime-1",
  });
  assert.equal(
    kernel.listRuntimeProcesses({ roomId: room.roomId })[0]?.state,
    "active",
  );
  assert.equal(
    kernel.listRunAttempts({ roomId: room.roomId })[0]?.state,
    "running",
  );
  assert.deepEqual(
    kernel
      .sync(humanActor, {
        consumerId: "prepared-runtime-audit",
        roomId: room.roomId,
      })
      .events.map((event) => event.type)
      .filter((type) => type.startsWith("run.")),
    ["run.created", "run.runtime_prepared", "run.started"],
  );

  kernel.close();
});

test("an expired lease with a live RunAttempt is orphaned and quarantined", () => {
  const { agent, clock, databasePath, humanActor, kernel, room } =
    createFixture();
  const crashedHost = authenticateHost(kernel, "crashed-host", [
    agent.principalId,
  ]);
  const replacementHost = authenticateHost(kernel, "replacement-host", [
    agent.principalId,
  ]);
  const recoveryHost = authenticateHost(kernel, "recovery-host", [
    agent.principalId,
  ]);
  const competingRecoveryHost = authenticateHost(
    kernel,
    "competing-recovery-host",
    [agent.principalId],
  );
  kernel.postMessage(humanActor, {
    body: "Do not start this work twice",
    idempotencyKey: "orphaned-run-message",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });
  const leased = kernel.leaseNextActivation(crashedHost, {
    leaseMs: 1_000,
  });
  assert.ok(leased);
  const runAttempt = kernel.createRunAttempt(crashedHost, {
    activationId: leased.activationId,
  });
  kernel.prepareRunAttemptRuntime(crashedHost, {
    recoveryDescriptor: {
      driver: "fake-runtime",
      metadata: {},
      recoveryKey: "possibly-alive-process",
    },
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "possibly-alive-process",
  });
  kernel.markRunAttemptRunning(crashedHost, {
    recoveryDescriptor: {
      driver: "fake-runtime",
      metadata: {},
      recoveryKey: "possibly-alive-process",
    },
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "possibly-alive-process",
  });
  const followUp = kernel.postMessage(humanActor, {
    body: "Keep this queued until termination is proven",
    idempotencyKey: "orphaned-run-follow-up",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });

  clock.advance(1_001);
  const competingKernel = new RoomKernel({ databasePath, now: clock.now });
  competingKernel.initialize();
  assert.equal(
    competingKernel.leaseNextActivation(replacementHost, {
      leaseMs: 1_000,
    }),
    null,
  );

  assert.equal(
    competingKernel
      .listActivations({ roomId: room.roomId })
      .find((candidate) => candidate.activationId === leased.activationId)
      ?.state,
    "quarantined",
  );
  assert.equal(
    competingKernel.listRunAttempts({ roomId: room.roomId })[0]?.state,
    "orphaned",
  );
  const orphanedProcess = competingKernel.listRuntimeProcesses({
    roomId: room.roomId,
  })[0];
  assert.equal(orphanedProcess?.state, "orphaned");
  assert.equal(orphanedProcess?.recoveryDescriptor.driver, "fake-runtime");
  assert.throws(
    () =>
      kernel.completeActivation(crashedHost, {
        activationId: leased.activationId,
        consumerId: "crashed-host:runtime",
      }),
    LeaseConflictError,
  );

  const eventTypes = competingKernel
    .sync(humanActor, {
      consumerId: "orphan-audit",
      roomId: room.roomId,
    })
    .events.map((event) => event.type);
  assert.equal(eventTypes.includes("run.orphaned"), true);
  assert.equal(eventTypes.includes("activation.quarantined"), true);

  const recoveryLease = competingKernel.leaseNextRuntimeRecovery(recoveryHost, {
    driverIds: ["fake-runtime"],
    leaseMs: 1_000,
  });
  assert.equal(recoveryLease?.runAttemptId, runAttempt.runAttemptId);
  assert.equal(recoveryLease?.recoveryLeaseOwner, "recovery-host");
  clock.advance(900);
  const renewedRecoveryLease = competingKernel.renewRuntimeRecoveryLease(
    recoveryHost,
    {
      leaseMs: 1_000,
      recoveryAttemptCount: recoveryLease?.recoveryAttemptCount ?? 0,
      runtimeProcessId: recoveryLease?.runtimeProcessId ?? "missing",
    },
  );
  assert.equal(renewedRecoveryLease.recoveryLeaseOwner, "recovery-host");
  clock.advance(101);
  assert.equal(
    competingKernel.leaseNextRuntimeRecovery(competingRecoveryHost, {
      driverIds: ["fake-runtime"],
      leaseMs: 1_000,
    }),
    null,
  );
  assert.throws(
    () =>
      competingKernel.recordRecoveredRuntimeTermination(competingRecoveryHost, {
        exit: { code: null, signal: "SIGKILL" },
        recoveryAttemptCount: recoveryLease?.recoveryAttemptCount ?? 0,
        runtimeProcessId: recoveryLease?.runtimeProcessId ?? "missing",
      }),
    LeaseConflictError,
  );
  const delayedRecovery = competingKernel.retryRuntimeRecovery(recoveryHost, {
    error: "recovery adapter is temporarily unavailable",
    recoveryAttemptCount: recoveryLease?.recoveryAttemptCount ?? 0,
    retryAfterMs: 100,
    runtimeProcessId: recoveryLease?.runtimeProcessId ?? "missing",
  });
  assert.equal(delayedRecovery.recoveryLeaseOwner, undefined);
  assert.equal(
    delayedRecovery.recoveryLastError,
    "recovery adapter is temporarily unavailable",
  );
  assert.equal(
    competingKernel.leaseNextRuntimeRecovery(recoveryHost, {
      driverIds: ["fake-runtime"],
      leaseMs: 1_000,
    }),
    null,
  );
  clock.advance(101);
  const retriedRecoveryLease = competingKernel.leaseNextRuntimeRecovery(
    recoveryHost,
    {
      driverIds: ["fake-runtime"],
      leaseMs: 1_000,
    },
  );
  assert.equal(retriedRecoveryLease?.recoveryAttemptCount, 2);
  assert.throws(
    () =>
      competingKernel.recordRecoveredRuntimeTermination(recoveryHost, {
        exit: { code: null, signal: "SIGKILL" },
        recoveryAttemptCount: recoveryLease?.recoveryAttemptCount ?? 0,
        runtimeProcessId: retriedRecoveryLease?.runtimeProcessId ?? "missing",
      }),
    LeaseConflictError,
  );
  competingKernel.recordRecoveredRuntimeTermination(recoveryHost, {
    exit: { code: null, signal: "SIGKILL" },
    recoveryAttemptCount: retriedRecoveryLease?.recoveryAttemptCount ?? 0,
    runtimeProcessId: retriedRecoveryLease?.runtimeProcessId ?? "missing",
  });
  const resolved = competingKernel.resolveActivationQuarantine(recoveryHost, {
    activationId: leased.activationId,
  });
  assert.equal(resolved.state, "queued");
  assert.equal(resolved.toSeq, followUp.event.roomSeq);
  assert.deepEqual(
    competingKernel
      .listActivations({ roomId: room.roomId })
      .map((activation) => activation.state)
      .sort(),
    ["cancelled", "queued"],
  );
  assert.equal(
    competingKernel.listRuntimeProcesses({ roomId: room.roomId })[0]?.state,
    "terminated",
  );
  assert.equal(
    competingKernel.leaseNextActivation(replacementHost, {
      leaseMs: 1_000,
    })?.activationId,
    leased.activationId,
  );

  competingKernel.close();
  kernel.close();
});

test("an active Activation lease can be renewed before expiry", () => {
  const { agent, clock, databasePath, humanActor, kernel, room } =
    createFixture();
  const renewHost = authenticateHost(kernel, "renew-host", [agent.principalId]);
  const competingHost = authenticateHost(kernel, "competing-host", [
    agent.principalId,
  ]);
  kernel.postMessage(humanActor, {
    body: "Long-running activation",
    idempotencyKey: "renew-activation",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });
  const leased = kernel.leaseNextActivation(renewHost, {
    leaseMs: 1_000,
  });
  assert.ok(leased);

  clock.advance(500);
  const renewed = kernel.renewActivationLease(renewHost, {
    activationId: leased.activationId,
    leaseMs: 1_000,
  });
  assert.notEqual(renewed.leaseUntil, leased.leaseUntil);

  clock.advance(501);
  const competingKernel = new RoomKernel({ databasePath, now: clock.now });
  competingKernel.initialize();
  assert.equal(
    competingKernel.leaseNextActivation(competingHost, {
      leaseMs: 1_000,
    }),
    null,
  );

  competingKernel.close();
  kernel.close();
});

test("a quarantined Activation durably fences its participant lane", () => {
  const { agent, humanActor, kernel, room } = createFixture();
  const unsafeHost = authenticateHost(kernel, "unsafe-host", [
    agent.principalId,
  ]);
  const replacementHost = authenticateHost(kernel, "replacement-host", [
    agent.principalId,
  ]);
  kernel.postMessage(humanActor, {
    body: "This runtime may still be alive",
    idempotencyKey: "quarantine-first",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });
  const leased = kernel.leaseNextActivation(unsafeHost, {
    leaseMs: 1_000,
  });
  assert.ok(leased);

  const quarantined = kernel.quarantineActivation(unsafeHost, {
    activationId: leased.activationId,
    error: "runtime termination was not proven",
  });
  assert.equal(quarantined.state, "quarantined");
  assert.equal(quarantined.leaseOwner, undefined);
  assert.equal(quarantined.leaseUntil, undefined);

  kernel.postMessage(humanActor, {
    body: "Preserve this follow-up until an operator resolves quarantine",
    idempotencyKey: "quarantine-follow-up",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });
  assert.deepEqual(
    kernel
      .listActivations({
        participantId: agent.principalId,
        roomId: room.roomId,
      })
      .map((activation) => activation.state)
      .sort(),
    ["quarantined", "queued"],
  );
  assert.equal(
    kernel.leaseNextActivation(replacementHost, {
      leaseMs: 1_000,
    }),
    null,
  );
  assert.throws(
    () =>
      kernel.completeActivation(unsafeHost, {
        activationId: leased.activationId,
        consumerId: "unsafe-host:runtime",
      }),
    LeaseConflictError,
  );

  const events = kernel.sync(humanActor, {
    consumerId: "quarantine-audit",
    roomId: room.roomId,
  }).events;
  assert.equal(
    events.some(
      (event) =>
        event.type === "activation.quarantined" &&
        event.aggregateId === leased.activationId,
    ),
    true,
  );

  kernel.close();
});

test("a failed Activation is delayed and merges its queued follow-up", () => {
  const { agent, clock, humanActor, kernel, room } = createFixture();
  const retryHost = authenticateHost(kernel, "retry-host", [agent.principalId]);
  const firstMessage = kernel.postMessage(humanActor, {
    body: "First activation range",
    idempotencyKey: "retry-first",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });
  const leased = kernel.leaseNextActivation(retryHost, {
    leaseMs: 5_000,
  });
  assert.ok(leased);
  const followUpMessage = kernel.postMessage(humanActor, {
    body: "Arrived during the failed run",
    idempotencyKey: "retry-follow-up",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });

  const retried = kernel.retryActivation(retryHost, {
    activationId: leased.activationId,
    error: "runtime crashed",
    retryAfterMs: 2_000,
  });
  assert.equal(retried.state, "queued");
  assert.equal(retried.fromSeq, firstMessage.event.roomSeq);
  assert.equal(retried.toSeq, followUpMessage.event.roomSeq);
  assert.equal(retried.lastError, "runtime crashed");
  assert.deepEqual(
    kernel
      .listActivations({ roomId: room.roomId })
      .map((activation) => activation.state)
      .sort(),
    ["cancelled", "queued"],
  );
  assert.equal(
    kernel.leaseNextActivation(retryHost, {
      leaseMs: 1_000,
    }),
    null,
  );

  clock.advance(2_001);
  const leasedAgain = kernel.leaseNextActivation(retryHost, {
    leaseMs: 1_000,
  });
  assert.equal(leasedAgain?.activationId, leased.activationId);
  assert.equal(leasedAgain?.attemptCount, 2);

  kernel.close();
});

test("three identical Activation failures trip a Raft-style retry fingerprint fence", () => {
  const { agent, humanActor, kernel, room } = createFixture();
  const retryHost = authenticateHost(kernel, "retry-fence-host", [
    agent.principalId,
  ]);
  kernel.postMessage(humanActor, {
    body: "Trigger deterministic runtime failure",
    idempotencyKey: "retry-fence-message",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const leased = kernel.leaseNextActivation(retryHost, { leaseMs: 5_000 });
    assert.ok(leased);
    assert.equal(leased.attemptCount, attempt);
    const result = kernel.retryActivation(retryHost, {
      activationId: leased.activationId,
      error: "provider connection failed at 2026-09-02T00:00:00.000Z",
      retryAfterMs: 0,
    });
    assert.equal(result.state, attempt < 3 ? "queued" : "quarantined");
  }

  assert.equal(kernel.leaseNextActivation(retryHost, { leaseMs: 5_000 }), null);
  const events = kernel.sync(humanActor, {
    consumerId: "retry-fence-audit",
    roomId: room.roomId,
  }).events;
  const blocked = events.find(
    (event) => event.type === "activation.retry_blocked",
  );
  assert.ok(blocked);
  assert.equal(blocked.payload.sameErrorCount, 3);
  assert.equal(blocked.payload.threshold, 3);
  assert.equal(typeof blocked.payload.errorFingerprint, "string");
  const pushes = kernel.humanNotifications.webPush.project({
    roomId: room.roomId,
    roomSeq: blocked.roomSeq,
  });
  assert.equal(pushes.length, 1);
  assert.match(pushes[0]?.payload.title ?? "", /停止自动重试/u);
  assert.equal(pushes[0]?.payload.target.kind, "room");
  assert.equal(
    events.filter((event) => event.type === "activation.retry_scheduled")
      .length,
    2,
  );

  kernel.close();
});

test("action-required and sticky Runtime errors quarantine immediately without consuming the fingerprint counter", () => {
  for (const retryDisposition of [
    "action_required",
    "sticky_terminal",
  ] as const) {
    const { agent, humanActor, kernel, room } = createFixture();
    const retryHost = authenticateHost(
      kernel,
      `retry-${retryDisposition}-host`,
      [agent.principalId],
    );
    kernel.postMessage(humanActor, {
      body: `Trigger ${retryDisposition}`,
      idempotencyKey: `retry-${retryDisposition}-message`,
      recipients: [{ participantId: agent.principalId, reason: "mention" }],
      roomId: room.roomId,
    });
    const leased = kernel.leaseNextActivation(retryHost, { leaseMs: 5_000 });
    assert.ok(leased);
    const result = kernel.retryActivation(retryHost, {
      activationId: leased.activationId,
      error:
        retryDisposition === "action_required"
          ? "Authentication failed: please log in first"
          : "This model is not supported",
      retryAfterMs: 10_000,
      retryDisposition,
    });
    assert.equal(result.state, "quarantined");
    const blocked = kernel
      .sync(humanActor, {
        consumerId: `retry-${retryDisposition}-audit`,
        roomId: room.roomId,
      })
      .events.find((event) => event.type === "activation.retry_blocked");
    assert.ok(blocked);
    assert.equal(blocked.payload.retryDisposition, retryDisposition);
    assert.equal(blocked.payload.sameErrorCount, 0);
    assert.equal(
      blocked.payload.actionRequired,
      retryDisposition === "action_required",
    );
    kernel.close();
  }
});

test("Room sync cursors are independent and Inbox acknowledgement is explicit", () => {
  const {
    agent,
    agentActor,
    humanActor,
    kernel,
    otherAgent,
    otherAgentActor,
    room,
  } = createFixture();
  const firstSync = kernel.sync(agentActor, {
    consumerId: "agent-host",
    roomId: room.roomId,
  });
  assert.ok(firstSync.snapshot);
  kernel.acknowledgeCursor(agentActor, {
    consumerId: "agent-host",
    roomId: room.roomId,
    throughSeq: firstSync.cursorAfter,
  });

  const posted = kernel.postMessage(humanActor, {
    body: "Both agents should see this",
    idempotencyKey: "broadcast-1",
    recipients: [
      { participantId: agent.principalId, reason: "room_policy" },
      { participantId: otherAgent.principalId, reason: "room_policy" },
    ],
    roomId: room.roomId,
  });

  const agentDelta = kernel.sync(agentActor, {
    consumerId: "agent-host",
    roomId: room.roomId,
  });
  assert.deepEqual(
    agentDelta.events.map((event) => event.eventId),
    [posted.event.eventId],
  );

  const otherFirstSync = kernel.sync(otherAgentActor, {
    consumerId: "other-host",
    roomId: room.roomId,
  });
  assert.ok(otherFirstSync.snapshot);
  assert.ok(
    otherFirstSync.events.some(
      (event) => event.eventId === posted.event.eventId,
    ),
  );

  assert.equal(
    kernel.listInbox(agentActor, {
      roomId: room.roomId,
    })[0]?.state,
    "pending",
  );
  kernel.acknowledgeInboxThrough(agentActor, {
    roomId: room.roomId,
    throughSeq: posted.event.roomSeq,
  });
  assert.equal(
    kernel.listInbox(agentActor, {
      roomId: room.roomId,
    })[0]?.state,
    "acknowledged",
  );

  kernel.close();
});

test("Human Room sync can bootstrap from a bounded latest snapshot window", () => {
  const { humanActor, kernel, room } = createFixture();
  for (let index = 0; index < 8; index += 1) {
    kernel.postMessage(humanActor, {
      body: `latest window ${String(index + 1)}`,
      idempotencyKey: `latest-window-${String(index + 1)}`,
      recipients: [],
      roomId: room.roomId,
    });
  }

  const delivery = kernel.sync(humanActor, {
    bootstrap: "latest",
    consumerId: "browser-latest-window",
    limit: 3,
    roomId: room.roomId,
  });

  assert.ok(delivery.snapshot);
  assert.equal(delivery.snapshotSeq, delivery.latestRoomSeq);
  assert.equal(delivery.eventFloorSeq, delivery.latestRoomSeq - 3);
  assert.equal(delivery.cursorAfter, delivery.latestRoomSeq);
  assert.deepEqual(
    delivery.events.map(({ roomSeq }) => roomSeq),
    [
      delivery.latestRoomSeq - 2,
      delivery.latestRoomSeq - 1,
      delivery.latestRoomSeq,
    ],
  );
  kernel.close();
});

test("visible Message mention receipts remain exact without replaying Room history", () => {
  const { agent, agentActor, humanActor, kernel, otherAgent, room } =
    createFixture();
  const mentioned = kernel.postMessage(humanActor, {
    body: "@codex inspect this",
    idempotencyKey: "bounded-reference-receipt",
    recipients: [
      { participantId: agent.principalId, reason: "mention" },
      { participantId: otherAgent.principalId, reason: "manual" },
    ],
    roomId: room.roomId,
  });

  assert.deepEqual(
    kernel.listMessageReferenceReadStates(humanActor, {
      messageIds: [mentioned.event.aggregateId],
      roomId: room.roomId,
    }),
    [
      {
        messageId: mentioned.event.aggregateId,
        principalId: agent.principalId,
        readState: "unread",
      },
    ],
  );

  kernel.acknowledgeInboxThrough(agentActor, {
    roomId: room.roomId,
    throughSeq: mentioned.event.roomSeq,
  });
  assert.deepEqual(
    kernel.listMessageReferenceReadStates(humanActor, {
      messageIds: [mentioned.event.aggregateId],
      roomId: room.roomId,
    }),
    [
      {
        messageId: mentioned.event.aggregateId,
        principalId: agent.principalId,
        readState: "read",
      },
    ],
  );
  kernel.close();
});

test("Room Task reads are bounded and page backward by canonical task number", () => {
  const { humanActor, kernel, room } = createFixture();
  for (let index = 1; index <= 6; index += 1) {
    kernel.createTask(humanActor, {
      idempotencyKey: `bounded-task-${String(index)}`,
      roomId: room.roomId,
      title: `Bounded Task ${String(index)}`,
    });
  }

  const latest = kernel.listTasks(humanActor, {
    limit: 3,
    roomId: room.roomId,
  });
  assert.deepEqual(
    latest.map(({ taskNumber }) => taskNumber),
    [4, 5, 6],
  );
  const earlier = kernel.listTasks(humanActor, {
    beforeTaskNumber: 4,
    limit: 3,
    roomId: room.roomId,
  });
  assert.deepEqual(
    earlier.map(({ taskNumber }) => taskNumber),
    [1, 2, 3],
  );
  kernel.close();
});

test("Room sync replays an unacknowledged response after receipt loss", () => {
  const { agent, agentActor, humanActor, kernel, room } = createFixture();
  const posted = kernel.postMessage(humanActor, {
    body: "This delivery must survive a lost response",
    idempotencyKey: "receipt-loss-1",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });

  const deliveredButLost = kernel.sync(agentActor, {
    consumerId: "agent-host",
    roomId: room.roomId,
  });
  assert.ok(
    deliveredButLost.events.some(
      (event) => event.eventId === posted.event.eventId,
    ),
  );

  const retry = kernel.sync(agentActor, {
    consumerId: "agent-host",
    roomId: room.roomId,
  });
  assert.deepEqual(retry.events, deliveredButLost.events);
  assert.equal(retry.cursorBefore, deliveredButLost.cursorBefore);

  kernel.acknowledgeCursor(agentActor, {
    consumerId: "agent-host",
    roomId: room.roomId,
    throughSeq: retry.cursorAfter,
  });
  const afterAcknowledgement = kernel.sync(agentActor, {
    consumerId: "agent-host",
    roomId: room.roomId,
  });
  assert.deepEqual(afterAcknowledgement.events, []);
  assert.equal(afterAcknowledgement.cursorBefore, retry.cursorAfter);

  kernel.close();
});

test("business actor identity comes only from an authenticated context", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-kernel-auth-"));
  temporaryDirectories.push(directory);
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  kernel.initialize();

  const humanProvisioning = kernel.provisionPrincipal({
    handle: "authenticated-human",
    kind: "human",
  });
  const agentProvisioning = kernel.provisionPrincipal({
    handle: "authenticated-agent",
    kind: "agent",
  });
  const humanActor = kernel.authenticateAccessToken(
    humanProvisioning.accessToken,
  );
  const room = kernel.createRoom(humanActor, {
    name: "Authenticated room",
    slug: "authenticated-room",
  });
  kernel.addMember(humanActor, {
    principalId: agentProvisioning.principal.principalId,
    roomId: room.roomId,
  });

  assert.throws(
    () => kernel.authenticateAccessToken("invalid-access-token"),
    /authentication/i,
  );
  assert.throws(
    () =>
      kernel.postMessage({ principalId: humanActor.principalId } as never, {
        body: "A forged context must fail",
        idempotencyKey: "forged-context",
        recipients: [],
        roomId: room.roomId,
      }),
    /authentication/i,
  );

  const commandWithInjectedActor = {
    actorId: agentProvisioning.principal.principalId,
    body: "The authenticated human remains the actor",
    idempotencyKey: "actor-injection",
    recipients: [],
    roomId: room.roomId,
  };
  const result = kernel.postMessage(humanActor, commandWithInjectedActor);
  assert.equal(result.event.actorId, humanActor.principalId);

  kernel.close();
});

test("an Agent mutation based on stale Room context is rejected atomically", () => {
  const { agentActor, human, humanActor, kernel, room } = createFixture();

  const visible = kernel.postMessage(humanActor, {
    body: "Initial task context",
    idempotencyKey: "freshness-visible",
    recipients: [],
    roomId: room.roomId,
  });
  const agentView = kernel.sync(agentActor, {
    consumerId: "agent-runtime",
    roomId: room.roomId,
  });
  assert.equal(agentView.latestRoomSeq, visible.event.roomSeq);

  kernel.postMessage(humanActor, {
    body: "A correction arrived after the Agent read",
    idempotencyKey: "freshness-correction",
    recipients: [],
    roomId: room.roomId,
  });
  const outboxCountBeforeStaleWrite = kernel.listOutbox().length;

  assert.throws(
    () =>
      kernel.postMessage(agentActor, {
        basedOnRoomSeq: agentView.latestRoomSeq,
        body: "A now-stale answer",
        idempotencyKey: "stale-agent-answer",
        recipients: [{ participantId: human.principalId, reason: "mention" }],
        roomId: room.roomId,
      }),
    StaleContextError,
  );
  assert.equal(kernel.listOutbox().length, outboxCountBeforeStaleWrite);

  assert.throws(
    () =>
      kernel.postMessage(agentActor, {
        body: "An Agent answer without a causal base",
        idempotencyKey: "missing-agent-causal-base",
        recipients: [],
        roomId: room.roomId,
      }),
    StaleContextError,
  );

  const refreshed = kernel.sync(agentActor, {
    consumerId: "agent-runtime",
    roomId: room.roomId,
  });
  const accepted = kernel.postMessage(agentActor, {
    basedOnRoomSeq: refreshed.latestRoomSeq,
    body: "An answer after refreshing context",
    idempotencyKey: "fresh-agent-answer",
    recipients: [{ participantId: human.principalId, reason: "mention" }],
    roomId: room.roomId,
  });
  assert.equal(accepted.event.actorId, agentActor.principalId);

  kernel.close();
});

test("Task workflow is durable, leased independently, and explicitly completed", async () => {
  const { agent, agentActor, humanActor, kernel, room } = createFixture();

  const peerProvisioning = kernel.provisionPrincipal({
    handle: "task-observer",
    kind: "human",
  });
  const peerActor = kernel.authenticateAccessToken(
    peerProvisioning.accessToken,
  );
  kernel.addMember(humanActor, {
    principalId: peerProvisioning.principal.principalId,
    roomId: room.roomId,
  });

  const created = kernel.createTask(humanActor, {
    assigneeId: agent.principalId,
    description: "Use only Room protocol commands",
    idempotencyKey: "task-create-1",
    roomId: room.roomId,
    title: "Implement Task state machine",
  });
  assert.equal(created.task.state, "todo");
  assert.equal(created.task.taskNumber, 1);
  assert.ok(created.task.sourceMessageId);
  assert.ok(created.task.threadId);
  assert.equal(created.event.type, "task.created");
  assert.equal(created.activationIds.length, 1);
  kernel.followHumanThread(peerActor, {
    roomId: room.roomId,
    threadId: created.task.threadId,
    following: true,
  });
  assert.equal(kernel.listTasks(agentActor, { roomId: room.roomId }).length, 1);
  assert.equal(kernel.listInbox(agentActor, { roomId: room.roomId }).length, 1);

  const repeatedCreate = kernel.createTask(humanActor, {
    assigneeId: agent.principalId,
    description: "Use only Room protocol commands",
    idempotencyKey: "task-create-1",
    roomId: room.roomId,
    title: "Implement Task state machine",
  });
  assert.equal(repeatedCreate.deduplicated, true);
  assert.equal(repeatedCreate.task.taskId, created.task.taskId);
  assert.equal(
    repeatedCreate.task.sourceMessageId,
    created.task.sourceMessageId,
  );
  assert.equal(repeatedCreate.task.threadId, created.task.threadId);
  assert.equal(kernel.listTasks(agentActor, { roomId: room.roomId }).length, 1);
  assert.equal(
    kernel
      .listMessages(humanActor, { roomId: room.roomId })
      .messages.filter(
        ({ messageId }) => messageId === created.task.sourceMessageId,
      ).length,
    1,
  );
  assert.equal(
    kernel
      .listThreads(humanActor, { roomId: room.roomId })
      .filter(({ threadId }) => threadId === created.task.threadId).length,
    1,
  );
  assert.throws(
    () =>
      kernel.createTask(humanActor, {
        assigneeId: agent.principalId,
        idempotencyKey: "task-create-1",
        roomId: room.roomId,
        title: "Implement Task state machine",
      }),
    IdempotencyConflictError,
  );

  const host = authenticateHost(kernel, "task-worker-host", [
    agent.principalId,
  ]);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation);
  const runAttempt = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, host, {
    recoveryDescriptor: fakeRecovery("task-worker-runtime"),
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "task-worker-runtime",
  });
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: "task-worker-consumer",
    hostId: host.hostId,
    participantId: agent.principalId,
    roomId: room.roomId,
    runAttemptId: runAttempt.runAttemptId,
    toSeq: activation.toSeq,
  });
  const delivery = kernel.syncWorker(execution, {});
  kernel.acknowledgeWorkerCursor(execution, {
    throughSeq: delivery.cursorAfter,
  });

  const claimed = kernel.claimTask(execution, {
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: "task-claim-1",
    leaseMs: 1_000,
    taskId: created.task.taskId,
  });
  assert.equal(claimed.task.state, "claimed");
  assert.equal(claimed.task.claimedBy, agent.principalId);
  assert.equal(claimed.event.type, "task.claimed");

  const started = kernel.startTask(execution, {
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: "task-start-1",
    leaseMs: 1_000,
    taskId: created.task.taskId,
  });
  assert.equal(started.task.state, "in_progress");
  assert.equal(started.event.type, "task.started");

  const progressed = kernel.progressTask(execution, {
    basedOnRoomSeq: started.event.roomSeq,
    idempotencyKey: "task-progress-1",
    leaseMs: 1_000,
    progress: "Kernel and protocol tests pass",
    taskId: created.task.taskId,
  });
  assert.equal(progressed.task.lastProgress, "Kernel and protocol tests pass");
  assert.equal(progressed.event.type, "task.progressed");
  assert.deepEqual(
    kernel
      .listMessages(humanActor, {
        roomId: room.roomId,
        threadId: created.task.threadId,
      })
      .messages.map(({ actorId, body, threadId }) => ({
        actorId,
        body,
        threadId,
      })),
    [
      {
        actorId: agent.principalId,
        body: "Kernel and protocol tests pass",
        threadId: created.task.threadId,
      },
    ],
  );

  const stagedArtifact = kernel.files.prepareWorker(execution, {
    filename: "verification.txt",
    idempotencyKey: "task-artifact-1",
    mimeType: "text/plain",
    size: 18,
    taskId: created.task.taskId,
  });
  await kernel.files.uploadWorker(
    execution,
    stagedArtifact.attachmentId,
    bytes("artifact-evidence!"),
  );
  assert.equal(
    kernel.files.list(humanActor, { roomId: room.roomId }).files.length,
    0,
    "staged Agent bytes are not Room Files before Task submission",
  );

  const submitted = kernel.submitTask(execution, {
    basedOnRoomSeq: progressed.event.roomSeq,
    idempotencyKey: "task-submit-1",
    summary: "Implemented and verified",
    taskId: created.task.taskId,
  });
  assert.equal(submitted.task.state, "submitted");
  assert.equal(submitted.task.claimedBy, undefined);
  assert.equal(submitted.event.type, "task.submitted");
  const submittedPush = kernel.humanNotifications.webPush.project({
    roomId: room.roomId,
    roomSeq: submitted.event.roomSeq,
  });
  assert.deepEqual(
    submittedPush.map(({ principalId }) => principalId).sort(),
    [humanActor.principalId, peerProvisioning.principal.principalId].sort(),
  );
  assert.match(submittedPush[0]!.payload.title, /待审核/u);
  assert.equal(submittedPush[0]!.payload.target.kind, "task");
  assert.deepEqual(
    kernel
      .listMessages(humanActor, {
        roomId: room.roomId,
        threadId: created.task.threadId,
      })
      .messages.map(({ attachments, body }) => ({ attachments, body })),
    [
      { attachments: undefined, body: "Kernel and protocol tests pass" },
      {
        attachments: [
          {
            attachmentId: stagedArtifact.attachmentId,
            filename: "verification.txt",
            mimeType: "text/plain",
            sha256:
              "0d612265f5b74df4d813cf768c288f6dc27872470cd02e763c130b0bdaafbe51",
            size: 18,
          },
        ],
        body: "Implemented and verified",
      },
    ],
  );
  const [submissionEvidence] = kernel.taskReviews.listTaskSubmissions(
    humanActor,
    { roomId: room.roomId, taskId: created.task.taskId },
  );
  assert.equal(submissionEvidence?.artifacts.length, 1);
  assert.equal(
    submissionEvidence?.artifacts[0]?.attachmentId,
    stagedArtifact.attachmentId,
  );
  assert.equal(
    submissionEvidence?.artifacts[0]?.runAttemptId,
    runAttempt.runAttemptId,
  );
  assert.equal(
    kernel.files.list(humanActor, { roomId: room.roomId }).files[0]?.messageId,
    submissionEvidence?.messageId,
  );
  assert.equal(
    kernel.submitTask(execution, {
      basedOnRoomSeq: progressed.event.roomSeq,
      idempotencyKey: "task-submit-1",
      summary: "Implemented and verified",
      taskId: created.task.taskId,
    }).deduplicated,
    true,
  );

  kernel.recordRuntimeTermination(host, {
    exit: { code: 0 },
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "task-worker-runtime",
  });
  kernel.finishRunAttempt(host, {
    exitCode: 0,
    runAttemptId: runAttempt.runAttemptId,
    state: "exited",
  });
  kernel.completeActivation(host, {
    activationId: activation.activationId,
    consumerId: "task-worker-consumer",
  });
  assert.equal(
    kernel.listTasks(humanActor, { roomId: room.roomId })[0]?.state,
    "submitted",
    "successful process exit must not complete the business Task",
  );

  const latest = kernel.sync(humanActor, {
    consumerId: "task-reviewer",
    roomId: room.roomId,
  }).latestRoomSeq;
  const completed = kernel.completeTask(humanActor, {
    basedOnRoomSeq: latest,
    idempotencyKey: "task-complete-1",
    taskId: created.task.taskId,
  });
  assert.equal(completed.task.state, "completed");
  assert.equal(completed.event.type, "task.completed");
  const completedPush = kernel.humanNotifications.webPush.project({
    roomId: room.roomId,
    roomSeq: completed.event.roomSeq,
  });
  assert.deepEqual(
    completedPush.map(({ principalId }) => principalId),
    [peerProvisioning.principal.principalId],
  );
  assert.match(completedPush[0]!.payload.title, /已完成/u);

  kernel.close();
});

test("an assigned Task has one claim owner plus canonical collaborators and reviewers", () => {
  const { agent, humanActor, kernel, otherAgent, otherAgentActor, room } =
    createFixture();
  const reviewerProvisioning = kernel.provisionPrincipal({
    handle: "reviewer",
    kind: "agent",
  });
  const reviewer = reviewerProvisioning.principal;
  const reviewerActor = kernel.authenticateAccessToken(
    reviewerProvisioning.accessToken,
  );
  kernel.addMember(humanActor, {
    principalId: reviewer.principalId,
    roomId: room.roomId,
  });

  const created = kernel.createTask(humanActor, {
    assigneeId: agent.principalId,
    collaboratorIds: [otherAgent.principalId],
    idempotencyKey: "task-roles-create",
    reviewerIds: [reviewer.principalId],
    roomId: room.roomId,
    title: "Implement, assist, and review one durable change",
  });
  assert.deepEqual(created.task.collaboratorIds, [otherAgent.principalId]);
  assert.deepEqual(created.task.reviewerIds, [reviewer.principalId]);
  assert.deepEqual(created.event.payload.collaboratorIds, [
    otherAgent.principalId,
  ]);
  assert.deepEqual(created.event.payload.reviewerIds, [reviewer.principalId]);
  assert.equal(created.activationIds.length, 2);
  assert.deepEqual(
    kernel
      .listInbox(otherAgentActor, { roomId: room.roomId })
      .map(({ reason }) => reason),
    ["task_collaboration"],
  );
  assert.deepEqual(
    kernel.listInbox(reviewerActor, { roomId: room.roomId }),
    [],
    "reviewers must not run before the owner submits",
  );

  assert.throws(
    () =>
      kernel.createTask(humanActor, {
        collaboratorIds: [otherAgent.principalId],
        idempotencyKey: "task-roles-open-ambiguous",
        roomId: room.roomId,
        title: "An open Task cannot predeclare collaborators",
      }),
    ConflictError,
  );
  assert.throws(
    () =>
      kernel.createTask(humanActor, {
        assigneeId: agent.principalId,
        collaboratorIds: [agent.principalId],
        idempotencyKey: "task-roles-owner-overlap",
        roomId: room.roomId,
        title: "The owner cannot duplicate a secondary role",
      }),
    ConflictError,
  );

  const ownerHost = authenticateHost(kernel, "task-role-owner-host", [
    agent.principalId,
  ]);
  const ownerActivation = kernel.leaseNextActivation(ownerHost, {
    leaseMs: 30_000,
  });
  assert.ok(ownerActivation);
  const ownerRun = kernel.createRunAttempt(ownerHost, {
    activationId: ownerActivation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, ownerHost, {
    recoveryDescriptor: fakeRecovery("task-role-owner-runtime"),
    runAttemptId: ownerRun.runAttemptId,
    runtimeRunId: "task-role-owner-runtime",
  });
  const ownerExecution = kernel.authorizeWorkerExecution(ownerHost, {
    activationId: ownerActivation.activationId,
    consumerId: "task-role-owner-consumer",
    hostId: ownerHost.hostId,
    participantId: agent.principalId,
    roomId: room.roomId,
    runAttemptId: ownerRun.runAttemptId,
    toSeq: ownerActivation.toSeq,
  });
  const ownerDelivery = kernel.syncWorker(ownerExecution, {});
  kernel.acknowledgeWorkerCursor(ownerExecution, {
    throughSeq: ownerDelivery.cursorAfter,
  });
  const claimed = kernel.claimTask(ownerExecution, {
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: "task-roles-claim",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const started = kernel.startTask(ownerExecution, {
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: "task-roles-start",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const submitted = kernel.submitTask(ownerExecution, {
    basedOnRoomSeq: started.event.roomSeq,
    idempotencyKey: "task-roles-submit",
    summary: "Owner implementation is ready for independent review",
    taskId: created.task.taskId,
  });
  assert.equal(submitted.task.state, "submitted");
  kernel.recordRuntimeTermination(ownerHost, {
    exit: { code: 0 },
    runAttemptId: ownerRun.runAttemptId,
    runtimeRunId: "task-role-owner-runtime",
  });
  kernel.finishRunAttempt(ownerHost, {
    exitCode: 0,
    runAttemptId: ownerRun.runAttemptId,
    state: "exited",
  });
  kernel.completeActivation(ownerHost, {
    activationId: ownerActivation.activationId,
    consumerId: "task-role-owner-consumer",
  });
  assert.deepEqual(
    kernel
      .listInbox(reviewerActor, { roomId: room.roomId })
      .map(({ reason }) => reason),
    ["task_review"],
  );

  const reviewerHost = authenticateHost(kernel, "task-role-reviewer-host", [
    reviewer.principalId,
  ]);
  const reviewerActivation = kernel.leaseNextActivation(reviewerHost, {
    leaseMs: 30_000,
  });
  assert.ok(reviewerActivation);
  const reviewerRun = kernel.createRunAttempt(reviewerHost, {
    activationId: reviewerActivation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, reviewerHost, {
    recoveryDescriptor: fakeRecovery("task-role-reviewer-runtime"),
    runAttemptId: reviewerRun.runAttemptId,
    runtimeRunId: "task-role-reviewer-runtime",
  });
  const reviewerExecution = kernel.authorizeWorkerExecution(reviewerHost, {
    activationId: reviewerActivation.activationId,
    consumerId: "task-role-reviewer-consumer",
    hostId: reviewerHost.hostId,
    participantId: reviewer.principalId,
    roomId: room.roomId,
    runAttemptId: reviewerRun.runAttemptId,
    toSeq: reviewerActivation.toSeq,
  });
  const reviewerDelivery = kernel.syncWorker(reviewerExecution, {});
  kernel.acknowledgeWorkerCursor(reviewerExecution, {
    throughSeq: reviewerDelivery.cursorAfter,
  });
  assert.equal(
    kernel.getWorkerTask(reviewerExecution, { taskId: created.task.taskId })
      .state,
    "submitted",
  );
  const latestBeforeReview = kernel.sync(humanActor, {
    consumerId: "task-role-human-review",
    roomId: room.roomId,
  }).latestRoomSeq;
  assert.throws(
    () =>
      kernel.completeTask(humanActor, {
        basedOnRoomSeq: latestBeforeReview,
        idempotencyKey: "task-roles-complete-before-review",
        taskId: created.task.taskId,
      }),
    ConflictError,
    "a Task with declared reviewers cannot complete before frozen review evidence",
  );
  const changesRequested = kernel.taskReviews.reviewTask(reviewerExecution, {
    basedOnRoomSeq: reviewerActivation.toSeq,
    disposition: "changes_requested",
    idempotencyKey: "task-roles-review-changes-requested",
    summary: "Changes requested: add the missing independent gate evidence.",
    taskId: created.task.taskId,
  });
  assert.equal(changesRequested.review.disposition, "changes_requested");
  assert.equal(changesRequested.task.state, "todo");
  assert.equal(changesRequested.task.assigneeId, agent.principalId);
  assert.equal(changesRequested.task.submissionSummary, undefined);
  assert.equal(changesRequested.activationIds.length, 2);
  const changesRequestedPush = kernel.humanNotifications.webPush.project({
    roomId: room.roomId,
    roomSeq: changesRequested.event.roomSeq,
  });
  assert.deepEqual(
    changesRequestedPush.map(({ principalId }) => principalId),
    [humanActor.principalId],
  );
  assert.match(changesRequestedPush[0]!.payload.title, /要求修改/u);
  kernel.recordRuntimeTermination(reviewerHost, {
    exit: { code: 0 },
    runAttemptId: reviewerRun.runAttemptId,
    runtimeRunId: "task-role-reviewer-runtime",
  });
  kernel.finishRunAttempt(reviewerHost, {
    exitCode: 0,
    runAttemptId: reviewerRun.runAttemptId,
    state: "exited",
  });
  kernel.completeActivation(reviewerHost, {
    activationId: reviewerActivation.activationId,
    consumerId: "task-role-reviewer-consumer",
  });

  const revisionOwnerHost = authenticateHost(
    kernel,
    "task-role-owner-revision-host",
    [agent.principalId],
  );
  const revisionOwnerActivation = kernel.leaseNextActivation(
    revisionOwnerHost,
    { leaseMs: 30_000 },
  );
  assert.ok(revisionOwnerActivation);
  const revisionOwnerRun = kernel.createRunAttempt(revisionOwnerHost, {
    activationId: revisionOwnerActivation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, revisionOwnerHost, {
    recoveryDescriptor: fakeRecovery("task-role-owner-revision-runtime"),
    runAttemptId: revisionOwnerRun.runAttemptId,
    runtimeRunId: "task-role-owner-revision-runtime",
  });
  const revisionOwnerExecution = kernel.authorizeWorkerExecution(
    revisionOwnerHost,
    {
      activationId: revisionOwnerActivation.activationId,
      consumerId: "task-role-owner-revision-consumer",
      hostId: revisionOwnerHost.hostId,
      participantId: agent.principalId,
      roomId: room.roomId,
      runAttemptId: revisionOwnerRun.runAttemptId,
      toSeq: revisionOwnerActivation.toSeq,
    },
  );
  const revisionOwnerDelivery = kernel.syncWorker(revisionOwnerExecution, {});
  kernel.acknowledgeWorkerCursor(revisionOwnerExecution, {
    throughSeq: revisionOwnerDelivery.cursorAfter,
  });
  const revisionClaimed = kernel.claimTask(revisionOwnerExecution, {
    basedOnRoomSeq: changesRequested.event.roomSeq,
    idempotencyKey: "task-roles-revision-claim",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const revisionStarted = kernel.startTask(revisionOwnerExecution, {
    basedOnRoomSeq: revisionClaimed.event.roomSeq,
    idempotencyKey: "task-roles-revision-start",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const resubmitted = kernel.submitTask(revisionOwnerExecution, {
    basedOnRoomSeq: revisionStarted.event.roomSeq,
    idempotencyKey: "task-roles-revision-submit",
    summary: "Revision includes the independent gate evidence.",
    taskId: created.task.taskId,
  });
  kernel.recordRuntimeTermination(revisionOwnerHost, {
    exit: { code: 0 },
    runAttemptId: revisionOwnerRun.runAttemptId,
    runtimeRunId: "task-role-owner-revision-runtime",
  });
  kernel.finishRunAttempt(revisionOwnerHost, {
    exitCode: 0,
    runAttemptId: revisionOwnerRun.runAttemptId,
    state: "exited",
  });
  kernel.completeActivation(revisionOwnerHost, {
    activationId: revisionOwnerActivation.activationId,
    consumerId: "task-role-owner-revision-consumer",
  });

  const revisionReviewerHost = authenticateHost(
    kernel,
    "task-role-reviewer-revision-host",
    [reviewer.principalId],
  );
  const revisionReviewerActivation = kernel.leaseNextActivation(
    revisionReviewerHost,
    { leaseMs: 30_000 },
  );
  assert.ok(revisionReviewerActivation);
  const revisionReviewerRun = kernel.createRunAttempt(revisionReviewerHost, {
    activationId: revisionReviewerActivation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, revisionReviewerHost, {
    recoveryDescriptor: fakeRecovery("task-role-reviewer-revision-runtime"),
    runAttemptId: revisionReviewerRun.runAttemptId,
    runtimeRunId: "task-role-reviewer-revision-runtime",
  });
  const revisionReviewerExecution = kernel.authorizeWorkerExecution(
    revisionReviewerHost,
    {
      activationId: revisionReviewerActivation.activationId,
      consumerId: "task-role-reviewer-revision-consumer",
      hostId: revisionReviewerHost.hostId,
      participantId: reviewer.principalId,
      roomId: room.roomId,
      runAttemptId: revisionReviewerRun.runAttemptId,
      toSeq: revisionReviewerActivation.toSeq,
    },
  );
  const revisionReviewerDelivery = kernel.syncWorker(
    revisionReviewerExecution,
    {},
  );
  kernel.acknowledgeWorkerCursor(revisionReviewerExecution, {
    throughSeq: revisionReviewerDelivery.cursorAfter,
  });
  const review = kernel.taskReviews.reviewTask(revisionReviewerExecution, {
    basedOnRoomSeq: revisionReviewerActivation.toSeq,
    disposition: "approved",
    idempotencyKey: "task-roles-review-approved",
    summary: "Review passed: the revised evidence matches the requested scope.",
    taskId: created.task.taskId,
  });
  assert.equal(review.review.disposition, "approved");
  assert.equal(review.review.reviewerId, reviewer.principalId);
  assert.equal(review.review.submissionDigest.startsWith("sha256:"), true);
  assert.equal(review.review.submissionId, review.submission.submissionId);
  assert.equal(
    review.submission.messageId,
    resubmitted.event.payload.messageId,
  );
  assert.notEqual(
    review.submission.submissionDigest,
    changesRequested.submission.submissionDigest,
  );
  assert.deepEqual(
    kernel.taskReviews
      .listTaskReviews(humanActor, {
        roomId: room.roomId,
        taskId: created.task.taskId,
      })
      .map(({ disposition, submissionId }) => ({
        disposition,
        submissionId,
      })),
    [
      {
        disposition: "changes_requested",
        submissionId: changesRequested.submission.submissionId,
      },
      {
        disposition: "approved",
        submissionId: review.submission.submissionId,
      },
    ],
  );
  const completed = kernel.completeTask(humanActor, {
    basedOnRoomSeq: review.event.roomSeq,
    idempotencyKey: "task-roles-complete-after-review",
    taskId: created.task.taskId,
  });
  assert.equal(completed.task.state, "completed");
  assert.deepEqual(
    kernel
      .listMessages(humanActor, {
        roomId: room.roomId,
        threadId: created.task.threadId,
      })
      .messages.map(({ actorId, body, threadId }) => ({
        actorId,
        body,
        threadId,
      })),
    [
      {
        actorId: agent.principalId,
        body: "Owner implementation is ready for independent review",
        threadId: created.task.threadId,
      },
      {
        actorId: reviewer.principalId,
        body: "Changes requested: add the missing independent gate evidence.",
        threadId: created.task.threadId,
      },
      {
        actorId: agent.principalId,
        body: "Revision includes the independent gate evidence.",
        threadId: created.task.threadId,
      },
      {
        actorId: reviewer.principalId,
        body: "Review passed: the revised evidence matches the requested scope.",
        threadId: created.task.threadId,
      },
    ],
  );

  kernel.close();
});

test("schema v16 backfills frozen evidence for legacy submitted Tasks", () => {
  const { agent, databasePath, humanAccessToken, humanActor, kernel, room } =
    createFixture();
  const created = kernel.createTask(humanActor, {
    assigneeId: agent.principalId,
    idempotencyKey: "legacy-review-task-create",
    roomId: room.roomId,
    title: "Preserve an existing submitted Task",
  });
  const host = authenticateHost(kernel, "legacy-review-owner-host", [
    agent.principalId,
  ]);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, host, {
    recoveryDescriptor: fakeRecovery("legacy-review-owner-runtime"),
    runAttemptId: run.runAttemptId,
    runtimeRunId: "legacy-review-owner-runtime",
  });
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: "legacy-review-owner-consumer",
    hostId: host.hostId,
    participantId: agent.principalId,
    roomId: room.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const delivery = kernel.syncWorker(execution, {});
  kernel.acknowledgeWorkerCursor(execution, {
    throughSeq: delivery.cursorAfter,
  });
  const claimed = kernel.claimTask(execution, {
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: "legacy-review-task-claim",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const started = kernel.startTask(execution, {
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: "legacy-review-task-start",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const submitted = kernel.submitTask(execution, {
    basedOnRoomSeq: started.event.roomSeq,
    idempotencyKey: "legacy-review-task-submit",
    summary: "Legacy evidence remains reviewable after migration",
    taskId: created.task.taskId,
  });
  assert.equal(submitted.task.state, "submitted");
  kernel.close();

  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON; DELETE FROM task_submissions;");
  database.exec("PRAGMA user_version = 15");
  database.close();

  const reopened = new RoomKernel({ databasePath });
  reopened.initialize();
  const reopenedHuman = reopened.authenticateAccessToken(humanAccessToken);
  const submissions = reopened.taskReviews.listTaskSubmissions(reopenedHuman, {
    roomId: room.roomId,
    taskId: created.task.taskId,
  });
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0]?.messageId, submitted.event.payload.messageId);
  assert.equal(submissions[0]?.summary, submitted.event.payload.summary);
  assert.equal(submissions[0]?.submissionDigest.startsWith("sha256:"), true);
  reopened.close();
});

test("one Agent can atomically promote a causal Human message into a claimed Task", () => {
  const { agent, humanActor, kernel, otherAgent, room } = createFixture();
  const casual = kernel.postRoomMessage(humanActor, {
    body: "What time is it?",
    idempotencyKey: "ordinary-tool-question",
    recipients: [],
    roomId: room.roomId,
  });
  assert.deepEqual(kernel.listTasks(humanActor, { roomId: room.roomId }), []);
  const durableWork = kernel.postRoomMessage(humanActor, {
    body: "Implement the migration, run the full gate, and report review evidence",
    idempotencyKey: "durable-work-message",
    recipients: [],
    roomId: room.roomId,
  });

  const ownerHost = authenticateHost(kernel, "message-claim-owner-host", [
    agent.principalId,
  ]);
  const ownerActivation = kernel.leaseNextActivation(ownerHost, {
    leaseMs: 30_000,
  });
  assert.ok(ownerActivation);
  assert.equal(ownerActivation.fromSeq, casual.event.roomSeq);
  assert.equal(ownerActivation.toSeq, durableWork.event.roomSeq);
  const ownerRun = kernel.createRunAttempt(ownerHost, {
    activationId: ownerActivation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, ownerHost, {
    recoveryDescriptor: fakeRecovery("message-claim-owner-runtime"),
    runAttemptId: ownerRun.runAttemptId,
    runtimeRunId: "message-claim-owner-runtime",
  });
  const ownerExecution = kernel.authorizeWorkerExecution(ownerHost, {
    activationId: ownerActivation.activationId,
    consumerId: "message-claim-owner-consumer",
    hostId: ownerHost.hostId,
    participantId: agent.principalId,
    roomId: room.roomId,
    runAttemptId: ownerRun.runAttemptId,
    toSeq: ownerActivation.toSeq,
  });
  const ownerDelivery = kernel.syncWorker(ownerExecution, {});
  kernel.acknowledgeWorkerCursor(ownerExecution, {
    throughSeq: ownerDelivery.cursorAfter,
  });
  const promoted = kernel.claimMessageAsTask(ownerExecution, {
    basedOnRoomSeq: durableWork.event.roomSeq,
    idempotencyKey: "message-claim-owner",
    leaseMs: 30_000,
    messageId: durableWork.event.aggregateId,
    rationale: "Persistent edits, multiple gates, progress, and review",
  });
  assert.equal(promoted.event.type, "task.created");
  assert.equal(promoted.task.state, "claimed");
  assert.equal(promoted.task.assigneeId, agent.principalId);
  assert.equal(promoted.task.claimedBy, agent.principalId);
  assert.equal(promoted.task.sourceMessageId, durableWork.event.aggregateId);
  assert.equal(promoted.event.payload.autoClaimed, true);
  assert.equal(
    promoted.event.payload.classificationRationale,
    "Persistent edits, multiple gates, progress, and review",
  );

  const competitorHost = authenticateHost(
    kernel,
    "message-claim-competitor-host",
    [otherAgent.principalId],
  );
  const competitorActivation = kernel.leaseNextActivation(competitorHost, {
    leaseMs: 30_000,
  });
  assert.ok(competitorActivation);
  const competitorRun = kernel.createRunAttempt(competitorHost, {
    activationId: competitorActivation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, competitorHost, {
    recoveryDescriptor: fakeRecovery("message-claim-competitor-runtime"),
    runAttemptId: competitorRun.runAttemptId,
    runtimeRunId: "message-claim-competitor-runtime",
  });
  const competitorExecution = kernel.authorizeWorkerExecution(competitorHost, {
    activationId: competitorActivation.activationId,
    consumerId: "message-claim-competitor-consumer",
    hostId: competitorHost.hostId,
    participantId: otherAgent.principalId,
    roomId: room.roomId,
    runAttemptId: competitorRun.runAttemptId,
    toSeq: competitorActivation.toSeq,
  });
  const competitorDelivery = kernel.syncWorker(competitorExecution, {});
  kernel.acknowledgeWorkerCursor(competitorExecution, {
    throughSeq: competitorDelivery.cursorAfter,
  });
  assert.throws(
    () =>
      kernel.claimMessageAsTask(competitorExecution, {
        basedOnRoomSeq: durableWork.event.roomSeq,
        idempotencyKey: "message-claim-competitor",
        leaseMs: 30_000,
        messageId: durableWork.event.aggregateId,
        rationale: "The same work looked substantial to another Agent",
      }),
    ConflictError,
  );

  const started = kernel.startTask(ownerExecution, {
    basedOnRoomSeq: promoted.event.roomSeq,
    idempotencyKey: "message-claim-start",
    leaseMs: 30_000,
    taskId: promoted.task.taskId,
  });
  const submitted = kernel.submitTask(ownerExecution, {
    basedOnRoomSeq: started.event.roomSeq,
    idempotencyKey: "message-claim-submit",
    summary: "Migration and gates completed with review evidence",
    taskId: promoted.task.taskId,
  });
  assert.equal(submitted.task.state, "submitted");

  kernel.close();
});

test("Tasks are sequential top-level Messages with one canonical Thread", () => {
  const { humanActor, kernel, room } = createFixture();

  const first = kernel.createTask(humanActor, {
    idempotencyKey: "task-anchor-first",
    roomId: room.roomId,
    title: "First anchored Task",
  });
  const second = kernel.createTask(humanActor, {
    idempotencyKey: "task-anchor-second",
    roomId: room.roomId,
    title: "Second anchored Task",
  });

  assert.equal(first.task.taskNumber, 1);
  assert.equal(second.task.taskNumber, 2);
  assert.deepEqual(
    kernel
      .listMessages(humanActor, { roomId: room.roomId })
      .messages.map(({ body, messageId, threadId }) => ({
        body,
        messageId,
        threadId,
      })),
    [
      {
        body: "First anchored Task",
        messageId: first.task.sourceMessageId,
        threadId: undefined,
      },
      {
        body: "Second anchored Task",
        messageId: second.task.sourceMessageId,
        threadId: undefined,
      },
    ],
  );
  const threadsByRootMessage = new Map(
    kernel
      .listThreads(humanActor, { roomId: room.roomId })
      .map(({ rootMessageId, threadId }) => [rootMessageId, threadId]),
  );
  assert.equal(threadsByRootMessage.size, 2);
  assert.equal(
    threadsByRootMessage.get(first.task.sourceMessageId),
    first.task.threadId,
  );
  assert.equal(
    threadsByRootMessage.get(second.task.sourceMessageId),
    second.task.threadId,
  );

  kernel.close();
});

test("an existing top-level Message converts to one Task and reuses its Thread", () => {
  const { humanActor, kernel, room } = createFixture();
  const posted = kernel.postRoomMessage(humanActor, {
    body: "Turn this conversation into tracked work",
    idempotencyKey: "convert-source-message",
    recipients: [],
    roomId: room.roomId,
  });
  const existingThread = kernel.createThread(humanActor, {
    basedOnRoomSeq: posted.event.roomSeq,
    idempotencyKey: "convert-source-thread",
    recipientIds: [],
    roomId: room.roomId,
    rootMessageId: posted.event.aggregateId,
  });
  const reply = kernel.replyThread(humanActor, {
    basedOnRoomSeq: existingThread.event.roomSeq,
    body: "Discussion context cannot become the Task anchor",
    idempotencyKey: "convert-source-reply",
    recipientIds: [],
    roomId: room.roomId,
    threadId: existingThread.thread.threadId,
  });

  const converted = kernel.createTask(humanActor, {
    basedOnRoomSeq: reply.event.roomSeq,
    dependencyTaskIds: [],
    idempotencyKey: "convert-top-level-message",
    roomId: room.roomId,
    sourceMessageId: posted.event.aggregateId,
  });

  assert.equal(converted.event.type, "task.created");
  assert.equal(
    converted.task.title,
    "Turn this conversation into tracked work",
  );
  assert.equal(converted.task.sourceMessageId, posted.event.aggregateId);
  assert.equal(converted.task.threadId, existingThread.thread.threadId);
  assert.equal(converted.task.taskNumber, 1);
  assert.equal(
    kernel
      .listMessages(humanActor, { roomId: room.roomId })
      .messages.filter(
        ({ messageId }) => messageId === posted.event.aggregateId,
      ).length,
    1,
    "conversion must not duplicate or move the original channel Message",
  );
  assert.equal(
    kernel.listThreads(humanActor, { roomId: room.roomId }).length,
    1,
    "conversion must reuse an existing Message Thread",
  );

  const replayed = kernel.createTask(humanActor, {
    basedOnRoomSeq: reply.event.roomSeq,
    dependencyTaskIds: [],
    idempotencyKey: "convert-top-level-message",
    roomId: room.roomId,
    sourceMessageId: posted.event.aggregateId,
  });
  assert.equal(replayed.deduplicated, true);
  assert.equal(replayed.task.taskId, converted.task.taskId);

  assert.throws(
    () =>
      kernel.createTask(humanActor, {
        basedOnRoomSeq: converted.event.roomSeq,
        idempotencyKey: "convert-top-level-message-twice",
        roomId: room.roomId,
        sourceMessageId: posted.event.aggregateId,
      }),
    ConflictError,
  );
  assert.throws(
    () =>
      kernel.createTask(humanActor, {
        basedOnRoomSeq: converted.event.roomSeq,
        idempotencyKey: "convert-thread-reply",
        roomId: room.roomId,
        sourceMessageId: reply.event.aggregateId,
      }),
    ConflictError,
  );

  kernel.close();
});

test("an open Task is broadcast but has one atomic owner across Kernel connections", () => {
  const { agent, clock, databasePath, humanActor, kernel, otherAgent, room } =
    createFixture();
  const competingKernel = new RoomKernel({ databasePath, now: clock.now });
  competingKernel.initialize();

  const firstCredential = kernel.provisionHostCredential({
    hostId: "open-task-host-a",
    participantIds: [agent.principalId],
  });
  const secondCredential = kernel.provisionHostCredential({
    hostId: "open-task-host-b",
    participantIds: [otherAgent.principalId],
  });
  const firstHost = kernel.authenticateHostAccessToken(
    firstCredential.accessToken,
  );
  const secondHost = competingKernel.authenticateHostAccessToken(
    secondCredential.accessToken,
  );
  kernel.heartbeatHost(firstHost);
  competingKernel.heartbeatHost(secondHost);

  const created = kernel.createTask(humanActor, {
    idempotencyKey: "open-task-created",
    roomId: room.roomId,
    title: "Claim this exactly once",
  });
  assert.equal(created.task.assigneeId, undefined);
  assert.equal(created.activationIds.length, 2);

  const firstActivation = kernel.leaseNextActivation(firstHost, {
    leaseMs: 30_000,
  });
  const secondActivation = competingKernel.leaseNextActivation(secondHost, {
    leaseMs: 30_000,
  });
  assert.ok(firstActivation);
  assert.ok(secondActivation);

  const firstRun = kernel.createRunAttempt(firstHost, {
    activationId: firstActivation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, firstHost, {
    recoveryDescriptor: fakeRecovery("open-task-runtime-a"),
    runAttemptId: firstRun.runAttemptId,
    runtimeRunId: "open-task-runtime-a",
  });
  const secondRun = competingKernel.createRunAttempt(secondHost, {
    activationId: secondActivation.activationId,
  });
  prepareAndMarkRunAttemptRunning(competingKernel, secondHost, {
    recoveryDescriptor: fakeRecovery("open-task-runtime-b"),
    runAttemptId: secondRun.runAttemptId,
    runtimeRunId: "open-task-runtime-b",
  });

  const firstExecution = kernel.authorizeWorkerExecution(firstHost, {
    activationId: firstActivation.activationId,
    consumerId: "open-task-consumer-a",
    hostId: firstHost.hostId,
    participantId: agent.principalId,
    roomId: room.roomId,
    runAttemptId: firstRun.runAttemptId,
    toSeq: firstActivation.toSeq,
  });
  const secondExecution = competingKernel.authorizeWorkerExecution(secondHost, {
    activationId: secondActivation.activationId,
    consumerId: "open-task-consumer-b",
    hostId: secondHost.hostId,
    participantId: otherAgent.principalId,
    roomId: room.roomId,
    runAttemptId: secondRun.runAttemptId,
    toSeq: secondActivation.toSeq,
  });
  const firstDelivery = kernel.syncWorker(firstExecution, {});
  kernel.acknowledgeWorkerCursor(firstExecution, {
    throughSeq: firstDelivery.cursorAfter,
  });
  const secondDelivery = competingKernel.syncWorker(secondExecution, {});
  competingKernel.acknowledgeWorkerCursor(secondExecution, {
    throughSeq: secondDelivery.cursorAfter,
  });

  const winner = kernel.claimTask(firstExecution, {
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: "open-task-claim-a",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  assert.equal(winner.task.assigneeId, agent.principalId);
  assert.equal(winner.task.claimedBy, agent.principalId);
  assert.throws(
    () =>
      competingKernel.claimTask(secondExecution, {
        basedOnRoomSeq: created.event.roomSeq,
        idempotencyKey: "open-task-claim-b",
        leaseMs: 30_000,
        taskId: created.task.taskId,
      }),
    LeaseConflictError,
  );
  assert.equal(
    competingKernel.getWorkerTask(secondExecution, {
      taskId: created.task.taskId,
    }).assigneeId,
    agent.principalId,
  );

  competingKernel.recordRuntimeTermination(secondHost, {
    exit: { code: 0 },
    runAttemptId: secondRun.runAttemptId,
    runtimeRunId: "open-task-runtime-b",
  });
  competingKernel.finishRunAttempt(secondHost, {
    exitCode: 0,
    runAttemptId: secondRun.runAttemptId,
    state: "exited",
  });
  assert.equal(
    competingKernel.completeActivation(secondHost, {
      activationId: secondActivation.activationId,
      consumerId: "open-task-consumer-b",
    }).state,
    "completed",
  );

  competingKernel.close();
  kernel.close();
});

test("releasing an owned Task reopens it and fences the old execution", () => {
  const { agent, humanActor, kernel, otherAgent, room } = createFixture();
  const firstHost = authenticateHost(kernel, "release-task-host-a", [
    agent.principalId,
  ]);
  const secondHost = authenticateHost(kernel, "release-task-host-b", [
    otherAgent.principalId,
  ]);
  const created = kernel.createTask(humanActor, {
    idempotencyKey: "release-task-created",
    roomId: room.roomId,
    title: "Release this for another Agent",
  });

  const firstActivation = kernel.leaseNextActivation(firstHost, {
    leaseMs: 30_000,
  });
  assert.ok(firstActivation);
  const firstRun = kernel.createRunAttempt(firstHost, {
    activationId: firstActivation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, firstHost, {
    recoveryDescriptor: fakeRecovery("release-task-runtime-a"),
    runAttemptId: firstRun.runAttemptId,
    runtimeRunId: "release-task-runtime-a",
  });
  const firstExecution = kernel.authorizeWorkerExecution(firstHost, {
    activationId: firstActivation.activationId,
    consumerId: "release-task-consumer-a",
    hostId: firstHost.hostId,
    participantId: agent.principalId,
    roomId: room.roomId,
    runAttemptId: firstRun.runAttemptId,
    toSeq: firstActivation.toSeq,
  });
  const firstDelivery = kernel.syncWorker(firstExecution, {});
  kernel.acknowledgeWorkerCursor(firstExecution, {
    throughSeq: firstDelivery.cursorAfter,
  });
  const claimed = kernel.claimTask(firstExecution, {
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: "release-task-claim-a",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const started = kernel.startTask(firstExecution, {
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: "release-task-start-a",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const released = kernel.releaseTask(firstExecution, {
    basedOnRoomSeq: started.event.roomSeq,
    idempotencyKey: "release-task-release-a",
    taskId: created.task.taskId,
  });
  assert.equal(released.task.state, "todo");
  assert.equal(released.task.assigneeId, undefined);
  assert.equal(released.task.claimedBy, undefined);
  assert.equal(released.activationIds.length, 1);
  assert.equal(
    kernel.releaseTask(firstExecution, {
      basedOnRoomSeq: started.event.roomSeq,
      idempotencyKey: "release-task-release-a",
      taskId: created.task.taskId,
    }).deduplicated,
    true,
  );

  const secondActivation = kernel.leaseNextActivation(secondHost, {
    leaseMs: 30_000,
  });
  assert.ok(secondActivation);
  const secondRun = kernel.createRunAttempt(secondHost, {
    activationId: secondActivation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, secondHost, {
    recoveryDescriptor: fakeRecovery("release-task-runtime-b"),
    runAttemptId: secondRun.runAttemptId,
    runtimeRunId: "release-task-runtime-b",
  });
  const secondExecution = kernel.authorizeWorkerExecution(secondHost, {
    activationId: secondActivation.activationId,
    consumerId: "release-task-consumer-b",
    hostId: secondHost.hostId,
    participantId: otherAgent.principalId,
    roomId: room.roomId,
    runAttemptId: secondRun.runAttemptId,
    toSeq: secondActivation.toSeq,
  });
  const secondDelivery = kernel.syncWorker(secondExecution, {});
  kernel.acknowledgeWorkerCursor(secondExecution, {
    throughSeq: secondDelivery.cursorAfter,
  });
  const reclaimed = kernel.claimTask(secondExecution, {
    basedOnRoomSeq: released.event.roomSeq,
    idempotencyKey: "release-task-claim-b",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  assert.equal(reclaimed.task.assigneeId, otherAgent.principalId);
  assert.throws(
    () =>
      kernel.progressTask(firstExecution, {
        basedOnRoomSeq: reclaimed.event.roomSeq,
        idempotencyKey: "released-owner-progress",
        leaseMs: 30_000,
        progress: "This execution no longer owns the Task",
        taskId: created.task.taskId,
      }),
    StaleContextError,
  );

  kernel.close();
});

test("Task creator explicitly assigns, unblocks, and cancels coordination state", () => {
  const { agent, humanActor, kernel, otherAgent, room } = createFixture();
  const host = authenticateHost(kernel, "blocked-task-host", [
    agent.principalId,
  ]);
  const created = kernel.createTask(humanActor, {
    assigneeId: agent.principalId,
    idempotencyKey: "blocked-task-created",
    roomId: room.roomId,
    title: "Block only with explicit evidence",
  });
  const peerProvisioning = kernel.provisionPrincipal({
    handle: "task-lifecycle-observer",
    kind: "human",
  });
  const peerActor = kernel.authenticateAccessToken(
    peerProvisioning.accessToken,
  );
  kernel.addMember(humanActor, {
    principalId: peerProvisioning.principal.principalId,
    roomId: room.roomId,
  });
  kernel.followHumanThread(peerActor, {
    roomId: room.roomId,
    threadId: created.task.threadId,
    following: true,
  });
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, host, {
    recoveryDescriptor: fakeRecovery("blocked-task-runtime"),
    runAttemptId: run.runAttemptId,
    runtimeRunId: "blocked-task-runtime",
  });
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: "blocked-task-consumer",
    hostId: host.hostId,
    participantId: agent.principalId,
    roomId: room.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const delivery = kernel.syncWorker(execution, {});
  kernel.acknowledgeWorkerCursor(execution, {
    throughSeq: delivery.cursorAfter,
  });
  const claimed = kernel.claimTask(execution, {
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: "blocked-task-claim",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const started = kernel.startTask(execution, {
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: "blocked-task-start",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const blocked = kernel.blockTask(execution, {
    basedOnRoomSeq: started.event.roomSeq,
    idempotencyKey: "blocked-task-block",
    reason: "Need the maintainer to choose an API boundary",
    taskId: created.task.taskId,
  });
  assert.equal(blocked.task.state, "blocked");
  assert.equal(blocked.task.assigneeId, agent.principalId);
  assert.equal(blocked.task.claimedBy, undefined);
  assert.equal(
    blocked.task.blockedReason,
    "Need the maintainer to choose an API boundary",
  );
  assert.equal(blocked.activationIds.length, 1);
  const blockedPush = kernel.humanNotifications.webPush.project({
    roomId: room.roomId,
    roomSeq: blocked.event.roomSeq,
  });
  assert.deepEqual(
    blockedPush.map(({ principalId }) => principalId).sort(),
    [humanActor.principalId, peerProvisioning.principal.principalId].sort(),
  );
  assert.match(blockedPush[0]!.payload.title, /已阻塞/u);
  assert.equal(
    kernel.blockTask(execution, {
      basedOnRoomSeq: started.event.roomSeq,
      idempotencyKey: "blocked-task-block",
      reason: "Need the maintainer to choose an API boundary",
      taskId: created.task.taskId,
    }).deduplicated,
    true,
  );

  const unblocked = kernel.unblockTask(humanActor, {
    basedOnRoomSeq: blocked.event.roomSeq,
    idempotencyKey: "blocked-task-unblock",
    taskId: created.task.taskId,
  });
  assert.equal(unblocked.task.state, "todo");
  assert.equal(unblocked.task.assigneeId, agent.principalId);
  assert.equal(unblocked.task.blockedReason, undefined);
  assert.equal(
    kernel.unblockTask(humanActor, {
      basedOnRoomSeq: blocked.event.roomSeq,
      idempotencyKey: "blocked-task-unblock",
      taskId: created.task.taskId,
    }).deduplicated,
    true,
  );

  const cancelled = kernel.cancelTask(humanActor, {
    basedOnRoomSeq: unblocked.event.roomSeq,
    idempotencyKey: "blocked-task-cancel",
    reason: "The requirement was withdrawn",
    taskId: created.task.taskId,
  });
  assert.equal(cancelled.task.state, "cancelled");
  const cancelledPush = kernel.humanNotifications.webPush.project({
    roomId: room.roomId,
    roomSeq: cancelled.event.roomSeq,
  });
  assert.deepEqual(
    cancelledPush.map(({ principalId }) => principalId),
    [peerProvisioning.principal.principalId],
  );
  assert.match(cancelledPush[0]!.payload.title, /已取消/u);
  assert.equal(
    cancelled.task.cancellationReason,
    "The requirement was withdrawn",
  );
  assert.equal(
    kernel.cancelTask(humanActor, {
      basedOnRoomSeq: unblocked.event.roomSeq,
      idempotencyKey: "blocked-task-cancel",
      reason: "The requirement was withdrawn",
      taskId: created.task.taskId,
    }).deduplicated,
    true,
  );
  assert.throws(
    () =>
      kernel.claimTask(execution, {
        basedOnRoomSeq: cancelled.event.roomSeq,
        idempotencyKey: "cancelled-task-claim",
        leaseMs: 30_000,
        taskId: created.task.taskId,
      }),
    StaleContextError,
  );

  const open = kernel.createTask(humanActor, {
    idempotencyKey: "assign-open-task-created",
    roomId: room.roomId,
    title: "Assign this open Task",
  });
  const assigned = kernel.assignTask(humanActor, {
    assigneeId: otherAgent.principalId,
    basedOnRoomSeq: open.event.roomSeq,
    idempotencyKey: "assign-open-task",
    taskId: open.task.taskId,
  });
  assert.equal(assigned.task.state, "todo");
  assert.equal(assigned.task.assigneeId, otherAgent.principalId);
  assert.equal(
    kernel.assignTask(humanActor, {
      assigneeId: otherAgent.principalId,
      basedOnRoomSeq: open.event.roomSeq,
      idempotencyKey: "assign-open-task",
      taskId: open.task.taskId,
    }).deduplicated,
    true,
  );

  const preassigned = kernel.createTask(humanActor, {
    assigneeId: agent.principalId,
    basedOnRoomSeq: assigned.event.roomSeq,
    idempotencyKey: "unassign-task-created",
    roomId: room.roomId,
    title: "Release this assignment before work starts",
  });
  const unassigned = kernel.unassignTask(humanActor, {
    basedOnRoomSeq: preassigned.event.roomSeq,
    idempotencyKey: "unassign-task",
    taskId: preassigned.task.taskId,
  });
  assert.equal(unassigned.event.type, "task.unassigned");
  assert.equal(unassigned.task.state, "todo");
  assert.equal(unassigned.task.assigneeId, undefined);
  assert.equal(unassigned.activationIds.length, 2);
  assert.equal(
    kernel.unassignTask(humanActor, {
      basedOnRoomSeq: preassigned.event.roomSeq,
      idempotencyKey: "unassign-task",
      taskId: preassigned.task.taskId,
    }).deduplicated,
    true,
  );

  kernel.close();
});

test("Human cancellation fences active Task execution before reversible Closed recovery", () => {
  const { agent, humanActor, kernel, room } = createFixture();
  const host = authenticateHost(kernel, "cancel-fence-host", [
    agent.principalId,
  ]);
  const created = kernel.createTask(humanActor, {
    assigneeId: agent.principalId,
    idempotencyKey: "cancel-fence-created",
    roomId: room.roomId,
    title: "Stop the old CLI before reopening",
  });
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, host, {
    recoveryDescriptor: fakeRecovery("cancel-fence-runtime"),
    runAttemptId: run.runAttemptId,
    runtimeRunId: "cancel-fence-runtime",
  });
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: "cancel-fence-consumer",
    hostId: host.hostId,
    participantId: agent.principalId,
    roomId: room.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const delivery = kernel.syncWorker(execution, {});
  kernel.acknowledgeWorkerCursor(execution, {
    throughSeq: delivery.cursorAfter,
  });
  const claimed = kernel.claimTask(execution, {
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: "cancel-fence-claim",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const started = kernel.startTask(execution, {
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: "cancel-fence-start",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });

  const cancelled = kernel.cancelTask(humanActor, {
    basedOnRoomSeq: started.event.roomSeq,
    idempotencyKey: "cancel-fence-cancel",
    reason: "Human stopped the work before assigning it elsewhere",
    taskId: created.task.taskId,
  });
  assert.equal(cancelled.task.state, "cancelled");
  assert.throws(
    () =>
      kernel.progressTask(execution, {
        basedOnRoomSeq: started.event.roomSeq,
        idempotencyKey: "cancel-fence-late-progress",
        leaseMs: 30_000,
        progress: "This old process must not keep writing",
        taskId: created.task.taskId,
      }),
    ExecutionFencedError,
  );
  assert.throws(
    () =>
      kernel.renewActivationLease(host, {
        activationId: activation.activationId,
        leaseMs: 30_000,
      }),
    ActivationCancellationRequestedError,
  );
  assert.throws(
    () =>
      kernel.reopenTask(humanActor, {
        basedOnRoomSeq: cancelled.event.roomSeq,
        idempotencyKey: "cancel-fence-too-early-reopen",
        taskId: created.task.taskId,
      }),
    ConflictError,
  );

  kernel.recordRuntimeTermination(host, {
    exit: { code: null, signal: "SIGTERM" },
    runAttemptId: run.runAttemptId,
    runtimeRunId: "cancel-fence-runtime",
  });
  kernel.finishRunAttempt(host, {
    error: "Task cancellation requested by its Human creator",
    exitSignal: "SIGTERM",
    runAttemptId: run.runAttemptId,
    state: "cancelled",
  });
  const requeued = kernel.resolveActivationCancellation(host, {
    activationId: activation.activationId,
  });
  assert.equal(requeued.state, "queued");
  assert.equal(requeued.fromSeq, activation.fromSeq);
  assert.ok(requeued.toSeq >= cancelled.event.roomSeq);

  const latestRoomSeq = kernel.sync(humanActor, {
    consumerId: "cancel-fence-human-sync",
    roomId: room.roomId,
  }).cursorAfter;
  const reopened = kernel.reopenTask(humanActor, {
    basedOnRoomSeq: latestRoomSeq,
    idempotencyKey: "cancel-fence-reopen",
    taskId: created.task.taskId,
  });
  assert.equal(reopened.event.type, "task.reopened");
  assert.equal(reopened.task.state, "todo");
  assert.equal(reopened.task.assigneeId, agent.principalId);
  assert.equal(reopened.task.cancellationReason, undefined);
  assert.equal(reopened.task.cancelledAt, undefined);
  assert.equal(reopened.activationIds.length, 1);
  assert.equal(
    kernel.reopenTask(humanActor, {
      basedOnRoomSeq: latestRoomSeq,
      idempotencyKey: "cancel-fence-reopen",
      taskId: created.task.taskId,
    }).deduplicated,
    true,
  );

  kernel.close();
});

test("durable Task reassignment fences the old Runtime until terminal proof and assigns one new owner", () => {
  const { agent, humanActor, kernel, otherAgent, room } = createFixture();
  const oldHost = authenticateHost(kernel, "reassignment-old-host", [
    agent.principalId,
  ]);
  const created = kernel.createTask(humanActor, {
    assigneeId: agent.principalId,
    idempotencyKey: "reassignment-created",
    roomId: room.roomId,
    title: "Move this running Task without two writers",
  });
  const peerProvisioning = kernel.provisionPrincipal({
    handle: "reassignment-observer",
    kind: "human",
  });
  const peerActor = kernel.authenticateAccessToken(
    peerProvisioning.accessToken,
  );
  kernel.addMember(humanActor, {
    principalId: peerProvisioning.principal.principalId,
    roomId: room.roomId,
  });
  kernel.followHumanThread(peerActor, {
    roomId: room.roomId,
    threadId: created.task.threadId,
    following: true,
  });
  const activation = kernel.leaseNextActivation(oldHost, { leaseMs: 30_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(oldHost, {
    activationId: activation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, oldHost, {
    recoveryDescriptor: fakeRecovery("reassignment-runtime"),
    runAttemptId: run.runAttemptId,
    runtimeRunId: "reassignment-runtime",
  });
  const execution = kernel.authorizeWorkerExecution(oldHost, {
    activationId: activation.activationId,
    consumerId: "reassignment-consumer",
    hostId: oldHost.hostId,
    participantId: agent.principalId,
    roomId: room.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const delivery = kernel.syncWorker(execution, {});
  kernel.acknowledgeWorkerCursor(execution, {
    throughSeq: delivery.cursorAfter,
  });
  const claimed = kernel.claimTask(execution, {
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: "reassignment-claim",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const started = kernel.startTask(execution, {
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: "reassignment-start",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });

  const requested = kernel.taskReassignment.request(humanActor, {
    assigneeId: otherAgent.principalId,
    basedOnRoomSeq: started.event.roomSeq,
    idempotencyKey: "reassignment-request",
    reason: "The first Agent is unavailable; preserve evidence and hand off",
    taskId: created.task.taskId,
  });
  assert.equal(requested.operation.state, "cancellation_requested");
  assert.equal(requested.task.state, "cancelled");
  assert.equal(requested.task.assigneeId, agent.principalId);
  assert.throws(
    () => kernel.taskReassignment.continue(humanActor, requested.operation),
    /terminal proof/,
  );
  assert.throws(
    () =>
      kernel.progressTask(execution, {
        basedOnRoomSeq: started.event.roomSeq,
        idempotencyKey: "reassignment-late-progress",
        leaseMs: 30_000,
        progress: "The old owner must stay fenced",
        taskId: created.task.taskId,
      }),
    ExecutionFencedError,
  );

  kernel.recordRuntimeTermination(oldHost, {
    exit: { code: null, signal: "SIGTERM" },
    runAttemptId: run.runAttemptId,
    runtimeRunId: "reassignment-runtime",
  });
  kernel.finishRunAttempt(oldHost, {
    error: "Task reassignment requested",
    exitSignal: "SIGTERM",
    runAttemptId: run.runAttemptId,
    state: "cancelled",
  });
  kernel.resolveActivationCancellation(oldHost, {
    activationId: activation.activationId,
  });
  assert.equal(
    kernel.leaseNextActivation(oldHost, { leaseMs: 30_000 }),
    null,
    "the durable reassignment operation must fence the requeued old lane",
  );

  const reassigned = kernel.taskReassignment.continue(
    humanActor,
    requested.operation,
  );
  assert.equal(reassigned.event.type, "task.reassigned");
  assert.equal(reassigned.operation.state, "assigned");
  assert.equal(reassigned.task.state, "todo");
  assert.equal(reassigned.task.assigneeId, otherAgent.principalId);
  assert.equal(reassigned.activationIds.length, 1);
  const reassignedPush = kernel.humanNotifications.webPush.project({
    roomId: room.roomId,
    roomSeq: reassigned.event.roomSeq,
  });
  assert.deepEqual(
    reassignedPush.map(({ principalId }) => principalId),
    [peerProvisioning.principal.principalId],
  );
  assert.match(reassignedPush[0]!.payload.title, /已改派/u);
  const newHost = authenticateHost(kernel, "reassignment-new-host", [
    otherAgent.principalId,
  ]);
  const reassignedActivation = kernel.leaseNextActivation(newHost, {
    leaseMs: 30_000,
  });
  assert.ok(reassignedActivation);
  const reassignedRun = kernel.createRunAttempt(newHost, {
    activationId: reassignedActivation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, newHost, {
    recoveryDescriptor: fakeRecovery("reassignment-new-runtime"),
    runAttemptId: reassignedRun.runAttemptId,
    runtimeRunId: "reassignment-new-runtime",
  });
  const reassignedExecution = kernel.authorizeWorkerExecution(newHost, {
    activationId: reassignedActivation.activationId,
    consumerId: "reassignment-new-consumer",
    hostId: newHost.hostId,
    participantId: otherAgent.principalId,
    roomId: room.roomId,
    runAttemptId: reassignedRun.runAttemptId,
    toSeq: reassignedActivation.toSeq,
  });
  kernel.syncWorker(reassignedExecution, {});
  assert.equal(
    kernel.getWorkerTask(reassignedExecution, {
      taskId: created.task.taskId,
    }).assigneeId,
    otherAgent.principalId,
    "task.reassigned must authorize the new owner's task-get before claim",
  );
  assert.equal(
    kernel.taskReassignment.request(humanActor, {
      assigneeId: otherAgent.principalId,
      basedOnRoomSeq: started.event.roomSeq,
      idempotencyKey: "reassignment-request",
      reason: "The first Agent is unavailable; preserve evidence and hand off",
      taskId: created.task.taskId,
    }).deduplicated,
    true,
  );

  kernel.close();
});

test("Task dependencies stay asleep until completion derives one ready Activation", () => {
  const { agent, humanActor, kernel, otherAgent, otherAgentActor, room } =
    createFixture();
  const prerequisite = kernel.createTask(humanActor, {
    assigneeId: agent.principalId,
    idempotencyKey: "dependency-prerequisite-created",
    roomId: room.roomId,
    title: "Finish the prerequisite",
  });
  const dependent = kernel.createTask(humanActor, {
    assigneeId: otherAgent.principalId,
    dependencyTaskIds: [prerequisite.task.taskId],
    idempotencyKey: "dependent-task-created",
    roomId: room.roomId,
    title: "Wait for the prerequisite",
  });
  const secondDependent = kernel.createTask(humanActor, {
    assigneeId: otherAgent.principalId,
    dependencyTaskIds: [prerequisite.task.taskId],
    idempotencyKey: "second-dependent-task-created",
    roomId: room.roomId,
    title: "Share one dependency-ready Inbox item",
  });
  assert.deepEqual(dependent.task.dependencyTaskIds, [
    prerequisite.task.taskId,
  ]);
  assert.equal(dependent.activationIds.length, 0);
  assert.equal(
    kernel.listInbox(otherAgentActor, { roomId: room.roomId }).length,
    0,
  );

  const firstHost = authenticateHost(kernel, "dependency-host-a", [
    agent.principalId,
  ]);
  const firstActivation = kernel.leaseNextActivation(firstHost, {
    leaseMs: 30_000,
  });
  assert.ok(firstActivation);
  const firstRun = kernel.createRunAttempt(firstHost, {
    activationId: firstActivation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, firstHost, {
    recoveryDescriptor: fakeRecovery("dependency-runtime-a"),
    runAttemptId: firstRun.runAttemptId,
    runtimeRunId: "dependency-runtime-a",
  });
  const firstExecution = kernel.authorizeWorkerExecution(firstHost, {
    activationId: firstActivation.activationId,
    consumerId: "dependency-consumer-a",
    hostId: firstHost.hostId,
    participantId: agent.principalId,
    roomId: room.roomId,
    runAttemptId: firstRun.runAttemptId,
    toSeq: firstActivation.toSeq,
  });
  const firstDelivery = kernel.syncWorker(firstExecution, {});
  kernel.acknowledgeWorkerCursor(firstExecution, {
    throughSeq: firstDelivery.cursorAfter,
  });
  const claimed = kernel.claimTask(firstExecution, {
    basedOnRoomSeq: prerequisite.event.roomSeq,
    idempotencyKey: "dependency-prerequisite-claim",
    leaseMs: 30_000,
    taskId: prerequisite.task.taskId,
  });
  const started = kernel.startTask(firstExecution, {
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: "dependency-prerequisite-start",
    leaseMs: 30_000,
    taskId: prerequisite.task.taskId,
  });
  const submitted = kernel.submitTask(firstExecution, {
    basedOnRoomSeq: started.event.roomSeq,
    idempotencyKey: "dependency-prerequisite-submit",
    summary: "The prerequisite is complete",
    taskId: prerequisite.task.taskId,
  });
  const completed = kernel.completeTask(humanActor, {
    basedOnRoomSeq: submitted.event.roomSeq,
    idempotencyKey: "dependency-prerequisite-complete",
    taskId: prerequisite.task.taskId,
  });
  assert.deepEqual(
    completed.event.payload.readyTaskIds,
    [dependent.task.taskId, secondDependent.task.taskId].sort(),
  );
  assert.equal(
    completed.activationIds.length,
    1,
    "completion must return the exact dependency-ready Activation receipt",
  );
  const dependentInbox = kernel.listInbox(otherAgentActor, {
    roomId: room.roomId,
  });
  assert.equal(dependentInbox.length, 1);
  assert.equal(dependentInbox[0]?.eventId, completed.event.eventId);
  assert.equal(dependentInbox[0]?.reason, "dependency_resolved");
  assert.equal(
    kernel.completeTask(humanActor, {
      basedOnRoomSeq: submitted.event.roomSeq,
      idempotencyKey: "dependency-prerequisite-complete",
      taskId: prerequisite.task.taskId,
    }).deduplicated,
    true,
  );
  assert.equal(
    kernel.listInbox(otherAgentActor, { roomId: room.roomId }).length,
    1,
  );

  const secondHost = authenticateHost(kernel, "dependency-host-b", [
    otherAgent.principalId,
  ]);
  const secondActivation = kernel.leaseNextActivation(secondHost, {
    leaseMs: 30_000,
  });
  assert.ok(secondActivation);
  const secondRun = kernel.createRunAttempt(secondHost, {
    activationId: secondActivation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, secondHost, {
    recoveryDescriptor: fakeRecovery("dependency-runtime-b"),
    runAttemptId: secondRun.runAttemptId,
    runtimeRunId: "dependency-runtime-b",
  });
  const secondExecution = kernel.authorizeWorkerExecution(secondHost, {
    activationId: secondActivation.activationId,
    consumerId: "dependency-consumer-b",
    hostId: secondHost.hostId,
    participantId: otherAgent.principalId,
    roomId: room.roomId,
    runAttemptId: secondRun.runAttemptId,
    toSeq: secondActivation.toSeq,
  });
  const secondDelivery = kernel.syncWorker(secondExecution, {});
  kernel.acknowledgeWorkerCursor(secondExecution, {
    throughSeq: secondDelivery.cursorAfter,
  });
  const dependentClaim = kernel.claimTask(secondExecution, {
    basedOnRoomSeq: completed.event.roomSeq,
    idempotencyKey: "dependent-task-claim",
    leaseMs: 30_000,
    taskId: dependent.task.taskId,
  });
  assert.equal(dependentClaim.task.state, "claimed");
  assert.equal(dependentClaim.task.claimedBy, otherAgent.principalId);

  kernel.close();
});

test("delivery proof and exit zero cannot close an Activation with an unfinished assigned Task", () => {
  const { agent, humanActor, kernel, room } = createFixture();
  const created = kernel.createTask(humanActor, {
    assigneeId: agent.principalId,
    idempotencyKey: "unfinished-task-created",
    roomId: room.roomId,
    title: "Do not confuse delivery with Task submission",
  });
  const host = authenticateHost(kernel, "unfinished-task-host", [
    agent.principalId,
  ]);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, host, {
    recoveryDescriptor: fakeRecovery("unfinished-task-runtime"),
    runAttemptId: run.runAttemptId,
    runtimeRunId: "unfinished-task-runtime",
  });
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: "unfinished-task-consumer",
    hostId: host.hostId,
    participantId: agent.principalId,
    roomId: room.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const delivery = kernel.syncWorker(execution, {});
  kernel.acknowledgeWorkerCursor(execution, {
    throughSeq: delivery.cursorAfter,
  });
  kernel.recordRuntimeTermination(host, {
    exit: { code: 0 },
    runAttemptId: run.runAttemptId,
    runtimeRunId: "unfinished-task-runtime",
  });
  kernel.finishRunAttempt(host, {
    exitCode: 0,
    runAttemptId: run.runAttemptId,
    state: "exited",
  });

  assert.throws(
    () =>
      kernel.completeActivation(host, {
        activationId: activation.activationId,
        consumerId: "unfinished-task-consumer",
      }),
    TaskSubmissionProofError,
  );
  assert.equal(
    kernel.listActivations({ roomId: room.roomId })[0]?.state,
    "leased",
  );
  assert.equal(created.task.state, "todo");

  kernel.close();
});

test("Task commands reject wrong assignees and relevant stale context without cross-Task blocking", () => {
  const { agent, humanActor, kernel, otherAgent, room } = createFixture();
  const created = kernel.createTask(humanActor, {
    assigneeId: agent.principalId,
    idempotencyKey: "task-guard-create",
    roomId: room.roomId,
    title: "Guard the Task state machine",
  });

  const otherHost = authenticateHost(kernel, "other-task-host", [
    otherAgent.principalId,
  ]);
  const otherActivationMessage = kernel.postMessage(humanActor, {
    body: "Unrelated work for the other Agent",
    idempotencyKey: "other-task-activation",
    recipients: [{ participantId: otherAgent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });
  const otherActivation = kernel.leaseNextActivation(otherHost, {
    leaseMs: 30_000,
  });
  assert.ok(otherActivation);
  const otherRun = kernel.createRunAttempt(otherHost, {
    activationId: otherActivation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, otherHost, {
    recoveryDescriptor: fakeRecovery("other-task-runtime"),
    runAttemptId: otherRun.runAttemptId,
    runtimeRunId: "other-task-runtime",
  });
  const otherExecution = kernel.authorizeWorkerExecution(otherHost, {
    activationId: otherActivation.activationId,
    consumerId: "other-task-consumer",
    hostId: otherHost.hostId,
    participantId: otherAgent.principalId,
    roomId: room.roomId,
    runAttemptId: otherRun.runAttemptId,
    toSeq: otherActivation.toSeq,
  });
  assert.throws(
    () =>
      kernel.claimTask(otherExecution, {
        basedOnRoomSeq: otherActivationMessage.event.roomSeq,
        idempotencyKey: "wrong-assignee-claim",
        leaseMs: 1_000,
        taskId: created.task.taskId,
      }),
    ForbiddenError,
  );

  const host = authenticateHost(kernel, "assigned-task-host", [
    agent.principalId,
  ]);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, host, {
    recoveryDescriptor: fakeRecovery("assigned-task-runtime"),
    runAttemptId: run.runAttemptId,
    runtimeRunId: "assigned-task-runtime",
  });
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: "assigned-task-consumer",
    hostId: host.hostId,
    participantId: agent.principalId,
    roomId: room.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });

  const claimed = kernel.claimTask(execution, {
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: "cross-task-safe-claim",
    leaseMs: 1_000,
    taskId: created.task.taskId,
  });
  assert.equal(claimed.task.state, "claimed");

  kernel.postMessage(humanActor, {
    body: "This update is directed to the assigned Agent",
    idempotencyKey: "assigned-agent-context-update",
    recipients: [{ participantId: agent.principalId, reason: "mention" }],
    roomId: room.roomId,
  });
  assert.throws(
    () =>
      kernel.startTask(execution, {
        basedOnRoomSeq: claimed.event.roomSeq,
        idempotencyKey: "relevant-stale-task-start",
        leaseMs: 1_000,
        taskId: created.task.taskId,
      }),
    StaleContextError,
    "a newer event addressed to this Agent invalidates its older context",
  );

  kernel.close();
});

test("an expired Task claim can be explicitly reclaimed without changing Activation ownership", () => {
  const { agent, clock, humanActor, kernel, room } = createFixture();
  const created = kernel.createTask(humanActor, {
    assigneeId: agent.principalId,
    idempotencyKey: "task-reclaim-create",
    roomId: room.roomId,
    title: "Exercise Task reclaim",
  });
  const host = authenticateHost(kernel, "task-reclaim-host", [
    agent.principalId,
  ]);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, host, {
    recoveryDescriptor: fakeRecovery("task-reclaim-runtime"),
    runAttemptId: run.runAttemptId,
    runtimeRunId: "task-reclaim-runtime",
  });
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: "task-reclaim-consumer",
    hostId: host.hostId,
    participantId: agent.principalId,
    roomId: room.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });

  const currentClaim = kernel.claimTask(execution, {
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: "task-current-claim",
    leaseMs: 1_000,
    taskId: created.task.taskId,
  });
  assert.throws(
    () =>
      kernel.claimTask(execution, {
        basedOnRoomSeq: currentClaim.event.roomSeq,
        idempotencyKey: "task-competing-claim",
        leaseMs: 1_000,
        taskId: created.task.taskId,
      }),
    ConflictError,
  );

  clock.advance(1_001);
  const reclaimed = kernel.claimTask(execution, {
    basedOnRoomSeq: currentClaim.event.roomSeq,
    idempotencyKey: "task-expired-reclaim",
    leaseMs: 1_000,
    taskId: created.task.taskId,
  });
  assert.equal(reclaimed.task.state, "claimed");
  assert.equal(reclaimed.event.payload.previousState, "claimed");
  assert.equal(activation.state, "leased");

  kernel.close();
});

test("Task claim heartbeat renews the canonical lease without advancing Room business history", () => {
  const { agent, clock, humanActor, kernel, room } = createFixture();
  const created = kernel.createTask(humanActor, {
    assigneeId: agent.principalId,
    idempotencyKey: "task-heartbeat-create",
    roomId: room.roomId,
    title: "Keep a long-running Task claim alive",
  });
  const host = authenticateHost(kernel, "task-heartbeat-host", [
    agent.principalId,
  ]);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, host, {
    recoveryDescriptor: fakeRecovery("task-heartbeat-runtime"),
    runAttemptId: run.runAttemptId,
    runtimeRunId: "task-heartbeat-runtime",
  });
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: "task-heartbeat-consumer",
    hostId: host.hostId,
    participantId: agent.principalId,
    roomId: room.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const claimed = kernel.claimTask(execution, {
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: "task-heartbeat-claim",
    leaseMs: 1_000,
    taskId: created.task.taskId,
  });
  assert.equal(
    kernel.getWorkerTask(execution, { taskId: created.task.taskId }).state,
    "claimed",
  );
  const roomSeqBeforeHeartbeat = kernel.sync(humanActor, {
    consumerId: "task-heartbeat-observer",
    roomId: room.roomId,
  }).latestRoomSeq;
  const outboxCountBeforeHeartbeat = kernel.listOutbox().length;

  clock.advance(800);
  const renewed = kernel.heartbeatTaskClaim(execution, {
    leaseMs: 1_000,
    taskId: created.task.taskId,
  });
  assert.ok(
    Date.parse(renewed.claimUntil ?? "") >
      Date.parse(claimed.task.claimUntil ?? ""),
  );
  assert.equal(
    kernel.sync(humanActor, {
      consumerId: "task-heartbeat-observer",
      roomId: room.roomId,
    }).latestRoomSeq,
    roomSeqBeforeHeartbeat,
  );
  assert.equal(kernel.listOutbox().length, outboxCountBeforeHeartbeat);

  clock.advance(300);
  const started = kernel.startTask(execution, {
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: "task-heartbeat-start",
    leaseMs: 1_000,
    taskId: created.task.taskId,
  });
  assert.equal(started.task.state, "in_progress");

  clock.advance(1_001);
  assert.throws(
    () =>
      kernel.heartbeatTaskClaim(execution, {
        leaseMs: 1_000,
        taskId: created.task.taskId,
      }),
    LeaseConflictError,
  );

  kernel.close();
});

test("InputRequest suspends a Task and a human resolution creates a new proven Activation", () => {
  const {
    agent,
    agentActor,
    human,
    humanActor,
    kernel,
    otherAgentActor,
    room,
  } = createFixture();
  const created = kernel.createTask(humanActor, {
    assigneeId: agent.principalId,
    idempotencyKey: "input-task-create",
    roomId: room.roomId,
    title: "Wait without keeping a model alive",
  });
  const host = authenticateHost(kernel, "input-task-host", [agent.principalId]);
  const firstActivation = kernel.leaseNextActivation(host, {
    leaseMs: 30_000,
  });
  assert.ok(firstActivation);
  const firstRun = kernel.createRunAttempt(host, {
    activationId: firstActivation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, host, {
    recoveryDescriptor: fakeRecovery("input-task-runtime-1"),
    runAttemptId: firstRun.runAttemptId,
    runtimeRunId: "input-task-runtime-1",
  });
  const firstExecution = kernel.authorizeWorkerExecution(host, {
    activationId: firstActivation.activationId,
    consumerId: "input-task-consumer",
    hostId: host.hostId,
    participantId: agent.principalId,
    roomId: room.roomId,
    runAttemptId: firstRun.runAttemptId,
    toSeq: firstActivation.toSeq,
  });
  const firstDelivery = kernel.syncWorker(firstExecution, {});
  assert.equal(
    kernel.getWorkerTaskInputStatus(firstExecution, {
      taskId: created.task.taskId,
    }),
    null,
  );
  kernel.acknowledgeWorkerCursor(firstExecution, {
    throughSeq: firstDelivery.cursorAfter,
  });
  const claimed = kernel.claimTask(firstExecution, {
    basedOnRoomSeq: firstDelivery.cursorAfter,
    idempotencyKey: "input-task-claim",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const started = kernel.startTask(firstExecution, {
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: "input-task-start",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const requested = kernel.requestTaskInput(firstExecution, {
    basedOnRoomSeq: started.event.roomSeq,
    idempotencyKey: "input-task-request",
    question: "Should the daemon bind beyond loopback?",
    taskId: created.task.taskId,
  });
  assert.equal(requested.task.state, "waiting_input");
  assert.equal(requested.task.claimedBy, undefined);
  assert.equal(requested.inputRequest.state, "pending");
  assert.equal(requested.inputRequest.requesterId, agent.principalId);
  assert.equal(requested.inputRequest.responderId, human.principalId);
  assert.equal(requested.event.type, "input.requested");
  const inputRequestPush = kernel.humanNotifications.webPush.project({
    roomId: room.roomId,
    roomSeq: requested.event.roomSeq,
  });
  assert.deepEqual(
    inputRequestPush.map(({ principalId }) => principalId),
    [human.principalId],
  );
  assert.equal(inputRequestPush[0]!.payload.target.kind, "input_request");
  assert.match(inputRequestPush[0]!.payload.title, /请求输入/u);
  assert.deepEqual(
    kernel.getWorkerTaskInputStatus(firstExecution, {
      taskId: created.task.taskId,
    }),
    {
      inputRequestId: requested.inputRequest.inputRequestId,
      state: "pending",
      taskId: created.task.taskId,
    },
  );
  const replayedRequest = kernel.requestTaskInput(firstExecution, {
    basedOnRoomSeq: firstActivation.toSeq,
    idempotencyKey: "input-task-request",
    question: "Should the daemon bind beyond loopback?",
    taskId: created.task.taskId,
  });
  assert.equal(replayedRequest.deduplicated, true);
  assert.equal(
    replayedRequest.inputRequest.inputRequestId,
    requested.inputRequest.inputRequestId,
  );
  assert.equal(
    kernel.listInputRequests(humanActor, { roomId: room.roomId })[0]?.state,
    "pending",
  );
  assert.equal(
    kernel
      .listInbox(humanActor, { roomId: room.roomId })
      .some((item) => item.eventId === requested.event.eventId),
    true,
  );
  assert.equal(
    kernel.listActivations({
      participantId: human.principalId,
      roomId: room.roomId,
    }).length,
    0,
    "requesting human input creates Inbox attention, not an Agent Activation",
  );

  const humanCursor = kernel.sync(humanActor, {
    consumerId: "input-task-human",
    roomId: room.roomId,
  }).latestRoomSeq;
  assert.throws(
    () =>
      kernel.resolveInputRequest(otherAgentActor, {
        answer: "An undesignated participant cannot answer",
        basedOnRoomSeq: humanCursor,
        idempotencyKey: "input-task-wrong-responder",
        inputRequestId: requested.inputRequest.inputRequestId,
      }),
    ForbiddenError,
  );
  const resolved = kernel.resolveInputRequest(humanActor, {
    answer: "Keep loopback-only for this phase",
    basedOnRoomSeq: humanCursor,
    idempotencyKey: "input-task-resolve",
    inputRequestId: requested.inputRequest.inputRequestId,
  });
  assert.equal(resolved.inputRequest.state, "resolved");
  assert.equal(resolved.inputRequest.resolvedBy, human.principalId);
  assert.equal(resolved.task.state, "todo");
  assert.equal(resolved.event.type, "input.resolved");
  assert.equal(resolved.activationIds.length, 1);
  assert.equal(
    kernel.resolveInputRequest(humanActor, {
      answer: "Keep loopback-only for this phase",
      basedOnRoomSeq: humanCursor,
      idempotencyKey: "input-task-resolve",
      inputRequestId: requested.inputRequest.inputRequestId,
    }).deduplicated,
    true,
  );
  assert.throws(
    () =>
      kernel.resolveInputRequest(humanActor, {
        answer: "A different answer cannot reuse the same key",
        basedOnRoomSeq: humanCursor,
        idempotencyKey: "input-task-resolve",
        inputRequestId: requested.inputRequest.inputRequestId,
      }),
    IdempotencyConflictError,
  );
  assert.deepEqual(
    kernel.getWorkerTaskInputStatus(firstExecution, {
      taskId: created.task.taskId,
    }),
    {
      inputRequestId: requested.inputRequest.inputRequestId,
      state: "resolved",
      taskId: created.task.taskId,
    },
    "the old execution can observe only the pause status, not the answer",
  );

  kernel.recordRuntimeTermination(host, {
    exit: { code: 0 },
    runAttemptId: firstRun.runAttemptId,
    runtimeRunId: "input-task-runtime-1",
  });
  kernel.finishRunAttempt(host, {
    exitCode: 0,
    runAttemptId: firstRun.runAttemptId,
    state: "exited",
  });
  assert.equal(
    kernel.completeActivation(host, {
      activationId: firstActivation.activationId,
      consumerId: "input-task-consumer",
    }).state,
    "completed",
    "a fast human resolution must not make the requesting Activation retry",
  );

  const secondActivation = kernel.leaseNextActivation(host, {
    leaseMs: 30_000,
  });
  assert.ok(secondActivation);
  assert.notEqual(secondActivation.activationId, firstActivation.activationId);
  assert.equal(secondActivation.reason, "input_resolved");
  const secondRun = kernel.createRunAttempt(host, {
    activationId: secondActivation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, host, {
    recoveryDescriptor: fakeRecovery("input-task-runtime-2"),
    runAttemptId: secondRun.runAttemptId,
    runtimeRunId: "input-task-runtime-2",
  });
  const secondExecution = kernel.authorizeWorkerExecution(host, {
    activationId: secondActivation.activationId,
    consumerId: "input-task-consumer",
    hostId: host.hostId,
    participantId: agent.principalId,
    roomId: room.roomId,
    runAttemptId: secondRun.runAttemptId,
    toSeq: secondActivation.toSeq,
  });
  const secondDelivery = kernel.syncWorker(secondExecution, {});
  assert.equal(
    secondDelivery.events.some(
      (event) =>
        event.type === "input.resolved" &&
        event.payload.answer === "Keep loopback-only for this phase",
    ),
    true,
  );
  assert.equal(
    kernel.getWorkerTask(secondExecution, { taskId: created.task.taskId })
      .state,
    "todo",
    "input.resolved links the existing Task into the new Activation scope",
  );
  kernel.acknowledgeWorkerCursor(secondExecution, {
    throughSeq: secondDelivery.cursorAfter,
  });
  kernel.recordRuntimeTermination(host, {
    exit: { code: 0 },
    runAttemptId: secondRun.runAttemptId,
    runtimeRunId: "input-task-runtime-2",
  });
  kernel.finishRunAttempt(host, {
    exitCode: 0,
    runAttemptId: secondRun.runAttemptId,
    state: "exited",
  });
  assert.throws(
    () =>
      kernel.completeActivation(host, {
        activationId: secondActivation.activationId,
        consumerId: "input-task-consumer",
      }),
    TaskSubmissionProofError,
    "the resolution Activation cannot finish while the resumed Task is todo",
  );
  assert.equal(
    kernel
      .listInbox(agentActor, { roomId: room.roomId })
      .some((item) => item.eventId === resolved.event.eventId),
    true,
  );

  kernel.close();
});

test("cancelling a waiting Task atomically terminates its pending InputRequest", () => {
  const { agent, databasePath, human, humanActor, kernel, room } =
    createFixture();
  const created = kernel.createTask(humanActor, {
    assigneeId: agent.principalId,
    idempotencyKey: "cancel-input-task-create",
    roomId: room.roomId,
    title: "Do not leave a ghost Human action",
  });
  const host = authenticateHost(kernel, "cancel-input-host", [
    agent.principalId,
  ]);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, host, {
    recoveryDescriptor: fakeRecovery("cancel-input-runtime"),
    runAttemptId: run.runAttemptId,
    runtimeRunId: "cancel-input-runtime",
  });
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: "cancel-input-consumer",
    hostId: host.hostId,
    participantId: agent.principalId,
    roomId: room.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const delivery = kernel.syncWorker(execution, {});
  kernel.acknowledgeWorkerCursor(execution, {
    throughSeq: delivery.cursorAfter,
  });
  const claimed = kernel.claimTask(execution, {
    basedOnRoomSeq: delivery.cursorAfter,
    idempotencyKey: "cancel-input-task-claim",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const started = kernel.startTask(execution, {
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: "cancel-input-task-start",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const requested = kernel.requestTaskInput(execution, {
    basedOnRoomSeq: started.event.roomSeq,
    idempotencyKey: "cancel-input-request",
    question: "Should this work continue?",
    taskId: created.task.taskId,
  });

  const cancelled = kernel.cancelTask(humanActor, {
    basedOnRoomSeq: requested.event.roomSeq,
    idempotencyKey: "cancel-waiting-input-task",
    reason: "The requirement was withdrawn",
    taskId: created.task.taskId,
  });
  assert.equal(cancelled.task.state, "cancelled");
  assert.equal(
    cancelled.event.payload.cancelledInputRequestId,
    requested.inputRequest.inputRequestId,
  );
  assert.deepEqual(
    kernel.listInputRequests(humanActor, { roomId: room.roomId })[0],
    {
      ...requested.inputRequest,
      cancelledAt: cancelled.task.cancelledAt,
      cancelledBy: human.principalId,
      cancellationReason: "The requirement was withdrawn",
      state: "cancelled",
      updatedAt: cancelled.task.cancelledAt,
    },
  );
  assert.throws(
    () =>
      kernel.resolveInputRequest(humanActor, {
        answer: "A cancelled request must stay terminal",
        basedOnRoomSeq: cancelled.event.roomSeq,
        idempotencyKey: "resolve-cancelled-input",
        inputRequestId: requested.inputRequest.inputRequestId,
      }),
    ConflictError,
  );
  assert.throws(
    () =>
      kernel.humanNavigation.resolve(humanActor, {
        target: {
          inputRequestId: requested.inputRequest.inputRequestId,
          kind: "input_request",
          roomId: room.roomId,
          taskId: created.task.taskId,
        },
      }),
    ForbiddenError,
  );
  assert.equal(
    kernel.cancelTask(humanActor, {
      basedOnRoomSeq: requested.event.roomSeq,
      idempotencyKey: "cancel-waiting-input-task",
      reason: "The requirement was withdrawn",
      taskId: created.task.taskId,
    }).deduplicated,
    true,
  );

  const reopened = kernel.reopenTask(humanActor, {
    basedOnRoomSeq: cancelled.event.roomSeq,
    idempotencyKey: "reopen-after-cancelled-input",
    taskId: created.task.taskId,
  });
  assert.equal(reopened.task.state, "todo");
  assert.equal(
    kernel.listInputRequests(humanActor, { roomId: room.roomId })[0]?.state,
    "cancelled",
  );
  const database = new DatabaseSync(databasePath);
  assert.equal(
    (
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM input_requests WHERE task_id = ? AND state = 'pending'",
        )
        .get(created.task.taskId) as { count: number }
    ).count,
    0,
  );
  database.close();
  kernel.close();
});

test("current schema preserves legacy InputRequests while adding Room deletion receipts", () => {
  const { agent, databasePath, human, humanActor, kernel, room } =
    createFixture();
  const created = kernel.createTask(humanActor, {
    assigneeId: agent.principalId,
    idempotencyKey: "input-v38-task",
    roomId: room.roomId,
    title: "Preserve legacy input",
  });
  kernel.close();

  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    DROP INDEX idx_input_requests_room_state;
    DROP INDEX idx_one_pending_input_per_task;
    ALTER TABLE input_requests RENAME TO input_requests_v38_source;
    CREATE TABLE input_requests (
      input_request_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(room_id),
      task_id TEXT NOT NULL REFERENCES tasks(task_id),
      requester_id TEXT NOT NULL REFERENCES principals(principal_id),
      responder_id TEXT NOT NULL REFERENCES principals(principal_id),
      question TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'resolved')),
      answer TEXT,
      resolved_by TEXT REFERENCES principals(principal_id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT
    ) STRICT;
  `);
  legacy
    .prepare(
      `INSERT INTO input_requests(
         input_request_id, room_id, task_id, requester_id, responder_id,
         question, state, created_at, updated_at
       ) VALUES(?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(
      "input-legacy-v37",
      room.roomId,
      created.task.taskId,
      agent.principalId,
      human.principalId,
      "Preserve this pending request",
      "2026-08-25T01:00:00.000Z",
      "2026-08-25T01:00:00.000Z",
    );
  legacy.exec(`
    DROP TABLE input_requests_v38_source;
    CREATE INDEX idx_input_requests_room_state
      ON input_requests(room_id, state, created_at, input_request_id);
    CREATE UNIQUE INDEX idx_one_pending_input_per_task
      ON input_requests(task_id) WHERE state = 'pending';
    PRAGMA user_version = 37;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
  legacy.close();

  const migratedKernel = new RoomKernel({ databasePath });
  migratedKernel.initialize();
  migratedKernel.close();
  const migrated = new DatabaseSync(databasePath);
  assert.equal(
    (
      migrated.prepare("PRAGMA user_version").get() as {
        user_version: number;
      }
    ).user_version,
    KERNEL_SCHEMA_VERSION,
  );
  assert.deepEqual(
    migrated
      .prepare("PRAGMA table_info(input_requests)")
      .all()
      .map((row) => (row as { name: string }).name)
      .filter((name) => name.startsWith("cancel")),
    ["cancelled_at", "cancelled_by", "cancellation_reason"],
  );
  assert.equal(
    (
      migrated.prepare("SELECT workflow_status FROM tasks LIMIT 1").get() as {
        workflow_status: string;
      }
    ).workflow_status,
    "todo",
  );
  assert.deepEqual(
    migrated
      .prepare(
        `SELECT input_request_id, state, question, cancelled_at,
                cancelled_by, cancellation_reason
         FROM input_requests`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        cancellation_reason: null,
        cancelled_at: null,
        cancelled_by: null,
        input_request_id: "input-legacy-v37",
        question: "Preserve this pending request",
        state: "pending",
      },
    ],
  );
  assert.deepEqual(migrated.prepare("PRAGMA foreign_key_check").all(), []);
  migrated.close();
});

test("the minimal InputRequest policy fails closed when a Task creator is not human", () => {
  const { agent, agentActor, kernel, otherAgent, room } = createFixture();
  const creatorCursor = kernel.sync(agentActor, {
    consumerId: "agent-created-task",
    roomId: room.roomId,
  }).latestRoomSeq;
  const created = kernel.createTask(agentActor, {
    assigneeId: otherAgent.principalId,
    basedOnRoomSeq: creatorCursor,
    idempotencyKey: "agent-created-input-task",
    roomId: room.roomId,
    title: "Do not create an unanswerable InputRequest",
  });
  const host = authenticateHost(kernel, "agent-created-input-host", [
    otherAgent.principalId,
  ]);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, host, {
    recoveryDescriptor: fakeRecovery("agent-created-input-runtime"),
    runAttemptId: run.runAttemptId,
    runtimeRunId: "agent-created-input-runtime",
  });
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: "agent-created-input-consumer",
    hostId: host.hostId,
    participantId: otherAgent.principalId,
    roomId: room.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const delivery = kernel.syncWorker(execution, {});
  const claimed = kernel.claimTask(execution, {
    basedOnRoomSeq: delivery.cursorAfter,
    idempotencyKey: "agent-created-input-claim",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const started = kernel.startTask(execution, {
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: "agent-created-input-start",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });

  assert.throws(
    () =>
      kernel.requestTaskInput(execution, {
        basedOnRoomSeq: started.event.roomSeq,
        idempotencyKey: "agent-created-input-request",
        question: "This must not enter an Agent Inbox without an Activation",
        taskId: created.task.taskId,
      }),
    ConflictError,
  );
  assert.equal(
    kernel.listInputRequests(agentActor, { roomId: room.roomId }).length,
    0,
  );
  assert.equal(
    kernel.listTasks(agentActor, { roomId: room.roomId })[0]?.state,
    "in_progress",
  );

  kernel.close();
});

test("a retried RunAttempt replays stable Task command idempotency", () => {
  const { agent, humanActor, kernel, room } = createFixture();
  const created = kernel.createTask(humanActor, {
    assigneeId: agent.principalId,
    idempotencyKey: "task-run-retry-create",
    roomId: room.roomId,
    title: "Survive a Worker response loss",
  });
  const host = authenticateHost(kernel, "task-run-retry-host", [
    agent.principalId,
  ]);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation);
  const firstRun = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, host, {
    recoveryDescriptor: fakeRecovery("task-run-retry-runtime-1"),
    runAttemptId: firstRun.runAttemptId,
    runtimeRunId: "task-run-retry-runtime-1",
  });
  const firstExecution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: "task-run-retry-consumer",
    hostId: host.hostId,
    participantId: agent.principalId,
    roomId: room.roomId,
    runAttemptId: firstRun.runAttemptId,
    toSeq: activation.toSeq,
  });
  const claimCommand = {
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: `task:${created.task.taskId}:claim`,
    leaseMs: 30_000,
    taskId: created.task.taskId,
  };
  const firstClaim = kernel.claimTask(firstExecution, claimCommand);
  const firstStart = kernel.startTask(firstExecution, {
    basedOnRoomSeq: firstClaim.event.roomSeq,
    idempotencyKey: `task:${created.task.taskId}:start`,
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  assert.equal(firstStart.task.state, "in_progress");

  kernel.recordRuntimeTermination(host, {
    exit: { code: 7 },
    runAttemptId: firstRun.runAttemptId,
    runtimeRunId: "task-run-retry-runtime-1",
  });
  kernel.finishRunAttempt(host, {
    error: "response lost after claim",
    exitCode: 7,
    runAttemptId: firstRun.runAttemptId,
    state: "failed",
  });
  kernel.retryActivation(host, {
    activationId: activation.activationId,
    error: "response lost after claim",
    retryAfterMs: 0,
  });

  const retriedActivation = kernel.leaseNextActivation(host, {
    leaseMs: 30_000,
  });
  assert.ok(retriedActivation);
  assert.equal(retriedActivation.activationId, activation.activationId);
  const secondRun = kernel.createRunAttempt(host, {
    activationId: retriedActivation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, host, {
    recoveryDescriptor: fakeRecovery("task-run-retry-runtime-2"),
    runAttemptId: secondRun.runAttemptId,
    runtimeRunId: "task-run-retry-runtime-2",
  });
  const secondExecution = kernel.authorizeWorkerExecution(host, {
    activationId: retriedActivation.activationId,
    consumerId: "task-run-retry-consumer",
    hostId: host.hostId,
    participantId: agent.principalId,
    roomId: room.roomId,
    runAttemptId: secondRun.runAttemptId,
    toSeq: retriedActivation.toSeq,
  });
  const replayedClaim = kernel.claimTask(secondExecution, claimCommand);
  assert.equal(replayedClaim.deduplicated, true);
  assert.equal(replayedClaim.event.eventId, firstClaim.event.eventId);
  assert.equal(replayedClaim.task.state, "in_progress");
  const replayedStart = kernel.startTask(secondExecution, {
    basedOnRoomSeq: retriedActivation.toSeq,
    idempotencyKey: `task:${created.task.taskId}:start`,
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  assert.equal(replayedStart.deduplicated, true);
  assert.equal(replayedStart.event.eventId, firstStart.event.eventId);
  const resumedProgress = kernel.progressTask(secondExecution, {
    basedOnRoomSeq: retriedActivation.toSeq,
    idempotencyKey: `task:${created.task.taskId}:progress`,
    leaseMs: 30_000,
    progress: "Continued from canonical Task state",
    taskId: created.task.taskId,
  });
  assert.equal(resumedProgress.task.state, "in_progress");
  assert.equal(resumedProgress.deduplicated, false);

  kernel.close();
});

test("Outbox delivery is leased, recoverable, acknowledged, and retryable", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-outbox-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "room.db");
  const clock = createClock();
  const kernel = new RoomKernel({ databasePath, now: clock.now });
  kernel.initialize();
  const humanProvisioning = kernel.provisionPrincipal({
    handle: "outbox-human",
    kind: "human",
  });
  const agentProvisioning = kernel.provisionPrincipal({
    handle: "outbox-agent",
    kind: "agent",
  });
  const humanActor = kernel.authenticateAccessToken(
    humanProvisioning.accessToken,
  );
  const room = kernel.createRoom(humanActor, {
    name: "Outbox room",
    slug: "outbox-room",
  });

  const competingKernel = new RoomKernel({ databasePath, now: clock.now });
  competingKernel.initialize();
  const first = kernel.leaseNextOutbox({
    dispatcherId: "dispatcher-a",
    leaseMs: 1_000,
  });
  assert.ok(first);
  assert.equal(
    competingKernel.leaseNextOutbox({
      dispatcherId: "dispatcher-b",
      leaseMs: 1_000,
    }),
    null,
  );

  clock.advance(1_001);
  const recovered = competingKernel.leaseNextOutbox({
    dispatcherId: "dispatcher-b",
    leaseMs: 1_000,
  });
  assert.equal(recovered?.outboxId, first.outboxId);
  assert.equal(recovered?.attemptCount, 2);
  assert.throws(
    () =>
      kernel.acknowledgeOutboxPublished({
        dispatcherId: "dispatcher-a",
        outboxId: first.outboxId,
      }),
    LeaseConflictError,
  );
  competingKernel.acknowledgeOutboxPublished({
    dispatcherId: "dispatcher-b",
    outboxId: first.outboxId,
  });
  assert.equal(
    competingKernel.leaseNextOutbox({
      dispatcherId: "dispatcher-b",
      leaseMs: 1_000,
    }),
    null,
  );

  kernel.addMember(humanActor, {
    principalId: agentProvisioning.principal.principalId,
    roomId: room.roomId,
  });
  const retryable = competingKernel.leaseNextOutbox({
    dispatcherId: "dispatcher-b",
    leaseMs: 1_000,
  });
  assert.ok(retryable);
  competingKernel.retryOutbox({
    dispatcherId: "dispatcher-b",
    error: "temporary transport failure",
    outboxId: retryable.outboxId,
    retryAfterMs: 2_000,
  });
  assert.equal(
    competingKernel.leaseNextOutbox({
      dispatcherId: "dispatcher-b",
      leaseMs: 1_000,
    }),
    null,
  );
  clock.advance(2_001);
  const retried = competingKernel.leaseNextOutbox({
    dispatcherId: "dispatcher-b",
    leaseMs: 1_000,
  });
  assert.equal(retried?.outboxId, retryable.outboxId);
  assert.equal(retried?.attemptCount, 2);

  competingKernel.close();
  kernel.close();
});

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

async function* bytes(value: string) {
  yield Buffer.from(value);
}
