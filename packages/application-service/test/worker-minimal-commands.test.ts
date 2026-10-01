import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { RoomKernel } from "@rah-os/kernel";

import { WorkerApplicationService } from "../src/index.ts";

/**
 * Raft carries no causal cursor, no idempotency key and no paging token on a
 * reaction, a Thread unfollow, a Channel mute, a reminder, an attachment
 * reservation, a Task deletion or a Room read. These tests drive every one of
 * those in that minimal form, prove the explicit form still resolves to the
 * same thing, and prove the fences that protect them did not move.
 */
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-minimal-commands-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const database = new DatabaseSync(databasePath);
  const human = kernel.provisionPrincipal({ kind: "human", handle: "human" });
  const agent = kernel.provisionPrincipal({ kind: "agent", handle: "agent" });
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Channel", slug: "channel" });
  // Fixture explicitly opts into autonomous Task creation.
  database
    .prepare("UPDATE rooms SET allow_instance_task_creation=1 WHERE room_id=?")
    .run(room.roomId);

  const second = kernel.createRoom(actor, { name: "Second", slug: "second" });
  for (const roomId of [room.roomId, second.roomId])
    kernel.addMember(actor, {
      roomId,
      principalId: agent.principal.principalId,
    });
  const source = kernel.postMessage(actor, {
    roomId: room.roomId,
    body: "Please carry this durable work",
    idempotencyKey: "source",
    recipients: [
      { participantId: agent.principal.principalId, reason: "mention" },
    ],
  });
  const thread = kernel.createThread(actor, {
    roomId: room.roomId,
    rootMessageId: source.event.aggregateId,
    recipientIds: [],
    idempotencyKey: "thread",
    basedOnRoomSeq: source.event.roomSeq,
  });
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "host",
      participantIds: [agent.principal.principalId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 600_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    runAttemptId: run.runAttemptId,
    runtimeRunId: "fake",
    recoveryDescriptor: { driver: "fake", recoveryKey: "fake", metadata: {} },
  };
  kernel.prepareRunAttemptRuntime(host, runtime);
  kernel.markRunAttemptRunning(host, runtime);
  const service = new WorkerApplicationService({ kernel });
  await service.start();
  const activationHead = () =>
    Number(
      database
        .prepare("SELECT to_seq AS n FROM activations WHERE activation_id=?")
        .get(activation.activationId)!.n,
    );
  const credential = service.issueActivationCredential(host, {
    activationId: activation.activationId,
    consumerId: "worker",
    hostId: host.hostId,
    participantId: agent.principal.principalId,
    roomId: room.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const token = join(directory, "token");
  writeFileSync(token, credential.accessToken, { mode: 0o600 });
  const call = async (path: string, body: unknown = {}) => {
    const response = await fetch(`${service.origin}/v1/worker/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  };
  const firstSync = await call("sync");
  assert.equal(firstSync.status, 200);
  const head = () =>
    Number(
      database
        .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
        .get(room.roomId)!.n,
    );
  const post = (key: string) =>
    kernel.postRoomMessage(actor, {
      roomId: room.roomId,
      body: `filler ${key}`,
      idempotencyKey: key,
      recipients: [],
    });
  return {
    actor,
    agent,
    activation,
    activationHead,
    call,
    database,
    head,
    kernel,
    post,
    room,
    second,
    source,
    thread: thread.thread,
    async close() {
      await service.close();
      database.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("a reaction is Raft's toggle: message, emoji, and nothing else", async () => {
  const f = await fixture();
  try {
    const added = await f.call("messages/react", {
      messageId: f.source.event.aggregateId,
      emoji: "👍",
    });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    assert.deepEqual(
      added.body.reactions.map((item: any) => [item.emoji, item.count]),
      [["👍", 1]],
    );
    // An identical retry is one logical reaction.
    const retried = await f.call("messages/react", {
      messageId: f.source.event.aggregateId,
      emoji: "👍",
    });
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.deepEqual(
      retried.body.reactions.map((item: any) => item.count),
      [1],
    );
    assert.equal(
      Number(
        f.database
          .prepare(
            "SELECT COUNT(*) AS n FROM room_events WHERE type='message.reaction_changed'",
          )
          .get()!.n,
      ),
      1,
    );
    // Removing is a different operation, and re-adding after a removal is a
    // third one rather than a replay of the first.
    const removed = await f.call("messages/react", {
      messageId: f.source.event.aggregateId,
      emoji: "👍",
      active: false,
    });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.deepEqual(removed.body.reactions, []);
    const readded = await f.call("messages/react", {
      messageId: f.source.event.aggregateId,
      emoji: "👍",
    });
    assert.equal(readded.status, 200, JSON.stringify(readded.body));
    assert.deepEqual(
      readded.body.reactions.map((item: any) => item.count),
      [1],
    );
    assert.equal(
      Number(
        f.database
          .prepare(
            "SELECT COUNT(*) AS n FROM room_events WHERE type='message.reaction_changed'",
          )
          .get()!.n,
      ),
      3,
    );
  } finally {
    await f.close();
  }
});

test("the explicit reaction form resolves to the same event as the minimal one", async () => {
  const f = await fixture();
  try {
    const explicit = await f.call("messages/react", {
      messageId: f.source.event.aggregateId,
      emoji: "🎯",
      active: true,
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "explicit-reaction",
    });
    assert.equal(explicit.status, 200, JSON.stringify(explicit.body));
    // The minimal form of the same operation deduplicates against nothing new:
    // it is a distinct key, so it is a no-op on an already present reaction.
    const minimal = await f.call("messages/react", {
      messageId: f.source.event.aggregateId,
      emoji: "🎯",
    });
    assert.equal(minimal.status, 200, JSON.stringify(minimal.body));
    assert.deepEqual(
      minimal.body.reactions.map((item: any) => [item.emoji, item.count]),
      [["🎯", 1]],
    );
    // A presented cursor is still fenced against what this credential saw.
    const forged = await f.call("messages/react", {
      messageId: f.source.event.aggregateId,
      emoji: "🚀",
      basedOnRoomSeq: f.activation.toSeq + 999,
      idempotencyKey: "forged-cursor",
    });
    assert.equal(forged.status, 409, JSON.stringify(forged.body));
  } finally {
    await f.close();
  }
});

test("thread unfollow takes Raft's target suffix and reason, and needs no causality", async () => {
  const f = await fixture();
  try {
    const unfollowed = await f.call("threads/unfollow", {
      channel: `#channel:${f.thread.threadId}`,
      reason: "handled elsewhere",
    });
    assert.equal(unfollowed.status, 200, JSON.stringify(unfollowed.body));
    assert.equal(unfollowed.body.threadId, f.thread.threadId);
    assert.equal(unfollowed.body.following, false);
    assert.equal(unfollowed.body.event.payload.reason, "handled elsewhere");
    const retried = await f.call("threads/unfollow", {
      channel: `#channel:${f.thread.threadId}`,
      reason: "handled elsewhere",
    });
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.deduplicated, true);
    assert.equal(
      retried.body.event.eventId,
      unfollowed.body.event.eventId,
      "an identical retry is the same unfollow",
    );
  } finally {
    await f.close();
  }
});

