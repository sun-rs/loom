import type { DatabaseSync } from "node:sqlite";

import {
  WorkerTaskTrajectoryRequestSchema,
  WorkerTaskTrajectoryResponseSchema,
  type ActivationCredentialScope,
  type WorkerTaskTrajectoryRequest,
  type WorkerTaskTrajectoryResponse,
} from "@rah-os/protocol";

import { ForbiddenError } from "./errors.ts";
import { requireWorkerTaskVisibility } from "./worker-task-scope.ts";
import { trajectoryFromRow } from "./runtime-trajectory.ts";
import { nullableText, text, type Row } from "./sqlite-row.ts";

/** Room-visible diagnostics from Runs explicitly linked by Task mutations.
 * A Run may handle several tasks, so these entries are context, never proof
 * that each tool call belongs to the selected Task. */
export function listWorkerTaskTrajectory(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  untrustedInput: WorkerTaskTrajectoryRequest,
): WorkerTaskTrajectoryResponse {
  const input = WorkerTaskTrajectoryRequestSchema.parse(untrustedInput);
  const taskRow = requireWorkerTaskVisibility(database, scope, input.taskId);
  const ownerParticipantId = nullableText(taskRow, "assignee_id");
  if (ownerParticipantId === null) {
    throw new ForbiddenError(
      `Task ${input.taskId} has no owner trajectory to supervise`,
    );
  }
  const parameters: Array<number | string> = [
    ownerParticipantId,
    text(taskRow, "room_id"),
    text(taskRow, "created_at"),
    input.taskId,
  ];
  let cursorClause = "";
  if (input.beforeSequence !== undefined) {
    cursorClause = "AND server_sequence < ?";
    parameters.push(input.beforeSequence);
  }
  const rows = database
    .prepare(
      `SELECT * FROM run_trajectory_entries
       WHERE participant_id = ?
         AND room_id = ?
         AND recorded_at >= ?
         AND run_attempt_id IN (
           SELECT json_extract(payload_json, '$.runAttemptId') FROM room_events
           WHERE room_id = run_trajectory_entries.room_id
             AND aggregate_type = 'task' AND aggregate_id = ?
             AND json_type(payload_json, '$.runAttemptId') = 'text'
         )
         ${cursorClause}
       ORDER BY server_sequence DESC
       LIMIT ?`,
    )
    .all(...parameters, input.limit + 1) as Row[];
  const hasMore = rows.length > input.limit;
  const entries = rows.slice(0, input.limit).map(trajectoryFromRow);
  return WorkerTaskTrajectoryResponseSchema.parse({
    entries,
    scope: "task_linked_run_diagnostics",
    ownerParticipantId,
    taskId: input.taskId,
    ...(hasMore && entries.length > 0
      ? { nextBeforeSequence: entries.at(-1)!.serverSequence }
      : {}),
  });
}
