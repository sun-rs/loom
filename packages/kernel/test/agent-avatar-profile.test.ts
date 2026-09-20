import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ClientAgentManageRequestSchema,
  type RuntimeOffer,
} from "@rah-os/protocol";
import { RoomKernel } from "../src/index.ts";

test("an official avatar profile revision is atomic, stale-safe, and persistent", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-avatar-profile-"));
  const now = new Date("2026-09-01T00:00:00Z");
  const options = { databasePath: join(directory, "room.db"), now: () => now };
  let kernel = new RoomKernel(options);
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const bootstrap = kernel.provisionPrincipal({
      handle: "bootstrap",
      kind: "agent",
    });
    let actor = kernel.authenticateAccessToken(owner.accessToken);
    const workspace = kernel.createWorkspace(actor, {
      idempotencyKey: "workspace",
      name: "Avatar",
      slug: "avatar",
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "test-host",
        participantIds: [bootstrap.principal.principalId],
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
      leaseUntil: "2026-09-01T00:05:00Z",
      maxConcurrent: 1,
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
    };
    kernel.publishRuntimeOffer(host, offer);
    const created = kernel.provisionWorkspaceAgent(actor, {
      basedOnRoomSeq: workspace.event.roomSeq,
      controlRoomId: workspace.controlRoom.roomId,
      displayName: "Alice",
      description: "Original",
      handle: "alice",
      idempotencyKey: "create",
      instructions: "Retain this persona.",
      role: "Assistant",
      modelIntent: { fallback: "disabled" },
      runtimeOfferId: "offer",
    });
    now.setTime(now.getTime() + 600_000);
    const request = ClientAgentManageRequestSchema.parse({
      action: "update_profile",
      agentId: created.agent.definition.agentId,
      expectedRevisionId:
        created.agent.currentRevision.agentDefinitionRevisionId,
      basedOnRoomSeq: created.event.roomSeq,
      idempotencyKey: "avatar",
      field: "avatarKey",
      value: "heart",
    });
    const saved = kernel.manageWorkspaceAgent(actor, request);
    assert.equal(saved.event.type, "agent.profile_updated");
    assert.equal(saved.agent.currentRevision.avatarKey, "heart");
    assert.equal(saved.agent.currentRevision.revision, 2);
    assert.equal(saved.agent.handle, created.agent.handle);
    assert.equal(
      saved.agent.definition.participantId,
      created.agent.definition.participantId,
    );
    assert.equal(saved.policy, undefined);
    assert.equal(saved.hostBinding, undefined);
    for (const key of [
      "displayName",
      "description",
      "instructions",
      "instructionRefs",
      "skillRefs",
      "memoryPolicyRef",
      "executionPolicyRevisionId",
      "role",
    ] as const)
      assert.deepEqual(
        saved.agent.currentRevision[key],
        created.agent.currentRevision[key],
        key,
      );
    assert.equal(
      kernel.manageWorkspaceAgent(actor, request).deduplicated,
      true,
    );
    assert.throws(
      () =>
        kernel.manageWorkspaceAgent(actor, {
          ...request,
          idempotencyKey: "stale",
          basedOnRoomSeq: saved.event.roomSeq,
        }),
      /revision|changed|修改/i,
    );
    kernel.close();
    kernel = new RoomKernel(options);
    kernel.initialize();
    actor = kernel.authenticateAccessToken(owner.accessToken);
    const persisted = kernel.getWorkspaceAgentManagementView(
      actor,
      request.agentId,
    );
    assert.deepEqual(persisted.agent, saved.agent);
    assert.deepEqual(persisted.policy, created.policy);
  } finally {
    kernel.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("avatar profile input accepts official or authenticated upload keys", () => {
  const command = {
    action: "update_profile",
    agentId: "agent",
    expectedRevisionId: "revision",
    basedOnRoomSeq: 0,
    idempotencyKey: "edit",
    field: "avatarKey",
    value: "heart",
  };
  assert.equal(ClientAgentManageRequestSchema.safeParse(command).success, true);
  assert.equal(
    ClientAgentManageRequestSchema.safeParse({
      ...command,
      value: `upload_webp_${"c".repeat(40)}`,
    }).success,
    true,
  );
  for (const value of ["not-a-key", "finch", "mug", "pixel:heart"])
    assert.equal(
      ClientAgentManageRequestSchema.safeParse({ ...command, value }).success,
      false,
    );
});
