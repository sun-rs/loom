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
  ledger.addMember("human-owner", {
    roomId: "room-one",
    principalId: "agent-one",
    role: "member",
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: "add-agent",
  });
  ledger.postMessage("human-owner", {
    roomId: "room-one",
    body: "Activation source event",
    idempotencyKey: "activation-source",
  });
  const activations = new RoomActivationLedger(path.join(root, "room.db"), {
    createId,
    now: () => now,
  });
  return {
    activations,
    ledger,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
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
    disposition: "activation" as const,
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
    assert.equal(
      second.activation?.activationId,
      first.activation?.activationId,
    );
    assert.equal(second.activation?.fromSeq, 3);
    assert.equal(second.activation?.toSeq, 5);
    assert.equal(context.activations.listPending("agent-one").length, 1);
  } finally {
    context.dispose();
  }
});

test("Activation ledger splits long-running Room work into bounded ordered lanes", () => {
  const context = fixture();
  try {
    const first = context.activations.enqueue(hint("bounded-one", 3));
    const sameLane = context.activations.enqueue(hint("bounded-two", 502));
    const nextLane = context.activations.enqueue(hint("bounded-three", 503));
    assert.equal(
      sameLane.activation?.activationId,
      first.activation?.activationId,
    );
    assert.notEqual(
      nextLane.activation?.activationId,
      first.activation?.activationId,
    );
    const pending = context.activations.listPending("agent-one");
    assert.deepEqual(
      pending.map((activation) => [activation.fromSeq, activation.toSeq]),
      [
        [3, 502],
        [503, 503],
      ],
    );
    assert.equal(
      context.activations.leaseNext("bounded-host", { leaseMs: 1_000 })
        ?.activationId,
      first.activation?.activationId,
    );
  } finally {
    context.dispose();
  }
});

test("notification-only Inbox delivery never creates Agent work", () => {
  const context = fixture();
  try {
    assert.throws(
      () =>
        context.activations.enqueue({
          ...hint("notification-only", 3),
          disposition: "notification",
        }),
      /cannot create an Activation/u,
    );
    assert.deepEqual(context.activations.listPending("agent-one"), []);
  } finally {
    context.dispose();
  }
});

