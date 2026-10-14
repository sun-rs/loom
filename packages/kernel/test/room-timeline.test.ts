import assert from "node:assert/strict";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";

test("timeline pages durable notices and messages together without fabricating messages or exposing diagnostics", () => {
  const k = new RoomKernel({ databasePath: ":memory:" });
  k.initialize();
  try {
    const human = k.provisionPrincipal({ handle: "owner", kind: "human" });
    const peer = k.provisionPrincipal({ handle: "Tom-1", kind: "human" });
    const outsider = k.provisionPrincipal({
      handle: "outsider",
      kind: "human",
    });
    const actor = k.authenticateAccessToken(human.accessToken);
    const stranger = k.authenticateAccessToken(outsider.accessToken);
    const w = k.createWorkspace(actor, {
      name: "w",
      slug: "w",
      idempotencyKey: "w",
    });
    const head = (roomId: string) =>
      k.sync(actor, { roomId, consumerId: "test" }).latestRoomSeq;
    const room = k.createWorkspaceRoom(actor, {
      workspaceId: w.workspace.workspaceId,
      name: "chat",
      slug: "chat",
      kind: "channel",
      idempotencyKey: "r",
      basedOnControlRoomSeq: head(w.controlRoom.roomId),
    }).room;
    const roomId = room.roomId;
    k.addMember(actor, { roomId, principalId: peer.principal.principalId });
    // Joining and restoration are unread even when there are no chat messages.
    k.archiveWorkspaceRoom(actor, {
      roomId,
      basedOnRoomSeq: head(roomId),
      idempotencyKey: "archive",
    });
    const restored = k.unarchiveWorkspaceRoom(actor, {
      roomId,
      basedOnRoomSeq: head(roomId),
      idempotencyKey: "restore",
    });
    const empty = k.listRoomTimeline(actor, { roomId, limit: 50 });
    assert.ok(
      empty.items.some(
        (i) =>
          i.kind === "notice" &&
          i.notice.type === "room.unarchived" &&
          i.notice.eventId === restored.event.eventId,
      ),
    );
    assert.equal(k.listMessages(actor, { roomId }).messages.length, 0);
    assert.equal(
      empty.items.filter((i) => i.kind === "notice").length,
      k
        .listHumanActivity(actor, { workspaceId: w.workspace.workspaceId })
        .summary?.rooms.find((r) => r.roomId === roomId)?.unreadCount,
    );
    const posted = k.postRoomMessage(actor, {
      roomId,
      body: "hello",
      basedOnRoomSeq: head(roomId),
      idempotencyKey: "post",
    });
    const thread = k.createThread(actor, {
      roomId,
      rootMessageId: posted.event.aggregateId,
      recipientIds: [],
      basedOnRoomSeq: head(roomId),
      idempotencyKey: "thread",
    }).thread;
    k.replyThread(actor, {
      roomId,
      threadId: thread.threadId,
      body: "thread-only",
      recipientIds: [],
      basedOnRoomSeq: head(roomId),
      idempotencyKey: "thread-reply",
    });
    const full = k.listRoomTimeline(actor, { roomId, limit: 50 });
    assert.equal(full.items.at(-1)?.kind, "message");
    assert.equal(
      full.items.filter((i) => i.kind === "message").length,
      1,
      "thread bodies stay in their thread",
    );
    const last = full.items.at(-1)!;
    assert.ok(
      last.kind === "message" &&
        last.message.messageId === posted.event.aggregateId,
    );
    assert.ok(
      full.items.every(
        (i) =>
          i.kind !== "notice" ||
          ["membership.added", "room.unarchived", "reminder.fired"].includes(
            i.notice.type,
          ),
      ),
    );
    const paged = [];
    let beforeSeq: number | undefined;
    for (let n = 0; n < 10; n++) {
      const page = k.listRoomTimeline(actor, {
        roomId,
        limit: 1,
        ...(beforeSeq ? { beforeSeq } : {}),
      });
      paged.unshift(...page.items);
      if (!page.hasMoreBefore) break;
      beforeSeq = page.cursorBefore;
    }
    assert.deepEqual(paged, full.items);
    assert.deepEqual(
      k.listRoomTimeline(actor, {
        roomId,
        afterSeq: empty.cursorAfter,
        limit: 50,
      }).items,
      [last],
    );
    assert.throws(
      () => k.listRoomTimeline(stranger, { roomId, limit: 50 }),
      /member|access|forbidden/i,
    );
    assert.throws(() =>
      k.listRoomTimeline(actor, {
        roomId,
        afterSeq: 0,
        beforeSeq: 5,
        limit: 50,
      }),
    );
    assert.throws(() => k.listRoomTimeline(actor, { roomId, limit: 501 }));
  } finally {
    k.close();
  }
});