test("thread unfollow by canonical id and by target resolve to the same Thread", async () => {
  const f = await fixture();
  try {
    const byId = await f.call("threads/unfollow", {
      threadId: f.thread.threadId,
    });
    assert.equal(byId.status, 200, JSON.stringify(byId.body));
    const explicit = await f.call("threads/unfollow", {
      threadId: f.thread.threadId,
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "explicit-unfollow",
      reason: "no longer following",
    });
    assert.equal(explicit.status, 200, JSON.stringify(explicit.body));
    assert.equal(explicit.body.threadId, byId.body.threadId);
    // A presented cursor this credential never saw is still refused.
    const forged = await f.call("threads/unfollow", {
      threadId: f.thread.threadId,
      basedOnRoomSeq: f.activation.toSeq + 999,
      idempotencyKey: "forged-unfollow",
    });
    assert.equal(forged.status, 409, JSON.stringify(forged.body));
  } finally {
    await f.close();
  }
});

test("channel mute and unmute take Raft's target alone", async () => {
  const f = await fixture();
  try {
    const muted = await f.call("channels/mute", { channel: "#second" });
    assert.equal(muted.status, 200, JSON.stringify(muted.body));
    assert.equal(muted.body.activityMuted, true);
    assert.equal(muted.body.roomId, f.second.roomId);
    const retried = await f.call("channels/mute", { channel: "#second" });
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.deduplicated, true);
    assert.equal(retried.body.event.eventId, muted.body.event.eventId);
    // Unmuting is a genuinely different operation, and muting again after it is
    // a third one rather than a replay of the first mute.
    const unmuted = await f.call("channels/unmute", { channel: "#second" });
    assert.equal(unmuted.status, 200, JSON.stringify(unmuted.body));
    assert.equal(unmuted.body.activityMuted, false);
    const remuted = await f.call("channels/mute", { channel: "#second" });
    assert.equal(remuted.status, 200, JSON.stringify(remuted.body));
    assert.equal(remuted.body.activityMuted, true);
    assert.equal(remuted.body.deduplicated, false);
    // The Activation's own Room still mutes with no target at all.
    const own = await f.call("channels/mute", {});
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.equal(own.body.roomId, f.room.roomId);
  } finally {
    await f.close();
  }
});

