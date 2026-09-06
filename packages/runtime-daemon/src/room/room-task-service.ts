import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { assertRoomTextStorageSafe } from "@rah/runtime-protocol";
import type {
  RoomAttentionReason,
  RoomInboxDisposition,
  RoomEvent,
  RoomMembership,
  RoomMessage,
  RoomTask,
  RoomTaskMutationResult,
  RoomTaskReview,
  RoomTaskReviewDisposition,
  RoomTaskReviewMutationResult,
  RoomTaskSubmission,
  RoomTaskSubmissionMutationResult,
  RoomWorkerExecution,
} from "@rah/runtime-protocol";

import { roomError } from "./room-errors";
import {
  integer,
  optionalText,
  text,
  type RoomSqlRow as Row,
} from "./room-rows";
import {
  roomTaskFromRow,
  roomTaskReviewFromRow,
  roomTaskSubmissionFromRow,
  validateRoomHostEvidence,
} from "./room-task-rows";
import {
  RoomTaskReadService,
  type RoomTaskPage,
} from "./room-task-read-service";

type TaskCommand = { idempotencyKey: string } & Record<string, unknown>;

export interface RoomTaskServiceOptions {
  database: DatabaseSync;
  createId: (prefix: string) => string;
  now: () => Date;
  transaction: <T>(operation: () => T) => T;
  command: (
    actorId: string,
    kind: string,
    request: TaskCommand,
  ) => RoomEvent | undefined;
  rememberCommand: (
    actorId: string,
    kind: string,
    request: TaskCommand,
    event: RoomEvent,
  ) => void;
  appendEvent: (input: {
    roomId: string;
    actorId: string;
    type: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    createdAt: string;
  }) => RoomEvent;
  appendAttention: (
    event: RoomEvent,
    participantId: string,
    reason: RoomAttentionReason,
    createdAt?: string,
    disposition?: RoomInboxDisposition,
  ) => void;
  ensureThread: (
    message: RoomMessage,
    createdAt: string,
  ) => {
    threadId: string;
    rootMessageId: string;
  };
  requireMembership: (roomId: string, principalId: string) => RoomMembership;
  requireMessage: (messageId: string) => RoomMessage;
  roomHead: (roomId: string) => number;
}

export class RoomTaskService {
  readonly #options: RoomTaskServiceOptions;
  readonly #reader: RoomTaskReadService;

