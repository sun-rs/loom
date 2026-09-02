import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { afterEach } from "node:test";

import type { RuntimeCertification, RuntimeOffer } from "@rah-os/protocol";

import {
  computeRuntimeCertificationDigest,
  ExecutionFencedError,
  KERNEL_SCHEMA_VERSION,
  RoomKernel,
  RuntimeTerminationProofError,
  type AuthenticatedHostContext,
} from "../src/index.ts";

const temporaryDirectories: string[] = [];
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const runtimeCertificationContent = {
  capabilities: ["worker_commands"],
  certificationId: "certification-worker-process-v1",
  maximumIsolation: "process",
  protocolFamily: "rah-worker-process/v1",
  runtimeProfileDigest: digest("d"),
} satisfies Omit<RuntimeCertification, "certificationDigest">;
const runtimeCertification: RuntimeCertification = {
  ...runtimeCertificationContent,
  certificationDigest: computeRuntimeCertificationDigest(
    runtimeCertificationContent,
  ),
};

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { force: true, recursive: true });
  }
});

function createClock(initial = "2026-08-26T00:00:00.000Z") {
  let now = new Date(initial).getTime();
  return {
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    now: () => new Date(now),
  };
}

function latestRoomSeq(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  roomId: string,
): number {
  return kernel.sync(actor, {
    afterSeq: 0,
    consumerId: "placement-test",
    roomId,
  }).latestRoomSeq;
}

function authenticateHost(
  kernel: RoomKernel,
  hostId: string,
  participants: string | string[],
): AuthenticatedHostContext {
  const participantIds = Array.isArray(participants)
    ? participants
    : [participants];
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId,
      participantIds,
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  return host;
}

function runtimeOffer(
  host: AuthenticatedHostContext,
  runtimeOfferId: string,
  overrides: Partial<RuntimeOffer> = {},
): RuntimeOffer {
  return {
    capacityPoolIds: ["pool-shared"],
    certificationRefs: [
      {
        certificationDigest: runtimeCertification.certificationDigest,
        certificationId: runtimeCertification.certificationId,
      },
    ],
    capabilityEvidence: [
      { capability: "worker_commands", evidence: "certified" },
    ],
    hostId: host.hostId,
    hostInstanceId: host.instanceId,
    isolation: { evidence: "certified", level: "process" },
    leaseUntil: "2026-08-26T01:00:00.000Z",
    maxConcurrent: 1,
    modelBindingDescriptors: [],
    observedAt: "2026-08-26T00:00:00.000Z",
    protocolFamily: "rah-worker-process/v1",
    revisionDigest: digest("d"),
    runtimeOfferId,
    runtimeProfileId: `profile-${runtimeOfferId}`,
    runtimeProfileRevisionId: `profile-${runtimeOfferId}-v1`,
    state: "available",
    workspaceMountDescriptors: [
      {
        modes: ["in_place"],
        workspaceDefinitionId: "workspace-main",
        workspaceMountDigest: digest("e"),
        workspaceMountRevisionId: `mount-${runtimeOfferId}-v1`,
      },
    ],
    ...overrides,
  };
}

function createFixture(
  options: { trustedRuntimeCertification?: boolean } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-placement-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "room.db");
  const clock = createClock();
  const kernel = new RoomKernel({
    databasePath,
    now: clock.now,
    runtimeCertifications:
      options.trustedRuntimeCertification === false
        ? []
        : [runtimeCertification],
  });
  kernel.initialize();

  const humanProvisioning = kernel.provisionPrincipal({
    handle: "human",
    kind: "human",
  });
  const agentProvisioning = kernel.provisionPrincipal({
    handle: "agent",
    kind: "agent",
  });
  const humanActor = kernel.authenticateAccessToken(
    humanProvisioning.accessToken,
  );
  const workspace = kernel.createWorkspace(humanActor, {
    idempotencyKey: "placement-workspace-created",
    name: "Placement Workspace",
    slug: "placement-workspace",
  });
  const controlRoom = workspace.controlRoom;
  const room = kernel.createWorkspaceRoom(humanActor, {
    basedOnControlRoomSeq: workspace.event.roomSeq,
    idempotencyKey: "placement-work-room-created",
    kind: "channel",
    name: "Placement Work Room",
    slug: "placement-work-room",
    workspaceId: workspace.workspace.workspaceId,
  }).room;
  for (const roomId of [controlRoom.roomId, room.roomId]) {
    kernel.addMember(humanActor, {
      principalId: agentProvisioning.principal.principalId,
      roomId,
    });
  }

  const policyMutation = kernel.createExecutionPolicy(humanActor, {
    basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoom.roomId),
    controlRoomId: controlRoom.roomId,
    idempotencyKey: "policy-create",
    modelIntent: {
      fallback: "disabled",
      reasoning: "default",
      serviceTier: "default",
    },
    preferred: [],
    required: {
      allowedProtocolFamilies: ["rah-worker-process/v1"],
      capabilities: [
        { capability: "worker_commands", minimumEvidence: "probed" },
      ],
      minimumIsolation: "process",
      workspaceMode: "in_place",
    },
    retryPolicyRef: {
      artifactId: "retry-policy",
      contentDigest: digest("a"),
      versionId: "retry-policy-v1",
    },
    sessionPolicy: "fresh",
  });
  const agentMutation = kernel.createAgentDefinition(humanActor, {
    basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoom.roomId),
    controlRoomId: controlRoom.roomId,
    executionPolicyRevisionId: policyMutation.policy.executionPolicyRevisionId,
    idempotencyKey: "agent-create",
    instructionRefs: [],
    memoryPolicyRef: {
      artifactId: "memory-policy",
      contentDigest: digest("b"),
      versionId: "memory-policy-v1",
    },
    participantId: agentProvisioning.principal.principalId,
    role: "implementation agent",
    skillRefs: [],
  });

  return {
    agentDefinition: agentMutation.definition,
    agentDefinitionRevision: agentMutation.revision,
    agentId: agentProvisioning.principal.principalId,
    clock,
    controlRoom,
    databasePath,
    humanActor,
    kernel,
    policy: policyMutation.policy,
    room,
  };
}

function addAgent(
  fixture: ReturnType<typeof createFixture>,
  handle: string,
  idempotencyKey: string,
): string {
  const participant = fixture.kernel.provisionPrincipal({
    handle,
    kind: "agent",
  }).principal;
  fixture.kernel.addMember(fixture.humanActor, {
    principalId: participant.principalId,
    roomId: fixture.room.roomId,
  });
  fixture.kernel.addMember(fixture.humanActor, {
    principalId: participant.principalId,
    roomId: fixture.controlRoom.roomId,
  });
  fixture.kernel.createAgentDefinition(fixture.humanActor, {
    basedOnRoomSeq: latestRoomSeq(
      fixture.kernel,
      fixture.humanActor,
      fixture.controlRoom.roomId,
    ),
    controlRoomId: fixture.controlRoom.roomId,
    executionPolicyRevisionId: fixture.policy.executionPolicyRevisionId,
    idempotencyKey,
    instructionRefs: [],
    memoryPolicyRef: fixture.agentDefinitionRevision.memoryPolicyRef,
    participantId: participant.principalId,
    role: `${handle} implementation agent`,
    skillRefs: [],
  });
  return participant.principalId;
}

test("Kernel schema owns anchored Tasks and immutable Placement projections", () => {
  const fixture = createFixture();
  assert.equal(KERNEL_SCHEMA_VERSION, 36);
  assert.equal(
    fixture.agentDefinition.currentRevisionId,
    fixture.agentDefinitionRevision.agentDefinitionRevisionId,
  );
  assert.equal(
    fixture.kernel.getExecutionPolicy(fixture.policy.executionPolicyId)
      .currentRevision.executionPolicyRevisionId,
    fixture.policy.executionPolicyRevisionId,
  );
  fixture.kernel.close();
});

