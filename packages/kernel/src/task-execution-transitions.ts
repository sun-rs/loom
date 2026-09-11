import type { DatabaseSync } from "node:sqlite";
import type { ActivationCredentialScope, RoomEvent } from "@rah-os/protocol";
import type { RoomEventWriter } from "./room-event-writer.ts";
import type { TaskMutationResult, TaskCreateMutationResult } from "./types.ts";
import { text, type Row } from "./sqlite-row.ts";
import { ConflictError } from "./errors.ts";
import { requireWorkerTaskDelivery } from "./worker-task-scope.ts";
import { taskProjectionFromRow } from "./task-projection.ts";
import {
  assertWorkerTaskFreshContext,
  requireOwnedTaskClaim,
} from "./task-intent.ts";
import { createTaskThreadReply } from "./task-anchor.ts";
import * as ar from "./room-agent-service.ts";
import {
  findRoomEventByIdempotencyKey,
  assertTaskEventReplay,
} from "./task-event-replay.ts";
export type Context = {
  database: DatabaseSync;
  events: RoomEventWriter;
  createId(prefix: string): string;
  now(): Date;
};
/** Original Kernel transaction bodies. Callers own the transaction; one owner is shared by legacy commands and status composition. */
function replayTransition(
  context: Context,
  taskRow: Row,
  scope: ActivationCredentialScope,
  input: {
    eventType: string;
    idempotencyKey: string;
    payload?: Record<string, unknown>;
  },
): TaskMutationResult | null {
  const old = findRoomEventByIdempotencyKey(
    context.database,
    scope.roomId,
    input.idempotencyKey,
  );
  if (!old) return null;
  const event = assertTaskEventReplay(context.events.eventFromRow(old), {
    actorId: scope.participantId,
    aggregateId: text(taskRow, "task_id"),
    eventType: input.eventType,
    payload: input.payload ?? {},
  });
  return {
    deduplicated: true,
    event,
    task: taskProjectionFromRow(context.database, taskRow),
  };
}
function append(
  context: Context,
  scope: ActivationCredentialScope,
  input: {
    basedOnRoomSeq: number;
    eventType: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    taskId: string;
  },
): RoomEvent {
  return context.events.append({
    actorId: scope.participantId,
    aggregateId: input.taskId,
    aggregateType: "task",
    idempotencyKey: input.idempotencyKey,
    payload: {
      basedOnRoomSeq: input.basedOnRoomSeq,
      runAttemptId: scope.runAttemptId,
      taskId: input.taskId,
      ...input.payload,
    },
    roomId: scope.roomId,
    type: input.eventType,
  });
}
export function releaseTaskTransaction(
  context: Context,
  scope: ActivationCredentialScope,
  input: {
    basedOnRoomSeq: number;
    idempotencyKey: string;
    taskId: string;
  },
): TaskCreateMutationResult {
  const taskRow = requireWorkerTaskDelivery(
    context.database,
    scope,
    input.taskId,
  );
  const replay = replayTransition(context, taskRow, scope, {
    eventType: "task.released",
    idempotencyKey: input.idempotencyKey,
  });
  if (replay !== null) return { ...replay, activationIds: [] };
  assertWorkerTaskFreshContext(
    context.database,
    scope,
    input.basedOnRoomSeq,
    input.taskId,
  );
  const previousState = text(taskRow, "state");
  if (previousState !== "claimed" && previousState !== "in_progress") {
    throw new ConflictError(
      `Task ${input.taskId} cannot be released from state ${previousState}`,
    );
  }
  requireOwnedTaskClaim(
    taskRow,
    scope.participantId,
    previousState,
    context.now().getTime(),
  );

  const releasedAt = context.now().toISOString();
  const previousParticipants = context.database
    .prepare(
      "SELECT participant_id, role FROM task_participants WHERE task_id = ? ORDER BY participant_id, role",
    )
    .all(input.taskId);
  context.database
    .prepare(
      "UPDATE tasks SET state = 'todo', assignee_id = NULL, claimed_by = NULL, claim_until = NULL, claim_until_ms = NULL, updated_at = ? WHERE task_id = ?",
    )
    .run(releasedAt, input.taskId);
  context.database
    .prepare("DELETE FROM task_participants WHERE task_id = ?")
    .run(input.taskId);
  const event = append(context, scope, {
    basedOnRoomSeq: input.basedOnRoomSeq,
    eventType: "task.released",
    idempotencyKey: input.idempotencyKey,
    payload: {
      previousAssigneeId: scope.participantId,
      previousCollaboratorIds: previousParticipants
        .filter((participant) => text(participant, "role") === "collaborator")
        .map((participant) => text(participant, "participant_id")),
      previousReviewerIds: previousParticipants
        .filter((participant) => text(participant, "role") === "reviewer")
        .map((participant) => text(participant, "participant_id")),
      previousState,
      releasedAt,
    },
    taskId: input.taskId,
  });
  const recipients = ar.listRoomAgentRecipients(
    context.database,
    scope.roomId,
    "task_available",
    scope.participantId,
  );
  const activationIds = context.events.deriveAttention(
    event,
    recipients,
    releasedAt,
  );
  return {
    activationIds,
    deduplicated: false,
    event,
    task: taskProjectionFromRow(
      context.database,
      requireWorkerTaskDelivery(context.database, scope, input.taskId),
    ),
  };
}

