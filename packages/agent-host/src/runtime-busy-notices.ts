import type { AgentHostControlPort } from "./agent-host-control.ts";
import type { RunHandle, RuntimeAdapter } from "./runtime.ts";

/** Raft sendStdinNotification structural port: suppress accepted fingerprint,
 * retry failed transport; the Kernel Inbox remains the only durable queue.
 * No notification receipt advances read, ACK, Task or Activation state.
 */
export async function maintainRuntimeBusyNotices(input: {
  guideEnabled?: () => boolean;
  activationId: string;
  runAttemptId: string;
  run: RunHandle;
  runtime: RuntimeAdapter;
  control: AgentHostControlPort;
  signal: AbortSignal;
  wait: (delayMs: number, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  if (
    input.runtime.busyInputSupported !== true ||
    !input.runtime.notifyBusy ||
    !input.control.readPendingRuntimeNotice
  )
    return;
  let lastAccepted: string | undefined;
  const writtenEventIds = new Set<string>();
  while (!input.signal.aborted) {
    try {
      if (input.guideEnabled?.() !== true) {
        await input.wait(1000, input.signal);
        continue;
      }
      const notice = await input.control.readPendingRuntimeNotice({
        activationId: input.activationId,
        runAttemptId: input.runAttemptId,
        ...(writtenEventIds.size
          ? { excludeEventIds: [...writtenEventIds] }
          : {}),
      });
      if (input.signal.aborted) return;
      if (input.guideEnabled?.() !== true) continue;
      if (notice && notice.fingerprint !== lastAccepted) {
        // Bounded per-run transport history, never a second durable Inbox.
        // At capacity leave further work to the existing follow-up lane.
        if (writtenEventIds.size + (notice.eventIds?.length ?? 0) > 256) return;
        if (await input.runtime.notifyBusy(input.run, notice)) {
          lastAccepted = notice.fingerprint;
          for (const id of notice.eventIds ?? []) writtenEventIds.add(id);
        }
      }
    } catch {
      // Revoked lease, disconnected process, or unavailable transport: do not
      // lose durable follow-up and do not interfere with lease supervision.
    }
    if (!input.signal.aborted) await input.wait(1000, input.signal);
  }
}
