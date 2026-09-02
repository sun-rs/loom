import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RuntimeOffer } from "@rah-os/protocol";

import { RoomKernel } from "../src/index.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

test("a Human creates a managed Workspace and Rooms through its control Room", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-workspace-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({
      handle: "workspace-owner",
      kind: "human",
    });
    const outsider = kernel.provisionPrincipal({
      handle: "workspace-outsider",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "workspace-agent",
      kind: "agent",
    });
    const ownerActor = kernel.authenticateAccessToken(owner.accessToken);
    const outsiderActor = kernel.authenticateAccessToken(outsider.accessToken);
    const agentActor = kernel.authenticateAccessToken(agent.accessToken);

    assert.throws(
      () =>
        kernel.createWorkspace(agentActor, {
          idempotencyKey: "workspace-create-by-agent",
          name: "Agent Workspace",
          slug: "agent-workspace",
        }),
      /only Human principals/i,
    );

    const created = kernel.createWorkspace(ownerActor, {
      idempotencyKey: "workspace-create-main",
      name: "RAH OS",
      slug: "rah-os",
    });
    assert.equal(created.deduplicated, false);
    assert.equal(created.workspace.controlRoomId, created.controlRoom.roomId);
    assert.equal(created.controlRoom.kind, "control");
    assert.equal(
      created.controlRoom.workspaceId,
      created.workspace.workspaceId,
    );
    assert.equal(created.event.roomId, created.controlRoom.roomId);
    assert.equal(created.event.roomSeq, 1);
    assert.deepEqual(
      kernel.listRoomMemberships(ownerActor, {
        roomId: created.controlRoom.roomId,
      }),
      [
        {
          joinedAt: created.workspace.createdAt,
          principalId: owner.principal.principalId,
          role: "owner",
          roomId: created.controlRoom.roomId,
        },
      ],
    );

    const replay = kernel.createWorkspace(ownerActor, {
      idempotencyKey: "workspace-create-main",
      name: "RAH OS",
      slug: "rah-os",
    });
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.workspace.workspaceId, created.workspace.workspaceId);
    assert.throws(
      () =>
        kernel.createWorkspace(ownerActor, {
          idempotencyKey: "workspace-create-main",
          name: "Changed",
          slug: "rah-os",
        }),
      /idempotency/i,
    );

    assert.throws(
      () =>
        kernel.createWorkspaceRoom(outsiderActor, {
          basedOnControlRoomSeq: created.event.roomSeq,
          idempotencyKey: "room-create-outsider",
          kind: "channel",
          name: "Outsider Room",
          slug: "outsider-room",
          workspaceId: created.workspace.workspaceId,
        }),
      /not a member|owner or admin/i,
    );

    const roomCreated = kernel.createWorkspaceRoom(ownerActor, {
      basedOnControlRoomSeq: created.event.roomSeq,
      idempotencyKey: "room-create-engineering",
      kind: "channel",
      name: "Engineering",
      slug: "engineering",
      workspaceId: created.workspace.workspaceId,
    });
    assert.equal(roomCreated.deduplicated, false);
    assert.equal(roomCreated.room.kind, "channel");
    assert.equal(roomCreated.room.workspaceId, created.workspace.workspaceId);
    assert.equal(roomCreated.event.roomId, created.controlRoom.roomId);
    assert.equal(roomCreated.event.roomSeq, 2);
    assert.equal(
      kernel.listRoomMemberships(ownerActor, {
        roomId: roomCreated.room.roomId,
      })[0]?.role,
      "owner",
    );

    assert.equal(
      kernel.createWorkspaceRoom(ownerActor, {
        basedOnControlRoomSeq: created.event.roomSeq,
        idempotencyKey: "room-create-engineering",
        kind: "channel",
        name: "Engineering",
        slug: "engineering",
        workspaceId: created.workspace.workspaceId,
      }).deduplicated,
      true,
    );
    assert.throws(
      () =>
        kernel.createWorkspaceRoom(ownerActor, {
          basedOnControlRoomSeq: created.event.roomSeq,
          idempotencyKey: "room-create-stale",
          kind: "channel",
          name: "Stale",
          slug: "stale",
          workspaceId: created.workspace.workspaceId,
        }),
      /stale/i,
    );

    assert.deepEqual(
      kernel
        .listRooms(ownerActor, { workspaceId: created.workspace.workspaceId })
        .map((room) => room.kind),
      ["control", "channel"],
    );
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Channel creation atomically persists metadata and initial Workspace members", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-room-create-profile-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const colleague = kernel.provisionPrincipal({
      handle: "colleague",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({ handle: "alice", kind: "agent" });
    const ownerActor = kernel.authenticateAccessToken(owner.accessToken);
    const colleagueActor = kernel.authenticateAccessToken(
      colleague.accessToken,
    );
    const workspace = kernel.createWorkspace(ownerActor, {
      idempotencyKey: "workspace-created",
      name: "Main",
      slug: "main",
    });
    kernel.addMember(ownerActor, {
      principalId: colleague.principal.principalId,
      roomId: workspace.controlRoom.roomId,
    });
    kernel.addMember(ownerActor, {
      principalId: agent.principal.principalId,
      roomId: workspace.controlRoom.roomId,
    });
    const basedOnControlRoomSeq = kernel.sync(ownerActor, {
      afterSeq: 0,
      consumerId: "create-profile",
      roomId: workspace.controlRoom.roomId,
    }).latestRoomSeq;

    const created = kernel.createWorkspaceRoom(ownerActor, {
      basedOnControlRoomSeq,
      description: "Coordinate product work.",
      idempotencyKey: "room-created",
      initialAgentParticipantIds: [agent.principal.principalId],
      kind: "channel",
      name: "Product",
      slug: "product",
      visibility: "public",
      workspaceId: workspace.workspace.workspaceId,
    });

    assert.equal(created.room.description, "Coordinate product work.");
    assert.equal(created.room.visibility, "public");
    assert.deepEqual(
      kernel
        .listRoomMemberships(ownerActor, { roomId: created.room.roomId })
        .map(({ principalId, role }) => ({ principalId, role })),
      [
        { principalId: owner.principal.principalId, role: "owner" },
        { principalId: agent.principal.principalId, role: "member" },
        { principalId: colleague.principal.principalId, role: "member" },
      ].sort(
        (left, right) =>
          left.role.localeCompare(right.role) ||
          left.principalId.localeCompare(right.principalId),
      ),
    );
    assert.equal(
      kernel
        .listRooms(colleagueActor, {
          workspaceId: workspace.workspace.workspaceId,
        })
        .some(({ roomId }) => roomId === created.room.roomId),
      true,
    );
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Channel settings update is atomic, idempotent, stale-safe, and manager-only", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-room-update-profile-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const colleague = kernel.provisionPrincipal({
      handle: "colleague",
      kind: "human",
    });
    const ownerActor = kernel.authenticateAccessToken(owner.accessToken);
    const colleagueActor = kernel.authenticateAccessToken(
      colleague.accessToken,
    );
    const workspace = kernel.createWorkspace(ownerActor, {
      idempotencyKey: "workspace-created-for-update",
      name: "Main",
      slug: "main-update",
    });
    kernel.addMember(ownerActor, {
      principalId: colleague.principal.principalId,
      roomId: workspace.controlRoom.roomId,
    });
    const channel = kernel.createWorkspaceRoom(ownerActor, {
      basedOnControlRoomSeq: kernel.sync(ownerActor, {
        afterSeq: 0,
        consumerId: "create-channel-for-update",
        roomId: workspace.controlRoom.roomId,
      }).latestRoomSeq,
      idempotencyKey: "room-created-for-update",
      kind: "channel",
      name: "Product",
      slug: "product-update",
      visibility: "private",
      workspaceId: workspace.workspace.workspaceId,
    });

    assert.throws(
      () =>
        kernel.updateWorkspaceRoom(colleagueActor, {
          basedOnRoomSeq: 1,
          idempotencyKey: "room-updated-by-member",
          name: "Forbidden",
          roomId: channel.room.roomId,
          visibility: "private",
        }),
      /not a member|owner or admin/i,
    );

    const updated = kernel.updateWorkspaceRoom(ownerActor, {
      basedOnRoomSeq: 1,
      description: "Coordinate product work.",
      idempotencyKey: "room-updated",
      name: "Product planning",
      roomId: channel.room.roomId,
      visibility: "public",
    });
    assert.equal(updated.deduplicated, false);
    assert.equal(updated.event.type, "room.updated");
    assert.equal(updated.event.roomSeq, 3);
    assert.deepEqual(
      {
        description: updated.room.description,
        name: updated.room.name,
        visibility: updated.room.visibility,
      },
      {
        description: "Coordinate product work.",
        name: "Product planning",
        visibility: "public",
      },
    );
    assert.equal(
      kernel
        .listRoomMemberships(ownerActor, { roomId: channel.room.roomId })
        .some(
          ({ principalId }) => principalId === colleague.principal.principalId,
        ),
      true,
    );
    assert.equal(
      kernel.updateWorkspaceRoom(ownerActor, {
        basedOnRoomSeq: 1,
        description: "Coordinate product work.",
        idempotencyKey: "room-updated",
        name: "Product planning",
        roomId: channel.room.roomId,
        visibility: "public",
      }).deduplicated,
      true,
    );
    assert.throws(
      () =>
        kernel.updateWorkspaceRoom(ownerActor, {
          basedOnRoomSeq: 1,
          idempotencyKey: "room-updated-stale",
          name: "Stale",
          roomId: channel.room.roomId,
          visibility: "public",
        }),
      /stale/i,
    );
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Channel archive is reversible, idempotent, read-only, and manager-only", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-room-archive-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const member = kernel.provisionPrincipal({
      handle: "member",
      kind: "human",
    });
    const ownerActor = kernel.authenticateAccessToken(owner.accessToken);
    const memberActor = kernel.authenticateAccessToken(member.accessToken);
    const workspace = kernel.createWorkspace(ownerActor, {
      idempotencyKey: "archive-workspace",
      name: "Main",
      slug: "archive-main",
    });
    kernel.addMember(ownerActor, {
      principalId: member.principal.principalId,
      roomId: workspace.controlRoom.roomId,
    });
    const channel = kernel.createWorkspaceRoom(ownerActor, {
      basedOnControlRoomSeq: kernel.sync(ownerActor, {
        afterSeq: 0,
        consumerId: "archive-create",
        roomId: workspace.controlRoom.roomId,
      }).latestRoomSeq,
      idempotencyKey: "archive-room-create",
      kind: "channel",
      name: "Archive me",
      slug: "archive-me",
      visibility: "public",
      workspaceId: workspace.workspace.workspaceId,
    });
    const latest = kernel.sync(ownerActor, {
      afterSeq: 0,
      consumerId: "archive-latest",
      roomId: channel.room.roomId,
    }).latestRoomSeq;

    assert.throws(
      () =>
        kernel.archiveWorkspaceRoom(memberActor, {
          basedOnRoomSeq: latest,
          idempotencyKey: "archive-member",
          roomId: channel.room.roomId,
        }),
      /owner or admin/i,
    );
    const archived = kernel.archiveWorkspaceRoom(ownerActor, {
      basedOnRoomSeq: latest,
      idempotencyKey: "archive-room",
      roomId: channel.room.roomId,
    });
    assert.equal(archived.event.type, "room.archived");
    assert.ok(archived.room.archivedAt);
    assert.equal(
      kernel.archiveWorkspaceRoom(ownerActor, {
        basedOnRoomSeq: latest,
        idempotencyKey: "archive-room",
        roomId: channel.room.roomId,
      }).deduplicated,
      true,
    );
    assert.throws(
      () =>
        kernel.postRoomMessage(ownerActor, {
          body: "must stay read-only",
          idempotencyKey: "archived-message",
          recipients: [],
          roomId: channel.room.roomId,
        }),
      /archived/i,
    );
    assert.equal(
      kernel.listMessages(ownerActor, { roomId: channel.room.roomId }).messages
        .length,
      0,
    );

    const unarchived = kernel.unarchiveWorkspaceRoom(ownerActor, {
      basedOnRoomSeq: archived.event.roomSeq,
      idempotencyKey: "unarchive-room",
      roomId: channel.room.roomId,
    });
    assert.equal(unarchived.event.type, "room.unarchived");
    assert.equal(unarchived.room.archivedAt, undefined);
    assert.equal(
      kernel.unarchiveWorkspaceRoom(ownerActor, {
        basedOnRoomSeq: archived.event.roomSeq,
        idempotencyKey: "unarchive-room",
        roomId: channel.room.roomId,
      }).deduplicated,
      true,
    );
    assert.throws(
      () =>
        kernel.leaveRoom(memberActor, {
          basedOnRoomSeq: unarchived.event.roomSeq,
          idempotencyKey: "member-leave-control-room",
          roomId: workspace.controlRoom.roomId,
        }),
      /regular Channels/i,
    );
    const left = kernel.leaveRoom(memberActor, {
      basedOnRoomSeq: unarchived.event.roomSeq,
      idempotencyKey: "member-leave-channel",
      roomId: channel.room.roomId,
    });
    assert.equal(left.removedPrincipalId, member.principal.principalId);
    assert.throws(
      () =>
        kernel.leaveRoom(ownerActor, {
          basedOnRoomSeq: left.event.roomSeq,
          idempotencyKey: "last-owner-leave-channel",
          roomId: channel.room.roomId,
        }),
      /last owner/i,
    );
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("an AgentDefinition cannot be onboarded across Workspace boundaries", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-agent-scope-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({
      handle: "workspace-owner",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "workspace-agent",
      kind: "agent",
    });
    const ownerActor = kernel.authenticateAccessToken(owner.accessToken);
    const workspaceA = kernel.createWorkspace(ownerActor, {
      idempotencyKey: "workspace-a-created",
      name: "Workspace A",
      slug: "workspace-a",
    });
    const workspaceB = kernel.createWorkspace(ownerActor, {
      idempotencyKey: "workspace-b-created",
      name: "Workspace B",
      slug: "workspace-b",
    });
    const roomB = kernel.createWorkspaceRoom(ownerActor, {
      basedOnControlRoomSeq: workspaceB.event.roomSeq,
      idempotencyKey: "workspace-b-room-created",
      kind: "channel",
      name: "Workspace B Room",
      slug: "workspace-b-room",
      workspaceId: workspaceB.workspace.workspaceId,
    });
    kernel.addMember(ownerActor, {
      principalId: agent.principal.principalId,
      roomId: workspaceA.controlRoom.roomId,
    });
    const policy = kernel.createExecutionPolicy(ownerActor, {
      basedOnRoomSeq: kernel.sync(ownerActor, {
        afterSeq: 0,
        consumerId: "workspace-agent-scope",
        roomId: workspaceA.controlRoom.roomId,
      }).latestRoomSeq,
      controlRoomId: workspaceA.controlRoom.roomId,
      idempotencyKey: "workspace-a-agent-policy-created",
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
        artifactId: "workspace-a-retry-policy",
        contentDigest: `sha256:${"a".repeat(64)}`,
        versionId: "workspace-a-retry-policy-v1",
      },
      sessionPolicy: "prefer_resume",
    });
    assert.equal(policy.policy.toolAccessMode, "full_access");
    const definition = kernel.createAgentDefinition(ownerActor, {
      basedOnRoomSeq: policy.event.roomSeq,
      controlRoomId: workspaceA.controlRoom.roomId,
      executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
      idempotencyKey: "workspace-a-agent-created",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "workspace-a-memory-policy",
        contentDigest: `sha256:${"b".repeat(64)}`,
        versionId: "workspace-a-memory-policy-v1",
      },
      participantId: agent.principal.principalId,
      role: "Workspace A Agent",
      skillRefs: [],
    });

    assert.throws(
      () =>
        kernel.onboardAgentToRoom(ownerActor, {
          agentDefinitionId: definition.definition.agentDefinitionId,
          basedOnRoomSeq: kernel.sync(ownerActor, {
            afterSeq: 0,
            consumerId: "workspace-b-agent-onboard",
            roomId: roomB.room.roomId,
          }).latestRoomSeq,
          idempotencyKey: "cross-workspace-onboard",
          roomId: roomB.room.roomId,
        }),
      /workspace/i,
    );
    assert.deepEqual(
      kernel.listRoomMemberships(ownerActor, { roomId: roomB.room.roomId }),
      [
        {
          joinedAt: roomB.room.createdAt,
          principalId: owner.principal.principalId,
          role: "owner",
          roomId: roomB.room.roomId,
        },
      ],
    );
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a Workspace manager atomically provisions a real runtime-bound Agent", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-agent-provision-"));
  const now = new Date("2026-08-27T00:00:00.000Z");
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now: () => now,
  });
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({
      handle: "workspace-owner",
      kind: "human",
    });
    const outsider = kernel.provisionPrincipal({
      handle: "workspace-outsider",
      kind: "human",
    });
    const bootstrapAgent = kernel.provisionPrincipal({
      handle: "bootstrap-agent",
      kind: "agent",
    });
    const ownerActor = kernel.authenticateAccessToken(owner.accessToken);
    const outsiderActor = kernel.authenticateAccessToken(outsider.accessToken);
    const workspace = kernel.createWorkspace(ownerActor, {
      idempotencyKey: "workspace-created",
      name: "Formal Workspace",
      slug: "formal-workspace",
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "mac-studio",
        participantIds: [bootstrapAgent.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(host);
    const offer: RuntimeOffer = {
      capacityPoolIds: [],
      capabilityEvidence: [],
      certificationRefs: [],
      hostId: host.hostId,
      hostInstanceId: host.instanceId,
      isolation: { evidence: "declared", level: "none" },
      leaseUntil: "2026-08-27T00:05:00.000Z",
      maxConcurrent: 2,
      modelBindingDescriptors: [],
      observedAt: now.toISOString(),
      protocolFamily: "rah-worker-process/v1",
      revisionDigest: digest("a"),
      runtimeOfferId: "offer-codex",
      runtimeProfileId: "profile-codex",
      runtimeProfileRevisionId: "profile-codex-v1",
      state: "available",
      supportedToolAccessModes: ["read_only", "workspace_write", "full_access"],
      workspaceMountDescriptors: [
        {
          modes: ["in_place"],
          workspaceDefinitionId: workspace.workspace.workspaceId,
          workspaceMountDigest: digest("b"),
          workspaceMountRevisionId: "mount-formal-v1",
        },
      ],
    };
    kernel.publishRuntimeOffer(host, offer);
    const unrestrictedOnlyOffer: RuntimeOffer = {
      ...offer,
      runtimeOfferId: "offer-kimi-full-only",
      runtimeProfileId: "profile-kimi",
      runtimeProfileRevisionId: "profile-kimi-v1",
      supportedToolAccessModes: ["full_access"],
    };
    kernel.publishRuntimeOffer(host, unrestrictedOnlyOffer);
    const request = {
      avatarKey: "robot",
      basedOnRoomSeq: workspace.event.roomSeq,
      controlRoomId: workspace.controlRoom.roomId,
      description: "Reviews and implements production changes.",
      displayName: "Alice",
      handle: "alice",
      idempotencyKey: "agent-alice-provision",
      instructions: "Work from canonical Room and Task state.",
      modelIntent: { fallback: "disabled" as const },
      role: "Engineering Agent",
      runtimeOfferId: offer.runtimeOfferId,
      sessionPolicy: "prefer_resume" as const,
    };

    assert.throws(
      () => kernel.provisionWorkspaceAgent(outsiderActor, request),
      /not a member|owner or admin/i,
    );
    assert.throws(() =>
      kernel.provisionWorkspaceAgent(ownerActor, {
        ...request,
        handle: "kimi-restricted-policy-is-not-public",
        idempotencyKey: "agent-kimi-restricted-policy",
        runtimeOfferId: unrestrictedOnlyOffer.runtimeOfferId,
        // Exercise runtime validation with an old client payload.
        toolAccessMode: "workspace_write",
      }),
    );

    const heartbeatBeforeProvision = kernel.listHosts()[0]!.lastSeenAt;
    now.setTime(now.getTime() + 1000);
    const created = kernel.provisionWorkspaceAgent(ownerActor, request);
    assert.equal(
      kernel.listHosts()[0]!.lastSeenAt,
      heartbeatBeforeProvision,
      "granting Agent scope must not manufacture a Host heartbeat",
    );
    assert.equal(created.deduplicated, false);
    assert.equal(created.agent.handle, "alice");
    assert.equal(created.agent.currentRevision.displayName, "Alice");
    assert.equal(
      created.agent.currentRevision.description,
      "Reviews and implements production changes.",
    );
    assert.equal(created.agent.currentRevision.avatarKey, "robot");
    assert.equal(
      created.agent.currentRevision.instructions,
      "Work from canonical Room and Task state.",
    );
    assert.deepEqual(created.policy.required.allowedOfferIds, [
      offer.runtimeOfferId,
    ]);
    assert.equal(created.hostBinding.hostId, host.hostId);
    assert.equal(created.hostBinding.runtimeProfileId, offer.runtimeProfileId);
    assert.equal(created.event.type, "agent.provisioned");

    const replay = kernel.provisionWorkspaceAgent(ownerActor, request);
    assert.equal(replay.deduplicated, true);
    assert.equal(
      replay.agent.definition.agentDefinitionId,
      created.agent.definition.agentDefinitionId,
    );
    assert.throws(
      () =>
        kernel.provisionWorkspaceAgent(ownerActor, {
          ...request,
          displayName: "Changed",
        }),
      /idempotency/i,
    );

    const hostAfterGrant = kernel.heartbeatHost(host);
    assert.deepEqual(
      hostAfterGrant.participantIds.sort(),
      [
        bootstrapAgent.principal.principalId,
        created.agent.definition.participantId,
      ].sort(),
    );
    assert.equal(
      kernel
        .listAgentCatalog(ownerActor, {
          controlRoomId: workspace.controlRoom.roomId,
        })
        .some(
          ({ definition }) =>
            definition.agentDefinitionId ===
            created.agent.definition.agentDefinitionId,
        ),
      true,
    );

    const room = kernel.createWorkspaceRoom(ownerActor, {
      basedOnControlRoomSeq: created.event.roomSeq,
      idempotencyKey: "agent-alice-room-created",
      kind: "channel",
      name: "Production",
      slug: "production",
      workspaceId: workspace.workspace.workspaceId,
    }).room;
    const onboarded = kernel.onboardAgentToRoom(ownerActor, {
      agentDefinitionId: created.agent.definition.agentDefinitionId,
      basedOnRoomSeq: kernel.sync(ownerActor, {
        afterSeq: 0,
        consumerId: "agent-alice-onboard-sequence",
        roomId: room.roomId,
      }).latestRoomSeq,
      idempotencyKey: "agent-alice-onboarded",
      roomId: room.roomId,
    });
    assert.equal(
      onboarded.membership.principalId,
      created.agent.definition.participantId,
    );
    assert.deepEqual(
      kernel.listWorkspaceAgentRooms(ownerActor, {
        agentDefinitionId: created.agent.definition.agentDefinitionId,
      }),
      [room],
      "the Agent chat directory contains only shared non-control Rooms",
    );
    kernel.postRoomMessage(ownerActor, {
      body: "Execute this through the selected real Runtime profile.",
      idempotencyKey: "agent-alice-message",
      recipients: [],
      roomId: room.roomId,
    });
    const placement = kernel.scheduleNextPlacement({ leaseMs: 30_000 });
    assert.equal(
      placement?.participantId,
      created.agent.definition.participantId,
    );
    assert.equal(
      placement?.agentDefinitionRevisionId,
      created.agent.currentRevision.agentDefinitionRevisionId,
    );
    assert.equal(placement?.runtimeOfferId, offer.runtimeOfferId);
    const launch = kernel.claimNextPlacement(host, { leaseMs: 30_000 });
    assert.equal(
      launch?.activation.participantId,
      created.agent.definition.participantId,
      "the already-running Host context must pick up the manager-granted Agent",
    );
    assert.equal(launch?.runAttempt.state, "starting");
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Agent activity pages canonical cross-Room history without leaking inaccessible Rooms", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-agent-activity-"));
  let nowMs = Date.parse("2026-08-28T08:00:00.000Z");
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now: () => new Date(nowMs),
  });
  const advance = () => {
    nowMs += 1_000;
  };
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({
      handle: "activity-owner",
      kind: "human",
    });
    const controlViewer = kernel.provisionPrincipal({
      handle: "activity-control-viewer",
      kind: "human",
    });
    const outsider = kernel.provisionPrincipal({
      handle: "activity-outsider",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "activity-agent",
      kind: "agent",
    });
    const ownerActor = kernel.authenticateAccessToken(owner.accessToken);
    const viewerActor = kernel.authenticateAccessToken(
      controlViewer.accessToken,
    );
    const outsiderActor = kernel.authenticateAccessToken(outsider.accessToken);
    const workspace = kernel.createWorkspace(ownerActor, {
      idempotencyKey: "activity-workspace-created",
      name: "Activity Workspace",
      slug: "activity-workspace",
    });
    kernel.addMember(ownerActor, {
      principalId: controlViewer.principal.principalId,
      roomId: workspace.controlRoom.roomId,
    });
    kernel.addMember(ownerActor, {
      principalId: agent.principal.principalId,
      roomId: workspace.controlRoom.roomId,
    });
    advance();
    const policy = kernel.createExecutionPolicy(ownerActor, {
      basedOnRoomSeq: kernel.sync(ownerActor, {
        afterSeq: 0,
        consumerId: "activity-policy-sequence",
        roomId: workspace.controlRoom.roomId,
      }).latestRoomSeq,
      controlRoomId: workspace.controlRoom.roomId,
      idempotencyKey: "activity-policy-created",
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
        artifactId: "activity-retry-policy",
        contentDigest: digest("f"),
        versionId: "activity-retry-policy-v1",
      },
      sessionPolicy: "prefer_resume",
    });
    advance();
    const definition = kernel.createAgentDefinition(ownerActor, {
      basedOnRoomSeq: policy.event.roomSeq,
      controlRoomId: workspace.controlRoom.roomId,
      executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
      idempotencyKey: "activity-agent-created",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "activity-memory-policy",
        contentDigest: digest("e"),
        versionId: "activity-memory-policy-v1",
      },
      participantId: agent.principal.principalId,
      role: "Activity Agent",
      skillRefs: [],
    });
    advance();
    const room = kernel.createWorkspaceRoom(ownerActor, {
      basedOnControlRoomSeq: definition.event.roomSeq,
      idempotencyKey: "activity-room-created",
      kind: "channel",
      name: "Activity Lab",
      slug: "activity-lab",
      workspaceId: workspace.workspace.workspaceId,
    }).room;
    kernel.onboardAgentToRoom(ownerActor, {
      agentDefinitionId: definition.definition.agentDefinitionId,
      basedOnRoomSeq: kernel.sync(ownerActor, {
        afterSeq: 0,
        consumerId: "activity-onboard-sequence",
        roomId: room.roomId,
      }).latestRoomSeq,
      idempotencyKey: "activity-agent-onboarded",
      roomId: room.roomId,
    });
    advance();
    kernel.postRoomMessage(ownerActor, {
      body: "Read this canonical Room message.",
      idempotencyKey: "activity-message-posted",
      recipients: [],
      roomId: room.roomId,
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "activity-host",
        participantIds: [agent.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(host);
    advance();
    const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
    assert.ok(activation);
    advance();
    const runAttempt = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    const runtimeRunId = "activity-runtime-run";
    kernel.prepareRunAttemptRuntime(host, {
      recoveryDescriptor: {
        driver: "test-runtime",
        metadata: {},
        recoveryKey: runtimeRunId,
      },
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId,
    });
    const firstRuntimeActivity = kernel.appendRunTrajectory(host, {
      entry: {
        detailKind: "starting",
        kind: "status",
        activity: "working",
      },
      observedAt: "2026-08-27T00:00:08.000Z",
      producerSequence: 1,
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId,
    });
    const presence = () =>
      kernel.listAgentPresence(ownerActor, {
        controlRoomId: workspace.controlRoom.roomId,
      }).agents[0]!;
    assert.equal(presence().activity, "working");
    assert.equal(presence().reason, "starting");
    assert.equal(
      kernel.listAgentPresence(outsiderActor, {
        controlRoomId: workspace.controlRoom.roomId,
      }).agents.length,
      0,
    );
    assert.deepEqual(
      kernel.appendRunTrajectory(host, {
        entry: {
          detailKind: "starting",
          kind: "status",
          activity: "working",
        },
        observedAt: "2026-08-27T00:00:08.000Z",
        producerSequence: 1,
        runAttemptId: runAttempt.runAttemptId,
        runtimeRunId,
      }),
      firstRuntimeActivity,
      "a retried producer sequence must return the same immutable fact",
    );
    advance();
    kernel.appendRunTrajectory(host, {
      entry: {
        kind: "tool_start",
        producerFactId: "tool-item-1",
        toolInput: "rg -n TODO src",
        toolName: "shell",
      },
      observedAt: "2026-08-27T00:00:09.000Z",
      producerSequence: 2,
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId,
    });
    const trajectoryFirstPage = kernel.listAgentTrajectory(ownerActor, {
      agentDefinitionId: definition.definition.agentDefinitionId,
      limit: 1,
    });
    assert.equal(presence().activity, "working");
    assert.doesNotMatch(JSON.stringify(presence()), /rg -n TODO|Activity Lab/);
    assert.equal(trajectoryFirstPage.activities.length, 1);
    assert.equal(trajectoryFirstPage.activities[0]?.entry.kind, "tool_start");
    assert.equal(
      trajectoryFirstPage.activities[0]?.context?.roomId,
      runAttempt.roomId,
    );
    assert.ok(trajectoryFirstPage.activities[0]?.context?.roomName);
    assert.ok(trajectoryFirstPage.nextCursor);
    const trajectorySecondPage = kernel.listAgentTrajectory(ownerActor, {
      agentDefinitionId: definition.definition.agentDefinitionId,
      beforeActivityId: trajectoryFirstPage.nextCursor,
      limit: 50,
    });
    assert.equal(trajectorySecondPage.activities.length, 1);
    assert.equal(trajectorySecondPage.activities[0]?.entry.kind, "status");
    assert.equal(
      kernel.listAgentTrajectory(viewerActor, {
        agentDefinitionId: definition.definition.agentDefinitionId,
      }).activities.length,
      0,
      "a control-Room viewer must not learn trajectory from an inaccessible work Room",
    );
    kernel.appendRunTrajectory(host, {
      entry: {
        kind: "status",
        activity: "thinking",
        detailKind: "thinking_started",
      },
      observedAt: "2026-08-27T00:00:10.000Z",
      producerSequence: 3,
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId,
    });
    assert.equal(
      presence().activity,
      "thinking",
      "prepared runtime events already carry the current Run identity",
    );
    kernel.appendRunTrajectory(host, {
      entry: {
        kind: "status",
        activity: "working",
        detailKind: "thinking_end",
      },
      observedAt: "2026-08-27T00:00:11.000Z",
      producerSequence: 5,
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId,
    });
    kernel.appendRunTrajectory(host, {
      entry: { kind: "thinking", text: "private old thought" },
      observedAt: "2026-08-27T00:00:10.000Z",
      producerSequence: 4,
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId,
    });
    assert.equal(
      presence().activity,
      "working",
      "late lower producer sequence cannot revive thinking",
    );
    const viewerPresence = kernel.listAgentPresence(viewerActor, {
      controlRoomId: workspace.controlRoom.roomId,
    });
    assert.equal(viewerPresence.agents[0]?.activity, "working");
    assert.doesNotMatch(
      JSON.stringify(viewerPresence),
      /private old thought|Activity Lab|runtime-run/,
    );
    kernel.recordRuntimeTermination(host, {
      exit: { code: 1 },
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId,
    });
    advance();
    kernel.finishRunAttempt(host, {
      error: "bounded runtime failure",
      runAttemptId: runAttempt.runAttemptId,
      state: "failed",
    });
    assert.equal(
      presence().activity,
      "error",
      "terminal failure replaces historical working",
    );

    const firstPage = kernel.listAgentActivity(ownerActor, {
      agentDefinitionId: definition.definition.agentDefinitionId,
      limit: 2,
    });
    assert.equal(firstPage.activities.length, 2);
    assert.ok(firstPage.nextCursor);
    const secondPage = kernel.listAgentActivity(ownerActor, {
      agentDefinitionId: definition.definition.agentDefinitionId,
      beforeActivityId: firstPage.nextCursor,
      limit: 100,
    });
    const activities = [...firstPage.activities, ...secondPage.activities];
    assert.equal(
      new Set(activities.map(({ activityId }) => activityId)).size,
      activities.length,
      "cursor pagination must not duplicate immutable activity events",
    );
    assert.deepEqual(
      activities.map(({ createdAt }) => createdAt),
      [...activities.map(({ createdAt }) => createdAt)].sort().reverse(),
      "the newest canonical facts must render first",
    );
    assert.ok(
      activities.some(
        ({ eventType, relation, roomId: activityRoomId }) =>
          eventType === "message.posted" &&
          relation === "received" &&
          activityRoomId === room.roomId,
      ),
    );
    assert.ok(
      activities.some(
        ({ eventType, relation }) =>
          eventType === "run.created" && relation === "runtime",
      ),
    );
    assert.ok(
      activities.some(
        ({ eventType, tone }) =>
          eventType === "run.finished" && tone === "error",
      ),
      "a failed canonical RunAttempt must not be rendered as successful",
    );
    assert.ok(
      activities.some(
        ({ eventType, relation, roomId: activityRoomId }) =>
          eventType === "agent.created" &&
          relation === "configuration" &&
          activityRoomId === workspace.controlRoom.roomId,
      ),
    );
    assert.equal(
      activities.some((activity) => "payload" in activity),
      false,
      "provider or event payloads must not cross the activity read model",
    );

    assert.ok(
      kernel
        .listAgentActivity(viewerActor, {
          agentDefinitionId: definition.definition.agentDefinitionId,
          limit: 100,
        })
        .activities.every(
          ({ roomId: activityRoomId }) =>
            activityRoomId === workspace.controlRoom.roomId,
        ),
      "a control-Room viewer must not learn activity from an inaccessible work Room",
    );
    assert.throws(
      () =>
        kernel.listAgentActivity(outsiderActor, {
          agentDefinitionId: definition.definition.agentDefinitionId,
          limit: 100,
        }),
      /not found/i,
    );
    assert.throws(
      () =>
        kernel.listAgentActivity(ownerActor, {
          agentDefinitionId: definition.definition.agentDefinitionId,
          beforeActivityId: "unknown-activity-cursor",
          limit: 100,
        }),
      /cursor.*not found/i,
    );
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a Workspace manager atomically configures and controls a durable Agent", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-agent-manage-"));
  const now = new Date("2026-08-27T01:00:00.000Z");
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now: () => now,
  });
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({
      handle: "agent-manager",
      kind: "human",
    });
    const bootstrapAgent = kernel.provisionPrincipal({
      handle: "bootstrap-agent-manage",
      kind: "agent",
    });
    const ownerActor = kernel.authenticateAccessToken(owner.accessToken);
    const workspace = kernel.createWorkspace(ownerActor, {
      idempotencyKey: "agent-manage-workspace",
      name: "Agent Management",
      slug: "agent-management",
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "agent-manage-host",
        participantIds: [bootstrapAgent.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(host);
    const offer: RuntimeOffer = {
      capacityPoolIds: [],
      capabilityEvidence: [],
      certificationRefs: [],
      hostId: host.hostId,
      hostInstanceId: host.instanceId,
      isolation: { evidence: "declared", level: "none" },
      leaseUntil: "2026-08-27T01:05:00.000Z",
      maxConcurrent: 2,
      modelBindingDescriptors: [],
      observedAt: now.toISOString(),
      protocolFamily: "rah-worker-process/v1",
      revisionDigest: digest("c"),
      runtimeOfferId: "offer-agent-manage",
      runtimeProfileId: "profile-agent-manage",
      runtimeProfileRevisionId: "profile-agent-manage-v1",
      state: "available",
      supportedToolAccessModes: ["full_access"],
      workspaceMountDescriptors: [
        {
          modes: ["in_place"],
          workspaceDefinitionId: workspace.workspace.workspaceId,
          workspaceMountDigest: digest("d"),
          workspaceMountRevisionId: "mount-agent-manage-v1",
        },
      ],
    };
    kernel.publishRuntimeOffer(host, offer);
    const secondHost = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "agent-manage-host-2",
        participantIds: [bootstrapAgent.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(secondHost);
    const secondOffer: RuntimeOffer = {
      ...offer,
      hostId: secondHost.hostId,
      hostInstanceId: secondHost.instanceId,
      revisionDigest: digest("e"),
      runtimeOfferId: "offer-agent-manage-2",
      runtimeProfileId: "profile-agent-manage-2",
      runtimeProfileRevisionId: "profile-agent-manage-2-v1",
    };
    kernel.publishRuntimeOffer(secondHost, secondOffer);
    const created = kernel.provisionWorkspaceAgent(ownerActor, {
      basedOnRoomSeq: workspace.event.roomSeq,
      controlRoomId: workspace.controlRoom.roomId,
      displayName: "Alice",
      handle: "alice-manage",
      idempotencyKey: "agent-manage-provision",
      instructions: "Implement changes.",
      modelIntent: { fallback: "disabled" },
      role: "Engineering Agent",
      runtimeOfferId: offer.runtimeOfferId,
      sessionPolicy: "prefer_resume",
    });
    assert.equal(created.policy.toolAccessMode, "full_access");

    const fullAccessOnlyOffer: RuntimeOffer = {
      ...secondOffer,
      runtimeOfferId: "offer-agent-manage-full-only",
      runtimeProfileId: "profile-agent-manage-full-only",
      runtimeProfileRevisionId: "profile-agent-manage-full-only-v1",
      supportedToolAccessModes: ["full_access"],
    };
    kernel.publishRuntimeOffer(secondHost, fullAccessOnlyOffer);
    const lastSeenBeforeConfigure = kernel
      .listHosts()
      .map((host) => [host.hostId, host.lastSeenAt]);
    now.setTime(now.getTime() + 1000);
    const configured = kernel.manageWorkspaceAgent(ownerActor, {
      action: "configure",
      agentDefinitionId: created.agent.definition.agentDefinitionId,
      avatarKey: "star",
      basedOnRoomSeq: created.event.roomSeq,
      description: "Reviews production changes.",
      displayName: "Alice Reviewer",
      handle: "alice-reviewer",
      idempotencyKey: "agent-manage-configure",
      instructions: "Review canonical Room work before approval.",
      modelIntent: { fallback: "disabled", reasoning: "default" },
      role: "Review Agent",
      runtimeOfferId: offer.runtimeOfferId,
      sessionPolicy: "prefer_resume",
    });
    assert.deepEqual(
      kernel.listHosts().map((host) => [host.hostId, host.lastSeenAt]),
      lastSeenBeforeConfigure,
      "configuration is not a Host heartbeat",
    );
    assert.equal(configured.deduplicated, false);
    assert.equal(configured.agent.handle, "alice-reviewer");
    assert.equal(configured.agent.currentRevision.revision, 2);
    assert.equal(
      configured.agent.currentRevision.displayName,
      "Alice Reviewer",
    );
    assert.equal(configured.agent.currentRevision.role, "Review Agent");
    assert.equal(configured.policy?.revision, 2);
    assert.equal(configured.policy?.toolAccessMode, "full_access");
    assert.equal(configured.event.type, "agent.configured");
    assert.equal(
      kernel.manageWorkspaceAgent(ownerActor, {
        action: "configure",
        agentDefinitionId: created.agent.definition.agentDefinitionId,
        avatarKey: "star",
        basedOnRoomSeq: created.event.roomSeq,
        description: "Reviews production changes.",
        displayName: "Alice Reviewer",
        handle: "alice-reviewer",
        idempotencyKey: "agent-manage-configure",
        instructions: "Review canonical Room work before approval.",
        modelIntent: { fallback: "disabled", reasoning: "default" },
        role: "Review Agent",
        runtimeOfferId: offer.runtimeOfferId,
        sessionPolicy: "prefer_resume",
      }).deduplicated,
      true,
    );

    const roomResult = kernel.createWorkspaceRoom(ownerActor, {
      basedOnControlRoomSeq: configured.event.roomSeq,
      idempotencyKey: "agent-manage-room",
      kind: "channel",
      name: "Managed Agent Room",
      slug: "managed-agent-room",
      workspaceId: workspace.workspace.workspaceId,
    });
    kernel.onboardAgentToRoom(ownerActor, {
      agentDefinitionId: created.agent.definition.agentDefinitionId,
      basedOnRoomSeq: kernel.sync(ownerActor, {
        afterSeq: 0,
        consumerId: "agent-manage-room-onboard",
        roomId: roomResult.room.roomId,
      }).latestRoomSeq,
      idempotencyKey: "agent-manage-room-onboarded",
      roomId: roomResult.room.roomId,
    });

    const disabled = kernel.manageWorkspaceAgent(ownerActor, {
      action: "set_state",
      agentDefinitionId: created.agent.definition.agentDefinitionId,
      basedOnRoomSeq: roomResult.event.roomSeq,
      idempotencyKey: "agent-manage-disable",
      state: "disabled",
    });
    assert.equal(disabled.agent.definition.state, "disabled");
    assert.equal(disabled.event.type, "agent.disabled");
    kernel.postRoomMessage(ownerActor, {
      body: "A disabled Agent must not receive this.",
      idempotencyKey: "agent-manage-disabled-message",
      recipients: [],
      roomId: roomResult.room.roomId,
    });
    assert.equal(kernel.scheduleNextPlacement({ leaseMs: 30_000 }), null);
    const enabled = kernel.manageWorkspaceAgent(ownerActor, {
      action: "set_state",
      agentDefinitionId: created.agent.definition.agentDefinitionId,
      basedOnRoomSeq: disabled.event.roomSeq,
      idempotencyKey: "agent-manage-enable",
      state: "enabled",
    });
    assert.equal(enabled.agent.definition.state, "enabled");
    assert.equal(enabled.event.type, "agent.enabled");
    kernel.postRoomMessage(ownerActor, {
      body: "The enabled Agent must use revision two.",
      idempotencyKey: "agent-manage-enabled-message",
      recipients: [],
      roomId: roomResult.room.roomId,
    });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const leased = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
      assert.ok(leased);
      const failed = kernel.retryActivation(host, {
        activationId: leased.activationId,
        error: "provider connection failed",
        retryAfterMs: 0,
      });
      assert.equal(failed.state, attempt < 3 ? "queued" : "quarantined");
    }
    assert.equal(
      kernel.leaseNextActivation(host, { leaseMs: 30_000 }),
      null,
      "a repeated identical Runtime failure must fence the Agent lane",
    );
    const pausedWithQueuedWork = kernel.manageWorkspaceAgent(ownerActor, {
      action: "set_state",
      agentDefinitionId: created.agent.definition.agentDefinitionId,
      basedOnRoomSeq: enabled.event.roomSeq,
      idempotencyKey: "agent-manage-pause-queued",
      state: "disabled",
    });
    assert.equal(
      kernel.leaseNextActivation(host, { leaseMs: 30_000 }),
      null,
      "a paused Agent must not churn queued work through the legacy lease path",
    );
    const resumedWithQueuedWork = kernel.manageWorkspaceAgent(ownerActor, {
      action: "set_state",
      agentDefinitionId: created.agent.definition.agentDefinitionId,
      basedOnRoomSeq: pausedWithQueuedWork.event.roomSeq,
      idempotencyKey: "agent-manage-resume-queued",
      state: "enabled",
    });
    assert.equal(
      kernel
        .sync(ownerActor, {
          consumerId: "agent-manage-retry-resume-audit",
          roomId: roomResult.room.roomId,
        })
        .events.some((event) => event.type === "activation.retry_resumed"),
      true,
      "an explicit Agent restart must release the Raft-style Runtime fence",
    );
    const placement = kernel.scheduleNextPlacement({ leaseMs: 30_000 });
    assert.equal(
      placement?.agentDefinitionRevisionId,
      configured.agent.currentRevision.agentDefinitionRevisionId,
    );
    const launch = kernel.claimNextPlacement(host, { leaseMs: 30_000 });
    assert.equal(
      launch?.agentContext.agentDefinitionRevision.instructions,
      "Review canonical Room work before approval.",
    );

    const disposable = kernel.provisionWorkspaceAgent(ownerActor, {
      basedOnRoomSeq: resumedWithQueuedWork.event.roomSeq,
      controlRoomId: workspace.controlRoom.roomId,
      displayName: "Disposable",
      handle: "disposable-agent",
      idempotencyKey: "agent-manage-disposable",
      instructions: "Temporary work.",
      modelIntent: { fallback: "disabled" },
      role: "Temporary Agent",
      runtimeOfferId: offer.runtimeOfferId,
      sessionPolicy: "prefer_resume",
    });
    const lastSeenBeforeRebind = kernel
      .listHosts()
      .map((host) => [host.hostId, host.lastSeenAt]);
    now.setTime(now.getTime() + 1000);
    const disposableConfigured = kernel.manageWorkspaceAgent(ownerActor, {
      action: "configure",
      agentDefinitionId: disposable.agent.definition.agentDefinitionId,
      basedOnRoomSeq: disposable.event.roomSeq,
      displayName: "Disposable",
      handle: "disposable-agent",
      idempotencyKey: "agent-manage-disposable-rebind",
      instructions: "Temporary work on the second Host.",
      modelIntent: { fallback: "disabled" },
      role: "Temporary Agent",
      runtimeOfferId: secondOffer.runtimeOfferId,
      sessionPolicy: "prefer_resume",
    });
    assert.deepEqual(
      kernel.listHosts().map((host) => [host.hostId, host.lastSeenAt]),
      lastSeenBeforeRebind,
      "rebind does not manufacture a heartbeat for either Host",
    );
    assert.equal(
      kernel
        .heartbeatHost(host)
        .participantIds.includes(disposable.agent.definition.participantId),
      false,
    );
    assert.equal(
      kernel
        .heartbeatHost(secondHost)
        .participantIds.includes(disposable.agent.definition.participantId),
      true,
    );
    const disposableDisabled = kernel.manageWorkspaceAgent(ownerActor, {
      action: "set_state",
      agentDefinitionId: disposable.agent.definition.agentDefinitionId,
      basedOnRoomSeq: disposableConfigured.event.roomSeq,
      idempotencyKey: "agent-manage-disposable-disable",
      state: "disabled",
    });
    const lastSeenBeforeDelete = kernel
      .listHosts()
      .map((host) => [host.hostId, host.lastSeenAt]);
    now.setTime(now.getTime() + 1000);
    const deleted = kernel.manageWorkspaceAgent(ownerActor, {
      action: "set_state",
      agentDefinitionId: disposable.agent.definition.agentDefinitionId,
      basedOnRoomSeq: disposableDisabled.event.roomSeq,
      idempotencyKey: "agent-manage-disposable-delete",
      state: "tombstoned",
    });
    assert.deepEqual(
      kernel.listHosts().map((host) => [host.hostId, host.lastSeenAt]),
      lastSeenBeforeDelete,
      "removal must not revive unrelated Host records",
    );
    assert.equal(deleted.agent.definition.state, "tombstoned");
    assert.equal(deleted.event.type, "agent.tombstoned");
    assert.equal(
      kernel
        .listAgentCatalog(ownerActor, {
          controlRoomId: workspace.controlRoom.roomId,
        })
        .some(
          ({ definition }) =>
            definition.agentDefinitionId ===
            disposable.agent.definition.agentDefinitionId,
        ),
      false,
    );
    assert.equal(
      kernel
        .heartbeatHost(secondHost)
        .participantIds.includes(disposable.agent.definition.participantId),
      false,
    );
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
