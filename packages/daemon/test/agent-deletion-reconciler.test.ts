import assert from "node:assert/strict";
import test from "node:test";
import { runAgentDeletionReconciler } from "../src/agent-deletion-reconciler.ts";

type BlockChange = Parameters<
  Parameters<typeof runAgentDeletionReconciler>[0]["reconcileAgentDeletions"]
>[0];

/** Drives the 1000ms loop for a fixed number of ticks, then aborts. */
async function runTicks(
  ticks: number,
  onTick: (tick: number, report: NonNullable<BlockChange>) => void,
  sink: { failures: string[]; status: string[] },
) {
  const controller = new AbortController();
  let tick = 0;
  const kernel = {
    roles: { reconcileSideDiscards: () => 0 },
    reconcileAgentDeletions: (report?: (change: never) => void) => {
      tick += 1;
      if (report) onTick(tick, report as NonNullable<BlockChange>);
      if (tick >= ticks) controller.abort();
      return 0;
    },
  };
  await runAgentDeletionReconciler(
    kernel as never,
    controller.signal,
    (message) => sink.failures.push(message),
    (message) => sink.status.push(message),
  );
  return tick;
}

test("a block is reported once per state change, not once per 1000ms tick", async () => {
  const sink = { failures: [] as string[], status: [] as string[] };
  const blocked = {
    agentId: "agent_1",
    blocker: {
      hostId: "host-a",
      kind: "run_attempt" as const,
      predicate: "state IN ('starting','running','orphaned')",
      recoveryDriver: "generic-process",
      runAttemptId: "run_1",
      table: "run_attempts",
    },
    kind: "blocked" as const,
    summary: "缺终止证明，不能完成删除。",
  };
  // The Kernel owns "what changed": it reports on tick 1 and tick 4 only.
  const ticks = await runTicks(
    5,
    (tick, report) => {
      if (tick === 1) report(blocked);
      if (tick === 4) report({ agentId: "agent_1", kind: "cleared" });
    },
    sink,
  );
  assert.equal(ticks, 5);
  assert.equal(sink.failures.length, 0);
  assert.equal(sink.status.length, 2);
  assert.match(sink.status[0]!, /Agent deletion blocked: agent_1/);
  assert.match(sink.status[0]!, /run attempt run_1/);
  assert.match(sink.status[0]!, /host host-a/);
  assert.match(sink.status[0]!, /recovery driver generic-process/);
  assert.match(sink.status[1]!, /unblocked and completed: agent_1/);
});

test("reconciler failures stay on onFailure and the cadence keeps running", async () => {
  const sink = { failures: [] as string[], status: [] as string[] };
  const controller = new AbortController();
  let tick = 0;
  const kernel = {
    roles: { reconcileSideDiscards: () => 0 },
    reconcileAgentDeletions: () => {
      tick += 1;
      if (tick >= 2) controller.abort();
      throw new Error("database is locked");
    },
  };
  await runAgentDeletionReconciler(
    kernel as never,
    controller.signal,
    (message) => sink.failures.push(message),
    (message) => sink.status.push(message),
  );
  assert.equal(tick, 2);
  assert.equal(sink.status.length, 0);
  assert.equal(sink.failures.length, 2);
  assert.match(sink.failures[0]!, /Agent deletion recovery failed.*locked/);
});

test("without an explicit status sink the existing failure sink receives block changes", async () => {
  const sink = { failures: [] as string[], status: [] as string[] };
  const controller = new AbortController();
  const kernel = {
    roles: { reconcileSideDiscards: () => 0 },
    reconcileAgentDeletions: (report?: (change: never) => void) => {
      report?.({ agentId: "agent_2", kind: "cleared" } as never);
      controller.abort();
      return 1;
    },
  };
  await runAgentDeletionReconciler(kernel as never, controller.signal, (m) =>
    sink.failures.push(m),
  );
  assert.deepEqual(sink.status, []);
  assert.equal(sink.failures.length, 1);
  assert.match(sink.failures[0]!, /unblocked and completed: agent_2/);
});

test("existing lifecycle cadence resumes durable Side discards without a client retry", async () => {
  const controller = new AbortController();
  let calls = 0;
  await runAgentDeletionReconciler(
    {
      reconcileAgentDeletions: () => 0,
      roles: {
        reconcileSideDiscards: () => {
          calls++;
          controller.abort();
          return 1;
        },
      },
    } as never,
    controller.signal,
    () => controller.abort(),
  );
  assert.equal(calls, 1);
});
