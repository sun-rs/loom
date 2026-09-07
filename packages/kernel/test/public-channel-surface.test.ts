import assert from "node:assert/strict";
import test from "node:test";
import { publicChannelFixture } from "./public-channel-fixture.ts";

test("public preview carries canonical authors, bounded Task and Thread identities without delivery", () => {
  const f = publicChannelFixture();
  try {
    const { owner, reader } = f.people,
      roomId = f.publicRoom.roomId,
      workspaceId = f.workspace.workspace.workspaceId;
    f.kernel.updateAuthenticatedPrincipal(owner!.actor, {
      displayName: "Visible owner",
      avatarKey: null,
    });
    const task = f.kernel.createTask(owner!.actor, {
      roomId,
      title: "Public task",
      basedOnRoomSeq: f.seq(roomId),
      idempotencyKey: "task",
    }).task;
    const preview = f.port.previewChannel(reader!.actor, {
      workspaceId,
      roomId,
      view: "tasks",
      limit: 1,
    });
    assert.equal(preview.tasks?.[0]?.taskId, task.taskId);
    const chat = f.port.previewChannel(reader!.actor, { workspaceId, roomId });
    assert.equal(chat.tasks?.[0]?.taskId, task.taskId);
    assert.equal(
      chat.authors.find((p) => p.principalId === owner!.principal.principalId)
        ?.displayName,
      "Visible owner",
    );
    assert.equal(
      chat.threads.find((t) => t.rootMessageId === task.sourceMessageId)
        ?.threadId,
      task.threadId,
    );
    assert.throws(
      () =>
        f.kernel.sync(reader!.actor, {
          roomId,
          consumerId: "denied",
          bootstrap: "latest",
        }),
      /member/,
    );
  } finally {
    f.close();
  }
});

test("public bookmarks remain private and readable after leave, but never authorize reaction or revoked content", () => {
  const f = publicChannelFixture();
  try {
    const { owner, reader, outsider } = f.people,
      roomId = f.publicRoom.roomId,
      workspaceId = f.workspace.workspace.workspaceId;
    const messageId = f.kernel.postRoomMessage(owner!.actor, {
      roomId,
      body: "Public bookmark",
      basedOnRoomSeq: f.seq(roomId),
      idempotencyKey: "message",
    }).event.aggregateId;
    const input = { roomId, messageId, saved: true, idempotencyKey: "save" };
    const before = f.seq(roomId);
    assert.equal(f.port.saveMessage(reader!.actor, input).saved, true);
    assert.equal(f.port.saveMessage(reader!.actor, input).saved, true);
    assert.equal(f.seq(roomId), before);
    assert.equal(
      f.port.listMessageSocial(reader!.actor, {
        roomId,
        messageIds: [messageId],
      }).items[0]?.canReact,
      false,
    );
    assert.equal(
      f.port.listMessageSocial(owner!.actor, {
        roomId,
        messageIds: [messageId],
      }).items[0]?.saved,
      false,
    );
    assert.equal(
      f.port.listSavedMessages(reader!.actor, { workspaceId }).items.length,
      1,
    );
    assert.throws(
      () =>
        f.port.reactMessage(reader!.actor, {
          roomId,
          messageId,
          emoji: "👍",
          active: true,
          basedOnRoomSeq: before,
          idempotencyKey: "react",
        }),
      /member/,
    );
    assert.throws(
      () => f.port.saveMessage(outsider!.actor, input),
      /unavailable|member/,
    );
    f.kernel.updateWorkspaceRoom(owner!.actor, {
      roomId,
      name: "open",
      visibility: "private",
      basedOnRoomSeq: f.seq(roomId),
      idempotencyKey: "private",
    });
    assert.equal(
      f.port.listSavedMessages(reader!.actor, { workspaceId }).items.length,
      0,
    );
    assert.throws(
      () => f.port.saveMessage(reader!.actor, input),
      /unavailable|member/,
    );
  } finally {
    f.close();
  }
});

test("opening an unanswered public message is read-only and returns only that root", () => {
  const f = publicChannelFixture();
  try {
    const { owner, reader } = f.people,
      roomId = f.publicRoom.roomId;
    const messageId = f.kernel.postRoomMessage(owner!.actor, {
      roomId,
      body: "Unanswered",
      basedOnRoomSeq: f.seq(roomId),
      idempotencyKey: "unanswered",
    }).event.aggregateId;
    const before = f.seq(roomId);
    const preview = f.port.previewChannel(reader!.actor, {
      workspaceId: f.workspace.workspace.workspaceId,
      roomId,
      rootMessageId: messageId,
    });
    assert.deepEqual(
      preview.messages.map((m) => m.messageId),
      [messageId],
    );
    assert.equal(preview.threadId, undefined);
    assert.equal(f.seq(roomId), before);
    assert.equal(
      f.db
        .prepare("SELECT count(*) AS n FROM threads WHERE root_message_id=?")
        .get(messageId)!.n,
      0,
    );
  } finally {
    f.close();
  }
});
