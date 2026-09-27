import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";

import { WorkerApplicationService } from "../src/index.ts";

/**
 * Real `RoomKernel`, real SQLite file, real Worker HTTP routes. Every
 * assertion below is about the ledger after the route returned, never about a
 * helper's return value.
 *
 * The chain exists because the previous review found the implicit
 * acknowledgement had three ways to confirm a range nobody had read: a cursor
 * that crossed a notice-degraded message, a `--target` post that skipped the
 * confirmation entirely (or confirmed this Room after landing in another one),
 * and a defaulted cursor that stood in for a model submission.
 */
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-presented-chain-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const database = new DatabaseSync(databasePath);
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const agent = kernel.provisionPrincipal({ handle: "worker", kind: "agent" });
  const agentId = agent.principal.principalId;
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Main", slug: "main" });
  const away = kernel.createRoom(actor, { name: "Away", slug: "away" });
  for (const roomId of [room.roomId, away.roomId])
    kernel.addMember(actor, { roomId, principalId: agentId });
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "host",
      participantIds: [agentId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const service = new WorkerApplicationService({ kernel });
  await service.start();
  let sequence = 0;
  const post = (body: string, roomId = room.roomId) =>
    kernel.postMessage(actor, {
      body,
      roomId,
      recipients: [{ participantId: agentId, reason: "mention" }],
      idempotencyKey: `seed-${++sequence}`,
    });
  const head = (roomId = room.roomId) =>
    Number(
      database
        .prepare("SELECT next_seq - 1 AS n FROM rooms WHERE room_id=?")
        .get(roomId)!.n,
    );
  const task = (title: string) =>
    kernel.createTask(actor, {
      roomId: room.roomId,
      title,
      assigneeId: agentId,
      collaboratorIds: [],
      reviewerIds: [],
      dependencyTaskIds: [],
      idempotencyKey: `task-${++sequence}`,
    });
  const cursor = (roomId = room.roomId) =>
    Number(
      database
        .prepare(
          "SELECT last_seq AS n FROM subscription_cursors WHERE room_id=? AND participant_id=? AND consumer_id='worker'",
        )
        .get(roomId, agentId)?.n ?? 0,
    );
  const presentedRow = (activationId: string, runAttemptId: string) =>
    database
      .prepare(
        "SELECT * FROM activation_presented_windows WHERE activation_id=? AND consumer_id='worker' AND run_attempt_id=?",
      )
      .get(activationId, runAttemptId) as Record<string, unknown> | undefined;
  return {
    actor,
    agentId,
    away,
    cursor,
    database,
    head,
    task,
    host,
    kernel,
    post,
    presentedRow,
    room,
    service,
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
      const scope = {
        activationId: activation.activationId,
        consumerId: "worker",
        hostId: "host",
        participantId: agentId,
        roomId: room.roomId,
        runAttemptId: run.runAttemptId,
        toSeq: activation.toSeq,
      };
      const credential = service.issueActivationCredential(host, scope);
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
      return {
        activation,
        call,
        credential,
        run,
        runtime,
        scope,
        /** The Host registers the send under its OWN credential. */
        markSent: () =>
          kernel.markPresentedDeliverySent(host, {
            activationId: activation.activationId,
            consumerId: "worker",
            runAttemptId: run.runAttemptId,
          }),
      };
    },
    async close() {
      await service.close();
      database.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("present-only fetch registers no delivered cursor and no acknowledgement", async () => {
  const context = await fixture();
  try {
    const first = context.post("read me");
    const run = context.activate();
    const presented = await run.call("message-present");
    assert.equal(presented.status, 200);
    assert.deepEqual(presented.body.presentedSeqs, [first.event.roomSeq]);
    assert.equal(presented.body.noticeCount, 0);
    assert.equal(presented.body.noticeFromSeq, undefined);
    assert.equal(presented.body.presentedThroughSeq, first.event.roomSeq);
    assert.equal(presented.body.sentAt, undefined);
    assert.equal(context.cursor(), 0);
    // A present-only fetch must not become a `/v1/worker/sync` continuation:
    // that would let a Host-side read acknowledge on the model's behalf.
    const continuation = await run.call("sync", {
      afterSeq: presented.body.toSeq,
    });
    assert.equal(continuation.status, 409);
    assert.equal(continuation.body.error.code, "invalid_continuation");
  } finally {
    await context.close();
  }
});

test("a plain post with the model's own cursor acknowledges the presented prefix", async () => {
  const context = await fixture();
  try {
    const first = context.post("question one");
    const run = context.activate();
    const presented = await run.call("message-present");
    run.markSent();
    const posted = await run.call("messages/post", {
      body: "an answer",
      basedOnRoomSeq: presented.body.presentedThroughSeq,
      idempotencyKey: "answer-1",
    });
    assert.equal(posted.status, 200);
    assert.equal(context.cursor(), first.event.roomSeq);
  } finally {
    await context.close();
  }
});

test("a post with no model-submitted cursor leaves the range unacknowledged", async () => {
  const context = await fixture();
  try {
    context.post("question two");
    const run = context.activate();
    await run.call("message-present");
    run.markSent();
    const posted = await run.call("messages/post", {
      body: "an answer with no causal marker",
      idempotencyKey: "answer-2",
    });
    assert.equal(posted.status, 200);
    assert.equal(
      context.cursor(),
      0,
      "a cursor the Kernel resolved is not a model submission",
    );
  } finally {
    await context.close();
  }
});

test("a --target post into this Activation's own Room acknowledges through the same entry point", async () => {
  const context = await fixture();
  try {
    const first = context.post("question three");
    const run = context.activate();
    const presented = await run.call("message-present");
    run.markSent();
    // A sent rendering is a read of this target, so the first call publishes;
    // the extra held-draft round trip this test used to encode is gone.
    const posted = await run.call("messages/post", {
      channel: "#main",
      body: "answering through --target",
      basedOnRoomSeq: presented.body.presentedThroughSeq,
      idempotencyKey: "answer-3",
    });
    assert.equal(posted.status, 200);
    assert.ok(
      "event" in posted.body,
      JSON.stringify(posted.body).slice(0, 200),
    );
    assert.equal(context.cursor(), first.event.roomSeq);
  } finally {
    await context.close();
  }
});

test("a --target post into another Room acknowledges nothing here", async () => {
  const context = await fixture();
  try {
    context.post("question four");
    const run = context.activate();
    const presented = await run.call("message-present");
    run.markSent();
    const posted = await run.call("messages/post", {
      channel: "#away",
      body: "this went somewhere else entirely",
      basedOnRoomSeq: presented.body.presentedThroughSeq,
      idempotencyKey: "answer-4",
    });
    assert.equal(posted.status, 200);
    // The post really was published, in the other Room.
    assert.equal(posted.body.event.roomId, context.away.roomId);
    assert.equal(
      context.cursor(),
      0,
      "a successful post in another Room is not evidence about this Room",
    );
  } finally {
    await context.close();
  }
});

test("a Thread post in this Room acknowledges the presented prefix", async () => {
  const context = await fixture();
  try {
    const root = context.post("question five");
    const thread = context.kernel.createThread(context.actor, {
      roomId: context.room.roomId,
      rootMessageId: root.event.aggregateId,
      recipientIds: [context.agentId],
      idempotencyKey: "thread-5",
      basedOnRoomSeq: root.event.roomSeq,
    });
    const reply = context.kernel.replyThread(context.actor, {
      roomId: context.room.roomId,
      threadId: thread.thread.threadId,
      body: "and a Thread follow-up",
      idempotencyKey: "thread-reply-5",
      recipientIds: [context.agentId],
      basedOnRoomSeq: thread.event.roomSeq,
    });
    const run = context.activate();
    const presented = await run.call("message-present");
    run.markSent();
    const posted = await run.call("messages/post", {
      threadId: thread.thread.threadId,
      body: "answering in the Thread",
      basedOnRoomSeq: presented.body.presentedThroughSeq,
      idempotencyKey: "answer-5",
    });
    assert.equal(posted.status, 200);
    assert.equal(context.cursor(), reply.event.roomSeq);
  } finally {
    await context.close();
  }
});

test("a retry under the same idempotency key does not change what was acknowledged", async () => {
  const context = await fixture();
  try {
    const first = context.post("question six");
    const run = context.activate();
    const presented = await run.call("message-present");
    run.markSent();
    const posted = await run.call("messages/post", {
      body: "an answer whose response was lost",
      basedOnRoomSeq: presented.body.presentedThroughSeq,
      idempotencyKey: "answer-6",
    });
    assert.equal(posted.status, 200);
    const retry = await run.call("messages/post", {
      body: "an answer whose response was lost",
      basedOnRoomSeq: presented.body.presentedThroughSeq,
      idempotencyKey: "answer-6",
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.deduplicated, true);
    assert.equal(context.cursor(), first.event.roomSeq);
    assert.equal(
      Number(
        context.database
          .prepare(
            "SELECT COUNT(*) AS n FROM room_events WHERE room_id=? AND type='message.posted' AND actor_id=?",
          )
          .get(context.room.roomId, context.agentId)!.n,
      ),
      1,
    );
  } finally {
    await context.close();
  }
});

test("an Activation handled without posting acknowledges nothing and stays open", async () => {
  const context = await fixture();
  try {
    context.post("question seven");
    const run = context.activate();
    await run.call("message-present");
    run.markSent();
    assert.equal(context.cursor(), 0);
    const activation = context.database
      .prepare("SELECT state FROM activations WHERE activation_id=?")
      .get(run.scope.activationId)!;
    assert.notEqual(activation.state, "completed");
    // The explicit path is still the only way to finish it.
    const check = await run.call("message-check");
    assert.equal(check.status, 200);
    const acknowledged = await run.call("acknowledge", {
      throughSeq: check.body.delivery.cursorAfter,
    });
    assert.equal(acknowledged.status, 200);
    assert.equal(context.cursor(), check.body.delivery.cursorAfter);
  } finally {
    await context.close();
  }
});

test("the full window is not a citable cursor once anything degraded", async () => {
  const context = await fixture();
  try {
    const first = context.post("small");
    context.post("x".repeat(64 * 1024 + 1_000));
    context.post("small again");
    const run = context.activate();
    const presented = await run.call("message-present");
    assert.equal(presented.body.noticeCount, 1);
    assert.equal(presented.body.presentedThroughSeq, first.event.roomSeq);
    run.markSent();
    // Only the prefix was registered as a citable cursor. Handing out `toSeq`
    // would let the model clear the freshness gate with a number covering the
    // message it never saw — a different failure from acknowledging it.
    const overreach = await run.call("messages/post", {
      body: "answering the whole window",
      basedOnRoomSeq: presented.body.toSeq,
      idempotencyKey: "answer-8a",
    });
    assert.equal(overreach.status, 409);
    assert.equal(overreach.body.error.code, "causal_cursor_not_delivered");
    assert.equal(context.cursor(), 0);
  } finally {
    await context.close();
  }
});

test("a notice-degraded Thread message stops the acknowledgement and stays readable", async () => {
  const context = await fixture();
  try {
    // The degraded event is in a Thread, so the Room top level has nothing
    // newer than the prefix and the reply publishes on the first call. The
    // Thread message is still unpresented and still unread afterwards.
    const root = context.post("small");
    const thread = context.kernel.createThread(context.actor, {
      roomId: context.room.roomId,
      rootMessageId: root.event.aggregateId,
      recipientIds: [context.agentId],
      idempotencyKey: "thread-8",
      basedOnRoomSeq: root.event.roomSeq,
    });
    const oversized = context.kernel.replyThread(context.actor, {
      roomId: context.room.roomId,
      threadId: thread.thread.threadId,
      body: "y".repeat(64 * 1024 + 1_000),
      idempotencyKey: "thread-8-reply",
      recipientIds: [context.agentId],
      basedOnRoomSeq: thread.event.roomSeq,
    });
    const run = context.activate();
    const presented = await run.call("message-present");
    assert.ok(presented.body.presentedSeqs.includes(root.event.roomSeq));
    assert.ok(!presented.body.presentedSeqs.includes(oversized.event.roomSeq));
    assert.equal(presented.body.presentedThroughSeq, thread.event.roomSeq);
    assert.ok(presented.body.presentedThroughSeq < oversized.event.roomSeq);
    run.markSent();
    // The `--target` route, because the originating route additionally
    // requires the causal marker to equal the Room head; here the prefix is
    // deliberately behind it. The target-scoped hold is what fences this
    // route, and the Room top level has nothing newer than the prefix.
    const posted = await run.call("messages/post", {
      channel: "#main",
      body: "answering what I could see",
      basedOnRoomSeq: presented.body.presentedThroughSeq,
      idempotencyKey: "answer-8b",
    });
    assert.equal(posted.status, 200);
    assert.ok("event" in posted.body);
    assert.equal(context.cursor(), thread.event.roomSeq);
    const check = await run.call("message-check");
    const delivered = (
      check.body.delivery.events as { roomSeq: number; type: string }[]
    ).map((event) => event.roomSeq);
    assert.ok(delivered.includes(oversized.event.roomSeq));
  } finally {
    await context.close();
  }
});

test("a Task event inside the window is presented and acknowledged with the messages", async () => {
  const context = await fixture();
  try {
    const first = context.post("please look at this");
    const created = context.task("Investigate the migration");
    context.kernel.unassignTask(context.actor, {
      taskId: created.task.taskId,
      basedOnRoomSeq: context.head(),
      idempotencyKey: "cancel-9",
    });
    const last = context.post("never mind, I cancelled it");
    const run = context.activate();
    const presented = await run.call("message-present");
    assert.equal(presented.body.noticeCount, 0);
    assert.equal(presented.body.presentedThroughSeq, presented.body.toSeq);
    // The Task creation and the unassignment are in the presented set, not
    // crossed: `message-check` renders both today
    // (room-sync.ts:123-127, worker-read-render.ts:465-497).
    const types = (presented.body.events as { type: string }[]).map(
      (event) => event.type,
    );
    assert.ok(types.some((type) => type.startsWith("task.")));
    assert.ok(presented.body.presentedSeqs.includes(first.event.roomSeq));
    assert.ok(presented.body.presentedSeqs.includes(last.event.roomSeq));
    run.markSent();
    const posted = await run.call("messages/post", {
      threadId: null,
      body: "understood, dropping it",
      basedOnRoomSeq: presented.body.presentedThroughSeq,
      idempotencyKey: "answer-9",
    });
    assert.equal(posted.status, 200);
    assert.equal(context.cursor(), presented.body.toSeq);
  } finally {
    await context.close();
  }
});

test("a reassignment the budget could not render stops the cursor before it", async () => {
  const context = await fixture();
  try {
    const posted: number[] = [];
    for (let index = 0; index < 20; index++)
      posted.push(context.post(`filler ${index}`).event.roomSeq);
    const created = context.task("Work to hand over");
    const reassigned = context.kernel.unassignTask(context.actor, {
      taskId: created.task.taskId,
      basedOnRoomSeq: context.head(),
      idempotencyKey: "reassign-10",
    });
    context.post("and one more word");
    const run = context.activate();
    const presented = await run.call("message-present");
    assert.ok(presented.body.noticeCount > 0);
    assert.equal(presented.body.presentedThroughSeq, posted[posted.length - 1]);
    assert.ok(
      !presented.body.presentedSeqs.includes(reassigned.event.roomSeq),
      "an unrendered reassignment must not be in the presented set",
    );
    run.markSent();
    // The prefix is behind the Room head, so the Kernel refuses the post
    // outright; the reassignment can only be reached through `message-check`.
    const refused = await run.call("messages/post", {
      threadId: null,
      body: "answering before reading the reassignment",
      basedOnRoomSeq: presented.body.presentedThroughSeq,
      idempotencyKey: "answer-10a",
    });
    assert.equal(refused.status, 409);
    assert.equal(context.cursor(), 0);
    const check = await run.call("message-check");
    const delivered = (check.body.delivery.events as { roomSeq: number }[]).map(
      (event) => event.roomSeq,
    );
    assert.ok(delivered.includes(reassigned.event.roomSeq));
  } finally {
    await context.close();
  }
});

test("a new message after the rendering still holds the --target reply", async () => {
  const context = await fixture();
  try {
    context.post("the question");
    const run = context.activate();
    const presented = await run.call("message-present");
    run.markSent();
    // A fact that arrived after the rendering is genuinely unseen, so the
    // presented floor must not cover it and the hold must still fire.
    context.post("actually, one more thing");
    const held = await run.call("messages/post", {
      channel: "#main",
      body: "answering the first question only",
      basedOnRoomSeq: presented.body.presentedThroughSeq,
      idempotencyKey: "answer-11",
    });
    assert.equal(held.status, 200);
    assert.ok(held.body.heldDraftId, JSON.stringify(held.body).slice(0, 200));
    assert.equal(context.cursor(), 0);
  } finally {
    await context.close();
  }
});

test("a post that beat the Host's mark-sent is acknowledged when it lands", async () => {
  const context = await fixture();
  try {
    const first = context.post("a question answered very fast");
    const run = context.activate();
    const presented = await run.call("message-present");
    // The model replies before the driver's acceptance signal came back.
    const posted = await run.call("messages/post", {
      body: "an answer that beat the acceptance signal",
      basedOnRoomSeq: presented.body.presentedThroughSeq,
      idempotencyKey: "race-1",
    });
    assert.equal(posted.status, 200);
    assert.ok("event" in posted.body);
    assert.equal(context.cursor(), 0, "nothing is acknowledged before sent_at");
    // The Host's signal arrives afterwards; the parked post is replayed.
    run.markSent();
    assert.equal(context.cursor(), first.event.roomSeq);
  } finally {
    await context.close();
  }
});

test("a post that beat a mark-sent which never arrives is never acknowledged", async () => {
  const context = await fixture();
  try {
    context.post("a question whose delivery was never confirmed");
    const run = context.activate();
    const presented = await run.call("message-present");
    const posted = await run.call("messages/post", {
      body: "an answer with no acceptance signal behind it",
      basedOnRoomSeq: presented.body.presentedThroughSeq,
      idempotencyKey: "race-2",
    });
    assert.equal(posted.status, 200);
    assert.equal(context.cursor(), 0);
    // Re-rendering must not launder the parked marker into an acknowledgement.
    await run.call("message-present");
    assert.equal(context.cursor(), 0);
  } finally {
    await context.close();
  }
});

test("a parked marker from another Room is never replayed", async () => {
  const context = await fixture();
  try {
    context.post("a question");
    const run = context.activate();
    const presented = await run.call("message-present");
    const posted = await run.call("messages/post", {
      channel: "#away",
      body: "answered somewhere else before the signal",
      basedOnRoomSeq: presented.body.presentedThroughSeq,
      idempotencyKey: "race-3",
    });
    assert.equal(posted.status, 200);
    assert.equal(posted.body.event.roomId, context.away.roomId);
    run.markSent();
    assert.equal(
      context.cursor(),
      0,
      "the cross-Room gate is applied when the post happens, not skipped by parking",
    );
  } finally {
    await context.close();
  }
});

test("the present response stays bounded as the range grows", async () => {
  const context = await fixture();
  try {
    for (let index = 0; index < 60; index++) context.post(`bulk ${index}`);
    const run = context.activate();
    const presented = await run.call("message-present");
    assert.equal(presented.status, 200);
    // Bounded body: the page never grows with the range.
    assert.equal(presented.body.events.length, 20);
    assert.equal(presented.body.presentedSeqs.length, 20);
    // Bounded tail: a count and a range, never a list of 40 sequences.
    assert.equal(presented.body.noticeCount, 40);
    assert.ok(presented.body.noticeFromSeq > 0);
    assert.equal(presented.body.noticeToSeq, presented.body.toSeq);
    assert.equal(
      (presented.body as Record<string, unknown>).noticeSeqs,
      undefined,
      "degraded sequences are summarised, never enumerated",
    );
    assert.equal(
      presented.body.presentedThroughSeq,
      presented.body.presentedSeqs[19],
    );
  } finally {
    await context.close();
  }
});

test("a terminal RunAttempt's credential can neither present nor acknowledge", async () => {
  const context = await fixture();
  try {
    context.post("question nine");
    const run = context.activate();
    await run.call("message-present");
    run.markSent();
    context.kernel.recordRuntimeTermination(context.host, {
      runAttemptId: run.scope.runAttemptId,
      runtimeRunId: run.runtime.runtimeRunId,
      exit: { code: 0 },
    });
    context.kernel.finishRunAttempt(context.host, {
      runAttemptId: run.scope.runAttemptId,
      state: "exited",
      exitCode: 0,
    });
    const late = await run.call("messages/post", {
      body: "a late post from a finished attempt",
      basedOnRoomSeq: run.scope.toSeq,
      idempotencyKey: "answer-9",
    });
    assert.notEqual(late.status, 200);
    assert.equal(context.cursor(), 0);
    const present = await run.call("message-present");
    assert.notEqual(present.status, 200);
  } finally {
    await context.close();
  }
});

test("a late request after the Room was stopped acknowledges nothing", async () => {
  const context = await fixture();
  try {
    context.post("question ten");
    const run = context.activate();
    const presented = await run.call("message-present");
    run.markSent();
    context.kernel.roomAgentSos.requestStop(context.actor, {
      roomId: context.room.roomId,
      basedOnRoomSeq: Number(
        context.database
          .prepare("SELECT next_seq - 1 AS n FROM rooms WHERE room_id=?")
          .get(context.room.roomId)!.n,
      ),
      idempotencyKey: "stop-10",
    });
    const late = await run.call("messages/post", {
      body: "a post that arrives after the pause",
      basedOnRoomSeq: presented.body.toSeq,
      idempotencyKey: "answer-10",
    });
    assert.notEqual(late.status, 200);
    assert.equal(context.cursor(), 0);
  } finally {
    await context.close();
  }
});

test("contract §3 catch-up: the route carries Channel messages that did not wake the worker and one reply acknowledges through the head", async () => {
  const context = await fixture();
  try {
    const first = context.post("question one");
    const turn = context.activate();
    await turn.call("message-present");
    turn.markSent();
    const answered = await turn.call("messages/post", {
      body: "answer one",
      basedOnRoomSeq: first.event.roomSeq,
      idempotencyKey: "catch-up-answer-1",
    });
    assert.equal(answered.status, 200);
    context.kernel.recordRuntimeTermination(context.host, {
      exit: { code: 0 },
      runAttemptId: turn.run.runAttemptId,
      runtimeRunId: turn.runtime.runtimeRunId,
    });
    context.kernel.finishRunAttempt(context.host, {
      exitCode: 0,
      runAttemptId: turn.run.runAttemptId,
      state: "exited",
    });
    context.kernel.completeActivation(context.host, {
      activationId: turn.activation.activationId,
      consumerId: "worker",
    });
    // A Channel message that wakes nobody (no recipient), then one for the worker.
    const side = context.kernel.postMessage(context.actor, {
      body: "a side remark for the room",
      idempotencyKey: "catch-up-side",
      recipients: [],
      roomId: context.room.roomId,
    });
    const second = context.post("question two");
    const run = context.activate();
    const presented = await run.call("message-present");
    assert.equal(presented.status, 200, JSON.stringify(presented.body));
    assert.equal(presented.body.fromSeq, second.event.roomSeq);
    assert.ok(presented.body.catchUpFromSeq < second.event.roomSeq);
    assert.equal(presented.body.catchUpOmittedCount, 0);
    assert.deepEqual(
      presented.body.events
        .filter((event: { type: string }) => event.type === "message.posted")
        .map((event: { payload: { body: string } }) => event.payload.body),
      ["a side remark for the room", "question two"],
    );
    assert.ok(presented.body.presentedSeqs.includes(side.event.roomSeq));
    run.markSent();
    const posted = await run.call("messages/post", {
      body: "answer two",
      basedOnRoomSeq: presented.body.presentedThroughSeq,
      idempotencyKey: "catch-up-answer-2",
    });
    assert.equal(posted.status, 200);
    assert.equal(context.cursor(), second.event.roomSeq);
  } finally {
    await context.close();
  }
});
