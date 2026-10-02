import type { DatabaseSync } from "node:sqlite";

import { ROOM_SYNC_RESPONSE_MAX_BYTES, type RoomEvent } from "@rah-os/protocol";
import { ForbiddenError } from "./errors.ts";

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

/** The caller owns authentication, membership and the transaction. */
export function acknowledgeRoomEventWindow(
  database: DatabaseSync,
  participantId: string,
  input: { consumerId: string; roomId: string; throughSeq: number },
  latestRoomSeq: number,
  updatedAt: string,
): void {
  if (input.consumerId.trim().length === 0)
    throw new Error("consumerId is required");
  if (!Number.isInteger(input.throughSeq) || input.throughSeq < 0)
    throw new Error("throughSeq must be a non-negative integer");
  if (input.throughSeq > latestRoomSeq)
    throw new Error("throughSeq cannot exceed the latest Room sequence");
  database
    .prepare(
      `
    INSERT INTO subscription_cursors(room_id, participant_id, consumer_id, last_seq, updated_at)
    VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(room_id, participant_id, consumer_id) DO UPDATE SET
      last_seq = MAX(subscription_cursors.last_seq, excluded.last_seq),
      updated_at = excluded.updated_at
  `,
    )
    .run(
      input.roomId,
      participantId,
      input.consumerId,
      input.throughSeq,
      updatedAt,
    );
}

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
    /** Kernel-only automatic conversation selection, never supplied by a client. */
    eventPredicate?: { sql: string; params: string[] };
    responseOverheadBytes?: number;
    eventOverheadBytes?: (event: RoomEvent) => number;
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
  const result: SyncResult = {
    cursorBefore,
    cursorAfter: afterSeq,
    ...(input.bootstrap === "latest" ? { eventFloorSeq: afterSeq } : {}),
    events: [],
    latestRoomSeq,
    snapshot:
      input.bootstrap === "latest" || afterSeq === 0
        ? owners.snapshot(input.roomId)
        : null,
    ...(input.bootstrap === "latest" ? { snapshotSeq: latestRoomSeq } : {}),
  };
  // Reserve the actual Room/member snapshot and all envelope keys. Append only
  // complete ordered events, so cursorAfter never acknowledges an omitted row.
  const envelopeBytes =
    Buffer.byteLength(JSON.stringify(result)) +
    (owners.responseOverheadBytes ?? 0);
  if (envelopeBytes > ROOM_SYNC_RESPONSE_MAX_BYTES)
    throw new ForbiddenError(
      "Room sync snapshot exceeds the complete JSON limit",
    );
  let eventBytes = 0;
  const predicate = owners.eventPredicate;
  const rows = database
    .prepare(
      `SELECT * FROM room_events WHERE room_id=? AND room_seq>? AND room_seq<=? AND (${predicate?.sql ?? "1"}) ORDER BY room_seq LIMIT ?`,
    )
    .iterate(
      input.roomId,
      afterSeq,
      throughSeq,
      ...(predicate?.params ?? []),
      limit,
    );
  let truncated = false;
  for (const row of rows) {
    const event = owners.eventFromRow(row),
      size =
        (owners.eventOverheadBytes?.(event) ?? 0) +
        Buffer.byteLength(JSON.stringify(event)) +
        (result.events.length ? 1 : 0);
    const cursorGrowth = String(event.roomSeq).length - String(afterSeq).length;
    if (
      envelopeBytes + cursorGrowth + eventBytes + size >
      ROOM_SYNC_RESPONSE_MAX_BYTES
    ) {
      if (result.events.length === 0)
        throw new ForbiddenError(
          "one Room event exceeds the complete sync response limit",
        );
      truncated = true;
      break;
    }
    result.events.push(event);
    eventBytes += size;
    result.cursorAfter = event.roomSeq;
  }
  if (predicate && !truncated && result.events.length < limit)
    result.cursorAfter = throughSeq;
  return result;
}
