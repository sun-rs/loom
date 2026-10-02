import type { DatabaseSync } from "node:sqlite";
import type {
  ActivationCredentialScope,
  WorkerTaskUpdateRequest,
} from "@rah-os/protocol";
import type { AuthenticatedWorkerExecutionContext } from "./auth.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import type { TaskMutationResult, TaskCreateMutationResult } from "./types.ts";
import { ConflictError, ForbiddenError } from "./errors.ts";
import { text, nullableText, nullableInteger } from "./sqlite-row.ts";
import { requireWorkerTaskDelivery } from "./worker-task-scope.ts";
import { assertWorkerTaskFreshContext } from "./task-intent.ts";
import { taskProjectionFromRow } from "./task-projection.ts";
import {
  assertTaskEventReplay,
  findRoomEventByIdempotencyKey,
} from "./task-event-replay.ts";
import { claimTaskTransaction } from "./task-claim.ts";
import {
  releaseTaskTransaction,
  transitionOwnedTaskTransaction,
} from "./task-execution-transitions.ts";
import { resolveWorkerTaskCommandCausality } from "./worker-task-command-identity.ts";
export type WorkerTaskStatusContext = {
  database: DatabaseSync;
  events: RoomEventWriter;
  createId(prefix: string): string;
  now(): Date;
  requireWorker(
    execution: AuthenticatedWorkerExecutionContext,
  ): ActivationCredentialScope;
  transaction<T>(operation: () => T): T;
  completeTask(
    scope: ActivationCredentialScope,
    input: StatusCommand,
  ): TaskCreateMutationResult;
  cancelTask(
    scope: ActivationCredentialScope,
    input: StatusCommand,
  ): TaskCreateMutationResult;
};
export type StatusCommand = WorkerTaskUpdateRequest & {
  basedOnRoomSeq: number;
  idempotencyKey: string;
};
/** Raft task update accepts five states. This facade composes existing local owners; it is not a new Task state machine. */
export function updateWorkerTaskStatus(
  context: WorkerTaskStatusContext,
  execution: AuthenticatedWorkerExecutionContext,
  input: StatusCommand,
  leaseMs: number,
): TaskMutationResult {
  return context.transaction(() => {
    const scope = context.requireWorker(execution),
      db = context.database;
    const task = requireWorkerTaskDelivery(db, scope, input.taskId);
    const claimActive =
      (nullableInteger(task, "claim_until_ms") ?? 0) > context.now().getTime();
    const state = text(task, "state"),
      owner = nullableText(task, "assignee_id");
    if (owner !== null && owner !== scope.participantId)
      throw new ForbiddenError(
        "Only this Task's assignee may update its status",
      );
    if (input.status === "done" || input.status === "closed") {
      if (owner !== scope.participantId)
        throw new ForbiddenError(
          "Only this Task's assignee may complete or close it",
        );
      const { activationIds: _attention, ...mutation } =
        input.status === "done"
          ? context.completeTask(scope, input)
          : context.cancelTask(scope, input);
      return mutation;
    }
    const eventType =
      input.status === "in_progress" ? "task.started" : "task.released";
    const previous = findRoomEventByIdempotencyKey(
      db,
      scope.roomId,
      input.idempotencyKey,
    );
    if (previous) {
      const event = assertTaskEventReplay(
        context.events.eventFromRow(previous),
        {
          actorId: scope.participantId,
          aggregateId: input.taskId,
          eventType,
          payload: {},
        },
      );
      return {
        event,
        deduplicated: true,
        task: taskProjectionFromRow(db, task),
      };
    }
    assertWorkerTaskFreshContext(db, scope, input.basedOnRoomSeq, input.taskId);
    if (
      (input.status === "in_progress" &&
        state === "in_progress" &&
        claimActive &&
        nullableText(task, "claimed_by") === scope.participantId) ||
      (input.status === "todo" && state === "todo")
    ) {
      const latest = db
        .prepare(
          "SELECT * FROM room_events WHERE room_id=? AND aggregate_type='task' AND aggregate_id=? ORDER BY room_seq DESC LIMIT 1",
        )
        .get(scope.roomId, input.taskId);
      if (!latest)
        throw new ConflictError("Task has no canonical status event");
      return {
        event: context.events.eventFromRow(latest),
        deduplicated: true,
        task: taskProjectionFromRow(db, task),
      };
    }
    if (input.status === "todo") {
      const { activationIds: _attention, ...mutation } = releaseTaskTransaction(
        context,
        scope,
        input,
      );
      return mutation;
    }
    if (input.status !== "in_progress")
      throw new ConflictError(
        "Review status requires the canonical submission owner",
      );
    let basedOnRoomSeq = input.basedOnRoomSeq;
    if (
      state === "todo" ||
      ((state === "claimed" || state === "in_progress") && !claimActive)
    ) {
      const claim = claimTaskTransaction(context, scope, {
        ...input,
        idempotencyKey: input.idempotencyKey + ":claim",
        leaseMs,
      });
      basedOnRoomSeq = claim.event.roomSeq;
    }
    return transitionOwnedTaskTransaction(context, scope, {
      ...input,
      basedOnRoomSeq,
      leaseMs,
      eventType: "task.started",
      expectedState: "claimed",
      nextState: "in_progress",
    });
  });
}
/** Existing authored result only; no status command fabricates delivery evidence. */
export function workerStatusSubmissionSummary(
  context: WorkerTaskStatusContext,
  execution: AuthenticatedWorkerExecutionContext,
  input: StatusCommand,
): string {
  return context.transaction(() => {
    const scope = context.requireWorker(execution),
      db = context.database;
    const task = requireWorkerTaskDelivery(db, scope, input.taskId);
    if (nullableText(task, "assignee_id") !== scope.participantId)
      throw new ForbiddenError("Only this Task's assignee may submit it");
    if (input.summary !== undefined) return input.summary;
    const prior = findRoomEventByIdempotencyKey(
      db,
      scope.roomId,
      input.idempotencyKey,
    );
    if (prior) {
      const event = assertTaskEventReplay(context.events.eventFromRow(prior), {
        actorId: scope.participantId,
        aggregateId: input.taskId,
        eventType: "task.submitted",
        payload: {},
      });
      if (typeof event.payload.summary === "string")
        return event.payload.summary;
    }
    const message = db
      .prepare(
        `SELECT m.body FROM messages m JOIN room_events e ON e.room_id=m.room_id AND e.aggregate_type='message' AND e.aggregate_id=m.message_id AND e.type='message.posted' WHERE m.room_id=? AND m.thread_id=? AND m.actor_id=? AND e.room_seq>(SELECT COALESCE(MAX(room_seq),0) FROM room_events WHERE room_id=? AND aggregate_id=? AND type='task.started') ORDER BY e.room_seq DESC LIMIT 1`,
      )
      .get(
        scope.roomId,
        text(task, "thread_id"),
        scope.participantId,
        scope.roomId,
        input.taskId,
      );
    if (message && typeof message.body === "string" && message.body.trim())
      return message.body;
    throw new ConflictError(
      "Post your actual result in this Task's Thread or provide --summary before setting in_review; no submission was fabricated",
    );
  });
}
/** Status rounds include explicit release, so start→todo→start is a new operation. */
export function resolveStatusCommand(
  context: WorkerTaskStatusContext,
  execution: AuthenticatedWorkerExecutionContext,
  input: WorkerTaskUpdateRequest,
): StatusCommand {
  return context.transaction(() => {
    const scope = context.requireWorker(execution);
    requireWorkerTaskDelivery(context.database, scope, input.taskId);
    const round = context.database
      .prepare(
        "SELECT MAX(room_seq) AS n FROM room_events WHERE room_id=? AND aggregate_id=? AND type IN ('task.released','task.reopened')",
      )
      .get(scope.roomId, input.taskId);
    return {
      ...input,
      ...resolveWorkerTaskCommandCausality(context.database, scope, {
        ...input,
        operation: "task-update",
        subjectId: input.taskId,
        content: [input.status, input.summary ?? null, String(round?.n ?? 0)],
      }),
    };
  });
}
