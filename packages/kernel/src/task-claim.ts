import type { DatabaseSync } from "node:sqlite";
import type { ActivationCredentialScope } from "@rah-os/protocol";
import { ConflictError, LeaseConflictError } from "./errors.ts";
import { nullableInteger, nullableText, text, type Row } from "./sqlite-row.ts";
import { requireWorkerTaskDelivery } from "./worker-task-scope.ts";
import { assertWorkerTaskFreshContext } from "./task-intent.ts";
import { taskProjectionFromRow } from "./task-projection.ts";
import {
  findRoomEventByIdempotencyKey,
  assertTaskEventReplay,
} from "./task-event-replay.ts";
import type { TaskMutationResult } from "./types.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
export type TaskClaimContext = {
  database: DatabaseSync;
  events: RoomEventWriter;
  now(): Date;
};
export type TaskClaimInput = {
  basedOnRoomSeq: number;
  idempotencyKey: string;
  leaseMs: number;
  taskId: string;
};
/** Existing single-claim transaction body, shared by batch and legacy entry points. Caller owns transaction. */
export function claimTaskTransaction(
  context: TaskClaimContext,
  scope: ActivationCredentialScope,
  input: TaskClaimInput,
): TaskMutationResult {
  const taskRow = requireWorkerTaskDelivery(
    context.database,
    scope,
    input.taskId,
  );
  const replay = replayClaim(context, taskRow, scope, {
    eventType: "task.claimed",
    idempotencyKey: input.idempotencyKey,
  });
  if (replay !== null) return replay;
  if (!Number.isInteger(input.leaseMs) || input.leaseMs <= 0)
    throw new Error("leaseMs must be a positive integer");
  const existingAssignee = nullableText(taskRow, "assignee_id");
  if (existingAssignee !== null && existingAssignee !== scope.participantId) {
    throw new LeaseConflictError(
      `Task ${input.taskId} is owned by another Agent`,
    );
  }
  const incompleteDependency = context.database
    .prepare(
      `SELECT task_dependencies.dependency_task_id
           FROM task_dependencies
           JOIN tasks AS dependency
             ON dependency.task_id = task_dependencies.dependency_task_id
           WHERE task_dependencies.task_id = ?
             AND dependency.state <> 'completed'
           ORDER BY task_dependencies.dependency_task_id
           LIMIT 1`,
    )
    .get(input.taskId);
  if (incompleteDependency !== undefined) {
    throw new ConflictError(
      `Task ${input.taskId} is waiting for dependency ${text(incompleteDependency, "dependency_task_id")}`,
    );
  }
  assertWorkerTaskFreshContext(
    context.database,
    scope,
    input.basedOnRoomSeq,
    input.taskId,
  );

  const previousState = text(taskRow, "state");
  const previousClaimedBy = nullableText(taskRow, "claimed_by");
  const previousClaimUntil = nullableText(taskRow, "claim_until");
  const previousClaimUntilMs = nullableInteger(taskRow, "claim_until_ms");
  const claimIsActive =
    (previousState === "claimed" || previousState === "in_progress") &&
    previousClaimUntilMs !== null &&
    previousClaimUntilMs > context.now().getTime();
  if (previousState !== "todo" && !claimIsActive) {
    if (previousState !== "claimed" && previousState !== "in_progress") {
      throw new ConflictError(
        `Task ${input.taskId} cannot be claimed from state ${previousState}`,
      );
    }
  }
  if (claimIsActive) {
    throw new LeaseConflictError(
      `Task ${input.taskId} already has an active claim`,
    );
  }

  const now = context.now();
  const updatedAt = now.toISOString();
  const claimUntil = new Date(now.getTime() + input.leaseMs).toISOString();
  context.database
    .prepare(
      "UPDATE tasks SET state = 'claimed', assignee_id = ?, claimed_by = ?, claim_until = ?, claim_until_ms = ?, updated_at = ? WHERE task_id = ?",
    )
    .run(
      scope.participantId,
      scope.participantId,
      claimUntil,
      now.getTime() + input.leaseMs,
      updatedAt,
      input.taskId,
    );
  const event = append(context, scope, {
    basedOnRoomSeq: input.basedOnRoomSeq,
    eventType: "task.claimed",
    idempotencyKey: input.idempotencyKey,
    payload: {
      claimedBy: scope.participantId,
      claimUntil,
      ...(previousClaimedBy === null ? {} : { previousClaimedBy }),
      ...(previousClaimUntil === null ? {} : { previousClaimUntil }),
      previousState,
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
function replayClaim(
  context: TaskClaimContext,
  row: Row,
  scope: ActivationCredentialScope,
  input: { eventType: "task.claimed"; idempotencyKey: string },
): TaskMutationResult | null {
  const old = findRoomEventByIdempotencyKey(
    context.database,
    text(row, "room_id"),
    input.idempotencyKey,
  );
  if (!old) return null;
  const event = assertTaskEventReplay(context.events.eventFromRow(old), {
    actorId: scope.participantId,
    aggregateId: text(row, "task_id"),
    eventType: input.eventType,
    payload: {},
  });
  return {
    deduplicated: true,
    event,
    task: taskProjectionFromRow(context.database, row),
  };
}
function append(
  context: TaskClaimContext,
  scope: ActivationCredentialScope,
  input: {
    basedOnRoomSeq: number;
    eventType: "task.claimed";
    idempotencyKey: string;
    payload: Record<string, unknown>;
    taskId: string;
  },
) {
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
