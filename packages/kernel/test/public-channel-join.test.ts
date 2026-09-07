import assert from "node:assert/strict";
import test from "node:test";
import { RoomKernel, createHumanApplicationPort } from "../src/index.ts";
import { publicChannelFixture as fixture } from "./public-channel-fixture.ts";

test("public metadata discovery is bounded and distinct from participation/history", () => {
  const f = fixture();
  try {
    const { reader, outsider, agent } = f.people,
      workspaceId = f.workspace.workspace.workspaceId;
    const extra = f.channel("other-open");
    const page = f.port.discoverPublicChannels(reader!.actor, {
      workspaceId,
      limit: 1,
    });
    assert.equal(page.channels.length, 1);
    assert.ok(page.nextAfterRoomId);
    const next = f.port.discoverPublicChannels(reader!.actor, {
      workspaceId,
      limit: 1,
      afterRoomId: page.nextAfterRoomId,
    });
    assert.equal(next.channels.length, 1);
    assert.equal(next.nextAfterRoomId, undefined);
    assert.deepEqual(
      [...page.channels, ...next.channels].map((x) => x.room.roomId).sort(),
      [f.publicRoom.roomId, extra.roomId].sort(),
    );
    assert.equal(page.channels[0]!.membership, undefined);
    assert.equal(
      f.kernel
        .listRooms(reader!.actor)
        .some((r) => r.roomId === f.publicRoom.roomId),
      false,
    );
    assert.throws(() =>
      f.kernel.listRoomMemberships(reader!.actor, {
        roomId: f.publicRoom.roomId,
      }),
    );
    assert.throws(
      () =>
        f.kernel.sync(reader!.actor, {
          roomId: f.publicRoom.roomId,
          consumerId: "metadata-is-not-delivery",
          bootstrap: "latest",
        }),
      /member|unavailable/i,
    );
    for (const actor of [outsider!.actor, agent!.actor])
      assert.throws(
        () => f.port.discoverPublicChannels(actor, { workspaceId }),
        /Human|member|unavailable|access/i,
      );
    assert.deepEqual(
      f.port.discoverPublicChannels(reader!.actor, { workspaceId, query: "%" })
        .channels,
      [],
    );
    assert.throws(() =>
      f.port.discoverPublicChannels(reader!.actor, { workspaceId, limit: 101 }),
    );
  } finally {
    f.close();
  }
});

