import type { DatabaseSync } from "node:sqlite";
import type { RoomEvent } from "@rah-os/protocol";
import { RuntimeTerminationProofError } from "./errors.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { text } from "./sqlite-row.ts";

/** Explicit Human withdrawal; never inferred from chat text or runtime output. */
export function cancelStoppedRoomQuarantine(input: {
  database: DatabaseSync;
  events: RoomEventWriter;
  request: RoomEvent;
  now: string;
}): void {
  const { database, events, request, now } = input;
  for (const row of database
    .prepare(
      "SELECT activation_id FROM activations WHERE room_id = ? AND state = 'quarantined'",
    )
    .all(request.roomId)) {
    const activationId = text(row, "activation_id");
    for (const [table, predicate] of [
      ["run_attempts", "state IN ('starting', 'running', 'orphaned')"],
      ["runtime_processes", "state <> 'terminated'"],
      ["placements", "state <> 'released'"],
    ]) {
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
        "UPDATE activations SET state = 'cancelled', lease_owner = NULL, lease_until = NULL, lease_until_ms = NULL, last_error = 'Human stopped quarantined execution', updated_at = ? WHERE activation_id = ?",
      )
      .run(now, activationId);
    // NULL distinguishes withdrawal from successful progress or a retry. Its
    // reason is recorded by the canonical event, without rewriting old errors.
    database
      .prepare(
        "UPDATE activation_retry_fences SET state = 'resolved', resolved_at = ?, resolution_kind = NULL WHERE activation_id = ? AND state <> 'resolved'",
      )
      .run(now, activationId);
    events.append(
      {
        actorId: request.actorId,
        roomId: request.roomId,
        aggregateType: "activation",
        aggregateId: activationId,
        type: "activation.cancelled",
        idempotencyKey: `${request.eventId}:cancel:${activationId}`,
        payload: {
          activationId,
          operationId: request.aggregateId,
          reason: "human_stopped_quarantined_execution",
        },
      },
      request,
    );
  }
}
