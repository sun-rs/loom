import type { RoomEvent, RoomMessage, RoomMutationResult } from "./room";
import type { RoomHostObservedSubmissionEvidence } from "./room-activation";
import { assertRoomTextStorageSafe } from "./room";

export type RoomTaskState =
  | "todo"
  | "claimed"
  | "in_progress"
  | "waiting_input"
  | "blocked"
  | "submitted"
  | "completed"
  | "cancelled";

export type RoomTaskWorkflowStatus =
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "closed";

export interface RoomTask {
  taskId: string;
  roomId: string;
  taskNumber: number;
  sourceMessageId: string;
  threadId: string;
  creatorId: string;
  assigneeId: string;
  reviewerIds: string[];
  dependencyTaskIds: string[];
  title: string;
  description?: string;
  state: RoomTaskState;
  claimedBy?: string;
  claimUntil?: string;
  submissionSummary?: string;
  submittedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  currentSubmission?: RoomTaskSubmission;
  currentReviews?: RoomTaskReview[];
  createdAt: string;
  updatedAt: string;
}

export interface RoomTaskSubmission {
  submissionId: string;
  submissionNumber: number;
  submissionDigest: string;
  taskId: string;
  roomId: string;
  producerId: string;
  messageId: string;
  summary: string;
  evidence: RoomHostObservedSubmissionEvidence;
  evidenceDigest: string;
  createdAt: string;
}

export type RoomTaskReviewDisposition = "approved" | "changes_requested";

export interface RoomTaskReview {
  reviewId: string;
  taskId: string;
  roomId: string;
  submissionId: string;
  submissionDigest: string;
  reviewerId: string;
  disposition: RoomTaskReviewDisposition;
  summary: string;
  messageId: string;
  createdAt: string;
}

/**
 * Bounded review state embedded in Task list projections.
 *
 * Review prose remains canonical and immutable in the ledger, but it is not
 * duplicated into every board page. A single valid Task may have 100 Reviews;
 * embedding every 8 KiB summary would make that Task impossible to read under
 * the one MiB Application Port limit.
 */
export interface RoomTaskReviewStatus {
  reviewId: string;
  taskId: string;
  roomId: string;
  submissionId: string;
  submissionDigest: string;
  reviewerId: string;
  disposition: RoomTaskReviewDisposition;
  messageId: string;
  createdAt: string;
}

export interface RoomTaskListItem extends Omit<RoomTask, "currentReviews"> {
  currentReviewStatuses?: RoomTaskReviewStatus[];
}

export interface RoomTaskMutationResult extends RoomMutationResult<RoomTask> {}

export interface RoomTaskSubmissionMutationResult extends RoomTaskMutationResult {
  message: RoomMessage;
  submission: RoomTaskSubmission;
}

export interface RoomTaskReviewMutationResult extends RoomTaskMutationResult {
  message: RoomMessage;
  review: RoomTaskReview;
  submission: RoomTaskSubmission;
}

export function roomTaskWorkflowStatus(state: RoomTaskState): RoomTaskWorkflowStatus {
  switch (state) {
    case "todo": return "todo";
    case "claimed":
    case "in_progress":
    case "waiting_input":
    case "blocked": return "in_progress";
    case "submitted": return "in_review";
    case "completed": return "done";
    case "cancelled": return "closed";
  }
}

const TASK_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TASK_STATES = new Set<RoomTaskState>([
  "todo", "claimed", "in_progress", "waiting_input", "blocked", "submitted",
  "completed", "cancelled",
]);

function taskIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !TASK_IDENTIFIER.test(value)) {
    throw new Error(`${field} must be a stable identifier`);
  }
}

