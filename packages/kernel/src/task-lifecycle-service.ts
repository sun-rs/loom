import type { DatabaseSync } from "node:sqlite";

import type { AuthenticatedActorContext } from "./auth.ts";
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
import { integer, nullableText, text, type Row } from "./sqlite-row.ts";
import { taskProjectionFromRow } from "./task-projection.ts";
import type { TaskCreateMutationResult } from "./types.ts";
import { requestActiveTaskExecutionCancellation } from "./activation-cancellation.ts";

export type TaskLifecycleServiceOptions = {
  createId: (prefix: string) => string;
  database: DatabaseSync;
  events: RoomEventWriter;
  now: () => Date;
  requireActor: (actor: AuthenticatedActorContext) => string;
  transaction: <Result>(operation: () => Result) => Result;
};

export class TaskLifecycleService {
  readonly #createId: (prefix: string) => string;
  readonly #database: DatabaseSync;
  readonly #events: RoomEventWriter;
  readonly #now: () => Date;
  readonly #requireActor: (actor: AuthenticatedActorContext) => string;
  readonly #transaction: <Result>(operation: () => Result) => Result;

  constructor(options: TaskLifecycleServiceOptions) {
    this.#createId = options.createId;
    this.#database = options.database;
    this.#events = options.events;
    this.#now = options.now;
    this.#requireActor = options.requireActor;
    this.#transaction = options.transaction;
  }

