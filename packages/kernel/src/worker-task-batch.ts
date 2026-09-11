import type { DatabaseSync } from "node:sqlite";
import * as P from "@rah-os/protocol";
import type { AuthenticatedWorkerExecutionContext } from "./auth.ts";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StaleContextError,
  IdempotencyConflictError,
} from "./errors.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { text } from "./sqlite-row.ts";
import { resolveWorkerReadTarget } from "./worker-read-targets.ts";
import {
  requireWorkerRoomVisibility,
  requireWorkerTaskDelivery,
} from "./worker-task-scope.ts";
import { resolveWorkerTaskCommandCausality } from "./worker-task-command-identity.ts";
import {
  assertWorkerTaskFreshContext,
  assertWorkerTaskCreationFreshContext,
  createWorkerTaskTransaction,
} from "./task-intent.ts";
import { claimTaskTransaction } from "./task-claim.ts";
import {
  batchDigest,
  readBatchReceipt,
  reserveBatchReceipt,
  recordBatchReceipt,
} from "./task-batch-receipts.ts";
import type { TaskMutationResult } from "./types.ts";
export type TaskBatchContext = {
  database: DatabaseSync;
  events: RoomEventWriter;
  createId(prefix: string): string;
  now(): Date;
  requireWorker(
    execution: AuthenticatedWorkerExecutionContext,
  ): P.ActivationCredentialScope;
  transaction<T>(operation: () => T): T;
};
export type TaskBatchExecutionResult = {
  response: P.WorkerTaskBatchResponse;
  mutations: TaskMutationResult[];
};
/** Raft's single-request batch facade. Kernel retains the single owner, Room and execution fences. */
export function runWorkerTaskBatch(
  context: TaskBatchContext,
  execution: AuthenticatedWorkerExecutionContext,
  operation: "create" | "claim",
  raw: unknown,
  leaseMs: number,
): TaskBatchExecutionResult {
  return context.transaction(() => {
    const scope = context.requireWorker(execution),
      db = context.database;
    requireWorkerRoomVisibility(db, scope);
    const input =
      operation === "create"
        ? P.WorkerTaskBatchCreateRequestSchema.parse(raw)
        : P.WorkerTaskBatchClaimRequestSchema.parse(raw);
    if (
      input.channel !== undefined &&
      resolveWorkerReadTarget(db, scope, input.channel).roomId !== scope.roomId
    )
      throw new ForbiddenError(
        "Task batch target is outside this execution Room",
      );
    const { idempotencyKey: _key, basedOnRoomSeq: _seq, ...intent } = input;
    const identity = resolveWorkerTaskCommandCausality(db, scope, {
      operation: `task-batch-${operation}`,
      content: [JSON.stringify(intent)],
      ...input,
    });
    const digest = batchDigest({
      ...intent,
      ...(input.basedOnRoomSeq === undefined
        ? {}
        : { basedOnRoomSeq: input.basedOnRoomSeq }),
    });
    const old = readBatchReceipt(
      db,
      scope,
      operation,
      identity.idempotencyKey,
      digest,
    );
    if (old) return { response: old, mutations: [] };
    reserveBatchReceipt(db, context.now().getTime());
    const mutations: TaskMutationResult[] = [],
      results: P.WorkerTaskBatchResult[] = [];
    const item = (mutation: TaskMutationResult): P.WorkerTaskBatchResult => ({
      success: true,
      ...(mutation.task.assigneeId
        ? { assigneeId: mutation.task.assigneeId }
        : {}),
      ...(mutation.task.claimUntil
        ? { claimUntil: mutation.task.claimUntil }
        : {}),
      taskId: mutation.task.taskId,
      taskNumber: mutation.task.taskNumber,
      messageId: mutation.task.sourceMessageId,
      threadId: mutation.task.threadId,
      title: mutation.task.title,
      state: mutation.task.state,
    });
    if (operation === "create") {
      const create = input as P.WorkerTaskBatchCreateRequest;
      let assigneeId: string | undefined;
      if (create.assignee !== undefined) {
        const self = db
          .prepare("SELECT handle FROM principals WHERE principal_id=?")
          .get(scope.participantId)!;
        if (
          create.assignee !== scope.participantId &&
          create.assignee !== `@${text(self, "handle")}`
        )
          throw new ForbiddenError(
            "Agents may only assign a created Task to themselves",
          );
        assigneeId = scope.participantId;
      }
      for (const [i, title] of create.titles.entries()) {
        const command = resolveWorkerTaskCommandCausality(db, scope, {
          operation: "task-batch-create-item",
          idempotencyKey: `task-batch-${batchDigest([operation, identity.idempotencyKey, i])}`,
          basedOnRoomSeq: identity.basedOnRoomSeq,
          content: [title],
        });
        const mutation = createWorkerTaskTransaction(
          {
            ...context,
            workerScope: scope,
            assertFreshContext: (_roomId, _actorId, seq) =>
              assertWorkerTaskCreationFreshContext(
                db,
                scope,
                seq ?? scope.toSeq,
              ),
          },
          scope,
          {
            ...command,
            title,
            leaseMs,
            ...(assigneeId === undefined ? {} : { assigneeId }),
          },
        );
        mutations.push(mutation);
        results.push(item(mutation));
      }
    } else {
      const claim = input as P.WorkerTaskBatchClaimRequest;
      const selectors = [
        ...(claim.taskNumbers ?? []).map((taskNumber) => ({ taskNumber })),
        ...(claim.messageIds ?? []).map((messageId) => ({ messageId })),
        ...(claim.taskIds ?? []).map((taskId) => ({ taskId })),
      ] as { taskNumber?: number; messageId?: string; taskId?: string }[];
      const resolved = selectors.map((selector) => {
        const rows =
          selector.taskId !== undefined
            ? db
                .prepare(
                  "SELECT task_id FROM tasks WHERE room_id=? AND task_id=?",
                )
                .all(scope.roomId, selector.taskId)
            : selector.taskNumber !== undefined
              ? db
                  .prepare(
                    "SELECT task_id FROM tasks WHERE room_id=? AND task_number=?",
                  )
                  .all(scope.roomId, selector.taskNumber)
              : db
                  .prepare(
                    "SELECT task_id FROM tasks WHERE room_id=? AND substr(source_message_id,1,?)=?",
                  )
                  .all(
                    scope.roomId,
                    selector.messageId!.length,
                    selector.messageId!,
                  );
        if (rows.length !== 1)
          return {
            selector,
            reason:
              rows.length === 0
                ? "Task not found"
                : "Message selector is ambiguous",
          };
        const taskId = text(rows[0]!, "task_id");
        try {
          requireWorkerTaskDelivery(db, scope, taskId);
        } catch (error) {
          if (error instanceof ForbiddenError || error instanceof NotFoundError)
            return { selector, reason: error.message };
          throw error;
        }
        // Before any mutation: a batch held on new context cannot hide prior claims.
        assertWorkerTaskFreshContext(
          db,
          scope,
          identity.basedOnRoomSeq,
          taskId,
        );
        return { selector, taskId };
      });
      for (const [i, entry] of resolved.entries()) {
        if (!entry.taskId) {
          results.push({
            ...entry.selector,
            success: false,
            reason: entry.reason!,
          });
          continue;
        }
        try {
          const command = resolveWorkerTaskCommandCausality(db, scope, {
            operation: "task-batch-claim-item",
            idempotencyKey: `task-batch-${batchDigest([operation, identity.idempotencyKey, i])}`,
            basedOnRoomSeq: identity.basedOnRoomSeq,
            subjectId: entry.taskId,
          });
          const mutation = claimTaskTransaction(context, scope, {
            ...command,
            taskId: entry.taskId,
            leaseMs,
          });
          mutations.push(mutation);
          results.push(item(mutation));
        } catch (error) {
          if (
            error instanceof StaleContextError ||
            error instanceof IdempotencyConflictError
          )
            throw error;
          if (
            error instanceof ConflictError ||
            error instanceof ForbiddenError ||
            error instanceof NotFoundError
          )
            results.push({
              ...entry.selector,
              success: false,
              reason: error.message,
            });
          else throw error;
        }
      }
    }
    const response = P.WorkerTaskBatchResponseSchema.parse({
      roomId: scope.roomId,
      results,
      tasks: operation === "create" ? results : [],
      deduplicated: false,
    });
    recordBatchReceipt(
      db,
      scope,
      operation,
      identity.idempotencyKey,
      digest,
      response,
      context.now().getTime(),
    );
    return { response, mutations };
  });
}
