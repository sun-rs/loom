import type { DatabaseSync } from "node:sqlite";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { nullableInteger, nullableText, text } from "./sqlite-row.ts";

/** Called inside the transaction that records proof, or startup reconciliation. */
export function finishProvenOrphanedRuns(
  database: DatabaseSync,
  events: RoomEventWriter,
  runAttemptId?: string,
): void {
  const rows = database
    .prepare(
      `
    SELECT run.*, process.exit_code AS proven_exit_code,
      process.exit_signal AS proven_exit_signal, process.terminated_at
    FROM run_attempts AS run
    JOIN runtime_processes AS process ON process.run_attempt_id = run.run_attempt_id
    JOIN room_events AS proof ON proof.aggregate_id = run.run_attempt_id
      AND proof.room_id = run.room_id AND proof.type = 'run.termination_proven'
      AND json_extract(proof.payload_json, '$.runtimeRunId') = process.runtime_run_id
      AND json_extract(proof.payload_json, '$.exitCode') IS process.exit_code
      AND json_extract(proof.payload_json, '$.exitSignal') IS process.exit_signal
    WHERE run.state = 'orphaned' AND process.state = 'terminated'
      AND process.terminated_at IS NOT NULL
      AND (? IS NULL OR run.run_attempt_id = ?)
  `,
    )
    .all(runAttemptId ?? null, runAttemptId ?? null);
  for (const row of rows) {
    const id = text(row, "run_attempt_id");
    const exitCode = nullableInteger(row, "proven_exit_code");
    const exitSignal = nullableText(row, "proven_exit_signal");
    const state = exitCode === 0 && exitSignal === null ? "exited" : "failed";
    database
      .prepare(
        `UPDATE run_attempts SET state = ?, exit_code = ?,
      exit_signal = ?, finished_at = ? WHERE run_attempt_id = ? AND state = 'orphaned'`,
      )
      .run(state, exitCode, exitSignal, text(row, "terminated_at"), id);
    events.append({
      actorId: "principal_system",
      aggregateId: id,
      aggregateType: "run_attempt",
      idempotencyKey: `run.finish:${id}`,
      payload: {
        runAttemptId: id,
        state,
        recovered: true,
        ...(exitCode === null ? {} : { exitCode }),
        ...(exitSignal === null ? {} : { exitSignal }),
        ...(nullableText(row, "error") === null
          ? {}
          : { error: text(row, "error") }),
        ...(nullableText(row, "placement_id") === null
          ? {}
          : { placementId: text(row, "placement_id") }),
      },
      roomId: text(row, "room_id"),
      type: "run.finished",
    });
  }
}
