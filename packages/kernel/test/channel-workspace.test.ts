import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { RuntimeOffer } from "@rah-os/protocol";

import {
  ConflictError,
  IdempotencyConflictError,
  RoomKernel,
} from "../src/index.ts";
import type { RoomKernelOptions } from "../src/room-kernel-options.ts";

/**
 * Owner 2026-09-26 channel workspace: every new Channel owns a platform home
 * plus optional Human-attached directories fixed at creation. Fake Host, no
 * provider; every assertion reads durable Kernel state.
 */
function fixture(
  options: {
    validator?: (paths: readonly string[]) => void;
    preparer?: RoomKernelOptions["channelPrimaryDirectoryPreparer"];
    createId?: (prefix: string) => string;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "rah-channel-workspace-"));
  const databasePath = join(directory, "room.db");
  const validated: string[][] = [];
  const kernel = new RoomKernel({
    databasePath,
    ...(options.preparer === undefined
      ? {}
      : { channelPrimaryDirectoryPreparer: options.preparer }),
    ...(options.createId === undefined ? {} : { createId: options.createId }),
    ...(options.validator === undefined
      ? {}
      : {
          channelAttachedDirectoryValidator: (paths: readonly string[]) => {
            validated.push([...paths]);
            options.validator!(paths);
          },
        }),
  });
  kernel.initialize();
  const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const actor = kernel.authenticateAccessToken(owner.accessToken);
  const workspace = kernel.createWorkspace(actor, {
    name: "Channels",
    slug: "channels",
    idempotencyKey: "workspace",
  });
  const db = new DatabaseSync(databasePath);
  const head = (id: string) =>
    Number(
      db
        .prepare("SELECT next_seq - 1 AS seq FROM rooms WHERE room_id=?")
        .get(id)!.seq,
    );
  const controlRoomId = workspace.controlRoom.roomId;
  const createChannel = (
    slug: string,
    additionalDirectories?: string[],
    idempotencyKey = slug,
  ) =>
    kernel.createWorkspaceRoom(actor, {
      workspaceId: workspace.workspace.workspaceId,
      basedOnControlRoomSeq: head(controlRoomId),
      kind: "channel",
      idempotencyKey,
      name: slug,
      slug,
      ...(additionalDirectories === undefined ? {} : { additionalDirectories }),
    });
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
  const digest = `sha256:${"a".repeat(64)}` as const;
  const now = new Date();
  const offer: RuntimeOffer = {
    hostId: host.hostId,
    hostInstanceId: host.instanceId,
    runtimeOfferId: "offer",
    runtimeProfileId: "profile",
    runtimeProfileRevisionId: "profile-v1",
    revisionDigest: digest,
    protocolFamily: "rah-worker-process/v1",
    state: "available",
    observedAt: now.toISOString(),
    leaseUntil: new Date(now.getTime() + 600_000).toISOString(),
    isolation: { evidence: "declared", level: "none" },
    maxConcurrent: 2,
    capacityPoolIds: [],
    capabilityEvidence: [],
    certificationRefs: [],
    modelBindingDescriptors: [],
    supportedToolAccessModes: ["full_access"],
    supportsAgentPrivateWorkspace: true,
    workspaceMountDescriptors: [
      {
        workspaceDefinitionId: workspace.workspace.workspaceId,
        workspaceMountRevisionId: "mount",
        workspaceMountDigest: digest,
        modes: ["in_place"],
      },
    ],
  };
  kernel.publishRuntimeOffer(host, offer);
  const role = kernel.roles.create(actor, {
    controlRoomId,
    basedOnRoomSeq: head(controlRoomId),
    idempotencyKey: "role",
    configuration: {
      displayName: "Builder",
      handle: "builder",
      instructions: "Build.",
      role: "Build",
      runtimeOfferId: "offer",
      modelIntent: { fallback: "disabled" as const },
    },
  }).role;
  let instances = 0;
  const instantiate = (channelId: string) => {
    instances += 1;
    return kernel.roles.instantiate(actor, {
      roleId: role.roleId,
      channelId,
      basedOnRoomSeq: head(channelId),
      idempotencyKey: `instance-${String(instances)}`,
    });
  };
  const close = () => {
    db.close();
    kernel.close();
    rmSync(directory, { recursive: true, force: true });
  };
  return {
    actor,
    close,
    createChannel,
    databasePath,
    db,
    head,
    host,
    instantiate,
    kernel,
    validated,
  };
}

