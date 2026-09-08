import type { DatabaseSync } from "node:sqlite";
import { requireRoomMember } from "./collaboration-policy.ts";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { text, nullableText } from "./sqlite-row.ts";
import {
  taskProjectionFromRow,
  taskDependenciesComplete,
} from "./task-projection.ts";
import {
  assertTaskEventReplay,
  findRoomEventByIdempotencyKey,
} from "./task-event-replay.ts";
import type { TaskCreateMutationResult } from "./types.ts";
export function assignTaskTransaction(
  context: {
    database: DatabaseSync;
    events: RoomEventWriter;
    assignedAt: string;
    runAttemptId?: string;
    requireAssignee?: (id: string) => void;
    assertFreshContext(roomId: string, actorId: string, seq: number): void;
  },
  actorId: string,
  input: {
    assigneeId: string;
    basedOnRoomSeq: number;
    idempotencyKey: string;
    taskId: string;
  },
): TaskCreateMutationResult {
  const { database, events } = context;
  const taskRow = requireTask(database, input.taskId);
  const roomId = text(taskRow, "room_id");
  requireRoomMember(database, roomId, actorId);
  if (text(taskRow, "creator_id") !== actorId) {
    throw new ForbiddenError("only the Task creator can assign it");
  }
  const previous = findRoomEventByIdempotencyKey(
    database,
    roomId,
    input.idempotencyKey,
  );
  if (previous !== undefined) {
    const event = assertTaskEventReplay(events.eventFromRow(previous), {
      actorId,
      aggregateId: input.taskId,
      eventType: "task.assigned",
      payload: { assigneeId: input.assigneeId },
    });
    return {
      activationIds: [],
      deduplicated: true,
      event,
      task: taskProjectionFromRow(
        database,
        requireTask(database, input.taskId),
      ),
    };
  }
  requireRoomMember(database, roomId, input.assigneeId);
  if (
    text(
      database
        .prepare("SELECT kind FROM principals WHERE principal_id=?")
        .get(input.assigneeId)!,
      "kind",
    ) !== "agent"
  ) {
    throw new ForbiddenError("Task assignee must be an Agent principal");
  }
  const secondaryRole = database
    .prepare(
      "SELECT role FROM task_participants WHERE task_id=? AND participant_id=? LIMIT 1",
    )
    .get(input.taskId, input.assigneeId);
  if (secondaryRole)
    throw new ConflictError(
      `Task assignee cannot also be its ${text(secondaryRole, "role")}`,
    );
  context.requireAssignee?.(input.assigneeId);
  context.assertFreshContext(roomId, actorId, input.basedOnRoomSeq);
  if (
    text(taskRow, "state") !== "todo" ||
    nullableText(taskRow, "claimed_by") !== null
  ) {
    throw new ConflictError(
      `Task ${input.taskId} can only be assigned while unclaimed todo`,
    );
  }

  const assignedAt = context.assignedAt;
  const previousAssigneeId = nullableText(taskRow, "assignee_id");
  database
    .prepare(
      "UPDATE tasks SET assignee_id = ?, updated_at = ? WHERE task_id = ?",
    )
    .run(input.assigneeId, assignedAt, input.taskId);
  const event = events.append({
    actorId,
    aggregateId: input.taskId,
    aggregateType: "task",
    idempotencyKey: input.idempotencyKey,
    payload: {
      assigneeId: input.assigneeId,
      assignedAt,
      basedOnRoomSeq: input.basedOnRoomSeq,
      ...(previousAssigneeId === null ? {} : { previousAssigneeId }),
      taskId: input.taskId,
      ...(context.runAttemptId ? { runAttemptId: context.runAttemptId } : {}),
    },
    roomId,
    type: "task.assigned",
  });
  const activationIds = taskDependenciesComplete(database, input.taskId)
    ? events.deriveAttention(
        event,
        [
          {
            participantId: input.assigneeId,
            reason: "task_assigned",
          },
        ],
        assignedAt,
      )
    : [];
  return {
    activationIds,
    deduplicated: false,
    event,
    task: taskProjectionFromRow(database, requireTask(database, input.taskId)),
  };
}
function requireTask(database: DatabaseSync, taskId: string) {
  const row = database
    .prepare("SELECT * FROM tasks WHERE task_id=?")
    .get(taskId);
  if (!row) throw new NotFoundError(`task ${taskId} was not found`);
  return row;
}
