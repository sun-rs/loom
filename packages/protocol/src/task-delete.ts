import { z } from "zod";
import { IdentifierSchema } from "./common.ts";
import { RoomEventSchema } from "./room-event.ts";
import {
  ResolvedWorkerTaskCausalityShape,
  WorkerTaskCausalityShape,
} from "./worker-task-causality.ts";

const TaskDeleteFieldsShape = {
  roomId: IdentifierSchema,
  taskId: IdentifierSchema,
};
export const TaskDeleteRequestSchema = z
  .object({ ...TaskDeleteFieldsShape, ...ResolvedWorkerTaskCausalityShape })
  .strict();
export type TaskDeleteRequest = z.infer<typeof TaskDeleteRequestSchema>;
/** The Agent-facing form: Raft's `task delete` carries neither causal field. */
export const WorkerTaskDeleteRequestSchema = z
  .object({ ...TaskDeleteFieldsShape, ...WorkerTaskCausalityShape })
  .strict();
export type WorkerTaskDeleteRequest = z.infer<
  typeof WorkerTaskDeleteRequestSchema
>;
export const TaskDeleteResponseSchema = z
  .object({
    deleted: z.literal(true),
    deduplicated: z.boolean(),
    roomId: IdentifierSchema,
    taskId: IdentifierSchema,
    sourceMessageId: IdentifierSchema,
    threadId: IdentifierSchema,
    taskNumber: z.number().int().positive(),
    event: RoomEventSchema,
  })
  .strict();
export type TaskDeleteResponse = z.infer<typeof TaskDeleteResponseSchema>;
