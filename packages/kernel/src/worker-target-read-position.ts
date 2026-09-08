import type { DatabaseSync } from "node:sqlite";

import { integer } from "./sqlite-row.ts";

/**
 * Server-side per-(participant, target) read position.
 *
 * Raft keeps this in the CLI's own state file (`getConsumedSeq` /
 * `recordConsumedSeqs`) so the Agent never carries it in a request. RAH keeps
 * the same fact, but on the Kernel side: the position advances only on an
 * actual read by that participant, or when a freshness hold shows that
 * participant the messages it had not seen. Publishing a message never
 * advances it.
 *
 * The addressable target is (participantId, roomId, thread). SQLite treats
 * NULLs as distinct inside a UNIQUE index, so the Room-level target is keyed by
 * the empty `thread_key` rather than a nullable column.
 */
export type WorkerTargetAddress = {
  participantId: string;
  roomId: string;
  threadId?: string | undefined;
};

const ROOM_TARGET_KEY = "";

export function migrateWorkerTargetReadPositions(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS worker_target_read_positions (
      participant_id TEXT NOT NULL REFERENCES principals(principal_id),
      room_id TEXT NOT NULL REFERENCES rooms(room_id),
      thread_key TEXT NOT NULL,
      through_room_seq INTEGER NOT NULL CHECK (through_room_seq > 0),
      read_order INTEGER NOT NULL CHECK (read_order > 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (participant_id, room_id, thread_key)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_worker_target_read_positions_room
      ON worker_target_read_positions(room_id);
  `);
}

function threadKey(threadId: string | undefined): string {
  return threadId ?? ROOM_TARGET_KEY;
}

/**
 * Monotonic, exactly like Raft's `recordConsumedSeqs`: a lower sequence never
 * rewinds the stored position, and a non-positive sequence records nothing.
 */
export function recordWorkerTargetReadPosition(
  database: DatabaseSync,
  input: WorkerTargetAddress & { throughRoomSeq: number; updatedAt: string },
): void {
  if (
    !Number.isSafeInteger(input.throughRoomSeq) ||
    input.throughRoomSeq <= 0
  ) {
    return;
  }
  const nextOrder =
    integer(
      database
        .prepare(
          "SELECT COALESCE(MAX(read_order), 0) AS highest FROM worker_target_read_positions",
        )
        .get()!,
      "highest",
    ) + 1;
  database
    .prepare(
      `INSERT INTO worker_target_read_positions(
         participant_id, room_id, thread_key, through_room_seq, read_order, updated_at
       ) VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(participant_id, room_id, thread_key) DO UPDATE SET
         through_room_seq = MAX(worker_target_read_positions.through_room_seq, excluded.through_room_seq),
         read_order = excluded.read_order,
         updated_at = excluded.updated_at`,
    )
    .run(
      input.participantId,
      input.roomId,
      threadKey(input.threadId),
      input.throughRoomSeq,
      nextOrder,
      input.updatedAt,
    );
}

/**
 * Raft's `detectThreadContextParentSend`, minus the caller's own precondition:
 * the caller must already know the send targets a NON-thread target.
 *
 * A hit means "the most recent context this participant consumed under this
 * Room is a Thread, and the Room top-level was not read at least as recently".
 * Raft's exact clearing rule is `parentReadOrder >= latestThread.readOrder`, so
 * a parent read at the same order clears it.
 */
export function detectThreadContextParentSend(
  database: DatabaseSync,
  input: { participantId: string; roomId: string },
): { threadId: string; threadSeq: number } | undefined {
  const latestThread = database
    .prepare(
      `SELECT thread_key, through_room_seq, read_order
       FROM worker_target_read_positions
       WHERE participant_id = ? AND room_id = ? AND thread_key <> ?
       ORDER BY read_order DESC LIMIT 1`,
    )
    .get(input.participantId, input.roomId, ROOM_TARGET_KEY);
  if (latestThread === undefined) return undefined;
  const parent = database
    .prepare(
      `SELECT read_order FROM worker_target_read_positions
       WHERE participant_id = ? AND room_id = ? AND thread_key = ?`,
    )
    .get(input.participantId, input.roomId, ROOM_TARGET_KEY);
  if (
    parent !== undefined &&
    integer(parent, "read_order") >= integer(latestThread, "read_order")
  )
    return undefined;
  return {
    threadId: String(latestThread.thread_key),
    threadSeq: integer(latestThread, "through_room_seq"),
  };
}

export function readWorkerTargetReadPosition(
  database: DatabaseSync,
  target: WorkerTargetAddress,
): number | undefined {
  const row = database
    .prepare(
      `SELECT through_room_seq FROM worker_target_read_positions
       WHERE participant_id = ? AND room_id = ? AND thread_key = ?`,
    )
    .get(target.participantId, target.roomId, threadKey(target.threadId));
  return row === undefined ? undefined : integer(row, "through_room_seq");
}
