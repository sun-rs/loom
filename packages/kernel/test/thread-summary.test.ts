import assert from "node:assert/strict";
import test from "node:test";
import { roleInstanceFixture } from "./role-instance-fixture.ts";
test("thread summaries use actual reply authors and independent Human read frontiers", () => {
  const f = roleInstanceFixture();
  try {
    const roomId = f.home.roomId;
    const peer = f.kernel.provisionPrincipal({ handle: "peer", kind: "human" });
    const peerActor = f.kernel.authenticateAccessToken(peer.accessToken);
    f.kernel.addMember(f.actor, {
      roomId,
      principalId: peer.principal.principalId,
    });
    const root = f.kernel.postMessage(f.actor, {
      roomId,
      body: "root",
      recipients: [],
      idempotencyKey: "root",
    });
    const { thread } = f.kernel.createThread(f.actor, {
      roomId,
      rootMessageId: root.event.aggregateId,
      recipientIds: [],
      basedOnRoomSeq: f.head(roomId),
      idempotencyKey: "thread",
    });
    const reply = (actor: typeof f.actor, key: string) =>
      f.kernel.replyThread(actor, {
        roomId,
        threadId: thread.threadId,
        body: key,
        recipientIds: [],
        basedOnRoomSeq: f.head(roomId),
        idempotencyKey: key,
      });
    const first = reply(peerActor, "first");
    reply(f.actor, "own");
    reply(peerActor, "second");
    const summary = () =>
      f.kernel.listThreads(f.actor, { roomId })[0]!.viewerSummary;
    assert.deepEqual(
      new Set(summary()?.participantIds),
      new Set([f.owner.principal.principalId, peer.principal.principalId]),
    );
    assert.equal(summary()?.unreadCount, 2);
    assert.equal(summary()?.firstUnreadMessageId, first.event.aggregateId);
    f.kernel.markHumanActivity(f.actor, {
      roomId,
      action: "read",
      throughSeq: root.event.roomSeq,
    });
    assert.equal(
      summary()?.unreadCount,
      2,
      "channel read must not consume thread",
    );
    f.kernel.markHumanActivity(f.actor, {
      roomId,
      threadId: thread.threadId,
      action: "read",
      throughSeq: first.event.roomSeq,
    });
    assert.equal(summary()?.unreadCount, 1);
    f.kernel.followHumanThread(f.actor, {
      roomId,
      threadId: thread.threadId,
      following: false,
    });
    assert.equal(summary()?.unreadCount, 0);
    assert.equal(summary()?.firstUnreadMessageId, null);
    f.kernel.followHumanThread(f.actor, {
      roomId,
      threadId: thread.threadId,
      following: true,
    });
    assert.equal(summary()?.unreadCount, 1);
    f.kernel.markHumanActivity(f.actor, {
      roomId,
      threadId: thread.threadId,
      action: "read",
      throughSeq: f.head(roomId),
    });
    assert.equal(summary()?.unreadCount, 0);
    const outsider = f.kernel.provisionPrincipal({
      handle: "outsider",
      kind: "human",
    });
    assert.throws(() =>
      f.kernel.listThreads(
        f.kernel.authenticateAccessToken(outsider.accessToken),
        { roomId },
      ),
    );
  } finally {
    f.close();
  }
});