test("self-join is actor-bound, durable, causal, idempotent and has no execution/read side effects", () => {
  const f = fixture();
  try {
    const { reader, owner, other } = f.people,
      input = f.request();
    const counts = () =>
      Object.fromEntries(
        ["inbox_items", "activations", "subscription_cursors"].map((table) => [
          table,
          Number(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n),
        ]),
      );
    const outboxBefore = Number(
      f.db.prepare("SELECT count(*) AS n FROM outbox").get()!.n,
    );
    const before = counts(),
      seq = f.seq(f.publicRoom.roomId);
    const joined = f.port.joinPublicChannel(reader!.actor, input);
    assert.equal(joined.membership.principalId, reader!.principal.principalId);
    assert.equal(joined.membership.role, "member");
    assert.equal(joined.event.type, "membership.added");
    assert.equal(joined.event.roomSeq, seq + 1);
    assert.equal(joined.deduplicated, false);
    assert.deepEqual(counts(), before);
    assert.equal(
      Number(f.db.prepare("SELECT count(*) AS n FROM outbox").get()!.n),
      outboxBefore + 1,
    );
    assert.ok(
      f.kernel
        .listRooms(reader!.actor)
        .some((r) => r.roomId === f.publicRoom.roomId),
    );
    assert.deepEqual(f.port.joinPublicChannel(reader!.actor, input), {
      ...joined,
      deduplicated: true,
    });
    assert.equal(f.seq(f.publicRoom.roomId), seq + 1);
    assert.throws(
      () => f.port.joinPublicChannel(other!.actor, input),
      /idempotency|key/i,
    );
    assert.throws(() =>
      f.port.joinPublicChannel(reader!.actor, {
        ...input,
        ...{ role: "owner" },
      }),
    );
    assert.throws(() =>
      f.port.joinPublicChannel(reader!.actor, {
        ...input,
        ...{ principalId: owner!.principal.principalId },
      }),
    );
    assert.throws(
      () =>
        f.port.joinPublicChannel(owner!.actor, {
          ...input,
          idempotencyKey: "already-owner",
          basedOnRoomSeq: f.seq(input.roomId),
        }),
      /already|member|joined/i,
    );
    const reopened = new RoomKernel({ databasePath: f.databasePath });
    try {
      reopened.initialize();
      const actor = reopened.authenticateHumanAccessToken(reader!.accessToken);
      assert.deepEqual(
        createHumanApplicationPort(reopened)
          .listRooms(actor, { workspaceId: input.workspaceId })
          .map((r) => r.roomId)
          .sort(),
        f.kernel
          .listRooms(reader!.actor, { workspaceId: input.workspaceId })
          .map((r) => r.roomId)
          .sort(),
      );
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});

test("join rechecks current scope and stale context and atomically rolls back event failure", () => {
  const f = fixture();
  try {
    const { reader, owner, outsider, agent } = f.people,
      input = f.request();
    for (const actor of [outsider!.actor, agent!.actor])
      assert.throws(
        () => f.port.joinPublicChannel(actor, input),
        /Human|member|unavailable|access/i,
      );
    for (const roomId of [
      f.privateRoom.roomId,
      f.workspace.controlRoom.roomId,
      "missing",
    ])
      assert.throws(
        () => f.port.joinPublicChannel(reader!.actor, { ...input, roomId }),
        /unavailable|public|channel/i,
      );
    f.kernel.postMessage(owner!.actor, {
      roomId: input.roomId,
      body: "new fact",
      recipients: [],
      idempotencyKey: "new-fact",
      basedOnRoomSeq: f.seq(input.roomId),
    });
    assert.throws(
      () => f.port.joinPublicChannel(reader!.actor, input),
      /sequence/i,
    );
    const fresh = f.request();
    f.db.exec(
      "CREATE TRIGGER fail_join_event BEFORE INSERT ON room_events WHEN NEW.type='membership.added' BEGIN SELECT RAISE(ABORT,'injected event failure'); END",
    );
    assert.throws(
      () => f.port.joinPublicChannel(reader!.actor, fresh),
      /injected event failure/,
    );
    assert.equal(
      f.kernel.listRooms(reader!.actor).some((r) => r.roomId === input.roomId),
      false,
    );
    assert.equal(f.seq(input.roomId), fresh.basedOnRoomSeq);
    f.db.exec("DROP TRIGGER fail_join_event");
    f.kernel.updateWorkspaceRoom(owner!.actor, {
      roomId: input.roomId,
      basedOnRoomSeq: f.seq(input.roomId),
      idempotencyKey: "make-private",
      name: "open",
      visibility: "private",
    });
    assert.throws(
      () => f.port.joinPublicChannel(reader!.actor, fresh),
      /unavailable|public/i,
    );
  } finally {
    f.close();
  }
});

test("leave/rejoin, archived Channels and Workspace revocation cannot replay old join authority", () => {
  const f = fixture();
  try {
    const { reader, owner } = f.people,
      input = f.request(),
      workspaceId = input.workspaceId;
    f.port.joinPublicChannel(reader!.actor, input);
    f.kernel.leaveRoom(reader!.actor, {
      roomId: input.roomId,
      basedOnRoomSeq: f.seq(input.roomId),
      idempotencyKey: "leave-again",
    });
    assert.throws(
      () => f.port.joinPublicChannel(reader!.actor, input),
      /membership changed/i,
    );
    assert.equal(
      f.kernel
        .listRooms(reader!.actor)
        .some((room) => room.roomId === input.roomId),
      false,
    );
    const next = { ...f.request(), idempotencyKey: "join-again" };
    f.port.joinPublicChannel(reader!.actor, next);
    assert.throws(
      () => f.port.joinPublicChannel(reader!.actor, input),
      /membership changed/i,
    );
    const archived = f.channel("archived");
    f.kernel.archiveWorkspaceRoom(owner!.actor, {
      roomId: archived.roomId,
      basedOnRoomSeq: f.seq(archived.roomId),
      idempotencyKey: "archive",
    });
    assert.equal(
      f.port
        .discoverPublicChannels(reader!.actor, { workspaceId })
        .channels.some((x) => x.room.roomId === archived.roomId),
      false,
    );
    assert.throws(
      () =>
        f.port.joinPublicChannel(reader!.actor, {
          ...f.request(),
          roomId: archived.roomId,
        }),
      /unavailable/i,
    );
    const direct = f.kernel.openDirectRoom(owner!.actor, {
      workspaceId,
      basedOnControlRoomSeq: f.seq(f.workspace.controlRoom.roomId),
      peerPrincipalId: reader!.principal.principalId,
      idempotencyKey: "direct",
    });
    assert.throws(
      () =>
        f.port.joinPublicChannel(reader!.actor, {
          ...f.request(),
          roomId: direct.roomId,
        }),
      /unavailable/i,
    );
    f.kernel.removeRoomMember(owner!.actor, {
      roomId: f.workspace.controlRoom.roomId,
      principalId: reader!.principal.principalId,
      basedOnRoomSeq: f.seq(f.workspace.controlRoom.roomId),
      idempotencyKey: "revoke",
    });
    assert.throws(
      () =>
        f.port.discoverPublicChannels(reader!.actor, {
          workspaceId,
          afterRoomId: input.roomId,
        }),
      /Human|member/i,
    );
    assert.throws(
      () => f.port.joinPublicChannel(reader!.actor, next),
      /Human|member/i,
    );
  } finally {
    f.close();
  }
});

test("join rejects a stale public listing after Workspace archival and visibility revocation on replay", () => {
  const f = fixture();
  try {
    const { reader, owner } = f.people,
      input = f.request();
    f.port.joinPublicChannel(reader!.actor, input);
    f.kernel.updateWorkspaceRoom(owner!.actor, {
      roomId: input.roomId,
      basedOnRoomSeq: f.seq(input.roomId),
      name: "open",
      visibility: "private",
      idempotencyKey: "private-after-join",
    });
    assert.throws(
      () => f.port.joinPublicChannel(reader!.actor, input),
      /unavailable/i,
    );
    assert.equal(
      f.port.discoverPublicChannels(reader!.actor, {
        workspaceId: input.workspaceId,
      }).channels.length,
      0,
    );
    // No public Workspace archive facade is exposed yet; inject the durable state.
    f.db
      .prepare(
        "UPDATE workspaces SET state='archived', archived_at='2026-09-07T00:00:00.000Z' WHERE workspace_id=?",
      )
      .run(input.workspaceId);
    assert.throws(
      () =>
        f.port.discoverPublicChannels(reader!.actor, {
          workspaceId: input.workspaceId,
        }),
      /Human|member/i,
    );
    assert.throws(
      () => f.port.joinPublicChannel(reader!.actor, input),
      /Human|member/i,
    );
  } finally {
    f.close();
  }
});
