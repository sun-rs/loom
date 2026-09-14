import type { DatabaseSync } from "node:sqlite";

import { ConflictError } from "./errors.ts";

/** One canonical gate for Room lifecycle changes that could strand active work. */
export function assertNoActiveRoomWork(
  database: DatabaseSync,
  roomId: string,
): void {
  const checks = [
    database
      .prepare(
        `SELECT 1 AS present FROM tasks
         WHERE room_id = ? AND workflow_status NOT IN ('done', 'closed')
         LIMIT 1`,
      )
      .get(roomId),
    database
      .prepare(
        `SELECT 1 AS present FROM input_requests
         WHERE room_id = ? AND state = 'pending' LIMIT 1`,
      )
      .get(roomId),
    database
      .prepare(
        `SELECT 1 AS present FROM activations
         WHERE room_id = ? AND state IN ('queued', 'leased', 'quarantined')
         LIMIT 1`,
      )
      .get(roomId),
    database
      .prepare(
        `SELECT 1 AS present FROM placements
         WHERE room_id = ? AND state = 'reserved' LIMIT 1`,
      )
      .get(roomId),
    database
      .prepare(
        `SELECT 1 AS present FROM run_attempts
         WHERE room_id = ? AND state IN ('starting', 'running', 'orphaned')
         LIMIT 1`,
      )
      .get(roomId),
    database
      .prepare(
        `SELECT 1 AS present FROM runtime_processes
         WHERE room_id = ? AND state IN ('prepared', 'active', 'orphaned')
         LIMIT 1`,
      )
      .get(roomId),
    database
      .prepare(
        `SELECT 1 AS present FROM activation_cancellation_requests
         WHERE room_id = ? AND resolved_at IS NULL LIMIT 1`,
      )
      .get(roomId),
    database
      .prepare(
        `SELECT 1 AS present FROM task_reassignment_operations
         WHERE room_id = ? AND state NOT IN ('assigned', 'failed_closed')
         LIMIT 1`,
      )
      .get(roomId),
    database
      .prepare(
        `SELECT 1 AS present FROM room_agent_sos_operations
         WHERE room_id = ? AND state IN ('stopping', 'stopped') LIMIT 1`,
      )
      .get(roomId),
  ];
  if (checks.some((result) => result !== undefined)) {
    throw new ConflictError(
      `Room ${roomId} has active collaboration work and cannot change lifecycle state`,
    );
  }
}

/** The reserved, immutable slug is the identity; display-name changes cannot bypass it. */
export function assertPermanentChannelChange(
  room: Record<string, unknown>,
  change?: { name: string; visibility: string },
): void {
  if (
    room.kind === "channel" &&
    room.slug === "all" &&
    (!change || change.name !== "all" || change.visibility !== "public")
  ) {
    throw new ConflictError(
      "permanent #all channel cannot be renamed, hidden, archived, left or deleted",
    );
  }
}
