import assert from "node:assert/strict";
import test from "node:test";
import { publicChannelFixture as fixture } from "./public-channel-fixture.ts";

test("public reading is current Human Workspace access, not participation or delivery", () => {
  const f = fixture();
  try {
    const { owner, reader, outsider, agent } = f.people;
    const roomId = f.publicRoom.roomId,
      workspaceId = f.workspace.workspace.workspaceId;
    const message = f.kernel.postRoomMessage(owner!.actor, {
      roomId,
      body: "public-content",
      basedOnRoomSeq: f.seq(roomId),
      idempotencyKey: "message",
    }).event;
    const counts = () =>
      [
        "memberships",
        "inbox_items",
        "activations",
        "subscription_cursors",
        "room_events",
      ].map((t) => f.db.prepare(`SELECT count(*) AS n FROM ${t}`).get()!.n);
    const before = counts();
    const preview = f.port.previewChannel(reader!.actor, {
      workspaceId,
      roomId,
      limit: 1,
    });
    assert.equal(preview.messages[0]!.messageId, message.aggregateId);
    assert.equal(preview.membership, undefined);
    assert.deepEqual(
      Object.keys(preview).sort(),
      [
        "authors",
        "ceilingSeq",
        "messages",
        "room",
        "roomSeq",
        "threads",
        "tasks",
      ].sort(),
    );
    assert.equal(
      f.kernel.searchWorkspace(reader!.actor, {
        workspaceId,
        query: "public-content",
      }).hits.length,
      1,
    );
    assert.equal(
      f.kernel.getMessageContext(reader!.actor, {
        roomId,
        messageId: message.aggregateId,
      }).message.messageId,
      message.aggregateId,
    );
    assert.equal(
      f.port.resolveNavigationTarget(reader!.actor, {
        target: { kind: "room", roomId },
      }).target.kind,
      "room",
    );
    assert.deepEqual(counts(), before);
    assert.throws(
      () =>
        f.kernel.sync(reader!.actor, {
          roomId,
          consumerId: "not-delivery",
          bootstrap: "latest",
        }),
      /member|unavailable/i,
    );
    assert.throws(
      () =>
        f.kernel.postRoomMessage(reader!.actor, {
          roomId,
          body: "must join",
          basedOnRoomSeq: f.seq(roomId),
          idempotencyKey: "denied",
        }),
      /member|unavailable/i,
    );
    for (const actor of [outsider!.actor, agent!.actor])
      assert.throws(
        () => f.port.previewChannel(actor, { workspaceId, roomId }),
        /Human|member|unavailable|access/i,
      );
    assert.throws(
      () =>
        f.port.previewChannel(reader!.actor, {
          workspaceId,
          roomId: f.privateRoom.roomId,
        }),
      /member|unavailable|access/i,
    );
    f.kernel.updateWorkspaceRoom(owner!.actor, {
      roomId,
      basedOnRoomSeq: f.seq(roomId),
      idempotencyKey: "private",
      name: "open",
      visibility: "private",
    });
    assert.throws(
      () => f.port.previewChannel(reader!.actor, { workspaceId, roomId }),
      /member|unavailable|access/i,
    );
    assert.equal(
      f.kernel.searchWorkspace(reader!.actor, {
        workspaceId,
        query: "public-content",
      }).hits.length,
      0,
    );
    assert.throws(
      () =>
        f.kernel.getMessageContext(reader!.actor, {
          messageId: message.aggregateId,
        }),
      /member|unavailable|access/i,
    );
  } finally {
    f.close();
  }
});

test("preview freezes a bounded message ceiling and rejects cross-Workspace and revoked access", () => {
  const f = fixture();
  try {
    const { owner, reader } = f.people,
      roomId = f.publicRoom.roomId,
      workspaceId = f.workspace.workspace.workspaceId;
    for (let i = 0; i < 4; i++)
      f.kernel.postRoomMessage(owner!.actor, {
        roomId,
        body: `page ${i}`,
        basedOnRoomSeq: f.seq(roomId),
        idempotencyKey: `p${i}`,
      });
    const first = f.port.previewChannel(reader!.actor, {
      workspaceId,
      roomId,
      limit: 2,
    });
    assert.equal(first.messages.length, 2);
    assert.ok(first.nextBeforeSeq);
    f.kernel.postRoomMessage(owner!.actor, {
      roomId,
      body: "later",
      basedOnRoomSeq: f.seq(roomId),
      idempotencyKey: "later",
    });
    const next = f.port.previewChannel(reader!.actor, {
      workspaceId,
      roomId,
      limit: 2,
      beforeSeq: first.nextBeforeSeq!,
      ceilingSeq: first.ceilingSeq,
    });
    assert.equal(next.messages.length, 2);
    assert.equal(next.nextBeforeSeq, undefined);
    assert.deepEqual(
      [...next.messages, ...first.messages].map((m) => m.body),
      ["page 0", "page 1", "page 2", "page 3"],
    );
    assert.throws(() =>
      f.port.previewChannel(reader!.actor, { workspaceId: "wrong", roomId }),
    );
    f.kernel.removeRoomMember(owner!.actor, {
      roomId: f.workspace.controlRoom.roomId,
      principalId: reader!.principal.principalId,
      basedOnRoomSeq: f.seq(f.workspace.controlRoom.roomId),
      idempotencyKey: "revoke",
    });
    assert.throws(
      () =>
        f.port.previewChannel(reader!.actor, {
          workspaceId,
          roomId,
          ceilingSeq: first.ceilingSeq,
          beforeSeq: first.nextBeforeSeq!,
        }),
      /Human|member|unavailable|access/i,
    );
  } finally {
    f.close();
  }
});

test("public attachments are published bytes only and permission revocation reaches download", async () => {
  const f = fixture();
  try {
    const { owner, reader } = f.people,
      roomId = f.publicRoom.roomId;
    const file = f.kernel.files.prepare(owner!.actor, {
      roomId,
      filename: "public.txt",
      mimeType: "text/plain",
      size: 5,
      idempotencyKey: "file",
    });
    async function* bytes() {
      yield Buffer.from("hello");
    }
    await f.kernel.files.upload(owner!.actor, file.attachmentId, bytes());
    await assert.rejects(
      f.kernel.files.download(reader!.actor, file.attachmentId),
    );
    f.kernel.postRoomMessage(owner!.actor, {
      roomId,
      body: "file",
      attachmentIds: [file.attachmentId],
      basedOnRoomSeq: f.seq(roomId),
      idempotencyKey: "publish",
    });
    assert.equal(
      f.kernel.files.list(reader!.actor, { roomId }).files.length,
      1,
    );
    const content = await f.kernel.files.download(
      reader!.actor,
      file.attachmentId,
    );
    const chunks = [];
    for await (const chunk of content.stream) chunks.push(Buffer.from(chunk));
    assert.equal(Buffer.concat(chunks).toString(), "hello");
    f.kernel.updateWorkspaceRoom(owner!.actor, {
      roomId,
      name: "open",
      visibility: "private",
      basedOnRoomSeq: f.seq(roomId),
      idempotencyKey: "revoke-file",
    });
    await assert.rejects(
      f.kernel.files.download(reader!.actor, file.attachmentId),
      /unavailable|member/i,
    );
  } finally {
    f.close();
  }
});
