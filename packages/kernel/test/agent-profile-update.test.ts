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

test("profile edits survive offline hosts/reopen, preserve execution and identity, and reject stale/unauthorized writes", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-profile-update-"));
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
      name: "Profile",
      slug: "profile",
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
    now.setTime(now.getTime() + 600_000); // Host/offer expired: metadata must remain editable.
    const request = ClientAgentManageRequestSchema.parse({
      action: "update_profile",
      agentDefinitionId: created.agent.definition.agentDefinitionId,
      expectedRevisionId:
        created.agent.currentRevision.agentDefinitionRevisionId,
      basedOnRoomSeq: created.event.roomSeq,
      idempotencyKey: "rename",
      field: "displayName",
      value: " Alice Revised ",
    });
    assert.equal(request.action, "update_profile");
    if (request.action !== "update_profile")
      throw new Error("wrong schema branch");
    const saved = kernel.manageWorkspaceAgent(actor, request);
    assert.equal(saved.event.type, "agent.profile_updated");
    assert.equal(saved.agent.currentRevision.displayName, "Alice Revised");
    assert.equal(saved.agent.currentRevision.revision, 2);
    assert.equal(saved.agent.handle, created.agent.handle);
    assert.equal(
      saved.agent.definition.participantId,
      created.agent.definition.participantId,
    );
    assert.equal(saved.policy, undefined);
    assert.equal(saved.hostBinding, undefined);
    for (const key of [
      "instructions",
      "instructionRefs",
      "skillRefs",
      "memoryPolicyRef",
      "executionPolicyRevisionId",
      "role",
      "avatarKey",
      "description",
    ] as const)
      assert.deepEqual(
        saved.agent.currentRevision[key],
        created.agent.currentRevision[key],
        key,
      );
    assert.deepEqual(
      kernel.getWorkspaceAgentManagementView(actor, request.agentDefinitionId)
        .policy,
      created.policy,
    );
    assert.equal(
      kernel.manageWorkspaceAgent(actor, request).deduplicated,
      true,
    );
    assert.throws(
      () =>
        kernel.manageWorkspaceAgent(actor, { ...request, value: "Different" }),
      /idempotency/i,
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
    const outsider = kernel.provisionPrincipal({
      handle: "outsider",
      kind: "human",
    });
    assert.throws(() =>
      kernel.manageWorkspaceAgent(
        kernel.authenticateAccessToken(outsider.accessToken),
        { ...request, idempotencyKey: "unauthorized" },
      ),
    );
    const cleared = kernel.manageWorkspaceAgent(
      actor,
      ClientAgentManageRequestSchema.parse({
        ...request,
        idempotencyKey: "clear",
        field: "description",
        value: "  ",
        expectedRevisionId:
          saved.agent.currentRevision.agentDefinitionRevisionId,
        basedOnRoomSeq: saved.event.roomSeq,
      }),
    );
    assert.equal(cleared.agent.currentRevision.description, undefined);
    assert.equal(cleared.agent.currentRevision.displayName, "Alice Revised");
    const avatarSaved = kernel.manageWorkspaceAgent(
      actor,
      ClientAgentManageRequestSchema.parse({
        ...request,
        idempotencyKey: "avatar",
        field: "avatarKey",
        value: "heart",
        expectedRevisionId:
          cleared.agent.currentRevision.agentDefinitionRevisionId,
        basedOnRoomSeq: cleared.event.roomSeq,
      }),
    );
    assert.equal(avatarSaved.agent.currentRevision.avatarKey, "heart");
    assert.equal(avatarSaved.agent.currentRevision.description, undefined);
    assert.equal(
      avatarSaved.agent.definition.participantId,
      created.agent.definition.participantId,
    );
    assert.deepEqual(avatarSaved.policy, undefined);
    assert.deepEqual(
      kernel.getWorkspaceAgentManagementView(actor, request.agentDefinitionId)
        .policy,
      created.policy,
    );
    kernel.close();
    kernel = new RoomKernel(options);
    kernel.initialize();
    actor = kernel.authenticateAccessToken(owner.accessToken);
    const persisted = kernel.getWorkspaceAgentManagementView(
      actor,
      request.agentDefinitionId,
    );
    assert.deepEqual(persisted.agent, avatarSaved.agent);
    assert.deepEqual(persisted.policy, created.policy);
    const disabled = kernel.manageWorkspaceAgent(actor, {
      action: "set_state",
      agentDefinitionId: request.agentDefinitionId,
      basedOnRoomSeq: avatarSaved.event.roomSeq,
      idempotencyKey: "disable",
      state: "disabled",
    });
    const deleted = kernel.manageWorkspaceAgent(actor, {
      action: "set_state",
      agentDefinitionId: request.agentDefinitionId,
      basedOnRoomSeq: disabled.event.roomSeq,
      idempotencyKey: "delete",
      state: "tombstoned",
    });
    assert.throws(
      () =>
        kernel.manageWorkspaceAgent(actor, {
          ...request,
          idempotencyKey: "deleted",
          basedOnRoomSeq: deleted.event.roomSeq,
          expectedRevisionId:
            avatarSaved.agent.currentRevision.agentDefinitionRevisionId,
        }),
      /tombstoned/i,
    );
  } finally {
    kernel.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("profile command cannot smuggle role/policy/handle changes or invalid fields", () => {
  const command = {
    action: "update_profile",
    agentDefinitionId: "agent",
    expectedRevisionId: "revision",
    basedOnRoomSeq: 0,
    idempotencyKey: "edit",
    field: "displayName",
    value: "Name",
  };
  assert.equal(ClientAgentManageRequestSchema.safeParse(command).success, true);
  assert.equal(
    ClientAgentManageRequestSchema.safeParse({
      ...command,
      field: "avatarKey",
      value: "heart",
    }).success,
    true,
  );
  for (const input of [
    { ...command, value: " " },
    { ...command, value: "a".repeat(129) },
    { ...command, field: "description", value: "a".repeat(2001) },
    { ...command, field: "avatarKey", value: "not a key" },
    { ...command, role: "admin" },
    { ...command, field: "role" },
    { ...command, handle: "new" },
  ])
    assert.equal(
      ClientAgentManageRequestSchema.safeParse(input).success,
      false,
    );
});