function taskTimestamp(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be a timestamp`);
  }
}

export function validateRoomTask(value: unknown): RoomTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("RoomTask must be an object");
  }
  const task = value as Record<string, unknown>;
  const fields = new Set([
    "taskId", "roomId", "taskNumber", "sourceMessageId", "threadId", "creatorId",
    "assigneeId", "reviewerIds", "dependencyTaskIds", "title", "description", "state",
    "claimedBy", "claimUntil", "submissionSummary", "submittedAt", "completedAt",
    "cancelledAt", "cancellationReason", "createdAt", "updatedAt",
    "currentSubmission", "currentReviews",
  ]);
  const unknown = Object.keys(task).find((field) => !fields.has(field));
  if (unknown) throw new Error(`RoomTask contains unknown field ${unknown}`);
  for (const field of ["taskId", "roomId", "sourceMessageId", "threadId", "creatorId"] as const) {
    taskIdentifier(task[field], `RoomTask.${field}`);
  }
  if (!Number.isSafeInteger(task.taskNumber) || Number(task.taskNumber) < 1) {
    throw new Error("RoomTask.taskNumber must be positive");
  }
  taskIdentifier(task.assigneeId, "RoomTask.assigneeId");
  if (task.claimedBy !== undefined) taskIdentifier(task.claimedBy, "RoomTask.claimedBy");
  for (const field of ["reviewerIds", "dependencyTaskIds"] as const) {
    if (!Array.isArray(task[field]) || task[field].length > 100) {
      throw new Error(`RoomTask.${field} is invalid`);
    }
    for (const id of task[field]) taskIdentifier(id, `RoomTask.${field}[]`);
    if (new Set(task[field]).size !== task[field].length) {
      throw new Error(`RoomTask.${field} must not contain duplicates`);
    }
  }
  const reviewerIds = task.reviewerIds as string[];
  if (reviewerIds.length === 0) {
    throw new Error("RoomTask.reviewerIds must contain at least one reviewer");
  }
  if (reviewerIds.includes(task.assigneeId as string)) {
    throw new Error("RoomTask assignee cannot also be a reviewer");
  }
  if (typeof task.title !== "string" || !task.title || task.title.length > 240) {
    throw new Error("RoomTask.title is invalid");
  }
  assertRoomTextStorageSafe(task.title, "RoomTask.title");
  for (const field of ["description", "submissionSummary", "cancellationReason"] as const) {
    if (task[field] !== undefined) {
      if (typeof task[field] !== "string" || task[field].length > 8_192) {
        throw new Error(`RoomTask.${field} is invalid`);
      }
      assertRoomTextStorageSafe(task[field], `RoomTask.${field}`);
    }
  }
  if (!TASK_STATES.has(task.state as RoomTaskState)) throw new Error("RoomTask.state is invalid");
  for (const field of ["claimUntil", "submittedAt", "completedAt", "cancelledAt", "createdAt", "updatedAt"] as const) {
    if (task[field] !== undefined) taskTimestamp(task[field], `RoomTask.${field}`);
  }
  if (!task.createdAt || !task.updatedAt || (task.state === "completed") !== Boolean(task.completedAt)) {
    throw new Error("RoomTask lifecycle timestamps are inconsistent");
  }
  const active = new Set(["claimed", "in_progress", "waiting_input", "blocked"]).has(
    task.state as string,
  );
  if (active !== Boolean(task.claimedBy) || active !== Boolean(task.claimUntil)) {
    throw new Error("RoomTask claim state is inconsistent");
  }
  if (task.claimedBy !== undefined && task.claimedBy !== task.assigneeId) {
    throw new Error("RoomTask claim owner must be the assignee");
  }
  const submitted = task.submissionSummary !== undefined || task.submittedAt !== undefined;
  if ((task.submissionSummary !== undefined) !== (task.submittedAt !== undefined)) {
    throw new Error("RoomTask submission evidence is incomplete");
  }
  if ((task.state === "submitted" || task.state === "completed") && !submitted) {
    throw new Error("RoomTask submitted state requires submission evidence");
  }
  if (task.state !== "submitted" && task.state !== "completed" && task.state !== "cancelled" && submitted) {
    throw new Error("RoomTask non-submitted state cannot retain submission evidence");
  }
  const cancelled = task.state === "cancelled";
  if (cancelled !== Boolean(task.cancelledAt) || cancelled !== Boolean(task.cancellationReason)) {
    throw new Error("RoomTask cancellation state is inconsistent");
  }
  const currentSubmission = task.currentSubmission === undefined
    ? undefined
    : validateRoomTaskSubmission(task.currentSubmission);
  if (task.currentReviews !== undefined && !Array.isArray(task.currentReviews)) {
    throw new Error("RoomTask.currentReviews must be an array");
  }
  const currentReviews = (task.currentReviews ?? []).map(validateRoomTaskReview);
  if ((task.state === "submitted" || task.state === "completed") && !currentSubmission) {
    throw new Error("RoomTask submitted state requires the current frozen delivery");
  }
  if (currentReviews.length > 0 && !currentSubmission) {
    throw new Error("RoomTask reviews require a current frozen delivery");
  }
  if (currentSubmission && (
    currentSubmission.taskId !== task.taskId || currentSubmission.roomId !== task.roomId
  )) {
    throw new Error("RoomTask current submission target is inconsistent");
  }
  if (currentReviews.some((review) =>
    review.taskId !== task.taskId || review.roomId !== task.roomId ||
    review.submissionId !== currentSubmission?.submissionId ||
    review.submissionDigest !== currentSubmission?.submissionDigest)) {
    throw new Error("RoomTask current review target is inconsistent");
  }
  if (new Set(currentReviews.map((review) => review.reviewerId)).size !== currentReviews.length) {
    throw new Error("RoomTask current reviews contain duplicate reviewers");
  }
  return task as unknown as RoomTask;
}

export function validateRoomTaskListItem(value: unknown): RoomTaskListItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("RoomTaskListItem must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (Object.hasOwn(raw, "currentReviews")) {
    throw new Error("RoomTaskListItem must not embed full Review summaries");
  }
  const { currentReviewStatuses: rawStatuses, ...rawTask } = raw;
  const task = validateRoomTask(rawTask);
  if (rawStatuses !== undefined && !Array.isArray(rawStatuses)) {
    throw new Error("RoomTaskListItem.currentReviewStatuses must be an array");
  }
  const statuses = (rawStatuses ?? []).map(validateRoomTaskReviewStatus);
  if (statuses.length > 100) {
    throw new Error("RoomTaskListItem.currentReviewStatuses is invalid");
  }
  if (statuses.length > 0 && !task.currentSubmission) {
    throw new Error("RoomTaskListItem review states require a frozen delivery");
  }
  if (
    statuses.some(
      (review) =>
        review.taskId !== task.taskId ||
        review.roomId !== task.roomId ||
        review.submissionId !== task.currentSubmission?.submissionId ||
        review.submissionDigest !== task.currentSubmission?.submissionDigest,
    )
  ) {
    throw new Error("RoomTaskListItem review state target is inconsistent");
  }
  if (new Set(statuses.map((review) => review.reviewerId)).size !== statuses.length) {
    throw new Error("RoomTaskListItem review states contain duplicate reviewers");
  }
  return {
    ...task,
    ...(statuses.length > 0 ? { currentReviewStatuses: statuses } : {}),
  };
}

function validateDigest(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${field} must be a SHA-256 digest`);
  }
}

