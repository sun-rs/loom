import { z } from "zod";

import { IdentifierSchema } from "./common.ts";
import { RuntimeTrajectoryRecordSchema } from "./runtime-activity.ts";

/**
 * Supervision visibility: a reviewer named on a Task reads the owner's recorded
 * tool-call trajectory for that Task before recording a Review, so a
 * changes_requested can cite concrete command and file evidence.
 */
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
    entries: z.array(RuntimeTrajectoryRecordSchema).max(200),
    nextBeforeSequence: z.number().int().positive().optional(),
  })
  .strict();
export type WorkerTaskTrajectoryResponse = z.infer<
  typeof WorkerTaskTrajectoryResponseSchema
>;
