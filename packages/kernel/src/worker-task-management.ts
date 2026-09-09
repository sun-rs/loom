import type { DatabaseSync } from "node:sqlite";
import * as P from "@rah-os/protocol";
import type { AuthenticatedWorkerExecutionContext } from "./auth.ts";
import { ConflictError, ForbiddenError } from "./errors.ts";
import { requireResolvedWorkerTaskCausality } from "./worker-task-command-identity.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { integer, nullableText, text } from "./sqlite-row.ts";
import { unblockTaskTransaction } from "./task-unblock-service.ts";
import { taskDependenciesComplete } from "./task-projection.ts";
import { assignTaskTransaction } from "./task-assignment-service.ts";
import { unassignTaskTransaction } from "./task-unassignment.ts";
import {
  assertWorkerTaskCreationFreshContext,
  assertWorkerTaskFreshContext,
  createTaskMutationTransaction,
} from "./task-intent.ts";
import {
  requireWorkerRoomVisibility,
  requireWorkerTaskVisibility,
  wasTaskCreatedByWorkerRun,
} from "./worker-task-scope.ts";
import type { TaskCreateMutationResult } from "./types.ts";

type Context = {
  database: DatabaseSync;
  events: RoomEventWriter;
  createId(prefix: string): string;
  now(): Date;
  requireWorker(
    execution: AuthenticatedWorkerExecutionContext,
  ): P.ActivationCredentialScope;
  transaction<T>(operation: () => T): T;
};
/** Creator management is distinct from the Task execution/claim lane. */
export class WorkerTaskManagementService {
  readonly #context: Context;
  constructor(context: Context) {
    this.#context = context;
  }
  assign(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerTaskAssignRequest,
  ): TaskCreateMutationResult {
    return this.#run(execution, (scope) => {
      const input = requireResolvedWorkerTaskCausality(
        P.WorkerTaskAssignRequestSchema.parse(raw),
      );
      const { database, events } = this.#context;
      const task = requireWorkerTaskVisibility(database, scope, input.taskId);
      if (text(task, "creator_id") !== scope.participantId)
        throw new ForbiddenError(
          "only the Task creator can manage its assignment",
        );
      const creation = database
        .prepare(
          "SELECT room_seq FROM room_events WHERE room_id=? AND aggregate_type='task' AND aggregate_id=? AND type='task.created' LIMIT 1",
        )
        .get(scope.roomId, input.taskId);
      if (
        !creation ||
        (integer(creation, "room_seq") > scope.toSeq &&
          !wasTaskCreatedByWorkerRun(database, scope, input.taskId))
      )
        throw new ForbiddenError(
          "Task was not available in this execution's causal scope",
        );
      const assertFreshContext = (
        _roomId: string,
        _actorId: string,
        seq: number,
      ) => assertWorkerTaskFreshContext(database, scope, seq, input.taskId);
      if (input.assigneeId === null)
        return unassignTaskTransaction(database, events, {
          actorId: scope.participantId,
          command: input,
          unassignedAt: this.#context.now().toISOString(),
          runAttemptId: scope.runAttemptId,
          assertFreshContext: (_taskId, seq) =>
            assertFreshContext(scope.roomId, scope.participantId, seq),
        });
      return assignTaskTransaction(
        {
          database,
          events,
          assignedAt: this.#context.now().toISOString(),
          runAttemptId: scope.runAttemptId,
          assertFreshContext,
          requireAssignee: (id) =>
            requireWorkerRoomVisibility(database, {
              ...scope,
              participantId: id,
            }),
        },
        scope.participantId,
        { ...input, assigneeId: input.assigneeId },
      );
    });
  }
  convert(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerTaskConvertRequest,
  ): TaskCreateMutationResult {
    return this.#run(execution, (scope) => {
      const input = requireResolvedWorkerTaskCausality(
        P.WorkerTaskConvertRequestSchema.parse(raw),
      );
      const { database } = this.#context;
      const message = database
        .prepare(
          "SELECT room_seq FROM discovery_messages WHERE room_id=? AND message_id=? AND thread_id IS NULL",
        )
        .get(scope.roomId, input.messageId);
      if (!message || integer(message, "room_seq") > scope.toSeq)
        throw new ForbiddenError(
          "only a causal top-level Message in this Room can be converted",
        );
      return createTaskMutationTransaction(
        {
          ...this.#context,
          workerScope: scope,
          assertFreshContext: (_roomId, _actorId, seq) =>
            assertWorkerTaskCreationFreshContext(database, scope, seq!),
        },
        scope.participantId,
        {
          roomId: scope.roomId,
          sourceMessageId: input.messageId,
          basedOnRoomSeq: input.basedOnRoomSeq,
          idempotencyKey: input.idempotencyKey,
          collaboratorIds: [],
          reviewerIds: [],
          dependencyTaskIds: [],
        },
      );
    });
  }
  unblock(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerTaskUnblockRequest,
  ): TaskCreateMutationResult {
    return this.#run(execution, (scope) => {
      const input = requireResolvedWorkerTaskCausality(
          P.WorkerTaskUnblockRequestSchema.parse(raw),
        ),
        { database, events } = this.#context;
      requireWorkerTaskVisibility(database, scope, input.taskId);
      return unblockTaskTransaction(
        {
          database,
          events,
          unblockedAt: this.#context.now().toISOString(),
          runAttemptId: scope.runAttemptId,
          authorize: (task) => {
            if (nullableText(task, "assignee_id") !== scope.participantId)
              throw new ForbiddenError(
                "only the current assigned Agent can resume its blocked Task",
              );
            const blocked = database
              .prepare(
                "SELECT actor_id,room_seq FROM room_events WHERE room_id=? AND aggregate_type='task' AND aggregate_id=? AND type='task.blocked' ORDER BY room_seq DESC LIMIT 1",
              )
              .get(scope.roomId, input.taskId);
            if (
              !blocked ||
              text(blocked, "actor_id") !== scope.participantId ||
              integer(blocked, "room_seq") > scope.toSeq
            )
              throw new ForbiddenError(
                "the latest block by this Agent must already be delivered before recovery",
              );
          },
          assertFreshContext: (_room, _actor, seq) =>
            assertWorkerTaskFreshContext(database, scope, seq, input.taskId),
          assertReady: () => {
            if (!taskDependenciesComplete(database, input.taskId))
              throw new ConflictError("Task dependencies are not completed");
            if (
              database
                .prepare(
                  "SELECT 1 FROM input_requests WHERE task_id=? AND state='pending'",
                )
                .get(input.taskId)
            )
              throw new ConflictError("Task still waits for Human input");
          },
        },
        scope.participantId,
        input,
      );
    });
  }
  #run<T>(
    execution: AuthenticatedWorkerExecutionContext,
    action: (scope: P.ActivationCredentialScope) => T,
  ): T {
    return this.#context.transaction(() => {
      const scope = this.#context.requireWorker(execution);
      requireWorkerRoomVisibility(this.#context.database, scope);
      return action(scope);
    });
  }
}
