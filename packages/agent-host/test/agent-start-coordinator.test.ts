import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentStartCoordinator,
  AgentStartGate,
  DEFAULT_AGENT_START_INTERVAL_MS,
  DEFAULT_MAX_CONCURRENT_AGENT_STARTS,
  resolveAgentStartSchedulerSettings,
} from "../src/agent-start-coordinator.ts";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve = (): void => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test("the start scheduler keeps Raft's defaults", () => {
  assert.equal(DEFAULT_MAX_CONCURRENT_AGENT_STARTS, 5);
  assert.equal(DEFAULT_AGENT_START_INTERVAL_MS, 500);
  assert.deepEqual(resolveAgentStartSchedulerSettings(undefined, {}), {
    maxConcurrentStarts: 5,
    minStartIntervalMs: 500,
  });
  assert.deepEqual(
    resolveAgentStartSchedulerSettings(undefined, {
      RAH_DAEMON_AGENT_START_INTERVAL_MS: "0",
      RAH_DAEMON_MAX_CONCURRENT_AGENT_STARTS: "2",
    }),
    { maxConcurrentStarts: 2, minStartIntervalMs: 0 },
  );
  assert.deepEqual(
    resolveAgentStartSchedulerSettings(
      { maxConcurrentStarts: 3, minStartIntervalMs: 7 },
      { RAH_DAEMON_MAX_CONCURRENT_AGENT_STARTS: "99" },
    ),
    { maxConcurrentStarts: 3, minStartIntervalMs: 7 },
  );
});

test("one Agent may never be queued twice or queued while starting", () => {
  const coordinator = new AgentStartCoordinator({
    maxConcurrentStarts: 2,
    minStartIntervalMs: 0,
  });
  const item = {
    agentId: "agent-a",
    enqueuedAtMs: 0,
    reject: () => {},
    resolve: () => {},
  };
  coordinator.enqueue(item);
  assert.throws(() => coordinator.enqueue({ ...item }), /already queued/);
  assert.equal(coordinator.dequeue().kind, "item");
  coordinator.markStarting("agent-a");
  assert.throws(() => coordinator.enqueue({ ...item }), /already starting/);
  coordinator.clearStarting("agent-a");
  coordinator.enqueue({ ...item });
  assert.equal(coordinator.hasQueued("agent-a"), true);
});