  constructor(options: RoomTaskServiceOptions) {
    this.#options = options;
    this.#reader = new RoomTaskReadService({
      database: options.database,
      requireMembership: options.requireMembership,
    });
  }

  list(actorId: string, roomId: string): RoomTask[] {
    return this.listPage(actorId, roomId, { limit: 100 }).items;
  }

  listPage(
    actorId: string,
    roomId: string,
    options: {
      beforeTaskNumber?: number;
      throughTaskNumber?: number;
      limit?: number;
    } = {},
  ): RoomTaskPage {
    return this.#reader.listPage(actorId, roomId, options);
  }

  create(
    actorId: string,
    input: {
      roomId: string;
      sourceMessageId: string;
      title: string;
      description?: string;
      assigneeId: string;
      reviewerIds: string[];
      dependencyTaskIds?: string[];
      basedOnRoomSeq: number;
      idempotencyKey: string;
    },
  ): RoomTaskMutationResult {
    const request = this.#normalizeCreate(input);
    const replay = this.#options.command(actorId, "room.task.create", request);
    if (replay)
      return {
        value: this.#requireTask(replay.aggregateId),
        event: replay,
        deduplicated: true,
      };
    return this.#options.transaction(() => {
      const repeated = this.#options.command(
        actorId,
        "room.task.create",
        request,
      );
      if (repeated) {
        return {
          value: this.#requireTask(repeated.aggregateId),
          event: repeated,
          deduplicated: true,
        };
      }
      this.#options.requireMembership(request.roomId, actorId);
      this.#requireHead(request.roomId, request.basedOnRoomSeq);
      const source = this.#options.requireMessage(request.sourceMessageId);
      if (source.roomId !== request.roomId || source.replyToMessageId) {
        throw roomError(
          "invalid_argument",
          "Task source must be a top-level message in this Room",
        );
      }
      this.#options.requireMembership(request.roomId, request.assigneeId);
      this.#requireAgentPrincipal(request.assigneeId, "Task assignee");
      for (const reviewerId of request.reviewerIds) {
        this.#options.requireMembership(request.roomId, reviewerId);
        this.#requireAgentPrincipal(reviewerId, "Task reviewer");
      }
      for (const dependencyId of request.dependencyTaskIds) {
        const dependency = this.#requireTask(dependencyId);
        if (dependency.roomId !== request.roomId) {
          throw roomError(
            "invalid_argument",
            "Task dependencies must belong to the same Room",
          );
        }
      }
      const createdAt = this.#timestamp();
      const taskId = this.#options.createId("task");
      const thread = this.#options.ensureThread(source, createdAt);
      const taskNumber = integer(
        this.#options.database
          .prepare(
            "SELECT COALESCE(MAX(task_number), 0) + 1 AS next FROM room_tasks WHERE room_id = ?",
          )
          .get(request.roomId) as Row,
        "next",
      );
      this.#options.database
        .prepare(
          `INSERT INTO room_tasks(
             task_id, room_id, task_number, source_message_id, thread_id,
             creator_id, assignee_id, title, description, state, created_at, updated_at
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?)`,
        )
        .run(
          taskId,
          request.roomId,
          taskNumber,
          request.sourceMessageId,
          thread.threadId,
          actorId,
          request.assigneeId,
          request.title,
          request.description ?? null,
          createdAt,
          createdAt,
        );
      const insertReviewer = this.#options.database.prepare(
        "INSERT INTO room_task_reviewers(task_id, participant_id) VALUES(?, ?)",
      );
      for (const reviewerId of request.reviewerIds)
        insertReviewer.run(taskId, reviewerId);
      const insertDependency = this.#options.database.prepare(
        "INSERT INTO room_task_dependencies(task_id, dependency_task_id) VALUES(?, ?)",
      );
      for (const dependencyId of request.dependencyTaskIds)
        insertDependency.run(taskId, dependencyId);
      const event = this.#options.appendEvent({
        roomId: request.roomId,
        actorId,
        type: "task.created",
        aggregateType: "task",
        aggregateId: taskId,
        idempotencyKey: request.idempotencyKey,
        createdAt,
        payload: {
          taskId,
          taskNumber,
          sourceMessageId: request.sourceMessageId,
          threadId: thread.threadId,
          assigneeId: request.assigneeId,
          reviewerIds: request.reviewerIds,
          dependencyTaskIds: request.dependencyTaskIds,
        },
      });
      if (!this.#hasIncompleteDependencies(taskId)) {
        this.#options.appendAttention(
          event,
          request.assigneeId,
          "task_assignment",
          createdAt,
        );
      }
      this.#options.rememberCommand(
        actorId,
        "room.task.create",
        request,
        event,
      );
      return { value: this.#requireTask(taskId), event, deduplicated: false };
    });
  }

  claim(
    execution: RoomWorkerExecution,
    input: {
      taskId: string;
      basedOnRoomSeq: number;
      leaseMs: number;
      idempotencyKey: string;
    },
  ): RoomTaskMutationResult {
    const replayActor = this.#requireTaskExecution(
      execution,
      input.taskId,
      "assignee",
      true,
    );
    const replay = this.#options.command(replayActor, "room.task.claim", input);
    if (replay) {
      return {
        value: this.#requireTask(input.taskId),
        event: replay,
        deduplicated: true,
      };
    }
    const actorId = this.#requireTaskExecution(
      execution,
      input.taskId,
      "assignee",
    );
    return this.#transition(
      actorId,
      "room.task.claim",
      input,
      () => this.#requireTaskExecution(execution, input.taskId, "assignee"),
      (task, timestamp) => {
        const activeForAssignee =
          (task.state === "claimed" || task.state === "in_progress") &&
          task.assigneeId === actorId &&
          task.claimedBy === actorId &&
          Boolean(task.claimUntil);
        const expiredForAssignee =
          activeForAssignee &&
          Boolean(task.claimUntil && task.claimUntil <= timestamp);
        if (
          (task.state !== "todo" && !activeForAssignee) ||
          task.assigneeId !== actorId
        ) {
          throw roomError(
            "conflict",
            `Task ${task.taskId} is not claimable by ${actorId}`,
          );
        }
        if (this.#hasIncompleteDependencies(task.taskId)) {
          throw roomError(
            "conflict",
            `Task ${task.taskId} has incomplete dependencies`,
          );
        }
        if (
          !Number.isInteger(input.leaseMs) ||
          input.leaseMs < 1_000 ||
          input.leaseMs > 300_000
        ) {
          throw roomError(
            "invalid_argument",
            "leaseMs must be between 1000 and 300000",
          );
        }
        const claimUntil = new Date(
          this.#options.now().getTime() + input.leaseMs,
        ).toISOString();
        const nextState = expiredForAssignee
          ? "claimed"
          : task.state === "todo"
            ? "claimed"
            : task.state;
        this.#options.database
          .prepare(
            `UPDATE room_tasks SET state = ?, claimed_by = ?, claim_until = ?,
             updated_at = ? WHERE task_id = ?`,
          )
          .run(nextState, actorId, claimUntil, timestamp, task.taskId);
        return {
          type: "task.claimed",
          payload: { taskId: task.taskId, claimUntil },
        };
      },
    );
  }

  start(
    execution: RoomWorkerExecution,
    input: {
      taskId: string;
      basedOnRoomSeq: number;
      idempotencyKey: string;
    },
  ): RoomTaskMutationResult {
    const replayActor = this.#requireTaskExecution(
      execution,
      input.taskId,
      "assignee",
      true,
    );
    const replay = this.#options.command(replayActor, "room.task.start", input);
    if (replay) {
      return {
        value: this.#requireTask(input.taskId),
        event: replay,
        deduplicated: true,
      };
    }
    const actorId = this.#requireTaskExecution(
      execution,
      input.taskId,
      "assignee",
    );
    return this.#transition(
      actorId,
      "room.task.start",
      input,
      () => this.#requireTaskExecution(execution, input.taskId, "assignee"),
      (task, timestamp) => {
        this.#requireOwnedClaim(task, actorId);
        if (task.state !== "claimed")
          throw roomError("conflict", "Task must be claimed before start");
        this.#options.database
          .prepare(
            "UPDATE room_tasks SET state = 'in_progress', updated_at = ? WHERE task_id = ?",
          )
          .run(timestamp, task.taskId);
        return { type: "task.started", payload: { taskId: task.taskId } };
      },
    );
  }

  submit(
    execution: RoomWorkerExecution,
    input: {
      taskId: string;
      basedOnRoomSeq: number;
      summary: string;
      idempotencyKey: string;
    },
  ): RoomTaskSubmissionMutationResult {
    const evidence = validateRoomHostEvidence(execution.hostEvidence);
    const evidenceJson = JSON.stringify(evidence);
    const evidenceDigest = `sha256:${createHash("sha256").update(evidenceJson).digest("hex")}`;
    const summary = this.#text(input.summary, "summary", 8_192);
    const request = { ...input, summary, evidenceDigest };
    const replayActor = this.#requireTaskExecution(
      execution,
      input.taskId,
      "assignee",
      true,
    );
    const replay = this.#options.command(
      replayActor,
      "room.task.submit",
      request,
    );
    if (replay) return this.#submissionReplay(replay);
    const actorId = this.#requireTaskExecution(
      execution,
      input.taskId,
      "assignee",
    );
    return this.#options.transaction(() => {
      const repeated = this.#options.command(
        actorId,
        "room.task.submit",
        request,
      );
      if (repeated) return this.#submissionReplay(repeated);
      if (
        this.#requireTaskExecution(execution, input.taskId, "assignee") !==
        actorId
      ) {
        throw roomError(
          "forbidden",
          "Task execution principal changed during submission",
        );
      }
      const task = this.#requireTask(input.taskId);
      this.#options.requireMembership(task.roomId, actorId);
      this.#requireHead(task.roomId, input.basedOnRoomSeq);
      this.#requireOwnedClaim(task, actorId);
      if (task.state !== "claimed" && task.state !== "in_progress") {
        throw roomError("conflict", "Task must be active before submission");
      }
      const createdAt = this.#timestamp();
      const message = this.#appendThreadMessage(
        task,
        actorId,
        summary,
        `${input.idempotencyKey}:message`,
        createdAt,
      );
      const submissionNumber = integer(
        this.#options.database
          .prepare(
            "SELECT COUNT(*) + 1 AS next FROM room_task_submissions WHERE task_id = ?",
          )
          .get(task.taskId) as Row,
        "next",
      );
      const submissionId = this.#options.createId("submission");
      const submissionDigest = `sha256:${createHash("sha256")
        .update(
          JSON.stringify({
            messageId: message.messageId,
            producerId: actorId,
            roomId: task.roomId,
            sourceMessageId: task.sourceMessageId,
            submissionNumber,
            summary,
            taskId: task.taskId,
            evidenceDigest,
          }),
        )
        .digest("hex")}`;
      this.#options.database
        .prepare(
          `INSERT INTO room_task_submissions(
             submission_id, task_id, room_id, submission_number, submission_digest,
             producer_id, message_id, summary, evidence_json, evidence_digest, created_at
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          submissionId,
          task.taskId,
          task.roomId,
          submissionNumber,
          submissionDigest,
          actorId,
          message.messageId,
          summary,
          evidenceJson,
          evidenceDigest,
          createdAt,
        );
      this.#options.database
        .prepare(
          `UPDATE room_tasks SET state = 'submitted', claimed_by = NULL, claim_until = NULL,
             submission_summary = ?, submitted_at = ?, updated_at = ? WHERE task_id = ?`,
        )
        .run(summary, createdAt, createdAt, task.taskId);
      const event = this.#options.appendEvent({
        roomId: task.roomId,
        actorId,
        type: "task.submitted",
        aggregateType: "task",
        aggregateId: task.taskId,
        idempotencyKey: input.idempotencyKey,
        createdAt,
        payload: {
          taskId: task.taskId,
          submissionId,
          submissionDigest,
          evidenceDigest,
          messageId: message.messageId,
        },
      });
      for (const reviewerId of task.reviewerIds) {
        this.#options.appendAttention(
          event,
          reviewerId,
          "task_assignment",
          createdAt,
        );
      }
      this.#options.rememberCommand(
        actorId,
        "room.task.submit",
        request,
        event,
      );
      this.#recordOutcome(execution, event.eventId);
      return {
        value: this.#requireTask(task.taskId),
        submission: this.#requireSubmission(submissionId),
        message,
        event,
        deduplicated: false,
      };
    });
  }

  review(
    execution: RoomWorkerExecution,
    input: {
      taskId: string;
      basedOnRoomSeq: number;
      disposition: RoomTaskReviewDisposition;
      summary: string;
      idempotencyKey: string;
    },
  ): RoomTaskReviewMutationResult {
    const summary = this.#text(input.summary, "summary", 8_192);
    if (
      input.disposition !== "approved" &&
      input.disposition !== "changes_requested"
    ) {
      throw roomError("invalid_argument", "review disposition is invalid");
    }
    const request = { ...input, summary };
    const replayActor = this.#requireTaskExecution(
      execution,
      input.taskId,
      "reviewer",
      true,
    );
    const replay = this.#options.command(
      replayActor,
      "room.task.review",
      request,
    );
    if (replay) return this.#reviewReplay(replay);
    const actorId = this.#requireTaskExecution(
      execution,
      input.taskId,
      "reviewer",
    );
    return this.#options.transaction(() => {
      const repeated = this.#options.command(
        actorId,
        "room.task.review",
        request,
      );
      if (repeated) return this.#reviewReplay(repeated);
      if (
        this.#requireTaskExecution(execution, input.taskId, "reviewer") !==
        actorId
      ) {
        throw roomError(
          "forbidden",
          "Task execution principal changed during review",
        );
      }
      const task = this.#requireTask(input.taskId);
      this.#options.requireMembership(task.roomId, actorId);
      this.#requireHead(task.roomId, input.basedOnRoomSeq);
      if (task.state !== "submitted" || !task.reviewerIds.includes(actorId)) {
        throw roomError(
          "forbidden",
          `participant ${actorId} cannot review Task ${task.taskId}`,
        );
      }
      const submission = this.#currentSubmission(task.taskId);
      const createdAt = this.#timestamp();
      const message = this.#appendThreadMessage(
        task,
        actorId,
        summary,
        `${input.idempotencyKey}:message`,
        createdAt,
      );
      const reviewId = this.#options.createId("review");
      this.#options.database
        .prepare(
          `INSERT INTO room_task_reviews(
             review_id, task_id, room_id, submission_id, submission_digest,
             reviewer_id, disposition, summary, message_id, created_at
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          reviewId,
          task.taskId,
          task.roomId,
          submission.submissionId,
          submission.submissionDigest,
          actorId,
          input.disposition,
          summary,
          message.messageId,
          createdAt,
        );
      const nextState =
        input.disposition === "changes_requested" ? "todo" : "submitted";
      this.#options.database
        .prepare(
          `UPDATE room_tasks SET state = ?, completed_at = ?,
             submission_summary = CASE WHEN ? = 'todo' THEN NULL ELSE submission_summary END,
             submitted_at = CASE WHEN ? = 'todo' THEN NULL ELSE submitted_at END,
             updated_at = ? WHERE task_id = ?`,
        )
        .run(nextState, null, nextState, nextState, createdAt, task.taskId);
      const event = this.#options.appendEvent({
        roomId: task.roomId,
        actorId,
        type: "review.submitted",
        aggregateType: "review",
        aggregateId: reviewId,
        idempotencyKey: input.idempotencyKey,
        createdAt,
        payload: {
          taskId: task.taskId,
          submissionId: submission.submissionId,
          submissionDigest: submission.submissionDigest,
          disposition: input.disposition,
          resultingTaskState: nextState,
        },
      });
      if (task.assigneeId) {
        this.#options.appendAttention(
          event,
          task.assigneeId,
          "task_assignment",
          createdAt,
          input.disposition === "changes_requested"
            ? "activation"
            : "notification",
        );
      }
      if (input.disposition === "changes_requested") {
        this.#options.database
          .prepare(
            `UPDATE room_inbox_items
           SET state = 'acknowledged', acknowledged_at = ?
           WHERE room_id = ? AND participant_id <> ? AND state = 'pending'
             AND disposition = 'activation'
             AND event_id IN (
               SELECT event_id FROM room_events
               WHERE room_id = ? AND type = 'task.submitted'
                 AND aggregate_id = ?
             )`,
          )
          .run(createdAt, task.roomId, actorId, task.roomId, task.taskId);
        this.#cancelEmptyActivations(
          task.roomId,
          createdAt,
          "review superseded by changes request",
        );
      }
      if (
        input.disposition === "approved" &&
        this.#allReviewersApproved(
          this.#requireTask(task.taskId),
          submission.submissionId,
        )
      ) {
        for (const managerId of this.#humanManagers(task.roomId)) {
          this.#options.appendAttention(
            event,
            managerId,
            "input_resolved",
            createdAt,
            "notification",
          );
        }
      }
      this.#options.rememberCommand(
        actorId,
        "room.task.review",
        request,
        event,
      );
      this.#recordOutcome(execution, event.eventId);
      return {
        value: this.#requireTask(task.taskId),
        submission,
        review: this.#requireReview(reviewId),
        message,
        event,
        deduplicated: false,
      };
    });
  }

  accept(
    actorId: string,
    input: {
      roomId: string;
      taskId: string;
      basedOnRoomSeq: number;
      summary: string;
      idempotencyKey: string;
    },
  ): RoomTaskMutationResult {
    this.#options.requireMembership(input.roomId, actorId);
    const summary = this.#text(input.summary, "summary", 8_192);
    const request = { ...input, summary };
    const replay = this.#options.command(actorId, "room.task.accept", request);
    if (replay)
      return {
        value: this.#requireTaskInRoom(input.roomId, input.taskId),
        event: replay,
        deduplicated: true,
      };
    return this.#options.transaction(() => {
      const repeated = this.#options.command(
        actorId,
        "room.task.accept",
        request,
      );
      if (repeated)
        return {
          value: this.#requireTaskInRoom(input.roomId, input.taskId),
          event: repeated,
          deduplicated: true,
        };
      const task = this.#requireTaskInRoom(input.roomId, input.taskId);
      this.#requireHumanManager(input.roomId, actorId);
      this.#requireHead(input.roomId, input.basedOnRoomSeq);
      if (task.state !== "submitted")
        throw roomError("conflict", "Task must be submitted before acceptance");
      const submission = this.#currentSubmission(task.taskId);
      if (!this.#allReviewersApproved(task, submission.submissionId)) {
        throw roomError(
          "conflict",
          "Task acceptance requires every canonical reviewer approval",
        );
      }
      const createdAt = this.#timestamp();
      const message = this.#appendThreadMessage(
        task,
        actorId,
        summary,
        `${input.idempotencyKey}:message`,
        createdAt,
      );
      this.#options.database
        .prepare(
          `UPDATE room_tasks SET state = 'completed', completed_at = ?, updated_at = ?
         WHERE task_id = ?`,
        )
        .run(createdAt, createdAt, task.taskId);
      const event = this.#options.appendEvent({
        roomId: task.roomId,
        actorId,
        type: "task.completed",
        aggregateType: "task",
        aggregateId: task.taskId,
        idempotencyKey: input.idempotencyKey,
        createdAt,
        payload: {
          taskId: task.taskId,
          submissionId: submission.submissionId,
          submissionDigest: submission.submissionDigest,
          messageId: message.messageId,
        },
      });
      if (task.assigneeId) {
        this.#options.appendAttention(
          event,
          task.assigneeId,
          "task_assignment",
          createdAt,
          "notification",
        );
      }
      this.#options.rememberCommand(
        actorId,
        "room.task.accept",
        request,
        event,
      );
      this.#releaseDependencies(task, actorId, input.idempotencyKey, createdAt);
      return {
        value: this.#requireTask(task.taskId),
        event,
        deduplicated: false,
      };
    });
  }

  cancel(
    actorId: string,
    input: {
      roomId: string;
      taskId: string;
      basedOnRoomSeq: number;
      reason: string;
      idempotencyKey: string;
    },
  ): RoomTaskMutationResult {
    this.#options.requireMembership(input.roomId, actorId);
    const reason = this.#text(input.reason, "reason", 8_192);
    const request = { ...input, reason };
    const replay = this.#options.command(actorId, "room.task.cancel", request);
    if (replay)
      return {
        value: this.#requireTaskInRoom(input.roomId, input.taskId),
        event: replay,
        deduplicated: true,
      };
    return this.#options.transaction(() => {
      const repeated = this.#options.command(
        actorId,
        "room.task.cancel",
        request,
      );
      if (repeated)
        return {
          value: this.#requireTaskInRoom(input.roomId, input.taskId),
          event: repeated,
          deduplicated: true,
        };
      const task = this.#requireTaskInRoom(input.roomId, input.taskId);
      this.#requireHumanManager(input.roomId, actorId);
      this.#requireHead(input.roomId, input.basedOnRoomSeq);
      if (task.state === "completed" || task.state === "cancelled") {
        throw roomError("conflict", "Terminal Task cannot be cancelled");
      }
      const createdAt = this.#timestamp();
      this.#options.database
        .prepare(
          `UPDATE room_tasks SET state = 'cancelled', cancellation_reason = ?, cancelled_at = ?,
         claimed_by = NULL, claim_until = NULL, updated_at = ? WHERE task_id = ?`,
        )
        .run(reason, createdAt, createdAt, task.taskId);
      const event = this.#options.appendEvent({
        roomId: task.roomId,
        actorId,
        type: "task.cancelled",
        aggregateType: "task",
        aggregateId: task.taskId,
        idempotencyKey: input.idempotencyKey,
        createdAt,
        payload: { taskId: task.taskId, reason },
      });
      if (task.assigneeId) {
        this.#options.appendAttention(
          event,
          task.assigneeId,
          "task_assignment",
          createdAt,
          "notification",
        );
      }
      this.#options.database
        .prepare(
          `UPDATE room_inbox_items
         SET state = 'acknowledged', acknowledged_at = ?
         WHERE room_id = ? AND state = 'pending' AND disposition = 'activation'
           AND event_seq < ?
           AND event_id IN (
             SELECT event_id FROM room_events
             WHERE room_id = ? AND (
               (aggregate_type = 'task' AND aggregate_id = ?)
               OR json_extract(payload_json, '$.taskId') = ?
             )
           )`,
        )
        .run(
          createdAt,
          task.roomId,
          event.roomSeq,
          task.roomId,
          task.taskId,
          task.taskId,
        );
      this.#cancelEmptyActivations(
        task.roomId,
        createdAt,
        "Task was cancelled by a Human manager",
      );
      this.#cancelDependents(task, actorId, input.idempotencyKey, createdAt);
      this.#options.rememberCommand(
        actorId,
        "room.task.cancel",
        request,
        event,
      );
      return {
        value: this.#requireTask(task.taskId),
        event,
        deduplicated: false,
      };
    });
  }

  #transition(
    actorId: string,
    kind: string,
    input: { taskId: string; basedOnRoomSeq: number; idempotencyKey: string },
    revalidateExecution: () => string,
    mutate: (
      task: RoomTask,
      timestamp: string,
    ) => { type: string; payload: Record<string, unknown> },
  ): RoomTaskMutationResult {
    const replay = this.#options.command(actorId, kind, input);
    if (replay)
      return {
        value: this.#requireTask(input.taskId),
        event: replay,
        deduplicated: true,
      };
    return this.#options.transaction(() => {
      const repeated = this.#options.command(actorId, kind, input);
      if (repeated)
        return {
          value: this.#requireTask(input.taskId),
          event: repeated,
          deduplicated: true,
        };
      if (revalidateExecution() !== actorId) {
        throw roomError(
          "forbidden",
          "Task execution principal changed during transition",
        );
      }
      const task = this.#requireTask(input.taskId);
      this.#options.requireMembership(task.roomId, actorId);
      this.#requireHead(task.roomId, input.basedOnRoomSeq);
      const timestamp = this.#timestamp();
      const change = mutate(task, timestamp);
      const event = this.#options.appendEvent({
        roomId: task.roomId,
        actorId,
        type: change.type,
        aggregateType: "task",
        aggregateId: task.taskId,
        idempotencyKey: input.idempotencyKey,
        createdAt: timestamp,
        payload: change.payload,
      });
      this.#options.rememberCommand(actorId, kind, input, event);
      return {
        value: this.#requireTask(task.taskId),
        event,
        deduplicated: false,
      };
    });
  }

  #appendThreadMessage(
    task: RoomTask,
    actorId: string,
    body: string,
    idempotencyKey: string,
    createdAt: string,
  ): RoomMessage {
    const messageId = this.#options.createId("message");
    const event = this.#options.appendEvent({
      roomId: task.roomId,
      actorId,
      type: "message.posted",
      aggregateType: "message",
      aggregateId: messageId,
      idempotencyKey,
      createdAt,
      payload: {
        body,
        taskId: task.taskId,
        attention: [],
        createdAt,
        reference: {
          threadId: task.threadId,
          rootMessageId: task.sourceMessageId,
          replyToMessageId: task.sourceMessageId,
        },
      },
    });
    const message: RoomMessage = {
      messageId,
      roomId: task.roomId,
      roomSeq: event.roomSeq,
      actorId,
      body,
      threadId: task.threadId,
      rootMessageId: task.sourceMessageId,
      replyToMessageId: task.sourceMessageId,
      createdAt,
    };
    this.#options.database
      .prepare(
        `INSERT INTO room_messages(
           message_id, room_id, room_seq, actor_id, body, thread_id,
           root_message_id, reply_to_message_id, created_at
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.messageId,
        message.roomId,
        message.roomSeq,
        message.actorId,
        message.body,
        task.threadId,
        task.sourceMessageId,
        task.sourceMessageId,
        message.createdAt,
      );
    return message;
  }

  #releaseDependencies(
    task: RoomTask,
    actorId: string,
    key: string,
    createdAt: string,
  ): void {
    const dependents = this.#options.database
      .prepare(
        `SELECT candidate.* FROM room_tasks AS candidate
         JOIN room_task_dependencies AS dependency ON dependency.task_id = candidate.task_id
         WHERE dependency.dependency_task_id = ? AND candidate.state = 'todo'
         ORDER BY candidate.task_number`,
      )
      .all(task.taskId) as Row[];
    for (const row of dependents) {
      const dependent = this.#taskFromRow(row);
      if (this.#hasIncompleteDependencies(dependent.taskId)) continue;
      const event = this.#options.appendEvent({
        roomId: dependent.roomId,
        actorId,
        type: "task.dependency_resolved",
        aggregateType: "task",
        aggregateId: dependent.taskId,
        idempotencyKey: `${key}:dependency:${dependent.taskId}`,
        createdAt,
        payload: {
          taskId: dependent.taskId,
          resolvedDependencyTaskId: task.taskId,
        },
      });
      if (dependent.assigneeId) {
        this.#options.appendAttention(
          event,
          dependent.assigneeId,
          "dependency_resolved",
          createdAt,
        );
      }
    }
  }

  #cancelDependents(
    prerequisite: RoomTask,
    actorId: string,
    key: string,
    createdAt: string,
  ): void {
    const pending = [prerequisite.taskId];
    const visited = new Set(pending);
    while (pending.length > 0) {
      const dependencyTaskId = pending.shift()!;
      const rows = this.#options.database
        .prepare(
          `SELECT candidate.* FROM room_tasks AS candidate
         JOIN room_task_dependencies AS dependency ON dependency.task_id = candidate.task_id
         WHERE dependency.dependency_task_id = ?
           AND candidate.state NOT IN ('completed', 'cancelled')
         ORDER BY candidate.task_number`,
        )
        .all(dependencyTaskId) as Row[];
      for (const row of rows) {
        const dependent = this.#taskFromRow(row);
        if (visited.has(dependent.taskId)) continue;
        visited.add(dependent.taskId);
        pending.push(dependent.taskId);
        const reason = `Dependency ${dependencyTaskId} was cancelled`;
        this.#options.database
          .prepare(
            `UPDATE room_tasks SET state = 'cancelled', cancellation_reason = ?,
             cancelled_at = ?, claimed_by = NULL, claim_until = NULL, updated_at = ?
           WHERE task_id = ?`,
          )
          .run(reason, createdAt, createdAt, dependent.taskId);
        const event = this.#options.appendEvent({
          roomId: dependent.roomId,
          actorId,
          type: "task.cancelled",
          aggregateType: "task",
          aggregateId: dependent.taskId,
          idempotencyKey: `${key}:dependency-cancel:${dependent.taskId}`,
          createdAt,
          payload: { taskId: dependent.taskId, reason },
        });
        this.#options.appendAttention(
          event,
          dependent.assigneeId,
          "task_assignment",
          createdAt,
          "notification",
        );
        this.#options.database
          .prepare(
            `UPDATE room_inbox_items SET state = 'acknowledged', acknowledged_at = ?
           WHERE room_id = ? AND state = 'pending' AND disposition = 'activation'
             AND event_seq < ? AND event_id IN (
               SELECT event_id FROM room_events WHERE room_id = ? AND (
                 (aggregate_type = 'task' AND aggregate_id = ?)
                 OR json_extract(payload_json, '$.taskId') = ?
               )
             )`,
          )
          .run(
            createdAt,
            dependent.roomId,
            event.roomSeq,
            dependent.roomId,
            dependent.taskId,
            dependent.taskId,
          );
      }
    }
    this.#cancelEmptyActivations(
      prerequisite.roomId,
      createdAt,
      "Task dependency was cancelled by a Human manager",
    );
  }

  #submissionReplay(event: RoomEvent): RoomTaskSubmissionMutationResult {
    const submissionId = event.payload.submissionId;
    const messageId = event.payload.messageId;
    if (typeof submissionId !== "string" || typeof messageId !== "string") {
      throw roomError("conflict", "submission replay evidence is incomplete");
    }
    return {
      value: this.#requireTask(event.aggregateId),
      submission: this.#requireSubmission(submissionId),
      message: this.#options.requireMessage(messageId),
      event,
      deduplicated: true,
    };
  }

  #reviewReplay(event: RoomEvent): RoomTaskReviewMutationResult {
    const reviewId = event.aggregateId;
    const review = this.#requireReview(reviewId);
    return {
      value: this.#requireTask(review.taskId),
      submission: this.#requireSubmission(review.submissionId),
      message: this.#options.requireMessage(review.messageId),
      review,
      event,
      deduplicated: true,
    };
  }

  #currentSubmission(taskId: string): RoomTaskSubmission {
    const row = this.#options.database
      .prepare(
        "SELECT * FROM room_task_submissions WHERE task_id = ? ORDER BY submission_number DESC LIMIT 1",
      )
      .get(taskId) as Row | undefined;
    if (!row) throw roomError("conflict", `Task ${taskId} has no submission`);
    return roomTaskSubmissionFromRow(row);
  }

  #allReviewersApproved(task: RoomTask, submissionId: string): boolean {
    const row = this.#options.database
      .prepare(
        `SELECT COUNT(*) AS approved FROM room_task_reviews
         WHERE submission_id = ? AND disposition = 'approved'`,
      )
      .get(submissionId) as Row;
    return integer(row, "approved") === task.reviewerIds.length;
  }

  #humanManagers(roomId: string): string[] {
    return (
      this.#options.database
        .prepare(
          `SELECT membership.principal_id
         FROM room_memberships AS membership
         JOIN room_principals AS principal
           ON principal.principal_id = membership.principal_id
         WHERE membership.room_id = ?
           AND membership.role IN ('owner', 'admin')
           AND principal.kind = 'human'
         ORDER BY membership.principal_id`,
        )
        .all(roomId) as Row[]
    ).map((row) => text(row, "principal_id"));
  }

  #requireHumanManager(roomId: string, actorId: string): void {
    const membership = this.#options.requireMembership(roomId, actorId);
    const principal = this.#options.database
      .prepare("SELECT kind FROM room_principals WHERE principal_id = ?")
      .get(actorId) as Row | undefined;
    if (
      !principal ||
      text(principal, "kind") !== "human" ||
      (membership.role !== "owner" && membership.role !== "admin")
    ) {
      throw roomError(
        "forbidden",
        "Task acceptance and cancellation require a Human Room manager",
      );
    }
  }

  #requireAgentPrincipal(principalId: string, label: string): void {
    const principal = this.#options.database
      .prepare("SELECT kind FROM room_principals WHERE principal_id = ?")
      .get(principalId) as Row | undefined;
    if (!principal || text(principal, "kind") !== "agent") {
      throw roomError("invalid_argument", `${label} must be an Agent`);
    }
  }

  #cancelEmptyActivations(
    roomId: string,
    timestamp: string,
    reason: string,
  ): void {
    const empty = this.#options.database
      .prepare(
        `SELECT activation_id FROM room_activations AS activation
       WHERE room_id = ? AND state IN ('queued', 'leased')
         AND NOT EXISTS (
           SELECT 1 FROM room_inbox_items AS inbox
           WHERE inbox.room_id = activation.room_id
             AND inbox.participant_id = activation.participant_id
             AND inbox.event_seq BETWEEN activation.from_seq AND activation.to_seq
             AND inbox.state = 'pending' AND inbox.disposition = 'activation'
         )`,
      )
      .all(roomId) as Row[];
    for (const row of empty) {
      const activationId = text(row, "activation_id");
      this.#options.database
        .prepare(
          `UPDATE room_run_attempts
         SET state = 'failed', ended_at = ?, updated_at = ?
         WHERE activation_id = ? AND state IN ('prepared', 'running')`,
        )
        .run(timestamp, timestamp, activationId);
      this.#options.database
        .prepare(
          `UPDATE room_activations
         SET state = 'cancelled', lease_owner = NULL, lease_token = NULL,
             lease_expires_at = NULL, last_error = ?, updated_at = ?
         WHERE activation_id = ?`,
        )
        .run(reason, timestamp, activationId);
    }
  }

  #hasIncompleteDependencies(taskId: string): boolean {
    return Boolean(
      this.#options.database
        .prepare(
          `SELECT 1 FROM room_task_dependencies AS dependency
         JOIN room_tasks AS required ON required.task_id = dependency.dependency_task_id
         WHERE dependency.task_id = ? AND required.state <> 'completed' LIMIT 1`,
        )
        .get(taskId),
    );
  }

  #requireOwnedClaim(task: RoomTask, actorId: string): void {
    if (
      task.claimedBy !== actorId ||
      !task.claimUntil ||
      task.claimUntil <= this.#timestamp()
    ) {
      throw roomError(
        "conflict",
        `Task ${task.taskId} has no active claim for ${actorId}`,
      );
    }
  }

  #requireTaskExecution(
    execution: RoomWorkerExecution,
    taskId: string,
    role: "assignee" | "reviewer",
    allowTerminal = false,
  ): string {
    const run = this.#options.database
      .prepare(
        `SELECT run.room_id, run.participant_id, run.state,
                run.worker_id AS run_worker_id, run.lease_token AS run_lease_token,
                activation.state AS activation_state,
                activation.lease_owner, activation.lease_token, activation.lease_expires_at,
                activation.from_seq, activation.to_seq
         FROM room_run_attempts AS run
         JOIN room_activations AS activation ON activation.activation_id = run.activation_id
         WHERE run.run_attempt_id = ? AND run.activation_id = ?`,
      )
      .get(execution.runAttemptId, execution.activationId) as Row | undefined;
    if (
      !run ||
      optionalText(run, "run_worker_id") !== execution.workerId ||
      optionalText(run, "run_lease_token") !== execution.leaseToken ||
      integer(run, "from_seq") !== execution.fromSeq ||
      integer(run, "to_seq") !== execution.toSeq ||
      text(run, "room_id") !== execution.roomId ||
      text(run, "participant_id") !== execution.participantId
    ) {
      throw roomError(
        "forbidden",
        "Task command has an invalid Worker execution fence",
      );
    }
    const task = this.#requireTask(taskId);
    const authorized =
      role === "assignee"
        ? task.assigneeId === execution.participantId
        : task.reviewerIds.includes(execution.participantId);
    if (!authorized || task.roomId !== execution.roomId) {
      throw roomError("forbidden", `Worker is not the Task ${role}`);
    }
    if (allowTerminal) return execution.participantId;
    const leaseExpiresAt = optionalText(run, "lease_expires_at");
    if (
      text(run, "state") !== "running" ||
      text(run, "activation_state") !== "leased" ||
      text(run, "lease_owner") !== execution.workerId ||
      text(run, "lease_token") !== execution.leaseToken ||
      !leaseExpiresAt ||
      leaseExpiresAt <= this.#timestamp()
    ) {
      throw roomError(
        "forbidden",
        "Task command requires an active Worker execution",
      );
    }
    const delivered = this.#options.database
      .prepare(
        `SELECT 1 FROM room_inbox_items AS inbox
         JOIN room_events AS event ON event.event_id = inbox.event_id
         WHERE inbox.participant_id = ? AND inbox.room_id = ?
           AND inbox.event_seq BETWEEN ? AND ?
           AND (
             event.aggregate_id = ? OR json_extract(event.payload_json, '$.taskId') = ?
           ) LIMIT 1`,
      )
      .get(
        execution.participantId,
        execution.roomId,
        execution.fromSeq,
        execution.toSeq,
        taskId,
        taskId,
      );
    if (!delivered)
      throw roomError("forbidden", "Task was not delivered in this Activation");
    return execution.participantId;
  }

  #recordOutcome(execution: RoomWorkerExecution, eventId: string): void {
    this.#options.database
      .prepare(
        `INSERT OR IGNORE INTO room_activation_outcomes(
           activation_id, event_id, run_attempt_id, created_at
         ) VALUES(?, ?, ?, ?)`,
      )
      .run(
        execution.activationId,
        eventId,
        execution.runAttemptId,
        this.#timestamp(),
      );
  }

  #requireHead(roomId: string, expected: number): void {
    if (!Number.isSafeInteger(expected) || expected < 0) {
      throw roomError(
        "invalid_argument",
        "basedOnRoomSeq must be a non-negative safe integer",
      );
    }
    const current = this.#options.roomHead(roomId);
    if (current !== expected) {
      throw roomError(
        "stale_context",
        `Room changed: expected ${expected}, current ${current}`,
      );
    }
  }

  #normalizeCreate(
    input: Parameters<RoomTaskService["create"]>[1],
  ): TaskCommand & {
    roomId: string;
    sourceMessageId: string;
    title: string;
    description?: string;
    assigneeId: string;
    reviewerIds: string[];
    dependencyTaskIds: string[];
    basedOnRoomSeq: number;
    idempotencyKey: string;
  } {
    const reviewerIds = [...new Set(input.reviewerIds)].sort();
    const dependencyTaskIds = [
      ...new Set(input.dependencyTaskIds ?? []),
    ].sort();
    if (reviewerIds.length === 0)
      throw roomError("invalid_argument", "Task requires a reviewer");
    if (!input.assigneeId)
      throw roomError("invalid_argument", "Task requires an Agent assignee");
    if (reviewerIds.includes(input.assigneeId)) {
      throw roomError(
        "invalid_argument",
        "Task reviewer must be independent from the assignee",
      );
    }
    return {
      roomId: input.roomId,
      sourceMessageId: input.sourceMessageId,
      title: this.#text(input.title, "title", 240),
      ...(input.description
        ? { description: this.#text(input.description, "description", 8_192) }
        : {}),
      assigneeId: input.assigneeId,
      reviewerIds,
      dependencyTaskIds,
      basedOnRoomSeq: input.basedOnRoomSeq,
      idempotencyKey: input.idempotencyKey,
    };
  }

  #text(value: string, name: string, max: number): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > max) {
      throw roomError(
        "invalid_argument",
        `${name} must contain 1 to ${max} characters`,
      );
    }
    try {
      assertRoomTextStorageSafe(normalized, name);
    } catch (error) {
      throw roomError(
        "invalid_argument",
        error instanceof Error ? error.message : `${name} is not storage-safe`,
      );
    }
    return normalized;
  }

  #requireTask(taskId: string): RoomTask {
    const row = this.#options.database
      .prepare("SELECT * FROM room_tasks WHERE task_id = ?")
      .get(taskId) as Row | undefined;
    if (!row) throw roomError("not_found", `Task ${taskId} was not found`);
    return this.#taskFromRow(row);
  }

  #requireTaskInRoom(roomId: string, taskId: string): RoomTask {
    const task = this.#requireTask(taskId);
    if (task.roomId !== roomId) {
      throw roomError(
        "not_found",
        `Task ${taskId} was not found in Room ${roomId}`,
      );
    }
    return task;
  }

  #requireSubmission(submissionId: string): RoomTaskSubmission {
    const row = this.#options.database
      .prepare("SELECT * FROM room_task_submissions WHERE submission_id = ?")
      .get(submissionId) as Row | undefined;
    if (!row)
      throw roomError("not_found", `Submission ${submissionId} was not found`);
    return roomTaskSubmissionFromRow(row);
  }

  #requireReview(reviewId: string): RoomTaskReview {
    const row = this.#options.database
      .prepare("SELECT * FROM room_task_reviews WHERE review_id = ?")
      .get(reviewId) as Row | undefined;
    if (!row) throw roomError("not_found", `Review ${reviewId} was not found`);
    return roomTaskReviewFromRow(row);
  }

  #taskFromRow(row: Row): RoomTask {
    const taskId = text(row, "task_id");
    const reviewerIds = (
      this.#options.database
        .prepare(
          "SELECT participant_id FROM room_task_reviewers WHERE task_id = ? ORDER BY participant_id",
        )
        .all(taskId) as Row[]
    ).map((item) => text(item, "participant_id"));
    const dependencyTaskIds = (
      this.#options.database
        .prepare(
          "SELECT dependency_task_id FROM room_task_dependencies WHERE task_id = ? ORDER BY dependency_task_id",
        )
        .all(taskId) as Row[]
    ).map((item) => text(item, "dependency_task_id"));
    return roomTaskFromRow(row, reviewerIds, dependencyTaskIds);
  }

  #timestamp(): string {
    return this.#options.now().toISOString();
  }
}
