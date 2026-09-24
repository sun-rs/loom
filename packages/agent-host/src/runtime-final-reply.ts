import type { AgentHostControlPort } from "./agent-host-control.ts";
import type { RunHandle, RuntimeAdapter } from "./runtime.ts";

/** Durable re-read cadence; the in-process hint normally wins by far. */
export const FINAL_REPLY_POLL_MS = 250;

/**
 * Final-reply turn end, Host side (single owner of the decision). While a run
 * is live, wait for the Kernel's durable marker that a `final` post of this
 * RunAttempt committed, then ask the runtime once to end its native turn.
 *
 * The co-located Kernel's commit hint wakes the loop at once; a lost hint is
 * covered by the durable re-read. Nothing here acknowledges delivery or
 * completes the Activation: the run still closes through the normal exit or
 * quiescence path, and `completeActivation` still needs ACK through `toSeq`.
 * An unsupported or failing interrupt leaves the turn running unchanged.
 */
export async function maintainFinalReplyInterrupt(input: {
  runAttemptId: string;
  run: RunHandle;
  runtime: RuntimeAdapter;
  control: AgentHostControlPort;
  signal: AbortSignal;
  wait: (delayMs: number, signal: AbortSignal) => Promise<void>;
  pollMs?: number;
}): Promise<void> {
  const { control, runtime } = input;
  if (
    runtime.interruptAfterFinalReply === undefined ||
    control.readFinalReply === undefined
  )
    return;
  let wake: (() => void) | undefined;
  const unsubscribe = control.onFinalReplyCommitted?.((runAttemptId) => {
    if (runAttemptId === input.runAttemptId) wake?.();
  });
  try {
    while (!input.signal.aborted) {
      const hinted = new Promise<void>((resolve) => {
        wake = resolve;
      });
      try {
        const marker = await control.readFinalReply({
          runAttemptId: input.runAttemptId,
        });
        if (input.signal.aborted) return;
        if (marker !== null) {
          await runtime.interruptAfterFinalReply(input.run);
          return;
        }
      } catch {
        // Revoked lease or unavailable control: the turn simply runs on.
        return;
      }
      const tick = new AbortController();
      const stop = () => tick.abort();
      input.signal.addEventListener("abort", stop, { once: true });
      try {
        await Promise.race([
          hinted,
          input.wait(input.pollMs ?? FINAL_REPLY_POLL_MS, tick.signal),
        ]);
      } catch {
        // An aborted wait is the loop's own stop.
      } finally {
        tick.abort();
        input.signal.removeEventListener("abort", stop);
      }
    }
  } finally {
    unsubscribe?.();
  }
}
