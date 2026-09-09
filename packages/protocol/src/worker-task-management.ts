import { z } from "zod";
import { IdentifierSchema } from "./common.ts";
import { WorkerTaskCausalityShape } from "./worker-task-causality.ts";
// Raft carries no client cursor and no mandatory key on a Task mutation.
const Mutation = WorkerTaskCausalityShape;
export const WorkerTaskAssignRequestSchema = z
  .object({
    ...Mutation,
    taskId: IdentifierSchema,
    assigneeId: IdentifierSchema.nullable(),
  })
  .strict();
export type WorkerTaskAssignRequest = z.infer<
  typeof WorkerTaskAssignRequestSchema
>;
export const WorkerTaskConvertRequestSchema = z
  .object({ ...Mutation, messageId: IdentifierSchema })
  .strict();
export type WorkerTaskConvertRequest = z.infer<
  typeof WorkerTaskConvertRequestSchema
>;

export const WorkerTaskUnblockRequestSchema = z
  .object({ ...Mutation, taskId: IdentifierSchema })
  .strict();
export type WorkerTaskUnblockRequest = z.infer<
  typeof WorkerTaskUnblockRequestSchema
>;
