import type { DatabaseSync } from "node:sqlite";

import type { ActivationCredentialScope } from "@rah-os/protocol";

import { ForbiddenError, NotFoundError } from "./errors.ts";
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
           OR type IN ('task.assigned', 'task.reassigned', 'task.reopened', 'task.unblocked', 'task.released', 'task.cancelled')
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
    throw new ForbiddenError(
      `Task ${taskId} was not linked in this Activation range`,
    );
  }
  return taskRow;
}
