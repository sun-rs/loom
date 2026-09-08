import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { RoomKernel } from "@rah-os/kernel";
import { WorkerApplicationService } from "../src/index.ts";

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "rah-target-review-"));
  let now = new Date("2026-09-08T10:00:00Z");
  const k = new RoomKernel({ databasePath: join(dir, "db"), now: () => now });
  k.initialize();
  const h = k.provisionPrincipal({ kind: "human", handle: "human" }),
    a = k.provisionPrincipal({ kind: "agent", handle: "agent" }),
    actor = k.authenticateAccessToken(h.accessToken);
  const origin = k.createRoom(actor, { name: "Origin", slug: "origin" }),
    target = k.createRoom(actor, { name: "Target", slug: "target" });
  for (const r of [origin, target])
    k.addMember(actor, {
      roomId: r.roomId,
      principalId: a.principal.principalId,
    });
  k.postMessage(actor, {
    roomId: origin.roomId,
    body: "Work",
    idempotencyKey: "wake",
    recipients: [{ participantId: a.principal.principalId, reason: "mention" }],
  });
  const host = k.authenticateHostAccessToken(
    k.provisionHostCredential({
      hostId: "fake-host",
      participantIds: [a.principal.principalId],
    }).accessToken,
  );
  k.heartbeatHost(host);
  const activation = k.leaseNextActivation(host, { leaseMs: 7200000 })!;
  const run = k.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    runAttemptId: run.runAttemptId,
    runtimeRunId: "fake",
    recoveryDescriptor: { driver: "fake", recoveryKey: "fake", metadata: {} },
  };
  k.prepareRunAttemptRuntime(host, runtime);
  k.markRunAttemptRunning(host, runtime);
  const s = new WorkerApplicationService({ kernel: k, now: () => now });
  await s.start();
  const c = s.issueActivationCredential(
    host,
    {
      activationId: activation.activationId,
      consumerId: "worker",
      hostId: host.hostId,
      participantId: a.principal.principalId,
      roomId: origin.roomId,
      runAttemptId: run.runAttemptId,
      toSeq: activation.toSeq,
    },
    { ttlMs: 7200000 },
  );
  const call = async (path: string, body: unknown = {}) => {
    const r = await fetch(`${s.origin}/v1/worker/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${c.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  return {
    k,
    s,
    actor,
    target,
    origin,
    call,
    host,
    run,
    advance() {
      now = new Date(now.getTime() + 3600001);
      k.heartbeatHost(host);
    },
    async close() {
      await s.close();
      k.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("A complete Thread context exposes that Thread before authorizing a reply, even after unrelated Room traffic", async () => {
  const f = await fixture();
  try {
    const m = f.k.postMessage(f.actor, {
      roomId: f.target.roomId,
      body: "Old thread meaning",
      idempotencyKey: "root",
      recipients: [],
    });
    const thread = f.k.createThread(f.actor, {
      roomId: f.target.roomId,
      rootMessageId: m.event.aggregateId,
      recipientIds: [],
      basedOnRoomSeq: m.event.roomSeq,
      idempotencyKey: "thread",
    }).thread;
    const first = f.k.replyThread(f.actor, {
      roomId: f.target.roomId,
      threadId: thread.threadId,
      body: "Critical old thread reply",
      recipientIds: [],
      basedOnRoomSeq: f.k.sync(f.actor, {
        roomId: f.target.roomId,
        consumerId: "test",
      }).latestRoomSeq,
      idempotencyKey: "thread-reply",
    });
    for (let n = 0; n < 8; n++)
      f.k.postMessage(f.actor, {
        roomId: f.target.roomId,
        body: `Unrelated ${n}`,
        recipients: [],
        idempotencyKey: `filler-${n}`,
      });
    const context = await f.call("rooms/read", {
      channel: `#target:${thread.threadId}`,
      limit: 5,
    });
    assert.equal(context.status, 200);
    assert.equal(context.body.complete, true);
    const post = await f.call("messages/post", {
      channel: `#target:${thread.threadId}`,
      contextReceipt: context.body.contextReceipt,
      basedOnRoomSeq: context.body.throughRoomSeq,
      body: "Reply without receiving old thread",
      idempotencyKey: "post",
    });
    assert.equal(post.status, 200, JSON.stringify(post.body));
    assert.equal(
      context.body.threadContext?.rootMessage.messageId,
      m.event.aggregateId,
      "complete Thread context must present its root Message",
    );
    assert.ok(
      context.body.threadContext?.history.messages.some(
        (message: any) => message.messageId === first.event.aggregateId,
      ),
      "complete Thread context must present its bounded Thread history",
    );
  } finally {
    await f.close();
  }
});

