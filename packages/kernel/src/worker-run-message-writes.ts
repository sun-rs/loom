import { instanceSessionState } from "./instance-session.ts";
import type { WorkerMessagePostResult } from "./types.ts";
import type { DatabaseSync } from "node:sqlite";

/** Exact authenticated write provenance; historical/deduplicated events are never adopted. */
export const WORKER_RUN_MESSAGE_WRITES_SCHEMA = `
CREATE TABLE IF NOT EXISTS worker_run_message_writes (
  event_id TEXT PRIMARY KEY REFERENCES room_events(event_id) ON DELETE CASCADE,
  run_attempt_id TEXT NOT NULL REFERENCES run_attempts(run_attempt_id) ON DELETE CASCADE,
  session_generation INTEGER CHECK(session_generation IS NULL OR session_generation >= 0)
);
`;

export function migrateWorkerRunMessageWrites(database: DatabaseSync): void {
  if (
    !database
      .prepare("PRAGMA table_info(worker_run_message_writes)")
      .all()
      .some((row) => row.name === "session_generation")
  )
    database.exec(
      "ALTER TABLE worker_run_message_writes ADD COLUMN session_generation INTEGER CHECK(session_generation IS NULL OR session_generation >= 0)",
    );
}

export function recordWorkerRunMessageWrite(
  database: DatabaseSync,
  runAttemptId: string,
  result: WorkerMessagePostResult,
): void {
  if ("event" in result && !result.deduplicated) {
    const run = database
      .prepare("SELECT participant_id FROM run_attempts WHERE run_attempt_id=?")
      .get(runAttemptId)!;
    const generation = instanceSessionState(
      database,
      String(run.participant_id),
    ).generation;
    database
      .prepare(
        "INSERT INTO worker_run_message_writes(event_id,run_attempt_id,session_generation) VALUES (?,?,?)",
      )
      .run(result.event.eventId, runAttemptId, generation);
  }
}
