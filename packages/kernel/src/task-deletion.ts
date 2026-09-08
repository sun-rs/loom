import type { DatabaseSync } from "node:sqlite";
import * as P from "@rah-os/protocol";
import type {
  AuthenticatedActorContext,
  AuthenticatedWorkerExecutionContext,
} from "./auth.ts";
import {
  requireHumanTaskManager,
  requireRoomMember,
} from "./collaboration-policy.ts";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors.ts";
import { listRoomAgentRecipients } from "./room-agent-service.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { integer, nullableText, text, type Row } from "./sqlite-row.ts";
import {
  assertTaskEventReplay,
  findRoomEventByIdempotencyKey,
} from "./task-event-replay.ts";
import { assertWorkerTaskFreshContext } from "./task-intent.ts";
import {
  requireWorkerRoomVisibility,
  wasTaskCreatedByWorkerRun,
} from "./worker-task-scope.ts";

type Context = {
  database: DatabaseSync;
  events: RoomEventWriter;
  now(): Date;
  requireActor(actor: AuthenticatedActorContext): string;
  requireWorker(
    worker: AuthenticatedWorkerExecutionContext,
  ): P.ActivationCredentialScope;
  transaction<T>(operation: () => T): T;
  assertFreshContext(roomId: string, actorId: string, seq: number): void;
};

