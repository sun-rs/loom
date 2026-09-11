import type { DatabaseSync } from "node:sqlite";
import type { MessageRecipient } from "./collaboration-service.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import type { TaskCreateMutationResult } from "./types.ts";
import { ConflictError, NotFoundError } from "./errors.ts";
import { text, nullableText } from "./sqlite-row.ts";
import { taskProjectionFromRow } from "./task-projection.ts";
import {
  findRoomEventByIdempotencyKey,
  assertTaskEventReplay,
} from "./task-event-replay.ts";
import * as ar from "./room-agent-service.ts";
export type TaskCompletionInput = {
  basedOnRoomSeq: number;
  idempotencyKey: string;
  taskId: string;
  runAttemptId?: string;
};
export type TaskCompletionContext = {
  database: DatabaseSync;
  events: RoomEventWriter;
  now(): Date;
  assertCompletionAllowed(taskId: string): void;
  assertFresh(): void;
};
/** Shared original completion body. Callers authenticate authority and own the transaction.
 * Raft task update exposes done to Agents; this preserves local review evidence and dependency effects. */
export function completeTaskTransaction(
  context: TaskCompletionContext,
  actorId: string,
  input: TaskCompletionInput,
): TaskCreateMutationResult {
  const requireTask = () => {
    const row = context.database
      .prepare("SELECT * FROM tasks WHERE task_id=?")
      .get(input.taskId);
    if (!row) throw new NotFoundError(`task ${input.taskId} was not found`);
    return row;
  };
  const taskRow = requireTask(),
    roomId = text(taskRow, "room_id");
  const previous = findRoomEventByIdempotencyKey(
    context.database,
    roomId,
    input.idempotencyKey,
  );
  if (previous !== undefined) {
    const event = assertTaskEventReplay(
      context.events.eventFromRow.bind(context.events)(previous),
      {
        actorId,
        aggregateId: input.taskId,
        eventType: "task.completed",
        payload: { basedOnRoomSeq: input.basedOnRoomSeq },
      },
    );
    return {
      activationIds: [],
      deduplicated: true,
      event,
      task: taskProjectionFromRow(context.database, requireTask()),
    };
  }
  context.assertFresh();
  if (text(taskRow, "state") !== "submitted") {
    throw new ConflictError(
      `Task ${input.taskId} can only be completed from submitted`,
    );
  }
  context.assertCompletionAllowed(input.taskId);
  const completedAt = context.now().toISOString();
  context.database
    .prepare(
      "UPDATE tasks SET state = 'completed', completed_at = ?, updated_at = ? WHERE task_id = ?",
    )
    .run(completedAt, completedAt, input.taskId);
  const readyTasks = context.database
    .prepare(
      `SELECT candidate.*
           FROM task_dependencies
           JOIN tasks AS candidate
             ON candidate.task_id = task_dependencies.task_id
           WHERE task_dependencies.dependency_task_id = ?
             AND candidate.state = 'todo'
             AND NOT EXISTS (
               SELECT 1
               FROM task_dependencies AS remaining
               JOIN tasks AS dependency
                 ON dependency.task_id = remaining.dependency_task_id
               WHERE remaining.task_id = candidate.task_id
                 AND dependency.state <> 'completed'
             )
           ORDER BY candidate.task_id`,
    )
    .all(input.taskId);
  const readyTaskIds = readyTasks.map((readyTask) =>
    text(readyTask, "task_id"),
  );
  const event = context.events.append.bind(context.events)({
    actorId,
    aggregateId: input.taskId,
    aggregateType: "task",
    idempotencyKey: input.idempotencyKey,
    payload: {
      basedOnRoomSeq: input.basedOnRoomSeq,
      completedAt,
      ...(input.runAttemptId === undefined
        ? {}
        : { runAttemptId: input.runAttemptId }),
      readyTaskIds,
      taskId: input.taskId,
    },
    roomId,
    type: "task.completed",
  });
  const recipientMap = new Map<string, MessageRecipient>();
  for (const readyTask of readyTasks) {
    const assigneeId = nullableText(readyTask, "assignee_id");
    const recipients =
      assigneeId === null
        ? ar.listRoomAgentRecipients(
            context.database,
            roomId,
            "dependency_resolved",
          )
        : [
            {
              participantId: assigneeId,
              reason: "dependency_resolved" as const,
            },
            ...context.database
              .prepare(
                "SELECT participant_id FROM task_participants WHERE task_id = ? AND role = 'collaborator' ORDER BY participant_id",
              )
              .all(text(readyTask, "task_id"))
              .map((participant) => ({
                participantId: text(participant, "participant_id"),
                reason: "task_collaboration" as const,
              })),
          ];
    for (const recipient of recipients) {
      recipientMap.set(recipient.participantId, recipient);
    }
  }
  const activationIds = context.events.deriveAttention.bind(context.events)(
    event,
    [...recipientMap.values()].sort((left, right) =>
      left.participantId.localeCompare(right.participantId),
    ),
    completedAt,
  );
  return {
    activationIds,
    deduplicated: false,
    event,
    task: taskProjectionFromRow(context.database, requireTask()),
  };
}
