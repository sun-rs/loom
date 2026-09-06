import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { RoomWakeHint } from "@rah/runtime-protocol";

import { RoomLedger } from "./room-ledger";
import {
  RoomOutboxDispatcher,
  type RoomOutboxDispatcherOptions,
  type RoomWakePublisher,
} from "./room-outbox-dispatcher";

function publishers(
  publish: RoomWakePublisher,
): Pick<RoomOutboxDispatcherOptions, "publishRoomEvent" | "publishInboxWake"> {
  return {
    publishRoomEvent: (hint, context) => publish(hint, context),
    publishInboxWake: (hint, context) => publish(hint, context),
  };
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-dispatcher-"));
  const databasePath = path.join(root, "room.db");
  let now = new Date("2026-09-06T00:00:00.000Z");
  const ledger = new RoomLedger(databasePath, {
    now: () => now,
    createId: (() => {
      let next = 0;
      return (prefix: string) => `${prefix}-${++next}`;
    })(),
  });
  ledger.provisionPrincipal({
    principalId: "human-owner",
    handle: "owner",
    kind: "human",
  });
  ledger.provisionPrincipal({
    principalId: "agent-one",
    handle: "agent-one",
    kind: "agent",
  });
  const created = ledger.createRoom("human-owner", {
    roomId: "room-one",
    workspaceKey: "workspace-one",
    kind: "channel",
    slug: "one",
    name: "One",
    idempotencyKey: "create-room",
  });
  return {
    root,
    databasePath,
    ledger,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    dispose() {
      ledger.close();
      rmSync(root, { recursive: true, force: true });
    },
    created,
  };
}

test("Room dispatcher publishes only content-free hints and completes durable outbox rows", async () => {
  const context = fixture();
  try {
    const added = context.ledger.addMember("human-owner", {
      roomId: "room-one",
      principalId: "agent-one",
      role: "member",
      basedOnRoomSeq: context.created.event.roomSeq,
      idempotencyKey: "add-agent",
    });
    context.ledger.postMessage("human-owner", {
      roomId: "room-one",
      body: "this body must never enter a wake hint",
      mentionedPrincipalIds: ["agent-one"],
      idempotencyKey: "post-message",
    });
    assert.equal(added.event.roomSeq, 2);
    const hints: RoomWakeHint[] = [];
    const dispatcher = new RoomOutboxDispatcher({
      ledger: context.ledger,
      workerId: "dispatcher-one",
      batchSize: 10,
      ...publishers(async (hint, { attemptId }) => {
        hints.push(hint);
        return { status: "accepted", receiptId: `receipt-${attemptId}` };
      }),
    });

    assert.deepEqual(await dispatcher.dispatchOnce(), {
      claimed: 4,
      published: 4,
      failed: 0,
      blocked: 0,
    });
    assert.deepEqual(
      hints.map((hint) => hint.topic),
      ["room.event", "room.event", "room.event", "inbox.available"],
    );
    assert.doesNotMatch(JSON.stringify(hints), /this body must never/u);
    assert.equal(
      context.ledger.listOutbox().every((entry) => Boolean(entry.publishedAt)),
      true,
    );
    await dispatcher.close();
  } finally {
    context.dispose();
  }
});

test("Room dispatcher retains only the newest published hint receipts", async () => {
  const context = fixture();
  try {
    for (let index = 0; index < 5; index += 1) {
      context.ledger.postMessage("human-owner", {
        roomId: "room-one",
        body: `retention message ${index}`,
        idempotencyKey: `retention-message-${index}`,
      });
    }
    const dispatcher = new RoomOutboxDispatcher({
      ledger: context.ledger,
      workerId: "dispatcher-retention",
      batchSize: 6,
      publishedRetention: 2,
      pruneBatchSize: 500,
      ...publishers((_hint, { attemptId }) => ({
        status: "accepted",
        receiptId: `receipt-${attemptId}`,
      })),
    });

    assert.equal((await dispatcher.dispatchOnce()).published, 6);
    const retained = context.ledger.listOutbox();
    assert.deepEqual(
      retained.map((entry) => entry.outboxSeq),
      [5, 6],
    );
    assert.equal(
      retained.every((entry) => Boolean(entry.publishedAt)),
      true,
    );
    await dispatcher.close();
  } finally {
    context.dispose();
  }
});