test("Agent memory home survives restart and prevents silent empty-memory failover", () => {
  const fixture = createFixture();
  let kernel = fixture.kernel;
  const hostA = authenticateHost(kernel, "memory-home-a", fixture.agentId);
  const hostB = authenticateHost(kernel, "memory-home-b", fixture.agentId);
  kernel.postMessage(fixture.humanActor, {
    body: "remember",
    idempotencyKey: "home-message",
    roomId: fixture.room.roomId,
    recipients: [{ participantId: fixture.agentId, reason: "mention" }],
  });
  const activation = kernel.leaseNextActivation(hostA, { leaseMs: 30_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(hostA, {
    activationId: activation.activationId,
  });
  kernel.finishRunAttempt(hostA, {
    runAttemptId: run.runAttemptId,
    state: "failed",
    error: "pre-start failure",
  });
  kernel.retryActivation(hostA, {
    activationId: activation.activationId,
    retryAfterMs: 0,
    error: "retry",
  });
  assert.equal(
    kernel.leaseNextActivation(hostB, { leaseMs: 30_000 }),
    null,
    "another Computer must not silently seed a new memory",
  );
  assert.throws(
    () =>
      kernel.acquireAgentExclusiveOperationLease(hostB, {
        kind: "memory_reset",
        leaseMs: 30_000,
        operationId: "foreign-home-reset",
        participantId: fixture.agentId,
      }),
    /memory.*home|memory.*Computer/iu,
  );
  kernel.close();
  kernel = new RoomKernel({
    databasePath: fixture.databasePath,
    now: fixture.clock.now,
  });
  kernel.initialize();
  assert.equal(kernel.leaseNextActivation(hostB, { leaseMs: 30_000 }), null);
  assert.ok(
    kernel.leaseNextActivation(hostA, { leaseMs: 30_000 }),
    "home Computer can resume queued work after restart",
  );
  kernel.close();
});

test("Placement planning retains the Agent memory home when a different Computer has an Offer", () => {
  const fixture = createFixture();
  const { kernel } = fixture;
  const hostA = authenticateHost(kernel, "memory-home-a", fixture.agentId);
  const hostB = authenticateHost(kernel, "memory-home-b", fixture.agentId);
  kernel.postMessage(fixture.humanActor, {
    body: "remember",
    idempotencyKey: "home-message",
    roomId: fixture.room.roomId,
    recipients: [{ participantId: fixture.agentId, reason: "mention" }],
  });
  const activation = kernel.leaseNextActivation(hostA, { leaseMs: 30_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(hostA, {
    activationId: activation.activationId,
  });
  kernel.finishRunAttempt(hostA, {
    runAttemptId: run.runAttemptId,
    state: "failed",
    error: "pre-start failure",
  });
  kernel.retryActivation(hostA, {
    activationId: activation.activationId,
    retryAfterMs: 0,
    error: "retry",
  });
  kernel.publishRuntimeOffer(hostB, runtimeOffer(hostB, "other-home-offer"));
  assert.equal(kernel.scheduleNextPlacement({ leaseMs: 30_000 }), null);
  kernel.close();
});

test("schema upgrade refuses to guess a memory home from conflicting historical Computers", () => {
  const fixture = createFixture();
  const { kernel } = fixture;
  const hostA = authenticateHost(kernel, "history-a", fixture.agentId);
  const hostB = authenticateHost(kernel, "history-b", fixture.agentId);
  kernel.postMessage(fixture.humanActor, {
    body: "historical work",
    idempotencyKey: "old-work",
    roomId: fixture.room.roomId,
    recipients: [{ participantId: fixture.agentId, reason: "mention" }],
  });
  const activation = kernel.leaseNextActivation(hostA, { leaseMs: 30_000 });
  assert.ok(activation);
  const first = kernel.createRunAttempt(hostA, {
    activationId: activation.activationId,
  });
  kernel.finishRunAttempt(hostA, {
    runAttemptId: first.runAttemptId,
    state: "failed",
    error: "old failure",
  });
  kernel.retryActivation(hostA, {
    activationId: activation.activationId,
    retryAfterMs: 0,
    error: "old retry",
  });
  kernel.leaseNextActivation(hostA, { leaseMs: 30_000 });
  const second = kernel.createRunAttempt(hostA, {
    activationId: activation.activationId,
  });
  kernel.finishRunAttempt(hostA, {
    runAttemptId: second.runAttemptId,
    state: "failed",
    error: "old failure",
  });
  kernel.retryActivation(hostA, {
    activationId: activation.activationId,
    retryAfterMs: 0,
    error: "old retry",
  });
  kernel.close();
  const legacy = new DatabaseSync(fixture.databasePath);
  legacy
    .prepare("UPDATE run_attempts SET host_id = ? WHERE run_attempt_id = ?")
    .run(hostB.hostId, second.runAttemptId);
  legacy.exec("DROP TABLE agent_memory_homes; PRAGMA user_version = 18;");
  legacy.close();
  const upgraded = new RoomKernel({
    databasePath: fixture.databasePath,
    now: fixture.clock.now,
  });
  upgraded.initialize();
  assert.equal(upgraded.leaseNextActivation(hostA, { leaseMs: 30_000 }), null);
  assert.equal(upgraded.leaseNextActivation(hostB, { leaseMs: 30_000 }), null);
  assert.throws(
    () =>
      upgraded.acquireAgentExclusiveOperationLease(hostA, {
        kind: "memory_reset",
        leaseMs: 30_000,
        operationId: "ambiguous-reset",
        participantId: fixture.agentId,
      }),
    /memory home/iu,
  );
  upgraded.close();
});

test("global Agent operation fence blocks Placement scheduling without dropping queued work", () => {
  const { agentId, humanActor, kernel, room } = createFixture();
  const host = authenticateHost(kernel, "exclusive-operation-host", agentId);
  kernel.publishRuntimeOffer(
    host,
    runtimeOffer(host, "exclusive-operation-offer"),
  );
  kernel.postMessage(humanActor, {
    body: "Preserve this queued Activation while memory is reset",
    idempotencyKey: "exclusive-operation-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });

  const fence = kernel.acquireAgentExclusiveOperationLease(host, {
    kind: "memory_reset",
    leaseMs: 30_000,
    operationId: "placement-memory-reset",
    participantId: agentId,
  });
  assert.equal(kernel.scheduleNextPlacement({ leaseMs: 5_000 }), null);
  assert.equal(
    kernel.listActivations({ participantId: agentId })[0]?.state,
    "queued",
  );

  kernel.releaseAgentExclusiveOperationLease(host, {
    leaseId: fence.leaseId,
    operationId: fence.operationId,
  });
  assert.equal(
    kernel.scheduleNextPlacement({ leaseMs: 5_000 })?.participantId,
    agentId,
  );
  kernel.close();
});

test("schema v3 RunAttempts migrate to nullable placement provenance without data loss", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-placement-migrate-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "room.db");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA user_version = 3;
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
    CREATE TABLE activations (
      activation_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(room_id),
      participant_id TEXT NOT NULL REFERENCES principals(principal_id),
      from_seq INTEGER NOT NULL,
      to_seq INTEGER NOT NULL,
      reason TEXT NOT NULL,
      state TEXT NOT NULL,
      lease_owner TEXT,
      lease_until TEXT,
      lease_until_ms INTEGER,
      available_at TEXT NOT NULL,
      available_at_ms INTEGER NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE run_attempts (
      run_attempt_id TEXT PRIMARY KEY,
      activation_id TEXT NOT NULL REFERENCES activations(activation_id),
      room_id TEXT NOT NULL REFERENCES rooms(room_id),
      participant_id TEXT NOT NULL REFERENCES principals(principal_id),
      host_id TEXT NOT NULL,
      attempt_number INTEGER NOT NULL,
      state TEXT NOT NULL,
      runtime_run_id TEXT,
      exit_code INTEGER,
      exit_signal TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      UNIQUE (activation_id, attempt_number)
    ) STRICT;
    INSERT INTO principals VALUES
      ('human-v3', 'human-v3', 'human', '2026-08-26T00:00:00.000Z'),
      ('agent-v3', 'agent-v3', 'agent', '2026-08-26T00:00:00.000Z');
    INSERT INTO rooms VALUES
      ('room-v3', 'room-v3', 'Room v3', 2, '2026-08-26T00:00:00.000Z');
    INSERT INTO memberships VALUES
      ('room-v3', 'human-v3', '2026-08-26T00:00:00.000Z'),
      ('room-v3', 'agent-v3', '2026-08-26T00:00:00.000Z');
    INSERT INTO room_events VALUES(
      'event-room-v3', 'room-v3', 1, 'room.created', 'human-v3', 'room',
      'room-v3', '{}', 'room.create:room-v3', 1,
      '2026-08-26T00:00:00.000Z'
    );
    INSERT INTO activations VALUES(
      'activation-v3', 'room-v3', 'agent-v3', 1, 1, 'mention', 'leased',
      'host-v3', '2026-08-26T00:05:00.000Z', 1787702700000,
      '2026-08-26T00:00:00.000Z', 1787702400000, 1, NULL,
      '2026-08-26T00:00:00.000Z', '2026-08-26T00:00:00.000Z'
    );
    INSERT INTO run_attempts VALUES(
      'run-v3', 'activation-v3', 'room-v3', 'agent-v3', 'host-v3', 1,
      'exited', NULL, 0, NULL, NULL, '2026-08-26T00:00:00.000Z',
      '2026-08-26T00:00:01.000Z'
    );
  `);
  legacy.close();

  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  assert.equal(kernel.listRunAttempts()[0]?.runAttemptId, "run-v3");
  assert.equal(kernel.listRunAttempts()[0]?.placement, undefined);
  kernel.close();

  const migrated = new DatabaseSync(databasePath);
  const placementColumn = migrated
    .prepare("PRAGMA table_info(run_attempts)")
    .all()
    .find((row) => (row as { name: string }).name === "placement_id");
  assert.ok(placementColumn);
  assert.ok(
    migrated
      .prepare("PRAGMA foreign_key_list(run_attempts)")
      .all()
      .some(
        (row) =>
          (row as { from: string; table: string }).from === "placement_id" &&
          (row as { from: string; table: string }).table === "placements",
      ),
  );
  assert.deepEqual(migrated.prepare("PRAGMA foreign_key_check").all(), []);
  migrated.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE run_attempts_without_placement_fk AS
      SELECT * FROM run_attempts;
    DROP TABLE run_attempts;
    ALTER TABLE run_attempts_without_placement_fk RENAME TO run_attempts;
    PRAGMA user_version = 4;
    PRAGMA foreign_keys = ON;
  `);
  migrated.close();

  const repair = new RoomKernel({ databasePath });
  repair.initialize();
  assert.equal(repair.listRunAttempts()[0]?.runAttemptId, "run-v3");
  repair.close();
  const repaired = new DatabaseSync(databasePath);
  assert.ok(
    repaired
      .prepare("PRAGMA foreign_key_list(run_attempts)")
      .all()
      .some(
        (row) =>
          (row as { from: string; table: string }).from === "placement_id" &&
          (row as { from: string; table: string }).table === "placements",
      ),
  );
  assert.deepEqual(repaired.prepare("PRAGMA foreign_key_check").all(), []);
  repaired.close();
});

test("schema v4 Offer head fails closed until republished as a v5 immutable observation", () => {
  const { agentId, clock, databasePath, humanActor, kernel, room } =
    createFixture();
  const host = authenticateHost(kernel, "v4-offer-host", agentId);
  kernel.publishRuntimeOffer(host, runtimeOffer(host, "v4-offer"));
  kernel.postMessage(humanActor, {
    body: "Do not trust a migrated mutable Offer head",
    idempotencyKey: "v4-offer-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });
  kernel.close();

  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TABLE runtime_offer_observations;
    ALTER TABLE runtime_offers RENAME TO runtime_offers_v5;
    CREATE TABLE runtime_offers (
      runtime_offer_id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL,
      host_instance_id TEXT NOT NULL,
      runtime_profile_id TEXT NOT NULL,
      runtime_profile_revision_id TEXT NOT NULL,
      revision_digest TEXT NOT NULL,
      state TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      observed_at_ms INTEGER NOT NULL,
      lease_until TEXT NOT NULL,
      lease_until_ms INTEGER NOT NULL,
      offer_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    INSERT INTO runtime_offers(
      runtime_offer_id, host_id, host_instance_id, runtime_profile_id,
      runtime_profile_revision_id, revision_digest, state, observed_at,
      observed_at_ms, lease_until, lease_until_ms, offer_json, updated_at
    )
    SELECT
      runtime_offer_id, host_id, host_instance_id, runtime_profile_id,
      runtime_profile_revision_id, revision_digest, state, observed_at,
      observed_at_ms, lease_until, lease_until_ms, offer_json, updated_at
    FROM runtime_offers_v5;
    DROP TABLE runtime_offers_v5;
    CREATE INDEX idx_runtime_offers_fresh
      ON runtime_offers(state, lease_until_ms, host_id, runtime_offer_id);
    PRAGMA user_version = 4;
    PRAGMA foreign_keys = ON;
  `);
  legacy.close();

  const migrated = new RoomKernel({
    databasePath,
    now: clock.now,
    runtimeCertifications: [runtimeCertification],
  });
  migrated.initialize();
  assert.equal(migrated.scheduleNextPlacement({ leaseMs: 5_000 }), null);
  clock.advance(1_000);
  const republished = migrated.publishRuntimeOffer(host, {
    ...runtimeOffer(host, "v4-offer"),
    observedAt: "2026-08-26T00:00:01.000Z",
  });
  assert.ok(republished.runtimeOfferObservationId);
  const placement = migrated.scheduleNextPlacement({ leaseMs: 5_000 });
  assert.equal(
    placement?.runtimeOfferObservationId,
    republished.runtimeOfferObservationId,
  );
  migrated.close();
});

test("control objects require a managed control Room manager and cannot cross policy scope", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-control-authority-"));
  temporaryDirectories.push(directory);
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
  });
  kernel.initialize();
  const owner = kernel.provisionPrincipal({
    handle: "control-owner",
    kind: "human",
  });
  const member = kernel.provisionPrincipal({
    handle: "control-member",
    kind: "human",
  });
  const agent = kernel.provisionPrincipal({
    handle: "control-agent",
    kind: "agent",
  });
  const ownerActor = kernel.authenticateAccessToken(owner.accessToken);
  const memberActor = kernel.authenticateAccessToken(member.accessToken);
  const agentActor = kernel.authenticateAccessToken(agent.accessToken);
  const workspaceA = kernel.createWorkspace(ownerActor, {
    idempotencyKey: "control-workspace-a",
    name: "Control Workspace A",
    slug: "control-workspace-a",
  });
  const workspaceB = kernel.createWorkspace(ownerActor, {
    idempotencyKey: "control-workspace-b",
    name: "Control Workspace B",
    slug: "control-workspace-b",
  });
  const channel = kernel.createWorkspaceRoom(ownerActor, {
    basedOnControlRoomSeq: workspaceA.event.roomSeq,
    idempotencyKey: "control-channel-a",
    kind: "channel",
    name: "Ordinary Channel",
    slug: "ordinary-channel",
    workspaceId: workspaceA.workspace.workspaceId,
  }).room;
  for (const roomId of [
    workspaceA.controlRoom.roomId,
    workspaceB.controlRoom.roomId,
  ]) {
    kernel.addMember(ownerActor, {
      principalId: agent.principal.principalId,
      roomId,
    });
  }
  kernel.addMember(ownerActor, {
    principalId: member.principal.principalId,
    roomId: workspaceA.controlRoom.roomId,
  });

  const policyInput = {
    modelIntent: {
      fallback: "disabled" as const,
      reasoning: "default" as const,
      serviceTier: "default" as const,
    },
    preferred: [],
    required: {
      allowedProtocolFamilies: ["rah-worker-process/v1"],
      capabilities: [],
      minimumIsolation: "none" as const,
      workspaceMode: "in_place" as const,
    },
    retryPolicyRef: {
      artifactId: "control-retry-policy",
      contentDigest: digest("c"),
      versionId: "control-retry-policy-v1",
    },
    sessionPolicy: "fresh" as const,
  };
  assert.throws(
    () =>
      kernel.createExecutionPolicy(memberActor, {
        ...policyInput,
        basedOnRoomSeq: latestRoomSeq(
          kernel,
          memberActor,
          workspaceA.controlRoom.roomId,
        ),
        controlRoomId: workspaceA.controlRoom.roomId,
        idempotencyKey: "member-policy-create",
      }),
    /owner or admin/i,
  );
  assert.throws(
    () =>
      kernel.createExecutionPolicy(agentActor, {
        ...policyInput,
        basedOnRoomSeq: latestRoomSeq(
          kernel,
          agentActor,
          workspaceA.controlRoom.roomId,
        ),
        controlRoomId: workspaceA.controlRoom.roomId,
        idempotencyKey: "agent-policy-create",
      }),
    /authenticated Human/i,
  );
  assert.throws(
    () =>
      kernel.createExecutionPolicy(ownerActor, {
        ...policyInput,
        basedOnRoomSeq: latestRoomSeq(kernel, ownerActor, channel.roomId),
        controlRoomId: channel.roomId,
        idempotencyKey: "channel-policy-create",
      }),
    /control Room/i,
  );

  const policy = kernel.createExecutionPolicy(ownerActor, {
    ...policyInput,
    basedOnRoomSeq: latestRoomSeq(
      kernel,
      ownerActor,
      workspaceA.controlRoom.roomId,
    ),
    controlRoomId: workspaceA.controlRoom.roomId,
    idempotencyKey: "owner-policy-create",
  }).policy;
  assert.throws(
    () =>
      kernel.createAgentDefinition(ownerActor, {
        basedOnRoomSeq: latestRoomSeq(
          kernel,
          ownerActor,
          workspaceB.controlRoom.roomId,
        ),
        controlRoomId: workspaceB.controlRoom.roomId,
        executionPolicyRevisionId: policy.executionPolicyRevisionId,
        idempotencyKey: "cross-control-agent-create",
        instructionRefs: [],
        memoryPolicyRef: {
          artifactId: "control-memory-policy",
          contentDigest: digest("d"),
          versionId: "control-memory-policy-v1",
        },
        participantId: agent.principal.principalId,
        role: "cross-scope agent",
        skillRefs: [],
      }),
    /same control Room/i,
  );
  kernel.close();
});

test("control Room idempotency cannot silently bind the same Agent command to another participant", () => {
  const { controlRoom, humanActor, kernel, policy, room } = createFixture();
  const other = kernel.provisionPrincipal({
    handle: "other-idempotency-agent",
    kind: "agent",
  }).principal;
  kernel.addMember(humanActor, {
    principalId: other.principalId,
    roomId: room.roomId,
  });
  kernel.addMember(humanActor, {
    principalId: other.principalId,
    roomId: controlRoom.roomId,
  });

  assert.throws(
    () =>
      kernel.createAgentDefinition(humanActor, {
        basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoom.roomId),
        controlRoomId: controlRoom.roomId,
        executionPolicyRevisionId: policy.executionPolicyRevisionId,
        idempotencyKey: "agent-create",
        instructionRefs: [],
        memoryPolicyRef: {
          artifactId: "memory-policy",
          contentDigest: digest("b"),
          versionId: "memory-policy-v1",
        },
        participantId: other.principalId,
        role: "implementation agent",
        skillRefs: [],
      }),
    /already used for another mutation/,
  );
  kernel.close();
});

test("Agent revision digest is computed from normalized immutable content", () => {
  const {
    agentDefinitionRevision,
    controlRoom,
    humanActor,
    kernel,
    policy,
    room,
  } = createFixture();
  const other = kernel.provisionPrincipal({
    handle: "normalized-content-agent",
    kind: "agent",
  }).principal;
  kernel.addMember(humanActor, {
    principalId: other.principalId,
    roomId: room.roomId,
  });
  kernel.addMember(humanActor, {
    principalId: other.principalId,
    roomId: controlRoom.roomId,
  });
  const revision = kernel.createAgentDefinition(humanActor, {
    basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoom.roomId),
    controlRoomId: controlRoom.roomId,
    executionPolicyRevisionId: policy.executionPolicyRevisionId,
    idempotencyKey: "normalized-agent-create",
    instructionRefs: [],
    memoryPolicyRef: agentDefinitionRevision.memoryPolicyRef,
    participantId: other.principalId,
    role: "  implementation agent  ",
    skillRefs: [],
  }).revision;

  assert.equal(revision.role, "implementation agent");
  assert.equal(revision.contentDigest, agentDefinitionRevision.contentDigest);
  kernel.close();
});

test("Kernel placement is deterministic, pull-order independent, and reserved once", () => {
  const { agentId, clock, databasePath, humanActor, kernel, room } =
    createFixture();
  const hostB = authenticateHost(kernel, "host-b", agentId);
  const hostA = authenticateHost(kernel, "host-a", agentId);
  kernel.publishRuntimeOffer(hostB, runtimeOffer(hostB, "offer-b"));
  kernel.publishRuntimeOffer(hostA, runtimeOffer(hostA, "offer-a"));
  kernel.postMessage(humanActor, {
    body: "Please run the placement test",
    idempotencyKey: "placement-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });

  const competingKernel = new RoomKernel({ databasePath, now: clock.now });
  competingKernel.initialize();
  const first = kernel.scheduleNextPlacement({ leaseMs: 5_000 });
  const second = competingKernel.scheduleNextPlacement({ leaseMs: 5_000 });

  assert.equal(first?.runtimeOfferId, "offer-a");
  assert.equal(second, null);
  assert.equal(competingKernel.listPlacements().length, 1);
  assert.equal(kernel.pullNextPlacement(hostB), null);
  assert.equal(
    kernel.pullNextPlacement(hostA)?.placementId,
    first?.placementId,
  );
  assert.equal(
    kernel.listOutbox().filter((entry) => entry.topic === "placement.ready")
      .length,
    1,
  );

  competingKernel.close();
  kernel.close();
});

test("a Placement launch claim is atomic across concurrent Host workers", () => {
  const { agentId, clock, databasePath, humanActor, kernel, room } =
    createFixture();
  const host = authenticateHost(kernel, "atomic-launch-host", agentId);
  kernel.publishRuntimeOffer(host, runtimeOffer(host, "atomic-launch-offer"));
  kernel.postMessage(humanActor, {
    body: "Launch this placement exactly once",
    idempotencyKey: "atomic-launch-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });
  const placement = kernel.scheduleNextPlacement({ leaseMs: 5_000 });
  assert.ok(placement);

  const competingKernel = new RoomKernel({ databasePath, now: clock.now });
  competingKernel.initialize();
  const first = kernel.claimNextPlacement(host, { leaseMs: 5_000 });
  const second = competingKernel.claimNextPlacement(host, { leaseMs: 5_000 });

  assert.equal(first?.placement.placementId, placement.placementId);
  assert.equal(first?.placement.state, "consumed");
  assert.equal(first?.activation.activationId, placement.activationId);
  assert.equal(first?.runAttempt.placement?.placementId, placement.placementId);
  assert.equal(first?.runAttempt.state, "starting");
  assert.deepEqual(first?.runAttempt.contextManifest?.eventRanges, [
    {
      fromSeq: first?.activation.fromSeq,
      toSeq: first?.activation.toSeq,
    },
  ]);
  assert.equal(
    first?.runAttempt.contextManifest?.throughRoomSeq,
    first?.activation.toSeq,
  );
  assert.equal(
    first?.runAttempt.contextManifest?.agentDefinition
      ?.agentDefinitionRevisionId,
    first?.agentContext.agentDefinitionRevision.agentDefinitionRevisionId,
  );
  assert.equal(first?.agentContext.handle, "agent");
  assert.equal(
    first?.runAttempt.contextManifest?.placement?.workspaceMountRevisionId,
    first?.placement.workspaceMountRevisionId,
  );
  assert.equal(
    first?.runAttempt.contextManifest?.placement?.runtimeProfileDigest,
    first?.placement.runtimeProfileDigest,
  );
  assert.equal(second, null);
  assert.equal(kernel.listRunAttempts({ roomId: room.roomId }).length, 1);
  assert.equal(kernel.pullNextPlacement(host), null);

  competingKernel.close();
  kernel.close();
});

test("R1 fails closed when offers expose ambiguous workspace identities", () => {
  const { agentId, humanActor, kernel, room } = createFixture();
  const hostA = authenticateHost(kernel, "host-a", agentId);
  const hostB = authenticateHost(kernel, "host-b", agentId);
  kernel.publishRuntimeOffer(hostA, runtimeOffer(hostA, "offer-a"));
  kernel.publishRuntimeOffer(
    hostB,
    runtimeOffer(hostB, "offer-b", {
      workspaceMountDescriptors: [
        {
          modes: ["in_place"],
          workspaceDefinitionId: "workspace-other",
          workspaceMountDigest: digest("f"),
          workspaceMountRevisionId: "mount-other-v1",
        },
      ],
    }),
  );
  kernel.postMessage(humanActor, {
    body: "Do not guess which repository I mean",
    idempotencyKey: "ambiguous-workspace-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });

  assert.equal(kernel.scheduleNextPlacement({ leaseMs: 5_000 }), null);
  assert.equal(kernel.listPlacements().length, 0);
  kernel.close();
});

test("an expired pre-Run placement releases reservations and can be placed elsewhere", () => {
  const { agentId, clock, humanActor, kernel, room } = createFixture();
  const hostA = authenticateHost(kernel, "host-a", agentId);
  const hostB = authenticateHost(kernel, "host-b", agentId);
  kernel.publishRuntimeOffer(hostA, runtimeOffer(hostA, "offer-a"));
  kernel.publishRuntimeOffer(hostB, runtimeOffer(hostB, "offer-b"));
  kernel.postMessage(humanActor, {
    body: "Survive a scheduler crash window",
    idempotencyKey: "crash-window-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });

  const first = kernel.scheduleNextPlacement({ leaseMs: 1_000 });
  assert.equal(first?.hostId, hostA.hostId);
  kernel.heartbeatHost(hostA, { state: "offline" });
  clock.advance(1_001);
  const replacement = kernel.scheduleNextPlacement({ leaseMs: 1_000 });

  assert.equal(replacement?.hostId, hostB.hostId);
  assert.equal(replacement?.activationId, first?.activationId);
  const placements = kernel.listPlacements();
  assert.equal(placements[0]?.state, "released");
  assert.equal(placements[1]?.state, "reserved");
  assert.equal(
    kernel.listActivations({ participantId: agentId })[0]?.attemptCount,
    2,
  );
  kernel.close();
});

test("createRunAttempt crash before durable prepare safely releases and re-places", () => {
  const { agentId, clock, humanActor, kernel, room } = createFixture();
  const host = authenticateHost(kernel, "pre-prepare-host", agentId);
  kernel.publishRuntimeOffer(host, runtimeOffer(host, "pre-prepare-offer"));
  kernel.postMessage(humanActor, {
    body: "Crash after RunAttempt but before prepare",
    idempotencyKey: "pre-prepare-crash-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });
  const firstPlacement = kernel.scheduleNextPlacement({ leaseMs: 1_000 });
  assert.ok(firstPlacement);
  const abandonedRun = kernel.createRunAttempt(host, {
    activationId: firstPlacement.activationId,
  });
  clock.advance(1_001);

  const replacement = kernel.scheduleNextPlacement({ leaseMs: 1_000 });
  assert.ok(replacement);
  assert.equal(replacement.activationId, firstPlacement.activationId);
  assert.notEqual(replacement.placementId, firstPlacement.placementId);
  assert.equal(
    kernel
      .listRunAttempts()
      .find((run) => run.runAttemptId === abandonedRun.runAttemptId)?.state,
    "failed",
  );
  assert.deepEqual(
    kernel.listPlacements().map((placement) => placement.state),
    ["released", "reserved"],
  );
  kernel.close();
});

test("an expired lease with an active placed RunAttempt quarantines the lane instead of double-running", () => {
  const { agentId, clock, humanActor, kernel, room } = createFixture();
  const hostA = authenticateHost(kernel, "host-a", agentId);
  const hostB = authenticateHost(kernel, "host-b", agentId);
  kernel.publishRuntimeOffer(
    hostA,
    runtimeOffer(hostA, "offer-a", { capacityPoolIds: ["pool-a"] }),
  );
  kernel.publishRuntimeOffer(
    hostB,
    runtimeOffer(hostB, "offer-b", { capacityPoolIds: ["pool-b"] }),
  );
  kernel.postMessage(humanActor, {
    body: "Start one real run",
    idempotencyKey: "active-expiry-first",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });
  const firstPlacement = kernel.scheduleNextPlacement({ leaseMs: 1_000 });
  assert.ok(firstPlacement);
  const runAttempt = kernel.createRunAttempt(hostA, {
    activationId: firstPlacement.activationId,
  });
  kernel.prepareRunAttemptRuntime(hostA, {
    recoveryDescriptor: {
      driver: "fake-recovery",
      metadata: {},
      recoveryKey: "active-expiry-runtime",
    },
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "active-expiry-runtime",
  });
  kernel.postMessage(humanActor, {
    body: "This follow-up must not double-run",
    idempotencyKey: "active-expiry-follow-up",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });
  clock.advance(1_001);

  assert.equal(kernel.scheduleNextPlacement({ leaseMs: 1_000 }), null);
  const activations = kernel.listActivations({ participantId: agentId });
  assert.equal(
    activations.find(
      (activation) => activation.activationId === firstPlacement.activationId,
    )?.state,
    "quarantined",
  );
  assert.equal(
    activations.find(
      (activation) => activation.activationId !== firstPlacement.activationId,
    )?.state,
    "queued",
  );
  assert.equal(kernel.listPlacements().length, 1);
  assert.equal(kernel.listPlacements()[0]?.state, "consumed");

  const recovery = kernel.leaseNextRuntimeRecovery(hostB, {
    driverIds: ["fake-recovery"],
    leaseMs: 1_000,
  });
  assert.ok(recovery);
  kernel.heartbeatHost(hostB, { state: "offline" });
  const replacementRecoveryGeneration = authenticateHost(
    kernel,
    "host-b",
    agentId,
  );
  assert.throws(
    () =>
      kernel.recordRecoveredRuntimeTermination(replacementRecoveryGeneration, {
        exit: { code: 7 },
        recoveryAttemptCount: recovery.recoveryAttemptCount,
        runtimeProcessId: recovery.runtimeProcessId,
      }),
    /does not own an active recovery lease/,
  );
  clock.advance(1_001);
  const replacementRecovery = kernel.leaseNextRuntimeRecovery(
    replacementRecoveryGeneration,
    {
      driverIds: ["fake-recovery"],
      leaseMs: 1_000,
    },
  );
  assert.ok(replacementRecovery);
  kernel.recordRecoveredRuntimeTermination(replacementRecoveryGeneration, {
    exit: { code: 7 },
    recoveryAttemptCount: replacementRecovery.recoveryAttemptCount,
    runtimeProcessId: replacementRecovery.runtimeProcessId,
  });
  assert.equal(kernel.listPlacements()[0]?.state, "released");
  kernel.resolveActivationQuarantine(replacementRecoveryGeneration, {
    activationId: firstPlacement.activationId,
  });
  assert.ok(kernel.scheduleNextPlacement({ leaseMs: 1_000 }));
  kernel.close();
});

test("RuntimeOffer identity cannot be taken over by a different Host", () => {
  const { agentId, kernel } = createFixture();
  const hostA = authenticateHost(kernel, "host-a", agentId);
  const hostB = authenticateHost(kernel, "host-b", agentId);
  kernel.publishRuntimeOffer(hostA, runtimeOffer(hostA, "offer-stable"));

  assert.throws(
    () =>
      kernel.publishRuntimeOffer(hostB, runtimeOffer(hostB, "offer-stable")),
    /already belongs to another Host or profile revision/,
  );
  kernel.close();
});

test("Host cannot promote self-reported evidence to certified", () => {
  const { agentId, kernel } = createFixture({
    trustedRuntimeCertification: false,
  });
  const host = authenticateHost(kernel, "self-certified-host", agentId);

  assert.throws(
    () =>
      kernel.publishRuntimeOffer(
        host,
        runtimeOffer(host, "self-certified-offer"),
      ),
    /trusted certification/,
  );
  kernel.close();
});

test("RuntimeCertification digest and duplicate identity are content-addressed", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-certification-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "room.db");
  assert.equal(
    runtimeCertification.certificationDigest,
    "sha256:be2b9b7cdb5c29210828301c2b9c53165e6586999bc9eb5eb22756034a051c9e",
  );
  assert.throws(
    () =>
      new RoomKernel({
        databasePath,
        runtimeCertifications: [
          { ...runtimeCertification, certificationDigest: digest("9") },
        ],
      }),
    /digest does not match its canonical content/,
  );
  const conflictingContent = {
    ...runtimeCertificationContent,
    capabilities: ["different_capability"],
  } satisfies Omit<RuntimeCertification, "certificationDigest">;
  assert.throws(
    () =>
      new RoomKernel({
        databasePath,
        runtimeCertifications: [
          runtimeCertification,
          {
            ...conflictingContent,
            certificationDigest:
              computeRuntimeCertificationDigest(conflictingContent),
          },
        ],
      }),
    /duplicate RuntimeCertification/,
  );
});

test("Host cannot self-certify a model binding", () => {
  const { agentId, kernel } = createFixture();
  const host = authenticateHost(kernel, "self-certified-model-host", agentId);
  assert.throws(
    () =>
      kernel.publishRuntimeOffer(
        host,
        runtimeOffer(host, "self-certified-model-offer", {
          modelBindingDescriptors: [
            {
              capabilityClasses: ["deep_coding"],
              evidence: "certified",
              modelBindingId: "self-certified-model",
              modelId: "untrusted-model",
              provider: "untrusted-provider",
              supportedReasoning: ["high"],
              supportedServiceTiers: ["default"],
            },
          ],
        }),
      ),
    /cannot self-certify model bindings/,
  );
  kernel.close();
});

test("trusted certification must match the reported profile digest", () => {
  const { agentId, kernel } = createFixture();
  const host = authenticateHost(kernel, "mismatched-cert-host", agentId);

  assert.throws(
    () =>
      kernel.publishRuntimeOffer(
        host,
        runtimeOffer(host, "mismatched-cert-offer", {
          revisionDigest: digest("9"),
        }),
      ),
    /certification subject does not match/,
  );
  kernel.close();
});

test("removing a trusted certification blocks future Placement without rewriting history", () => {
  const { agentId, clock, databasePath, humanActor, kernel, room } =
    createFixture();
  const host = authenticateHost(kernel, "revoked-cert-host", agentId);
  kernel.publishRuntimeOffer(host, runtimeOffer(host, "revoked-cert-offer"));
  kernel.postMessage(humanActor, {
    body: "Create history before the certification is removed",
    idempotencyKey: "revoked-cert-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });
  const historical = kernel.scheduleNextPlacement({ leaseMs: 5_000 });
  assert.ok(historical);
  kernel.retryActivation(host, {
    activationId: historical.activationId,
    error: "return work before certification removal",
    retryAfterMs: 0,
  });
  kernel.close();

  const withoutCertification = new RoomKernel({
    databasePath,
    now: clock.now,
  });
  withoutCertification.initialize();
  assert.equal(
    withoutCertification.listPlacements()[0]?.runtimeOfferObservationId,
    historical.runtimeOfferObservationId,
  );
  assert.equal(
    withoutCertification.scheduleNextPlacement({ leaseMs: 5_000 }),
    null,
  );
  withoutCertification.close();
  const history = new DatabaseSync(databasePath);
  const historicalProjection = JSON.parse(
    (
      history
        .prepare(
          "SELECT projection_json FROM runtime_offer_observations WHERE runtime_offer_observation_id = ?",
        )
        .get(historical.runtimeOfferObservationId ?? "missing") as {
        projection_json: string;
      }
    ).projection_json,
  ) as { resolvedCertifications: RuntimeCertification[] };
  assert.deepEqual(historicalProjection.resolvedCertifications, [
    runtimeCertification,
  ]);
  history.close();
});

test("Placement freezes an immutable RuntimeOffer observation", () => {
  const { agentId, clock, databasePath, humanActor, kernel, room } =
    createFixture();
  const host = authenticateHost(kernel, "immutable-offer-host", agentId);
  const original = kernel.publishRuntimeOffer(
    host,
    runtimeOffer(host, "immutable-offer"),
  );
  kernel.postMessage(humanActor, {
    body: "Freeze the exact offer observation used for this decision",
    idempotencyKey: "immutable-offer-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });
  const placement = kernel.scheduleNextPlacement({ leaseMs: 5_000 });
  assert.ok(placement);
  const frozen = placement as typeof placement & {
    runtimeOfferObservationId?: string;
    runtimeOfferSnapshotDigest?: string;
  };
  const originalProjection = original as typeof original & {
    runtimeOfferObservationId?: string;
    runtimeOfferSnapshotDigest?: string;
  };
  assert.equal(
    frozen.runtimeOfferObservationId,
    originalProjection.runtimeOfferObservationId,
  );
  assert.equal(
    frozen.runtimeOfferSnapshotDigest,
    originalProjection.runtimeOfferSnapshotDigest,
  );
  assert.ok(frozen.runtimeOfferObservationId);
  assert.ok(frozen.runtimeOfferSnapshotDigest);
  assert.deepEqual(original.resolvedCertifications, [runtimeCertification]);
  assert.deepEqual(
    kernel.getRuntimeOfferObservation(frozen.runtimeOfferObservationId),
    original,
  );

  clock.advance(1_000);
  const refreshed = kernel.publishRuntimeOffer(host, {
    ...runtimeOffer(host, "immutable-offer"),
    observedAt: "2026-08-26T00:00:01.000Z",
  });
  const refreshedProjection = refreshed as typeof refreshed & {
    runtimeOfferObservationId?: string;
  };
  assert.notEqual(
    refreshedProjection.runtimeOfferObservationId,
    frozen.runtimeOfferObservationId,
  );
  kernel.close();

  const database = new DatabaseSync(databasePath);
  assert.equal(
    (
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM runtime_offer_observations WHERE runtime_offer_id = ?",
        )
        .get("immutable-offer") as { count: number }
    ).count,
    2,
  );
  database.close();
});

test("RuntimeOffer observations are monotonic and equal-time conflicts fail closed", () => {
  const { agentId, clock, kernel } = createFixture();
  const host = authenticateHost(kernel, "monotonic-offer-host", agentId);
  const initial = runtimeOffer(host, "monotonic-offer");
  kernel.publishRuntimeOffer(host, initial);
  clock.advance(1_000);
  kernel.publishRuntimeOffer(host, {
    ...initial,
    leaseUntil: "2026-08-26T00:05:00.000Z",
    observedAt: "2026-08-26T00:00:01.000Z",
  });
  clock.advance(1_000);
  const replayed = kernel.publishRuntimeOffer(host, {
    ...initial,
    leaseUntil: "2026-08-26T00:05:00.000Z",
    observedAt: "2026-08-26T00:00:01.000Z",
  });
  assert.equal(replayed.runtimeOfferObservationId.length > 0, true);

  assert.throws(
    () =>
      kernel.publishRuntimeOffer(host, {
        ...initial,
        state: "unavailable",
      }),
    /older than the current observation/,
  );
  assert.throws(
    () =>
      kernel.publishRuntimeOffer(host, {
        ...initial,
        leaseUntil: "2026-08-26T00:04:00.000Z",
        observedAt: "2026-08-26T00:00:01.000Z",
      }),
    /same timestamp has different content/,
  );
  kernel.close();
});

test("RuntimeOffer time is server-bounded and Placement cannot outlive it", () => {
  const { agentId, clock, humanActor, kernel, room } = createFixture();
  const host = authenticateHost(kernel, "bounded-offer-host", agentId);
  assert.throws(
    () =>
      kernel.publishRuntimeOffer(
        host,
        runtimeOffer(host, "future-offer", {
          observedAt: "2026-08-26T00:00:06.000Z",
        }),
      ),
    /future of Kernel time/,
  );
  const bounded = kernel.publishRuntimeOffer(
    host,
    runtimeOffer(host, "bounded-offer"),
  );
  assert.equal(bounded.leaseUntil, "2026-08-26T00:05:00.000Z");

  clock.advance(299_000);
  kernel.postMessage(humanActor, {
    body: "The Placement must inherit the remaining Offer TTL",
    idempotencyKey: "bounded-offer-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });
  const placement = kernel.scheduleNextPlacement({ leaseMs: 60_000 });
  assert.ok(placement);
  assert.equal(placement.leaseUntil, bounded.leaseUntil);

  clock.advance(1_001);
  assert.equal(kernel.pullNextPlacement(host), null);
  assert.equal(kernel.scheduleNextPlacement({ leaseMs: 60_000 }), null);
  assert.equal(kernel.listPlacements()[0]?.state, "released");
  kernel.close();
});

test("a replacement Host generation cannot prepare the previous generation's Placement", () => {
  const { agentId, humanActor, kernel, room } = createFixture();
  const provisioned = kernel.provisionHostCredential({
    hostId: "generation-fenced-host",
    participantIds: [agentId],
  });
  const firstGeneration = kernel.authenticateHostAccessToken(
    provisioned.accessToken,
  );
  kernel.heartbeatHost(firstGeneration);
  kernel.publishRuntimeOffer(
    firstGeneration,
    runtimeOffer(firstGeneration, "generation-fenced-offer"),
  );
  kernel.postMessage(humanActor, {
    body: "Only the selected Host generation may execute this Placement",
    idempotencyKey: "generation-fenced-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });
  const placement = kernel.scheduleNextPlacement({ leaseMs: 5_000 });
  assert.ok(placement);
  const runAttempt = kernel.createRunAttempt(firstGeneration, {
    activationId: placement.activationId,
  });
  kernel.prepareRunAttemptRuntime(firstGeneration, {
    recoveryDescriptor: {
      driver: "fake-recovery",
      metadata: {},
      recoveryKey: "generation-fenced-runtime",
    },
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "generation-fenced-runtime",
  });

  kernel.heartbeatHost(firstGeneration, { state: "offline" });
  const replacementGeneration = kernel.authenticateHostAccessToken(
    provisioned.accessToken,
  );
  kernel.heartbeatHost(replacementGeneration);

  assert.throws(
    () =>
      kernel.prepareRunAttemptRuntime(replacementGeneration, {
        recoveryDescriptor: {
          driver: "fake-recovery",
          metadata: {},
          recoveryKey: "generation-fenced-runtime",
        },
        runAttemptId: runAttempt.runAttemptId,
        runtimeRunId: "generation-fenced-runtime",
      }),
    ExecutionFencedError,
  );
  assert.throws(
    () =>
      kernel.recordRuntimeTermination(replacementGeneration, {
        exit: { code: 0 },
        runAttemptId: runAttempt.runAttemptId,
        runtimeRunId: "generation-fenced-runtime",
      }),
    ExecutionFencedError,
  );
  assert.equal(kernel.listPlacements()[0]?.state, "consumed");
  assert.equal(kernel.listRunAttempts()[0]?.state, "starting");
  kernel.close();
});

test("finishRunAttempt cannot release Placement resources before RuntimeProcess terminal proof", () => {
  const fixture = createFixture();
  const secondAgentId = addAgent(
    fixture,
    "terminal-proof-second-agent",
    "terminal-proof-second-agent-create",
  );
  const host = authenticateHost(fixture.kernel, "terminal-proof-host", [
    fixture.agentId,
    secondAgentId,
  ]);
  fixture.kernel.publishRuntimeOffer(
    host,
    runtimeOffer(host, "terminal-proof-offer"),
  );
  fixture.kernel.postMessage(fixture.humanActor, {
    body: "Hold resources until termination is proven",
    idempotencyKey: "terminal-proof-first-message",
    recipients: [{ participantId: fixture.agentId, reason: "mention" }],
    roomId: fixture.room.roomId,
  });
  fixture.clock.advance(1);
  fixture.kernel.postMessage(fixture.humanActor, {
    body: "This Agent must remain queued",
    idempotencyKey: "terminal-proof-second-message",
    recipients: [{ participantId: secondAgentId, reason: "mention" }],
    roomId: fixture.room.roomId,
  });
  const placement = fixture.kernel.scheduleNextPlacement({ leaseMs: 5_000 });
  assert.ok(placement);
  const runAttempt = fixture.kernel.createRunAttempt(host, {
    activationId: placement.activationId,
  });
  const recoveryDescriptor = {
    driver: "fake-recovery",
    metadata: {},
    recoveryKey: "terminal-proof-runtime",
  };
  fixture.kernel.prepareRunAttemptRuntime(host, {
    recoveryDescriptor,
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "terminal-proof-runtime",
  });
  fixture.kernel.markRunAttemptRunning(host, {
    recoveryDescriptor,
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "terminal-proof-runtime",
  });

  assert.throws(
    () =>
      fixture.kernel.finishRunAttempt(host, {
        error: "termination is not proven",
        runAttemptId: runAttempt.runAttemptId,
        state: "failed",
      }),
    RuntimeTerminationProofError,
  );
  assert.equal(fixture.kernel.listPlacements()[0]?.state, "consumed");
  assert.equal(fixture.kernel.scheduleNextPlacement({ leaseMs: 5_000 }), null);
  assert.equal(fixture.kernel.listRuntimeProcesses()[0]?.state, "active");
  fixture.kernel.close();
});

test("retry fails closed when an upgraded database has a terminal RunAttempt with an active RuntimeProcess", () => {
  const { agentId, databasePath, humanActor, kernel, room } = createFixture();
  const host = authenticateHost(kernel, "upgrade-retry-host", agentId);
  kernel.publishRuntimeOffer(host, runtimeOffer(host, "upgrade-retry-offer"));
  kernel.postMessage(humanActor, {
    body: "Do not double-run work left inconsistent by an older Kernel",
    idempotencyKey: "upgrade-retry-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });
  const placement = kernel.scheduleNextPlacement({ leaseMs: 5_000 });
  assert.ok(placement);
  const runAttempt = kernel.createRunAttempt(host, {
    activationId: placement.activationId,
  });
  const recoveryDescriptor = {
    driver: "fake-recovery",
    metadata: {},
    recoveryKey: "upgrade-retry-runtime",
  };
  kernel.prepareRunAttemptRuntime(host, {
    recoveryDescriptor,
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "upgrade-retry-runtime",
  });
  kernel.markRunAttemptRunning(host, {
    recoveryDescriptor,
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "upgrade-retry-runtime",
  });

  const legacy = new DatabaseSync(databasePath);
  legacy
    .prepare(
      "UPDATE run_attempts SET state = 'failed', error = 'legacy terminal bypass', finished_at = ? WHERE run_attempt_id = ?",
    )
    .run("2026-08-26T00:00:00.500Z", runAttempt.runAttemptId);
  legacy.close();

  assert.throws(
    () =>
      kernel.retryActivation(host, {
        activationId: placement.activationId,
        error: "must not release an unproven runtime",
        retryAfterMs: 0,
      }),
    RuntimeTerminationProofError,
  );
  assert.equal(kernel.listPlacements()[0]?.state, "consumed");
  assert.equal(kernel.listRuntimeProcesses()[0]?.state, "active");
  assert.equal(
    kernel.listActivations({ participantId: agentId })[0]?.state,
    "leased",
  );
  kernel.close();
});

test("lease expiry quarantines an upgraded terminal RunAttempt with an active RuntimeProcess", () => {
  const { agentId, clock, databasePath, humanActor, kernel, room } =
    createFixture();
  const host = authenticateHost(kernel, "upgrade-expiry-host", agentId);
  kernel.publishRuntimeOffer(host, runtimeOffer(host, "upgrade-expiry-offer"));
  kernel.postMessage(humanActor, {
    body: "Quarantine legacy inconsistent process evidence",
    idempotencyKey: "upgrade-expiry-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });
  const placement = kernel.scheduleNextPlacement({ leaseMs: 1_000 });
  assert.ok(placement);
  const runAttempt = kernel.createRunAttempt(host, {
    activationId: placement.activationId,
  });
  const recoveryDescriptor = {
    driver: "fake-recovery",
    metadata: {},
    recoveryKey: "upgrade-expiry-runtime",
  };
  kernel.prepareRunAttemptRuntime(host, {
    recoveryDescriptor,
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "upgrade-expiry-runtime",
  });
  kernel.markRunAttemptRunning(host, {
    recoveryDescriptor,
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "upgrade-expiry-runtime",
  });

  const legacy = new DatabaseSync(databasePath);
  legacy
    .prepare(
      "UPDATE run_attempts SET state = 'failed', error = 'legacy terminal bypass', finished_at = ? WHERE run_attempt_id = ?",
    )
    .run("2026-08-26T00:00:00.500Z", runAttempt.runAttemptId);
  legacy.close();
  clock.advance(1_001);

  assert.equal(kernel.scheduleNextPlacement({ leaseMs: 1_000 }), null);
  assert.equal(
    kernel.listActivations({ participantId: agentId })[0]?.state,
    "quarantined",
  );
  assert.equal(kernel.listRuntimeProcesses()[0]?.state, "orphaned");
  assert.equal(kernel.listPlacements()[0]?.state, "consumed");
  kernel.close();
});

test("startup fences a fully persisted legacy retry while its RuntimeProcess is still active", () => {
  const fixture = createFixture();
  const secondAgentId = addAgent(
    fixture,
    "upgrade-retry-second-agent",
    "upgrade-retry-second-agent-create",
  );
  const host = authenticateHost(fixture.kernel, "upgrade-retry-full-host", [
    fixture.agentId,
    secondAgentId,
  ]);
  fixture.kernel.publishRuntimeOffer(
    host,
    runtimeOffer(host, "upgrade-retry-full-offer"),
  );
  fixture.kernel.postMessage(fixture.humanActor, {
    body: "Preserve the old active process fence after an upgrade",
    idempotencyKey: "upgrade-retry-full-first-message",
    recipients: [{ participantId: fixture.agentId, reason: "mention" }],
    roomId: fixture.room.roomId,
  });
  fixture.clock.advance(1);
  fixture.kernel.postMessage(fixture.humanActor, {
    body: "Do not schedule this Agent onto the same capacity or workspace",
    idempotencyKey: "upgrade-retry-full-second-message",
    recipients: [{ participantId: secondAgentId, reason: "mention" }],
    roomId: fixture.room.roomId,
  });
  const placement = fixture.kernel.scheduleNextPlacement({ leaseMs: 5_000 });
  assert.ok(placement);
  assert.equal(placement.participantId, fixture.agentId);
  const runAttempt = fixture.kernel.createRunAttempt(host, {
    activationId: placement.activationId,
  });
  const recoveryDescriptor = {
    driver: "fake-recovery",
    metadata: {},
    recoveryKey: "upgrade-retry-full-runtime",
  };
  fixture.kernel.prepareRunAttemptRuntime(host, {
    recoveryDescriptor,
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "upgrade-retry-full-runtime",
  });
  fixture.kernel.markRunAttemptRunning(host, {
    recoveryDescriptor,
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "upgrade-retry-full-runtime",
  });
  fixture.kernel.close();

  const legacy = new DatabaseSync(fixture.databasePath);
  legacy
    .prepare(
      "UPDATE run_attempts SET state = 'failed', error = 'legacy premature finish', finished_at = ? WHERE run_attempt_id = ?",
    )
    .run("2026-08-26T00:00:00.500Z", runAttempt.runAttemptId);
  legacy
    .prepare(
      "UPDATE activations SET state = 'queued', lease_owner = NULL, lease_until = NULL, lease_until_ms = NULL, available_at = ?, available_at_ms = ?, last_error = 'legacy retry', updated_at = ? WHERE activation_id = ?",
    )
    .run(
      "2026-08-26T00:00:00.500Z",
      new Date("2026-08-26T00:00:00.500Z").getTime(),
      "2026-08-26T00:00:00.500Z",
      placement.activationId,
    );
  legacy
    .prepare(
      "UPDATE placements SET state = 'released', release_reason = 'legacy premature release', updated_at = ? WHERE placement_id = ?",
    )
    .run("2026-08-26T00:00:00.500Z", placement.placementId);
  legacy
    .prepare(
      "DELETE FROM placement_capacity_reservations WHERE placement_id = ?",
    )
    .run(placement.placementId);
  legacy
    .prepare("DELETE FROM workspace_leases WHERE placement_id = ?")
    .run(placement.placementId);
  legacy.close();

  const upgraded = new RoomKernel({
    databasePath: fixture.databasePath,
    now: fixture.clock.now,
    runtimeCertifications: [runtimeCertification],
  });
  upgraded.initialize();

  assert.equal(
    upgraded.listActivations({ participantId: fixture.agentId })[0]?.state,
    "quarantined",
  );
  assert.equal(upgraded.listRuntimeProcesses()[0]?.state, "orphaned");
  assert.equal(upgraded.listPlacements()[0]?.state, "released");
  assert.equal(upgraded.scheduleNextPlacement({ leaseMs: 5_000 }), null);
  assert.equal(upgraded.listPlacements().length, 1);
  upgraded.close();
});

test("retry cannot bypass an active RunAttempt or leak a reserved Placement", () => {
  const { agentId, humanActor, kernel, room } = createFixture();
  const host = authenticateHost(kernel, "retry-placement-host", agentId);
  kernel.publishRuntimeOffer(host, runtimeOffer(host, "retry-placement-offer"));
  kernel.postMessage(humanActor, {
    body: "Release a Placement when launch is rejected before Run creation",
    idempotencyKey: "retry-placement-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });
  const initialPlacement = kernel.scheduleNextPlacement({ leaseMs: 5_000 });
  assert.ok(initialPlacement);
  kernel.retryActivation(host, {
    activationId: initialPlacement.activationId,
    error: "runtime probe rejected launch",
    retryAfterMs: 0,
  });
  assert.equal(kernel.listPlacements()[0]?.state, "released");

  const replacement = kernel.scheduleNextPlacement({ leaseMs: 5_000 });
  assert.ok(replacement);
  const runAttempt = kernel.createRunAttempt(host, {
    activationId: replacement.activationId,
  });
  kernel.prepareRunAttemptRuntime(host, {
    recoveryDescriptor: {
      driver: "fake-recovery",
      metadata: {},
      recoveryKey: "retry-placement-runtime",
    },
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "retry-placement-runtime",
  });

  assert.throws(
    () =>
      kernel.retryActivation(host, {
        activationId: replacement.activationId,
        error: "must prove termination first",
        retryAfterMs: 0,
      }),
    RuntimeTerminationProofError,
  );
  assert.equal(
    kernel
      .listPlacements()
      .find((placement) => placement.placementId === replacement.placementId)
      ?.state,
    "consumed",
  );
  kernel.close();
});

test("a crash after RunAttempt finish but before Activation resolution is requeued", () => {
  const { agentId, clock, humanActor, kernel, room } = createFixture();
  const host = authenticateHost(kernel, "post-finish-crash-host", agentId);
  kernel.publishRuntimeOffer(
    host,
    runtimeOffer(host, "post-finish-crash-offer"),
  );
  kernel.postMessage(humanActor, {
    body: "Recover the business Activation after process bookkeeping finished",
    idempotencyKey: "post-finish-crash-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });
  const placement = kernel.scheduleNextPlacement({ leaseMs: 1_000 });
  assert.ok(placement);
  const runAttempt = kernel.createRunAttempt(host, {
    activationId: placement.activationId,
  });
  const recoveryDescriptor = {
    driver: "fake-recovery",
    metadata: {},
    recoveryKey: "post-finish-crash-runtime",
  };
  kernel.prepareRunAttemptRuntime(host, {
    recoveryDescriptor,
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "post-finish-crash-runtime",
  });
  kernel.markRunAttemptRunning(host, {
    recoveryDescriptor,
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "post-finish-crash-runtime",
  });
  kernel.recordRuntimeTermination(host, {
    exit: { code: 1 },
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "post-finish-crash-runtime",
  });
  kernel.finishRunAttempt(host, {
    exitCode: 1,
    runAttemptId: runAttempt.runAttemptId,
    state: "exited",
  });
  clock.advance(1_001);

  const replacement = kernel.scheduleNextPlacement({ leaseMs: 1_000 });
  assert.ok(replacement);
  assert.equal(replacement.activationId, placement.activationId);
  assert.notEqual(replacement.placementId, placement.placementId);
  kernel.close();
});

test("a crash after terminal proof but before RunAttempt finish is automatically requeued", () => {
  const { agentId, clock, humanActor, kernel, room } = createFixture();
  const host = authenticateHost(kernel, "proof-before-finish-host", agentId);
  kernel.publishRuntimeOffer(
    host,
    runtimeOffer(host, "proof-before-finish-offer"),
  );
  kernel.postMessage(humanActor, {
    body: "Recover after terminal proof commits before RunAttempt finish",
    idempotencyKey: "proof-before-finish-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });
  const placement = kernel.scheduleNextPlacement({ leaseMs: 1_000 });
  assert.ok(placement);
  const runAttempt = kernel.createRunAttempt(host, {
    activationId: placement.activationId,
  });
  const recoveryDescriptor = {
    driver: "fake-recovery",
    metadata: {},
    recoveryKey: "proof-before-finish-runtime",
  };
  kernel.prepareRunAttemptRuntime(host, {
    recoveryDescriptor,
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "proof-before-finish-runtime",
  });
  kernel.markRunAttemptRunning(host, {
    recoveryDescriptor,
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "proof-before-finish-runtime",
  });
  kernel.recordRuntimeTermination(host, {
    exit: { code: 0 },
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "proof-before-finish-runtime",
  });
  clock.advance(1_001);

  const replacement = kernel.scheduleNextPlacement({ leaseMs: 1_000 });
  assert.ok(replacement);
  assert.equal(replacement.activationId, placement.activationId);
  assert.equal(kernel.listRunAttempts()[0]?.state, "exited");
  assert.equal(kernel.listRuntimeProcesses()[0]?.state, "terminated");
  assert.notEqual(replacement.placementId, placement.placementId);
  kernel.close();
});

test("a crash after recovered terminal proof automatically resolves quarantine", () => {
  const { agentId, clock, humanActor, kernel, room } = createFixture();
  const host = authenticateHost(kernel, "proof-before-resolve-host", agentId);
  kernel.publishRuntimeOffer(
    host,
    runtimeOffer(host, "proof-before-resolve-offer"),
  );
  kernel.postMessage(humanActor, {
    body: "Recover after orphan terminal proof commits before quarantine resolve",
    idempotencyKey: "proof-before-resolve-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });
  const placement = kernel.scheduleNextPlacement({ leaseMs: 1_000 });
  assert.ok(placement);
  const runAttempt = kernel.createRunAttempt(host, {
    activationId: placement.activationId,
  });
  const recoveryDescriptor = {
    driver: "fake-recovery",
    metadata: {},
    recoveryKey: "proof-before-resolve-runtime",
  };
  kernel.prepareRunAttemptRuntime(host, {
    recoveryDescriptor,
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "proof-before-resolve-runtime",
  });
  kernel.markRunAttemptRunning(host, {
    recoveryDescriptor,
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "proof-before-resolve-runtime",
  });
  clock.advance(1_001);
  assert.equal(kernel.scheduleNextPlacement({ leaseMs: 1_000 }), null);
  const recovery = kernel.leaseNextRuntimeRecovery(host, {
    driverIds: ["fake-recovery"],
    leaseMs: 1_000,
  });
  assert.ok(recovery);
  kernel.recordRecoveredRuntimeTermination(host, {
    exit: { code: 1 },
    recoveryAttemptCount: recovery.recoveryAttemptCount,
    runtimeProcessId: recovery.runtimeProcessId,
  });

  const replacement = kernel.scheduleNextPlacement({ leaseMs: 1_000 });
  assert.ok(replacement);
  assert.equal(replacement.activationId, placement.activationId);
  assert.equal(kernel.listRuntimeProcesses()[0]?.state, "terminated");
  assert.notEqual(replacement.placementId, placement.placementId);
  kernel.close();
});

test("terminal RunAttempt releases Kernel capacity for another Agent", () => {
  const { agentId, clock, controlRoom, humanActor, kernel, policy, room } =
    createFixture();
  const secondAgentProvisioning = kernel.provisionPrincipal({
    handle: "second-agent",
    kind: "agent",
  });
  const secondAgentId = secondAgentProvisioning.principal.principalId;
  kernel.addMember(humanActor, {
    principalId: secondAgentId,
    roomId: room.roomId,
  });
  kernel.addMember(humanActor, {
    principalId: secondAgentId,
    roomId: controlRoom.roomId,
  });
  kernel.createAgentDefinition(humanActor, {
    basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoom.roomId),
    controlRoomId: controlRoom.roomId,
    executionPolicyRevisionId: policy.executionPolicyRevisionId,
    idempotencyKey: "second-agent-create",
    instructionRefs: [],
    memoryPolicyRef: {
      artifactId: "memory-policy",
      contentDigest: digest("b"),
      versionId: "memory-policy-v1",
    },
    participantId: secondAgentId,
    role: "second implementation agent",
    skillRefs: [],
  });
  const host = authenticateHost(kernel, "host-shared", [
    agentId,
    secondAgentId,
  ]);
  kernel.publishRuntimeOffer(host, runtimeOffer(host, "offer-shared"));
  kernel.postMessage(humanActor, {
    body: "First lane",
    idempotencyKey: "first-lane-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });
  clock.advance(1);
  kernel.postMessage(humanActor, {
    body: "Second lane",
    idempotencyKey: "second-lane-message",
    recipients: [{ participantId: secondAgentId, reason: "mention" }],
    roomId: room.roomId,
  });

  const firstPlacement = kernel.scheduleNextPlacement({ leaseMs: 5_000 });
  assert.equal(firstPlacement?.participantId, agentId);
  assert.equal(kernel.scheduleNextPlacement({ leaseMs: 5_000 }), null);
  const firstRun = kernel.createRunAttempt(host, {
    activationId: firstPlacement!.activationId,
  });
  kernel.finishRunAttempt(host, {
    exitCode: 0,
    runAttemptId: firstRun.runAttemptId,
    state: "exited",
  });

  assert.equal(kernel.listPlacements()[0]?.state, "released");
  assert.equal(
    kernel.scheduleNextPlacement({ leaseMs: 5_000 })?.participantId,
    secondAgentId,
  );
  kernel.close();
});

test("RunAttempt references frozen placement after Agent and Policy v2 activation", () => {
  const {
    agentDefinition,
    agentDefinitionRevision,
    agentId,
    controlRoom,
    humanActor,
    kernel,
    policy,
    room,
  } = createFixture();
  const host = authenticateHost(kernel, "host-a", agentId);
  kernel.publishRuntimeOffer(host, runtimeOffer(host, "offer-a"));
  kernel.postMessage(humanActor, {
    body: "Freeze this runtime choice",
    idempotencyKey: "provenance-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });
  const placement = kernel.scheduleNextPlacement({ leaseMs: 5_000 });
  assert.ok(placement);
  const runAttempt = kernel.createRunAttempt(host, {
    activationId: placement.activationId,
  });

  const policyV2 = kernel.reviseExecutionPolicy(humanActor, {
    basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoom.roomId),
    executionPolicyId: policy.executionPolicyId,
    idempotencyKey: "policy-v2",
    modelIntent: policy.modelIntent,
    preferred: [
      { criterion: "runtime_offer", targetId: "offer-a", weight: 10 },
    ],
    required: policy.required,
    retryPolicyRef: policy.retryPolicyRef,
    sessionPolicy: policy.sessionPolicy,
  }).policy;
  const agentV2 = kernel.reviseAgentDefinition(humanActor, {
    agentDefinitionId: agentDefinition.agentDefinitionId,
    basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoom.roomId),
    executionPolicyRevisionId: policyV2.executionPolicyRevisionId,
    idempotencyKey: "agent-v2",
    instructionRefs: agentDefinitionRevision.instructionRefs,
    memoryPolicyRef: agentDefinitionRevision.memoryPolicyRef,
    role: "review agent",
    skillRefs: agentDefinitionRevision.skillRefs,
  }).revision;

  const historicalRun = kernel.listRunAttempts({ roomId: room.roomId })[0];
  assert.equal(historicalRun?.runAttemptId, runAttempt.runAttemptId);
  assert.equal(
    historicalRun?.placement?.agentDefinitionRevisionId,
    agentDefinitionRevision.agentDefinitionRevisionId,
  );
  assert.equal(
    historicalRun?.placement?.executionPolicyRevisionId,
    policy.executionPolicyRevisionId,
  );
  assert.notEqual(
    historicalRun?.placement?.agentDefinitionRevisionId,
    agentV2.agentDefinitionRevisionId,
  );
  assert.equal(historicalRun?.placement?.state, "consumed");
  kernel.close();
});

test("legacy single-runtime leasing still creates a RunAttempt without placement provenance", () => {
  const { agentId, humanActor, kernel, room } = createFixture();
  const host = authenticateHost(kernel, "legacy-host", agentId);
  kernel.postMessage(humanActor, {
    body: "Use the compatibility path",
    idempotencyKey: "legacy-message",
    recipients: [{ participantId: agentId, reason: "mention" }],
    roomId: room.roomId,
  });
  const activation = kernel.leaseNextActivation(host, { leaseMs: 5_000 });
  assert.ok(activation);
  const runAttempt = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  assert.equal(runAttempt.placement, undefined);
  kernel.close();
});
