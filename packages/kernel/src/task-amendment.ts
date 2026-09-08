import type { DatabaseSync } from "node:sqlite";
import * as P from "@rah-os/protocol";
import type {
  AuthenticatedActorContext,
  AuthenticatedWorkerExecutionContext,
} from "./auth.ts";
import { requireRoomMember } from "./collaboration-policy.ts";
import { requireDiscoveryHuman } from "./global-discovery.ts";
import { NotFoundError, ForbiddenError, ConflictError } from "./errors.ts";
import { integer, nullableText, text, type Row } from "./sqlite-row.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import {
  assertTaskEventReplay,
  findRoomEventByIdempotencyKey,
} from "./task-event-replay.ts";
import { taskProjectionFromRow } from "./task-projection.ts";
import {
  requireWorkerTaskVisibility,
  wasTaskCreatedByWorkerRun,
} from "./worker-task-scope.ts";
import { assertWorkerTaskFreshContext } from "./task-intent.ts";
import type { TaskMutationResult } from "./types.ts";

type Context = {
  database: DatabaseSync;
  events: RoomEventWriter;
  now(): Date;
  requireActor(actor: AuthenticatedActorContext): string;
  requireWorker(
    worker: AuthenticatedWorkerExecutionContext,
  ): P.ActivationCredentialScope;
  transaction<T>(fn: () => T): T;
  assertFreshContext(roomId: string, actorId: string, seq: number): void;
};
/** One transaction owner for card metadata. It never changes the original Message, assignment or execution lane. */
export class TaskAmendmentService {
  private readonly context: Context;
  constructor(context: Context) {
    this.context = context;
  }
  human(
    auth: AuthenticatedActorContext,
    raw: P.TaskAmendRequest,
  ): TaskMutationResult {
    return this.context.transaction(() => {
      const actorId = this.context.requireActor(auth);
      requireDiscoveryHuman(this.context.database, actorId);
      const input = P.TaskAmendRequestSchema.parse(raw),
        task = this.requireTask(input.taskId);
      return this.amend(actorId, task, input, () =>
        this.context.assertFreshContext(
          text(task, "room_id"),
          actorId,
          input.basedOnRoomSeq,
        ),
      );
    });
  }
  worker(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.TaskAmendRequest,
  ): TaskMutationResult {
    return this.context.transaction(() => {
      const scope = this.context.requireWorker(execution),
        input = P.TaskAmendRequestSchema.parse(raw),
        db = this.context.database;
      const task = requireWorkerTaskVisibility(db, scope, input.taskId);
      const created = db
        .prepare(
          "SELECT room_seq FROM room_events WHERE room_id=? AND aggregate_type='task' AND aggregate_id=? AND type='task.created' LIMIT 1",
        )
        .get(scope.roomId, input.taskId);
      if (
        !created ||
        (integer(created, "room_seq") > scope.toSeq &&
          !wasTaskCreatedByWorkerRun(db, scope, input.taskId))
      )
        throw new ForbiddenError(
          "Task was not available in this execution causal scope",
        );
      return this.amend(
        scope.participantId,
        task,
        input,
        () =>
          assertWorkerTaskFreshContext(
            db,
            scope,
            input.basedOnRoomSeq,
            input.taskId,
          ),
        scope.runAttemptId,
      );
    });
  }
  private requireTask(taskId: string): Row {
    const task = this.context.database
      .prepare("SELECT * FROM tasks WHERE task_id=?")
      .get(taskId);
    if (!task) throw new NotFoundError(`task ${taskId} was not found`);
    return task;
  }
  private amend(
    actorId: string,
    task: Row,
    input: P.TaskAmendRequest,
    fresh: () => void,
    runAttemptId?: string,
  ): TaskMutationResult {
    const { database, events } = this.context,
      roomId = text(task, "room_id");
    requireRoomMember(database, roomId, actorId);
    const patch = {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
    };
    const old = findRoomEventByIdempotencyKey(
      database,
      roomId,
      input.idempotencyKey,
    );
    if (old) {
      const event = assertTaskEventReplay(events.eventFromRow(old), {
        actorId,
        aggregateId: input.taskId,
        eventType: "task.amended",
        payload: {},
      });
      const stored = P.TaskAmendChangesSchema.parse(event.payload.changes);
      const replayPatch = {
        ...(stored.title ? { title: stored.title.to } : {}),
        ...(stored.description ? { description: stored.description.to } : {}),
      };
      assertTaskEventReplay(
        { ...event, payload: { patch: replayPatch } },
        {
          actorId,
          aggregateId: input.taskId,
          eventType: "task.amended",
          payload: { patch },
        },
      );
      return {
        event,
        deduplicated: true,
        task: taskProjectionFromRow(database, this.requireTask(input.taskId)),
      };
    }
    fresh();
    const changes: P.TaskAmendChanges = {};
    if (input.title !== undefined)
      changes.title = { from: text(task, "title"), to: input.title };
    if (input.description !== undefined)
      changes.description = {
        from: nullableText(task, "description"),
        to: input.description,
      };
    if (
      Buffer.byteLength(JSON.stringify(changes)) >
      P.TASK_HISTORY_ROW_MAX_BYTES - 16 * 1024
    )
      throw new ConflictError(
        "previous Task card exceeds the complete amendment history budget",
      );
    database
      .prepare(
        "UPDATE tasks SET title=?,description=?,updated_at=? WHERE task_id=?",
      )
      .run(
        input.title ?? text(task, "title"),
        input.description === undefined
          ? nullableText(task, "description")
          : input.description,
        this.context.now().toISOString(),
        input.taskId,
      );
    const event = events.append({
      actorId,
      aggregateId: input.taskId,
      aggregateType: "task",
      roomId,
      type: "task.amended",
      idempotencyKey: input.idempotencyKey,
      payload: {
        taskId: input.taskId,
        basedOnRoomSeq: input.basedOnRoomSeq,
        changes,
        ...(runAttemptId ? { runAttemptId } : {}),
      },
    });
    const assigneeId = nullableText(task, "assignee_id");
    if (assigneeId !== null && assigneeId !== actorId)
      events.deriveAttention(
        event,
        [{ participantId: assigneeId, reason: "task_updated" }],
        event.createdAt,
      );
    return {
      event,
      deduplicated: false,
      task: taskProjectionFromRow(database, this.requireTask(input.taskId)),
    };
  }
}
