import type { WorkerMessagePostResult } from "./types.ts";
import type { DatabaseSync } from "node:sqlite";
import { NOT_SYSTEM_NOTICE_SQL } from "./freshness-hold-context.ts";

/** Exact authenticated write provenance; historical/deduplicated events are never adopted. */
export const WORKER_RUN_MESSAGE_WRITES_SCHEMA = `
CREATE TABLE IF NOT EXISTS worker_run_message_writes (
  event_id TEXT PRIMARY KEY REFERENCES room_events(event_id) ON DELETE CASCADE,
  run_attempt_id TEXT NOT NULL REFERENCES run_attempts(run_attempt_id) ON DELETE CASCADE
);
`;

export function recordWorkerRunMessageWrite(
  database: DatabaseSync,
  runAttemptId: string,
  result: WorkerMessagePostResult,
): void {
  if ("event" in result && !result.deduplicated)
    database
      .prepare(
        "INSERT INTO worker_run_message_writes(event_id,run_attempt_id) VALUES (?,?)",
      )
      .run(result.event.eventId, runAttemptId);
}

/** Exclude individual proven writes, never advance the original causal floor. */
export function latestExternalTargetMessageSeq(
  database: DatabaseSync,
  roomId: string,
  threadId: string | undefined,
  runAttemptId: string,
  actorId: string,
): number {
  const row = database
    .prepare(
      `SELECT room_events.room_seq FROM messages
    JOIN room_events ON room_events.room_id=messages.room_id
      AND room_events.aggregate_id=messages.message_id AND room_events.type='message.posted'
    WHERE messages.room_id=? AND messages.thread_id IS ? AND ${NOT_SYSTEM_NOTICE_SQL}
      AND NOT (messages.actor_id=? AND EXISTS (
        SELECT 1 FROM worker_run_message_writes w JOIN run_attempts r ON r.run_attempt_id=w.run_attempt_id
        WHERE w.event_id=room_events.event_id AND w.run_attempt_id=?
          AND r.participant_id=messages.actor_id AND r.room_id=messages.room_id))
    ORDER BY room_events.room_seq DESC LIMIT 1`,
    )
    .get(roomId, threadId ?? null, actorId, runAttemptId);
  return row === undefined ? 0 : Number(row.room_seq);
}
