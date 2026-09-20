import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  OFFICIAL_AGENT_AVATAR_KEYS,
  type RuntimeOffer,
} from "@rah-os/protocol";
import { RoomKernel } from "../src/index.ts";

test("account reuse and display-name duplicates keep history bound to immutable agentId", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-avatar-provision-"));
  const options = {
    databasePath: join(directory, "room.db"),
    now: () => new Date("2026-08-31T00:00:00.000Z"),
  };
  let kernel = new RoomKernel(options);
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const agent = kernel.provisionPrincipal({
      handle: "bootstrap",
      kind: "agent",
    });
    let actor = kernel.authenticateAccessToken(owner.accessToken);
    const workspace = kernel.createWorkspace(actor, {
      idempotencyKey: "workspace",
      name: "Avatars",
      slug: "avatars",
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "test-host",
        participantIds: [agent.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(host);
    const digest = `sha256:${"a".repeat(64)}`;
    const offer: RuntimeOffer = {
      capacityPoolIds: [],
      capabilityEvidence: [],
      certificationRefs: [],
      hostId: host.hostId,
      hostInstanceId: host.instanceId,
      isolation: { evidence: "declared", level: "none" },
      leaseUntil: "2026-08-31T00:05:00.000Z",
      maxConcurrent: 1,
      modelBindingDescriptors: [],
      observedAt: options.now().toISOString(),
      protocolFamily: "rah-worker-process/v1",
      revisionDigest: digest,
      runtimeOfferId: "fixture-offer",
      runtimeProfileId: "fixture-profile",
      runtimeProfileRevisionId: "fixture-profile-v1",
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
    };
    kernel.publishRuntimeOffer(host, offer);
    const all = kernel.createWorkspaceRoom(actor, {
      workspaceId: workspace.workspace.workspaceId,
      basedOnControlRoomSeq: workspace.event.roomSeq,
      name: "all",
      slug: "all",
      kind: "channel",
      visibility: "public",
      idempotencyKey: "all",
    });
    const request = {
      basedOnRoomSeq: all.event.roomSeq,
      controlRoomId: workspace.controlRoom.roomId,
      displayName: "Alice",
      handle: "alice",
      idempotencyKey: "create-alice",
      instructions: "Test identity only; do not run a provider.",
      modelIntent: { fallback: "disabled" as const },
      role: "Assistant",
      runtimeOfferId: offer.runtimeOfferId,
      sessionPolicy: "prefer_resume" as const,
    };
    const first = kernel.provisionWorkspaceAgent(actor, request);
    const currentSeq = () =>
      kernel.sync(actor, {
        roomId: workspace.controlRoom.roomId,
        afterSeq: 0,
        consumerId: "identity-test",
      }).latestRoomSeq;
    assert.throws(
      () =>
        kernel.provisionWorkspaceAgent(actor, {
          ...request,
          basedOnRoomSeq: currentSeq(),
          idempotencyKey: "duplicate",
        }),
      /already taken/,
    );
    const sameDisplay = kernel.provisionWorkspaceAgent(actor, {
      ...request,
      handle: "Alice",
      basedOnRoomSeq: currentSeq(),
      idempotencyKey: "case-distinct",
    });
    assert.equal(
      sameDisplay.agent.currentRevision.displayName,
      first.agent.currentRevision.displayName,
    );
    assert.notEqual(
      sameDisplay.agent.definition.agentId,
      first.agent.definition.agentId,
    );
    const posted = kernel.postMessage(actor, {
      roomId: all.room.roomId,
      body: "@alice old identity",
      idempotencyKey: "old-message",
      recipients: [],
    });
    kernel.manageWorkspaceAgent(actor, {
      action: "set_state",
      state: "tombstoned",
      agentId: first.agent.definition.agentId,
      basedOnRoomSeq: currentSeq(),
      idempotencyKey: "delete-original",
    });
    const replacement = kernel.provisionWorkspaceAgent(actor, {
      ...request,
      basedOnRoomSeq: currentSeq(),
      idempotencyKey: "replacement",
    });
    assert.equal(replacement.agent.handle, "alice");
    assert.notEqual(
      replacement.agent.definition.agentId,
      first.agent.definition.agentId,
    );
    kernel.close();
    const db = new DatabaseSync(options.databasePath);
    const binding = JSON.parse(
      String(
        db
          .prepare("SELECT mentions_json FROM messages WHERE message_id=?")
          .get(posted.event.aggregateId)?.mentions_json,
      ),
    );
    assert.equal(binding[0].principalId, first.agent.definition.participantId);
    // Simulate a pre-agentId database: immutable JSON remains in the old wire shape.
    db.exec(
      "UPDATE agent_definition_revisions SET definition_json=json_remove(json_set(definition_json,'$.agentDefinitionId',json_extract(definition_json,'$.agentId')),'$.agentId')",
    );
    db.exec(
      "UPDATE room_events SET payload_json=json_remove(json_set(payload_json,'$.agentDefinitionId',json_extract(payload_json,'$.agentId')),'$.agentId') WHERE json_type(payload_json,'$.agentId') IS NOT NULL",
    );
    db.close();
    kernel = new RoomKernel(options);
    kernel.initialize();
    actor = kernel.authenticateAccessToken(owner.accessToken);
    const entries = kernel.listAgentCatalog(actor, {
      controlRoomId: workspace.controlRoom.roomId,
      includeDeleted: true,
    });
    assert.ok(
      entries.some(
        (e) =>
          e.definition.agentId === first.agent.definition.agentId &&
          e.definition.state === "tombstoned",
      ),
    );
    assert.ok(
      entries.some(
        (e) =>
          e.definition.agentId === replacement.agent.definition.agentId &&
          e.definition.state === "enabled",
      ),
    );
    assert.equal(
      kernel.provisionWorkspaceAgent(actor, request).agent.definition.agentId,
      first.agent.definition.agentId,
    );
  } finally {
    kernel.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
