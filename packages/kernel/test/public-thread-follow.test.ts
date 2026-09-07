import assert from "node:assert/strict";
import test from "node:test";
import { publicChannelFixture } from "./public-channel-fixture.ts";

test("eligible public Thread follow survives leave without restoring Room delivery, and revocation hides it", () => {
  const f = publicChannelFixture();
  try {
    const { owner, reader } = f.people;
    const roomId = f.publicRoom.roomId,
      workspaceId = f.workspace.workspace.workspaceId;
    f.port.joinPublicChannel(reader!.actor, f.request());
    const root = f.kernel.postRoomMessage(owner!.actor, {
      roomId,
      body: "follow root",
      basedOnRoomSeq: f.seq(roomId),
      idempotencyKey: "root",
    }).event;
    const thread = f.kernel.createThread(owner!.actor, {
      roomId,
      rootMessageId: root.aggregateId,
      recipientIds: [],
      basedOnRoomSeq: f.seq(roomId),
      idempotencyKey: "thread",
    }).thread;
    const follow = (following: boolean) =>
      f.port.followHumanThread(reader!.actor, {
        roomId,
        threadId: thread.threadId,
        following,
      });
    const activity = () =>
      f.port.listHumanActivity(reader!.actor, { workspaceId });
    follow(true);
    f.kernel.leaveRoom(reader!.actor, {
      roomId,
      basedOnRoomSeq: f.seq(roomId),
      idempotencyKey: "leave-again",
    });
    f.kernel.replyThread(owner!.actor, {
      roomId,
      threadId: thread.threadId,
      body: "followed reply",
      recipientIds: [],
      basedOnRoomSeq: f.seq(roomId),
      idempotencyKey: "reply",
    });
    f.kernel.postRoomMessage(owner!.actor, {
      roomId,
      body: "ordinary channel message",
      basedOnRoomSeq: f.seq(roomId),
      idempotencyKey: "ordinary",
    });
    const preview = f.port.previewChannel(reader!.actor, {
      workspaceId,
      roomId,
      threadId: thread.threadId,
    });
    assert.deepEqual(
      preview.messages.map((m) => m.body),
      ["follow root", "followed reply"],
    );
    assert.equal(preview.threadId, thread.threadId);
    assert.equal(activity().items.filter((i) => i.roomId === roomId).length, 1);
    assert.equal(
      activity().items.find((i) => i.roomId === roomId)!.kind,
      "thread",
    );
    assert.equal(
      activity().summary!.rooms.some((r) => r.roomId === roomId),
      false,
    );
    assert.equal(
      f.port.getHumanThreadFollowers(reader!.actor, {
        roomId,
        threadId: thread.threadId,
      }).canManage,
      false,
    );
    follow(false);
    assert.equal(activity().items.filter((i) => i.roomId === roomId).length, 0);
    follow(true);
    assert.equal(activity().items.filter((i) => i.roomId === roomId).length, 1);
    assert.throws(
      () =>
        f.kernel.sync(reader!.actor, {
          roomId,
          consumerId: "denied",
          bootstrap: "latest",
        }),
      /member/,
    );
    f.kernel.updateWorkspaceRoom(owner!.actor, {
      roomId,
      name: "open",
      visibility: "private",
      basedOnRoomSeq: f.seq(roomId),
      idempotencyKey: "private",
    });
    assert.equal(activity().items.filter((i) => i.roomId === roomId).length, 0);
    assert.throws(() => follow(true), /member|unavailable/);
  } finally {
    f.close();
  }
});
