import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "rah-room-files-"));
  let now = new Date();
  const kernel = new RoomKernel({
    databasePath: join(dir, "test.db"),
    now: () => now,
  });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const other = kernel.provisionPrincipal({ handle: "other", kind: "human" });
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const outsider = kernel.authenticateAccessToken(other.accessToken);
  const ws = kernel.createWorkspace(actor, {
    name: "Files",
    slug: "files",
    idempotencyKey: "workspace",
  });
  const roomId = kernel.createWorkspaceRoom(actor, {
    kind: "channel",
    name: "Design",
    slug: "design",
    workspaceId: ws.workspace.workspaceId,
    basedOnControlRoomSeq: kernel.sync(actor, {
      roomId: ws.controlRoom.roomId,
      consumerId: "test",
    }).latestRoomSeq,
    idempotencyKey: "room",
  }).room.roomId;
  const prepare = (key = "upload", size = 5) =>
    kernel.files.prepare(actor, {
      roomId,
      filename: "../中文.txt",
      mimeType: "text/plain",
      size,
      idempotencyKey: key,
    });
  const head = () =>
    kernel.sync(actor, { roomId, consumerId: "head" }).latestRoomSeq;
  return {
    dir,
    advanceTime() {
      now = new Date(now.getTime() + 2 * 60 * 60_000);
    },
    kernel,
    actor,
    outsider,
    roomId,
    prepare,
    head,
    close() {
      kernel.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
async function* bytes(value: string) {
  yield Buffer.from(value);
}

test("Files are invisible until an atomic canonical message consumes a verified upload; replay is idempotent", async () => {
  const f = fixture();
  try {
    const upload = f.prepare();
    assert.deepEqual(f.prepare(), upload);
    await f.kernel.files.upload(f.actor, upload.attachmentId, bytes("hello"));
    assert.equal(
      f.kernel.files.list(f.actor, { roomId: f.roomId }).files.length,
      0,
    );
    const input = {
      roomId: f.roomId,
      body: "",
      attachmentIds: [upload.attachmentId],
      basedOnRoomSeq: f.head(),
      idempotencyKey: "send",
    };
    const sent = f.kernel.postRoomMessage(f.actor, input);
    assert.equal(f.kernel.postRoomMessage(f.actor, input).deduplicated, true);
    const files = f.kernel.files.list(f.actor, { roomId: f.roomId }).files;
    assert.equal(files.length, 1);
    assert.equal(files[0]?.messageId, sent.event.aggregateId);
    assert.equal(files[0]?.filename, "../中文.txt");
    const messages = f.kernel.listMessages(f.actor, {
      roomId: f.roomId,
    }).messages;
    assert.equal(
      messages[0]?.attachments?.[0]?.attachmentId,
      upload.attachmentId,
    );
    const download = await f.kernel.files.download(
      f.actor,
      upload.attachmentId,
    );
    const chunks = [];
    for await (const chunk of download.stream) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), "hello");
    assert.throws(
      () =>
        f.kernel.postRoomMessage(f.actor, {
          ...input,
          idempotencyKey: "reuse",
          basedOnRoomSeq: f.head(),
        }),
      /already|consum/i,
    );
    assert.throws(
      () => f.kernel.postRoomMessage(f.actor, { ...input, attachmentIds: [] }),
      /required|empty|another|conflict/i,
    );
  } finally {
    f.close();
  }
});

test("expired staged bytes are reclaimed without deleting sent attachments", async () => {
  const f = fixture();
  try {
    const sent = f.prepare("sent");
    await f.kernel.files.upload(f.actor, sent.attachmentId, bytes("hello"));
    f.kernel.postRoomMessage(f.actor, {
      roomId: f.roomId,
      body: "Keep this sent file",
      attachmentIds: [sent.attachmentId],
      basedOnRoomSeq: f.head(),
      idempotencyKey: "sent-message",
    });
    const staged = f.prepare("expire");
    await f.kernel.files.upload(f.actor, staged.attachmentId, bytes("hello"));
    assert.ok(existsSync(join(f.dir, "room-files", staged.attachmentId)));
    f.advanceTime();
    f.prepare("new-reservation");
    assert.equal(
      existsSync(join(f.dir, "room-files", staged.attachmentId)),
      false,
    );
    assert.equal(
      existsSync(join(f.dir, "room-files", sent.attachmentId)),
      true,
    );
    assert.equal(
      f.kernel.files.list(f.actor, { roomId: f.roomId }).files[0]?.attachmentId,
      sent.attachmentId,
    );
    assert.throws(
      () =>
        f.kernel.postRoomMessage(f.actor, {
          roomId: f.roomId,
          body: "x",
          attachmentIds: [staged.attachmentId],
          basedOnRoomSeq: f.head(),
          idempotencyKey: "expired-message",
        }),
      /completed/,
    );
  } finally {
    f.close();
  }
});

