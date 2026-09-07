import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ForbiddenError, RoomKernel } from "../src/index.ts";

function createRoomTaskDefaultsFixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-room-task-defaults-"));
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now: () => new Date("2026-09-08T01:00:00.000Z"),
  });
  kernel.initialize();
  const owner = kernel.provisionPrincipal({
    handle: "defaults-owner",
    kind: "human",
  });
  const assignee = kernel.provisionPrincipal({
    handle: "defaults-assignee",
    kind: "agent",
  });
  const collaborator = kernel.provisionPrincipal({
    handle: "defaults-collaborator",
    kind: "agent",
  });
  const reviewer = kernel.provisionPrincipal({
    handle: "defaults-reviewer",
    kind: "agent",
  });
  const outsider = kernel.provisionPrincipal({
    handle: "defaults-outsider",
    kind: "agent",
  });
  const ownerActor = kernel.authenticateAccessToken(owner.accessToken);
  const room = kernel.createRoom(ownerActor, {
    name: "Room defaults",
    slug: "room-defaults",
  });
  for (const principalId of [
    assignee.principal.principalId,
    collaborator.principal.principalId,
    reviewer.principal.principalId,
  ]) {
    kernel.addMember(ownerActor, { principalId, roomId: room.roomId });
  }
  const latestRoomSeq = () =>
    kernel.sync(ownerActor, {
      consumerId: "room-task-defaults-fixture",
      roomId: room.roomId,
    }).latestRoomSeq;
  return {
    assigneeId: assignee.principal.principalId,
    cleanup() {
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
    collaboratorId: collaborator.principal.principalId,
    kernel,
    latestRoomSeq,
    ownerActor,
    outsiderId: outsider.principal.principalId,
    ownerId: owner.principal.principalId,
    reviewerId: reviewer.principal.principalId,
    roomId: room.roomId,
    update(
      idempotencyKey: string,
      taskDefaults?: {
        defaultAssigneeId?: string;
        defaultCollaboratorIds: string[];
        defaultReviewerIds: string[];
      },
    ) {
      return kernel.updateWorkspaceRoom(ownerActor, {
        basedOnRoomSeq: latestRoomSeq(),
        idempotencyKey,
        name: "Room defaults",
        roomId: room.roomId,
        ...(taskDefaults === undefined ? {} : { taskDefaults }),
        visibility: "private",
      });
    },
  };
}

function readRoom(fixture: ReturnType<typeof createRoomTaskDefaultsFixture>) {
  const room = fixture.kernel
    .listRooms(fixture.ownerActor, {})
    .find(({ roomId }) => roomId === fixture.roomId);
  assert.ok(room !== undefined);
  return room;
}

test("Room update stores Task participant defaults and emits them", (t) => {
  const fixture = createRoomTaskDefaultsFixture();
  t.after(() => fixture.cleanup());
  const updated = fixture.update("set-defaults", {
    defaultAssigneeId: fixture.assigneeId,
    defaultCollaboratorIds: [fixture.collaboratorId],
    defaultReviewerIds: [fixture.reviewerId],
  });
  assert.equal(updated.event.type, "room.updated");
  assert.deepEqual(updated.event.payload.taskDefaults, {
    defaultAssigneeId: fixture.assigneeId,
    defaultCollaboratorIds: [fixture.collaboratorId],
    defaultReviewerIds: [fixture.reviewerId],
  });
  assert.deepEqual(updated.room.taskDefaults, {
    defaultAssigneeId: fixture.assigneeId,
    defaultCollaboratorIds: [fixture.collaboratorId],
    defaultReviewerIds: [fixture.reviewerId],
  });
  assert.deepEqual(readRoom(fixture).taskDefaults, {
    defaultAssigneeId: fixture.assigneeId,
    defaultCollaboratorIds: [fixture.collaboratorId],
    defaultReviewerIds: [fixture.reviewerId],
  });
});

test("Room Task defaults reject non-member and Human participants", (t) => {
  const fixture = createRoomTaskDefaultsFixture();
  t.after(() => fixture.cleanup());
  assert.throws(
    () =>
      fixture.update("outsider-default", {
        defaultAssigneeId: fixture.outsiderId,
        defaultCollaboratorIds: [],
        defaultReviewerIds: [],
      }),
    ForbiddenError,
  );
  assert.throws(
    () =>
      fixture.update("human-default", {
        defaultAssigneeId: fixture.ownerId,
        defaultCollaboratorIds: [],
        defaultReviewerIds: [],
      }),
    ForbiddenError,
  );
  assert.equal(readRoom(fixture).taskDefaults, undefined);
});

test("Room update without Task defaults leaves them, clearing removes them", (t) => {
  const fixture = createRoomTaskDefaultsFixture();
  t.after(() => fixture.cleanup());
  fixture.update("set-defaults", {
    defaultAssigneeId: fixture.assigneeId,
    defaultCollaboratorIds: [fixture.collaboratorId],
    defaultReviewerIds: [],
  });
  const untouched = fixture.update("rename-only");
  assert.equal(untouched.event.payload.taskDefaults, undefined);
  assert.deepEqual(readRoom(fixture).taskDefaults, {
    defaultAssigneeId: fixture.assigneeId,
    defaultCollaboratorIds: [fixture.collaboratorId],
    defaultReviewerIds: [],
  });
  fixture.update("clear-defaults", {
    defaultCollaboratorIds: [],
    defaultReviewerIds: [],
  });
  assert.equal(readRoom(fixture).taskDefaults, undefined);
});

