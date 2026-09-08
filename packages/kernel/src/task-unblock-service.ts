import type { DatabaseSync } from "node:sqlite";
import { requireRoomMember } from "./collaboration-policy.ts";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { nullableText, text, type Row } from "./sqlite-row.ts";
import { taskProjectionFromRow } from "./task-projection.ts";
import {
  assertTaskEventReplay,
  findRoomEventByIdempotencyKey,
} from "./task-event-replay.ts";
import { listRoomAgentRecipients } from "./room-agent-service.ts";
import type { TaskCreateMutationResult } from "./types.ts";
/** Single transaction body for Human creator and narrowly authorized Worker recovery. */
export function unblockTaskTransaction(
  context: {
    database: DatabaseSync;
    events: RoomEventWriter;
    unblockedAt: string;
    runAttemptId?: string;
    authorize?: (task: Row) => void;
    assertFreshContext(roomId: string, actorId: string, seq: number): void;
    assertReady?: (task: Row) => void;
  },
  actorId: string,
  input: { taskId: string; basedOnRoomSeq: number; idempotencyKey: string },
): TaskCreateMutationResult {
  const { database, events } = context;
  const get = () => {
    const row = database
      .prepare("SELECT * FROM tasks WHERE task_id=?")
      .get(input.taskId);
    if (!row) throw new NotFoundError(`task ${input.taskId} was not found`);
    return row;
  };
  const task = get(),
    roomId = text(task, "room_id");
  requireRoomMember(database, roomId, actorId);
  if (context.authorize) context.authorize(task);
  else if (text(task, "creator_id") !== actorId)
    throw new ForbiddenError("only the Task creator can unblock it");
  const previous = findRoomEventByIdempotencyKey(
    database,
    roomId,
    input.idempotencyKey,
  );
  if (previous) {
    const event = assertTaskEventReplay(events.eventFromRow(previous), {
      actorId,
      aggregateId: input.taskId,
      eventType: "task.unblocked",
      payload: {},
    });
    return {
      activationIds: [],
      deduplicated: true,
      event,
      task: taskProjectionFromRow(database, get()),
    };
  }
  context.assertFreshContext(roomId, actorId, input.basedOnRoomSeq);
  if (text(task, "state") !== "blocked")
    throw new ConflictError(
      `Task ${input.taskId} can only be unblocked from blocked`,
    );
  context.assertReady?.(task);
  database
    .prepare(
      "UPDATE tasks SET state='todo',blocked_reason=NULL,blocked_at=NULL,updated_at=? WHERE task_id=?",
    )
    .run(context.unblockedAt, input.taskId);
  const event = events.append({
    actorId,
    aggregateId: input.taskId,
    aggregateType: "task",
    roomId,
    type: "task.unblocked",
    idempotencyKey: input.idempotencyKey,
    payload: {
      basedOnRoomSeq: input.basedOnRoomSeq,
      taskId: input.taskId,
      unblockedAt: context.unblockedAt,
      ...(context.runAttemptId ? { runAttemptId: context.runAttemptId } : {}),
    },
  });
  const assignee = nullableText(task, "assignee_id");
  const recipients =
    assignee === null
      ? listRoomAgentRecipients(database, roomId, "task_available")
      : [
          { participantId: assignee, reason: "task_assigned" as const },
          ...database
            .prepare(
              "SELECT participant_id FROM task_participants WHERE task_id=? AND role='collaborator' ORDER BY participant_id",
            )
            .all(input.taskId)
            .map((row) => ({
              participantId: text(row, "participant_id"),
              reason: "task_collaboration" as const,
            })),
        ];
  return {
    activationIds: events.deriveAttention(
      event,
      recipients,
      context.unblockedAt,
    ),
    deduplicated: false,
    event,
    task: taskProjectionFromRow(database, get()),
  };
}
