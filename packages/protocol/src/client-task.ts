import { z } from "zod";

import { IdentifierSchema } from "./common.ts";
import { TaskSchema, TaskWorkflowStatusSchema } from "./task.ts";

export const ClientTasksListRequestSchema = z
  .object({
    beforeTaskNumber: z.number().int().positive().optional(),
    limit: z.number().int().positive().max(500).optional(),
    roomId: IdentifierSchema,
  })
  .strict();
export type ClientTasksListRequest = z.infer<
  typeof ClientTasksListRequestSchema
>;

export const ClientTasksListResponseSchema = z
  .object({ tasks: z.array(TaskSchema) })
  .strict();
export type ClientTasksListResponse = z.infer<
  typeof ClientTasksListResponseSchema
>;

export const ClientTaskReopenRequestSchema = z
  .object({
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    taskId: IdentifierSchema,
  })
  .strict();
export type ClientTaskReopenRequest = z.infer<
  typeof ClientTaskReopenRequestSchema
>;

export const ClientTaskWorkflowUpdateRequestSchema = z
  .object({
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    taskId: IdentifierSchema,
    workflowStatus: TaskWorkflowStatusSchema,
  })
  .strict();
export type ClientTaskWorkflowUpdateRequest = z.infer<
  typeof ClientTaskWorkflowUpdateRequestSchema
>;
