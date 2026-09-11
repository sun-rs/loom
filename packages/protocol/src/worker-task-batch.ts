import { z } from "zod";
import { IdentifierSchema } from "./common.ts";
import { WorkerTaskCausalityShape } from "./worker-task-causality.ts";
export const WORKER_TASK_BATCH_LIMIT = 100;
const Base = {
  channel: z.string().trim().min(1).max(512).optional(),
  ...WorkerTaskCausalityShape,
};
export const WorkerTaskBatchCreateRequestSchema = z
  .object({
    ...Base,
    titles: z
      .array(z.string().trim().min(1).max(2000))
      .min(1)
      .max(WORKER_TASK_BATCH_LIMIT),
    assignee: z.string().trim().min(1).max(512).optional(),
  })
  .strict();
export const WorkerTaskBatchClaimRequestSchema = z
  .object({
    ...Base,
    taskNumbers: z
      .array(z.number().int().positive())
      .max(WORKER_TASK_BATCH_LIMIT)
      .optional(),
    messageIds: z
      .array(IdentifierSchema)
      .max(WORKER_TASK_BATCH_LIMIT)
      .optional(),
    taskIds: z.array(IdentifierSchema).max(WORKER_TASK_BATCH_LIMIT).optional(),
  })
  .strict()
  .refine((v) => {
    const n =
      (v.taskNumbers?.length ?? 0) +
      (v.messageIds?.length ?? 0) +
      (v.taskIds?.length ?? 0);
    return n > 0 && n <= WORKER_TASK_BATCH_LIMIT;
  }, "Provide 1 to 100 Task selectors");
export type WorkerTaskBatchCreateRequest = z.infer<
  typeof WorkerTaskBatchCreateRequestSchema
>;
export type WorkerTaskBatchClaimRequest = z.infer<
  typeof WorkerTaskBatchClaimRequestSchema
>;
export const WorkerTaskBatchResultSchema = z
  .object({
    success: z.boolean(),
    taskId: IdentifierSchema.optional(),
    taskNumber: z.number().int().positive().optional(),
    messageId: IdentifierSchema.optional(),
    threadId: IdentifierSchema.optional(),
    reason: z.string().max(4000).optional(),
    deleted: z.boolean().optional(),
    assigneeId: IdentifierSchema.optional(),
    claimUntil: z.string().datetime().optional(),
    title: z.string().max(2000).optional(),
    state: z
      .enum([
        "todo",
        "claimed",
        "in_progress",
        "waiting_input",
        "blocked",
        "submitted",
        "completed",
        "cancelled",
      ])
      .optional(),
  })
  .strict();
export type WorkerTaskBatchResult = z.infer<typeof WorkerTaskBatchResultSchema>;
export const WorkerTaskBatchResponseSchema = z
  .object({
    roomId: IdentifierSchema,
    results: z.array(WorkerTaskBatchResultSchema).max(WORKER_TASK_BATCH_LIMIT),
    tasks: z.array(WorkerTaskBatchResultSchema).max(WORKER_TASK_BATCH_LIMIT),
    deduplicated: z.boolean(),
  })
  .strict();
export type WorkerTaskBatchResponse = z.infer<
  typeof WorkerTaskBatchResponseSchema
>;
