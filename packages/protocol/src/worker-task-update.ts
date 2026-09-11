import { z } from "zod";
import { IdentifierSchema } from "./common.ts";
import { TaskWorkflowStatusSchema } from "./task.ts";
import { WorkerTaskCausalityShape } from "./worker-task-causality.ts";
/** Raft SEA 1.0.18 main.js:16596, 730404-730474: one status setter.
 * Optional summary is RAH's explicit submission evidence input, never fabricated.
 * Address aliases are resolved by the application service before this schema. */
export const WorkerTaskUpdateRequestSchema = z
  .object({
    taskId: IdentifierSchema,
    status: TaskWorkflowStatusSchema,
    summary: z.string().trim().min(1).optional(),
    ...WorkerTaskCausalityShape,
  })
  .strict();
export type WorkerTaskUpdateRequest = z.infer<
  typeof WorkerTaskUpdateRequestSchema
>;
