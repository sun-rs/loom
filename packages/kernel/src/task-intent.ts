import type { DatabaseSync } from "node:sqlite";

import type { ActivationCredentialScope, RoomEvent } from "@rah-os/protocol";

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StaleContextError,
} from "./errors.ts";
import type { MessageRecipient } from "./collaboration-service.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { integer, text, type Row } from "./sqlite-row.ts";
import {
  assertTaskAnchorAvailable,
  createAnchoredTaskProjection,
  resolveTaskAnchorTitle,
  type TaskCreateCommand,
} from "./task-anchor.ts";
import { taskProjectionFromRow } from "./task-projection.ts";
import {
  assertTaskEventReplay,
  findRoomEventByIdempotencyKey,
} from "./task-event-replay.ts";
import type { TaskCreateMutationResult, TaskMutationResult } from "./types.ts";

type TaskIntentContext = {
  assertFreshContext(
    roomId: string,
    actorId: string,
    basedOnRoomSeq: number | undefined,
  ): void;
  createId(prefix: string): string;
  database: DatabaseSync;
  events: RoomEventWriter;
  now(): Date;
};

export function createTaskMutationTransaction(
  context: TaskIntentContext,
  actorId: string,
  input: TaskCreateCommand,
): TaskCreateMutationResult {
  const collaboratorIds = [...(input.collaboratorIds ?? [])].sort();
  const reviewerIds = [...(input.reviewerIds ?? [])].sort();
  requireUniqueRole("collaborators", collaboratorIds);
  requireUniqueRole("reviewers", reviewerIds);
  if (
    input.assigneeId === undefined &&
    (collaboratorIds.length > 0 || reviewerIds.length > 0)
  ) {
    throw new ConflictError(
      "Task collaborators and reviewers require one explicit assignee",
    );
  }
  if (
    input.assigneeId !== undefined &&
    (collaboratorIds.includes(input.assigneeId) ||
      reviewerIds.includes(input.assigneeId))
  ) {
    throw new ConflictError(
      "Task assignee cannot also be a collaborator or reviewer",
    );
  }
  for (const participantId of new Set([
    ...(input.assigneeId === undefined ? [] : [input.assigneeId]),
    ...collaboratorIds,
    ...reviewerIds,
  ])) {
    requireAgentRoomMember(context.database, input.roomId, participantId);
  }

  const dependencyTaskIds = [...(input.dependencyTaskIds ?? [])].sort();
  if (new Set(dependencyTaskIds).size !== dependencyTaskIds.length) {
    throw new ConflictError("Task dependencies must be unique");
  }
  const dependencies = dependencyTaskIds.map((dependencyTaskId) => {
    const dependency = requireTaskRow(context.database, dependencyTaskId);
    if (text(dependency, "room_id") !== input.roomId) {
      throw new ForbiddenError(
        `Task dependency ${dependencyTaskId} is outside Room ${input.roomId}`,
      );
    }
    return dependency;
  });
  const title = resolveTaskAnchorTitle(context.database, input);
  const description = input.description?.trim();
  if (input.description !== undefined && description?.length === 0) {
    throw new Error("task description cannot be empty");
  }
  if (input.idempotencyKey.trim().length === 0) {
    throw new Error("idempotencyKey is required");
  }

  const previous = findRoomEventByIdempotencyKey(
    context.database,
    input.roomId,
    input.idempotencyKey,
  );
  if (previous !== undefined) {
    const event = assertTaskEventReplay(context.events.eventFromRow(previous), {
      actorId,
      eventType: "task.created",
      payload: {
        assigneeId: input.assigneeId,
        basedOnRoomSeq: input.basedOnRoomSeq,
        collaboratorIds,
        creatorId: actorId,
        dependencyTaskIds,
        description,
        reviewerIds,
        ...(input.sourceMessageId === undefined
          ? {}
          : { sourceMessageId: input.sourceMessageId }),
        title,
      },
    });
    return {
      activationIds: [],
      deduplicated: true,
      event,
      task: taskProjectionFromRow(
        context.database,
        requireTaskRow(context.database, event.aggregateId),
      ),
    };
  }

  context.assertFreshContext(input.roomId, actorId, input.basedOnRoomSeq);
  assertTaskAnchorAvailable(context.database, input.sourceMessageId);
  const taskId = context.createId("task");
  const createdAt = context.now().toISOString();
  const { eventPayload } = createAnchoredTaskProjection(
    context.database,
    context.createId,
    {
      actorId,
      command: {
        ...input,
        collaboratorIds,
        dependencyTaskIds,
        description,
        reviewerIds,
        title,
      },
      createdAt,
      taskId,
    },
  );
  const event = context.events.append({
    actorId,
    aggregateId: taskId,
    aggregateType: "task",
    idempotencyKey: input.idempotencyKey,
    payload: eventPayload,
    roomId: input.roomId,
    type: "task.created",
  });
  const isReady = dependencies.every(
    (dependency) => text(dependency, "state") === "completed",
  );
  const recipients = isReady
    ? taskCreationRecipients(
        context.database,
        input.roomId,
        input.assigneeId,
        collaboratorIds,
      )
    : [];
  return {
    activationIds: context.events.deriveAttention(event, recipients, createdAt),
    deduplicated: false,
    event,
    task: taskProjectionFromRow(
      context.database,
      requireTaskRow(context.database, taskId),
    ),
  };
}

