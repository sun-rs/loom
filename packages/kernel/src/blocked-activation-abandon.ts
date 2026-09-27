import type { DatabaseSync } from "node:sqlite";
import type { RoomEvent } from "@rah-os/protocol";

import { ConflictError, RuntimeTerminationProofError } from "./errors.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { nullableText, text } from "./sqlite-row.ts";

/**
 * D2-2: the Human abandons one Activation of `participantId` that a blocked
 * retry fence stopped. Explicit Human withdrawal, never inferred: the
 * Activation becomes `cancelled` and its fence `resolved` (resolution kind
 * NULL, as for a Room stop), which releases the lane. Finished RunAttempts,
 * Tasks and the fence's recorded error stay as they are. Refused while any run,
 * runtime process or placement of it lacks terminal proof. Returns the
 * `activation.cancelled` event.
 */
export function abandonBlockedActivation(input: {
  actorId: string;
  activationId: string;
  database: DatabaseSync;
  events: RoomEventWriter;
  idempotencyKey: string;
  now: string;
  participantId: string;
}): { lastError: string | null; roomId: string; event: RoomEvent } {
  const { database, activationId } = input;
  const row = database
    .prepare(
      `SELECT a.state, a.room_id, a.participant_id, f.state AS fence_state,
              f.last_error AS fence_error
       FROM activations AS a
       LEFT JOIN activation_retry_fences AS f ON f.activation_id = a.activation_id
       WHERE a.activation_id = ?`,
    )
    .get(activationId);
  if (
    row === undefined ||
    text(row, "participant_id") !== input.participantId ||
    text(row, "state") !== "quarantined" ||
    nullableText(row, "fence_state") !== "blocked"
  )
    throw new ConflictError(
      `activation ${activationId} is not a blocked Activation of this instance`,
    );
  for (const [table, predicate] of [
    ["run_attempts", "state IN ('starting', 'running', 'orphaned')"],
    ["runtime_processes", "state <> 'terminated'"],
    ["placements", "state IN ('reserved', 'consumed')"],
  ] as const) {
    if (
      database
        .prepare(
          `SELECT 1 FROM ${table} WHERE activation_id = ? AND ${predicate} LIMIT 1`,
        )
        .get(activationId)
    )
      throw new RuntimeTerminationProofError(
        `activation ${activationId} is waiting for terminal proof in ${table}`,
      );
  }
  database
    .prepare(
      "UPDATE activations SET state = 'cancelled', lease_owner = NULL, lease_until = NULL, lease_until_ms = NULL, last_error = 'Human abandoned blocked activation', updated_at = ? WHERE activation_id = ?",
    )
    .run(input.now, activationId);
  database
    .prepare(
      "UPDATE activation_retry_fences SET state = 'resolved', resolved_at = ?, resolution_kind = NULL WHERE activation_id = ? AND state <> 'resolved'",
    )
    .run(input.now, activationId);
  const roomId = text(row, "room_id");
  const event = input.events.append({
    actorId: input.actorId,
    aggregateId: activationId,
    aggregateType: "activation",
    idempotencyKey: `${input.idempotencyKey}:activation-abandon:${activationId}`,
    payload: {
      activationId,
      participantId: input.participantId,
      reason: "human_abandoned_blocked_activation",
    },
    roomId,
    type: "activation.cancelled",
  });
  return { lastError: nullableText(row, "fence_error"), roomId, event };
}
