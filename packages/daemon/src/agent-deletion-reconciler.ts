import { setTimeout } from "node:timers/promises";
import type { RoomKernel } from "@rah-os/core";
/** Cadence only. Restart recovery consumes the existing Kernel deletion intents. */
export async function runAgentDeletionReconciler(
  kernel: Pick<RoomKernel, "reconcileAgentDeletions">,
  signal: AbortSignal,
  onFailure: (message: string) => void,
): Promise<void> {
  while (!signal.aborted) {
    try {
      kernel.reconcileAgentDeletions();
    } catch (error) {
      onFailure(
        `Agent deletion recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      await setTimeout(1000, undefined, { signal });
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  }
}
