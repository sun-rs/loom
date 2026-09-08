import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RoomKernel, createHumanApplicationPort } from "../src/index.ts";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-task-delete-")),
    path = join(directory, "db");
  const kernel = new RoomKernel({ databasePath: path });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ kind: "human", handle: "owner" }),
    peer = kernel.provisionPrincipal({ kind: "human", handle: "peer" }),
    agent = kernel.provisionPrincipal({ kind: "agent", handle: "worker" });
  const actor = kernel.authenticateAccessToken(human.accessToken),
    editor = kernel.authenticateAccessToken(peer.accessToken),
    room = kernel.createRoom(actor, { name: "Delete", slug: "delete" });
  for (const member of [peer, agent])
    kernel.addMember(actor, {
      roomId: room.roomId,
      principalId: member.principal.principalId,
    });
  const db = new DatabaseSync(path),
    port = createHumanApplicationPort(kernel);
  const latest = () =>
    Number(
      db
        .prepare("SELECT next_seq-1 n FROM rooms WHERE room_id=?")
        .get(room.roomId)!.n,
    );
  const create = (key: string, extra = {}) =>
    kernel.createTask(actor, {
      roomId: room.roomId,
      title: key,
      idempotencyKey: key,
      ...extra,
    });
  return {
    kernel,
    db,
    port,
    actor,
    editor,
    agent,
    room,
    latest,
    create,
    path,
    human,
    close() {
      db.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("Task delete removes only metadata and task-private rows, preserves conversation and permanent audit, and replays after reopen", () => {
  const f = fixture();
  try {
    const task = f.create("original");
    const reply = f.kernel.replyThread(f.actor, {
      roomId: f.room.roomId,
      threadId: task.task.threadId,
      body: "Preserved discussion",
      idempotencyKey: "reply",
      recipientIds: [],
      basedOnRoomSeq: f.latest(),
    });
    const before = f.db
      .prepare("SELECT * FROM messages ORDER BY message_id")
      .all();
    const command = {
      roomId: f.room.roomId,
      taskId: task.task.taskId,
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "delete",
    };
    const receipt = f.port.deleteTask(f.actor, command);
    assert.equal(receipt.deleted, true);
    assert.equal(receipt.event.type, "task.deleted");
    assert.equal(receipt.sourceMessageId, task.task.sourceMessageId);
    assert.equal(receipt.threadId, task.task.threadId);
    assert.equal(
      f.kernel.listTasks(f.actor, { roomId: f.room.roomId }).length,
      0,
    );
    assert.deepEqual(
      f.db.prepare("SELECT * FROM messages ORDER BY message_id").all(),
      before,
    );
    assert.ok(
      f.db
        .prepare("SELECT 1 FROM threads WHERE thread_id=?")
        .get(task.task.threadId),
    );
    assert.ok(
      f.db
        .prepare("SELECT 1 FROM messages WHERE message_id=?")
        .get(reply.event.aggregateId),
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT COUNT(*) n FROM room_events WHERE aggregate_id=? AND type IN ('task.created','task.deleted')",
        )
        .get(task.task.taskId)!.n,
      2,
    );
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(
      f.port.deleteTask(f.actor, command).event.eventId,
      receipt.event.eventId,
    );
    const reopened = new RoomKernel({ databasePath: f.path });
    reopened.initialize();
    try {
      assert.equal(
        createHumanApplicationPort(reopened).deleteTask(
          reopened.authenticateAccessToken(f.human.accessToken),
          command,
        ).event.eventId,
        receipt.event.eventId,
      );
    } finally {
      reopened.close();
    }
    assert.throws(
      () => f.port.deleteTask(f.actor, { ...command, taskId: "other" }),
      /idempotency/,
    );
  } finally {
    f.close();
  }
});

test("Task numbers remain monotonic after deleting the maximum Task and every Task", () => {
  const f = fixture();
  try {
    const a = f.create("a"),
      b = f.create("b");
    f.port.deleteTask(f.actor, {
      roomId: f.room.roomId,
      taskId: b.task.taskId,
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "delete-b",
    });
    const c = f.create("c");
    assert.equal(c.task.taskNumber, 3);
    for (const t of [a, c])
      f.port.deleteTask(f.actor, {
        roomId: f.room.roomId,
        taskId: t.task.taskId,
        basedOnRoomSeq: f.latest(),
        idempotencyKey: `delete-${t.task.taskId}`,
      });
    assert.equal(f.create("d").task.taskNumber, 4);
  } finally {
    f.close();
  }
});

test("Deletion checks current management/membership, Room binding, stale facts, archive state and dependent Tasks before mutation", () => {
  const f = fixture();
  try {
    const task = f.create("protected"),
      base = {
        roomId: f.room.roomId,
        taskId: task.task.taskId,
        basedOnRoomSeq: f.latest(),
        idempotencyKey: "delete",
      };
    assert.throws(() => f.port.deleteTask(f.editor, base), /owner|admin/);
    const other = f.kernel.createRoom(f.actor, {
      name: "Other",
      slug: "other",
    });
    assert.throws(
      () => f.port.deleteTask(f.actor, { ...base, roomId: other.roomId }),
      /Room|room/,
    );
    f.kernel.postMessage(f.actor, {
      roomId: f.room.roomId,
      body: "New facts",
      idempotencyKey: "new",
      recipients: [],
    });
    assert.throws(() => f.port.deleteTask(f.actor, base), /stale/i);
    const dependent = f.create("dependent", {
      dependencyTaskIds: [task.task.taskId],
    });
    assert.throws(
      () => f.port.deleteTask(f.actor, { ...base, basedOnRoomSeq: f.latest() }),
      /depend/,
    );
    f.port.deleteTask(f.actor, {
      ...base,
      taskId: dependent.task.taskId,
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "delete-dependent",
    });
    const count = f.db.prepare("SELECT COUNT(*) n FROM room_events").get()!.n;
    f.db
      .prepare("UPDATE rooms SET archived_at=? WHERE room_id=?")
      .run(new Date().toISOString(), f.room.roomId);
    assert.throws(
      () => f.port.deleteTask(f.actor, { ...base, basedOnRoomSeq: f.latest() }),
      /archived/,
    );
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM room_events").get()!.n,
      count,
    );
    assert.ok(
      f.db.prepare("SELECT 1 FROM tasks WHERE task_id=?").get(task.task.taskId),
    );
  } finally {
    f.close();
  }
});

