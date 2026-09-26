import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel, type AuthenticatedHostContext } from "../src/index.ts";

/**
 * Contract §3 migration: a state home written by an older service start holds
 * an offer observation with maxConcurrent 1. Nothing edits room.db directly;
 * the next daemon start re-publishes the same offer id with the configured cap,
 * which mints a new immutable observation (maxConcurrent is part of the
 * capability digest). Until then, instances of different Roles and Channels on
 * that CLI stay serialized; afterwards they are placed in parallel, and one
 * instance still never gets a second lane. Re-publishing an unchanged cap only
 * renews the lease.
 */
test("re-publishing an offer with a larger cap lets instances of different Roles and Channels run in parallel", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-offer-republish-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({
    databasePath,
    placementCapacityPolicy: {
      defaultMaxConcurrent: 2,
      hostLimits: [{ hostId: "host", maxConcurrent: 2 }],
      runtimeProfileLimits: [
        { hostId: "host", maxConcurrent: 2, runtimeProfileId: "profile" },
      ],
    },
  });
  const db = new DatabaseSync(databasePath);
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const actor = kernel.authenticateAccessToken(owner.accessToken);
    const workspace = kernel.createWorkspace(actor, {
      idempotencyKey: "workspace",
      name: "Roles",
      slug: "roles",
    });
    const head = (roomId: string) =>
      Number(
        db
          .prepare("SELECT next_seq - 1 AS seq FROM rooms WHERE room_id=?")
          .get(roomId)!.seq,
      );
    const controlRoomId = workspace.controlRoom.roomId;
    const channel = (slug: string) =>
      kernel.createWorkspaceRoom(actor, {
        basedOnControlRoomSeq: head(controlRoomId),
        idempotencyKey: slug,
        kind: "channel",
        name: slug,
        slug,
        workspaceId: workspace.workspace.workspaceId,
      }).room;
    const home = channel("home");
    const other = channel("other");
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
    const publish = (maxConcurrent: number, observedAtMs: number) =>
      kernel.publishRuntimeOffer(
        host,
        offer(host, workspace, maxConcurrent, observedAtMs),
      );
    const start = Date.now();
    publish(1, start - 2_000);

    const instantiate = (handle: string, roomId: string) => {
      const role = kernel.roles.create(actor, {
        basedOnRoomSeq: head(controlRoomId),
        configuration: {
          displayName: handle,
          handle,
          instructions: `Act as ${handle}.`,
          modelIntent: { fallback: "disabled" as const },
          role: handle,
          runtimeOfferId: "offer",
        },
        controlRoomId,
        idempotencyKey: `role-${handle}`,
      }).role;
      return kernel.roles.instantiate(actor, {
        basedOnRoomSeq: head(roomId),
        channelId: roomId,
        idempotencyKey: `instance-${handle}`,
        roleId: role.roleId,
      }).instance.instanceId;
    };
    const writer = instantiate("writer", home.roomId);
    const reviewer = instantiate("reviewer", home.roomId);
    const planner = instantiate("planner", other.roomId);
    const wake = (roomId: string, participantId: string, key: string) =>
      kernel.postMessage(actor, {
        body: "please respond",
        idempotencyKey: key,
        recipients: [{ participantId, reason: "mention" }],
        roomId,
      });
    wake(home.roomId, writer, "wake-writer");
    wake(home.roomId, reviewer, "wake-reviewer");
    wake(other.roomId, planner, "wake-planner");
    wake(home.roomId, writer, "wake-writer-again");

    const leased = () =>
      [home.roomId, other.roomId].flatMap((roomId) =>
        kernel
          .listActivations({ roomId })
          .filter((activation) => activation.state === "leased"),
      );
    const drainSchedule = () => {
      while (kernel.scheduleNextPlacement({ leaseMs: 600_000 })) {
        // Keep placing until the planner holds every remaining candidate.
      }
    };

    // Old state: the offer still says 1, so a single lane runs.
    drainSchedule();
    assert.equal(
      leased().length,
      1,
      "the stale offer cap serializes instances",
    );

    // Next service start: the same offer id is re-published with the cap.
    const republished = publish(2, start - 1_000);
    assert.equal(republished.maxConcurrent, 2);
    drainSchedule();
    const running = leased();
    assert.equal(running.length, 2, "two different instances run at once");
    assert.equal(
      new Set(running.map((activation) => activation.participantId)).size,
      2,
      "one instance never holds two lanes",
    );

    // Unchanged cap: lease renewal only, no new capability observation.
    const observations = () =>
      Number(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM runtime_offer_observations WHERE runtime_offer_id = ?",
          )
          .get("offer")!.count,
      );
    const before = observations();
    publish(2, start);
    assert.equal(observations(), before);
  } finally {
    db.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

function offer(
  host: AuthenticatedHostContext,
  workspace: { workspace: { workspaceId: string } },
  maxConcurrent: number,
  observedAtMs: number,
  runtimeOfferId = "offer",
  runtimeProfileId = "profile",
) {
  const digest = `sha256:${"a".repeat(64)}` as const;
  return {
    capabilityEvidence: [],
    capacityPoolIds: [],
    certificationRefs: [],
    hostId: host.hostId,
    hostInstanceId: host.instanceId,
    isolation: { evidence: "declared" as const, level: "none" as const },
    leaseUntil: new Date(observedAtMs + 600_000).toISOString(),
    maxConcurrent,
    modelBindingDescriptors: [],
    observedAt: new Date(observedAtMs).toISOString(),
    protocolFamily: "rah-worker-process/v1" as const,
    revisionDigest: digest,
    runtimeOfferId,
    runtimeProfileId,
    runtimeProfileRevisionId: `${runtimeProfileId}-v1`,
    state: "available" as const,
    supportedToolAccessModes: ["full_access" as const],
    workspaceMountDescriptors: [
      {
        modes: ["in_place" as const],
        workspaceDefinitionId: workspace.workspace.workspaceId,
        workspaceMountDigest: digest,
        workspaceMountRevisionId: "mount",
      },
    ],
  };
}

/**
 * Two levels of runtime-adjustable caps: the Host cap bounds every running
 * instance, the per-CLI (RuntimeProfile) cap bounds the instances of one CLI.
 * Either one holds new work in the queue; a change applies to the next
 * scheduling pass and never touches placements already running.
 */
test("Host and per-CLI caps each queue work and change at runtime without touching running work", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-capacity-update-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({
    databasePath,
    placementCapacityPolicy: {
      defaultMaxConcurrent: 1,
      hostLimits: [{ hostId: "host", maxConcurrent: 10 }],
      runtimeProfileLimits: [
        { hostId: "host", maxConcurrent: 1, runtimeProfileId: "codex" },
        { hostId: "host", maxConcurrent: 10, runtimeProfileId: "claude" },
      ],
    },
  });
  const db = new DatabaseSync(databasePath);
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const actor = kernel.authenticateAccessToken(owner.accessToken);
    const workspace = kernel.createWorkspace(actor, {
      idempotencyKey: "workspace",
      name: "Roles",
      slug: "roles",
    });
    const head = (roomId: string) =>
      Number(
        db
          .prepare("SELECT next_seq - 1 AS seq FROM rooms WHERE room_id=?")
          .get(roomId)!.seq,
      );
    const controlRoomId = workspace.controlRoom.roomId;
    const room = kernel.createWorkspaceRoom(actor, {
      basedOnControlRoomSeq: head(controlRoomId),
      idempotencyKey: "home",
      kind: "channel",
      name: "home",
      slug: "home",
      workspaceId: workspace.workspace.workspaceId,
    }).room;
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
    for (const cli of ["codex", "claude"])
      kernel.publishRuntimeOffer(
        host,
        offer(host, workspace, 64, now - 1_000, `offer-${cli}`, cli),
      );
    const instantiate = (handle: string, cli: string) => {
      const role = kernel.roles.create(actor, {
        basedOnRoomSeq: head(controlRoomId),
        configuration: {
          displayName: handle,
          handle,
          instructions: `Act as ${handle}.`,
          modelIntent: { fallback: "disabled" as const },
          role: handle,
          runtimeOfferId: `offer-${cli}`,
        },
        controlRoomId,
        idempotencyKey: `role-${handle}`,
      }).role;
      return kernel.roles.instantiate(actor, {
        basedOnRoomSeq: head(room.roomId),
        channelId: room.roomId,
        idempotencyKey: `instance-${handle}`,
        roleId: role.roleId,
      }).instance.instanceId;
    };
    const codexA = instantiate("codex-a", "codex");
    const codexB = instantiate("codex-b", "codex");
    const claudeA = instantiate("claude-a", "claude");
    const claudeB = instantiate("claude-b", "claude");
    let wakeCount = 0;
    const wake = (...participantIds: string[]) =>
      kernel.postMessage(actor, {
        body: "please respond",
        idempotencyKey: `wake-${String((wakeCount += 1))}`,
        recipients: participantIds.map((participantId) => ({
          participantId,
          reason: "mention" as const,
        })),
        roomId: room.roomId,
      });
    const leasedParticipants = () =>
      kernel
        .listActivations({ roomId: room.roomId })
        .filter((activation) => activation.state === "leased")
        .map((activation) => activation.participantId)
        .sort();
    const drainSchedule = () => {
      while (kernel.scheduleNextPlacement({ leaseMs: 600_000 })) {
        // Place until every remaining candidate is held.
      }
    };

    // Per-CLI cap 1: the second Codex instance queues, Claude is unaffected.
    wake(codexA, codexB, claudeA);
    drainSchedule();
    const firstCodex = leasedParticipants().filter(
      (id) => id === codexA || id === codexB,
    );
    assert.equal(firstCodex.length, 1, "per-CLI cap holds the second Codex");
    assert.ok(leasedParticipants().includes(claudeA));
    const queuedCodex = [codexA, codexB].find(
      (id) => !firstCodex.includes(id),
    )!;
    assert.equal(
      kernel
        .listActivations({ roomId: room.roomId })
        .find((activation) => activation.participantId === queuedCodex)?.state,
      "queued",
    );

    // Raise the per-CLI cap at runtime: the queued Codex instance is placed.
    kernel.placementCapacity.update({
      runtimeProfileLimits: [
        { hostId: "host", maxConcurrent: 2, runtimeProfileId: "codex" },
        { hostId: "host", maxConcurrent: 10, runtimeProfileId: "claude" },
      ],
    });
    drainSchedule();
    assert.deepEqual(leasedParticipants(), [codexA, codexB, claudeA].sort());

    // Lower the Host cap below the running count: nothing running is touched,
    // and new work queues on the Host cap even though its CLI has room.
    kernel.placementCapacity.update({
      hostLimits: [{ hostId: "host", maxConcurrent: 3 }],
    });
    drainSchedule();
    assert.equal(leasedParticipants().length, 3);
    wake(claudeB);
    drainSchedule();
    assert.equal(
      leasedParticipants().includes(claudeB),
      false,
      "the Host cap holds new work",
    );
    kernel.placementCapacity.update({
      hostLimits: [{ hostId: "host", maxConcurrent: 1 }],
    });
    assert.equal(leasedParticipants().length, 3, "running work is untouched");

    kernel.placementCapacity.update({
      hostLimits: [{ hostId: "host", maxConcurrent: 4 }],
    });
    drainSchedule();
    assert.ok(leasedParticipants().includes(claudeB));

    assert.throws(
      () =>
        kernel.placementCapacity.update({
          hostLimits: [{ hostId: "host", maxConcurrent: 0 }],
        }),
      /positive integer/u,
    );
  } finally {
    db.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
