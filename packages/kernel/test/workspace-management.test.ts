import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RoomKernel } from "../src/index.ts";

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
      sessionPolicy: "fresh",
    });
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