test("Valid current Worker may recover its durable prior post after only the presentation receipt expires", async () => {
  const f = await fixture();
  try {
    const context = await f.call("rooms/read", { channel: "#target" });
    assert.equal(context.status, 200);
    const command = {
      channel: "#target",
      contextReceipt: context.body.contextReceipt,
      basedOnRoomSeq: context.body.throughRoomSeq,
      body: "Durable original",
      idempotencyKey: "post",
    };
    const posted = await f.call("messages/post", command);
    assert.equal(posted.status, 200);
    f.advance();
    const alive = await f.call("sync");
    assert.equal(alive.status, 200, JSON.stringify(alive.body));
    const retry = await f.call("messages/post", command);
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.event.eventId, posted.body.event.eventId);
    assert.equal(
      (
        await f.call("messages/post", {
          ...command,
          idempotencyKey: "expired-new",
        })
      ).status,
      403,
    );
    assert.equal(
      (await f.call("messages/post", { ...command, body: "different" })).status,
      409,
    );
    f.k.recordRuntimeTermination(f.host, {
      exit: { code: 0 },
      runAttemptId: f.run.runAttemptId,
      runtimeRunId: "fake",
    });
    f.k.finishRunAttempt(f.host, {
      runAttemptId: f.run.runAttemptId,
      state: "exited",
      exitCode: 0,
    });
    assert.equal(
      (await f.call("messages/post", command)).status,
      409,
      "terminal Run is fenced by the existing runtime owner",
    );
  } finally {
    await f.close();
  }
});

test("Busy follow-up hold exposes a usable recovery target without widening Activation delivery", async () => {
  const f = await fixture();
  try {
    const initial = await f.call("sync");
    const frozenSeq = initial.body.cursorAfter;
    f.k.postMessage(f.actor, {
      roomId: f.origin.roomId,
      body: "Also answer the follow-up",
      idempotencyKey: "busy-followup",
      recipients: [],
    });
    const held = await f.call("messages/post", {
      body: "Original work completed",
      basedOnRoomSeq: frozenSeq,
      idempotencyKey: "busy-original",
    });
    assert.equal(held.status, 200, JSON.stringify(held.body));
    assert.equal(held.body.state, "held");
    assert.equal(held.body.recoveryTarget, "#origin");
    assert.equal((await f.call("sync")).body.cursorAfter, frozenSeq);
    assert.equal(
      (
        await f.call("messages/post", {
          body: "Guessing a new cursor is forbidden",
          basedOnRoomSeq: held.body.seenUpToSeq,
          idempotencyKey: "guess",
        })
      ).status,
      409,
    );
    const reviewed = await f.call("rooms/read", {
      channel: held.body.recoveryTarget,
    });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.complete, true);
    const retry = {
      channel: held.body.recoveryTarget,
      contextReceipt: reviewed.body.contextReceipt,
      basedOnRoomSeq: reviewed.body.throughRoomSeq,
      heldDraftId: held.body.heldDraftId,
      sendDraft: true,
      idempotencyKey: "recover-original",
    };
    const posted = await f.call("messages/post", retry);
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    assert.equal(posted.body.event.payload.body, "Original work completed");
    assert.equal(
      (await f.call("messages/post", retry)).body.event.eventId,
      posted.body.event.eventId,
    );
    assert.equal((await f.call("sync")).body.cursorAfter, frozenSeq);
  } finally {
    await f.close();
  }
});
