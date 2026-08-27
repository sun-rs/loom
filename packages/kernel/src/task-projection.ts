import type { DatabaseSync } from "node:sqlite";

import { TaskSchema, type Task } from "@rah-os/protocol";

import { nullableText, text, type Row } from "./sqlite-row.ts";

export function taskDependenciesComplete(
  database: DatabaseSync,
  taskId: string,
): boolean {
  return (
    database
      .prepare(
        `SELECT 1
         FROM task_dependencies
         JOIN tasks AS dependency
           ON dependency.task_id = task_dependencies.dependency_task_id
         WHERE task_dependencies.task_id = ?
           AND dependency.state <> 'completed'
         LIMIT 1`,
      )
      .get(taskId) === undefined
  );
}

export function taskProjectionFromRow(database: DatabaseSync, row: Row): Task {
  const taskId = text(row, "task_id");
  const assigneeId = nullableText(row, "assignee_id");
  const description = nullableText(row, "description");
  const claimedBy = nullableText(row, "claimed_by");
  const claimUntil = nullableText(row, "claim_until");
  const lastProgress = nullableText(row, "last_progress");
  const submissionSummary = nullableText(row, "submission_summary");
  const submittedAt = nullableText(row, "submitted_at");
  const completedAt = nullableText(row, "completed_at");
  const blockedReason = nullableText(row, "blocked_reason");
  const blockedAt = nullableText(row, "blocked_at");
  const cancellationReason = nullableText(row, "cancellation_reason");
  const cancelledAt = nullableText(row, "cancelled_at");
  const dependencyTaskIds = database
    .prepare(
      "SELECT dependency_task_id FROM task_dependencies WHERE task_id = ? ORDER BY dependency_task_id",
    )
    .all(taskId)
    .map((dependency) => text(dependency, "dependency_task_id"));
  return TaskSchema.parse({
    taskId,
    roomId: text(row, "room_id"),
    creatorId: text(row, "creator_id"),
    ...(assigneeId === null ? {} : { assigneeId }),
    title: text(row, "title"),
    ...(description === null ? {} : { description }),
    dependencyTaskIds,
    state: text(row, "state"),
    ...(claimedBy === null ? {} : { claimedBy }),
    ...(claimUntil === null ? {} : { claimUntil }),
    ...(lastProgress === null ? {} : { lastProgress }),
    ...(submissionSummary === null ? {} : { submissionSummary }),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
    ...(submittedAt === null ? {} : { submittedAt }),
    ...(completedAt === null ? {} : { completedAt }),
    ...(blockedReason === null ? {} : { blockedReason }),
    ...(blockedAt === null ? {} : { blockedAt }),
    ...(cancellationReason === null ? {} : { cancellationReason }),
    ...(cancelledAt === null ? {} : { cancelledAt }),
  });
}
