import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";

import { InstanceRuntimeHintDispatcher } from "../src/instance-runtime-hint-dispatcher.ts";

/**
 * Owner 2026-09-27: the daemon delivers the Kernel's durable
 * `instance.runtime` hints to the Host — prewarm a created Role instance
 * (after re-observing the Host's workspace mounts), retire a removed one. A
 * hint that reaches the Host before its pool started is kept for later.
 * FAKE Host target; real Kernel.
 */
test("instance creation and removal reach the Host as prewarm and retire, in order, once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loom-runtime-hints-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const head = (roomId: string) =>
      Number(
        db
          .prepare("SELECT next_seq - 1 AS seq FROM rooms WHERE room_id=?")
          .get(roomId)!.seq,
      );
    const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const actor = kernel.authenticateAccessToken(owner.accessToken);
    const workspace = kernel.createWorkspace(actor, {
      idempotencyKey: "workspace",
      name: "Roles",
      slug: "roles",
    });
    const controlRoomId = workspace.controlRoom.roomId;
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "host",
        participantIds: [
          kernel.provisionPrincipal({ handle: "bootstrap", kind: "agent" })
            .principal.principalId,
        ],
      }).accessToken,
    );
    kernel.heartbeatHost(host);
    const now = Date.now();
    const digest = `sha256:${"a".repeat(64)}` as const;
    kernel.publishRuntimeOffer(host, {
      capabilityEvidence: [],
      capacityPoolIds: [],
      certificationRefs: [],
      hostId: host.hostId,
      hostInstanceId: host.instanceId,
      isolation: { evidence: "declared", level: "none" },
      leaseUntil: new Date(now + 600_000).toISOString(),
      maxConcurrent: 1,
      modelBindingDescriptors: [],
      observedAt: new Date(now).toISOString(),
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
          workspaceMountRevisionId: "mount",
        },
      ],
    });
    const role = kernel.roles.create(actor, {
      basedOnRoomSeq: head(controlRoomId),
      configuration: {
        displayName: "Writer",
        handle: "writer",
        instructions: "Write.",
        modelIntent: { fallback: "disabled" as const },
        role: "Write",
        runtimeOfferId: "offer",
      },
      controlRoomId,
      idempotencyKey: "role",
    }).role;
    const channel = kernel.createWorkspaceRoom(actor, {
      basedOnControlRoomSeq: head(controlRoomId),
      idempotencyKey: "home",
      kind: "channel",
      name: "home",
      slug: "home",
      workspaceId: workspace.workspace.workspaceId,
    }).room;
    const instanceId = kernel.roles.instantiate(actor, {
      basedOnRoomSeq: head(channel.roomId),
      channelId: channel.roomId,
      idempotencyKey: "instance",
      roleId: role.roleId,
    }).instance.instanceId;

    const calls: string[] = [];
    let running = false;
    const dispatcher = new InstanceRuntimeHintDispatcher({
      beforePrewarm: async () => {
        calls.push("refresh-mounts");
      },
      dispatcherId: "hint-test",
      kernel,
      leaseMs: 5_000,
      onDiagnostic: () => undefined,
      pollIntervalMs: 1,
      retryAfterMs: 50,
      target: {
        prewarmInstance: async (participantId) => {
          calls.push(`prewarm:${participantId}`);
          return running
            ? { kind: "started" }
            : { kind: "skipped", reason: "host_not_running" };
        },
        retireInstance: async (participantId) => {
          calls.push(`retire:${participantId}`);
        },
      },
    });

    // Before the Host's pool starts, the hint is kept, not lost.
    assert.equal(await dispatcher.dispatchOnce(), true);
    assert.equal(await dispatcher.dispatchOnce(), false, "retried later");
    await new Promise((resolve) => setTimeout(resolve, 80));
    running = true;
    assert.equal(await dispatcher.dispatchOnce(), true);
    assert.equal(await dispatcher.dispatchOnce(), false, "handled once");

    kernel.removeRoomMember(actor, {
      basedOnRoomSeq: head(channel.roomId),
      idempotencyKey: "remove",
      principalId: instanceId,
      roomId: channel.roomId,
    });
    assert.equal(await dispatcher.dispatchOnce(), true);
    assert.deepEqual(calls, [
      "refresh-mounts",
      `prewarm:${instanceId}`,
      "refresh-mounts",
      `prewarm:${instanceId}`,
      `retire:${instanceId}`,
    ]);
  } finally {
    db.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
