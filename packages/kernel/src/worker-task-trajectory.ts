import type { DatabaseSync } from "node:sqlite";

import {
  WorkerTaskTrajectoryRequestSchema,
  WorkerTaskTrajectoryResponseSchema,
  type ActivationCredentialScope,
  type WorkerTaskTrajectoryRequest,
  type WorkerTaskTrajectoryResponse,
} from "@rah-os/protocol";

import { ForbiddenError } from "./errors.ts";
import { trajectoryFromRow } from "./runtime-trajectory.ts";
import { nullableText, text, type Row } from "./sqlite-row.ts";
import { requireWorkerTaskDelivery } from "./worker-task-scope.ts";

/**
 * Supervision visibility for reviewer Agents.
 *
 * A reviewer named on a Task must be able to read the owner's recorded
 * tool-call trajectory for that Task before recording a Review, so a
 * changes_requested cites concrete command and file evidence instead of the
 * owner's prose alone.
 *
 * Visibility rule: the caller must be the Task owner (assignee), a named
 * collaborator, or a named reviewer. Entries are scoped to the owner's
 * participant in the Task's Room; RunAttempts carry no task_id, so activity is
 * further bounded in time by `recorded_at >= tasks.created_at` — trajectory the
 * owner recorded before the Task existed is never disclosed.
 */
export function listWorkerTaskTrajectory(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  untrustedInput: WorkerTaskTrajectoryRequest,
): WorkerTaskTrajectoryResponse {
  const input = WorkerTaskTrajectoryRequestSchema.parse(untrustedInput);
  const taskRow = requireWorkerTaskDelivery(database, scope, input.taskId);
  requireTaskSupervisionRole(database, taskRow, scope.participantId);
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
         ${cursorClause}
       ORDER BY server_sequence DESC
       LIMIT ?`,
    )
    .all(...parameters, input.limit + 1) as Row[];
  const hasMore = rows.length > input.limit;
  const entries = rows.slice(0, input.limit).map(trajectoryFromRow);
  return WorkerTaskTrajectoryResponseSchema.parse({
    entries,
    ownerParticipantId,
    taskId: input.taskId,
    ...(hasMore && entries.length > 0
      ? { nextBeforeSequence: entries.at(-1)!.serverSequence }
      : {}),
  });
}

function requireTaskSupervisionRole(
  database: DatabaseSync,
  taskRow: Row,
  participantId: string,
): void {
  if (nullableText(taskRow, "assignee_id") === participantId) return;
  const role = database
    .prepare(
      "SELECT role FROM task_participants WHERE task_id = ? AND participant_id = ?",
    )
    .get(text(taskRow, "task_id"), participantId);
  if (role !== undefined) return;
  throw new ForbiddenError(
    `participant ${participantId} is not an owner, collaborator, or reviewer of Task ${text(taskRow, "task_id")}`,
  );
}
