import type { DatabaseSync } from "node:sqlite";

import {
  TaskReassignmentOperationSchema,
  type ClientTaskReassignRequest,
  type ClientTaskReassignmentResponse,
  type TaskReassignmentOperation,
} from "@rah-os/protocol";

import type { AuthenticatedActorContext } from "./auth.ts";
import { requestActiveTaskExecutionCancellation } from "./activation-cancellation.ts";
import { requireRoomMember } from "./collaboration-policy.ts";
import {
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  NotFoundError,
  RuntimeTerminationProofError,
  StaleContextError,
} from "./errors.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { integer, nullableText, text, type Row } from "./sqlite-row.ts";
import {
  taskDependenciesComplete,
  taskProjectionFromRow,
} from "./task-projection.ts";

export class TaskReassignmentService {
  readonly #createId: (prefix: string) => string;
  readonly #database: DatabaseSync;
  readonly #events: RoomEventWriter;
  readonly #now: () => Date;
  readonly #requireActor: (actor: AuthenticatedActorContext) => string;
  readonly #transaction: <Result>(operation: () => Result) => Result;

  constructor(options: {
    createId: (prefix: string) => string;
    database: DatabaseSync;
    events: RoomEventWriter;
    now: () => Date;
    requireActor: (actor: AuthenticatedActorContext) => string;
    transaction: <Result>(operation: () => Result) => Result;
  }) {
    this.#createId = options.createId;
    this.#database = options.database;
    this.#events = options.events;
    this.#now = options.now;
    this.#requireActor = options.requireActor;
    this.#transaction = options.transaction;
  }