test("Room dispatcher repairs published receipt retention after an idle restart", async () => {
  const context = fixture();
  try {
    for (let index = 0; index < 5; index += 1) {
      context.ledger.postMessage("human-owner", {
        roomId: "room-one",
        body: `restart retention message ${index}`,
        idempotencyKey: `restart-retention-message-${index}`,
      });
    }
    const publisher = new RoomOutboxDispatcher({
      ledger: context.ledger,
      workerId: "dispatcher-before-restart",
      batchSize: 6,
      publishedRetention: 100,
      ...publishers((_hint, { attemptId }) => ({
        status: "accepted",
        receiptId: `receipt-${attemptId}`,
      })),
    });
    assert.equal((await publisher.dispatchOnce()).published, 6);
    assert.equal(context.ledger.listOutbox().length, 6);
    await publisher.close();

    const recovered = new RoomOutboxDispatcher({
      ledger: context.ledger,
      workerId: "dispatcher-after-restart",
      publishedRetention: 2,
      pruneBatchSize: 500,
      ...publishers(() => {
        throw new Error("idle recovery must not publish completed entries");
      }),
    });
    assert.deepEqual(await recovered.dispatchOnce(), {
      claimed: 0,
      published: 0,
      failed: 0,
      blocked: 0,
    });
    assert.deepEqual(
      context.ledger.listOutbox().map((entry) => entry.outboxSeq),
      [5, 6],
    );
    await recovered.close();
  } finally {
    context.dispose();
  }
});

test("Room dispatcher persists bounded retry state and recovers after backoff", async () => {
  const context = fixture();
  try {
    let attempts = 0;
    const dispatcher = new RoomOutboxDispatcher({
      ledger: context.ledger,
      workerId: "dispatcher-retry",
      baseRetryMs: 1_000,
      maxRetryMs: 8_000,
      jitterRatio: 0,
      now: () => new Date("2026-09-06T00:00:00.000Z"),
      ...publishers(async (_hint, { attemptId }) => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary sink failure");
        return { status: "accepted", receiptId: `receipt-${attemptId}` };
      }),
    });

    assert.deepEqual(await dispatcher.dispatchOnce(), {
      claimed: 1,
      published: 0,
      failed: 1,
      blocked: 0,
    });
    const failed = context.ledger.listOutbox()[0]!;
    assert.equal(failed.attemptCount, 1);
    assert.equal(failed.lastError, "temporary sink failure");
    assert.equal(failed.availableAt, "2026-09-06T00:00:01.000Z");
    assert.deepEqual(await dispatcher.dispatchOnce(), {
      claimed: 0,
      published: 0,
      failed: 0,
      blocked: 0,
    });

    context.advance(1_000);
    assert.deepEqual(await dispatcher.dispatchOnce(), {
      claimed: 1,
      published: 1,
      failed: 0,
      blocked: 0,
    });
    assert.equal(context.ledger.listOutbox()[0]?.attemptCount, 2);
    await dispatcher.close();
  } finally {
    context.dispose();
  }
});

test("Room dispatcher permanently blocks invalid payload data before publication", async () => {
  const context = fixture();
  try {
    const database = new DatabaseSync(context.databasePath);
    database
      .prepare("UPDATE room_outbox SET payload_json = ? WHERE outbox_seq = 1")
      .run(
        JSON.stringify({
          eventId: "event-3",
          roomId: "room-one",
          roomSeq: 1,
          type: "room.created",
          body: "must not leak",
        }),
      );
    database.close();
    let published = false;
    const dispatcher = new RoomOutboxDispatcher({
      ledger: context.ledger,
      workerId: "dispatcher-malformed",
      jitterRatio: 0,
      now: () => new Date("2026-09-06T00:00:00.000Z"),
      ...publishers(async (_hint, { attemptId }) => {
        published = true;
        return { status: "accepted", receiptId: `receipt-${attemptId}` };
      }),
    });

    assert.deepEqual(await dispatcher.dispatchOnce(), {
      claimed: 1,
      published: 0,
      failed: 0,
      blocked: 1,
    });
    assert.equal(published, false);
    const invalid = context.ledger.listOutbox()[0];
    assert.match(invalid?.lastError ?? "", /unknown field body/u);
    assert.equal(invalid?.failureClass, "invalid_payload");
    assert.equal(invalid?.sticky, true);
    assert.match(invalid?.actionRequired ?? "", /repair or discard/u);
    assert.equal((await dispatcher.dispatchOnce()).claimed, 0);
    await dispatcher.close();
  } finally {
    context.dispose();
  }
});

test("Room dispatcher shutdown aborts an active publish and leaves durable retry work", async () => {
  const context = fixture();
  try {
    let entered = false;
    const dispatcher = new RoomOutboxDispatcher({
      ledger: context.ledger,
      workerId: "dispatcher-shutdown",
      idleDelayMs: 10,
      jitterRatio: 0,
      ...publishers(
        (_hint, { signal }) =>
          new Promise((_resolve, reject) => {
            entered = true;
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          }),
      ),
    });
    dispatcher.start();
    while (!entered) await new Promise((resolve) => setTimeout(resolve, 1));
    await dispatcher.close();

    const entry = context.ledger.listOutbox()[0]!;
    assert.equal(entry.publishedAt, undefined);
    assert.equal(entry.leaseOwner, undefined);
    assert.match(entry.lastError ?? "", /stopped/u);
    assert.equal(dispatcher.status().running, false);
  } finally {
    context.dispose();
  }
});

