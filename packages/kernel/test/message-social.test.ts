import assert from "node:assert/strict";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

function fixture(databasePath = ":memory:") {
  const k = new RoomKernel({ databasePath });
  k.initialize();
  const a = k.provisionPrincipal({ handle: "a", kind: "human" });
  const b = k.provisionPrincipal({ handle: "b", kind: "human" });
  const c = k.provisionPrincipal({ handle: "c", kind: "human" });
  const actor = k.authenticateAccessToken(a.accessToken),
    peer = k.authenticateAccessToken(b.accessToken),
    stranger = k.authenticateAccessToken(c.accessToken);
  const w = k.createWorkspace(actor, {
    name: "Social",
    slug: "social",
    idempotencyKey: "w",
  });
  const head = (roomId: string) =>
    k.sync(actor, { roomId, consumerId: "head" }).latestRoomSeq;
  const room = k.createWorkspaceRoom(actor, {
    workspaceId: w.workspace.workspaceId,
    kind: "channel",
    name: "chat",
    slug: "chat",
    basedOnControlRoomSeq: head(w.controlRoom.roomId),
    idempotencyKey: "room",
  }).room;
  k.addMember(actor, {
    roomId: room.roomId,
    principalId: b.principal.principalId,
  });
  const m = k.postRoomMessage(actor, {
    roomId: room.roomId,
    body: "canonical",
    basedOnRoomSeq: head(room.roomId),
    idempotencyKey: "m",
  });
  return {
    k,
    actor,
    peer,
    stranger,
    token: a.accessToken,
    actorId: a.principal.principalId,
    peerId: b.principal.principalId,
    roomId: room.roomId,
    messageId: m.event.aggregateId,
    workspaceId: w.workspace.workspaceId,
    controlRoomId: w.controlRoom.roomId,
    head,
  };
}
test("reactions are explicit shared per-actor sets; replay never toggles and writes no work", () => {
  const f = fixture();
  try {
    const request = {
      roomId: f.roomId,
      messageId: f.messageId,
      emoji: "👍",
      active: true,
      basedOnRoomSeq: f.head(f.roomId),
      idempotencyKey: "r1",
    };
    const before = f.head(f.roomId);
    const first = f.k.messageSocial.react(f.actor, request);
    assert.equal(first.reactions[0]?.count, 1);
    assert.equal(first.reactions[0]?.mine, true);
    const secondEmoji = f.k.messageSocial.react(f.actor, {
      ...request,
      emoji: "❤️",
      idempotencyKey: "r-heart",
    });
    assert.deepEqual(
      secondEmoji.reactions.map(({ emoji, count, mine }) => ({
        emoji,
        count,
        mine,
      })),
      [
        { emoji: "❤️", count: 1, mine: true },
        { emoji: "👍", count: 1, mine: true },
      ],
    );
    f.k.messageSocial.react(f.actor, request);
    assert.equal(f.head(f.roomId), before + 2);
    f.k.messageSocial.react(f.peer, { ...request, idempotencyKey: "r2" });
    const actorView = f.k.messageSocial
      .list(f.actor, {
        roomId: f.roomId,
        messageIds: [f.messageId],
      })
      .items[0]?.reactions.find(({ emoji }) => emoji === "👍");
    const peerView = f.k.messageSocial
      .list(f.peer, {
        roomId: f.roomId,
        messageIds: [f.messageId],
      })
      .items[0]?.reactions.find(({ emoji }) => emoji === "👍");
    assert.equal(actorView?.count, 2);
    assert.equal(actorView?.actors[0]?.principalId, f.actorId);
    assert.equal(peerView?.actors[0]?.principalId, f.peerId);
    const removed = f.k.messageSocial.react(f.actor, {
      ...request,
      active: false,
      idempotencyKey: "r3",
    });
    assert.equal(removed.reactions[0]?.count, 1);
    assert.equal(removed.reactions[0]?.mine, true);
    assert.equal(removed.reactions[1]?.count, 1);
    assert.equal(removed.reactions[1]?.mine, false);
    assert.throws(
      () => f.k.messageSocial.react(f.actor, { ...request, active: false }),
      /idempotency/i,
    );
    assert.throws(
      () => f.k.messageSocial.react(f.stranger, request),
      /member|unavailable/,
    );
    assert.throws(
      () => f.k.messageSocial.react(f.actor, { ...request, emoji: "hello" }),
      /emoji/,
    );
    assert.equal(f.k.listTasks(f.actor, { roomId: f.roomId }).length, 0);
  } finally {
    f.k.close();
  }
});
test("personal indexes survive reopening; frozen saved cursor handles deletion and permission revocation", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-social-test-")),
    path = join(directory, "room.db"),
    f = fixture(path);
  try {
    for (let n = 0; n < 3; n++) {
      const event = f.k.postRoomMessage(f.actor, {
        roomId: f.roomId,
        body: `page ${n}`,
        basedOnRoomSeq: f.head(f.roomId),
        idempotencyKey: `m${n}`,
      }).event;
      f.k.messageSocial.save(f.actor, {
        roomId: f.roomId,
        messageId: event.aggregateId,
        saved: true,
        idempotencyKey: `s${n}`,
      });
    }
    const page = f.k.messageSocial.saved(f.actor, {
      workspaceId: f.workspaceId,
      limit: 1,
    });
    assert.equal(page.total, 3);
    assert.ok(page.nextCursor);
    const latest = page.items[0]!.message.messageId;
    f.k.messageSocial.save(f.actor, {
      roomId: f.roomId,
      messageId: latest,
      saved: false,
      idempotencyKey: "remove-newest",
    });
    const tail = f.k.messageSocial.saved(f.actor, {
      workspaceId: f.workspaceId,
      limit: 1,
      cursor: page.nextCursor,
    });
    assert.equal(tail.items.length, 1);
    assert.notEqual(tail.items[0]!.message.messageId, latest);
    assert.throws(
      () =>
        f.k.messageSocial.saved(f.peer, {
          workspaceId: f.workspaceId,
          cursor: page.nextCursor,
        }),
      /cursor/,
    );
    f.k.humanSidebar.patch(f.actor, {
      workspaceId: f.workspaceId,
      expectedVersion: 0,
      idempotencyKey: "pin",
      patch: { pinned: [`room:${f.roomId}`] },
    });
    f.k.messageSocial.react(f.actor, {
      roomId: f.roomId,
      messageId: f.messageId,
      emoji: "✅",
      active: true,
      basedOnRoomSeq: f.head(f.roomId),
      idempotencyKey: "check",
    });
    f.k.close();
    const reopened = new RoomKernel({ databasePath: path });
    reopened.initialize();
    try {
      const actor = reopened.authenticateAccessToken(f.token);
      assert.equal(
        reopened.messageSocial.saved(actor, { workspaceId: f.workspaceId })
          .total,
        2,
      );
      assert.equal(
        reopened.messageSocial.list(actor, {
          roomId: f.roomId,
          messageIds: [f.messageId],
        }).items[0]!.reactions[0]!.emoji,
        "✅",
      );
      assert.deepEqual(
        reopened.humanSidebar.get(actor, { workspaceId: f.workspaceId })
          .preferences.pinned,
        [`room:${f.roomId}`],
      );
      const db = new DatabaseSync(path);
      try {
        db.prepare(
          "DELETE FROM memberships WHERE room_id=? AND principal_id=?",
        ).run(f.roomId, actor.principalId);
        assert.equal(
          reopened.messageSocial.saved(actor, { workspaceId: f.workspaceId })
            .total,
          0,
        );
        assert.throws(
          () =>
            reopened.messageSocial.list(actor, {
              roomId: f.roomId,
              messageIds: [f.messageId],
            }),
          /member/,
        );
      } finally {
        db.close();
      }
    } finally {
      reopened.close();
    }
  } finally {
    try {
      f.k.close();
    } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
});
test("saved messages are private, idempotent references and current ACL gates all reads", () => {
  const f = fixture();
  try {
    const before = f.head(f.roomId);
    const request = {
      roomId: f.roomId,
      messageId: f.messageId,
      saved: true,
      idempotencyKey: "save1",
    };
    f.k.messageSocial.save(f.actor, request);
    f.k.messageSocial.save(f.actor, request);
    assert.equal(
      f.head(f.roomId),
      before,
      "private save does not leak to shared ledger",
    );
    assert.equal(
      f.k.messageSocial.saved(f.actor, { workspaceId: f.workspaceId }).total,
      1,
    );
    assert.equal(
      f.k.messageSocial.saved(f.peer, { workspaceId: f.workspaceId }).total,
      0,
    );
    assert.equal(
      f.k.messageSocial.list(f.peer, {
        roomId: f.roomId,
        messageIds: [f.messageId],
      }).items[0]?.saved,
      false,
    );
    f.k.messageSocial.save(f.actor, {
      ...request,
      saved: false,
      idempotencyKey: "save2",
    });
    f.k.messageSocial.save(f.actor, request);
    assert.equal(
      f.k.messageSocial.saved(f.actor, { workspaceId: f.workspaceId }).total,
      0,
      "old retry cannot resurrect a removed save",
    );
    assert.throws(
      () => f.k.messageSocial.save(f.stranger, request),
      /member|unavailable/,
    );
  } finally {
    f.k.close();
  }
});