export function claimMessageAsTaskTransaction(
  context: TaskIntentContext,
  scope: ActivationCredentialScope,
  input: {
    basedOnRoomSeq: number;
    idempotencyKey: string;
    leaseMs: number;
    messageId: string;
    rationale: string;
  },
): TaskMutationResult {
  const rationale = input.rationale.trim();
  if (rationale.length === 0) {
    throw new Error("Task classification rationale is required");
  }
  if (!Number.isInteger(input.leaseMs) || input.leaseMs <= 0) {
    throw new Error("Task claim lease must be a positive integer");
  }
  if (input.basedOnRoomSeq !== scope.toSeq) {
    throw new StaleContextError(input.basedOnRoomSeq, scope.toSeq);
  }
  const previous = findRoomEventByIdempotencyKey(
    context.database,
    scope.roomId,
    input.idempotencyKey,
  );
  if (previous !== undefined) {
    const event = assertTaskEventReplay(context.events.eventFromRow(previous), {
      actorId: scope.participantId,
      eventType: "task.created",
      payload: {
        autoClaimed: true,
        basedOnRoomSeq: input.basedOnRoomSeq,
        classificationRationale: rationale,
        runAttemptId: scope.runAttemptId,
        sourceMessageId: input.messageId,
      },
    });
    return {
      deduplicated: true,
      event,
      task: taskProjectionFromRow(
        context.database,
        requireTaskRow(context.database, event.aggregateId),
      ),
    };
  }

  const activation = context.database
    .prepare("SELECT * FROM activations WHERE activation_id = ?")
    .get(scope.activationId);
  if (activation === undefined) {
    throw new NotFoundError(`activation ${scope.activationId} was not found`);
  }
  const messageRow = context.database
    .prepare(
      `SELECT messages.*
       FROM messages
       JOIN principals
         ON principals.principal_id = messages.actor_id
       JOIN room_events
         ON room_events.room_id = messages.room_id
        AND room_events.type = 'message.posted'
        AND room_events.aggregate_type = 'message'
        AND room_events.aggregate_id = messages.message_id
       JOIN inbox_items
         ON inbox_items.event_id = room_events.event_id
        AND inbox_items.participant_id = ?
       WHERE messages.room_id = ?
         AND messages.message_id = ?
         AND messages.thread_id IS NULL
         AND principals.kind = 'human'
         AND room_events.room_seq BETWEEN ? AND ?
       LIMIT 1`,
    )
    .get(
      scope.participantId,
      scope.roomId,
      input.messageId,
      integer(activation, "from_seq"),
      integer(activation, "to_seq"),
    );
  if (messageRow === undefined) {
    throw new ForbiddenError(
      `Message ${input.messageId} is not a causal top-level Human message in this Activation`,
    );
  }

  assertTaskAnchorAvailable(context.database, input.messageId);
  const taskId = context.createId("task");
  const now = context.now();
  const claimedAt = now.toISOString();
  const claimUntil = new Date(now.getTime() + input.leaseMs).toISOString();
  const creatorId = text(messageRow, "actor_id");
  const { eventPayload } = createAnchoredTaskProjection(
    context.database,
    context.createId,
    {
      actorId: creatorId,
      command: {
        assigneeId: scope.participantId,
        basedOnRoomSeq: input.basedOnRoomSeq,
        collaboratorIds: [],
        dependencyTaskIds: [],
        description: undefined,
        idempotencyKey: input.idempotencyKey,
        reviewerIds: [],
        roomId: scope.roomId,
        sourceMessageId: input.messageId,
        title: text(messageRow, "body"),
      },
      createdAt: claimedAt,
      taskId,
    },
  );
  context.database
    .prepare(
      "UPDATE tasks SET state = 'claimed', claimed_by = ?, claim_until = ?, claim_until_ms = ?, updated_at = ? WHERE task_id = ?",
    )
    .run(
      scope.participantId,
      claimUntil,
      now.getTime() + input.leaseMs,
      claimedAt,
      taskId,
    );
  const event = context.events.append({
    actorId: scope.participantId,
    aggregateId: taskId,
    aggregateType: "task",
    idempotencyKey: input.idempotencyKey,
    payload: {
      ...eventPayload,
      autoClaimed: true,
      classificationRationale: rationale,
      claimedAt,
      claimedBy: scope.participantId,
      claimUntil,
      runAttemptId: scope.runAttemptId,
    },
    roomId: scope.roomId,
    type: "task.created",
  });
  return {
    deduplicated: false,
    event,
    task: taskProjectionFromRow(
      context.database,
      requireTaskRow(context.database, taskId),
    ),
  };
}

