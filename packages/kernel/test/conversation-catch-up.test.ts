import assert from "node:assert/strict";
import test from "node:test";
import "../src/index.ts";
import {
  roleInstanceFixture,
  startInstanceRunFromQueue,
} from "./role-instance-fixture.ts";

test("unfollowed conversation is excluded from wake and check, but later mention can catch it up", () => {
  const f = roleInstanceFixture();
  try {
    const b = f.kernel.roles.instantiate(f.actor, {
      roleId: f.role.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "b",
    });
    const root = f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "chapter",
      recipients: [{ participantId: b.instance.instanceId, reason: "mention" }],
      idempotencyKey: "root",
    }).event;
    const thread = f.kernel.createThread(f.actor, {
      roomId: f.home.roomId,
      rootMessageId: root.aggregateId,
      recipientIds: [b.instance.instanceId],
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "thread",
    }).thread;
    const reply = f.kernel.replyThread(f.actor, {
      roomId: f.home.roomId,
      threadId: thread.threadId,
      body: "chapter-only detail",
      recipientIds: [b.instance.instanceId],
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "reply",
    }).event;
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) n FROM inbox_items WHERE participant_id=? AND event_seq=?",
        )
        .get(f.instance.instanceId, reply.roomSeq)!.n,
      0,
    );
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "channel question",
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
      idempotencyKey: "wake",
    });
    startInstanceRunFromQueue({ ...f, instance: b.instance }).finish(0);
    const run = startInstanceRunFromQueue(f);
    const first = f.kernel.presentWorkerMessages(run.execution);
    assert.ok(!JSON.stringify(first.events).includes("chapter-only detail"));
    const check = f.kernel.syncWorker(run.execution, {
      replayDelivery: true,
      automatic: true,
    });
    assert.ok(!JSON.stringify(check.events).includes("chapter-only detail"));
    f.kernel.markPresentedDeliverySent(f.host, run.scope);
    const posted = f.kernel.postWorkerMessage(run.execution, {
      body: "done",
      basedOnRoomSeq: run.activation.toSeq,
      idempotencyKey: "done",
    });
    assert.ok("event" in posted);
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) n FROM worker_message_presentations WHERE participant_id=? AND room_seq=?",
        )
        .get(f.instance.instanceId, reply.roomSeq)!.n,
      0,
      "transport ACK is not a read receipt for an excluded chapter",
    );
    assert.equal(
      f.kernel.workerReads.room(run.execution, {
        channel: `#${f.home.slug}:${root.aggregateId.slice(0, 8)}`,
      }).threadId,
      thread.threadId,
      "unfollowed is still addressable",
    );
    run.finish(0);
    f.kernel.replyThread(f.actor, {
      roomId: f.home.roomId,
      threadId: thread.threadId,
      body: `@${f.db.prepare("SELECT handle FROM principals WHERE principal_id=?").get(f.instance.instanceId)!.handle} join this chapter`,
      recipientIds: [f.instance.instanceId],
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "join",
    });
    const next = startInstanceRunFromQueue(f);
    const window = f.kernel.presentWorkerMessages(next.execution);
    assert.ok(
      !JSON.stringify(window.events).includes("channel question"),
      "read channel body is not replayed when a different target is joined",
    );
    assert.ok(
      JSON.stringify(window.events).includes("chapter-only detail"),
      "channel cursor must not swallow previously unfollowed thread history",
    );
    f.kernel.unfollowWorkerThread(next.execution, {
      threadId: thread.threadId,
      basedOnRoomSeq: next.activation.toSeq,
      idempotencyKey: "unfollow",
    });
    assert.equal(
      f.kernel.presentWorkerMessages(next.execution).contentDigest,
      window.contentDigest,
    );
  } finally {
    f.close();
  }
});

test("Task membership subscribes to ordinary later discussion, without waking nonparticipants", () => {
  let now = new Date("2026-01-01T00:00:00Z");
  const f = roleInstanceFixture({
    now: () => now,
  });
  try {
    const b = f.kernel.roles.instantiate(f.actor, {
      roleId: f.role.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "b",
    }).instance;
    const task = f.kernel.createTask(f.actor, {
      roomId: f.home.roomId,
      title: "old chapter",
      assigneeId: f.instance.instanceId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "task",
    }).task;
    now = new Date("2026-01-11T00:00:00Z");
    const reply = f.kernel.replyThread(f.actor, {
      roomId: f.home.roomId,
      threadId: task.threadId!,
      body: "continue discussion",
      recipientIds: [],
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "continue",
    }).event;
    const recipients = f.db
      .prepare("SELECT participant_id FROM inbox_items WHERE event_id=?")
      .all(reply.eventId)
      .map((r) => r.participant_id);
    assert.ok(recipients.includes(f.instance.instanceId));
    assert.ok(!recipients.includes(b.instanceId));
  } finally {
    f.close();
  }
});

test("Task follow backfill preserves explicit unfollow and creates no read evidence", async () => {
  const { backfillTaskThreadFollows } =
    await import("../src/task-thread-follow-backfill.ts");
  const f = roleInstanceFixture();
  try {
    const task = f.kernel.createTask(f.actor, {
      roomId: f.home.roomId,
      title: "historical",
      assigneeId: f.instance.instanceId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "task",
    }).task;
    f.db
      .prepare("DELETE FROM agent_thread_follows WHERE thread_id=?")
      .run(task.threadId);
    f.db.exec("PRAGMA user_version=80");
    f.kernel.initialize();
    assert.equal(f.db.prepare("PRAGMA user_version").get()!.user_version, 89);
    assert.equal(
      f.db
        .prepare(
          "SELECT following FROM agent_thread_follows WHERE participant_id=? AND thread_id=?",
        )
        .get(f.instance.instanceId, task.threadId)!.following,
      1,
    );
    f.db
      .prepare(
        "UPDATE agent_thread_follows SET following=0,source='explicit_unfollow' WHERE thread_id=?",
      )
      .run(task.threadId);
    backfillTaskThreadFollows(f.db);
    assert.equal(
      f.db
        .prepare(
          "SELECT following FROM agent_thread_follows WHERE participant_id=? AND thread_id=?",
        )
        .get(f.instance.instanceId, task.threadId)!.following,
      0,
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) n FROM worker_message_presentations WHERE participant_id=?",
        )
        .get(f.instance.instanceId)!.n,
      0,
    );
  } finally {
    f.close();
  }
});
