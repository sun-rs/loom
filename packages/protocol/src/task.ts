import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";

export const TaskStateSchema = z.enum([
  "todo",
  "claimed",
  "in_progress",
  "waiting_input",
  "blocked",
  "submitted",
  "completed",
  "cancelled",
]);
export type TaskState = z.infer<typeof TaskStateSchema>;

export const TaskSchema = z
  .object({
    taskId: IdentifierSchema,
    roomId: IdentifierSchema,
    creatorId: IdentifierSchema,
    assigneeId: IdentifierSchema.optional(),
    collaboratorIds: z.array(IdentifierSchema).default([]),
    title: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    dependencyTaskIds: z.array(IdentifierSchema).default([]),
    sourceMessageId: IdentifierSchema,
    state: TaskStateSchema,
    taskNumber: z.number().int().positive(),
    threadId: IdentifierSchema,
    claimedBy: IdentifierSchema.optional(),
    claimUntil: TimestampSchema.optional(),
    lastProgress: z.string().trim().min(1).optional(),
    submissionSummary: z.string().trim().min(1).optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    submittedAt: TimestampSchema.optional(),
    completedAt: TimestampSchema.optional(),
    blockedReason: z.string().trim().min(1).optional(),
    blockedAt: TimestampSchema.optional(),
    cancellationReason: z.string().trim().min(1).optional(),
    cancelledAt: TimestampSchema.optional(),
    reviewerIds: z.array(IdentifierSchema).default([]),
  })
  .strict()
  .superRefine((task, context) => {
    addTaskParticipantSelectionIssues(task, context);
    if (
      new Set(task.dependencyTaskIds).size !== task.dependencyTaskIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "dependencyTaskIds must be unique",
        path: ["dependencyTaskIds"],
      });
    }
    const requiresClaim =
      task.state === "claimed" || task.state === "in_progress";
    if (requiresClaim && task.claimedBy === undefined) {
      context.addIssue({
        code: "custom",
        message: `${task.state} tasks require claimedBy`,
        path: ["claimedBy"],
      });
    }
    if (requiresClaim && task.claimUntil === undefined) {
      context.addIssue({
        code: "custom",
        message: `${task.state} tasks require claimUntil`,
        path: ["claimUntil"],
      });
    }
    if (!requiresClaim && task.claimedBy !== undefined) {
      context.addIssue({
        code: "custom",
        message: `${task.state} tasks cannot retain claimedBy`,
        path: ["claimedBy"],
      });
    }
    if (!requiresClaim && task.claimUntil !== undefined) {
      context.addIssue({
        code: "custom",
        message: `${task.state} tasks cannot retain claimUntil`,
        path: ["claimUntil"],
      });
    }
    if (
      task.state !== "todo" &&
      task.state !== "cancelled" &&
      task.assigneeId === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: `${task.state} tasks require assigneeId`,
        path: ["assigneeId"],
      });
    }
    if (task.claimedBy !== undefined && task.claimedBy !== task.assigneeId) {
      context.addIssue({
        code: "custom",
        message: "claimedBy must match assigneeId",
        path: ["claimedBy"],
      });
    }
    if (
      (task.state === "submitted" || task.state === "completed") &&
      task.submissionSummary === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: `${task.state} tasks require submissionSummary`,
        path: ["submissionSummary"],
      });
    }
    if (
      (task.state === "submitted" || task.state === "completed") &&
      task.submittedAt === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: `${task.state} tasks require submittedAt`,
        path: ["submittedAt"],
      });
    }
    if (task.state === "completed" && task.completedAt === undefined) {
      context.addIssue({
        code: "custom",
        message: "completed tasks require completedAt",
        path: ["completedAt"],
      });
    }
    if (task.state !== "completed" && task.completedAt !== undefined) {
      context.addIssue({
        code: "custom",
        message: `${task.state} tasks cannot have completedAt`,
        path: ["completedAt"],
      });
    }
    if (
      task.state === "blocked" &&
      (task.blockedReason === undefined || task.blockedAt === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "blocked tasks require blockedReason and blockedAt",
        path: ["blockedReason"],
      });
    }
    if (
      task.state !== "blocked" &&
      (task.blockedReason !== undefined || task.blockedAt !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: `${task.state} tasks cannot retain blocked evidence`,
        path: ["blockedReason"],
      });
    }
    if (
      task.state === "cancelled" &&
      (task.cancellationReason === undefined || task.cancelledAt === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "cancelled tasks require cancellationReason and cancelledAt",
        path: ["cancellationReason"],
      });
    }
    if (
      task.state !== "cancelled" &&
      (task.cancellationReason !== undefined || task.cancelledAt !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: `${task.state} tasks cannot retain cancellation evidence`,
        path: ["cancellationReason"],
      });
    }
  });
export type Task = z.infer<typeof TaskSchema>;

export function addTaskParticipantSelectionIssues(
  selection: {
    assigneeId?: string | undefined;
    collaboratorIds: readonly string[];
    reviewerIds: readonly string[];
  },
  context: z.RefinementCtx,
): void {
  for (const field of ["collaboratorIds", "reviewerIds"] as const) {
    const participantIds = selection[field];
    if (new Set(participantIds).size !== participantIds.length) {
      context.addIssue({
        code: "custom",
        message: `${field} must be unique`,
        path: [field],
      });
    }
    if (
      selection.assigneeId !== undefined &&
      participantIds.includes(selection.assigneeId)
    ) {
      context.addIssue({
        code: "custom",
        message: `${field} cannot contain assigneeId`,
        path: [field],
      });
    }
  }
  if (
    selection.assigneeId === undefined &&
    (selection.collaboratorIds.length > 0 || selection.reviewerIds.length > 0)
  ) {
    context.addIssue({
      code: "custom",
      message: "collaborators and reviewers require one explicit assignee",
      path: ["assigneeId"],
    });
  }
}
