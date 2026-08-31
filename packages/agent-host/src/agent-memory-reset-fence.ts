import type { AgentMemoryResetFence } from "./agent-memory-coordinator.ts";
import type { AgentHostControlPort } from "./agent-host-control.ts";

export const DEFAULT_AGENT_MEMORY_RESET_LEASE_MS = 30_000;

/**
 * Binds the Computer-local memory reset coordinator to the Kernel-owned,
 * global per-Agent operation fence. An unavailable remote control capability
 * fails closed; a process crash leaves the durable Kernel row active for
 * explicit recovery rather than silently releasing it on a timer.
 */
export function createAgentMemoryResetFenceAcquirer(
  control: AgentHostControlPort,
  options: { leaseMs?: number } = {},
): (
  ownerParticipantId: string,
  operationId: string,
) => Promise<AgentMemoryResetFence | null> {
  const leaseMs = options.leaseMs ?? DEFAULT_AGENT_MEMORY_RESET_LEASE_MS;
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
    throw new Error("memory reset leaseMs must be a positive safe integer");
  }
  return async (ownerParticipantId, operationId) => {
    const acquire = control.acquireAgentExclusiveOperationLease;
    const release = control.releaseAgentExclusiveOperationLease;
    if (acquire === undefined || release === undefined) {
      throw new Error(
        "AgentHost control does not support the global memory reset fence",
      );
    }
    const lease = await acquire({
      kind: "memory_reset",
      leaseMs,
      operationId,
      participantId: ownerParticipantId,
    });
    let released = false;
    return Object.freeze({
      release: async () => {
        if (released) return;
        await release({
          leaseId: lease.leaseId,
          operationId: lease.operationId,
        });
        released = true;
      },
    });
  };
}
