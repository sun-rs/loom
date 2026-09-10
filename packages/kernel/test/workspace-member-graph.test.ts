import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RuntimeOffer } from "@rah-os/protocol";

import { RoomKernel } from "../src/index.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

test("Workspace member graph is an ACL-safe projection of visible active Channel membership", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-member-graph-"));
  const now = new Date("2026-09-02T00:00:00.000Z");
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now: () => now,
  });
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const colleague = kernel.provisionPrincipal({
      handle: "colleague",
      kind: "human",
    });
    const outsider = kernel.provisionPrincipal({
      handle: "outsider",
      kind: "human",
    });
    const bootstrapAgent = kernel.provisionPrincipal({
      handle: "bootstrap",
      kind: "agent",
    });
    const ownerActor = kernel.authenticateAccessToken(owner.accessToken);
    const colleagueActor = kernel.authenticateAccessToken(
      colleague.accessToken,
    );
    const outsiderActor = kernel.authenticateAccessToken(outsider.accessToken);
    const workspace = kernel.createWorkspace(ownerActor, {
      idempotencyKey: "workspace-create",
      name: "Graph Workspace",
      slug: "graph-workspace",
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "graph-host",
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
      leaseUntil: "2026-09-02T00:05:00.000Z",
      maxConcurrent: 2,
      modelBindingDescriptors: [],
      observedAt: now.toISOString(),
      protocolFamily: "rah-worker-process/v1",
      revisionDigest: digest("a"),
      runtimeOfferId: "graph-offer",
      runtimeProfileId: "graph-profile",
      runtimeProfileRevisionId: "graph-profile-v1",
      state: "available",
      supportedToolAccessModes: ["full_access"],
      workspaceMountDescriptors: [
        {
          modes: ["in_place"],
          workspaceDefinitionId: workspace.workspace.workspaceId,
          workspaceMountDigest: digest("b"),
          workspaceMountRevisionId: "graph-mount-v1",
        },
      ],
    };
    kernel.publishRuntimeOffer(host, offer);
    const alice = kernel.provisionWorkspaceAgent(ownerActor, {
      avatarKey: "robot",
      basedOnRoomSeq: workspace.event.roomSeq,
      controlRoomId: workspace.controlRoom.roomId,
      displayName: "Alice",
      handle: "alice",
      idempotencyKey: "agent-alice",
      instructions: "Fixture only.",
      modelIntent: { fallback: "disabled" },
      role: "Builder",
      runtimeOfferId: offer.runtimeOfferId,
      sessionPolicy: "prefer_resume",
    });
    const kimi = kernel.provisionWorkspaceAgent(ownerActor, {
      avatarKey: "cat",
      basedOnRoomSeq: alice.event.roomSeq,
      controlRoomId: workspace.controlRoom.roomId,
      displayName: "Kimi",
      handle: "kimi",
      idempotencyKey: "agent-kimi",
      instructions: "Fixture only.",
      modelIntent: { fallback: "disabled" },
      role: "Reviewer",
      runtimeOfferId: offer.runtimeOfferId,
      sessionPolicy: "prefer_resume",
    });
    const isolated = kernel.provisionWorkspaceAgent(ownerActor, {
      avatarKey: "cat",
      basedOnRoomSeq: kimi.event.roomSeq,
      controlRoomId: workspace.controlRoom.roomId,
      displayName: "Isolated",
      handle: "isolated",
      idempotencyKey: "agent-isolated",
      instructions: "Fixture only.",
      modelIntent: { fallback: "disabled" },
      role: "Builder",
      runtimeOfferId: offer.runtimeOfferId,
      sessionPolicy: "prefer_resume",
    });
    const emptyChannelGraph = kernel.listWorkspaceMemberGraph(ownerActor, {
      workspaceId: workspace.workspace.workspaceId,
    });
    assert.equal(emptyChannelGraph.agents.length, 3);
    assert.equal(emptyChannelGraph.edges.length, 0);
    assert.ok(
      emptyChannelGraph.agents.every((agent) => agent.channelIds.length === 0),
    );
    const colleagueMembership = kernel.addRoomMember(ownerActor, {
      basedOnRoomSeq: isolated.event.roomSeq,
      idempotencyKey: "add-colleague-control",
      principalId: colleague.principal.principalId,
      role: "member",
      roomId: workspace.controlRoom.roomId,
    });
    const alpha = kernel.createWorkspaceRoom(ownerActor, {
      basedOnControlRoomSeq: colleagueMembership.event.roomSeq,
      idempotencyKey: "room-alpha",
      initialAgentParticipantIds: [
        alice.agent.definition.participantId,
        kimi.agent.definition.participantId,
      ],
      kind: "channel",
      name: "Alpha",
      slug: "alpha",
      workspaceId: workspace.workspace.workspaceId,
    });
    const beta = kernel.createWorkspaceRoom(ownerActor, {
      basedOnControlRoomSeq: alpha.event.roomSeq,
      idempotencyKey: "room-beta",
      initialAgentParticipantIds: [
        alice.agent.definition.participantId,
        kimi.agent.definition.participantId,
      ],
      kind: "channel",
      name: "Beta",
      slug: "beta",
      workspaceId: workspace.workspace.workspaceId,
    });
    kernel.addRoomMember(ownerActor, {
      basedOnRoomSeq: kernel.sync(ownerActor, {
        afterSeq: 0,
        consumerId: "alpha-head",
        roomId: alpha.room.roomId,
      }).latestRoomSeq,
      idempotencyKey: "add-colleague-alpha",
      principalId: colleague.principal.principalId,
      role: "member",
      roomId: alpha.room.roomId,
    });
    const archived = kernel.createWorkspaceRoom(ownerActor, {
      basedOnControlRoomSeq: beta.event.roomSeq,
      idempotencyKey: "room-archived",
      initialAgentParticipantIds: [alice.agent.definition.participantId],
      kind: "channel",
      name: "Archived",
      slug: "archived",
      workspaceId: workspace.workspace.workspaceId,
    });
    kernel.archiveWorkspaceRoom(ownerActor, {
      basedOnRoomSeq: kernel.sync(ownerActor, {
        afterSeq: 0,
        consumerId: "archived-head",
        roomId: archived.room.roomId,
      }).latestRoomSeq,
      idempotencyKey: "archive-room",
      roomId: archived.room.roomId,
    });
    kernel.openDirectRoom(ownerActor, {
      basedOnControlRoomSeq: archived.event.roomSeq,
      idempotencyKey: "direct-colleague",
      peerPrincipalId: colleague.principal.principalId,
      workspaceId: workspace.workspace.workspaceId,
    });

    const graph = kernel.listWorkspaceMemberGraph(ownerActor, {
      workspaceId: workspace.workspace.workspaceId,
    });
    assert.deepEqual(
      graph.channels.map(({ id }) => id),
      [alpha.room.roomId, beta.room.roomId],
    );
    assert.equal(graph.humans.length, 2);
    assert.equal(graph.agents.length, 3);
    const isolatedNode = graph.agents.find(
      (agent) => agent.id === isolated.agent.definition.agentDefinitionId,
    );
    assert.deepEqual(isolatedNode?.channelIds, []);
    assert.ok(
      graph.edges.every(
        (edge) =>
          edge.source !== `agent:${isolatedNode?.id}` &&
          edge.target !== `agent:${isolatedNode?.id}`,
      ),
    );
    assert.equal(graph.truncated, false);
    const ownerAlice = graph.edges.find(
      (edge) =>
        edge.source === `agent:${alice.agent.definition.agentDefinitionId}` &&
        edge.target === `human:${owner.principal.principalId}`,
    );
    assert.equal(ownerAlice?.weight, 2);
    assert.deepEqual(ownerAlice?.channelIds, [
      alpha.room.roomId,
      beta.room.roomId,
    ]);

    const colleagueGraph = kernel.listWorkspaceMemberGraph(colleagueActor, {
      workspaceId: workspace.workspace.workspaceId,
    });
    assert.deepEqual(
      colleagueGraph.channels.map(({ name }) => name),
      ["Alpha"],
    );
    assert.equal(
      colleagueGraph.agents.every((agent) =>
        agent.channelIds.every((roomId) => roomId === alpha.room.roomId),
      ),
      true,
    );
    assert.throws(
      () =>
        kernel.listWorkspaceMemberGraph(outsiderActor, {
          workspaceId: workspace.workspace.workspaceId,
        }),
      /not a member|access/i,
    );
  } finally {
    kernel.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