function validateRoomTaskSubmission(value: unknown): RoomTaskSubmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("RoomTask.currentSubmission must be an object");
  }
  const submission = value as Record<string, unknown>;
  const fields = new Set([
    "submissionId", "submissionNumber", "submissionDigest", "taskId", "roomId",
    "producerId", "messageId", "summary", "evidence", "evidenceDigest", "createdAt",
  ]);
  const unknown = Object.keys(submission).find((field) => !fields.has(field));
  if (unknown) throw new Error(`RoomTask.currentSubmission contains unknown field ${unknown}`);
  for (const field of ["submissionId", "taskId", "roomId", "producerId", "messageId"] as const) {
    taskIdentifier(submission[field], `RoomTask.currentSubmission.${field}`);
  }
  if (!Number.isSafeInteger(submission.submissionNumber) || Number(submission.submissionNumber) < 1) {
    throw new Error("RoomTask.currentSubmission.submissionNumber is invalid");
  }
  validateDigest(submission.submissionDigest, "RoomTask.currentSubmission.submissionDigest");
  validateDigest(submission.evidenceDigest, "RoomTask.currentSubmission.evidenceDigest");
  if (typeof submission.summary !== "string" || !submission.summary || submission.summary.length > 8_192) {
    throw new Error("RoomTask.currentSubmission.summary is invalid");
  }
  assertRoomTextStorageSafe(submission.summary, "RoomTask.currentSubmission.summary");
  taskTimestamp(submission.createdAt, "RoomTask.currentSubmission.createdAt");
  validateHostEvidence(submission.evidence);
  return submission as unknown as RoomTaskSubmission;
}

