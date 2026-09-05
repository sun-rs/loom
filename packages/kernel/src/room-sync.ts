import type { DatabaseSync } from "node:sqlite";

import type { RoomEvent } from "@rah-os/protocol";

import { integer, type Row } from "./sqlite-row.ts";
import type { RoomSnapshot, SyncResult } from "./types.ts";

export type RoomSyncInput = {
  afterSeq?: number;
  bootstrap?: "latest";
  consumerId: string;
  limit?: number;
  roomId: string;
  throughSeq?: number;
};

/**
 * Kernel-owned Room event delivery. Human clients may bootstrap from a current
 * snapshot plus a bounded tail; Worker calls never use that shortcut.
 */
export function syncRoomEventWindow(
  database: DatabaseSync,
  participantId: string,
  input: RoomSyncInput,
  owners: {
    eventFromRow: (row: Row) => RoomEvent;
    snapshot: (roomId: string) => RoomSnapshot;
  },
): SyncResult {
  const cursorRow = database
    .prepare(
      "SELECT last_seq FROM subscription_cursors WHERE room_id = ? AND participant_id = ? AND consumer_id = ?",
    )
    .get(input.roomId, participantId, input.consumerId);
  const cursorBefore = cursorRow ? integer(cursorRow, "last_seq") : 0;
  const roomRow = database
    .prepare("SELECT next_seq FROM rooms WHERE room_id = ?")
    .get(input.roomId);
  if (roomRow === undefined)
    throw new Error(`Room ${input.roomId} was not found`);
  const latestRoomSeq = integer(roomRow, "next_seq") - 1;
  const throughSeq = input.throughSeq ?? latestRoomSeq;
  if (!Number.isInteger(throughSeq) || throughSeq < 0) {
    throw new Error("throughSeq must be a non-negative integer");
  }
  if (throughSeq > latestRoomSeq) {
    throw new Error("throughSeq cannot exceed the latest Room sequence");
  }
  const limit = input.limit ?? 500;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
    throw new Error("limit must be between 1 and 500");
  }
  if (input.bootstrap !== undefined && input.afterSeq !== undefined) {
    throw new Error("latest bootstrap cannot include afterSeq");
  }
  const afterSeq =
    input.bootstrap === "latest"
      ? Math.max(0, throughSeq - limit)
      : (input.afterSeq ?? cursorBefore);
  if (!Number.isInteger(afterSeq) || afterSeq < 0) {
    throw new Error("afterSeq must be a non-negative integer");
  }
  if (afterSeq > throughSeq) {
    throw new Error("afterSeq cannot exceed throughSeq");
  }
  const events = database
    .prepare(
      "SELECT * FROM room_events WHERE room_id = ? AND room_seq > ? AND room_seq <= ? ORDER BY room_seq LIMIT ?",
    )
    .all(input.roomId, afterSeq, throughSeq, limit)
    .map((row) => owners.eventFromRow(row));
  const cursorAfter = events.at(-1)?.roomSeq ?? afterSeq;
  return {
    cursorBefore,
    cursorAfter,
    ...(input.bootstrap === "latest" ? { eventFloorSeq: afterSeq } : {}),
    events,
    latestRoomSeq,
    snapshot:
      input.bootstrap === "latest" || afterSeq === 0
        ? owners.snapshot(input.roomId)
        : null,
    ...(input.bootstrap === "latest" ? { snapshotSeq: latestRoomSeq } : {}),
  };
}
