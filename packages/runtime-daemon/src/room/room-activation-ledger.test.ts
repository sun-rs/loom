import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { RoomLedger } from "./room-ledger";
import { RoomActivationLedger } from "./room-activation-ledger";

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-activation-"));
  let now = new Date("2026-09-06T08:00:00.000Z");
  let next = 0;
  const createId = (prefix: string) => `${prefix}-${++next}`;
  const ledger = new RoomLedger(path.join(root, "room.db"), {
    createId,
    now: () => now,
  });
  ledger.provisionPrincipal({ principalId: "human-owner", handle: "owner", kind: "human" });
  ledger.provisionPrincipal({ principalId: "agent-one", handle: "agent-one", kind: "agent" });
  const created = ledger.createRoom("human-owner", {
    roomId: "room-one",
    workspaceKey: "workspace-one",
    kind: "channel",
    slug: "one",
    name: "One",
    idempotencyKey: "create-room",
  });
  ledger.addMember("human-owner", {
    roomId: "room-one",
    principalId: "agent-one",
    role: "member",
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: "add-agent",
  });
  const activations = new RoomActivationLedger(path.join(root, "room.db"), {
    createId,
    now: () => now,
  });
  return {
    activations,
    advance(ms: number) { now = new Date(now.getTime() + ms); },
    dispose() {
      activations.close();
      ledger.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function hint(hintId: string, roomSeq: number) {
  return {
    schema: "rah.room-wake.v1" as const,
    hintId,
    topic: "inbox.available" as const,
    eventId: `event-${roomSeq}`,
    participantId: "agent-one",
    reason: "mention" as const,
    roomId: "room-one",
    roomSeq,
  };
}

test("Activation ledger durably deduplicates and coalesces queued inbox wakes", () => {
  const context = fixture();
  try {
    const first = context.activations.enqueue(hint("hint-one", 3));
    const duplicate = context.activations.enqueue(hint("hint-one", 3));
    const second = context.activations.enqueue(hint("hint-two", 5));
    assert.equal(first.deduplicated, false);
    assert.equal(duplicate.deduplicated, true);
    assert.equal(duplicate.receiptId, first.receiptId);
    assert.equal(second.activation?.activationId, first.activation?.activationId);
    assert.equal(second.activation?.fromSeq, 3);
    assert.equal(second.activation?.toSeq, 5);
    assert.equal(context.activations.listPending("agent-one").length, 1);
  } finally {
    context.dispose();
  }
});

test("Activation ledger enforces one leased run per participant and explicit pull before completion", () => {
  const context = fixture();
  try {
    context.activations.enqueue(hint("hint-one", 3));
    const leased = context.activations.leaseNext("host-one", { leaseMs: 30_000 });
    assert.ok(leased?.leaseToken);
    context.activations.enqueue(hint("hint-two", 4));
    assert.equal(context.activations.leaseNext("host-two", { leaseMs: 30_000 }), undefined);
    assert.throws(
      () => context.activations.complete("host-one", leased!.activationId, leased!.leaseToken!),
      /must pull through sequence 3/,
    );
    context.activations.acknowledgePull(
      "host-one",
      leased!.activationId,
      leased!.leaseToken!,
      3,
    );
    const complete = context.activations.complete(
      "host-one",
      leased!.activationId,
      leased!.leaseToken!,
    );
    assert.equal(complete.state, "completed");
    assert.ok(context.activations.leaseNext("host-two", { leaseMs: 30_000 }));
  } finally {
    context.dispose();
  }
});

test("Activation ledger recovers expired leases into the queued lane after restart", () => {
  const context = fixture();
  try {
    context.activations.enqueue(hint("hint-one", 3));
    const leased = context.activations.leaseNext("host-one", { leaseMs: 1_000 });
    assert.ok(leased);
    context.activations.enqueue(hint("hint-two", 4));
    context.advance(1_001);
    const recovered = context.activations.leaseNext("host-two", { leaseMs: 30_000 });
    assert.equal(recovered?.fromSeq, 3);
    assert.equal(recovered?.toSeq, 4);
    assert.equal(recovered?.attemptCount, 1);
    assert.equal(context.activations.listPending("agent-one").length, 1);
  } finally {
    context.dispose();
  }
});