function validateHostEvidence(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("RoomTask submission evidence must be an object");
  }
  const evidence = value as Record<string, unknown>;
  const fields = [
    "schemaVersion", "workspaceRoot", "baseRevision", "headRevision", "patchDigest",
    "verificationDigest", "observedAt",
  ];
  if (Object.keys(evidence).some((field) => !fields.includes(field)) || evidence.schemaVersion !== 1) {
    throw new Error("RoomTask submission evidence schema is invalid");
  }
  for (const field of ["workspaceRoot", "baseRevision", "headRevision"] as const) {
    if (typeof evidence[field] !== "string" || !evidence[field] || evidence[field].length > 4_096) {
      throw new Error(`RoomTask submission evidence ${field} is invalid`);
    }
  }
  validateDigest(evidence.patchDigest, "RoomTask submission evidence patchDigest");
  validateDigest(evidence.verificationDigest, "RoomTask submission evidence verificationDigest");
  taskTimestamp(evidence.observedAt, "RoomTask submission evidence observedAt");
}

function validateRoomTaskReview(value: unknown): RoomTaskReview {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("RoomTask.currentReviews[] must be an object");
  }
  const review = value as Record<string, unknown>;
  const fields = new Set([
    "reviewId", "taskId", "roomId", "submissionId", "submissionDigest", "reviewerId",
    "disposition", "summary", "messageId", "createdAt",
  ]);
  const unknown = Object.keys(review).find((field) => !fields.has(field));
  if (unknown) throw new Error(`RoomTask.currentReviews[] contains unknown field ${unknown}`);
  for (const field of ["reviewId", "taskId", "roomId", "submissionId", "reviewerId", "messageId"] as const) {
    taskIdentifier(review[field], `RoomTask.currentReviews[].${field}`);
  }
  validateDigest(review.submissionDigest, "RoomTask.currentReviews[].submissionDigest");
  if (review.disposition !== "approved" && review.disposition !== "changes_requested") {
    throw new Error("RoomTask.currentReviews[].disposition is invalid");
  }
  if (typeof review.summary !== "string" || !review.summary || review.summary.length > 8_192) {
    throw new Error("RoomTask.currentReviews[].summary is invalid");
  }
  assertRoomTextStorageSafe(review.summary, "RoomTask.currentReviews[].summary");
  taskTimestamp(review.createdAt, "RoomTask.currentReviews[].createdAt");
  return review as unknown as RoomTaskReview;
}

function validateRoomTaskReviewStatus(value: unknown): RoomTaskReviewStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("RoomTaskListItem.currentReviewStatuses[] must be an object");
  }
  const review = value as Record<string, unknown>;
  const fields = new Set([
    "reviewId",
    "taskId",
    "roomId",
    "submissionId",
    "submissionDigest",
    "reviewerId",
    "disposition",
    "messageId",
    "createdAt",
  ]);
  const unknown = Object.keys(review).find((field) => !fields.has(field));
  if (unknown) {
    throw new Error(
      `RoomTaskListItem.currentReviewStatuses[] contains unknown field ${unknown}`,
    );
  }
  for (const field of [
    "reviewId",
    "taskId",
    "roomId",
    "submissionId",
    "reviewerId",
    "messageId",
  ] as const) {
    taskIdentifier(
      review[field],
      `RoomTaskListItem.currentReviewStatuses[].${field}`,
    );
  }
  validateDigest(
    review.submissionDigest,
    "RoomTaskListItem.currentReviewStatuses[].submissionDigest",
  );
  if (
    review.disposition !== "approved" &&
    review.disposition !== "changes_requested"
  ) {
    throw new Error(
      "RoomTaskListItem.currentReviewStatuses[].disposition is invalid",
    );
  }
  taskTimestamp(
    review.createdAt,
    "RoomTaskListItem.currentReviewStatuses[].createdAt",
  );
  return review as unknown as RoomTaskReviewStatus;
}

export type RoomTaskCommandEvent = RoomEvent;
