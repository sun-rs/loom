import type { WorkerVisibleRoomScope } from "./worker-read-targets.ts";
import type { DatabaseSync } from "node:sqlite";

import type { ActivationCredentialScope } from "@rah-os/protocol";

import { ConflictError, ForbiddenError, NotFoundError } from "./errors.ts";
import { integer, text, type Row } from "./sqlite-row.ts";

export function requireWorkerTaskDelivery(
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
  const activation = database
    .prepare("SELECT * FROM activations WHERE activation_id = ?")
    .get(scope.activationId);
  if (activation === undefined) {
    throw new ForbiddenError(
      `Activation ${scope.activationId} is outside this Worker execution`,
    );
  }
  const delivery = database
    .prepare(
      `SELECT room_seq FROM room_events
       JOIN inbox_items
         ON inbox_items.event_id = room_events.event_id
        AND inbox_items.participant_id = ?
       WHERE room_events.room_id = ?
         AND room_events.room_seq BETWEEN ? AND ?
         AND (
           type = 'task.created'
           AND aggregate_type = 'task'
           AND aggregate_id = ?
           OR type = 'message.posted'
           AND aggregate_type = 'message'
           AND aggregate_id = ?
           OR type = 'task.submitted'
           AND aggregate_type = 'task'
           AND aggregate_id = ?
           OR type IN ('task.workflow_updated', 'task.amended', 'task.assigned', 'task.unassigned', 'task.reassigned', 'task.reopened', 'task.unblocked', 'task.released', 'task.cancelled')
           AND aggregate_type = 'task'
           AND aggregate_id = ?
           OR type = 'input.resolved'
           AND aggregate_type = 'input_request'
           AND json_extract(payload_json, '$.taskId') = ?
           OR type = 'review.submitted'
           AND aggregate_type = 'review'
           AND json_extract(payload_json, '$.taskId') = ?
           OR type = 'task.completed'
           AND EXISTS (
             SELECT 1 FROM json_each(payload_json, '$.readyTaskIds')
             WHERE json_each.value = ?
           )
         )
       LIMIT 1`,
    )
    .get(
      scope.participantId,
      scope.roomId,
      integer(activation, "from_seq"),
      integer(activation, "to_seq"),
      taskId,
      text(taskRow, "source_message_id"),
      taskId,
      taskId,
      taskId,
      taskId,
      taskId,
    );
  if (delivery === undefined) {
    // A Task explicitly created by this running Worker is also a proven input;
    // it cannot appear in the Activation's earlier frozen delivery range.
    if (wasTaskCreatedByWorkerRun(database, scope, taskId)) return taskRow;
    throw new ForbiddenError(
      `Task ${taskId} was not linked in this Activation range`,
    );
  }
  return taskRow;
}

/** Source proof for work explicitly created by this active execution, not a
 * grant for arbitrary newer facts returned by Room read tools. */
export function wasTaskCreatedByWorkerRun(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  taskId: string,
): boolean {
  return (
    database
      .prepare(
        `SELECT event_id FROM room_events
      WHERE room_id=? AND aggregate_type='task' AND aggregate_id=?
        AND type='task.created' AND actor_id=?
        AND json_extract(payload_json, '$.runAttemptId')=? LIMIT 1`,
      )
      .get(scope.roomId, taskId, scope.participantId, scope.runAttemptId) !==
    undefined
  );
}

/** Read visibility is Room membership; mutation delivery/claim checks stay separate. */
export function requireWorkerTaskVisibility(
  database: DatabaseSync,
  scope: WorkerVisibleRoomScope,
  taskId: string,
): Row {
  const task = database
    .prepare("SELECT * FROM tasks WHERE task_id = ?")
    .get(taskId);
  if (task === undefined)
    throw new NotFoundError(`task ${taskId} was not found`);
  if (text(task, "room_id") !== scope.roomId)
    throw new ForbiddenError(
      `Task ${taskId} is outside this Worker execution scope`,
    );
  requireWorkerRoomVisibility(database, scope);
  return task;
}

export function requireWorkerRoomVisibility(
  database: DatabaseSync,
  scope: WorkerVisibleRoomScope,
): void {
  const member = database
    .prepare(
      `SELECT principals.principal_id FROM memberships
    JOIN principals ON principals.principal_id = memberships.principal_id
    LEFT JOIN agent_definitions ON agent_definitions.participant_id = principals.principal_id
    WHERE memberships.room_id = ? AND memberships.principal_id = ? AND principals.kind = 'agent' AND EXISTS(SELECT 1 FROM rooms r WHERE r.room_id=memberships.room_id AND r.system_hidden=0)
      AND (agent_definitions.state IS NULL OR agent_definitions.state = 'enabled')`,
    )
    .get(scope.roomId, scope.participantId);
  if (member === undefined)
    throw new ForbiddenError(
      `participant ${scope.participantId} is not an enabled Agent member of Room ${scope.roomId}`,
    );
}

/**
 * The Human a Task asks for input. An Agent-created Task has an Agent creator,
 * so the responder is a property of the Room, not of the Task's author: it is
 * the Room's current Human membership. A still-joined Human creator keeps the
 * question with the person who asked for the work; otherwise RAH picks the
 * Room's most responsible Human deterministically — the highest Room role
 * (owner, then admin, then member), then the earliest `joined_at`, then the
 * lowest `principal_id`. Only a Room with no Human member left fails.
 */
export function workerTaskInputResponder(
  database: DatabaseSync,
  task: Row,
): string {
  const humans = database
    .prepare(
      `SELECT principals.principal_id FROM memberships
    JOIN principals ON principals.principal_id = memberships.principal_id
    WHERE memberships.room_id = ? AND principals.kind = 'human'
    ORDER BY CASE memberships.role
        WHEN 'owner' THEN 0
        WHEN 'admin' THEN 1
        ELSE 2
      END, memberships.joined_at, principals.principal_id`,
    )
    .all(text(task, "room_id"));
  const creatorId = text(task, "creator_id");
  if (humans.some((human) => text(human, "principal_id") === creatorId))
    return creatorId;
  const responder = humans[0];
  if (responder !== undefined) return text(responder, "principal_id");
  throw new ConflictError(
    `Task ${text(task, "task_id")} has no current Human member to answer input in Room ${text(task, "room_id")}`,
  );
}