test("Activation ledger enforces one leased run per participant and explicit pull before completion", () => {
  const context = fixture();
  try {
    context.activations.enqueue(hint("hint-one", 3));
    const leased = context.activations.leaseNext("host-one", {
      leaseMs: 30_000,
    });
    assert.ok(leased?.leaseToken);
    context.activations.enqueue(hint("hint-two", 4));
    assert.equal(
      context.activations.leaseNext("host-two", { leaseMs: 30_000 }),
      undefined,
    );
    assert.throws(
      () =>
        context.activations.complete(
          "host-one",
          leased!.activationId,
          leased!.leaseToken!,
        ),
      /must pull through sequence 3/,
    );
    context.activations.acknowledgePull(
      "host-one",
      leased!.activationId,
      leased!.leaseToken!,
      3,
    );
    const prepared = context.activations.createRunAttempt(
      "host-one",
      leased!.activationId,
      leased!.leaseToken!,
      {
        runtimeProfileId: "fake-profile",
        provider: "fake",
        workspace: "/tmp/fake",
      },
    );
    const running = context.activations.startRunAttempt(
      "host-one",
      leased!.activationId,
      leased!.leaseToken!,
      prepared.runAttemptId,
    );
    const outcome = context.ledger.postMessage("agent-one", {
      roomId: "room-one",
      body: "canonical outcome",
      idempotencyKey: "activation-outcome",
    });
    const execution = context.activations.workerExecution(
      "host-one",
      leased!.activationId,
      leased!.leaseToken!,
      running.runAttemptId,
    );
    context.activations.recordOutcome(execution, outcome.event.eventId);
    context.activations.finishRunAttempt(
      "host-one",
      leased!.activationId,
      leased!.leaseToken!,
      running.runAttemptId,
      { state: "exited", exitCode: 0 },
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

test("Activation ledger requeues an expired bounded lane ahead of newer work", () => {
  const context = fixture();
  try {
    context.activations.enqueue(hint("hint-one", 3));
    const leased = context.activations.leaseNext("host-one", {
      leaseMs: 1_000,
    });
    assert.ok(leased);
    context.activations.enqueue(hint("hint-two", 4));
    context.advance(1_001);
    const recovered = context.activations.leaseNext("host-two", {
      leaseMs: 30_000,
    });
    assert.equal(recovered?.fromSeq, 3);
    assert.equal(recovered?.toSeq, 3);
    assert.equal(recovered?.attemptCount, 2);
    assert.equal(context.activations.listPending("agent-one").length, 2);
  } finally {
    context.dispose();
  }
});

test("Activation ledger quarantines a poison lane after bounded lease expiry retries", () => {
  const context = fixture();
  try {
    context.activations.enqueue(hint("poison-hint", 3));
    let activationId = "";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const leased = context.activations.leaseNext(`poison-host-${attempt}`, {
        leaseMs: 1_000,
      });
      assert.ok(leased);
      activationId = leased.activationId;
      assert.equal(leased.attemptCount, attempt + 1);
      context.advance(1_001);
    }
    assert.equal(
      context.activations.leaseNext("poison-host-final", { leaseMs: 1_000 }),
      undefined,
    );
    const quarantined = context.activations
      .listPending("agent-one")
      .find((activation) => activation.activationId === activationId);
    assert.equal(quarantined?.state, "quarantined");
    assert.match(quarantined?.lastError ?? "", /operator action required/u);
  } finally {
    context.dispose();
  }
});

test("expired Activation fences the old execution and terminates its active RunAttempt", () => {
  const context = fixture();
  try {
    context.activations.enqueue(hint("hint-fenced", 3));
    const first = context.activations.leaseNext("host-one", { leaseMs: 1_000 });
    assert.ok(first?.leaseToken);
    context.activations.acknowledgePull(
      "host-one",
      first!.activationId,
      first!.leaseToken!,
      first!.toSeq,
    );
    const prepared = context.activations.createRunAttempt(
      "host-one",
      first!.activationId,
      first!.leaseToken!,
      {
        runtimeProfileId: "profile-one",
        provider: "fake",
        workspace: "/tmp/fake",
      },
    );
    const running = context.activations.startRunAttempt(
      "host-one",
      first!.activationId,
      first!.leaseToken!,
      prepared.runAttemptId,
    );
    const staleExecution = context.activations.workerExecution(
      "host-one",
      first!.activationId,
      first!.leaseToken!,
      running.runAttemptId,
    );

    context.advance(1_001);
    const recovered = context.activations.leaseNext("host-two", {
      leaseMs: 30_000,
    });
    assert.ok(recovered?.leaseToken);
    const retry = context.activations.createRunAttempt(
      "host-two",
      recovered!.activationId,
      recovered!.leaseToken!,
      {
        runtimeProfileId: "profile-two",
        provider: "fake",
        workspace: "/tmp/fake",
      },
    );
    assert.equal(retry.attemptNumber, 2);
    const outcome = context.ledger.postMessage("agent-one", {
      roomId: "room-one",
      body: "stale outcome",
      idempotencyKey: "stale-outcome",
    });
    assert.throws(
      () =>
        context.activations.recordOutcome(
          staleExecution,
          outcome.event.eventId,
        ),
      /lease is not owned/,
    );
  } finally {
    context.dispose();
  }
});

test("Activation completion requires an outcome from the latest terminal RunAttempt", () => {
  const context = fixture();
  try {
    context.activations.enqueue(hint("hint-latest-outcome", 3));
    const first = context.activations.leaseNext("host-one", { leaseMs: 1_000 });
    assert.ok(first?.leaseToken);
    context.activations.acknowledgePull(
      "host-one",
      first!.activationId,
      first!.leaseToken!,
      3,
    );
    const prepared = context.activations.createRunAttempt(
      "host-one",
      first!.activationId,
      first!.leaseToken!,
      {
        runtimeProfileId: "profile-one",
        provider: "fake",
        workspace: "/tmp/fake",
      },
    );
    const running = context.activations.startRunAttempt(
      "host-one",
      first!.activationId,
      first!.leaseToken!,
      prepared.runAttemptId,
    );
    assert.equal(running.state, "running");
    context.advance(1_001);
    const second = context.activations.leaseNext("host-two", {
      leaseMs: 30_000,
    });
    assert.ok(second?.leaseToken);
    context.activations.acknowledgePull(
      "host-two",
      second!.activationId,
      second!.leaseToken!,
      second!.toSeq,
    );
    const retry = context.activations.createRunAttempt(
      "host-two",
      second!.activationId,
      second!.leaseToken!,
      {
        runtimeProfileId: "profile-two",
        provider: "fake",
        workspace: "/tmp/fake",
      },
    );
    context.activations.startRunAttempt(
      "host-two",
      second!.activationId,
      second!.leaseToken!,
      retry.runAttemptId,
    );
    context.activations.finishRunAttempt(
      "host-two",
      second!.activationId,
      second!.leaseToken!,
      retry.runAttemptId,
      { state: "failed", exitCode: 1 },
    );
    assert.throws(
      () =>
        context.activations.complete(
          "host-two",
          second!.activationId,
          second!.leaseToken!,
        ),
      /canonical outcome event/,
    );
  } finally {
    context.dispose();
  }
});

test("Activation completion cannot reuse an old outcome while a newer RunAttempt is active", () => {
  const context = fixture();
  try {
    context.activations.enqueue(hint("hint-active-retry", 3));
    const first = context.activations.leaseNext("host-one", { leaseMs: 1_000 });
    assert.ok(first?.leaseToken);
    context.activations.acknowledgePull(
      "host-one",
      first!.activationId,
      first!.leaseToken!,
      3,
    );
    const firstRun = context.activations.createRunAttempt(
      "host-one",
      first!.activationId,
      first!.leaseToken!,
      {
        runtimeProfileId: "profile-one",
        provider: "fake",
        workspace: "/tmp/fake",
      },
    );
    context.activations.startRunAttempt(
      "host-one",
      first!.activationId,
      first!.leaseToken!,
      firstRun.runAttemptId,
    );
    const outcome = context.ledger.postMessage("agent-one", {
      roomId: "room-one",
      body: "first attempt outcome",
      idempotencyKey: "active-retry-outcome",
    });
    context.activations.recordOutcome(
      context.activations.workerExecution(
        "host-one",
        first!.activationId,
        first!.leaseToken!,
        firstRun.runAttemptId,
      ),
      outcome.event.eventId,
    );
    context.activations.finishRunAttempt(
      "host-one",
      first!.activationId,
      first!.leaseToken!,
      firstRun.runAttemptId,
      { state: "exited", exitCode: 0 },
    );
    const retry = context.activations.createRunAttempt(
      "host-one",
      first!.activationId,
      first!.leaseToken!,
      {
        runtimeProfileId: "profile-two",
        provider: "fake",
        workspace: "/tmp/fake",
      },
    );
    context.activations.startRunAttempt(
      "host-one",
      first!.activationId,
      first!.leaseToken!,
      retry.runAttemptId,
    );
    assert.throws(
      () =>
        context.activations.complete(
          "host-one",
          first!.activationId,
          first!.leaseToken!,
        ),
      /terminal RunAttempt evidence/u,
    );
  } finally {
    context.dispose();
  }
});