test("removing an Agent member drops it from Room Task defaults", (t) => {
  const fixture = createRoomTaskDefaultsFixture();
  t.after(() => fixture.cleanup());
  fixture.update("set-defaults", {
    defaultAssigneeId: fixture.assigneeId,
    defaultCollaboratorIds: [fixture.collaboratorId],
    defaultReviewerIds: [fixture.reviewerId],
  });
  fixture.kernel.removeRoomMember(fixture.ownerActor, {
    basedOnRoomSeq: fixture.latestRoomSeq(),
    idempotencyKey: "remove-collaborator",
    principalId: fixture.collaboratorId,
    roomId: fixture.roomId,
  });
  assert.deepEqual(readRoom(fixture).taskDefaults, {
    defaultAssigneeId: fixture.assigneeId,
    defaultCollaboratorIds: [],
    defaultReviewerIds: [fixture.reviewerId],
  });
  fixture.kernel.removeRoomMember(fixture.ownerActor, {
    basedOnRoomSeq: fixture.latestRoomSeq(),
    idempotencyKey: "remove-assignee",
    principalId: fixture.assigneeId,
    roomId: fixture.roomId,
  });
  assert.equal(readRoom(fixture).taskDefaults, undefined);
});

test("Room Task defaults are never injected into Task creation", (t) => {
  const fixture = createRoomTaskDefaultsFixture();
  t.after(() => fixture.cleanup());
  fixture.update("set-defaults", {
    defaultAssigneeId: fixture.assigneeId,
    defaultCollaboratorIds: [fixture.collaboratorId],
    defaultReviewerIds: [fixture.reviewerId],
  });
  const created = fixture.kernel.createTask(fixture.ownerActor, {
    idempotencyKey: "task-without-participants",
    roomId: fixture.roomId,
    title: "Explicit Human choices only",
  });
  assert.equal(created.task.assigneeId, undefined);
  assert.deepEqual(created.task.collaboratorIds ?? [], []);
  assert.deepEqual(created.task.reviewerIds ?? [], []);
});

test("worker Task paths ignore Room Task defaults", (t) => {
  const fixture = createRoomTaskDefaultsFixture();
  t.after(() => fixture.cleanup());
  fixture.update("set-defaults", {
    defaultAssigneeId: fixture.assigneeId,
    defaultCollaboratorIds: [fixture.collaboratorId],
    defaultReviewerIds: [fixture.reviewerId],
  });
  const host = fixture.kernel.authenticateHostAccessToken(
    fixture.kernel.provisionHostCredential({
      hostId: "defaults-host",
      participantIds: [fixture.assigneeId],
    }).accessToken,
  );
  fixture.kernel.heartbeatHost(host);
  fixture.kernel.postMessage(fixture.ownerActor, {
    body: "Please take this on",
    idempotencyKey: "defaults-message",
    recipients: [{ participantId: fixture.assigneeId, reason: "mention" }],
    roomId: fixture.roomId,
  });
  const activation = fixture.kernel.leaseNextActivation(host, {
    leaseMs: 30_000,
  });
  assert.ok(activation);
  const run = fixture.kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    recoveryDescriptor: {
      driver: "fake-runtime",
      metadata: {},
      recoveryKey: "defaults-runtime",
    },
    runAttemptId: run.runAttemptId,
    runtimeRunId: "defaults-runtime",
  };
  fixture.kernel.prepareRunAttemptRuntime(host, runtime);
  fixture.kernel.markRunAttemptRunning(host, runtime);
  const execution = fixture.kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: "defaults-worker",
    hostId: host.hostId,
    participantId: fixture.assigneeId,
    roomId: fixture.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const delivery = fixture.kernel.syncWorker(execution, {});
  fixture.kernel.acknowledgeWorkerCursor(execution, {
    throughSeq: delivery.cursorAfter,
  });
  const created = fixture.kernel.createWorkerTask(execution, {
    basedOnRoomSeq: activation.toSeq,
    idempotencyKey: "worker-task",
    leaseMs: 30_000,
    title: "Worker created Task",
  });
  assert.equal(created.task.assigneeId, undefined);
  assert.deepEqual(created.task.collaboratorIds ?? [], []);
  assert.deepEqual(created.task.reviewerIds ?? [], []);
});

