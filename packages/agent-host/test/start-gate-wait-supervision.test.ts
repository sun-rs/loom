import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";

import {
  AgentHost,
  AgentStartGate,
  createKernelAgentHostControlPort,
  FakeRuntimeAdapter,
} from "../src/index.ts";

/**
 * Evo review P1-1: a claimed Activation that waits in the start gate is still
 * supervised — its lease is maintained, a cancellation or a daemon drain
 * removes it from the gate before any runtime is spawned. Fake clock, fake
 * runtime, temporary database; conclusions are read from room.db.
 */

const LEASE_MS = 60_000;
const RENEW_MS = 20_000;

function fixture(slug: string) {
  const directory = mkdtempSync(join(tmpdir(), `loom-gate-wait-${slug}-`));
  const databasePath = join(directory, "room.db");
  let nowMs = Date.parse("2026-09-26T00:00:00.000Z");
  const kernel = new RoomKernel({
    databasePath,
    now: () => new Date(nowMs),
  });
  kernel.initialize();
  const human = kernel.provisionPrincipal({
    handle: `${slug}-human`,
    kind: "human",
  });
  const agent = kernel.provisionPrincipal({
    handle: `${slug}-agent`,
    kind: "agent",
  });
  const humanActor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(humanActor, { name: slug, slug });
  kernel.addMember(humanActor, {
    principalId: agent.principal.principalId,
    roomId: room.roomId,
  });
  const credential = kernel.provisionHostCredential({
    hostId: `${slug}-host`,
    participantIds: [agent.principal.principalId],
  });
  const hostContext = kernel.authenticateHostAccessToken(
    credential.accessToken,
  );
  kernel.heartbeatHost(hostContext);

  // One start slot, already held: the Agent's lane must queue behind it.
  const gate = new AgentStartGate({
    maxConcurrentStarts: 1,
    minStartIntervalMs: 0,
  });
  let releaseOccupant = (): void => {};
  const occupantReleased = new Promise<void>((resolve) => {
    releaseOccupant = resolve;
  });
  const occupant = gate.runStart("occupying-agent", async () => {
    await occupantReleased;
  });

  // Maintenance waits resolve only when the test advances the clock.
  const pendingWaits = new Set<() => void>();
  const maintenanceWait = (_delayMs: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      const done = () => {
        pendingWaits.delete(done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      pendingWaits.add(done);
      signal.addEventListener("abort", done, { once: true });
    });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 25));
  const advance = async (ms: number) => {
    nowMs += ms;
    for (const done of [...pendingWaits]) done();
    await settle();
  };

  const agentActor = kernel.authenticateAccessToken(agent.accessToken);
  const starts: string[] = [];
  const runtime = new FakeRuntimeAdapter({
    onStart: (input) => {
      starts.push(input.activationId);
      const delivery = kernel.sync(agentActor, {
        consumerId: input.consumerId,
        roomId: input.roomId,
      });
      kernel.acknowledgeCursor(agentActor, {
        consumerId: input.consumerId,
        roomId: input.roomId,
        throughSeq: delivery.cursorAfter,
      });
    },
  });
  const host = new AgentHost({
    control: createKernelAgentHostControlPort(kernel, hostContext),
    host: hostContext,
    leaseMs: LEASE_MS,
    leaseRenewIntervalMs: RENEW_MS,
    maintenanceWait,
    now: () => nowMs,
    runtime,
    startGate: gate,
    wait: async () => {
      await settle();
    },
  });
  const sql = (query: string, ...parameters: string[]) => {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      return database.prepare(query).all(...parameters);
    } finally {
      database.close();
    }
  };
  return {
    advance,
    agent,
    close: () => {
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
    databasePath,
    gate,
    host,
    human,
    humanActor,
    kernel,
    occupant,
    releaseOccupant,
    room,
    settle,
    sql,
    starts,
  };
}

function wake(state: ReturnType<typeof fixture>, key: string) {
  state.kernel.postMessage(state.humanActor, {
    body: "Wake the Agent behind an occupied start gate",
    idempotencyKey: key,
    recipients: [
      { participantId: state.agent.principal.principalId, reason: "mention" },
    ],
    roomId: state.room.roomId,
  });
}

/** Settles `promise` or reports that it is still pending after `ms`. */
async function within<T>(promise: Promise<T>, ms: number) {
  let timer: NodeJS.Timeout | undefined;
  const pending = new Promise<"pending">((resolve) => {
    timer = setTimeout(() => resolve("pending"), ms);
  });
  try {
    return await Promise.race([promise.then((value) => ({ value })), pending]);
  } finally {
    clearTimeout(timer);
  }
}

