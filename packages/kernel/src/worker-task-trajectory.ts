import type { DatabaseSync } from "node:sqlite";

import {
  WorkerTaskTrajectoryRequestSchema,
  WorkerTaskTrajectoryResponseSchema,
  type ActivationCredentialScope,
  type WorkerTaskTrajectoryRequest,
  type WorkerTaskTrajectoryResponse,
} from "@rah-os/protocol";

import { ForbiddenError, NotFoundError } from "./errors.ts";
import { trajectoryFromRow } from "./runtime-trajectory.ts";
import { nullableText, text, type Row } from "./sqlite-row.ts";

/**
 * Room-member visibility over a Task owner's recorded tool-call trajectory.
 *
 * There are no preset reviewer or auditor roles: a Human asks any Room Agent by
 * conversation and @mention to audit or review a Task, and that Agent needs
 * basic tools rather than a role. Raft semantics say any channel member may read
 * the channel's messages, task history and activity, so the visibility rule is
 * Room membership, not a Task role.
 *
 * Visibility rule: the caller must be an enabled Agent member of the Task's
 * Room, and the Task must belong to that Room. Entries are scoped to the owner's
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
  const taskRow = requireRoomTaskVisibility(database, scope, input.taskId);
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

function requireRoomTaskVisibility(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  taskId: string,
): Row {
  const taskRow = database
    .prepare("SELECT * FROM tasks WHERE task_id = ?")
    .get(taskId);
  if (taskRow === undefined) {
    throw new NotFoundError(`task ${taskId} was not found`);
  }
  if (text(taskRow, "room_id") !== scope.roomId) {
    throw new ForbiddenError(
      `Task ${taskId} is outside this Worker execution scope`,
    );
  }
  const member = database
    .prepare(
      `SELECT principals.principal_id
       FROM memberships
       JOIN principals ON principals.principal_id = memberships.principal_id
       LEFT JOIN agent_definitions
         ON agent_definitions.participant_id = principals.principal_id
       WHERE memberships.room_id = ?
         AND memberships.principal_id = ?
         AND principals.kind = 'agent'
         AND (agent_definitions.state IS NULL OR agent_definitions.state = 'enabled')`,
    )
    .get(text(taskRow, "room_id"), scope.participantId);
  if (member === undefined) {
    throw new ForbiddenError(
      `participant ${scope.participantId} is not an enabled Agent member of Room ${text(taskRow, "room_id")}`,
    );
  }
  return taskRow;
}
