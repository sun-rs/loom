import { z } from "zod";

import { IdentifierSchema } from "./common.ts";
import { WorkerTaskCausalityShape } from "./worker-task-causality.ts";

export const WorkerTaskCreateRequestSchema = z
  .object({
    ...WorkerTaskCausalityShape,
    title: z.string().trim().min(1),
    assigneeId: IdentifierSchema.optional(),
  })
  .strict();
export type WorkerTaskCreateRequest = z.infer<
  typeof WorkerTaskCreateRequestSchema
>;
