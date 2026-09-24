import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";
import { shortWorkerRef } from "@rah-os/protocol";

import { WorkerApplicationService } from "../src/index.ts";
import {
  classifyWorkerServerRejection,
  markSendFailureDraftSaved,
  workerServerFailureError,
} from "../../agent-host/src/worker-cli-error.ts";

/**
 * Structural reply-target guard: a post that cites delivered messages
 * (`basedOnRoomSeq`) must land where those messages arrived, or in a Thread
 * rooted at one of them. Drift evidence (2026-09-25): after compaction a warm
 * Codex session kept replying into a Thread from an earlier round.
 */
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-reply-target-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  kernel.initialize();
  const database = new DatabaseSync(join(directory, "room.db"));
  const head = () =>
    Number(
      database
        .prepare("SELECT next_seq - 1 AS n FROM rooms WHERE room_id=?")
        .get(room.roomId)!.n,
    );
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const agent = kernel.provisionPrincipal({ handle: "worker", kind: "agent" });
  const agentId = agent.principal.principalId;
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Drift", slug: "drift" });
  let sequence = 0;
  const post = (body: string, mention = true) =>
    kernel.postMessage(actor, {
      body,
      roomId: room.roomId,
      recipients: mention
        ? [{ participantId: agentId, reason: "mention" }]
        : [],
      idempotencyKey: `seed-${++sequence}`,
    });
  const thread = (rootMessageId: string) =>
    kernel.createThread(actor, {
      roomId: room.roomId,
      rootMessageId,
      recipientIds: [],
      idempotencyKey: `thread-${++sequence}`,
      basedOnRoomSeq: head(),
    });
  // An earlier round's Thread, entirely before this Activation's window.
  const oldRoot = post("old question", false);
  const old = thread(oldRoot.event.aggregateId);
  kernel.addMember(actor, { roomId: room.roomId, principalId: agentId });
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "host",
      participantIds: [agentId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const service = new WorkerApplicationService({ kernel });
  await service.start();
  return {
    actor,
    agentId,
    kernel,
    oldThreadId: old.thread.threadId,
    post,
    room,
    thread,
    reply: (threadId: string, body: string, basedOnRoomSeq: number) =>
      kernel.replyThread(actor, {
        roomId: room.roomId,
        threadId,
        body,
        idempotencyKey: `reply-${++sequence}`,
        recipientIds: [agentId],
        basedOnRoomSeq,
      }),
    activate() {
      const activation = kernel.leaseNextActivation(host, { leaseMs: 600_000 });
      assert.ok(activation, "an Activation must be queued");
      const run = kernel.createRunAttempt(host, {
        activationId: activation.activationId,
      });
      const runtime = {
        runAttemptId: run.runAttemptId,
        runtimeRunId: `runtime-${run.runAttemptId}`,
        recoveryDescriptor: {
          driver: "fake",
          recoveryKey: "fake",
          metadata: {},
        },
      };
      kernel.prepareRunAttemptRuntime(host, runtime);
      kernel.markRunAttemptRunning(host, runtime);
      const credential = service.issueActivationCredential(host, {
        activationId: activation.activationId,
        consumerId: "worker",
        hostId: "host",
        participantId: agentId,
        roomId: room.roomId,
        runAttemptId: run.runAttemptId,
        toSeq: activation.toSeq,
      });
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
      /** Present the window and register the Host's send, as the wake does. */
      const present = async () => {
        const presented = await call("message-present");
        kernel.markPresentedDeliverySent(host, {
          activationId: activation.activationId,
          consumerId: "worker",
          runAttemptId: run.runAttemptId,
        });
        return presented;
      };
      return { activation, call, present };
    },
    async close() {
      await service.close();
      database.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("channel window: a reply into an unrelated earlier Thread is rejected, naming the channel", async () => {
  const f = await fixture();
  try {
    f.post("new channel question");
    const run = f.activate();
    await run.present();
    const rejected = await run.call("messages/post", {
      channel: `#drift:${shortWorkerRef(f.oldThreadId)}`,
      body: "answer",
      basedOnRoomSeq: run.activation.toSeq,
    });
    assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    assert.equal(rejected.body.error.code, "reply_target_mismatch");
    assert.match(rejected.body.error.suggestedNextAction, /--target "#drift"/u);
    // Nothing was published by the refusal.
    const posted = f.kernel
      .sync(f.actor, { roomId: f.room.roomId, consumerId: "audit" })
      .events.filter(
        (event: any) =>
          event.type === "message.posted" && event.actorId === f.agentId,
      );
    assert.equal(posted.length, 0);
    // S1-b: the CLI reports it as a definite not-sent rejection that keeps the
    // server's corrected target as its next action.
    assert.equal(
      classifyWorkerServerRejection("reply_target_mismatch"),
      "not_sent",
    );
    const cli = markSendFailureDraftSaved(
      workerServerFailureError(rejected.body, 409, "SEND_FAILED"),
      false,
    );
    assert.equal(cli.effect, "not_sent");
    assert.equal(cli.draftSaved, false);
    assert.match(cli.suggestedNextAction ?? "", /--target "#drift"/u);
  } finally {
    await f.close();
  }
});

test("channel window: a reply in the channel is accepted", async () => {
  const f = await fixture();
  try {
    f.post("new channel question");
    const run = f.activate();
    await run.present();
    const posted = await run.call("messages/post", {
      channel: "#drift",
      body: "answer",
      basedOnRoomSeq: run.activation.toSeq,
    });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    assert.equal(posted.body.event.payload.threadId, undefined);
  } finally {
    await f.close();
  }
});

test("Thread window: a reply in that Thread is accepted", async () => {
  const f = await fixture();
  try {
    const root = f.post("thread root", false);
    const created = f.thread(root.event.aggregateId);
    f.reply(
      created.thread.threadId,
      "follow-up in thread",
      created.event.roomSeq,
    );
    const run = f.activate();
    await run.present();
    const posted = await run.call("messages/post", {
      channel: `#drift:${shortWorkerRef(created.thread.threadId)}`,
      body: "answer in thread",
      basedOnRoomSeq: run.activation.toSeq,
    });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    assert.equal(posted.body.event.payload.threadId, created.thread.threadId);
  } finally {
    await f.close();
  }
});

test("channel window: a new Thread rooted at a delivered message is accepted", async () => {
  const f = await fixture();
  try {
    const delivered = f.post("new channel question");
    const run = f.activate();
    await run.present();
    // The Thread is opened on the delivered message after the window head.
    const created = f.thread(delivered.event.aggregateId);
    const posted = await run.call("messages/post", {
      channel: `#drift:${shortWorkerRef(created.thread.threadId)}`,
      body: "answer in a new thread",
      basedOnRoomSeq: run.activation.toSeq,
    });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    assert.equal(posted.body.event.payload.threadId, created.thread.threadId);
  } finally {
    await f.close();
  }
});

test("once this turn's input is confirmed, a deliberate non-final post without a causal marker may go to any Thread", async () => {
  const f = await fixture();
  try {
    f.post("new channel question");
    const run = f.activate();
    await run.present();
    // This turn's reply, citing the delivered range, confirms it implicitly.
    const reply = await run.call("messages/post", {
      channel: "#drift",
      body: "answer",
      basedOnRoomSeq: run.activation.toSeq,
    });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    const posted = await run.call("messages/post", {
      channel: `#drift:${shortWorkerRef(f.oldThreadId)}`,
      body: "a deliberate note in the old thread",
    });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    assert.equal(posted.body.event.payload.threadId, f.oldThreadId);
  } finally {
    await f.close();
  }
});

test("channel + Thread window: one reply per target, each citing the same head, is accepted", async () => {
  const f = await fixture();
  try {
    const root = f.post("thread root", false);
    const created = f.thread(root.event.aggregateId);
    f.reply(
      created.thread.threadId,
      "follow-up in thread",
      created.event.roomSeq,
    );
    f.post("and a channel question");
    const run = f.activate();
    await run.present();
    for (const channel of [
      `#drift:${shortWorkerRef(created.thread.threadId)}`,
      "#drift",
    ]) {
      const posted = await run.call("messages/post", {
        channel,
        body: `answer in ${channel}`,
        basedOnRoomSeq: run.activation.toSeq,
      });
      assert.equal(posted.status, 200, JSON.stringify(posted.body));
      assert.ok(posted.body.event, JSON.stringify(posted.body));
    }
  } finally {
    await f.close();
  }
});

// Review 2026-09-25 P1-1: the guard is judged after target normalization on
// every post route, so the same reply cannot escape it by changing syntax.

function authoredPosts(f: Awaited<ReturnType<typeof fixture>>) {
  return f.kernel
    .sync(f.actor, { roomId: f.room.roomId, consumerId: "audit" })
    .events.filter(
      (event: any) =>
        event.type === "message.posted" && event.actorId === f.agentId,
    );
}

test("channel window: an explicit old threadId final reply is rejected (originating route)", async () => {
  const f = await fixture();
  try {
    f.post("new channel question");
    const run = f.activate();
    await run.present();
    const rejected = await run.call("messages/post", {
      threadId: f.oldThreadId,
      body: "answer",
      basedOnRoomSeq: run.activation.toSeq,
      final: true,
    });
    assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    assert.equal(rejected.body.error.code, "reply_target_mismatch");
    assert.equal(authoredPosts(f).length, 0);
  } finally {
    await f.close();
  }
});

test("Thread window: a final reply to the Room top level is rejected (target without Thread suffix)", async () => {
  const f = await fixture();
  try {
    const root = f.post("thread root", false);
    const created = f.thread(root.event.aggregateId);
    f.reply(
      created.thread.threadId,
      "question in thread",
      created.event.roomSeq,
    );
    const run = f.activate();
    await run.present();
    const rejected = await run.call("messages/post", {
      channel: "#drift",
      body: "answer",
      basedOnRoomSeq: run.activation.toSeq,
      final: true,
    });
    assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    assert.equal(rejected.body.error.code, "reply_target_mismatch");
    assert.match(
      rejected.body.error.suggestedNextAction,
      new RegExp(`#drift:${shortWorkerRef(created.thread.threadId)}`, "u"),
    );
    assert.doesNotMatch(
      rejected.body.error.suggestedNextAction,
      /omit --based-on-room-seq/u,
    );
    // Same reply through the originating route's explicit Room target.
    const explicitRoom = await run.call("messages/post", {
      threadId: null,
      body: "answer",
      basedOnRoomSeq: run.activation.toSeq,
      final: true,
    });
    assert.equal(explicitRoom.status, 409, JSON.stringify(explicitRoom.body));
    assert.equal(explicitRoom.body.error.code, "reply_target_mismatch");
    // And another Thread is refused too.
    const other = await run.call("messages/post", {
      threadId: f.oldThreadId,
      body: "answer",
      basedOnRoomSeq: run.activation.toSeq,
    });
    assert.equal(other.status, 409, JSON.stringify(other.body));
    assert.equal(authoredPosts(f).length, 0);
    // The Thread reply itself still goes through the originating route.
    const accepted = await run.call("messages/post", {
      threadId: created.thread.threadId,
      body: "answer",
      basedOnRoomSeq: run.activation.toSeq,
      final: true,
    });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  } finally {
    await f.close();
  }
});

test("omitting the causal marker is not a loophole while this turn's input is unconfirmed", async () => {
  const f = await fixture();
  try {
    f.post("new channel question");
    const run = f.activate();
    await run.present();
    for (const request of [
      { channel: `#drift:${shortWorkerRef(f.oldThreadId)}` },
      { threadId: f.oldThreadId },
    ]) {
      const rejected = await run.call("messages/post", {
        ...request,
        body: "answer without a marker",
      });
      assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
      assert.equal(rejected.body.error.code, "reply_target_mismatch");
    }
    assert.equal(authoredPosts(f).length, 0);
  } finally {
    await f.close();
  }
});

test("a final post is always this turn's reply, even after confirmation and without a marker", async () => {
  const f = await fixture();
  try {
    f.post("new channel question");
    const run = f.activate();
    await run.present();
    // A correct progress reply confirms the delivered range implicitly.
    const progress = await run.call("messages/post", {
      channel: "#drift",
      body: "working on it",
      basedOnRoomSeq: run.activation.toSeq,
    });
    assert.equal(progress.status, 200, JSON.stringify(progress.body));
    const rejected = await run.call("messages/post", {
      channel: `#drift:${shortWorkerRef(f.oldThreadId)}`,
      body: "final elsewhere",
      final: true,
    });
    assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    assert.equal(rejected.body.error.code, "reply_target_mismatch");
  } finally {
    await f.close();
  }
});

test("an old Task Thread fetched with task-get in this Activation accepts the reply on both routes", async () => {
  const f = await fixture();
  try {
    const other = f.kernel.provisionPrincipal({
      handle: "other",
      kind: "agent",
    });
    f.kernel.addMember(f.actor, {
      roomId: f.room.roomId,
      principalId: other.principal.principalId,
    });
    const task = f.kernel.createTask(f.actor, {
      roomId: f.room.roomId,
      title: "Old work",
      assigneeId: other.principal.principalId,
      idempotencyKey: "old-task",
    });
    f.post("please audit the old task");
    const run = f.activate();
    await run.present();
    // Without task relation evidence the old Task Thread is not this reply's target.
    const unjustified = await run.call("messages/post", {
      threadId: task.task.threadId,
      body: "audit evidence",
      basedOnRoomSeq: run.activation.toSeq,
    });
    assert.equal(unjustified.status, 409, JSON.stringify(unjustified.body));
    assert.equal(unjustified.body.error.code, "reply_target_mismatch");
    const read = await run.call("tasks/get", { taskId: task.task.taskId });
    assert.equal(read.status, 200, JSON.stringify(read.body));
    const explicit = await run.call("messages/post", {
      threadId: task.task.threadId,
      body: "audit evidence",
      basedOnRoomSeq: run.activation.toSeq,
    });
    assert.equal(explicit.status, 200, JSON.stringify(explicit.body));
    assert.equal(explicit.body.event.payload.threadId, task.task.threadId);
    const targeted = await run.call("messages/post", {
      channel: `#drift:${shortWorkerRef(task.task.threadId)}`,
      body: "audit summary",
      basedOnRoomSeq: run.activation.toSeq,
      final: true,
    });
    assert.equal(targeted.status, 200, JSON.stringify(targeted.body));
    assert.equal(targeted.body.event.payload.threadId, task.task.threadId);
  } finally {
    await f.close();
  }
});

test("an old Task Thread of a Task assigned to this Agent accepts the reply", async () => {
  const f = await fixture();
  try {
    const task = f.kernel.createTask(f.actor, {
      roomId: f.room.roomId,
      title: "My old work",
      assigneeId: f.agentId,
      idempotencyKey: "my-old-task",
    });
    f.post("status of your task?");
    const run = f.activate();
    await run.present();
    const posted = await run.call("messages/post", {
      threadId: task.task.threadId,
      body: "status update",
      basedOnRoomSeq: run.activation.toSeq,
      final: true,
    });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
  } finally {
    await f.close();
  }
});
