import type { WorkerSyncResult } from "./types.ts";

/** Raft 1.0.18 check formats the Agent inbox, not the execution audit ledger.
 * RAH adaptation: only enumerated execution diagnostics are omitted. Unknown
 * events and all business facts remain visible. The scanned page cursor is
 * unchanged: an omitted audit event needs no model action, but stays durable.
 * Explicit sync/history remain complete diagnostic surfaces. */
const EXECUTION_AUDIT_EVENTS = new Set([
  "placement.reserved",
  "placement.released",
  "run.created",
  "run.runtime_prepared",
  "run.started",
  "run.termination_proven",
  "run.finished",
  "run.orphaned",
  "activation.leased",
  "activation.finished",
  "activation.cancelled",
  "activation.cancellation_resolved",
  "activation.recovered",
  "activation.quarantined",
  "activation.quarantine_resolved",
  "activation.retry_scheduled",
  "activation.retry_blocked",
  "activation.retry_resumed",
]);

export function projectWorkerMessageCheck(
  delivery: WorkerSyncResult,
): WorkerSyncResult {
  return {
    ...delivery,
    events: delivery.events.filter(
      (event) => !EXECUTION_AUDIT_EVENTS.has(event.type),
    ),
  };
}
