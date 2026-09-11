import type { DatabaseSync } from "node:sqlite";
import type { WorkerAddressing } from "@rah-os/protocol";
import {
  WORKER_VISIBLE_ROOMS,
  workerRoomEntry,
  resolveWorkerReadTarget,
  type WorkerVisibleRoomScope,
} from "./worker-read-targets.ts";
import { NotFoundError } from "./errors.ts";

/**
 * Raft computer 1.0.18 formatTarget / formatSenderHandle (675916–675935).
 * Structural port: derive names from existing canonical Room/Principal owners.
 * A colliding slug keeps the valid opaque target; never choose another Room.
 */
export function workerAddressing(
  database: DatabaseSync,
  scope: WorkerVisibleRoomScope,
  rows: readonly { roomId: string; actorId: string; payload?: unknown }[],
): WorkerAddressing {
  const targets: Record<string, string> = {};
  const handles: Record<string, string> = {};
  const actors = new Set<string>();
  for (const row of rows) {
    actors.add(row.actorId);
    const payload = row.payload as
      { recipients?: { participantId: string }[] } | undefined;
    for (const recipient of payload?.recipients ?? [])
      actors.add(recipient.participantId);
    if (targets[row.roomId] !== undefined) continue;
    const room = database
      .prepare(
        `${WORKER_VISIBLE_ROOMS} WHERE membership.principal_id=? AND r.room_id=?`,
      )
      .get(scope.participantId, row.roomId);
    if (!room) continue;
    const channel = workerRoomEntry(
      database,
      scope.participantId,
      room,
    ).channel;
    targets[row.roomId] = row.roomId;
    try {
      if (
        resolveWorkerReadTarget(database, scope, channel).roomId === row.roomId
      )
        targets[row.roomId] = channel;
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  for (const id of actors) {
    const principal = database
      .prepare("SELECT handle FROM principals WHERE principal_id=?")
      .get(id);
    if (typeof principal?.handle === "string") handles[id] = principal.handle;
  }
  return { targets, handles };
}

/** Conservative per-row reservation; shared dictionary keys only reduce size. */
export function workerAddressingBudget(
  database: DatabaseSync,
  scope: WorkerVisibleRoomScope,
) {
  return (event: { roomId: string; actorId: string; payload?: unknown }) =>
    Buffer.byteLength(
      JSON.stringify({
        addressing: workerAddressing(database, scope, [event]),
      }),
    ) + 1;
}