export function transitionOwnedTaskTransaction(
  context: Context,
  scope: ActivationCredentialScope,
  input: {
    basedOnRoomSeq: number;
    eventType: "task.progressed" | "task.started";
    expectedState: "claimed" | "in_progress";
    extraPayload?: Record<string, unknown>;
    idempotencyKey: string;
    lastProgress?: string;
    leaseMs: number;
    nextState: "in_progress";
    taskId: string;
  },
): TaskMutationResult {
  const taskRow = requireWorkerTaskDelivery(
    context.database,
    scope,
    input.taskId,
  );
  const replay = replayTransition(context, taskRow, scope, {
    eventType: input.eventType,
    idempotencyKey: input.idempotencyKey,
    ...(input.extraPayload === undefined
      ? {}
      : { payload: input.extraPayload }),
  });
  if (replay !== null) return replay;
  if (!Number.isInteger(input.leaseMs) || input.leaseMs <= 0)
    throw new Error("leaseMs must be a positive integer");
  assertWorkerTaskFreshContext(
    context.database,
    scope,
    input.basedOnRoomSeq,
    input.taskId,
  );
  requireOwnedTaskClaim(
    taskRow,
    scope.participantId,
    input.expectedState,
    context.now().getTime(),
  );

  const now = context.now();
  const updatedAt = now.toISOString();
  const claimUntil = new Date(now.getTime() + input.leaseMs).toISOString();
  if (input.lastProgress === undefined) {
    context.database
      .prepare(
        "UPDATE tasks SET state = ?, claim_until = ?, claim_until_ms = ?, updated_at = ? WHERE task_id = ?",
      )
      .run(
        input.nextState,
        claimUntil,
        now.getTime() + input.leaseMs,
        updatedAt,
        input.taskId,
      );
  } else {
    context.database
      .prepare(
        "UPDATE tasks SET state = ?, claim_until = ?, claim_until_ms = ?, last_progress = ?, updated_at = ? WHERE task_id = ?",
      )
      .run(
        input.nextState,
        claimUntil,
        now.getTime() + input.leaseMs,
        input.lastProgress,
        updatedAt,
        input.taskId,
      );
  }
  const reply =
    input.lastProgress === undefined
      ? undefined
      : createTaskThreadReply(context.database, context.createId, taskRow, {
          actorId: scope.participantId,
          body: input.lastProgress,
          createdAt: updatedAt,
          roomId: scope.roomId,
        });
  const event = append(context, scope, {
    basedOnRoomSeq: input.basedOnRoomSeq,
    eventType: input.eventType,
    idempotencyKey: input.idempotencyKey,
    payload: {
      claimUntil,
      ...(input.extraPayload ?? {}),
      ...(reply ?? {}),
    },
    taskId: input.taskId,
  });
  return {
    deduplicated: false,
    event,
    task: taskProjectionFromRow(
      context.database,
      requireWorkerTaskDelivery(context.database, scope, input.taskId),
    ),
  };
}
