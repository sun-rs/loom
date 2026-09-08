import type { DatabaseSync } from "node:sqlite";

import {
  TaskReviewDispositionSchema,
  TaskReviewSchema,
  TaskSubmissionSchema,
  type ActivationCredentialScope,
  type RoomEvent,
  type Task,
  type TaskArtifactReference,
  type TaskReview,
  type TaskReviewDisposition,
  type TaskSubmission,
  type TaskSubmissionEvidence,
} from "@rah-os/protocol";

import type {
  AuthenticatedActorContext,
  AuthenticatedWorkerExecutionContext,
} from "./auth.ts";
import { canonicalDigest } from "./canonical-digest.ts";
import { requireRoomMember } from "./collaboration-policy.ts";
import {
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  NotFoundError,
  StaleContextError,
} from "./errors.ts";
import { createTaskThreadReply } from "./task-anchor.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { integer, jsonObject, text, type Row } from "./sqlite-row.ts";
import { taskProjectionFromRow } from "./task-projection.ts";
import { requireWorkerTaskVisibility } from "./worker-task-scope.ts";

export type TaskReviewMutationResult = {
  activationIds: string[];
  deduplicated: boolean;
  event: RoomEvent;
  review: TaskReview;
  submission: TaskSubmission;
  task: Task;
};

export type TaskReviewServiceOptions = {
  createId: (prefix: string) => string;
  database: DatabaseSync;
  events: RoomEventWriter;
  now: () => Date;
  requireActor: (actor: AuthenticatedActorContext) => string;
  requireWorker: (
    execution: AuthenticatedWorkerExecutionContext,
  ) => ActivationCredentialScope;
};