  cancelTask(
    actor: AuthenticatedActorContext,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      reason: string;
      taskId: string;
    },
  ): TaskCreateMutationResult {
    const reason = input.reason.trim();
    if (reason.length === 0) throw new Error("cancellation reason is required");
    return this.#transaction(() => {
      const actorId = this.#requireActor(actor);
      const taskRow = this.#requireTask(input.taskId);
      const roomId = text(taskRow, "room_id");
      requireRoomMember(this.#database, roomId, actorId);
      if (text(taskRow, "creator_id") !== actorId) {
        throw new ForbiddenError("only the Task creator can cancel it");
      }
      const replay = this.#findReplay(roomId, input.idempotencyKey);
      if (replay !== undefined) {
        return this.#taskReplay(
          replay,
          actorId,
          input.taskId,
          "task.cancelled",
        );
      }
      this.#assertFresh(roomId, input.basedOnRoomSeq);
      const previousState = text(taskRow, "state");
      if (previousState === "completed" || previousState === "cancelled") {
        throw new ConflictError(
          `Task ${input.taskId} cannot be cancelled from state ${previousState}`,
        );
      }

      const cancelledAt = this.#now().toISOString();
      const claimedBy = nullableText(taskRow, "claimed_by");
      const cancellationRequestId =
        claimedBy === null
          ? undefined
          : requestActiveTaskExecutionCancellation({
              actorId,
              createId: this.#createId,
              database: this.#database,
              participantId: claimedBy,
              reason,
              requestedAt: cancelledAt,
              roomId,
              taskId: input.taskId,
            });
      this.#database
        .prepare(
          "UPDATE tasks SET state = 'cancelled', claimed_by = NULL, claim_until = NULL, claim_until_ms = NULL, blocked_reason = NULL, blocked_at = NULL, cancellation_reason = ?, cancelled_at = ?, updated_at = ? WHERE task_id = ?",
        )
        .run(reason, cancelledAt, cancelledAt, input.taskId);
      const event = this.#events.append({
        actorId,
        aggregateId: input.taskId,
        aggregateType: "task",
        idempotencyKey: input.idempotencyKey,
        payload: {
          basedOnRoomSeq: input.basedOnRoomSeq,
          cancelledAt,
          ...(cancellationRequestId === undefined
            ? {}
            : { activationCancellationRequestId: cancellationRequestId }),
          previousState,
          reason,
          taskId: input.taskId,
        },
        roomId,
        type: "task.cancelled",
      });
      const assigneeId = nullableText(taskRow, "assignee_id");
      const activationIds =
        assigneeId === null || assigneeId === actorId
          ? []
          : this.#events.deriveAttention(
              event,
              [{ participantId: assigneeId, reason: "task_updated" }],
              cancelledAt,
            );
      return {
        activationIds,
        deduplicated: false,
        event,
        task: taskProjectionFromRow(
          this.#database,
          this.#requireTask(input.taskId),
        ),
      };
    });
  }

  reopenTask(
    actor: AuthenticatedActorContext,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      taskId: string;
    },
  ): TaskCreateMutationResult {
    return this.#transaction(() => {
      const actorId = this.#requireActor(actor);
      const taskRow = this.#requireTask(input.taskId);
      const roomId = text(taskRow, "room_id");
      requireRoomMember(this.#database, roomId, actorId);
      if (text(taskRow, "creator_id") !== actorId) {
        throw new ForbiddenError("only the Task creator can reopen it");
      }
      const replay = this.#findReplay(roomId, input.idempotencyKey);
      if (replay !== undefined) {
        return this.#taskReplay(replay, actorId, input.taskId, "task.reopened");
      }
      this.#assertFresh(roomId, input.basedOnRoomSeq);
      if (text(taskRow, "state") !== "cancelled") {
        throw new ConflictError(
          `Task ${input.taskId} can only be reopened from cancelled`,
        );
      }
      const pendingCancellation = this.#database
        .prepare(
          "SELECT request_id FROM activation_cancellation_requests WHERE task_id = ? AND resolved_at IS NULL LIMIT 1",
        )
        .get(input.taskId);
      if (pendingCancellation !== undefined) {
        throw new ConflictError(
          `Task ${input.taskId} cannot reopen until its previous Runtime has terminal proof`,
        );
      }

      const reopenedAt = this.#now().toISOString();
      const previousCancellationReason = nullableText(
        taskRow,
        "cancellation_reason",
      );
      const previousCancelledAt = nullableText(taskRow, "cancelled_at");
      this.#database
        .prepare(
          `UPDATE tasks
           SET state = 'todo', claimed_by = NULL, claim_until = NULL,
               claim_until_ms = NULL, blocked_reason = NULL, blocked_at = NULL,
               submission_summary = NULL, submitted_at = NULL,
               completed_at = NULL, cancellation_reason = NULL,
               cancelled_at = NULL, updated_at = ?
           WHERE task_id = ?`,
        )
        .run(reopenedAt, input.taskId);
      const event = this.#events.append({
        actorId,
        aggregateId: input.taskId,
        aggregateType: "task",
        idempotencyKey: input.idempotencyKey,
        payload: {
          basedOnRoomSeq: input.basedOnRoomSeq,
          ...(previousCancellationReason === null
            ? {}
            : { previousCancellationReason }),
          ...(previousCancelledAt === null ? {} : { previousCancelledAt }),
          reopenedAt,
          taskId: input.taskId,
        },
        roomId,
        type: "task.reopened",
      });
      const assigneeId = nullableText(taskRow, "assignee_id");
      const collaboratorIds = this.#database
        .prepare(
          "SELECT participant_id FROM task_participants WHERE task_id = ? AND role = 'collaborator' ORDER BY participant_id",
        )
        .all(input.taskId)
        .map((row) => text(row, "participant_id"));
      const recipients =
        assigneeId === null
          ? roomAgents.listRoomAgentRecipients(
              this.#database,
              roomId,
              "task_available",
            )
          : [
              {
                obligations: [
                  {
                    kind: "task_owner_follow_up" as const,
                    taskId: input.taskId,
                  },
                ],
                participantId: assigneeId,
                reason: "task_assigned" as const,
              },
              ...collaboratorIds
                .filter((participantId) => participantId !== assigneeId)
                .map((participantId) => ({
                  participantId,
                  reason: "task_collaboration" as const,
                })),
            ];
      const activationIds = this.#events.deriveAttention(
        event,
        recipients,
        reopenedAt,
      );
      return {
        activationIds,
        deduplicated: false,
        event,
        task: taskProjectionFromRow(
          this.#database,
          this.#requireTask(input.taskId),
        ),
      };
    });
  }

  #assertFresh(roomId: string, basedOnRoomSeq: number): void {
    const room = this.#database
      .prepare("SELECT next_seq FROM rooms WHERE room_id = ?")
      .get(roomId);
    if (room === undefined)
      throw new NotFoundError(`Room ${roomId} was not found`);
    const latestRoomSeq = integer(room, "next_seq") - 1;
    if (basedOnRoomSeq !== latestRoomSeq) {
      throw new StaleContextError(basedOnRoomSeq, latestRoomSeq);
    }
  }

  #findReplay(roomId: string, idempotencyKey: string): Row | undefined {
    return this.#database
      .prepare(
        "SELECT * FROM room_events WHERE room_id = ? AND idempotency_key = ?",
      )
      .get(roomId, idempotencyKey);
  }

  #taskReplay(
    row: Row,
    actorId: string,
    taskId: string,
    eventType: "task.cancelled" | "task.reopened",
  ): TaskCreateMutationResult {
    const event = this.#events.eventFromRow(row);
    if (
      event.type !== eventType ||
      event.actorId !== actorId ||
      event.aggregateType !== "task" ||
      event.aggregateId !== taskId
    ) {
      throw new IdempotencyConflictError(
        `idempotency key ${event.idempotencyKey} was already used for another mutation`,
      );
    }
    return {
      activationIds: [],
      deduplicated: true,
      event,
      task: taskProjectionFromRow(this.#database, this.#requireTask(taskId)),
    };
  }

  #requireTask(taskId: string): Row {
    const row = this.#database
      .prepare("SELECT * FROM tasks WHERE task_id = ?")
      .get(taskId);
    if (row === undefined)
      throw new NotFoundError(`task ${taskId} was not found`);
    return row;
  }
}
