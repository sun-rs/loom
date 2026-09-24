import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RoomKernel } from "../src/index.ts";
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "rah-comments-")),
    path = join(dir, "db");
  const kernel = new RoomKernel({ databasePath: path });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ kind: "human", handle: "human" }),
    outsider = kernel.provisionPrincipal({ kind: "human", handle: "outsider" });
  const actor = kernel.authenticateAccessToken(human.accessToken),
    other = kernel.authenticateAccessToken(outsider.accessToken);
  const room = kernel.createRoom(actor, { name: "Comments", slug: "comments" });
  const posted = kernel.postMessage(actor, {
    roomId: room.roomId,
    body: "File",
    recipients: [],
    idempotencyKey: "parent",
  });
  const db = new DatabaseSync(path),
    parent = posted.event.aggregateId;
  // Published attachment metadata fixture: bytes are irrelevant to this read/write metadata contract.
  db.prepare(
    "INSERT INTO room_files(attachment_id,room_id,actor_id,request_key,filename,mime_type,size,state,expires_at,message_id,created_at) VALUES(?,?,?,?,?,?,?,'consumed',?,?,?)",
  ).run(
    "file",
    room.roomId,
    human.principal.principalId,
    "upload",
    "file.txt",
    "text/plain",
    1,
    "2099-01-01T00:00:00Z",
    parent,
    new Date().toISOString(),
  );
  const latest = () =>
    Number(
      db
        .prepare("SELECT next_seq-1 AS seq FROM rooms WHERE room_id=?")
        .get(room.roomId)!.seq,
    );
  return {
    path,
    token: human.accessToken,
    kernel,
    db,
    actor,
    other,
    room,
    parent,
    latest,
    close(alreadyClosed = false) {
      db.close();
      if (!alreadyClosed) kernel.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("attachment comments persist canonical Thread messages and exact anchors; replay does not duplicate; unauthorized reads fail", () => {
  const f = fixture();
  try {
    const input = {
      attachmentId: "file",
      body: "check line",
      anchor: { type: "lines", data: { start: 2, end: 3, quote: "original" } },
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "comment",
    };
    const result = f.kernel.attachmentComments.post(f.actor, input);
    assert.equal(result.event.type, "message.posted");
    const listed = f.kernel.attachmentComments.list(f.actor, {
      attachmentId: "file",
      limit: 10,
    });
    assert.equal(listed.roomId, f.room.roomId);
    assert.equal(listed.messageId, f.parent);
    assert.ok(listed.threadId);
    assert.equal(listed.comments.length, 1);
    assert.equal(listed.comments[0]!.content, "check line");
    assert.deepEqual(
      f.kernel.listMessages(f.actor, {
        roomId: f.room.roomId,
        threadId: listed.threadId,
      }).messages[0]?.attachmentComment,
      { attachmentId: "file", filename: "file.txt" },
    );
    assert.deepEqual(listed.comments[0]!.anchor, input.anchor);
    assert.equal(
      f.db
        .prepare("SELECT root_message_id FROM threads WHERE thread_id=?")
        .get(listed.threadId)!.root_message_id,
      f.parent,
    );
    assert.equal(
      f.kernel.attachmentComments.post(f.actor, input).event.eventId,
      result.event.eventId,
    );
    assert.throws(
      () =>
        f.kernel.attachmentComments.post(f.actor, {
          ...input,
          anchor: { type: "lines", data: { start: 4 } },
        }),
      /idempotency/i,
    );
    assert.throws(
      () => f.kernel.attachmentComments.list(f.other, { attachmentId: "file" }),
      /member|unavailable|forbidden/i,
    );
    assert.equal(
      f.db
        .prepare("SELECT COUNT(*) AS n FROM messages WHERE thread_id=?")
        .get(listed.threadId)!.n,
      1,
    );
  } finally {
    f.close();
  }
});
test("comment mutation rolls back atomically and unbound files cannot receive comments", () => {
  const f = fixture();
  try {
    f.db.exec(
      "CREATE TRIGGER reject_comment BEFORE INSERT ON attachment_comment_links BEGIN SELECT RAISE(ABORT,'injected comment failure'); END",
    );
    const seq = f.latest();
    assert.throws(
      () =>
        f.kernel.attachmentComments.post(f.actor, {
          attachmentId: "file",
          body: "check",
          basedOnRoomSeq: seq,
          idempotencyKey: "fail",
        }),
      /injected/,
    );
    assert.equal(f.latest(), seq);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM threads").get()!.n, 0);
    f.db.exec("DROP TRIGGER reject_comment");
    f.db.exec(
      "UPDATE room_files SET message_id=NULL,state='completed' WHERE attachment_id='file'",
    );
    assert.throws(
      () => f.kernel.attachmentComments.list(f.actor, { attachmentId: "file" }),
      /published|unavailable/i,
    );
  } finally {
    f.close();
  }
});
test("comments paginate without duplication and reject archived writes or stale context", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 3; i++)
      f.kernel.attachmentComments.post(f.actor, {
        attachmentId: "file",
        body: `comment ${i}`,
        basedOnRoomSeq: f.latest(),
        idempotencyKey: `c${i}`,
      });
    const first = f.kernel.attachmentComments.list(f.actor, {
      attachmentId: "file",
      limit: 2,
    });
    assert.equal(first.comments.length, 2);
    assert.ok(first.nextBeforeRoomSeq);
    const second = f.kernel.attachmentComments.list(f.actor, {
      attachmentId: "file",
      limit: 2,
      beforeRoomSeq: first.nextBeforeRoomSeq,
    });
    assert.equal(second.comments.length, 1);
    assert.equal(
      new Set([...first.comments, ...second.comments].map((x) => x.id)).size,
      3,
    );
    f.db
      .prepare("UPDATE rooms SET archived_at=? WHERE room_id=?")
      .run(new Date().toISOString(), f.room.roomId);
    assert.equal(
      f.kernel.attachmentComments.list(f.actor, { attachmentId: "file" }).viewer
        .canComment,
      false,
    );
    assert.throws(
      () =>
        f.kernel.attachmentComments.post(f.actor, {
          attachmentId: "file",
          body: "blocked",
          basedOnRoomSeq: f.latest(),
          idempotencyKey: "archived",
        }),
      /archived/i,
    );
  } finally {
    f.close();
  }
});
test("comment retry normalizes self recipients exactly like canonical Thread replies", () => {
  const f = fixture();
  try {
    const principal = f.kernel.getAuthenticatedPrincipal(f.actor);
    const input = {
      attachmentId: "file",
      body: "self mention",
      recipientIds: [principal.principalId],
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "self",
    };
    const posted = f.kernel.attachmentComments.post(f.actor, input);
    assert.equal(
      f.kernel.attachmentComments.post(f.actor, input).event.eventId,
      posted.event.eventId,
    );
  } finally {
    f.close();
  }
});

