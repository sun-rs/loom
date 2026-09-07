import { z } from "zod";

import { IdentifierSchema } from "./common.ts";
import {
  TaskSchema,
  TaskStateSchema,
  TaskWorkflowStatusSchema,
} from "./task.ts";

export const ClientTasksListRequestSchema = z
  .object({
    beforeTaskNumber: z.number().int().positive().optional(),
    limit: z.number().int().positive().max(500).optional(),
    roomId: IdentifierSchema,
    states: z.array(TaskStateSchema).min(1).max(8).optional(),
  })
  .strict()
  .refine(
    (request) =>
      request.states === undefined ||
      new Set(request.states).size === request.states.length,
    { message: "states must be unique", path: ["states"] },
  );
export type ClientTasksListRequest = z.infer<
  typeof ClientTasksListRequestSchema
>;

export const ClientTasksListResponseSchema = z
  .object({
    nextBeforeTaskNumber: z.number().int().positive().optional(),
    tasks: z.array(TaskSchema),
  })
  .strict();
export type ClientTasksListResponse = z.infer<
  typeof ClientTasksListResponseSchema
>;

export const ClientTaskGetRequestSchema = z
  .object({ roomId: IdentifierSchema, taskId: IdentifierSchema })
  .strict();
export type ClientTaskGetRequest = z.infer<typeof ClientTaskGetRequestSchema>;

export const ClientTaskGetResponseSchema = z
  .object({ task: TaskSchema })
  .strict();
export type ClientTaskGetResponse = z.infer<typeof ClientTaskGetResponseSchema>;

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