test("a new Channel records a platform home with no attached directories, in its projection and creation events", () => {
  const f = fixture();
  try {
    const created = f.createChannel("plain");
    assert.deepEqual(created.room.channelWorkspace, {
      kind: "channel_home",
      additionalDirectories: [],
      primary: { state: "pending" },
    });
    assert.deepEqual(created.event.payload.channelWorkspace, {
      kind: "channel_home",
      additionalDirectories: [],
    });
    const roomCreated = f.db
      .prepare(
        "SELECT payload_json FROM room_events WHERE room_id=? AND type='room.created'",
      )
      .get(created.room.roomId) as { payload_json: string };
    assert.deepEqual(JSON.parse(roomCreated.payload_json).channelWorkspace, {
      kind: "channel_home",
      additionalDirectories: [],
    });
    assert.deepEqual(
      f.kernel
        .listRooms(f.actor)
        .find((room) => room.roomId === created.room.roomId)?.channelWorkspace,
      {
        kind: "channel_home",
        additionalDirectories: [],
        primary: { state: "pending" },
      },
    );
  } finally {
    f.close();
  }
});

test("attached directories are validated by the Host validator, stored in order and replayed idempotently", () => {
  const f = fixture({ validator: () => undefined });
  try {
    const created = f.createChannel("attached", ["/work/app", "/work/lib"]);
    assert.deepEqual(f.validated, [["/work/app", "/work/lib"]]);
    assert.deepEqual(created.room.channelWorkspace, {
      kind: "channel_home",
      additionalDirectories: ["/work/app", "/work/lib"],
      primary: { state: "pending" },
    });
    const replay = f.kernel.createWorkspaceRoom(f.actor, {
      workspaceId: created.room.workspaceId,
      basedOnControlRoomSeq: 0,
      kind: "channel",
      idempotencyKey: "attached",
      name: "attached",
      slug: "attached",
      additionalDirectories: ["/work/app", "/work/lib"],
    });
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.room.roomId, created.room.roomId);
    assert.throws(
      () =>
        f.kernel.createWorkspaceRoom(f.actor, {
          workspaceId: created.room.workspaceId,
          basedOnControlRoomSeq: 0,
          kind: "channel",
          idempotencyKey: "attached",
          name: "attached",
          slug: "attached",
          additionalDirectories: ["/work/app"],
        }),
      IdempotencyConflictError,
    );
  } finally {
    f.close();
  }
});

test("a rejected attached directory creates no Channel; without a Host validator attached directories are refused", () => {
  const f = fixture({
    validator: (paths) => {
      if (paths.includes("/missing"))
        throw new Error("/missing does not exist");
    },
  });
  try {
    const before = f.db.prepare("SELECT COUNT(*) AS n FROM rooms").get() as {
      n: number;
    };
    assert.throws(
      () => f.createChannel("bad", ["/missing"]),
      (error: unknown) =>
        error instanceof ConflictError &&
        /missing does not exist/u.test(error.message),
    );
    assert.throws(
      () => f.createChannel("bad-shape", ["relative"]),
      ConflictError,
    );
    assert.throws(
      () => f.createChannel("dup", ["/work/a", "/work/a"]),
      ConflictError,
    );
    const after = f.db.prepare("SELECT COUNT(*) AS n FROM rooms").get() as {
      n: number;
    };
    assert.equal(after.n, before.n);
  } finally {
    f.close();
  }
  const bare = fixture();
  try {
    assert.throws(() => bare.createChannel("x", ["/work/app"]), ConflictError);
    assert.equal(
      bare.createChannel("y", []).room.channelWorkspace?.kind,
      "channel_home",
    );
  } finally {
    bare.close();
  }
});

