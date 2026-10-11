import type { WorkerMessagePostResult } from "./types.ts";
import type { DatabaseSync } from "node:sqlite";

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
