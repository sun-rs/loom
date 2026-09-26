import type { RunWatchdogContext } from "@rah-os/protocol";

import type { AgentHostControlPort } from "./agent-host-control.ts";

/**
 * evo §37 B — one watchdog rule for every run, cold or warm (Raft 1.0.32
 * daemon semantics without its 2-minute first-event kill):
 * - no provider progress for `noProgressWarnMs`: warn only (diagnostic plus a
 *   `run.watchdog_warning` activity fact); a live run is never killed for
 *   being slow while nobody waits for its lane;
 * - no progress for `queuedStallTerminateMs` while other work for the same
 *   instance is queued: terminate through the existing proven path (the
 *   runtime's graceful signal, then its hard kill) and retry the Activation,
 *   which resumes the instance's own session;
 * - total duration reaching `maxRunMs`: terminate the same way, whatever the
 *   progress.
 * Thresholds are runtime settings read from the Kernel on every tick, so a
 * change applies to running work without a restart. The retry is recoverable;
 * the Kernel's same-error fence (3 identical failures) stops a loop, so the
 * failure texts below carry no variable numbers.
 */
export type RunWatchdogVerdict =
  | { kind: "none" }
  | { kind: "warn"; thresholdMs: number }
  | { kind: "terminate"; reason: RunWatchdogTerminationReason };

export type RunWatchdogTerminationReason = "max_duration" | "queued_stall";

export const RUN_WATCHDOG_QUEUED_STALL =
  "LOOM_RUN_WATCHDOG_QUEUED_STALL: no provider progress past the queued-work stall threshold while other work for this instance waited; the run was terminated with proof and the Activation resumes on the same session";
export const RUN_WATCHDOG_MAX_DURATION =
  "LOOM_RUN_WATCHDOG_MAX_DURATION: the run reached its total duration cap; it was terminated with proof and the Activation resumes on the same session";

export function runWatchdogFailure(
  reason: RunWatchdogTerminationReason,
): string {
  return reason === "max_duration"
    ? RUN_WATCHDOG_MAX_DURATION
    : RUN_WATCHDOG_QUEUED_STALL;
}

/**
 * `idleMs` is the time since the last provider progress, or `undefined` while
 * the run cannot stall (a warm turn awaiting an approval).
 */
export function decideRunWatchdog(input: {
  context: RunWatchdogContext;
  elapsedMs: number;
  idleMs: number | undefined;
}): RunWatchdogVerdict {
  const { context, elapsedMs, idleMs } = input;
  if (elapsedMs >= context.maxRunMs)
    return { kind: "terminate", reason: "max_duration" };
  if (idleMs === undefined) return { kind: "none" };
  if (context.queuedWorkWaiting && idleMs >= context.queuedStallTerminateMs)
    return { kind: "terminate", reason: "queued_stall" };
  if (idleMs >= context.noProgressWarnMs)
    return { kind: "warn", thresholdMs: context.noProgressWarnMs };
  return { kind: "none" };
}

/** Warn once per stall episode; progress past the warning opens a new one. */
export class RunWatchdogEpisode {
  #warned = false;

  evaluate(input: Parameters<typeof decideRunWatchdog>[0]): RunWatchdogVerdict {
    const verdict = decideRunWatchdog(input);
    if (verdict.kind === "warn") {
      if (this.#warned) return { kind: "none" };
      this.#warned = true;
      return verdict;
    }
    if (verdict.kind === "none") this.#warned = false;
    return verdict;
  }
}

type WatchdogControl = Pick<
  AgentHostControlPort,
  "readRunWatchdog" | "recordRunWatchdogWarning"
>;

/** One supervision tick shared by the cold loop and the warm supervisor. */
export async function runWatchdogTick(input: {
  activationId: string;
  control: WatchdogControl;
  diagnostic: (message: string) => void;
  elapsedMs: number;
  episode: RunWatchdogEpisode;
  idleMs: number | undefined;
  runAttemptId: string;
}): Promise<RunWatchdogVerdict> {
  if (input.control.readRunWatchdog === undefined) return { kind: "none" };
  let context: RunWatchdogContext;
  try {
    context = await input.control.readRunWatchdog({
      activationId: input.activationId,
    });
  } catch {
    // An unreadable context never kills a run; the next tick retries.
    return { kind: "none" };
  }
  const verdict = input.episode.evaluate({
    context,
    elapsedMs: input.elapsedMs,
    idleMs: input.idleMs,
  });
  if (verdict.kind === "warn") {
    input.diagnostic(
      `run ${input.runAttemptId}: no provider progress for ${String(Math.round((input.idleMs ?? 0) / 1000))} s (warning threshold ${String(verdict.thresholdMs)} ms); the run continues`,
    );
    try {
      await input.control.recordRunWatchdogWarning?.({
        runAttemptId: input.runAttemptId,
        thresholdMs: verdict.thresholdMs,
      });
    } catch {
      // The warning is informational; its loss never affects the run.
    }
  }
  return verdict;
}

/**
 * The cold-path loop (AgentHost owns it for runs no adapter supervises).
 * Resolves only on a termination verdict or when supervision stops.
 */
export async function watchRunProgress(input: {
  activationId: string;
  control: WatchdogControl;
  diagnostic: (message: string) => void;
  intervalMs: number;
  lastProgressMs: () => number;
  now: () => number;
  runAttemptId: string;
  signal: AbortSignal;
  startedAtMs: number;
  wait: (delayMs: number, signal: AbortSignal) => Promise<void>;
}): Promise<
  | { kind: "watchdog"; reason: RunWatchdogTerminationReason }
  | { kind: "stopped" }
> {
  const episode = new RunWatchdogEpisode();
  while (!input.signal.aborted) {
    await input.wait(input.intervalMs, input.signal);
    if (input.signal.aborted) break;
    const nowMs = input.now();
    const verdict = await runWatchdogTick({
      activationId: input.activationId,
      control: input.control,
      diagnostic: input.diagnostic,
      elapsedMs: nowMs - input.startedAtMs,
      episode,
      idleMs: nowMs - input.lastProgressMs(),
      runAttemptId: input.runAttemptId,
    });
    if (input.signal.aborted) break;
    if (verdict.kind === "terminate")
      return { kind: "watchdog", reason: verdict.reason };
  }
  return { kind: "stopped" };
}
