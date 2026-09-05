import type { DatabaseSync } from "node:sqlite";

import { TaskSchema, type Task } from "@rah-os/protocol";

import { integer, nullableText, text, type Row } from "./sqlite-row.ts";

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
  const dependencyTaskIds = database
    .prepare(
      "SELECT dependency_task_id FROM task_dependencies WHERE task_id = ? ORDER BY dependency_task_id",
    )
    .all(taskId)
    .map((dependency) => text(dependency, "dependency_task_id"));
  const participants = database
    .prepare(
      "SELECT participant_id, role FROM task_participants WHERE task_id = ? ORDER BY participant_id, role",
    )
    .all(taskId);
  return taskProjectionFromRelations(row, dependencyTaskIds, participants);
}

function taskProjectionFromRelations(
  row: Row,
  dependencyTaskIds: string[],
  participants: Row[],
): Task {
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
  const collaboratorIds = participants
    .filter((participant) => text(participant, "role") === "collaborator")
    .map((participant) => text(participant, "participant_id"));
  const reviewerIds = participants
    .filter((participant) => text(participant, "role") === "reviewer")
    .map((participant) => text(participant, "participant_id"));
  return TaskSchema.parse({
    taskId: text(row, "task_id"),
    roomId: text(row, "room_id"),
    creatorId: text(row, "creator_id"),
    collaboratorIds,
    ...(assigneeId === null ? {} : { assigneeId }),
    sourceMessageId: text(row, "source_message_id"),
    taskNumber: integer(row, "task_number"),
    threadId: text(row, "thread_id"),
    title: text(row, "title"),
    ...(description === null ? {} : { description }),
    dependencyTaskIds,
    reviewerIds,
    state: text(row, "state"),
    workflowStatus: text(row, "workflow_status"),
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

export function listTaskProjections(
  database: DatabaseSync,
  roomId: string,
  options: { beforeTaskNumber?: number; limit?: number } = {},
): Task[] {
  const limit = options.limit ?? 200;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
    throw new Error("Task page limit must be between 1 and 500");
  }
  if (
    options.beforeTaskNumber !== undefined &&
    (!Number.isInteger(options.beforeTaskNumber) ||
      options.beforeTaskNumber <= 0)
  ) {
    throw new Error("beforeTaskNumber must be a positive integer");
  }
  const rows = database
    .prepare(
      `SELECT * FROM tasks
       WHERE room_id = ? AND (? IS NULL OR task_number < ?)
       ORDER BY task_number DESC LIMIT ?`,
    )
    .all(
      roomId,
      options.beforeTaskNumber ?? null,
      options.beforeTaskNumber ?? null,
      limit,
    )
    .reverse();
  if (rows.length === 0) return [];
  const taskIds = rows.map((row) => text(row, "task_id"));
  const placeholders = taskIds.map(() => "?").join(",");
  const dependenciesByTask = new Map<string, string[]>();
  for (const dependency of database
    .prepare(
      `SELECT task_id, dependency_task_id FROM task_dependencies
       WHERE task_id IN (${placeholders})
       ORDER BY task_id, dependency_task_id`,
    )
    .all(...taskIds)) {
    const taskId = text(dependency, "task_id");
    const dependencies = dependenciesByTask.get(taskId) ?? [];
    dependencies.push(text(dependency, "dependency_task_id"));
    dependenciesByTask.set(taskId, dependencies);
  }
  const participantsByTask = new Map<string, Row[]>();
  for (const participant of database
    .prepare(
      `SELECT task_id, participant_id, role FROM task_participants
       WHERE task_id IN (${placeholders})
       ORDER BY task_id, participant_id, role`,
    )
    .all(...taskIds)) {
    const taskId = text(participant, "task_id");
    const participants = participantsByTask.get(taskId) ?? [];
    participants.push(participant);
    participantsByTask.set(taskId, participants);
  }
  return rows.map((row) => {
    const taskId = text(row, "task_id");
    return taskProjectionFromRelations(
      row,
      dependenciesByTask.get(taskId) ?? [],
      participantsByTask.get(taskId) ?? [],
    );
  });
}
