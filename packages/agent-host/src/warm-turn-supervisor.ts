import type {
  InstanceRuntimePool,
  WarmRuntime,
  WarmTurn,
} from "./instance-runtime-pool.ts";
import {
  RunWatchdogEpisode,
  runWatchdogTick,
  type RunWatchdogTerminationReason,
} from "./run-watchdog.ts";

/**
 * S2-b supervision of one busy warm turn (S2 spec §6, review P2 on stall and
 * leaks), with the evo §37 B watchdog rule (`run-watchdog.ts`). The signals
 * are kept apart:
 * - transport liveness (any envelope, keepalives) only feeds diagnostics and
 *   never resets the business-progress clock;
 * - native turn progress (item/tool/usage frames and the driver's `progress`
 *   envelopes) resets it; awaiting approval never stalls (the Human decides).
 * No progress past the warning threshold only warns; the turn is ended only
 * when work for the same instance is queued and the stall passed the
 * queued-work threshold, or when the turn reached the total duration cap.
 * Busy RSS above the recycle threshold only alerts and closes admission to
 * the runtime (it restarts at its next idle boundary); only above the
 * emergency ceiling is it a resource failure. This function decides; the
 * adapter acts (native interrupt, proven kill) and never retries before
 * closure is proven.
 */
export type WarmTurnSupervision =
  | { kind: "watchdog"; reason: RunWatchdogTerminationReason }
  | { kind: "resource_failure"; rssKb: number };

export async function superviseWarmTurn(input: {
  activationId: string;
  pool: InstanceRuntimePool;
  runtime: WarmRuntime;
  turn: WarmTurn;
  signal: AbortSignal;
}): Promise<WarmTurnSupervision | undefined> {
  const { activationId, pool, runtime, turn, signal } = input;
  const policy = pool.policy;
  const episode = new RunWatchdogEpisode();
  let lastResourceCheckMs: number | undefined;
  let measurementAlerted = false;
  while (!signal.aborted) {
    await abortableDelay(policy.supervisionIntervalMs, signal);
    if (signal.aborted || turn.outcome.settled) return undefined;
    const nowMs = pool.now();
    const verdict = await runWatchdogTick({
      activationId,
      control: pool.control,
      diagnostic: (message) =>
        pool.diagnostic(`[${runtime.instanceRuntimeId}] ${message}`),
      elapsedMs: nowMs - turn.openedMs,
      episode,
      idleMs: turn.awaitingApproval ? undefined : nowMs - turn.lastProgressMs,
      runAttemptId: turn.runAttemptId,
    });
    if (signal.aborted || turn.outcome.settled) return undefined;
    if (verdict.kind === "terminate")
      return { kind: "watchdog", reason: verdict.reason };
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
