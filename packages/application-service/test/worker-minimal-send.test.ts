import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { RoomKernel } from "@rah-os/kernel";
import { WorkerApplicationService } from "../src/index.ts";

/** Raft's send contract: the model supplies only a target and content. */
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "rah-minimal-send-"));
  const databasePath = join(dir, "db");
  const now = new Date("2026-09-09T10:00:00Z");
  const k = new RoomKernel({ databasePath, now: () => now });
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
    actor,
    agentId: a.principal.principalId,
    target,
    origin,
    call,
    readPosition(roomId: string, threadId: string | null = null) {
      const database = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const row = database
          .prepare(
            `SELECT through_room_seq FROM worker_target_read_positions
             WHERE participant_id=? AND room_id=? AND thread_key=?`,
          )
          .get(a.principal.principalId, roomId, threadId ?? "");
        return row === undefined ? undefined : Number(row.through_room_seq);
      } finally {
        database.close();
      }
    },
    messageCount: (roomId: string) =>
      Number(
        (
          k.sync(actor, { roomId, consumerId: `count-${roomId}` }).events ?? []
        ).filter((event: any) => event.type === "message.posted").length,
      ),
    async close() {
      await s.close();
      k.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("a minimal target send with no read position is held, and the saved draft is resent by target alone", async () => {
  const f = await fixture();
  try {
    f.k.postMessage(f.actor, {
      roomId: f.target.roomId,
      body: "Unseen human message",
      idempotencyKey: "unseen",
      recipients: [],
    });
    const held = await f.call("messages/post", {
      channel: "#target",
      body: "Reply the model composed",
    });
    assert.equal(held.status, 200);
    assert.equal(held.body.state, "held");
    assert.equal(
      held.body.recoveryTarget,
      "#target",
      "the held payload names the canonical target the CLI must echo",
    );
    assert.equal(held.body.shownMessageCount, held.body.newerMessages.length);
    assert.equal(held.body.newMessageCount, 1);
    assert.equal(held.body.reholdCount, 1);

    // Raft records the consumed sequence on a hold, so the same minimal
    // send-draft call now clears the fence without any client-carried state.
    const sent = await f.call("messages/post", {
      channel: "#target",
      sendDraft: true,
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.event.payload.body, "Reply the model composed");
  } finally {
    await f.close();
  }
});

test("sendDraft with no saved draft for the target returns Raft's typed not-found", async () => {
  const f = await fixture();
  try {
    const missing = await f.call("messages/post", {
      channel: "#target",
      sendDraft: true,
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "not_found");
    assert.match(
      missing.body.error.message,
      /^No saved draft exists for this target\./u,
    );
  } finally {
    await f.close();
  }
});

test("a minimal target send publishes, deduplicates an identical retry, and does not hold on its own message", async () => {
  const f = await fixture();
  try {
    const first = await f.call("messages/post", {
      channel: "#target",
      body: "Ping",
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.deduplicated, false);
    const messageId = first.body.event.payload.messageId;

    const retry = await f.call("messages/post", {
      channel: "#target",
      body: "Ping",
    });
    assert.equal(retry.status, 200);
    assert.equal(
      retry.body.deduplicated,
      true,
      "the derived key makes an identical retry idempotent",
    );
    assert.equal(retry.body.event.payload.messageId, messageId);

    // A different body immediately afterwards must publish, not be held behind
    // the Agent's own just-published message.
    const second = await f.call("messages/post", {
      channel: "#target",
      body: "Pong",
    });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.deduplicated, false);
    assert.notEqual(second.body.event.payload.messageId, messageId);

    // Documented rule: the read position is part of the derived key, so the
    // same body after an actual read is a genuinely separate send.
    const read = await f.call("rooms/read", { channel: "#target", limit: 20 });
    assert.equal(read.status, 200);
    const repeat = await f.call("messages/post", {
      channel: "#target",
      body: "Ping",
    });
    assert.equal(repeat.status, 200, JSON.stringify(repeat.body));
    assert.equal(repeat.body.deduplicated, false);
    assert.notEqual(repeat.body.event.payload.messageId, messageId);
  } finally {
    await f.close();
  }
});

test("an explicitly presented forged receipt is still rejected, and a stale explicit cursor still holds", async () => {
  const f = await fixture();
  try {
    const forged = await f.call("messages/post", {
      channel: "#target",
      contextReceipt: "not-a-receipt.signature",
      basedOnRoomSeq: 1,
      idempotencyKey: "forged",
      body: "Reply",
    });
    assert.equal(forged.status, 403);
    assert.match(forged.body.error.message, /target context receipt/u);

    const context = await f.call("rooms/read", {
      channel: "#target",
      limit: 20,
    });
    assert.equal(context.status, 200);
    const tampered = `${context.body.contextReceipt.split(".")[0]}.AAAA`;
    const bad = await f.call("messages/post", {
      channel: "#target",
      contextReceipt: tampered,
      basedOnRoomSeq: context.body.throughRoomSeq,
      idempotencyKey: "tampered",
      body: "Reply",
    });
    assert.equal(bad.status, 403);

    // An explicit stale cursor still produces the freshness hold, unchanged.
    f.k.postMessage(f.actor, {
      roomId: f.target.roomId,
      body: "Arrived after the read",
      idempotencyKey: "later",
      recipients: [],
    });
    const held = await f.call("messages/post", {
      channel: "#target",
      contextReceipt: context.body.contextReceipt,
      basedOnRoomSeq: context.body.throughRoomSeq,
      idempotencyKey: "explicit-stale",
      body: "Reply",
    });
    assert.equal(held.status, 200);
    assert.equal(held.body.state, "held");
    assert.equal(held.body.shownMessageCount, 1);
  } finally {
    await f.close();
  }
});

test("the originating route still works with content alone and stays fenced to the Activation head", async () => {
  const f = await fixture();
  try {
    const posted = await f.call("messages/post", { body: "Origin reply" });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    assert.equal(posted.body.event.roomId, f.origin.roomId);
    assert.equal(posted.body.event.payload.body, "Origin reply");
    const retry = await f.call("messages/post", { body: "Origin reply" });
    assert.equal(retry.body.deduplicated, true);
    const undelivered = await f.call("messages/post", {
      body: "Origin reply again",
      basedOnRoomSeq: 999,
      idempotencyKey: "explicit-unknown-cursor",
    });
    assert.equal(
      undelivered.status,
      409,
      "an explicitly presented cursor is still fenced against the credential",
    );
  } finally {
    await f.close();
  }
});

test("the stored read position advances on a read and on a hold, but never on a send", async () => {
  const f = await fixture();
  try {
    assert.equal(f.readPosition(f.target.roomId), undefined);
    const seen = f.k.postMessage(f.actor, {
      roomId: f.target.roomId,
      body: "First",
      idempotencyKey: "first",
      recipients: [],
    });
    const history = await f.call("messages/history", {
      channel: "#target",
      limit: 20,
    });
    assert.equal(history.status, 200);
    assert.equal(
      f.readPosition(f.target.roomId),
      seen.event.roomSeq,
      "a worker read of the target records what was shown",
    );

    // A send into a different target must not touch this target's position.
    await f.call("messages/post", { body: "Origin reply" });
    assert.equal(f.readPosition(f.target.roomId), seen.event.roomSeq);
    assert.equal(f.readPosition(f.origin.roomId), undefined);

    // Publishing into this very target does not advance it either.
    const sent = await f.call("messages/post", {
      channel: "#target",
      body: "Target reply",
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(
      f.readPosition(f.target.roomId),
      seen.event.roomSeq,
      "a send must never mark another participant's messages as seen",
    );

    // A hold shows the participant the messages it had not seen, and only then
    // does the position advance — Raft's recordConsumedSeqs on the held branch.
    const unseen = f.k.postMessage(f.actor, {
      roomId: f.target.roomId,
      body: "Second",
      idempotencyKey: "second",
      recipients: [],
    });
    const held = await f.call("messages/post", {
      channel: "#target",
      body: "Held reply",
    });
    assert.equal(held.body.state, "held");
    assert.equal(f.readPosition(f.target.roomId), unseen.event.roomSeq);
  } finally {
    await f.close();
  }
});

/**
 * F0909G: a compose silently discarded the freshness-held draft that carried
 * the original reply. Raft warns before it replaces a saved draft, so the send
 * response must name exactly what the server threw away — once, and only when
 * a compose actually replaced a live draft.
 */
test("a compose that replaces a live held draft reports the discarded body exactly once", async () => {
  const f = await fixture();
  try {
    f.k.postMessage(f.actor, {
      roomId: f.target.roomId,
      body: "Unseen human message",
      idempotencyKey: "unseen",
      recipients: [],
    });
    const held = await f.call("messages/post", {
      channel: "#target",
      body: "BUSY DONE",
    });
    assert.equal(held.body.state, "held");
    assert.equal(
      held.body.replacedDraft,
      undefined,
      "the first hold replaced nothing",
    );

    const replacing = await f.call("messages/post", {
      channel: "#target",
      body: "FOLLOWUP DONE",
    });
    assert.equal(replacing.status, 200, JSON.stringify(replacing.body));
    assert.equal(replacing.body.deduplicated, false);
    assert.deepEqual(replacing.body.replacedDraft, { body: "BUSY DONE" });

    const clean = await f.call("messages/post", {
      channel: "#target",
      body: "A later unrelated reply",
    });
    assert.equal(clean.status, 200, JSON.stringify(clean.body));
    assert.equal(
      clean.body.replacedDraft,
      undefined,
      "the discarded draft is reported once, not on every later send",
    );
  } finally {
    await f.close();
  }
});

test("sending the saved draft unchanged never reports it as a replaced draft", async () => {
  const f = await fixture();
  try {
    f.k.postMessage(f.actor, {
      roomId: f.target.roomId,
      body: "Unseen human message",
      idempotencyKey: "unseen",
      recipients: [],
    });
    const held = await f.call("messages/post", {
      channel: "#target",
      body: "The original result",
    });
    assert.equal(held.body.state, "held");
    const sent = await f.call("messages/post", {
      channel: "#target",
      sendDraft: true,
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.event.payload.body, "The original result");
    assert.equal(sent.body.replacedDraft, undefined);
  } finally {
    await f.close();
  }
});
