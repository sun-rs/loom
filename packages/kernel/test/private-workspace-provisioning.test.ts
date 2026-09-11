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

test("new Agent private cwd is capability-gated and existing mounts remain explicit", () => {
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
    const request = {
      basedOnRoomSeq: workspace.event.roomSeq,
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
    assert.throws(() =>
      kernel.provisionWorkspaceAgent(actor, {
        ...request,
        executionWorkspace: { kind: "agent_private" },
      }),
    );
    const legacy = kernel.provisionWorkspaceAgent(actor, request);
    assert.equal(legacy.agent.currentRevision.executionWorkspace, undefined);
    kernel.publishRuntimeOffer(host, {
      ...offer,
      observedAt: "2026-08-31T00:00:00.001Z",
      supportsAgentPrivateWorkspace: true,
    });
    const privateRequest = {
      ...request,
      basedOnRoomSeq: legacy.event.roomSeq,
      handle: "private-new",
      idempotencyKey: "private-new",
    };
    const created = kernel.provisionWorkspaceAgent(actor, privateRequest);
    assert.deepEqual(created.agent.currentRevision.executionWorkspace, {
      kind: "agent_private",
    });
    assert.deepEqual(
      kernel.provisionWorkspaceAgent(actor, privateRequest).agent
        .currentRevision.executionWorkspace,
      { kind: "agent_private" },
    );
    const explicit = kernel.provisionWorkspaceAgent(actor, {
      ...request,
      basedOnRoomSeq: created.event.roomSeq,
      handle: "explicit-new",
      idempotencyKey: "explicit-new",
      executionWorkspace: {
        kind: "existing_mount",
        workspaceMountRevisionId: "mount-v1",
      },
    });
    assert.deepEqual(explicit.agent.currentRevision.executionWorkspace, {
      kind: "existing_mount",
      workspaceMountRevisionId: "mount-v1",
    });
    assert.throws(() =>
      kernel.provisionWorkspaceAgent(actor, {
        ...request,
        basedOnRoomSeq: explicit.event.roomSeq,
        handle: "bad-mount",
        idempotencyKey: "bad-mount",
        executionWorkspace: {
          kind: "existing_mount",
          workspaceMountRevisionId: "not-authorized",
        },
      }),
    );
  } finally {
    kernel.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
