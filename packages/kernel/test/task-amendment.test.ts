import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RoomKernel } from "../src/index.ts";
import { createHumanApplicationPort } from "../src/human-application-port.ts";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "rah-amend-"));
  const path = join(dir, "db");
  const kernel = new RoomKernel({ databasePath: path });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ kind: "human", handle: "creator" });
  const peer = kernel.provisionPrincipal({ kind: "human", handle: "member" });
  const outsider = kernel.provisionPrincipal({
    kind: "human",
    handle: "outsider",
  });
  const actor = kernel.authenticateAccessToken(human.accessToken),
    editor = kernel.authenticateAccessToken(peer.accessToken);
  const room = kernel.createRoom(actor, { name: "Amend", slug: "amend" });
  kernel.addMember(actor, {
    roomId: room.roomId,
    principalId: peer.principal.principalId,
  });
  const original = kernel.createTask(actor, {
    roomId: room.roomId,
    title: "Original",
    description: "Original criteria",
    dependencyTaskIds: [],
    reviewerIds: [],
    collaboratorIds: [],
    idempotencyKey: "create",
  });
  const db = new DatabaseSync(path),
    port = createHumanApplicationPort(kernel);
  const latest = () =>
    Number(
      db
        .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
        .get(room.roomId)!.n,
    );
  return {
    kernel,
    db,
    port,
    actor,
    editor,
    peer,
    outsider,
    room,
    original,
    latest,
    path,
    close() {
      db.close();
      kernel.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("Task amend allows a current noncreator member, appends exact changes, preserves original message/state and replays exact intent", () => {
  const f = fixture();
  try {
    const before = f.db
      .prepare("SELECT * FROM messages WHERE message_id=?")
      .get(f.original.task.sourceMessageId);
    const input = {
      taskId: f.original.task.taskId,
      title: "  Revised  ",
      description: "  criteria\n ",
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "amend",
    };
    const result = f.port.amendTask(f.editor, input);
    assert.equal(result.task.title, "Revised");
    assert.equal(result.task.description, "  criteria\n ");
    assert.equal(result.task.state, "todo");
    assert.equal(result.event.actorId, f.peer.principal.principalId);
    assert.deepEqual(result.event.payload.changes, {
      title: { from: "Original", to: "Revised" },
      description: { from: "Original criteria", to: "  criteria\n " },
    });
    assert.deepEqual(
      f.db
        .prepare("SELECT * FROM messages WHERE message_id=?")
        .get(f.original.task.sourceMessageId),
      before,
    );
    assert.equal(
      f.port.amendTask(f.editor, input).event.eventId,
      result.event.eventId,
    );
    assert.throws(
      () => f.port.amendTask(f.editor, { ...input, description: null }),
      /idempotency/,
    );
    assert.throws(
      () => f.port.amendTask(f.editor, { ...input, idempotencyKey: "stale" }),
      /stale/i,
    );
    const cleared = f.port.amendTask(f.editor, {
      taskId: input.taskId,
      description: null,
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "clear",
    });
    assert.equal(cleared.task.description, undefined);
    const history = f.port.listTaskHistory(f.actor, {
      roomId: f.room.roomId,
      taskId: input.taskId,
    });
    assert.deepEqual(
      history.events.find((e) => e.eventId === result.event.eventId)!.changes,
      result.event.payload.changes,
    );
    assert.deepEqual(history.events[0]!.changes, {
      description: { from: "  criteria\n ", to: null },
    });
    f.db
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(f.room.roomId, f.peer.principal.principalId);
    assert.throws(() => f.port.amendTask(f.editor, input), /member/);
  } finally {
    f.close();
  }
});

test("Task amendment validation rejects empty patches/invalid title, preserves empty description, rejects outsider, and survives reopen", () => {
  const f = fixture();
  try {
    const base = {
      taskId: f.original.task.taskId,
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "invalid",
    };
    for (const patch of [
      {},
      { title: "  " },
      { title: "a".repeat(10001) },
      { description: "a".repeat(50001) },
      { title: "x", assigneeId: "x" },
    ])
      assert.throws(() => f.port.amendTask(f.editor, { ...base, ...patch }));
    assert.throws(
      () =>
        f.port.amendTask(
          f.kernel.authenticateAccessToken(f.outsider.accessToken),
          { ...base, title: "No" },
        ),
      /member/,
    );
    const changed = f.port.amendTask(f.editor, { ...base, description: "" });
    assert.equal(changed.task.description, "");
    const reopened = new RoomKernel({ databasePath: f.path });
    reopened.initialize();
    try {
      const actor = reopened.authenticateAccessToken(f.outsider.accessToken);
      assert.throws(
        () =>
          reopened.humanTaskHistory.list(actor, {
            roomId: f.room.roomId,
            taskId: base.taskId,
          }),
        /member/,
      );
      assert.equal(
        reopened.getTask(reopened.authenticateAccessToken(f.peer.accessToken), {
          roomId: f.room.roomId,
          taskId: base.taskId,
        }).description,
        "",
      );
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});

test("Task history retains complete legal worst-case amendment strings within a separate bounded page budget", () => {
  const f = fixture();
  try {
    const title = "\u0001".repeat(10000),
      desc = "\u0002".repeat(50000);
    f.port.amendTask(f.editor, {
      taskId: f.original.task.taskId,
      title,
      description: desc,
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "large1",
    });
    const second = f.port.amendTask(f.editor, {
      taskId: f.original.task.taskId,
      title: "\u0003".repeat(10000),
      description: "\u0004".repeat(50000),
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "large2",
    });
    const h = f.port.listTaskHistory(f.editor, {
      roomId: f.room.roomId,
      taskId: f.original.task.taskId,
      limit: 100,
    });
    assert.deepEqual(h.events[0]!.changes, second.event.payload.changes);
    assert.ok(JSON.stringify(h).length < 2 * 1024 * 1024);
  } finally {
    f.close();
  }
});

test("Archived Room amendment rolls back both card and event; history remains exact after closing and reopening Kernel", () => {
  const f = fixture();
  let closed = false;
  try {
    const amended = f.port.amendTask(f.editor, {
      taskId: f.original.task.taskId,
      title: "Persisted",
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "persist",
    });
    const history = f.port.listTaskHistory(f.editor, {
      roomId: f.room.roomId,
      taskId: f.original.task.taskId,
    });
    f.db
      .prepare("UPDATE rooms SET archived_at=? WHERE room_id=?")
      .run(new Date().toISOString(), f.room.roomId);
    const count = f.db.prepare("SELECT COUNT(*) AS n FROM room_events").get()!
      .n;
    assert.throws(
      () =>
        f.port.amendTask(f.editor, {
          taskId: f.original.task.taskId,
          title: "Must rollback",
          basedOnRoomSeq: f.latest(),
          idempotencyKey: "archived",
        }),
      /archived/,
    );
    assert.equal(
      f.db
        .prepare("SELECT title FROM tasks WHERE task_id=?")
        .get(f.original.task.taskId)!.title,
      "Persisted",
    );
    assert.equal(
      f.db.prepare("SELECT COUNT(*) AS n FROM room_events").get()!.n,
      count,
    );
    f.db.close();
    f.kernel.close();
    closed = true;
    const reopened = new RoomKernel({ databasePath: f.path });
    reopened.initialize();
    try {
      const reread = reopened.humanTaskHistory.list(
        reopened.authenticateAccessToken(f.peer.accessToken),
        { roomId: f.room.roomId, taskId: f.original.task.taskId },
      );
      assert.deepEqual(reread, history);
      assert.equal(reread.events[0]!.eventId, amended.event.eventId);
    } finally {
      reopened.close();
    }
  } finally {
    if (!closed) f.close();
    else rmSync(join(f.path, ".."), { recursive: true, force: true });
  }
});
