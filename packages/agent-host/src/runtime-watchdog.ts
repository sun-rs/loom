import type { RunHandle, RuntimeAdapter } from "./runtime.ts";

/** Raft 1.0.32 suppresses elapsed-time termination while the runtime is alive. */
export async function watchRuntimeLiveness(input: {
  intervalMs: number;
  run: RunHandle;
  runtime: RuntimeAdapter;
  signal: AbortSignal;
  wait: (delayMs: number, signal: AbortSignal) => Promise<void>;
}): Promise<{ kind: "timeout" } | { kind: "stopped" }> {
  while (!input.signal.aborted) {
    await input.wait(input.intervalMs, input.signal);
    if (input.signal.aborted) break;
    let alive = false;
    try {
      alive = (await input.runtime.isAlive?.(input.run)) === true;
    } catch {
      // A failed probe triggers normal cancel/reap; it is not terminal proof.
    }
    if (input.signal.aborted) break;
    if (!alive) return { kind: "timeout" };
  }
  return { kind: "stopped" };
}
