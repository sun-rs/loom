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
    CREATE TABLE IF NOT EXISTS worker_target_context_windows (
      participant_id TEXT NOT NULL REFERENCES principals(principal_id),
      run_attempt_id TEXT NOT NULL,
      room_id TEXT NOT NULL REFERENCES rooms(room_id),
      thread_key TEXT NOT NULL,
      through_room_seq INTEGER NOT NULL,
      floor_room_seq INTEGER NOT NULL,
      cursor_room_seq INTEGER NOT NULL,
      thread_context_hash TEXT,
      causal_event_id TEXT,
      expires_at_ms INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (participant_id, run_attempt_id, room_id, thread_key)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_worker_target_context_windows_room
      ON worker_target_context_windows(room_id);
  `);
}

/**
 * The paging position of an open `room-read` window, kept where Raft's tool
 * keeps it: in the tool's own state, not in a token the Agent has to carry
 * between calls. One row per (participant, RunAttempt, target) holds exactly
 * the snapshot the signed receipt used to hold — the frozen `through`, the
 * window floor, how far the Agent has actually consumed, and the Thread facts
 * the first page froze — so a continuation reads the same immutable window even
 * though the Room head has moved on.
 */
export type WorkerTargetContextWindow = {
  through: number;
  floor: number;
  cursor: number;
  threadContextHash: string | null;
  causalEventId: string | null;
  expires: number;
};

export function readWorkerTargetContextWindow(
  database: DatabaseSync,
  target: WorkerTargetAddress & { runAttemptId: string; nowMs: number },
): WorkerTargetContextWindow | undefined {
  const row = database
    .prepare(
      `SELECT through_room_seq, floor_room_seq, cursor_room_seq,
              thread_context_hash, causal_event_id, expires_at_ms
       FROM worker_target_context_windows
       WHERE participant_id = ? AND run_attempt_id = ? AND room_id = ?
         AND thread_key = ?`,
    )
    .get(
      target.participantId,
      target.runAttemptId,
      target.roomId,
      threadKey(target.threadId),
    );
  if (row === undefined) return undefined;
  const window = {
    through: integer(row, "through_room_seq"),
    floor: integer(row, "floor_room_seq"),
    cursor: integer(row, "cursor_room_seq"),
    threadContextHash:
      row.thread_context_hash === null ? null : String(row.thread_context_hash),
    causalEventId:
      row.causal_event_id === null ? null : String(row.causal_event_id),
    expires: integer(row, "expires_at_ms"),
  };
  // A finished or expired window is not a continuation: the next `room-read`
  // opens a fresh snapshot at the current head, exactly as the first one did.
  if (window.cursor >= window.through || window.expires <= target.nowMs)
    return undefined;
  return window;
}

export function recordWorkerTargetContextWindow(
  database: DatabaseSync,
  target: WorkerTargetAddress & { runAttemptId: string; updatedAt: string },
  window: WorkerTargetContextWindow,
): void {
  database
    .prepare(
      `INSERT INTO worker_target_context_windows(
         participant_id, run_attempt_id, room_id, thread_key, through_room_seq,
         floor_room_seq, cursor_room_seq, thread_context_hash, causal_event_id,
         expires_at_ms, updated_at
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(participant_id, run_attempt_id, room_id, thread_key) DO UPDATE SET
         through_room_seq = excluded.through_room_seq,
         floor_room_seq = excluded.floor_room_seq,
         cursor_room_seq = excluded.cursor_room_seq,
         thread_context_hash = excluded.thread_context_hash,
         causal_event_id = excluded.causal_event_id,
         expires_at_ms = excluded.expires_at_ms,
         updated_at = excluded.updated_at`,
    )
    .run(
      target.participantId,
      target.runAttemptId,
      target.roomId,
      threadKey(target.threadId),
      window.through,
      window.floor,
      window.cursor,
      window.threadContextHash,
      window.causalEventId,
      window.expires,
      target.updatedAt,
    );
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

/**
 * The furthest sequence this participant has demonstrably been shown in this
 * Room, across every target. A Task command's read position uses it so that
 * reading the newer context actually clears a freshness hold: a hold that says
 * "read this, then rerun if it is still correct" is a false instruction if the
 * position the retry carries cannot move.
 *
 * This widens the Task fence only to what the participant has actually read —
 * the fence's own criterion — and never past it.
 */
export function highestWorkerRoomReadPosition(
  database: DatabaseSync,
  target: { participantId: string; roomId: string },
): number {
  const row = database
    .prepare(
      `SELECT MAX(through_room_seq) AS seq FROM worker_target_read_positions
       WHERE participant_id = ? AND room_id = ?`,
    )
    .get(target.participantId, target.roomId);
  if (row === undefined) return 0;
  const seq = row.seq;
  return typeof seq === "number" || typeof seq === "bigint" ? Number(seq) : 0;
}
