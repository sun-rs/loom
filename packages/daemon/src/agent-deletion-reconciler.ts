import { setTimeout } from "node:timers/promises";
import type { RoomKernel } from "@rah-os/core";
/** Cadence only. Restart recovery consumes the existing Kernel deletion intents. */
export async function runAgentDeletionReconciler(
  kernel: Pick<RoomKernel, "reconcileAgentDeletions">,
  signal: AbortSignal,
  onFailure: (message: string) => void,
  /**
   * R5: block reporting. The Kernel decides what a *change* is, so this runs at
   * 1000ms without producing a line per tick: one report when a block opens,
   * one when the blocking row changes identity, one when it clears. Defaults to
   * `onFailure` so the existing daemon wiring reports blocks without a second
   * observation owner.
   */
  onStatus: (message: string) => void = onFailure,
): Promise<void> {
  while (!signal.aborted) {
    try {
      kernel.reconcileAgentDeletions((change) => {
        onStatus(
          change.kind === "cleared"
            ? `Agent deletion unblocked and completed: ${change.agentId}`
            : `Agent deletion blocked: ${change.agentId}; ${change.summary}` +
                ` (${change.blocker.table}${change.blocker.runAttemptId === undefined ? "" : `, run attempt ${change.blocker.runAttemptId}`}` +
                `${change.blocker.hostId === undefined ? "" : `, host ${change.blocker.hostId}`}` +
                `${change.blocker.recoveryDriver === undefined ? "" : `, recovery driver ${change.blocker.recoveryDriver}`})`,
        );
      });
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