function taskCreationRecipients(
  database: DatabaseSync,
  roomId: string,
  assigneeId: string | undefined,
  collaboratorIds: readonly string[],
): MessageRecipient[] {
  if (assigneeId !== undefined) {
    return [
      { participantId: assigneeId, reason: "task_assigned" },
      ...collaboratorIds.map((participantId) => ({
        participantId,
        reason: "task_collaboration" as const,
      })),
    ];
  }
  return database
    .prepare(
      `SELECT principals.principal_id
       FROM memberships
       JOIN principals ON principals.principal_id = memberships.principal_id
       WHERE memberships.room_id = ? AND principals.kind = 'agent'
       ORDER BY principals.principal_id`,
    )
    .all(roomId)
    .map((row) => ({
      participantId: text(row, "principal_id"),
      reason: "task_available" as const,
    }));
}

function requireAgentRoomMember(
  database: DatabaseSync,
  roomId: string,
  participantId: string,
): void {
  const member = database
    .prepare(
      `SELECT principals.kind
       FROM memberships
       JOIN principals ON principals.principal_id = memberships.principal_id
       WHERE memberships.room_id = ? AND memberships.principal_id = ?`,
    )
    .get(roomId, participantId);
  if (member === undefined) {
    throw new ForbiddenError(
      `principal ${participantId} is not a member of Room ${roomId}`,
    );
  }
  if (text(member, "kind") !== "agent") {
    throw new ForbiddenError("Task participants must be Agent principals");
  }
}

function requireUniqueRole(role: string, ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) {
    throw new ConflictError(`Task ${role} must be unique`);
  }
}

function requireTaskRow(database: DatabaseSync, taskId: string): Row {
  const row = database
    .prepare("SELECT * FROM tasks WHERE task_id = ?")
    .get(taskId);
  if (row === undefined) {
    throw new NotFoundError(`task ${taskId} was not found`);
  }
  return row;
}