test("tombstoning an Agent prunes it from every Room's stored Task defaults", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-room-task-defaults-agent-"));
  const databasePath = join(directory, "room.db");
  const now = new Date("2026-09-08T01:00:00.000Z");
  const kernel = new RoomKernel({ databasePath, now: () => now });
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const bootstrap = kernel.provisionPrincipal({
      handle: "bootstrap",
      kind: "agent",
    });
    const actor = kernel.authenticateAccessToken(owner.accessToken);
    const workspace = kernel.createWorkspace(actor, {
      idempotencyKey: "workspace",
      name: "Defaults",
      slug: "defaults",
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "defaults-host",
        participantIds: [bootstrap.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(host);
    const digest = `sha256:${"a".repeat(64)}`;
    kernel.publishRuntimeOffer(host, {
      capacityPoolIds: [],
      capabilityEvidence: [],
      certificationRefs: [],
      hostId: host.hostId,
      hostInstanceId: host.instanceId,
      isolation: { evidence: "declared", level: "none" },
      leaseUntil: "2026-09-08T02:00:00.000Z",
      maxConcurrent: 4,
      modelBindingDescriptors: [],
      observedAt: now.toISOString(),
      protocolFamily: "rah-worker-process/v1",
      revisionDigest: digest,
      runtimeOfferId: "offer",
      runtimeProfileId: "profile",
      runtimeProfileRevisionId: "profile-v1",
      state: "available",
      supportedToolAccessModes: ["full_access"],
      workspaceMountDescriptors: [
        {
          modes: ["in_place"],
          workspaceDefinitionId: workspace.workspace.workspaceId,
          workspaceMountDigest: digest,
          workspaceMountRevisionId: "mount-v1",
        },
      ],
    });
    const controlSeq = () =>
      kernel.sync(actor, {
        consumerId: "defaults-control",
        roomId: workspace.controlRoom.roomId,
      }).latestRoomSeq;
    const provision = (handle: string) =>
      kernel.provisionWorkspaceAgent(actor, {
        basedOnRoomSeq: controlSeq(),
        controlRoomId: workspace.controlRoom.roomId,
        displayName: handle,
        description: handle,
        handle,
        idempotencyKey: `create-${handle}`,
        instructions: "Assist.",
        role: "Assistant",
        modelIntent: { fallback: "disabled" },
        runtimeOfferId: "offer",
      });
    const assignee = provision("defaults-assignee");
    const collaborator = provision("defaults-collaborator");
    const reviewer = provision("defaults-reviewer");
    const channel = kernel.createWorkspaceRoom(actor, {
      basedOnControlRoomSeq: controlSeq(),
      idempotencyKey: "channel-create",
      kind: "channel",
      name: "Defaults channel",
      slug: "defaults-channel",
      visibility: "public",
      workspaceId: workspace.workspace.workspaceId,
    });
    const roomId = channel.room.roomId;
    for (const agent of [assignee, collaborator, reviewer]) {
      kernel.addMember(actor, {
        principalId: agent.agent.definition.participantId,
        roomId,
      });
    }
    const roomSeq = () =>
      kernel.sync(actor, { consumerId: "defaults-room", roomId }).latestRoomSeq;
    kernel.updateWorkspaceRoom(actor, {
      basedOnRoomSeq: roomSeq(),
      idempotencyKey: "set-defaults",
      name: "Defaults channel",
      roomId,
      taskDefaults: {
        defaultAssigneeId: assignee.agent.definition.participantId,
        defaultCollaboratorIds: [collaborator.agent.definition.participantId],
        defaultReviewerIds: [reviewer.agent.definition.participantId],
      },
      visibility: "public",
    });
    const storedDefaults = () => {
      const database = new DatabaseSync(databasePath, { readOnly: true });
      try {
        return database
          .prepare("SELECT * FROM room_task_defaults WHERE room_id = ?")
          .get(roomId) as Record<string, unknown> | undefined;
      } finally {
        database.close();
      }
    };
    const tombstone = (
      agent: ReturnType<typeof provision>,
      keyPrefix: string,
    ) => {
      const disabled = kernel.manageWorkspaceAgent(actor, {
        action: "set_state",
        agentDefinitionId: agent.agent.definition.agentDefinitionId,
        basedOnRoomSeq: controlSeq(),
        idempotencyKey: `${keyPrefix}-disable`,
        state: "disabled",
      });
      assert.equal(disabled.event.type, "agent.disabled");
      kernel.manageWorkspaceAgent(actor, {
        action: "set_state",
        agentDefinitionId: agent.agent.definition.agentDefinitionId,
        basedOnRoomSeq: controlSeq(),
        idempotencyKey: `${keyPrefix}-tombstone`,
        state: "tombstoned",
      });
    };
    const before = storedDefaults();
    assert.ok(before !== undefined);
    assert.deepEqual(JSON.parse(String(before.default_collaborator_ids_json)), [
      collaborator.agent.definition.participantId,
    ]);
    tombstone(collaborator, "collaborator");
    const pruned = storedDefaults();
    assert.ok(pruned !== undefined);
    assert.equal(
      pruned.default_assignee_id,
      assignee.agent.definition.participantId,
    );
    assert.deepEqual(JSON.parse(String(pruned.default_collaborator_ids_json)), []);
    assert.deepEqual(JSON.parse(String(pruned.default_reviewer_ids_json)), [
      reviewer.agent.definition.participantId,
    ]);
    tombstone(assignee, "assignee");
    assert.equal(storedDefaults(), undefined);
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
