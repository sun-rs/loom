import { z } from "zod";
import { IdentifierSchema } from "./common.ts";
import { RoomSchema } from "./collaboration.ts";
import { AgentChannelAttentionSchema } from "./worker-channel-attention.ts";

// Raft 1.0.18 channel/DM/Thread references select readable targets, never actors.
export {
  WorkerTargetReceiptSchema,
  WorkerReadChannelSchema,
} from "./worker-target-reference.ts";
import { WorkerReadChannelSchema } from "./worker-target-reference.ts";
export const WorkerRoomListRequestSchema = z
  .object({
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type WorkerRoomListRequest = z.input<typeof WorkerRoomListRequestSchema>;
export const WorkerRoomResolveRequestSchema = z
  .object({ channel: WorkerReadChannelSchema })
  .strict();
export type WorkerRoomResolveRequest = z.infer<
  typeof WorkerRoomResolveRequestSchema
>;
export const WorkerRoomEntrySchema = z
  .object({
    room: RoomSchema,
    channel: WorkerReadChannelSchema,
    attention: AgentChannelAttentionSchema,
  })
  .strict();
export const WorkerRoomListResponseSchema = z
  .object({
    rooms: z.array(WorkerRoomEntrySchema).max(100),
    projection: z.literal("current"),
    nextCursor: z.string().optional(),
  })
  .strict();
export type WorkerRoomListResponse = z.infer<
  typeof WorkerRoomListResponseSchema
>;
export const WorkerRoomResolveResponseSchema = WorkerRoomEntrySchema.extend({
  threadId: IdentifierSchema.optional(),
  observedRoomSeq: z.number().int().nonnegative(),
}).strict();
export type WorkerRoomResolveResponse = z.infer<
  typeof WorkerRoomResolveResponseSchema
>;

/**
 * Raft addresses a Task the way a Human reads it: `--target "#channel"` plus a
 * per-channel Task number (`agentApiTaskClaimBodySchema = { channel,
 * task_numbers }`, `agentApiTaskUnclaimBodySchema = { channel, task_number }`).
 * RAH accepts that pair on every Task-family command that takes a Task and
 * resolves it to the canonical Task id server-side.
 */
export const WorkerTaskNumberSchema = z.number().int().positive();
export const WorkerTaskAddressSchema = z
  .object({
    channel: WorkerReadChannelSchema,
    taskNumber: WorkerTaskNumberSchema,
  })
  .strict();
export type WorkerTaskAddress = z.infer<typeof WorkerTaskAddressSchema>;
