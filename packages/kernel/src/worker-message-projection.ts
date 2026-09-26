import type { DatabaseSync } from "node:sqlite";

import type { RoomEvent } from "@rah-os/protocol";

import { effectiveMemorySwitches } from "./channel-memory-access.ts";
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
  "run.turn_quiesced",
  "run.finished",
  "run.orphaned",
  "run.watchdog_warning",
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
  // S6 batch B: memory changes reach an instance through the session index
  // and the wake delta, which obey its read switch; the metadata-only Room
  // event stays in the ledger for the Human and diagnostics.
  "memory.entry_changed",
  "memory.policy_changed",
]);

/** Shared with the wake rendering (`activation-presented-window.ts`), so a
 * bodied wake and `message-check` omit exactly the same diagnostics. */
export function isExecutionAuditEvent(type: string): boolean {
  return EXECUTION_AUDIT_EVENTS.has(type);
}

export function projectWorkerMessageCheck(
  delivery: WorkerSyncResult,
): WorkerSyncResult {
  return {
    ...delivery,
    events: delivery.events.filter(
      (event) => !isExecutionAuditEvent(event.type),
    ),
  };
}

const MEMORY_ENTRY_EVENT = "memory.entry_changed";

/**
 * Review P2-2 (owner: an instance whose memory read is off does not see entry
 * names). The one Worker event projection for memory: a
 * `memory.entry_changed` event (entry id, name, type, revision, state) is
 * visible only to a Role instance of that channel, still a member, whose
 * effective read switch is on. Otherwise it is filtered out whole — never
 * renumbered: a caller's cursor, ACK and `toSeq` stay the scanned range, as
 * for the execution-audit omissions above. The Human ledger is unchanged.
 * Applied to every Worker surface that returns raw Room events (`sync`,
 * `message-check`, `rooms/read`); the wake window already omits memory.*.
 */
export function hideUnreadableMemoryEvents<Event extends RoomEvent>(
  database: DatabaseSync,
  participantId: string,
  events: readonly Event[],
): Event[] {
  if (!events.some((event) => event.type === MEMORY_ENTRY_EVENT))
    return [...events];
  const readable = new Map<string, boolean>();
  const canRead = (roomId: string): boolean => {
    const known = readable.get(roomId);
    if (known !== undefined) return known;
    const instance =
      database
        .prepare(
          `SELECT 1 FROM role_instances i JOIN memberships m
             ON m.room_id=i.channel_id AND m.principal_id=i.instance_id
            WHERE i.instance_id=? AND i.channel_id=?`,
        )
        .get(participantId, roomId) !== undefined;
    const allowed =
      instance && effectiveMemorySwitches(database, roomId, participantId).read;
    readable.set(roomId, allowed);
    return allowed;
  };
  return events.filter(
    (event) => event.type !== MEMORY_ENTRY_EVENT || canRead(event.roomId),
  );
}