/** Raft deletes Task metadata; local execution fences and published conversation remain owned by their existing services. */
export class TaskDeletionService {
  private readonly context: Context;
  constructor(context: Context) {
    this.context = context;
  }
  human(
    actor: AuthenticatedActorContext,
    raw: P.TaskDeleteRequest,
  ): P.TaskDeleteResponse {
    return this.context.transaction(() => {
      const input = P.TaskDeleteRequestSchema.parse(raw),
        actorId = this.context.requireActor(actor);
      return this.remove(
        actorId,
        input,
        (creatorId) =>
          requireHumanTaskManager(
            this.context.database,
            { creatorId, roomId: input.roomId },
            actorId,
          ),
        () =>
          this.context.assertFreshContext(
            input.roomId,
            actorId,
            input.basedOnRoomSeq,
          ),
      );
    });
  }
  worker(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.TaskDeleteRequest,
    assertKnownCursor: () => void = () => {},
  ): P.TaskDeleteResponse {
    return this.context.transaction(() => {
      const input = P.TaskDeleteRequestSchema.parse(raw),
        scope = this.context.requireWorker(execution),
        db = this.context.database;
      if (scope.roomId !== input.roomId)
        throw new ForbiddenError("Task deletion is outside this Worker Room");
      requireWorkerRoomVisibility(db, scope);
      return this.remove(
        scope.participantId,
        input,
        (creatorId) => {
          if (creatorId !== scope.participantId)
            throw new ForbiddenError(
              "only the Task creator may delete it through Worker tools",
            );
        },
        () => {
          assertKnownCursor();
          const creation = db
            .prepare(
              "SELECT room_seq FROM room_events WHERE room_id=? AND aggregate_type='task' AND aggregate_id=? AND type='task.created' LIMIT 1",
            )
            .get(scope.roomId, input.taskId);
          if (
            !creation ||
            (integer(creation, "room_seq") > scope.toSeq &&
              !wasTaskCreatedByWorkerRun(db, scope, input.taskId))
          )
            throw new ForbiddenError(
              "Task was not available in this execution causal scope",
            );
          assertWorkerTaskFreshContext(
            db,
            scope,
            input.basedOnRoomSeq,
            input.taskId,
          );
        },
        scope.runAttemptId,
      );
    });
  }
  private remove(
    actorId: string,
    input: P.TaskDeleteRequest,
    authorize: (creatorId: string) => void,
    fresh: () => void,
    runAttemptId?: string,
  ): P.TaskDeleteResponse {
    const { database: db, events } = this.context;
    requireRoomMember(db, input.roomId, actorId);
    const old = findRoomEventByIdempotencyKey(
      db,
      input.roomId,
      input.idempotencyKey,
    );
    if (old) {
      const event = assertTaskEventReplay(events.eventFromRow(old), {
        actorId,
        aggregateId: input.taskId,
        eventType: "task.deleted",
        payload: {},
      });
      authorize(String(event.payload.creatorId));
      return this.receipt(event, true);
    }
    const task = db
      .prepare("SELECT * FROM tasks WHERE task_id=?")
      .get(input.taskId);
    if (!task) throw new NotFoundError(`Task ${input.taskId} was not found`);
    if (text(task, "room_id") !== input.roomId)
      throw new ForbiddenError("Task belongs to another Room");
    authorize(text(task, "creator_id"));
    fresh();
    this.assertIdle(task);
    // Keep the durable upload reservation for the existing GC. In-flight owners
    // recheck state; published Message bytes and provenance must not be deleted.
    db.prepare(
      "UPDATE room_files SET state=CASE WHEN message_id IS NULL THEN 'canceled' ELSE state END,task_id=NULL WHERE task_id=?",
    ).run(input.taskId);
    for (const table of [
      "task_reassignment_operations",
      "activation_cancellation_requests",
      "activation_obligations",
      "task_reviews",
      "task_submission_artifacts",
      "task_submissions",
      "input_requests",
      "task_participants",
      "task_dependencies",
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE task_id=?`).run(input.taskId);
    }
    db.prepare("DELETE FROM tasks WHERE task_id=?").run(input.taskId);
    const event = events.append({
      actorId,
      aggregateId: input.taskId,
      aggregateType: "task",
      roomId: input.roomId,
      type: "task.deleted",
      idempotencyKey: input.idempotencyKey,
      payload: {
        taskId: input.taskId,
        creatorId: text(task, "creator_id"),
        sourceMessageId: text(task, "source_message_id"),
        threadId: text(task, "thread_id"),
        taskNumber: integer(task, "task_number"),
        previousState: text(task, "state"),
        basedOnRoomSeq: input.basedOnRoomSeq,
        ...(runAttemptId ? { runAttemptId } : {}),
      },
    });
    const recipients = new Set([
      nullableText(task, "assignee_id"),
      text(task, "creator_id"),
    ]);
    events.deriveAttention(
      event,
      listRoomAgentRecipients(db, input.roomId, "task_updated", actorId).filter(
        ({ participantId }) => recipients.has(participantId),
      ),
      event.createdAt,
    );
    return this.receipt(event, false);
  }
  private receipt(
    event: P.RoomEvent,
    deduplicated: boolean,
  ): P.TaskDeleteResponse {
    return P.TaskDeleteResponseSchema.parse({
      deleted: true,
      deduplicated,
      roomId: event.roomId,
      taskId: event.aggregateId,
      sourceMessageId: event.payload.sourceMessageId,
      threadId: event.payload.threadId,
      taskNumber: event.payload.taskNumber,
      event,
    });
  }
  private assertIdle(task: Row): void {
    const db = this.context.database,
      id = text(task, "task_id");
    const checks: [string, string][] = [
      [
        "SELECT 1 FROM task_dependencies WHERE dependency_task_id=? LIMIT 1",
        "Task is required by another Task; remove dependent work first",
      ],
      [
        "SELECT 1 FROM input_requests WHERE task_id=? AND state='pending' LIMIT 1",
        "Task still waits for Human input; close or resolve it first",
      ],
      [
        "SELECT 1 FROM activation_cancellation_requests WHERE task_id=? AND resolved_at IS NULL LIMIT 1",
        "Task execution cancellation has not completed",
      ],
      [
        "SELECT 1 FROM task_reassignment_operations WHERE task_id=? AND state NOT IN ('assigned','failed_closed') LIMIT 1",
        "Task reassignment has not completed",
      ],
    ];
    for (const [sql, message] of checks)
      if (db.prepare(sql).get(id)) throw new ConflictError(message);
    if (
      nullableText(task, "claimed_by") !== null &&
      typeof task.claim_until_ms === "number" &&
      task.claim_until_ms > this.context.now().getTime()
    )
      throw new ConflictError(
        "Task still has an active claim; finish or close execution first",
      );
    const active = db
      .prepare(
        `SELECT 1 FROM run_attempts AS run WHERE
      (run.state IN ('starting','running') OR EXISTS (SELECT 1 FROM runtime_processes p WHERE p.run_attempt_id=run.run_attempt_id AND p.state<>'terminated'))
      AND (EXISTS (SELECT 1 FROM activation_obligations o WHERE o.activation_id=run.activation_id AND o.task_id=?)
      OR EXISTS (SELECT 1 FROM room_events e WHERE e.aggregate_type='task' AND e.aggregate_id=? AND (e.type IN ('task.claimed','task.started','task.progressed','task.submitted','task.blocked') OR (e.type='task.created' AND json_extract(e.payload_json,'$.autoClaimed')=1)) AND json_extract(e.payload_json,'$.runAttemptId')=run.run_attempt_id)) LIMIT 1`,
      )
      .get(id, id);
    if (active)
      throw new ConflictError(
        "Task has an active execution; wait for runtime terminal proof",
      );
  }
}
