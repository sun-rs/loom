import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";
import { RoomEventSchema } from "./room-event.ts";
import { TaskSchema } from "./task.ts";

export const TaskReassignmentOperationStateSchema = z.enum([
  "requested",
  "cancellation_requested",
  "runtime_terminal_proven",
  "task_reopened_unassigned",
  "assigned",
  "failed_closed",
]);
export type TaskReassignmentOperationState = z.infer<
  typeof TaskReassignmentOperationStateSchema
>;

export const TaskReassignmentOperationSchema = z
  .object({
    cancellationRequestId: IdentifierSchema.optional(),
    completedAt: TimestampSchema.optional(),
    createdAt: TimestampSchema,
    nextAssigneeId: IdentifierSchema,
    operationId: IdentifierSchema,
    previousAssigneeId: IdentifierSchema,
    reason: z.string().trim().min(1),
    requestedBy: IdentifierSchema,
    roomId: IdentifierSchema,
    state: TaskReassignmentOperationStateSchema,
    taskId: IdentifierSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export type TaskReassignmentOperation = z.infer<
  typeof TaskReassignmentOperationSchema
>;

export const ClientTaskReassignRequestSchema = z
  .object({
    assigneeId: IdentifierSchema,
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    reason: z.string().trim().min(1).max(2_000),
    taskId: IdentifierSchema,
  })
  .strict();
export type ClientTaskReassignRequest = z.infer<
  typeof ClientTaskReassignRequestSchema
>;

export const ClientTaskReassignmentResponseSchema = z
  .object({
    activationIds: z.array(IdentifierSchema),
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    operation: TaskReassignmentOperationSchema,
    task: TaskSchema,
  })
  .strict();
export type ClientTaskReassignmentResponse = z.infer<
  typeof ClientTaskReassignmentResponseSchema
>;