test("comments survive a fresh Kernel owner and schema 55 migration preserves Room facts", () => {
  const f = fixture();
  try {
    const result = f.kernel.attachmentComments.post(f.actor, {
      attachmentId: "file",
      body: "durable",
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "durable",
    });
    f.db.exec("UPDATE messages SET attachment_comment_json=NULL"); // Simulate historical rows before adoption.
    const reopened = new RoomKernel({ databasePath: f.path });
    try {
      reopened.initialize();
      const actor = reopened.authenticateAccessToken(f.token);
      assert.equal(
        reopened.attachmentComments.list(actor, { attachmentId: "file" })
          .comments[0]!.id,
        result.event.aggregateId,
      );
      assert.deepEqual(
        reopened
          .listMessages(actor, { roomId: f.room.roomId })
          .messages.find((m) => m.messageId === result.event.aggregateId)
          ?.attachmentComment,
        { attachmentId: "file", filename: "file.txt" },
      );
      assert.equal(f.db.prepare("PRAGMA user_version").get()!.user_version, 62);
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});

test("independent: bounded comment pages retain every large row and exact metadata", () => {
  const f = fixture();
  try {
    const ids = [];
    for (let i = 0; i < 20; i++)
      ids.push(
        f.kernel.attachmentComments.post(f.actor, {
          attachmentId: "file",
          body: String(i) + "\u0000".repeat(9000),
          anchor: { type: "lines", data: { quote: "界".repeat(12000) } },
          basedOnRoomSeq: f.latest(),
          idempotencyKey: "large-" + i,
        }).event.aggregateId,
      );
    const found = [];
    let cursor;
    let pages = 0;
    do {
      const p = f.kernel.attachmentComments.list(f.actor, {
        attachmentId: "file",
        limit: 100,
        ...(cursor ? { beforeRoomSeq: cursor } : {}),
      });
      assert.ok(Buffer.byteLength(JSON.stringify(p)) < 512 * 1024);
      found.push(...p.comments.map((c) => c.id));
      cursor = p.nextBeforeRoomSeq;
      pages++;
      assert.ok(pages < 20);
    } while (cursor);
    assert.ok(pages > 1);
    assert.deepEqual([...found].sort(), ids.sort());
    assert.equal(new Set(found).size, ids.length);
  } finally {
    f.close();
  }
});

test("independent: comments on attachments in an existing Thread must not create nested Threads", () => {
  const f = fixture();
  try {
    const thread = f.kernel.createThread(f.actor, {
      roomId: f.room.roomId,
      rootMessageId: f.parent,
      recipientIds: [],
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "existing-thread",
    });
    const reply = f.kernel.replyThread(f.actor, {
      roomId: f.room.roomId,
      threadId: thread.thread.threadId,
      body: "a reply with attachment",
      recipientIds: [],
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "reply",
    });
    f.db
      .prepare("UPDATE room_files SET message_id=? WHERE attachment_id='file'")
      .run(reply.event.aggregateId);
    f.kernel.attachmentComments.post(f.actor, {
      attachmentId: "file",
      body: "comment on Thread attachment",
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "thread-file-comment",
    });
    const nested = f.db
      .prepare(
        "SELECT t.thread_id,m.thread_id AS parent_thread_id FROM threads t JOIN messages m ON m.message_id=t.root_message_id WHERE m.thread_id IS NOT NULL",
      )
      .all();
    assert.equal(nested.length, 0, JSON.stringify(nested));
    const located = f.kernel.attachmentComments.list(f.actor, {
      attachmentId: "file",
    });
    assert.equal(located.messageId, reply.event.aggregateId);
    assert.equal(located.threadRootMessageId, f.parent);
    assert.equal(located.threadId, thread.thread.threadId);
  } finally {
    f.close();
  }
});

test("independent: accepted comment body roundtrips including a JSON-legal embedded NUL", () => {
  const f = fixture();
  try {
    const body = "first\u0000second";
    const posted = f.kernel.attachmentComments.post(f.actor, {
      attachmentId: "file",
      body,
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "nul-comment",
    });
    assert.equal(posted.event.payload.body, body);
    const result = f.kernel.attachmentComments.list(f.actor, {
      attachmentId: "file",
    });
    assert.equal(result.comments[0]!.content, body);
  } finally {
    f.close();
  }
});

test("first file comment reaches its participating Agent author without waking unrelated Agents", () => {
  const f = fixture();
  try {
    const author = f.kernel.provisionPrincipal({
      kind: "agent",
      handle: "author",
    });
    const other = f.kernel.provisionPrincipal({
      kind: "agent",
      handle: "bystander",
    });
    for (const agent of [author, other])
      f.kernel.addMember(f.actor, {
        roomId: f.room.roomId,
        principalId: agent.principal.principalId,
      });
    f.db
      .prepare("UPDATE room_files SET actor_id=? WHERE attachment_id='file'")
      .run(author.principal.principalId);
    const first = f.kernel.attachmentComments.post(f.actor, {
      attachmentId: "file",
      body: "Question on your file",
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "author-comment",
    });
    assert.deepEqual(first.event.payload.recipientIds, [
      author.principal.principalId,
    ]);
    const thread = String(first.event.payload.threadId);
    f.db
      .prepare(
        "UPDATE agent_thread_follows SET following=0,source='explicit_unfollow' WHERE thread_id=?",
      )
      .run(thread);
    const second = f.kernel.attachmentComments.post(f.actor, {
      attachmentId: "file",
      body: "Another question",
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "author-unfollow",
    });
    assert.deepEqual(second.event.payload.recipientIds, []);
  } finally {
    f.close();
  }
});

test("file cards expose durable per-attachment counts, excluding ordinary and other-file replies", () => {
  const f = fixture();
  let closed = false;
  try {
    const attachment = (attachmentId: string) => ({
      attachmentId,
      filename: `${attachmentId}.txt`,
      mimeType: "text/plain",
      size: 1,
      sha256: "a".repeat(64),
    });
    f.db
      .prepare("UPDATE messages SET attachments_json=? WHERE message_id=?")
      .run(
        JSON.stringify([attachment("file"), attachment("second")]),
        f.parent,
      );
    // Reuse the full current schema without assuming its column order.
    f.db
      .prepare(
        "INSERT INTO room_files(attachment_id,room_id,actor_id,request_key,filename,mime_type,size,state,expires_at,message_id,created_at) SELECT 'second',room_id,actor_id,'second-upload','second.txt',mime_type,size,state,expires_at,message_id,created_at FROM room_files WHERE attachment_id='file'",
      )
      .run();
    const input = {
      attachmentId: "file",
      body: "first comment",
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "count-first",
    };
    f.kernel.attachmentComments.post(f.actor, input);
    f.kernel.attachmentComments.post(f.actor, input);
    f.kernel.attachmentComments.post(f.actor, {
      attachmentId: "second",
      body: "other file",
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "count-second",
    });
    const threadId = f.kernel.attachmentComments.list(f.actor, {
      attachmentId: "file",
    }).threadId!;
    f.kernel.replyThread(f.actor, {
      roomId: f.room.roomId,
      threadId,
      body: "ordinary reply",
      recipientIds: [],
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "ordinary",
    });
    const read = () =>
      f.kernel
        .listMessages(f.actor, { roomId: f.room.roomId })
        .messages.find((m) => m.messageId === f.parent)!
        .attachments!.map((a) => a.commentCount);
    assert.deepEqual(read(), [1, 1]);
    assert.deepEqual(
      f.kernel.messageSocial.list(f.actor, {
        roomId: f.room.roomId,
        messageIds: [f.parent],
      }).items[0]?.attachmentCommentCounts,
      { file: 1, second: 1 },
    );
    f.kernel.attachmentComments.post(f.actor, {
      attachmentId: "file",
      body: "next comment",
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "count-next",
    });
    assert.deepEqual(read(), [2, 1]);
    for (let i = 0; i < 50; i++)
      f.kernel.attachmentComments.post(f.actor, {
        attachmentId: "file",
        body: `page ${i}`,
        basedOnRoomSeq: f.latest(),
        idempotencyKey: `page-${i}`,
      });
    assert.equal(
      f.kernel.attachmentComments.list(f.actor, {
        attachmentId: "file",
        limit: 10,
      }).comments.length,
      10,
    );
    assert.deepEqual(read(), [52, 1]);
    assert.throws(
      () => f.kernel.listMessages(f.other, { roomId: f.room.roomId }),
      /member|forbidden/i,
    );
    f.db
      .prepare("UPDATE messages SET attachments_json=? WHERE message_id=?")
      .run(
        JSON.stringify([attachment("file"), attachment("second")]),
        f.parent,
      );
    f.kernel.close();
    closed = true;
    const reopened = new RoomKernel({ databasePath: f.path });
    reopened.initialize();
    try {
      assert.deepEqual(
        reopened
          .listMessages(reopened.authenticateAccessToken(f.token), {
            roomId: f.room.roomId,
          })
          .messages.find((m) => m.messageId === f.parent)!
          .attachments!.map((a) => a.commentCount),
        [52, 1],
      );
    } finally {
      reopened.close();
    }
  } finally {
    f.close(closed);
  }
});