export class TaskReviewService {
  readonly #createId: (prefix: string) => string;
  readonly #database: DatabaseSync;
  readonly #events: RoomEventWriter;
  readonly #now: () => Date;
  readonly #requireActor: (actor: AuthenticatedActorContext) => string;
  readonly #requireWorker: (
    execution: AuthenticatedWorkerExecutionContext,
  ) => ActivationCredentialScope;

  constructor(options: TaskReviewServiceOptions) {
    this.#createId = options.createId;
    this.#database = options.database;
    this.#events = options.events;
    this.#now = options.now;
    this.#requireActor = options.requireActor;
    this.#requireWorker = options.requireWorker;
  }

  recordSubmission(
    taskRow: Row,
    input: {
      artifacts?: readonly TaskArtifactReference[];
      createdAt: string;
      evidence?: TaskSubmissionEvidence;
      messageId: string;
      producerId: string;
      summary: string;
    },
  ): TaskSubmission {
    const taskId = text(taskRow, "task_id");
    const roomId = text(taskRow, "room_id");
    const submissionNumber =
      integer(
        this.#database
          .prepare(
            "SELECT COUNT(*) AS count FROM task_submissions WHERE task_id = ?",
          )
          .get(taskId)!,
        "count",
      ) + 1;
    const submissionId = this.#createId("submission");
    const artifacts = [...(input.artifacts ?? [])];
    const submissionDigest = canonicalDigest({
      createdAt: input.createdAt,
      domain:
        input.evidence !== undefined
          ? "rah/task-submission/v3"
          : input.artifacts === undefined
            ? "rah/task-submission/v1"
            : "rah/task-submission/v2",
      ...(input.artifacts === undefined ? {} : { artifacts }),
      ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
      messageId: input.messageId,
      producerId: input.producerId,
      roomId,
      sourceMessageId: text(taskRow, "source_message_id"),
      submissionNumber,
      summary: input.summary,
      taskId,
      taskNumber: integer(taskRow, "task_number"),
      threadId: text(taskRow, "thread_id"),
    });
    this.#database
      .prepare(
        `INSERT INTO task_submissions(
           submission_id, task_id, room_id, submission_number, producer_id,
           summary, message_id, submission_digest, evidence_json, created_at
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        submissionId,
        taskId,
        roomId,
        submissionNumber,
        input.producerId,
        input.summary,
        input.messageId,
        submissionDigest,
        input.evidence === undefined ? null : JSON.stringify(input.evidence),
        input.createdAt,
      );
    const insertArtifact = this.#database.prepare(
      `INSERT INTO task_submission_artifacts(
         submission_id, ordinal, attachment_id, task_id, producer_id,
         run_attempt_id, filename, mime_type, size, sha256
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const artifact of artifacts) {
      insertArtifact.run(
        submissionId,
        artifact.ordinal,
        artifact.attachmentId,
        artifact.taskId,
        artifact.producerId,
        artifact.runAttemptId,
        artifact.filename,
        artifact.mimeType,
        artifact.size,
        artifact.sha256,
      );
    }
    return TaskSubmissionSchema.parse({
      artifacts,
      createdAt: input.createdAt,
      ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
      messageId: input.messageId,
      producerId: input.producerId,
      roomId,
      submissionDigest,
      submissionId,
      submissionNumber,
      summary: input.summary,
      taskId,
    });
  }

  backfillLegacySubmissions(): number {
    const rows = this.#database
      .prepare(
        `SELECT tasks.*, room_events.actor_id AS submitted_by,
                room_events.created_at AS submission_created_at,
                room_events.payload_json AS submission_payload_json
         FROM tasks
         JOIN room_events
           ON room_events.event_id = (
             SELECT candidate.event_id
             FROM room_events AS candidate
             WHERE candidate.room_id = tasks.room_id
               AND candidate.aggregate_type = 'task'
               AND candidate.aggregate_id = tasks.task_id
               AND candidate.type = 'task.submitted'
             ORDER BY candidate.room_seq DESC
             LIMIT 1
           )
         WHERE tasks.state IN ('submitted', 'completed')
           AND NOT EXISTS (
             SELECT 1 FROM task_submissions
             WHERE task_submissions.task_id = tasks.task_id
           )
         ORDER BY tasks.room_id, tasks.task_number`,
      )
      .all();
    for (const row of rows) {
      const payload = jsonObject(row, "submission_payload_json");
      const messageId = payload.messageId;
      const summary = payload.summary;
      if (typeof messageId !== "string" || typeof summary !== "string") {
        throw new Error(
          `legacy Task ${text(row, "task_id")} has no provable submission evidence`,
        );
      }
      this.recordSubmission(row, {
        createdAt: text(row, "submission_created_at"),
        messageId,
        producerId: text(row, "submitted_by"),
        summary,
      });
    }
    return rows.length;
  }

  reviewTask(
    execution: AuthenticatedWorkerExecutionContext,
    input: {
      basedOnRoomSeq: number;
      disposition: TaskReviewDisposition;
      idempotencyKey: string;
      summary: string;
      taskId: string;
    },
  ): TaskReviewMutationResult {
    const disposition = TaskReviewDispositionSchema.parse(input.disposition);
    const summary = input.summary.trim();
    if (summary.length === 0) throw new Error("review summary is required");
    return this.#transaction(() => {
      const scope = this.#requireWorker(execution);
      const taskRow = this.#requireTask(input.taskId);
      const roomId = text(taskRow, "room_id");
      if (roomId !== scope.roomId) {
        throw new ForbiddenError(
          `Task ${input.taskId} is outside this Worker execution scope`,
        );
      }
      const previous = this.#database
        .prepare(
          "SELECT * FROM room_events WHERE room_id = ? AND idempotency_key = ?",
        )
        .get(roomId, input.idempotencyKey);
      if (previous !== undefined) {
        return this.#reviewReplay(previous, scope.participantId, {
          disposition,
          summary,
          taskId: input.taskId,
        });
      }
      this.#requireDeliveredReview(scope, input.taskId, input.basedOnRoomSeq);
      if (text(taskRow, "state") !== "submitted") {
        throw new ConflictError(
          `Task ${input.taskId} can only be reviewed from submitted`,
        );
      }
      const reviewer = this.#database
        .prepare(
          "SELECT 1 FROM task_participants WHERE task_id = ? AND participant_id = ? AND role = 'reviewer'",
        )
        .get(input.taskId, scope.participantId);
      if (reviewer === undefined) {
        throw new ForbiddenError(
          `participant ${scope.participantId} is not a reviewer for Task ${input.taskId}`,
        );
      }
      const submissionRow = this.#requireCurrentSubmission(input.taskId);
      const existing = this.#database
        .prepare(
          "SELECT review_id FROM task_reviews WHERE submission_id = ? AND reviewer_id = ?",
        )
        .get(text(submissionRow, "submission_id"), scope.participantId);
      if (existing !== undefined) {
        throw new ConflictError(
          `reviewer ${scope.participantId} already reviewed the current submission`,
        );
      }

      const createdAt = this.#now().toISOString();
      const reviewId = this.#createId("review");
      const { messageId } = createTaskThreadReply(
        this.#database,
        this.#createId,
        taskRow,
        {
          actorId: scope.participantId,
          body: summary,
          createdAt,
          roomId,
        },
      );
      this.#database
        .prepare(
          `INSERT INTO task_reviews(
             review_id, task_id, room_id, submission_id, submission_digest,
             reviewer_id, disposition, summary, message_id, created_at
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          reviewId,
          input.taskId,
          roomId,
          text(submissionRow, "submission_id"),
          text(submissionRow, "submission_digest"),
          scope.participantId,
          disposition,
          summary,
          messageId,
          createdAt,
        );
      if (disposition === "changes_requested") {
        this.#database
          .prepare(
            `UPDATE tasks
             SET state = 'todo', claimed_by = NULL, claim_until = NULL,
                 claim_until_ms = NULL, submission_summary = NULL,
                 submitted_at = NULL, updated_at = ?
             WHERE task_id = ?`,
          )
          .run(createdAt, input.taskId);
      }
      const event = this.#events.append({
        actorId: scope.participantId,
        aggregateId: reviewId,
        aggregateType: "review",
        idempotencyKey: input.idempotencyKey,
        payload: {
          basedOnRoomSeq: input.basedOnRoomSeq,
          disposition,
          messageId,
          runAttemptId: scope.runAttemptId,
          submissionDigest: text(submissionRow, "submission_digest"),
          submissionId: text(submissionRow, "submission_id"),
          summary,
          taskId: input.taskId,
        },
        roomId,
        type: "review.submitted",
      });
      const activationIds =
        disposition === "changes_requested"
          ? this.#wakeTaskWorkers(event, taskRow, createdAt)
          : [];
      return {
        activationIds,
        deduplicated: false,
        event,
        review: this.#reviewFromRow(this.#requireReview(reviewId)),
        submission: this.#submissionFromRow(submissionRow),
        task: taskProjectionFromRow(
          this.#database,
          this.#requireTask(input.taskId),
        ),
      };
    });
  }

  listTaskReviews(
    actor: AuthenticatedActorContext,
    input: { roomId: string; taskId: string },
  ): TaskReview[] {
    const actorId = this.#requireActor(actor);
    requireRoomMember(this.#database, input.roomId, actorId);
    const task = this.#requireTask(input.taskId);
    if (text(task, "room_id") !== input.roomId) {
      throw new NotFoundError(
        `Task ${input.taskId} was not found in Room ${input.roomId}`,
      );
    }
    return this.#database
      .prepare(
        `SELECT task_reviews.*
         FROM task_reviews
         JOIN task_submissions
           ON task_submissions.submission_id = task_reviews.submission_id
         WHERE task_reviews.task_id = ?
         ORDER BY task_submissions.submission_number,
                  task_reviews.reviewer_id, task_reviews.review_id`,
      )
      .all(input.taskId)
      .map((row) => this.#reviewFromRow(row));
  }

  getWorkerTaskSubmission(
    execution: AuthenticatedWorkerExecutionContext,
    input: { taskId: string },
  ): TaskSubmission {
    const scope = this.#requireWorker(execution);
    requireWorkerTaskVisibility(this.#database, scope, input.taskId);
    return this.#submissionFromRow(
      this.#requireCurrentSubmission(input.taskId),
    );
  }

  listTaskSubmissions(
    actor: AuthenticatedActorContext,
    input: { roomId: string; taskId: string },
  ): TaskSubmission[] {
    const actorId = this.#requireActor(actor);
    requireRoomMember(this.#database, input.roomId, actorId);
    const task = this.#requireTask(input.taskId);
    if (text(task, "room_id") !== input.roomId) {
      throw new NotFoundError(
        `Task ${input.taskId} was not found in Room ${input.roomId}`,
      );
    }
    return this.#database
      .prepare(
        "SELECT * FROM task_submissions WHERE task_id = ? ORDER BY submission_number",
      )
      .all(input.taskId)
      .map((row) => this.#submissionFromRow(row));
  }

  listRoomReviews(
    actor: AuthenticatedActorContext,
    input: { limit?: number; roomId: string; taskIds?: string[] },
  ): TaskReview[] {
    const actorId = this.#requireActor(actor);
    requireRoomMember(this.#database, input.roomId, actorId);
    const limit = this.#evidencePageLimit(input.limit);
    if (input.taskIds?.length === 0) return [];
    const placeholders = input.taskIds?.map(() => "?").join(",");
    const taskFilter = placeholders
      ? `AND task_reviews.task_id IN (${placeholders})`
      : "";
    return this.#database
      .prepare(
        `SELECT * FROM (
           SELECT task_reviews.*,
                  task_submissions.submission_number AS ordered_submission_number
           FROM task_reviews
           JOIN task_submissions
             ON task_submissions.submission_id = task_reviews.submission_id
           WHERE task_reviews.room_id = ? ${taskFilter}
           ORDER BY task_reviews.created_at DESC, task_reviews.review_id DESC
           LIMIT ?
         )
         ORDER BY task_id, ordered_submission_number, reviewer_id, review_id`,
      )
      .all(input.roomId, ...(input.taskIds ?? []), limit)
      .map((row) => this.#reviewFromRow(row));
  }

  listRoomSubmissions(
    actor: AuthenticatedActorContext,
    input: { limit?: number; roomId: string; taskIds?: string[] },
  ): TaskSubmission[] {
    const actorId = this.#requireActor(actor);
    requireRoomMember(this.#database, input.roomId, actorId);
    const limit = this.#evidencePageLimit(input.limit);
    if (input.taskIds?.length === 0) return [];
    const placeholders = input.taskIds?.map(() => "?").join(",");
    const taskFilter = placeholders ? `AND task_id IN (${placeholders})` : "";
    return this.#database
      .prepare(
        `SELECT * FROM (
           SELECT * FROM task_submissions
           WHERE room_id = ? ${taskFilter}
           ORDER BY created_at DESC, submission_id DESC
           LIMIT ?
         )
         ORDER BY task_id, submission_number`,
      )
      .all(input.roomId, ...(input.taskIds ?? []), limit)
      .map((row) => this.#submissionFromRow(row));
  }

  #evidencePageLimit(limit = 200): number {
    if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
      throw new Error("Task evidence page limit must be between 1 and 500");
    }
    return limit;
  }

  assertCompletionAllowed(taskId: string): void {
    const reviewers = this.#database
      .prepare(
        "SELECT participant_id FROM task_participants WHERE task_id = ? AND role = 'reviewer' ORDER BY participant_id",
      )
      .all(taskId)
      .map((row) => text(row, "participant_id"));
    if (reviewers.length === 0) return;
    const submission = this.#requireCurrentSubmission(taskId);
    const approved = new Set(
      this.#database
        .prepare(
          "SELECT reviewer_id FROM task_reviews WHERE submission_id = ? AND disposition = 'approved'",
        )
        .all(text(submission, "submission_id"))
        .map((row) => text(row, "reviewer_id")),
    );
    const missing = reviewers.filter((reviewerId) => !approved.has(reviewerId));
    if (missing.length > 0) {
      throw new ConflictError(
        `Task ${taskId} requires approved Review evidence from: ${missing.join(", ")}`,
      );
    }
  }

  #requireDeliveredReview(
    scope: ActivationCredentialScope,
    taskId: string,
    basedOnRoomSeq: number,
  ): void {
    if (!Number.isInteger(basedOnRoomSeq) || basedOnRoomSeq < 0) {
      throw new Error("basedOnRoomSeq must be a non-negative integer");
    }
    const activation = this.#database
      .prepare("SELECT * FROM activations WHERE activation_id = ?")
      .get(scope.activationId);
    if (activation === undefined) {
      throw new ForbiddenError(
        `Activation ${scope.activationId} is outside this Worker execution`,
      );
    }
    const submitted = this.#database
      .prepare(
        `SELECT room_events.room_seq
         FROM room_events
         JOIN inbox_items
           ON inbox_items.event_id = room_events.event_id
          AND inbox_items.participant_id = ?
          AND inbox_items.reason = 'task_review'
         WHERE room_events.room_id = ?
           AND room_events.aggregate_type = 'task'
           AND room_events.aggregate_id = ?
           AND room_events.type = 'task.submitted'
           AND room_events.room_seq BETWEEN ? AND ?
         ORDER BY room_events.room_seq DESC
         LIMIT 1`,
      )
      .get(
        scope.participantId,
        scope.roomId,
        taskId,
        integer(activation, "from_seq"),
        integer(activation, "to_seq"),
      );
    if (
      submitted === undefined ||
      integer(submitted, "room_seq") > basedOnRoomSeq
    ) {
      throw new ForbiddenError(
        `Task ${taskId} review was not delivered in this Activation`,
      );
    }
    const currentSubmission = this.#requireCurrentSubmission(taskId);
    const currentSubmittedEvent = this.#database
      .prepare(
        `SELECT room_seq, payload_json FROM room_events
         WHERE room_id = ? AND aggregate_type = 'task' AND aggregate_id = ?
           AND type = 'task.submitted'
         ORDER BY room_seq DESC LIMIT 1`,
      )
      .get(scope.roomId, taskId);
    const currentPayload =
      currentSubmittedEvent === undefined
        ? undefined
        : jsonObject(currentSubmittedEvent, "payload_json");
    const currentSubmissionMatches =
      currentPayload?.submissionId === undefined
        ? currentPayload?.messageId === text(currentSubmission, "message_id")
        : currentPayload.submissionId ===
          text(currentSubmission, "submission_id");
    if (currentSubmittedEvent === undefined || !currentSubmissionMatches) {
      throw new StaleContextError(
        basedOnRoomSeq,
        integer(
          this.#database
            .prepare("SELECT next_seq FROM rooms WHERE room_id = ?")
            .get(scope.roomId)!,
          "next_seq",
        ) - 1,
      );
    }
  }

  #wakeTaskWorkers(
    event: RoomEvent,
    taskRow: Row,
    createdAt: string,
  ): string[] {
    const assigneeId = text(taskRow, "assignee_id");
    const recipients = [
      {
        obligations: [
          {
            kind: "task_owner_follow_up" as const,
            taskId: text(taskRow, "task_id"),
          },
        ],
        participantId: assigneeId,
        reason: "task_assigned" as const,
      },
      ...this.#database
        .prepare(
          "SELECT participant_id FROM task_participants WHERE task_id = ? AND role = 'collaborator' ORDER BY participant_id",
        )
        .all(text(taskRow, "task_id"))
        .map((row) => ({
          participantId: text(row, "participant_id"),
          reason: "task_collaboration" as const,
        })),
    ];
    return this.#events.deriveAttention(event, recipients, createdAt);
  }

  #reviewReplay(
    eventRow: Row,
    actorId: string,
    expected: {
      disposition: TaskReviewDisposition;
      summary: string;
      taskId: string;
    },
  ): TaskReviewMutationResult {
    const event = this.#events.eventFromRow(eventRow);
    const payload = event.payload;
    if (
      event.type !== "review.submitted" ||
      event.aggregateType !== "review" ||
      event.actorId !== actorId ||
      payload.taskId !== expected.taskId ||
      payload.disposition !== expected.disposition ||
      payload.summary !== expected.summary
    ) {
      throw new IdempotencyConflictError(
        `idempotency key ${event.idempotencyKey} was already used for another mutation`,
      );
    }
    const reviewRow = this.#requireReview(event.aggregateId);
    const submissionRow = this.#database
      .prepare("SELECT * FROM task_submissions WHERE submission_id = ?")
      .get(text(reviewRow, "submission_id"));
    if (submissionRow === undefined) {
      throw new NotFoundError(
        `submission ${text(reviewRow, "submission_id")} was not found`,
      );
    }
    return {
      activationIds: [],
      deduplicated: true,
      event,
      review: this.#reviewFromRow(reviewRow),
      submission: this.#submissionFromRow(submissionRow),
      task: taskProjectionFromRow(
        this.#database,
        this.#requireTask(expected.taskId),
      ),
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

  #requireReview(reviewId: string): Row {
    const row = this.#database
      .prepare("SELECT * FROM task_reviews WHERE review_id = ?")
      .get(reviewId);
    if (row === undefined) {
      throw new NotFoundError(`review ${reviewId} was not found`);
    }
    return row;
  }

  #requireCurrentSubmission(taskId: string): Row {
    const row = this.#database
      .prepare(
        "SELECT * FROM task_submissions WHERE task_id = ? ORDER BY submission_number DESC LIMIT 1",
      )
      .get(taskId);
    if (row === undefined) {
      throw new ConflictError(
        `Task ${taskId} has no frozen submission evidence`,
      );
    }
    return row;
  }

  #submissionFromRow(row: Row): TaskSubmission {
    const artifacts = this.#database
      .prepare(
        `SELECT * FROM task_submission_artifacts
         WHERE submission_id = ? ORDER BY ordinal`,
      )
      .all(text(row, "submission_id"))
      .map((artifact) => ({
        attachmentId: text(artifact, "attachment_id"),
        filename: text(artifact, "filename"),
        mimeType: text(artifact, "mime_type"),
        ordinal: integer(artifact, "ordinal"),
        producerId: text(artifact, "producer_id"),
        runAttemptId: text(artifact, "run_attempt_id"),
        sha256: text(artifact, "sha256"),
        size: integer(artifact, "size"),
        taskId: text(artifact, "task_id"),
      }));
    const evidenceJson = row.evidence_json;
    const evidence =
      typeof evidenceJson === "string"
        ? (JSON.parse(evidenceJson) as unknown)
        : undefined;
    return TaskSubmissionSchema.parse({
      artifacts,
      createdAt: text(row, "created_at"),
      ...(evidence === undefined ? {} : { evidence }),
      messageId: text(row, "message_id"),
      producerId: text(row, "producer_id"),
      roomId: text(row, "room_id"),
      submissionDigest: text(row, "submission_digest"),
      submissionId: text(row, "submission_id"),
      submissionNumber: integer(row, "submission_number"),
      summary: text(row, "summary"),
      taskId: text(row, "task_id"),
    });
  }

  #reviewFromRow(row: Row): TaskReview {
    return TaskReviewSchema.parse({
      createdAt: text(row, "created_at"),
      disposition: text(row, "disposition"),
      messageId: text(row, "message_id"),
      reviewId: text(row, "review_id"),
      reviewerId: text(row, "reviewer_id"),
      roomId: text(row, "room_id"),
      submissionDigest: text(row, "submission_digest"),
      submissionId: text(row, "submission_id"),
      summary: text(row, "summary"),
      taskId: text(row, "task_id"),
    });
  }

  #transaction<T>(operation: () => T): T {
    if (this.#database.isTransaction) return operation();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec("ROLLBACK");
      throw error;
    }
  }
}
