import type { DatabaseSync } from "node:sqlite";
import type {
  RoomTaskListItem,
  RoomTaskReviewStatus,
  RoomTaskSubmission,
} from "@rah/runtime-protocol";

import { roomError } from "./room-errors";
import { integer, text, type RoomSqlRow as Row } from "./room-rows";
import {
  roomTaskFromRow,
  roomTaskReviewStatusFromRow,
  roomTaskSubmissionFromRow,
} from "./room-task-rows";

export type RoomTaskPage = {
  items: RoomTaskListItem[];
  cursorBefore: number;
  throughTaskNumber: number;
  hasMore: boolean;
};

// Keep a Task page comfortably below the 1 MiB HTTP response ceiling before
// materialising bounded submission/review-status relations. Full Review prose
// remains canonical in the ledger and is deliberately not copied into a board
// page: 100 individually valid summaries can exceed the complete wire budget.
const TASK_PAGE_RELATION_BUDGET_BYTES = 768 * 1_024;

export class RoomTaskReadService {
  constructor(
    private readonly options: {
      database: DatabaseSync;
      requireMembership: (roomId: string, actorId: string) => unknown;
    },
  ) {}

  listPage(
    actorId: string,
    roomId: string,
    options: {
      beforeTaskNumber?: number;
      throughTaskNumber?: number;
      limit?: number;
    } = {},
  ): RoomTaskPage {
    this.options.requireMembership(roomId, actorId);
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw roomError(
        "invalid_argument",
        "Task page limit must be between 1 and 100",
      );
    }
    const throughTaskNumber =
      options.throughTaskNumber ??
      integer(
        this.options.database
          .prepare(
            "SELECT COALESCE(MAX(task_number), 0) AS latest FROM room_tasks WHERE room_id = ?",
          )
          .get(roomId) as Row,
        "latest",
      );
    const beforeTaskNumber = options.beforeTaskNumber ?? throughTaskNumber + 1;
    if (
      !Number.isSafeInteger(beforeTaskNumber) ||
      !Number.isSafeInteger(throughTaskNumber) ||
      beforeTaskNumber < 1 ||
      throughTaskNumber < 0 ||
      beforeTaskNumber > throughTaskNumber + 1
    ) {
      throw roomError("invalid_argument", "Task page window is invalid");
    }
    const candidateRows = this.options.database
      .prepare(
        `SELECT * FROM room_tasks
       WHERE room_id = ? AND task_number < ? AND task_number <= ?
       ORDER BY task_number DESC LIMIT ?`,
      )
      .all(roomId, beforeTaskNumber, throughTaskNumber, limit) as Row[];
    const candidateTaskIds = candidateRows.map((row) => text(row, "task_id"));
    const relationBytes = new Map<string, number>();
    if (candidateTaskIds.length > 0) {
      const placeholders = candidateTaskIds.map(() => "?").join(",");
      for (const row of this.options.database
        .prepare(
          `SELECT task_id, SUM(LENGTH(CAST(participant_id AS BLOB)) + 24) AS payload_bytes
           FROM room_task_reviewers WHERE task_id IN (${placeholders}) GROUP BY task_id`,
        )
        .all(...candidateTaskIds) as Row[]) {
        relationBytes.set(
          text(row, "task_id"),
          (relationBytes.get(text(row, "task_id")) ?? 0) +
            integer(row, "payload_bytes"),
        );
      }
      for (const row of this.options.database
        .prepare(
          `SELECT task_id, SUM(LENGTH(CAST(dependency_task_id AS BLOB)) + 24) AS payload_bytes
           FROM room_task_dependencies WHERE task_id IN (${placeholders}) GROUP BY task_id`,
        )
        .all(...candidateTaskIds) as Row[]) {
        relationBytes.set(
          text(row, "task_id"),
          (relationBytes.get(text(row, "task_id")) ?? 0) +
            integer(row, "payload_bytes"),
        );
      }
      for (const row of this.options.database
        .prepare(
          `SELECT submission.task_id,
             LENGTH(CAST(submission.summary AS BLOB)) +
             LENGTH(CAST(submission.evidence_json AS BLOB)) + 768 +
             COALESCE(SUM(
               LENGTH(CAST(review.review_id AS BLOB)) +
               LENGTH(CAST(review.reviewer_id AS BLOB)) +
               LENGTH(CAST(review.message_id AS BLOB)) + 384
             ), 0) AS payload_bytes
           FROM room_task_submissions AS submission
           JOIN (
             SELECT task_id, MAX(submission_number) AS submission_number
             FROM room_task_submissions WHERE task_id IN (${placeholders}) GROUP BY task_id
           ) AS latest ON latest.task_id = submission.task_id
             AND latest.submission_number = submission.submission_number
           LEFT JOIN room_task_reviews AS review ON review.submission_id = submission.submission_id
           GROUP BY submission.task_id`,
        )
        .all(...candidateTaskIds) as Row[]) {
        relationBytes.set(
          text(row, "task_id"),
          (relationBytes.get(text(row, "task_id")) ?? 0) +
            integer(row, "payload_bytes"),
        );
      }
    }
    const rows: Row[] = [];
    let estimatedBytes = 0;
    for (const row of candidateRows) {
      const taskId = text(row, "task_id");
      const baseBytes = Object.values(row).reduce<number>(
        (total, value) =>
          total +
          (typeof value === "string" ? Buffer.byteLength(value, "utf8") : 16),
        1_024,
      );
      const nextBytes = baseBytes + (relationBytes.get(taskId) ?? 0);
      if (
        rows.length > 0 &&
        estimatedBytes + nextBytes > TASK_PAGE_RELATION_BUDGET_BYTES
      )
        break;
      rows.push(row);
      estimatedBytes += nextBytes;
    }
    rows.reverse();
    const taskIds = rows.map((row) => text(row, "task_id"));
    const reviewerIds = new Map<string, string[]>();
    const dependencyIds = new Map<string, string[]>();
    const currentSubmissions = new Map<string, RoomTaskSubmission>();
    const currentReviewStatuses = new Map<string, RoomTaskReviewStatus[]>();
    if (taskIds.length > 0) {
      const placeholders = taskIds.map(() => "?").join(",");
      const reviewerRows = this.options.database
        .prepare(
          `SELECT task_id, participant_id FROM room_task_reviewers
         WHERE task_id IN (${placeholders}) ORDER BY task_id, participant_id`,
        )
        .all(...taskIds) as Row[];
      for (const row of reviewerRows) {
        const taskId = text(row, "task_id");
        reviewerIds.set(taskId, [
          ...(reviewerIds.get(taskId) ?? []),
          text(row, "participant_id"),
        ]);
      }
      const dependencyRows = this.options.database
        .prepare(
          `SELECT task_id, dependency_task_id FROM room_task_dependencies
         WHERE task_id IN (${placeholders}) ORDER BY task_id, dependency_task_id`,
        )
        .all(...taskIds) as Row[];
      for (const row of dependencyRows) {
        const taskId = text(row, "task_id");
        dependencyIds.set(taskId, [
          ...(dependencyIds.get(taskId) ?? []),
          text(row, "dependency_task_id"),
        ]);
      }
      const evidenceTaskIds = rows
        .filter((row) => {
          const state = text(row, "state");
          return state === "submitted" || state === "completed";
        })
        .map((row) => text(row, "task_id"));
      const submissionRows =
        evidenceTaskIds.length === 0
          ? []
          : (this.options.database
              .prepare(
                `SELECT submission.* FROM room_task_submissions AS submission
         JOIN (
           SELECT task_id, MAX(submission_number) AS submission_number
           FROM room_task_submissions WHERE task_id IN (${evidenceTaskIds.map(() => "?").join(",")}) GROUP BY task_id
         ) AS latest ON latest.task_id = submission.task_id
           AND latest.submission_number = submission.submission_number
         ORDER BY submission.task_id`,
              )
              .all(...evidenceTaskIds) as Row[]);
      for (const row of submissionRows) {
        const submission = roomTaskSubmissionFromRow(row);
        currentSubmissions.set(submission.taskId, submission);
      }
      const submissionIds = submissionRows.map((row) =>
        text(row, "submission_id"),
      );
      if (submissionIds.length > 0) {
        const placeholders = submissionIds.map(() => "?").join(",");
        const reviewRows = this.options.database
          .prepare(
            `SELECT review_id, task_id, room_id, submission_id,
              submission_digest, reviewer_id, disposition, message_id, created_at
             FROM room_task_reviews WHERE submission_id IN (${placeholders})
           ORDER BY task_id, reviewer_id`,
          )
          .all(...submissionIds) as Row[];
        for (const row of reviewRows) {
          const review = roomTaskReviewStatusFromRow(row);
          currentReviewStatuses.set(review.taskId, [
            ...(currentReviewStatuses.get(review.taskId) ?? []),
            review,
          ]);
        }
      }
    }
    const items = rows.map((row) => {
      const taskId = text(row, "task_id");
      const submission = currentSubmissions.get(taskId);
      return {
        ...roomTaskFromRow(
          row,
          reviewerIds.get(taskId) ?? [],
          dependencyIds.get(taskId) ?? [],
        ),
        ...(submission ? { currentSubmission: submission } : {}),
        ...(submission
          ? {
              currentReviewStatuses:
                currentReviewStatuses.get(taskId) ?? [],
            }
          : {}),
      };
    });
    const cursorBefore = items[0]?.taskNumber ?? beforeTaskNumber;
    const hasMore = Boolean(
      this.options.database
        .prepare(
          `SELECT 1 FROM room_tasks
       WHERE room_id = ? AND task_number < ? AND task_number <= ? LIMIT 1`,
        )
        .get(roomId, cursorBefore, throughTaskNumber),
    );
    return { items, cursorBefore, throughTaskNumber, hasMore };
  }
}