test("the gate never lets more Agents start at once than its capacity", async () => {
  const gate = new AgentStartGate({
    maxConcurrentStarts: 2,
    minStartIntervalMs: 0,
  });
  const gates = [deferred(), deferred(), deferred(), deferred()];
  let inFlight = 0;
  let peak = 0;
  const started: string[] = [];
  const runs = gates.map((held, index) =>
    gate.runStart(`agent-${index}`, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      started.push(`agent-${index}`);
      await held.promise;
      inFlight -= 1;
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(peak, 2);
  assert.deepEqual(started, ["agent-0", "agent-1"]);
  for (const held of gates) held.resolve();
  await Promise.all(runs);
  assert.equal(peak, 2);
  assert.deepEqual(started, ["agent-0", "agent-1", "agent-2", "agent-3"]);
  assert.deepEqual(gate.snapshot(), {
    activeStarts: 0,
    maxConcurrentStarts: 2,
    minStartIntervalMs: 0,
    pumpTimerActive: false,
    queueDepth: 0,
    queuedAgentIds: [],
    startingAgentIds: [],
  });
});

test("three Agents woken together are spaced by the minimum start interval", async () => {
  const intervalMs = 40;
  const gate = new AgentStartGate({
    maxConcurrentStarts: 5,
    minStartIntervalMs: intervalMs,
  });
  const startedAt: number[] = [];
  await Promise.all(
    ["agent-a", "agent-b", "agent-c"].map((agentId) =>
      gate.runStart(agentId, async () => {
        startedAt.push(Date.now());
      }),
    ),
  );
  assert.equal(startedAt.length, 3);
  for (let index = 1; index < startedAt.length; index += 1) {
    const gap = (startedAt[index] ?? 0) - (startedAt[index - 1] ?? 0);
    assert.ok(
      gap >= intervalMs,
      `start ${index} came ${gap}ms after the previous one; expected at least ${intervalMs}ms`,
    );
  }
});

test("a failed start still releases its slot and pumps the queue", async () => {
  const gate = new AgentStartGate({
    maxConcurrentStarts: 1,
    minStartIntervalMs: 0,
  });
  await assert.rejects(
    gate.runStart("agent-a", async () => {
      throw new Error("spawn failed");
    }),
    /spawn failed/,
  );
  assert.equal(gate.snapshot().activeStarts, 0);
  await gate.runStart("agent-b", async () => {});
  assert.equal(gate.snapshot().queueDepth, 0);
});

test("cancelling the gate rejects everything still queued", async () => {
  const gate = new AgentStartGate({
    maxConcurrentStarts: 1,
    minStartIntervalMs: 0,
  });
  const held = deferred();
  const running = gate.runStart("agent-a", async () => {
    await held.promise;
  });
  const queued = gate.runStart("agent-b", async () => {
    throw new Error("must never start");
  });
  await new Promise((resolve) => setImmediate(resolve));
  gate.cancelAll("host is draining");
  await assert.rejects(queued, /host is draining/);
  held.resolve();
  await running;
});

test("aborting one queued start removes only it from the queue, rejects it and never runs it", async () => {
  const gate = new AgentStartGate({
    maxConcurrentStarts: 1,
    minStartIntervalMs: 0,
  });
  const held = deferred();
  const running = gate.runStart("agent-a", async () => {
    await held.promise;
  });
  const abort = new AbortController();
  let abortedStarted = false;
  const aborted = gate.runStart(
    "agent-b",
    async () => {
      abortedStarted = true;
    },
    abort.signal,
  );
  const kept = gate.runStart("agent-c", async () => "started");
  await new Promise((resolve) => setImmediate(resolve));
  abort.abort(new Error("activation cancelled while queued"));
  await assert.rejects(aborted, /activation cancelled while queued/);
  assert.deepEqual(gate.snapshot().queuedAgentIds, ["agent-c"]);
  held.resolve();
  await running;
  assert.equal(await kept, "started");
  assert.equal(abortedStarted, false);
  // A signal aborted after its start was admitted changes nothing.
  const late = new AbortController();
  const admitted = gate.runStart(
    "agent-d",
    async () => {
      late.abort();
      return "ran";
    },
    late.signal,
  );
  assert.equal(await admitted, "ran");
});

test("start limits change at runtime: raising admits queued starts, lowering never interrupts active ones", async () => {
  const gate = new AgentStartGate({
    maxConcurrentStarts: 1,
    minStartIntervalMs: 0,
  });
  const held = [deferred(), deferred(), deferred()];
  const started: string[] = [];
  const runs = held.map((hold, index) =>
    gate.runStart(`agent-${index}`, async () => {
      started.push(`agent-${index}`);
      await hold.promise;
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["agent-0"]);

  gate.updateSettings({ maxConcurrentStarts: 3 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["agent-0", "agent-1", "agent-2"]);

  // Lowering below the active count keeps the three admitted starts running.
  gate.updateSettings({ maxConcurrentStarts: 1, minStartIntervalMs: 25 });
  assert.equal(gate.snapshot().activeStarts, 3);
  assert.equal(gate.snapshot().maxConcurrentStarts, 1);
  const late = deferred();
  const lateRun = gate.runStart("agent-late", async () => {
    started.push("agent-late");
    await late.promise;
  });
  held[0]?.resolve();
  held[1]?.resolve();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(
    started.includes("agent-late"),
    false,
    "no new start while active starts are at or above the lowered cap",
  );
  held[2]?.resolve();
  late.resolve();
  await Promise.all([...runs, lateRun]);
  assert.ok(started.includes("agent-late"));

  assert.throws(
    () => gate.updateSettings({ maxConcurrentStarts: 0 }),
    /maxConcurrentStarts/u,
  );
  assert.throws(
    () => gate.updateSettings({ minStartIntervalMs: -1 }),
    /minStartIntervalMs/u,
  );
});