test("a claimed Activation that waits in the start gate longer than its lease still starts, with no failed Run and no retry count", async () => {
  const state = fixture("gate-wait-lease");
  try {
    wake(state, "gate-wait-lease-message");
    const cycle = state.host.reconcileOnce();
    await state.settle();
    assert.deepEqual(state.starts, [], "the lane is parked in the gate");
    // 80 s in the queue with a 60 s lease.
    for (let step = 0; step < 4; step += 1) await state.advance(RENEW_MS);
    assert.deepEqual(state.starts, []);
    state.releaseOccupant();
    await state.occupant;
    const result = await cycle;
    assert.equal(result.state, "completed", JSON.stringify(result));
    assert.equal(state.starts.length, 1);
    const attempts = state.sql("SELECT state, error FROM run_attempts");
    assert.deepEqual(
      attempts.map((row) => String(row.state)),
      ["exited"],
      JSON.stringify(attempts),
    );
    assert.deepEqual(state.sql("SELECT * FROM activation_retry_fences"), []);
    const activations = state.sql(
      "SELECT state, last_error FROM activations WHERE participant_id = ?",
      state.agent.principal.principalId,
    );
    assert.deepEqual(
      activations.map((row) => [String(row.state), row.last_error]),
      [["completed", null]],
    );
  } finally {
    state.close();
  }
});

test("a cancellation requested while the Activation waits in the start gate ends it without starting a runtime, while the slot is still held", async () => {
  const state = fixture("gate-wait-cancel");
  try {
    const task = state.kernel.createTask(state.humanActor, {
      idempotencyKey: "gate-wait-cancel-task",
      roomId: state.room.roomId,
      title: "Work the Human cancels before it starts",
    });
    wake(state, "gate-wait-cancel-message");
    const cycle = state.host.reconcileOnce();
    await state.settle();
    assert.deepEqual(state.starts, []);
    const leased = state.sql(
      "SELECT activation_id, attempt_count FROM activations WHERE participant_id = ? AND state = 'leased'",
      state.agent.principal.principalId,
    );
    assert.equal(leased.length, 1);
    // Seed the durable cancellation request a Task cancel records for the
    // Activation that holds the lease (Task cancel paths are tested in Kernel).
    const writable = new DatabaseSync(state.databasePath);
    try {
      writable
        .prepare(
          `INSERT INTO activation_cancellation_requests(request_id, activation_id,
             activation_attempt_number, room_id, task_id, participant_id,
             requested_by, reason, requested_at)
           VALUES('gate-wait-cancel', ?, ?, ?, ?, ?, ?, 'Human cancelled the Task', ?)`,
        )
        .run(
          String(leased[0]!.activation_id),
          Number(leased[0]!.attempt_count),
          state.room.roomId,
          task.task.taskId,
          state.agent.principal.principalId,
          state.human.principal.principalId,
          new Date().toISOString(),
        );
    } finally {
      writable.close();
    }
    await state.advance(RENEW_MS);
    const settled = await within(cycle, 2_000);
    assert.notEqual(
      settled,
      "pending",
      "the cancelled lane leaves the gate before the slot frees",
    );
    assert.equal(
      settled !== "pending" && settled.value.state,
      "cancelled",
      JSON.stringify(settled),
    );
    assert.deepEqual(state.starts, [], "no runtime was started");
    assert.deepEqual(state.gate.snapshot().queuedAgentIds, []);
    assert.deepEqual(
      state.sql("SELECT state FROM run_attempts").map((row) => row.state),
      ["cancelled"],
    );
    state.releaseOccupant();
    await state.occupant;
  } finally {
    state.close();
  }
});

test("a daemon drain does not wait for a lane queued in the start gate to be admitted, and starts no runtime for it", async () => {
  const state = fixture("gate-wait-drain");
  try {
    wake(state, "gate-wait-drain-message");
    const shutdown = new AbortController();
    const running = state.host.run({ signal: shutdown.signal });
    await state.settle();
    await state.settle();
    assert.equal(state.gate.snapshot().queuedAgentIds.length, 1);
    shutdown.abort();
    const stopped = await within(running, 2_000);
    assert.notEqual(
      stopped,
      "pending",
      "the Host stops while the start slot is still held",
    );
    assert.deepEqual(state.starts, [], "no runtime was started");
    assert.deepEqual(state.gate.snapshot().queuedAgentIds, []);
    assert.deepEqual(
      state
        .sql("SELECT state FROM run_attempts")
        .filter((row) => row.state === "starting" || row.state === "running"),
      [],
      "no RunAttempt is left open",
    );
    state.releaseOccupant();
    await state.occupant;
  } finally {
    state.close();
  }
});
