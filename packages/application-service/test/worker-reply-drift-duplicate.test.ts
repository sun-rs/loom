import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";
import { shortWorkerRef } from "@rah-os/protocol";

import { WorkerApplicationService } from "../src/index.ts";

/**
 * Kimi drift evidence (2026-09-25, round 9 right after compaction): the model
 * ran the wake's exact `message-post --target "#drift" --based-on-room-seq N
 * --final`. The Raft thread-context confirmation (the previous round was a
 * Thread Q&A) refused it and saved a draft; `--send-draft` then posted without
 * the causal marker and `--final`, delivery stayed unacknowledged, the
 * Activation retried and the same answer was posted twice.
 */
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-reply-drift-dup-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  kernel.initialize();
  const database = new DatabaseSync(join(directory, "room.db"));
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const agent = kernel.provisionPrincipal({ handle: "worker", kind: "agent" });
  const agentId = agent.principal.principalId;
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Drift", slug: "drift" });
  kernel.addMember(actor, { roomId: room.roomId, principalId: agentId });
  const head = () =>
    Number(
      database
        .prepare("SELECT next_seq - 1 AS n FROM rooms WHERE room_id=?")
        .get(room.roomId)!.n,
    );
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
    database,
    head,
    host,
    kernel,
    post,
    room,
    thread: (rootMessageId: string) =>
      kernel.createThread(actor, {
        roomId: room.roomId,
        rootMessageId,
        recipientIds: [],
        idempotencyKey: `thread-${++sequence}`,
        basedOnRoomSeq: head(),
      }),
    reply: (threadId: string, body: string) =>
      kernel.replyThread(actor, {
        roomId: room.roomId,
        threadId,
        body,
        idempotencyKey: `reply-${++sequence}`,
        recipientIds: [agentId],
        basedOnRoomSeq: head(),
      }),
    cursor: () =>
      Number(
        database
          .prepare(
            "SELECT last_seq AS n FROM subscription_cursors WHERE room_id=? AND participant_id=? AND consumer_id='worker'",
          )
          .get(room.roomId, agentId)?.n ?? 0,
      ),
    agentPosts: () =>
      kernel
        .sync(actor, { roomId: room.roomId, consumerId: `audit-${++sequence}` })
        .events.filter(
          (event: any) =>
            event.type === "message.posted" && event.actorId === agentId,
        ),
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
      const present = async () => {
        const presented = await call("message-present");
        kernel.markPresentedDeliverySent(host, {
          activationId: activation.activationId,
          consumerId: "worker",
          runAttemptId: run.runAttemptId,
        });
        return presented;
      };
      /** The runtime exits; returns the completion refusal, if any. */
      const end = () => {
        kernel.recordRuntimeTermination(host, {
          exit: { code: 0 },
          runAttemptId: run.runAttemptId,
          runtimeRunId: runtime.runtimeRunId,
        });
        kernel.finishRunAttempt(host, {
          runAttemptId: run.runAttemptId,
          state: "exited",
          exitCode: 0,
        });
        try {
          kernel.completeActivation(host, {
            activationId: activation.activationId,
            consumerId: "worker",
          });
          return undefined;
        } catch (error) {
          return (error as Error).message;
        }
      };
      const finalMarker = () =>
        kernel.finalReplies.read(host, { runAttemptId: run.runAttemptId });
      return { activation, call, end, finalMarker, present, run };
    },
    async close() {
      await service.close();
      database.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** Round 1: a Thread Q&A the Agent reads and answers in the Thread. */
async function threadRound(
  f: Awaited<ReturnType<typeof fixture>>,
  options: { end?: boolean } = {},
) {
  const root = f.post("thread root", false);
  const created = f.thread(root.event.aggregateId);
  f.reply(created.thread.threadId, "question in the thread");
  const run = f.activate();
  await run.present();
  const threadTarget = `#drift:${shortWorkerRef(created.thread.threadId)}`;
  assert.equal(
    (await run.call("rooms/read", { channel: threadTarget })).status,
    200,
  );
  const answered = await run.call("messages/post", {
    channel: threadTarget,
    body: "thread answer",
    basedOnRoomSeq: run.activation.toSeq,
    final: true,
  });
  assert.equal(answered.status, 200, JSON.stringify(answered.body));
  if (options.end !== false)
    assert.equal(run.end(), undefined, "round 1 completes");
  return run;
}

test("after a Thread round, the wake's channel reply with based-on and --final posts directly (no confirmation draft)", async () => {
  const f = await fixture();
  try {
    await threadRound(f);
    f.post("new channel question");
    const run = f.activate();
    await run.present();
    const posted = await run.call("messages/post", {
      channel: "#drift",
      body: "channel answer",
      basedOnRoomSeq: run.activation.toSeq,
      final: true,
    });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    assert.equal(
      posted.body.state,
      undefined,
      "the Kernel reply-target guard judged this reply; no confirmation",
    );
    assert.equal(posted.body.event.payload.body, "channel answer");
    assert.equal(posted.body.event.payload.threadId, undefined);
    assert.ok(f.cursor() >= run.activation.toSeq, "delivery acknowledged");
    assert.equal(run.finalMarker()?.eventId, posted.body.event.eventId);
    assert.equal(
      f.database.prepare("SELECT COUNT(*) AS n FROM held_message_drafts").get()!
        .n,
      0,
      "no draft was saved",
    );
    assert.equal(run.end(), undefined);
  } finally {
    await f.close();
  }
});

test("a deliberate uncited top-level post after a Thread reply is still confirmed once", async () => {
  const f = await fixture();
  try {
    const run = await threadRound(f, { end: false });
    // The Thread reply confirmed delivery; this post cites nothing, so the
    // reply-target guard does not judge it and Raft's confirmation applies.
    assert.ok(f.cursor() >= run.activation.toSeq);
    const refused = await run.call("messages/post", {
      channel: "#drift",
      body: "unrelated top-level note",
    });
    assert.equal(refused.status, 200, JSON.stringify(refused.body));
    assert.equal(refused.body.state, "target_confirmation_required");
  } finally {
    await f.close();
  }
});

test("--send-draft resends a held reply with its based-on seq and --final: delivery is acknowledged and the final marker recorded", async () => {
  const f = await fixture();
  try {
    f.post("channel question");
    const run = f.activate();
    await run.present();
    // A newer message arrives before the reply: the reply is held as a draft.
    f.post("one more thing", false);
    const held = await run.call("messages/post", {
      channel: "#drift",
      body: "the answer",
      basedOnRoomSeq: run.activation.toSeq,
      final: true,
    });
    assert.equal(held.status, 200, JSON.stringify(held.body));
    assert.equal(held.body.state, "held");
    assert.equal(f.cursor() < run.activation.toSeq, true);
    // The model reviews the newer message, then sends the draft unchanged,
    // exactly as the hold guidance says: no based-on, no --final.
    assert.equal(
      (await run.call("rooms/read", { channel: "#drift" })).status,
      200,
    );
    const sent = await run.call("messages/post", {
      channel: "#drift",
      sendDraft: true,
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.event.payload.body, "the answer");
    assert.ok(
      f.cursor() >= run.activation.toSeq,
      "the resent draft acknowledges delivery like the original would have",
    );
    assert.equal(run.finalMarker()?.eventId, sent.body.event.eventId);
    assert.equal(run.end(), undefined, "the Activation completes, no retry");
    assert.equal(f.agentPosts().length, 1);
  } finally {
    await f.close();
  }
});

test("a retry after a committed but unacknowledged reply names that reply in the rendered window", async () => {
  const f = await fixture();
  try {
    f.post("channel question");
    const first = f.activate();
    await first.present();
    // Committed without a causal marker (the old --send-draft outcome).
    const posted = await first.call("messages/post", {
      channel: "#drift",
      body: "the answer",
    });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    const failure = first.end();
    assert.match(failure ?? "", /not acknowledged/u);
    f.kernel.retryActivation(f.host, {
      activationId: first.activation.activationId,
      error: failure!,
      retryAfterMs: 0,
    });
    const second = f.activate();
    const presented = await second.present();
    assert.equal(presented.status, 200, JSON.stringify(presented.body));
    assert.equal(presented.body.previousAttemptUnconfirmed, undefined);
    assert.equal(
      presented.body.previousAttemptReplyMessageId,
      posted.body.event.aggregateId,
    );
  } finally {
    await f.close();
  }
});