test("a new instance of a new Channel runs in the channel home; the Host binding carries room and attached directories", () => {
  const f = fixture({ validator: () => undefined });
  try {
    const channel = f.createChannel("home", ["/work/app"]).room;
    const created = f.instantiate(channel.roomId);
    assert.deepEqual(created.agent.currentRevision.executionWorkspace, {
      kind: "channel_home",
      roomId: channel.roomId,
    });
    const binding = f.kernel
      .listHostExecutionWorkspaceBindings(f.host)
      .find((b) => b.participantId === created.instance.instanceId);
    assert.deepEqual(binding?.executionWorkspace, {
      kind: "channel_home",
      roomId: channel.roomId,
    });
    assert.deepEqual(binding?.additionalDirectories, ["/work/app"]);
  } finally {
    f.close();
  }
});

test("an existing Channel without a home keeps the private per-instance cwd for new instances, and existing instances are untouched", () => {
  const f = fixture();
  try {
    const channel = f.createChannel("legacy").room;
    // Simulates a Channel created before schema 71 (no platform home).
    f.db
      .prepare("UPDATE rooms SET channel_workspace_json=NULL WHERE room_id=?")
      .run(channel.roomId);
    const legacy = f.instantiate(channel.roomId);
    assert.deepEqual(legacy.agent.currentRevision.executionWorkspace, {
      kind: "agent_private",
    });
    const binding = f.kernel
      .listHostExecutionWorkspaceBindings(f.host)
      .find((b) => b.participantId === legacy.instance.instanceId);
    assert.deepEqual(binding?.executionWorkspace, { kind: "agent_private" });
    assert.equal(binding?.additionalDirectories, undefined);
    assert.equal(
      f.kernel.listRooms(f.actor).find((room) => room.roomId === channel.roomId)
        ?.channelWorkspace,
      undefined,
    );
  } finally {
    f.close();
  }
});

/** Fake Host preparer: records calls, no filesystem. */
function fakePreparer(root: string, failWith?: string) {
  const prepared: string[] = [];
  const rolledBack: string[] = [];
  return {
    prepared,
    rolledBack,
    preparer: (roomId: string) => {
      if (failWith !== undefined) throw new Error(failWith);
      prepared.push(roomId);
      return {
        primaryDirectory: `${root}/${roomId}`,
        rollback: () => {
          rolledBack.push(roomId);
        },
      };
    },
  };
}

test("option A: the Host prepares the primary directory at Channel creation; the path is recorded, the state is ready and a replay prepares nothing", () => {
  const host = fakePreparer("/homes/a");
  const f = fixture({ preparer: host.preparer });
  try {
    const created = f.createChannel("fixed");
    const channel = created.room;
    assert.deepEqual(host.prepared, [channel.roomId]);
    assert.deepEqual(channel.channelWorkspace, {
      kind: "channel_home",
      additionalDirectories: [],
      primaryDirectory: `/homes/a/${channel.roomId}`,
      primary: { state: "ready" },
    });
    assert.equal(
      (created.event.payload.channelWorkspace as { primaryDirectory?: string })
        .primaryDirectory,
      `/homes/a/${channel.roomId}`,
    );
    const replay = f.createChannel("fixed");
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.room.roomId, channel.roomId);
    assert.equal(
      replay.room.channelWorkspace?.primaryDirectory,
      `/homes/a/${channel.roomId}`,
    );
    assert.deepEqual(
      host.prepared,
      [channel.roomId],
      "replay prepares nothing",
    );
    assert.deepEqual(host.rolledBack, []);
  } finally {
    f.close();
  }
});

test("option A: a Host preparation failure fails Channel creation with a diagnosable error and leaves no Channel row", () => {
  const host = fakePreparer(
    "/homes/a",
    "channel_home_unowned: /homes/a/x already exists and was not created by Loom",
  );
  const f = fixture({ preparer: host.preparer });
  try {
    const before = f.db.prepare("SELECT COUNT(*) AS n FROM rooms").get() as {
      n: number;
    };
    assert.throws(
      () => f.createChannel("conflict"),
      (error: unknown) =>
        error instanceof ConflictError &&
        /primary directory/u.test(error.message) &&
        /channel_home_unowned/u.test(error.message),
    );
    const after = f.db.prepare("SELECT COUNT(*) AS n FROM rooms").get() as {
      n: number;
    };
    assert.equal(after.n, before.n);
  } finally {
    f.close();
  }
});