test("saved discovery matches Raft query, Room, sort, totals, and sender metadata", () => {
  const f = fixture();
  try {
    f.k.updateAuthenticatedPrincipal(f.actor, {
      displayName: "Alice Example",
      avatarKey: "portrait_01",
    });
    const room = f.k.createWorkspaceRoom(f.actor, {
      workspaceId: f.workspaceId,
      kind: "channel",
      name: "second",
      slug: "second",
      basedOnControlRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "saved-second-room",
    }).room;
    const first = f.k.postRoomMessage(f.actor, {
      roomId: f.roomId,
      body: "Needle in the first Room",
      basedOnRoomSeq: f.head(f.roomId),
      idempotencyKey: "saved-first-message",
    }).event.aggregateId;
    const second = f.k.postRoomMessage(f.actor, {
      roomId: room.roomId,
      body: "Needle in the second Room",
      basedOnRoomSeq: f.head(room.roomId),
      idempotencyKey: "saved-second-message",
    }).event.aggregateId;
    for (const [messageId, roomId, key] of [
      [first, f.roomId, "saved-first"],
      [second, room.roomId, "saved-second"],
    ] as const)
      f.k.messageSocial.save(f.actor, {
        roomId,
        messageId,
        saved: true,
        idempotencyKey: key,
      });

    const descending = f.k.messageSocial.saved(f.actor, {
      workspaceId: f.workspaceId,
      query: "needle",
      sortDirection: "desc",
    });
    assert.equal(descending.total, 2);
    assert.equal(descending.globalTotal, 2);
    assert.deepEqual(
      descending.items.map(({ message }) => message.messageId),
      [second, first],
    );
    assert.deepEqual(descending.items[0]!.sender, {
      principalId: f.actor.principalId,
      handle: "a",
      kind: "human",
      displayName: "Alice Example",
      avatarKey: "portrait_01",
    });
    assert.equal(descending.items[0]!.roomKind, "channel");

    const filtered = f.k.messageSocial.saved(f.actor, {
      workspaceId: f.workspaceId,
      channelId: f.roomId,
      query: "FIRST",
      sortDirection: "asc",
    });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.globalTotal, 2);
    assert.equal(filtered.items[0]!.message.messageId, first);

    const firstPage = f.k.messageSocial.saved(f.actor, {
      workspaceId: f.workspaceId,
      sortDirection: "asc",
      limit: 1,
    });
    assert.equal(firstPage.items[0]!.message.messageId, first);
    assert.ok(firstPage.nextCursor);
    assert.equal(
      f.k.messageSocial.saved(f.actor, {
        workspaceId: f.workspaceId,
        sortDirection: "asc",
        limit: 1,
        cursor: firstPage.nextCursor,
      }).items[0]!.message.messageId,
      second,
    );
    assert.throws(
      () =>
        f.k.messageSocial.saved(f.actor, {
          workspaceId: f.workspaceId,
          sortDirection: "desc",
          cursor: firstPage.nextCursor,
        }),
      /cursor|scope/i,
    );
  } finally {
    f.k.close();
  }
});