test("Deleted Tasks do not rebuild legacy queued obligations during restart", () => {
  const f = fixture();
  try {
    const task = f.create("reopened", {
      assigneeId: f.agent.principal.principalId,
    });
    f.kernel.cancelTask(f.actor, {
      taskId: task.task.taskId,
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "cancel",
      reason: "obsolete",
    });
    f.kernel.reopenTask(f.actor, {
      taskId: task.task.taskId,
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "reopen",
    });
    assert.ok(
      f.db
        .prepare("SELECT 1 FROM activation_obligations WHERE task_id=?")
        .get(task.task.taskId),
    );
    f.port.deleteTask(f.actor, {
      roomId: f.room.roomId,
      taskId: task.task.taskId,
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "delete-reopened",
    });
    const reopened = new RoomKernel({ databasePath: f.path });
    try {
      reopened.initialize();
      assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});

test("Task deletion attention targets only current Agent members, never a Human creator or departed assignee", () => {
  const f = fixture();
  try {
    const task = f.kernel.createTask(f.editor, {
      roomId: f.room.roomId,
      title: "Peer-owned",
      assigneeId: f.agent.principal.principalId,
      idempotencyKey: "peer-task",
    });
    f.db
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(f.room.roomId, f.agent.principal.principalId);
    const receipt = f.port.deleteTask(f.actor, {
      roomId: f.room.roomId,
      taskId: task.task.taskId,
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "delete-peer",
    });
    assert.deepEqual(
      f.db
        .prepare("SELECT participant_id FROM inbox_items WHERE event_id=?")
        .all(receipt.event.eventId),
      [],
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT COUNT(*) n FROM activations a JOIN principals p ON a.participant_id=p.principal_id WHERE p.kind='human'",
        )
        .get()!.n,
      0,
    );
  } finally {
    f.close();
  }
});