test("option A: a Kernel commit failure after preparation rolls the prepared directory back", () => {
  const host = fakePreparer("/homes/a");
  let forcedRoomId: string | undefined;
  let ids = 0;
  const f = fixture({
    preparer: host.preparer,
    // The second Channel reuses the first one's room id, so its INSERT fails
    // after the Host already prepared the directory.
    createId: (prefix) =>
      prefix === "room" && forcedRoomId !== undefined
        ? forcedRoomId
        : `${prefix}_${String((ids += 1))}`,
  });
  try {
    forcedRoomId = undefined;
    const first = f.createChannel("first").room;
    forcedRoomId = first.roomId;
    assert.throws(() => f.createChannel("second"));
    assert.deepEqual(host.rolledBack, [first.roomId]);
    assert.equal(
      f.kernel.listRooms(f.actor).filter((room) => room.slug === "second")
        .length,
      0,
    );
  } finally {
    f.close();
  }
});

test("the recorded primary directory is never re-derived when the Host root later changes", () => {
  const f = fixture({ preparer: fakePreparer("/homes/a").preparer });
  try {
    const channel = f.createChannel("fixed").room;
    f.kernel.close();
    const reopened = new RoomKernel({
      databasePath: f.databasePath,
      channelPrimaryDirectoryPreparer: fakePreparer("/homes/b").preparer,
    });
    try {
      reopened.initialize();
      const row = f.db
        .prepare("SELECT channel_workspace_json FROM rooms WHERE room_id=?")
        .get(channel.roomId) as { channel_workspace_json: string };
      assert.equal(
        JSON.parse(row.channel_workspace_json).primaryDirectory,
        `/homes/a/${channel.roomId}`,
      );
    } finally {
      reopened.close();
    }
  } finally {
    f.db.close();
    rmSync(dirname(f.databasePath), { recursive: true, force: true });
  }
});

test("the Host binding carries the recorded primary directory", () => {
  const f = fixture({ preparer: fakePreparer("/homes/a").preparer });
  try {
    const channel = f.createChannel("bound").room;
    const created = f.instantiate(channel.roomId);
    const binding = f.kernel
      .listHostExecutionWorkspaceBindings(f.host)
      .find((b) => b.participantId === created.instance.instanceId);
    assert.equal(binding?.primaryDirectory, `/homes/a/${channel.roomId}`);
  } finally {
    f.close();
  }
});

test("the Room projection shows the primary directory state reported by its Host: pending until reported, then ready or failed", () => {
  const f = fixture();
  try {
    const channel = f.createChannel("state").room;
    const other = f.createChannel("unbound").room;
    const stateOf = (roomId: string) =>
      f.kernel.listRooms(f.actor).find((room) => room.roomId === roomId)
        ?.channelWorkspace?.primary;
    assert.deepEqual(stateOf(channel.roomId), { state: "pending" });
    f.instantiate(channel.roomId);
    const seq = f.head(channel.roomId);
    f.kernel.reportChannelWorkspaceStates(f.host, [
      { roomId: channel.roomId, state: "ready" },
    ]);
    assert.deepEqual(stateOf(channel.roomId), { state: "ready" });
    f.kernel.reportChannelWorkspaceStates(f.host, [
      {
        roomId: channel.roomId,
        state: "failed",
        reason: "channel_home_replaced: the primary directory was replaced",
      },
    ]);
    assert.deepEqual(stateOf(channel.roomId), {
      state: "failed",
      reason: "channel_home_replaced: the primary directory was replaced",
    });
    assert.equal(
      f.head(channel.roomId),
      seq,
      "a Host observation is not a Room business event",
    );
    assert.throws(
      () =>
        f.kernel.reportChannelWorkspaceStates(f.host, [
          { roomId: other.roomId, state: "ready" },
        ]),
      /not bound/u,
    );
    assert.deepEqual(stateOf(other.roomId), { state: "pending" });
  } finally {
    f.close();
  }
});
