import type { DatabaseSync } from "node:sqlite";
import type { WorkerTargetAddress } from "./worker-target-read-position.ts";

/** Exact presentation evidence, not an ACK, contiguous frontier or completed
 * work. Raft 1.0.18 recordConsumed/shouldSuppress use exact ids for read/held.
 * RAH keeps the observation durable; it never cancels an Activation. */
export function migrateWorkerMessagePresentations(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS worker_message_presentations (
    participant_id TEXT NOT NULL REFERENCES principals(principal_id),
    room_id TEXT NOT NULL REFERENCES rooms(room_id),
    thread_key TEXT NOT NULL,
    room_seq INTEGER NOT NULL CHECK(room_seq>0),
    PRIMARY KEY(participant_id, room_id, thread_key, room_seq)
  ) STRICT;`);
}

export function recordWorkerMessagePresentations(
  db: DatabaseSync,
  target: WorkerTargetAddress,
  seqs: readonly number[],
): void {
  const insert = db.prepare(`INSERT OR IGNORE INTO worker_message_presentations
    SELECT ?, e.room_id, COALESCE(m.thread_id,''), e.room_seq
    FROM room_events e JOIN messages m ON m.message_id=e.aggregate_id AND m.room_id=e.room_id
    WHERE e.room_id=? AND e.type='message.posted' AND e.room_seq=? AND COALESCE(m.thread_id,'')=?`);
  for (const seq of new Set(seqs)) {
    if (!Number.isSafeInteger(seq) || seq <= 0)
      throw new Error("Invalid presented message sequence");
    insert.run(target.participantId, target.roomId, seq, target.threadId ?? "");
  }
}

export function wasWorkerMessagePresented(
  db: DatabaseSync,
  target: WorkerTargetAddress,
  seq: number,
): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM worker_message_presentations WHERE participant_id=? AND room_id=? AND thread_key=? AND room_seq=?`,
      )
      .get(target.participantId, target.roomId, target.threadId ?? "", seq) !==
    undefined
  );
}
