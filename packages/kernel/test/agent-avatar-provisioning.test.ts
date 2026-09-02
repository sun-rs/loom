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

test("automatic Agent avatars are unique, canonical, replay-stable and survive reopening", () => {
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
    const first = kernel.provisionWorkspaceAgent(actor, request);
    const firstKey = first.agent.currentRevision.avatarKey!;
    assert.ok(OFFICIAL_AGENT_AVATAR_KEYS.includes(firstKey));
    const replay = kernel.provisionWorkspaceAgent(actor, request);
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.agent.currentRevision.avatarKey, firstKey);
    const second = kernel.provisionWorkspaceAgent(actor, {
      ...request,
      basedOnRoomSeq: first.event.roomSeq,
      handle: "kimi",
      displayName: "Kimi",
      idempotencyKey: "create-kimi",
    });
    const secondKey = second.agent.currentRevision.avatarKey!;
    assert.ok(OFFICIAL_AGENT_AVATAR_KEYS.includes(secondKey));
    assert.notDeepEqual(firstKey, secondKey);
    const manual = kernel.provisionWorkspaceAgent(actor, {
      ...request,
      basedOnRoomSeq: second.event.roomSeq,
      avatarKey: "cat",
      handle: "manual",
      displayName: "Manual",
      idempotencyKey: "create-manual",
    });
    assert.equal(manual.agent.currentRevision.avatarKey, "cat");
    kernel.close();
    kernel = new RoomKernel(options);
    kernel.initialize();
    actor = kernel.authenticateAccessToken(owner.accessToken);
    assert.equal(
      kernel.provisionWorkspaceAgent(actor, request).agent.currentRevision
        .avatarKey,
      firstKey,
    );
  } finally {
    kernel.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