test("an aliased blob directory is rejected rather than writing outside its owner", async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.dir, "elsewhere"));
    symlinkSync(join(f.dir, "elsewhere"), join(f.dir, "room-files"));
    const upload = f.prepare("symlink");
    await assert.rejects(
      f.kernel.files.upload(f.actor, upload.attachmentId, bytes("hello")),
      /directory|symlink|alias/,
    );
  } finally {
    f.close();
  }
});

test("file list keyset pagination and message context retain attachments after disk reopen", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 3; i++) {
      const upload = f.prepare(`page-${i}`);
      await f.kernel.files.upload(f.actor, upload.attachmentId, bytes("hello"));
      f.kernel.postRoomMessage(f.actor, {
        roomId: f.roomId,
        body: `file ${i}`,
        attachmentIds: [upload.attachmentId],
        basedOnRoomSeq: f.head(),
        idempotencyKey: `message-${i}`,
      });
    }
    const first = f.kernel.files.list(f.actor, { roomId: f.roomId, limit: 1 });
    assert.equal(first.files.length, 1);
    assert.ok(first.nextCursor);
    const second = f.kernel.files.list(f.actor, {
      roomId: f.roomId,
      limit: 1,
      cursor: first.nextCursor,
    });
    assert.notEqual(
      second.files[0]?.attachmentId,
      first.files[0]?.attachmentId,
    );
    assert.equal(
      f.kernel.getMessageContext(f.actor, {
        messageId: first.files[0]!.messageId,
      }).message.attachments?.length,
      1,
    );
    const other = new RoomKernel({ databasePath: f.kernel.databasePath });
    try {
      other.initialize();
      const restored = other.files.list(f.actor, { roomId: f.roomId });
      assert.equal(restored.files.length, 3);
    } finally {
      other.close();
    }
  } finally {
    f.close();
  }
});

test("cancel during async upload cannot publish a blob or make a message attachment", async () => {
  const f = fixture();
  try {
    const prepared = f.prepare("race");
    async function* interrupted() {
      yield Buffer.from("he");
      f.kernel.files.cancel(f.actor, { attachmentId: prepared.attachmentId });
      yield Buffer.from("llo");
    }
    await assert.rejects(
      f.kernel.files.upload(f.actor, prepared.attachmentId, interrupted()),
      /cancel|expired/,
    );
    assert.throws(
      () =>
        f.kernel.postRoomMessage(f.actor, {
          roomId: f.roomId,
          body: "x",
          attachmentIds: [prepared.attachmentId],
          basedOnRoomSeq: f.head(),
          idempotencyKey: "race-message",
        }),
      /completed/,
    );
  } finally {
    f.close();
  }
});

test("wrong length, canceled uploads, missing upload, and unauthorized reads fail closed", async () => {
  const f = fixture();
  try {
    const failed = f.prepare("short");
    await assert.rejects(
      f.kernel.files.upload(f.actor, failed.attachmentId, bytes("no")),
      /size|length/i,
    );
    const canceled = f.prepare("cancel");
    f.kernel.files.cancel(f.actor, { attachmentId: canceled.attachmentId });
    await assert.rejects(
      f.kernel.files.upload(f.actor, canceled.attachmentId, bytes("hello")),
      /pending|cancel/i,
    );
    assert.throws(
      () =>
        f.kernel.files.prepare(f.outsider, {
          roomId: f.roomId,
          filename: "x",
          mimeType: "text/plain",
          size: 1,
          idempotencyKey: "bad",
        }),
      /member|access|forbidden/i,
    );
    assert.throws(
      () => f.kernel.files.list(f.outsider, { roomId: f.roomId }),
      /member|access|forbidden/i,
    );
    await assert.rejects(
      f.kernel.files.download(f.outsider, failed.attachmentId),
      /member|access|forbidden/i,
    );
    assert.throws(
      () =>
        f.kernel.postRoomMessage(f.actor, {
          roomId: f.roomId,
          body: "x",
          attachmentIds: [failed.attachmentId],
          basedOnRoomSeq: f.head(),
          idempotencyKey: "invalid",
        }),
      /completed|ready/i,
    );
    assert.equal(
      f.kernel.listMessages(f.actor, { roomId: f.roomId }).messages.length,
      0,
    );
  } finally {
    f.close();
  }
});