test("Room dispatcher claims one entry at a time so slow publication cannot expire later leases", async () => {
  const context = fixture();
  try {
    context.ledger.addMember("human-owner", {
      roomId: "room-one",
      principalId: "agent-one",
      role: "member",
      basedOnRoomSeq: context.created.event.roomSeq,
      idempotencyKey: "slow-lease-member",
    });
    context.ledger.postMessage("human-owner", {
      roomId: "room-one",
      body: "one",
      mentionedPrincipalIds: ["agent-one"],
      idempotencyKey: "slow-lease-message-1",
    });
    context.ledger.postMessage("human-owner", {
      roomId: "room-one",
      body: "two",
      mentionedPrincipalIds: ["agent-one"],
      idempotencyKey: "slow-lease-message-2",
    });
    const published: string[] = [];
    const dispatcher = new RoomOutboxDispatcher({
      ledger: context.ledger,
      workerId: "slow-worker",
      batchSize: 20,
      leaseMs: 1_000,
      publishTimeoutMs: 900,
      now: () => new Date("2026-09-06T00:00:00.000Z"),
      ...publishers(async (hint, { attemptId }) => {
        published.push(hint.hintId);
        context.advance(600);
        return { status: "accepted", receiptId: `receipt-${attemptId}` };
      }),
    });

    const result = await dispatcher.dispatchOnce();
    assert.equal(result.claimed, 6);
    assert.equal(result.published, 6);
    assert.equal(result.failed, 0);
    assert.equal(result.blocked, 0);
    assert.equal(new Set(published).size, 6);
    assert.equal(
      context.ledger.listOutbox().filter((entry) => entry.publishedAt).length,
      6,
    );
  } finally {
    context.dispose();
  }
});

test("Room ledger quarantines malformed JSON without blocking later outbox work", async () => {
  const context = fixture();
  try {
    context.ledger.postMessage("human-owner", {
      roomId: "room-one",
      body: "later valid event",
      idempotencyKey: "poison-row-later-message",
    });
    const database = new DatabaseSync(context.databasePath);
    database
      .prepare("UPDATE room_outbox SET payload_json = ? WHERE outbox_seq = 1")
      .run("not-json");
    database.close();
    const published: string[] = [];
    const dispatcher = new RoomOutboxDispatcher({
      ledger: context.ledger,
      workerId: "poison-worker",
      batchSize: 10,
      now: () => new Date("2026-09-06T00:00:00.000Z"),
      ...publishers((hint, { attemptId }) => {
        published.push(hint.hintId);
        return { status: "accepted", receiptId: `receipt-${attemptId}` };
      }),
    });

    const result = await dispatcher.dispatchOnce();
    assert.equal(result.claimed, 1);
    assert.equal(result.published, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.blocked, 0);
    const entries = context.ledger.listOutbox();
    assert.deepEqual(published, [entries[1]!.outboxId]);
    assert.equal(entries[0]?.quarantinedAt, "2026-09-06T00:00:00.000Z");
    assert.match(entries[0]?.lastError ?? "", /payload_json.*valid JSON/i);
    assert.equal(entries[0]?.attemptCount, 0);
    assert.ok(entries[1]?.publishedAt);
  } finally {
    context.dispose();
  }
});

test("Room dispatcher persists structured retry and blocked outcomes", async () => {
  const retryContext = fixture();
  try {
    const retry = new RoomOutboxDispatcher({
      ledger: retryContext.ledger,
      workerId: "structured-retry",
      jitterRatio: 0,
      now: () => new Date("2026-09-06T00:00:00.000Z"),
      ...publishers(() => ({
        status: "retry",
        failureClass: "busy",
        retryAfterMs: 4_000,
        message: "host is busy",
      })),
    });
    assert.deepEqual(await retry.dispatchOnce(), {
      claimed: 1,
      published: 0,
      failed: 1,
      blocked: 0,
    });
    const retried = retryContext.ledger.listOutbox()[0]!;
    assert.equal(retried.failureClass, "busy");
    assert.equal(retried.availableAt, "2026-09-06T00:00:04.000Z");
  } finally {
    retryContext.dispose();
  }

  const blockedContext = fixture();
  try {
    const blocked = new RoomOutboxDispatcher({
      ledger: blockedContext.ledger,
      workerId: "structured-blocked",
      ...publishers(() => ({
        status: "blocked",
        failureClass: "auth_revoked",
        actionRequired: "Reconnect the Agent provider",
        sticky: true,
        message: "Agent credentials were revoked",
      })),
    });
    assert.deepEqual(await blocked.dispatchOnce(), {
      claimed: 1,
      published: 0,
      failed: 0,
      blocked: 1,
    });
    const entry = blockedContext.ledger.listOutbox()[0]!;
    assert.equal(entry.failureClass, "auth_revoked");
    assert.equal(entry.actionRequired, "Reconnect the Agent provider");
    assert.equal(entry.sticky, true);
    assert.equal(entry.leaseOwner, undefined);
    assert.ok(entry.blockedAt);
    assert.deepEqual(await blocked.dispatchOnce(), {
      claimed: 0,
      published: 0,
      failed: 0,
      blocked: 0,
    });
  } finally {
    blockedContext.dispose();
  }
});
