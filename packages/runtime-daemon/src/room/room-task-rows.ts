import type {
  RoomHostObservedSubmissionEvidence,
  RoomTask,
  RoomTaskReview,
  RoomTaskReviewDisposition,
  RoomTaskReviewStatus,
  RoomTaskSubmission,
} from "@rah/runtime-protocol";

import { roomError } from "./room-errors";
import {
  integer,
  optionalText,
  text,
  type RoomSqlRow as Row,
} from "./room-rows";

export function roomTaskFromRow(
  row: Row,
  reviewerIds: string[],
  dependencyTaskIds: string[],
): RoomTask {
  const description = optionalText(row, "description");
  const claimedBy = optionalText(row, "claimed_by");
  const claimUntil = optionalText(row, "claim_until");
  const submissionSummary = optionalText(row, "submission_summary");
  const submittedAt = optionalText(row, "submitted_at");
  const completedAt = optionalText(row, "completed_at");
  const cancelledAt = optionalText(row, "cancelled_at");
  const cancellationReason = optionalText(row, "cancellation_reason");
  return {
    taskId: text(row, "task_id"),
    roomId: text(row, "room_id"),
    taskNumber: integer(row, "task_number"),
    sourceMessageId: text(row, "source_message_id"),
    threadId: text(row, "thread_id"),
    creatorId: text(row, "creator_id"),
    assigneeId: text(row, "assignee_id"),
    reviewerIds,
    dependencyTaskIds,
    title: text(row, "title"),
    ...(description ? { description } : {}),
    state: text(row, "state") as RoomTask["state"],
    ...(claimedBy ? { claimedBy } : {}),
    ...(claimUntil ? { claimUntil } : {}),
    ...(submissionSummary ? { submissionSummary } : {}),
    ...(submittedAt ? { submittedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(cancelledAt ? { cancelledAt } : {}),
    ...(cancellationReason ? { cancellationReason } : {}),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

export function roomTaskSubmissionFromRow(row: Row): RoomTaskSubmission {
  return {
    submissionId: text(row, "submission_id"),
    submissionNumber: integer(row, "submission_number"),
    submissionDigest: text(row, "submission_digest"),
    taskId: text(row, "task_id"),
    roomId: text(row, "room_id"),
    producerId: text(row, "producer_id"),
    messageId: text(row, "message_id"),
    summary: text(row, "summary"),
    evidence: JSON.parse(
      text(row, "evidence_json"),
    ) as RoomHostObservedSubmissionEvidence,
    evidenceDigest: text(row, "evidence_digest"),
    createdAt: text(row, "created_at"),
  };
}

export function roomTaskReviewFromRow(row: Row): RoomTaskReview {
  return {
    reviewId: text(row, "review_id"),
    taskId: text(row, "task_id"),
    roomId: text(row, "room_id"),
    submissionId: text(row, "submission_id"),
    submissionDigest: text(row, "submission_digest"),
    reviewerId: text(row, "reviewer_id"),
    disposition: text(row, "disposition") as RoomTaskReviewDisposition,
    summary: text(row, "summary"),
    messageId: text(row, "message_id"),
    createdAt: text(row, "created_at"),
  };
}

export function roomTaskReviewStatusFromRow(row: Row): RoomTaskReviewStatus {
  return {
    reviewId: text(row, "review_id"),
    taskId: text(row, "task_id"),
    roomId: text(row, "room_id"),
    submissionId: text(row, "submission_id"),
    submissionDigest: text(row, "submission_digest"),
    reviewerId: text(row, "reviewer_id"),
    disposition: text(row, "disposition") as RoomTaskReviewDisposition,
    messageId: text(row, "message_id"),
    createdAt: text(row, "created_at"),
  };
}

export function validateRoomHostEvidence(
  value: RoomHostObservedSubmissionEvidence | undefined,
): RoomHostObservedSubmissionEvidence {
  if (!value || value.schemaVersion !== 1) {
    throw roomError(
      "invalid_argument",
      "Task submission requires Host-observed evidence",
    );
  }
  const fields = new Set([
    "schemaVersion",
    "workspaceRoot",
    "baseRevision",
    "headRevision",
    "patchDigest",
    "verificationDigest",
    "observedAt",
  ]);
  const unknown = Object.keys(value).find((field) => !fields.has(field));
  if (unknown)
    throw roomError(
      "invalid_argument",
      `Host evidence contains unknown field ${unknown}`,
    );
  for (const [field, candidate] of [
    ["workspaceRoot", value.workspaceRoot],
    ["baseRevision", value.baseRevision],
    ["headRevision", value.headRevision],
  ] as const) {
    if (
      !candidate ||
      candidate.length > 4_096 ||
      candidate.includes("\u0000")
    ) {
      throw roomError("invalid_argument", `Host evidence ${field} is invalid`);
    }
  }
  for (const [field, digest] of [
    ["patchDigest", value.patchDigest],
    ["verificationDigest", value.verificationDigest],
  ] as const) {
    if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
      throw roomError("invalid_argument", `Host evidence ${field} is invalid`);
    }
  }
  if (Number.isNaN(Date.parse(value.observedAt))) {
    throw roomError("invalid_argument", "Host evidence observedAt is invalid");
  }
  return {
    schemaVersion: 1,
    workspaceRoot: value.workspaceRoot,
    baseRevision: value.baseRevision,
    headRevision: value.headRevision,
    patchDigest: value.patchDigest,
    verificationDigest: value.verificationDigest,
    observedAt: value.observedAt,
  };
}
