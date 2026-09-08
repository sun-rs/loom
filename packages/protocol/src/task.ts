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

/**
 * The five user-facing workflow states published by Raft. These answer where a
 * Task is in its business lifecycle; ownership leases, Runtime progress and
 * attention reasons are deliberately projected separately below.
 */
export const TaskWorkflowStatusSchema = z.enum([
  "todo",
  "in_progress",
  "in_review",
  "done",
  "closed",
]);
export type TaskWorkflowStatus = z.infer<typeof TaskWorkflowStatusSchema>;

const TASK_WORKFLOW_TRANSITIONS = Object.freeze({
  todo: Object.freeze(["in_progress", "closed"]),
  in_progress: Object.freeze(["in_review", "done", "closed"]),
  in_review: Object.freeze(["done", "in_progress", "closed"]),
  done: Object.freeze(["todo", "in_progress", "in_review", "closed"]),
  closed: Object.freeze(["todo", "in_progress"]),
} as const satisfies Readonly<
  Record<TaskWorkflowStatus, readonly TaskWorkflowStatus[]>
>);

const ALL_TASK_WORKFLOW_STATUSES = Object.freeze([
  "todo",
  "in_progress",
  "in_review",
  "done",
  "closed",
] as const satisfies readonly TaskWorkflowStatus[]);

/** Exact Raft Itt/Att menu order. Managers receive all five states; ordinary
 * editors receive the current state followed by the published transition graph. */
export function taskWorkflowTransitionOptions(
  status: TaskWorkflowStatus,
  canManageAnyTask: boolean,
): readonly TaskWorkflowStatus[] {
  return canManageAnyTask
    ? ALL_TASK_WORKFLOW_STATUSES
    : Object.freeze([status, ...TASK_WORKFLOW_TRANSITIONS[status]]);
}

export const TaskExecutionPhaseSchema = z.enum([
  "idle",
  "claimed",
  "running",
  "cancelling",
]);
export type TaskExecutionPhase = z.infer<typeof TaskExecutionPhaseSchema>;

export const TaskAttentionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("waiting_input") }).strict(),
  z
    .object({
      kind: z.literal("blocked"),
      reason: z.string().trim().min(1),
    })
    .strict(),
]);
export type TaskAttention = z.infer<typeof TaskAttentionSchema>;

export const TaskLifecycleProjectionSchema = z
  .object({
    workflowStatus: TaskWorkflowStatusSchema,
    executionPhase: TaskExecutionPhaseSchema,
    attention: TaskAttentionSchema.optional(),
  })
  .strict();
export type TaskLifecycleProjection = z.infer<
  typeof TaskLifecycleProjectionSchema
>;

export const TaskSchema = z
  .object({
    taskId: IdentifierSchema,
    roomId: IdentifierSchema,
    creatorId: IdentifierSchema,
    assigneeId: IdentifierSchema.optional(),
    collaboratorIds: z.array(IdentifierSchema).default([]),
    title: z.string().trim().min(1),
    description: z.string().optional(),
    dependencyTaskIds: z.array(IdentifierSchema).default([]),
    sourceMessageId: IdentifierSchema,
    state: TaskStateSchema,
    workflowStatus: TaskWorkflowStatusSchema.optional(),
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
      task.workflowStatus !== undefined &&
      task.workflowStatus !== taskWorkflowStatus(task.state)
    ) {
      context.addIssue({
        code: "custom",
        message: "workflowStatus must match canonical Task state",
        path: ["workflowStatus"],
      });
    }
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

/** Canonical projection from durable Task.state into Raft's five UI columns.
 * `workflowStatus` remains on the wire for compatibility, but never overrides
 * the business lifecycle owner. A pending cancellation is supplied by the
 * cancellation-request owner because it is not inferred from Task.state alone.
 */
export function taskWorkflowStatus(
  source:
    | TaskState
    | { state: TaskState; workflowStatus?: TaskWorkflowStatus | undefined },
): TaskWorkflowStatus {
  const state = typeof source === "string" ? source : source.state;
  switch (state) {
    case "todo":
      return "todo";
    case "submitted":
      return "in_review";
    case "completed":
      return "done";
    case "cancelled":
      return "closed";
    case "claimed":
    case "in_progress":
    case "waiting_input":
    case "blocked":
      return "in_progress";
  }
}

export function projectTaskLifecycle(
  task: Pick<Task, "blockedReason" | "state" | "workflowStatus">,
  options: { cancellationPending?: boolean } = {},
): TaskLifecycleProjection {
  const workflowStatus = taskWorkflowStatus(task);
  const executionPhase: TaskExecutionPhase = options.cancellationPending
    ? "cancelling"
    : task.state === "claimed"
      ? "claimed"
      : task.state === "in_progress"
        ? "running"
        : "idle";
  if (task.state === "waiting_input") {
    return {
      workflowStatus,
      executionPhase,
      attention: { kind: "waiting_input" },
    };
  }
  if (task.state === "blocked") {
    if (task.blockedReason === undefined) {
      throw new Error("blocked Task projection requires blockedReason");
    }
    return {
      workflowStatus,
      executionPhase,
      attention: { kind: "blocked", reason: task.blockedReason },
    };
  }
  return { workflowStatus, executionPhase };
}

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
