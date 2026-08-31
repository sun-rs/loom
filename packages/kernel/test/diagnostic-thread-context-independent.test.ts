import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";

test("audit: root and reply short references retain exact thread context without widening Room ACL", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-independent-thread-context-"),
  );
  const kernel = new RoomKernel({ databasePath: join(directory, "test.db") });
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({
      handle: "audit-owner",
      kind: "human",
    });
    const stranger = kernel.provisionPrincipal({
      handle: "audit-stranger",
      kind: "human",
    });
    const actor = kernel.authenticateAccessToken(owner.accessToken);
    const outsider = kernel.authenticateAccessToken(stranger.accessToken);
    const workspace = kernel.createWorkspace(actor, {
      name: "Independent context audit",
      slug: "independent-context-audit",
      idempotencyKey: "workspace",
    });
    const head = (roomId: string) =>
      kernel.sync(actor, { roomId, consumerId: "independent-audit" })
        .latestRoomSeq;
    const room = kernel.createWorkspaceRoom(actor, {
      kind: "channel",
      name: "Design",
      slug: "design",
      workspaceId: workspace.workspace.workspaceId,
      basedOnControlRoomSeq: head(workspace.controlRoom.roomId),
      idempotencyKey: "channel",
    }).room;
    const posted = kernel.postRoomMessage(actor, {
      roomId: room.roomId,
      body: "Thread root",
      basedOnRoomSeq: head(room.roomId),
      idempotencyKey: "root",
    });
    const rootMessageId = posted.event.aggregateId;
    assert.equal(
      kernel.getMessageContext(actor, {
        roomId: room.roomId,
        messageId: rootMessageId,
      }).rootMessageId,
      undefined,
    );
    const thread = kernel.createThread(actor, {
      roomId: room.roomId,
      rootMessageId,
      recipientIds: [],
      basedOnRoomSeq: head(room.roomId),
      idempotencyKey: "thread",
    });
    const reply = kernel.replyThread(actor, {
      roomId: room.roomId,
      threadId: thread.thread.threadId,
      body: "Thread reply",
      recipientIds: [],
      basedOnRoomSeq: head(room.roomId),
      idempotencyKey: "reply",
    });
    for (const messageId of [rootMessageId, reply.event.aggregateId]) {
      const context = kernel.getMessageContext(actor, {
        roomId: room.roomId,
        messageId: messageId.slice(0, 12),
      });
      assert.equal(context.message.messageId, messageId);
      assert.equal(context.rootMessageId, rootMessageId);
      assert.equal(context.rootMessage?.messageId, rootMessageId);
      assert.throws(() =>
        kernel.getMessageContext(outsider, {
          roomId: room.roomId,
          messageId: messageId.slice(0, 12),
        }),
      );
      assert.throws(() =>
        kernel.getMessageContext(actor, {
          roomId: workspace.controlRoom.roomId,
          messageId,
        }),
      );
    }
    assert.throws(() =>
      kernel.getMessageContext(actor, {
        roomId: room.roomId,
        messageId: "msg_",
      }),
    );
  } finally {
    kernel.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
