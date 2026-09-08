import type { DatabaseSync } from "node:sqlite";

import { requireRoomMember } from "./collaboration-policy.ts";
import {
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  NotFoundError,
  StaleContextError,
} from "./errors.ts";
import * as roomAgents from "./room-agent-service.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { integer, nullableText, text } from "./sqlite-row.ts";
import { taskProjectionFromRow } from "./task-projection.ts";
import type { TaskCreateMutationResult } from "./types.ts";

export type TaskUnassignCommand = {
  basedOnRoomSeq: number;
  idempotencyKey: string;
  taskId: string;
};

export function unassignTaskTransaction(
  database: DatabaseSync,
  events: RoomEventWriter,
  input: {
    actorId: string;
    command: TaskUnassignCommand;
    unassignedAt: string;
    runAttemptId?: string;
    assertFreshContext?: (taskId: string, seq: number) => void;
  },
): TaskCreateMutationResult {
  const command = input.command;
  const taskRow = database
    .prepare("SELECT * FROM tasks WHERE task_id = ?")
    .get(command.taskId);
  if (taskRow === undefined) {
    throw new NotFoundError(`task ${command.taskId} was not found`);
  }
  const roomId = text(taskRow, "room_id");
  requireRoomMember(database, roomId, input.actorId);
  if (text(taskRow, "creator_id") !== input.actorId) {
    throw new ForbiddenError("only the Task creator can unassign it");
  }
  const previous = database
    .prepare(
      "SELECT * FROM room_events WHERE room_id = ? AND idempotency_key = ?",
    )
    .get(roomId, command.idempotencyKey);
  if (previous !== undefined) {
    const event = events.eventFromRow(previous);
    if (
      event.type !== "task.unassigned" ||
      event.actorId !== input.actorId ||
      event.aggregateType !== "task" ||
      event.aggregateId !== command.taskId
    ) {
      throw new IdempotencyConflictError(
        `idempotency key ${command.idempotencyKey} was already used for another mutation`,
      );
    }
    return {
      activationIds: [],
      deduplicated: true,
      event,
      task: taskProjectionFromRow(database, taskRow),
    };
  }
  const room = database
    .prepare("SELECT next_seq FROM rooms WHERE room_id = ?")
    .get(roomId);
  if (room === undefined) {
    throw new NotFoundError(`Room ${roomId} was not found`);
  }
  const latestRoomSeq = integer(room, "next_seq") - 1;
  if (input.assertFreshContext)
    input.assertFreshContext(command.taskId, command.basedOnRoomSeq);
  else if (command.basedOnRoomSeq !== latestRoomSeq) {
    throw new StaleContextError(command.basedOnRoomSeq, latestRoomSeq);
  }
  const previousAssigneeId = nullableText(taskRow, "assignee_id");
  if (
    text(taskRow, "state") !== "todo" ||
    nullableText(taskRow, "claimed_by") !== null ||
    previousAssigneeId === null
  ) {
    throw new ConflictError(
      `Task ${command.taskId} can only be unassigned while assigned and unclaimed todo`,
    );
  }
  database
    .prepare(
      "UPDATE tasks SET assignee_id = NULL, updated_at = ? WHERE task_id = ?",
    )
    .run(input.unassignedAt, command.taskId);
  const previousParticipants = database
    .prepare(
      "SELECT participant_id, role FROM task_participants WHERE task_id = ? ORDER BY participant_id, role",
    )
    .all(command.taskId);
  database
    .prepare("DELETE FROM task_participants WHERE task_id = ?")
    .run(command.taskId);
  const event = events.append({
    actorId: input.actorId,
    aggregateId: command.taskId,
    aggregateType: "task",
    idempotencyKey: command.idempotencyKey,
    payload: {
      basedOnRoomSeq: command.basedOnRoomSeq,
      previousAssigneeId,
      previousCollaboratorIds: previousParticipants
        .filter((participant) => text(participant, "role") === "collaborator")
        .map((participant) => text(participant, "participant_id")),
      previousReviewerIds: previousParticipants
        .filter((participant) => text(participant, "role") === "reviewer")
        .map((participant) => text(participant, "participant_id")),
      taskId: command.taskId,
      unassignedAt: input.unassignedAt,
      ...(input.runAttemptId ? { runAttemptId: input.runAttemptId } : {}),
    },
    roomId,
    type: "task.unassigned",
  });
  const activationIds = events.deriveAttention(
    event,
    roomAgents.listRoomAgentRecipients(database, roomId, "task_available"),
    input.unassignedAt,
  );
  const updated = database
    .prepare("SELECT * FROM tasks WHERE task_id = ?")
    .get(command.taskId);
  if (updated === undefined) {
    throw new NotFoundError(`task ${command.taskId} was not found`);
  }
  return {
    activationIds,
    deduplicated: false,
    event,
    task: taskProjectionFromRow(database, updated),
  };
}
