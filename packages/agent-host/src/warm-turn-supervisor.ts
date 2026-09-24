import type {
  InstanceRuntimePool,
  WarmRuntime,
  WarmTurn,
} from "./instance-runtime-pool.ts";

/**
 * S2-b supervision of one busy warm turn (S2 spec §6, review P2 on stall and
 * leaks). The signals are kept apart:
 * - transport liveness (any envelope, keepalives) only feeds diagnostics and
 *   never resets the business-progress clock;
 * - native turn progress (item/tool/usage frames and the driver's `progress`
 *   envelopes) resets it;
 * - a running tool gets its own, longer window; awaiting approval never
 *   stalls (the Human decides).
 * A stall is an operating policy, not evidence of a model fault. Busy RSS
 * above the recycle threshold only alerts and closes admission to the
 * runtime (it restarts at its next idle boundary); only above the emergency
 * ceiling is it a resource failure. This function decides; the adapter acts
 * (native interrupt, proven kill) and never retries before closure is proven.
 */
export type WarmTurnSupervision =
  | { kind: "stalled"; idleMs: number; toolsInFlight: number }
  | { kind: "resource_failure"; rssKb: number };

export async function superviseWarmTurn(input: {
  pool: InstanceRuntimePool;
  runtime: WarmRuntime;
  turn: WarmTurn;
  signal: AbortSignal;
}): Promise<WarmTurnSupervision | undefined> {
  const { pool, runtime, turn, signal } = input;
  const policy = pool.policy;
  let lastResourceCheckMs: number | undefined;
  let measurementAlerted = false;
  while (!signal.aborted) {
    await abortableDelay(policy.supervisionIntervalMs, signal);
    if (signal.aborted || turn.outcome.settled) return undefined;
    const nowMs = pool.now();
    if (!turn.awaitingApproval) {
      const window =
        turn.toolsInFlight > 0 ? policy.toolStallMs : policy.stallMs;
      const idleMs = nowMs - turn.lastProgressMs;
      if (idleMs >= window)
        return { idleMs, kind: "stalled", toolsInFlight: turn.toolsInFlight };
    }
    // Measurement cadence is real time (it bounds `ps` cost), not policy time.
    if (
      lastResourceCheckMs !== undefined &&
      Date.now() - lastResourceCheckMs < policy.resourceCheckIntervalMs
    )
      continue;
    lastResourceCheckMs = Date.now();
    const pid = runtime.pid;
    if (pid === undefined) continue;
    let rssKb: number;
    try {
      rssKb = await pool.measureGroupRssKb(pid);
    } catch (error) {
      if (!measurementAlerted)
        pool.diagnostic(
          `[${runtime.instanceRuntimeId}] busy RSS measurement unavailable (${error instanceof Error ? error.message : String(error)}); the RSS policy is not enforced for this turn`,
        );
      measurementAlerted = true;
      continue;
    }
    if (signal.aborted || turn.outcome.settled) return undefined;
    if (rssKb > policy.emergencyRssKb)
      return { kind: "resource_failure", rssKb };
    if (rssKb > policy.recycleRssKb && runtime.admissionClosed === undefined) {
      runtime.admissionClosed = `busy RSS ${String(rssKb)} KiB above ${String(policy.recycleRssKb)} KiB`;
      pool.diagnostic(
        `[${runtime.instanceRuntimeId}] alert: process-group RSS ${String(Math.round(rssKb / 1024))} MiB exceeds the recycle threshold while busy; the turn runs on, no further turn is admitted to this runtime and it restarts at its next idle boundary`,
      );
    }
  }
  return undefined;
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