  request(
    actor: AuthenticatedActorContext,
    input: ClientTaskReassignRequest,
  ): ClientTaskReassignmentResponse {
    return this.#transaction(() => {
      const actorId = this.#requireActor(actor);
      const taskRow = this.#requireTask(input.taskId);
      const roomId = text(taskRow, "room_id");
      requireRoomMember(this.#database, roomId, actorId);
      if (text(taskRow, "creator_id") !== actorId) {
        throw new ForbiddenError("only the Task creator can reassign it");
      }
      const replay = this.#database
        .prepare(
          "SELECT * FROM task_reassignment_operations WHERE room_id = ? AND idempotency_key = ?",
        )
        .get(roomId, input.idempotencyKey);
      if (replay !== undefined) {
        return this.#replay(replay, actorId, input);
      }
      this.#assertFresh(roomId, input.basedOnRoomSeq);
      const previousAssigneeId = nullableText(taskRow, "assignee_id");
      const claimedBy = nullableText(taskRow, "claimed_by");
      const previousState = text(taskRow, "state");
      if (
        previousAssigneeId === null ||
        claimedBy !== previousAssigneeId ||
        (previousState !== "claimed" && previousState !== "in_progress")
      ) {
        throw new ConflictError(
          `Task ${input.taskId} requires forced reassignment only while claimed or in progress`,
        );
      }
      if (input.assigneeId === previousAssigneeId) {
        throw new ConflictError("Task is already owned by the selected Agent");
      }
      this.#requireAgentRoomMember(roomId, input.assigneeId);
      const overlappingRole = this.#database
        .prepare(
          "SELECT role FROM task_participants WHERE task_id = ? AND participant_id = ? LIMIT 1",
        )
        .get(input.taskId, input.assigneeId);
      if (overlappingRole !== undefined) {
        throw new ConflictError(
          `Task assignee cannot also be its ${text(overlappingRole, "role")}`,
        );
      }

      const reason = input.reason.trim();
      const operationId = this.#createId("task_reassignment");
      const requestedAt = this.#now().toISOString();
      this.#database
        .prepare(
          `INSERT INTO task_reassignment_operations(
             operation_id, room_id, task_id, requested_by,
             previous_assignee_id, next_assignee_id, idempotency_key, reason,
             state, created_at, updated_at
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)`,
        )
        .run(
          operationId,
          roomId,
          input.taskId,
          actorId,
          previousAssigneeId,
          input.assigneeId,
          input.idempotencyKey,
          reason,
          requestedAt,
          requestedAt,
        );
      const cancellationRequestId = requestActiveTaskExecutionCancellation({
        actorId,
        createId: this.#createId,
        database: this.#database,
        participantId: previousAssigneeId,
        reason: `Task reassignment: ${reason}`,
        requestedAt,
        roomId,
        taskId: input.taskId,
      });
      this.#database
        .prepare(
          `UPDATE tasks
           SET state = 'cancelled', claimed_by = NULL, claim_until = NULL,
               claim_until_ms = NULL, blocked_reason = NULL, blocked_at = NULL,
               cancellation_reason = ?, cancelled_at = ?, updated_at = ?
           WHERE task_id = ?`,
        )
        .run(
          `Reassignment requested: ${reason}`,
          requestedAt,
          requestedAt,
          input.taskId,
        );
      this.#database
        .prepare(
          `UPDATE task_reassignment_operations
           SET state = 'cancellation_requested', cancellation_request_id = ?,
               updated_at = ?
           WHERE operation_id = ?`,
        )
        .run(cancellationRequestId ?? null, requestedAt, operationId);
      const event = this.#events.append({
        actorId,
        aggregateId: input.taskId,
        aggregateType: "task",
        idempotencyKey: input.idempotencyKey,
        payload: {
          basedOnRoomSeq: input.basedOnRoomSeq,
          ...(cancellationRequestId === undefined
            ? {}
            : { activationCancellationRequestId: cancellationRequestId }),
          nextAssigneeId: input.assigneeId,
          operationId,
          previousAssigneeId,
          previousState,
          reason,
          taskId: input.taskId,
        },
        roomId,
        type: "task.reassignment_requested",
      });
      return {
        activationIds: [],
        deduplicated: false,
        event,
        operation: this.#operation(operationId),
        task: taskProjectionFromRow(
          this.#database,
          this.#requireTask(input.taskId),
        ),
      };
    });
  }

  continue(
    actor: AuthenticatedActorContext,
    input: { operationId: string },
  ): ClientTaskReassignmentResponse {
    return this.#transaction(() => {
      const actorId = this.#requireActor(actor);
      const operationRow = this.#requireOperation(input.operationId);
      if (text(operationRow, "requested_by") !== actorId) {
        throw new ForbiddenError(
          "only the Human who requested reassignment can continue it",
        );
      }
      const operation = operationFromRow(operationRow);
      requireRoomMember(this.#database, operation.roomId, actorId);
      if (operation.state === "assigned") {
        const event = this.#requireEvent(
          operation.roomId,
          `${text(operationRow, "idempotency_key")}:assigned`,
        );
        return {
          activationIds: [],
          deduplicated: true,
          event,
          operation,
          task: taskProjectionFromRow(
            this.#database,
            this.#requireTask(operation.taskId),
          ),
        };
      }
      if (operation.state !== "cancellation_requested") {
        throw new ConflictError(
          `Task reassignment ${operation.operationId} cannot continue from ${operation.state}`,
        );
      }
      this.#assertTerminalProof(operation);
      const taskRow = this.#requireTask(operation.taskId);
      if (
        text(taskRow, "state") !== "cancelled" ||
        nullableText(taskRow, "assignee_id") !== operation.previousAssigneeId
      ) {
        throw new ConflictError(
          `Task ${operation.taskId} changed outside reassignment ${operation.operationId}`,
        );
      }
      this.#requireAgentRoomMember(operation.roomId, operation.nextAssigneeId);
      const completedAt = this.#now().toISOString();
      this.#database
        .prepare(
          `UPDATE tasks
           SET state = 'todo', assignee_id = ?, claimed_by = NULL,
               claim_until = NULL, claim_until_ms = NULL,
               blocked_reason = NULL, blocked_at = NULL,
               submission_summary = NULL, submitted_at = NULL,
               completed_at = NULL, cancellation_reason = NULL,
               cancelled_at = NULL, updated_at = ?
           WHERE task_id = ?`,
        )
        .run(operation.nextAssigneeId, completedAt, operation.taskId);
      this.#database
        .prepare(
          `UPDATE task_reassignment_operations
           SET state = 'assigned', updated_at = ?, completed_at = ?
           WHERE operation_id = ?`,
        )
        .run(completedAt, completedAt, operation.operationId);
      const event = this.#events.append({
        actorId,
        aggregateId: operation.taskId,
        aggregateType: "task",
        idempotencyKey: `${text(operationRow, "idempotency_key")}:assigned`,
        payload: {
          nextAssigneeId: operation.nextAssigneeId,
          operationId: operation.operationId,
          previousAssigneeId: operation.previousAssigneeId,
          reason: operation.reason,
          reassignedAt: completedAt,
          taskId: operation.taskId,
        },
        roomId: operation.roomId,
        type: "task.reassigned",
      });
      const activationIds = taskDependenciesComplete(
        this.#database,
        operation.taskId,
      )
        ? this.#events.deriveAttention(
            event,
            [
              {
                obligations: [
                  {
                    kind: "task_owner_follow_up" as const,
                    taskId: operation.taskId,
                  },
                ],
                participantId: operation.nextAssigneeId,
                reason: "task_assigned",
              },
            ],
            completedAt,
          )
        : [];
      return {
        activationIds,
        deduplicated: false,
        event,
        operation: this.#operation(operation.operationId),
        task: taskProjectionFromRow(
          this.#database,
          this.#requireTask(operation.taskId),
        ),
      };
    });
  }

  #assertTerminalProof(operation: TaskReassignmentOperation): void {
    const unresolved = this.#database
      .prepare(
        "SELECT request_id FROM activation_cancellation_requests WHERE task_id = ? AND resolved_at IS NULL LIMIT 1",
      )
      .get(operation.taskId);
    if (unresolved !== undefined) {
      throw new RuntimeTerminationProofError(
        `Task ${operation.taskId} reassignment is waiting for terminal proof`,
      );
    }
    const checks: ReadonlyArray<readonly [string, string]> = [
      [
        "Activation",
        "SELECT activation_id AS identity FROM activations WHERE participant_id = ? AND state IN ('leased', 'quarantined') LIMIT 1",
      ],
      [
        "Placement",
        "SELECT placement_id AS identity FROM placements WHERE participant_id = ? AND state IN ('reserved', 'consumed') LIMIT 1",
      ],
      [
        "RunAttempt",
        "SELECT run_attempt_id AS identity FROM run_attempts WHERE participant_id = ? AND state IN ('starting', 'running', 'orphaned') LIMIT 1",
      ],
      [
        "RuntimeProcess",
        "SELECT runtime_process_id AS identity FROM runtime_processes WHERE participant_id = ? AND state <> 'terminated' LIMIT 1",
      ],
    ];
    for (const [label, query] of checks) {
      const active = this.#database
        .prepare(query)
        .get(operation.previousAssigneeId);
      if (active !== undefined) {
        throw new RuntimeTerminationProofError(
          `Task ${operation.taskId} reassignment is waiting for terminal proof from ${label} ${text(active, "identity")}`,
        );
      }
    }
  }

  #replay(
    row: Row,
    actorId: string,
    input: ClientTaskReassignRequest,
  ): ClientTaskReassignmentResponse {
    const operation = operationFromRow(row);
    if (
      operation.requestedBy !== actorId ||
      operation.taskId !== input.taskId ||
      operation.nextAssigneeId !== input.assigneeId ||
      operation.reason !== input.reason.trim()
    ) {
      throw new IdempotencyConflictError(
        `idempotency key ${input.idempotencyKey} was already used for another reassignment`,
      );
    }
    const event = this.#requireEvent(
      operation.roomId,
      operation.state === "assigned"
        ? `${input.idempotencyKey}:assigned`
        : input.idempotencyKey,
    );
    return {
      activationIds: [],
      deduplicated: true,
      event,
      operation,
      task: taskProjectionFromRow(
        this.#database,
        this.#requireTask(operation.taskId),
      ),
    };
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

  #requireAgentRoomMember(roomId: string, participantId: string): void {
    const row = this.#database
      .prepare(
        `SELECT principals.kind
         FROM memberships
         JOIN principals ON principals.principal_id = memberships.principal_id
         WHERE memberships.room_id = ? AND memberships.principal_id = ?`,
      )
      .get(roomId, participantId);
    if (row === undefined) {
      throw new ForbiddenError(
        `principal ${participantId} is not a member of Room ${roomId}`,
      );
    }
    if (text(row, "kind") !== "agent") {
      throw new ForbiddenError("Task assignee must be an Agent principal");
    }
  }

  #operation(operationId: string): TaskReassignmentOperation {
    return operationFromRow(this.#requireOperation(operationId));
  }

  #requireOperation(operationId: string): Row {
    const row = this.#database
      .prepare(
        "SELECT * FROM task_reassignment_operations WHERE operation_id = ?",
      )
      .get(operationId);
    if (row === undefined) {
      throw new NotFoundError(`Task reassignment ${operationId} was not found`);
    }
    return row;
  }

  #requireTask(taskId: string): Row {
    const row = this.#database
      .prepare("SELECT * FROM tasks WHERE task_id = ?")
      .get(taskId);
    if (row === undefined)
      throw new NotFoundError(`task ${taskId} was not found`);
    return row;
  }

  #requireEvent(roomId: string, idempotencyKey: string) {
    const row = this.#database
      .prepare(
        "SELECT * FROM room_events WHERE room_id = ? AND idempotency_key = ?",
      )
      .get(roomId, idempotencyKey);
    if (row === undefined) {
      throw new NotFoundError(
        `Room event ${idempotencyKey} was not found in ${roomId}`,
      );
    }
    return this.#events.eventFromRow(row);
  }
}

function operationFromRow(row: Row): TaskReassignmentOperation {
  const cancellationRequestId = nullableText(row, "cancellation_request_id");
  const completedAt = nullableText(row, "completed_at");
  return TaskReassignmentOperationSchema.parse({
    ...(cancellationRequestId === null ? {} : { cancellationRequestId }),
    ...(completedAt === null ? {} : { completedAt }),
    createdAt: text(row, "created_at"),
    nextAssigneeId: text(row, "next_assignee_id"),
    operationId: text(row, "operation_id"),
    previousAssigneeId: text(row, "previous_assignee_id"),
    reason: text(row, "reason"),
    requestedBy: text(row, "requested_by"),
    roomId: text(row, "room_id"),
    state: text(row, "state"),
    taskId: text(row, "task_id"),
    updatedAt: text(row, "updated_at"),
  });
}
