import { z } from "zod";

import { IdentifierSchema } from "./common.ts";
import { RuntimeTrajectoryRecordSchema } from "./runtime-activity.ts";

/** Any current Room Agent may read bounded Task-linked Run diagnostics.
 * Runs can contain unrelated work; this response does not establish per-tool
 * Task ownership and is never canonical completion evidence. */
export const WorkerTaskTrajectoryRequestSchema = z
  .object({
    taskId: IdentifierSchema,
    limit: z.number().int().min(1).max(200).default(50),
    beforeSequence: z.number().int().positive().optional(),
  })
  .strict();
export type WorkerTaskTrajectoryRequest = z.infer<
  typeof WorkerTaskTrajectoryRequestSchema
>;

export const WorkerTaskTrajectoryResponseSchema = z
  .object({
    taskId: IdentifierSchema,
    ownerParticipantId: IdentifierSchema,
    scope: z.literal("task_linked_run_diagnostics"),
    entries: z.array(RuntimeTrajectoryRecordSchema).max(200),
    nextBeforeSequence: z.number().int().positive().optional(),
  })
  .strict();
export type WorkerTaskTrajectoryResponse = z.infer<
  typeof WorkerTaskTrajectoryResponseSchema
>;