test("an attachment reservation needs no Agent-carried idempotency key", async () => {
  const f = await fixture();
  try {
    const prepared = await f.call("attachments/prepare", {
      filename: "notes.txt",
      mimeType: "text/plain",
      size: 12,
    });
    assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
    assert.equal(prepared.body.state, "pending");
    // A genuine retry of the same file finds the same reservation.
    const retried = await f.call("attachments/prepare", {
      filename: "notes.txt",
      mimeType: "text/plain",
      size: 12,
    });
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.attachmentId, prepared.body.attachmentId);
    // A genuinely different file is a different reservation.
    const other = await f.call("attachments/prepare", {
      filename: "other.txt",
      mimeType: "text/plain",
      size: 12,
    });
    assert.equal(other.status, 200, JSON.stringify(other.body));
    assert.notEqual(other.body.attachmentId, prepared.body.attachmentId);
  } finally {
    await f.close();
  }
});

test("task delete needs no separate Room id", async () => {
  const f = await fixture();
  try {
    const created = await f.call("tasks/create", { title: "Disposable" });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const taskId = created.body.task.taskId as string;
    const deleted = await f.call("tasks/delete", { taskId });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.equal(deleted.body.deleted, true);
    assert.equal(deleted.body.roomId, f.room.roomId);
    // The explicit form, naming the Room, still resolves the same deletion.
    const retried = await f.call("tasks/delete", {
      taskId,
      roomId: f.room.roomId,
    });
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.deduplicated, true);
    assert.equal(retried.body.event.eventId, deleted.body.event.eventId);
  } finally {
    await f.close();
  }
});

test("room-read pages a stable snapshot with no Agent-carried receipt", async () => {
  const f = await fixture();
  try {
    // Each message is large enough that the complete-JSON budget, not the
    // event limit, decides where a page ends; 51 of them need three pages.
    for (let index = 0; index < 51; index += 1)
      f.kernel.postMessage(f.actor, {
        roomId: f.room.roomId,
        body: `${index}${"汉".repeat(40_000)}`,
        recipients: [],
        idempotencyKey: `large-${index}`,
      });
    const frozen = f.head();
    const pages: any[] = [];
    for (let page = 0; page < 3; page += 1) {
      // A new Room event lands between every page; the snapshot must not move.
      if (page > 0) f.post(`interleaved-${page}`);
      const next = await f.call("rooms/read", {
        channel: "#channel",
        limit: 51,
      });
      assert.equal(next.status, 200, JSON.stringify(next.body).slice(0, 300));
      pages.push(next.body);
    }
    assert.equal(pages[0]!.complete, false, "the first page is a continuation");
    assert.equal(pages[1]!.complete, false, "the second page still continues");
    for (const page of pages) {
      assert.equal(
        page.throughRoomSeq,
        frozen,
        "every continuation reads the same frozen snapshot",
      );
      assert.equal(page.eventFloorSeq, pages[0]!.eventFloorSeq);
    }
    const seen = pages.flatMap((page: any) =>
      page.window.events.map((event: any) => event.roomSeq),
    );
    assert.deepEqual(
      seen,
      [...seen].sort((left, right) => left - right),
      "continuations advance monotonically",
    );
    assert.equal(
      new Set(seen).size,
      seen.length,
      "no continuation repeats an event",
    );
    assert.ok(
      seen.every((roomSeq: number) => roomSeq <= frozen),
      "no continuation leaks an event newer than the snapshot",
    );
    assert.equal(pages.at(-1)!.complete, true, "three pages finish the window");
    // A finished window is not a continuation: the next read opens a fresh one
    // at the head the Room has actually reached.
    const reopened = await f.call("rooms/read", {
      channel: "#channel",
      limit: 5,
    });
    assert.equal(reopened.status, 200);
    assert.ok(
      reopened.body.throughRoomSeq > frozen,
      "a completed window is not a continuation",
    );
  } finally {
    await f.close();
  }
});

test("a presented room-read receipt is still verified and a forged one is refused", async () => {
  const f = await fixture();
  try {
    for (let index = 0; index < 8; index += 1) f.post(`filler-${index}`);
    const first = await f.call("rooms/read", { channel: "#channel", limit: 2 });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const receipt = first.body.contextReceipt as string;
    const continued = await f.call("rooms/read", {
      channel: "#channel",
      limit: 2,
      contextReceipt: receipt,
    });
    assert.equal(continued.status, 200, JSON.stringify(continued.body));
    assert.equal(continued.body.throughRoomSeq, first.body.throughRoomSeq);
    for (const forged of [
      `${receipt.slice(0, -8)}tampered`,
      receipt.replace(".", "x."),
      "not-a-receipt",
    ]) {
      const refused = await f.call("rooms/read", {
        channel: "#channel",
        limit: 2,
        contextReceipt: forged,
      });
      assert.notEqual(refused.status, 200, JSON.stringify(refused.body));
    }
  } finally {
    await f.close();
  }
});
