import { z } from "zod";
import { IdentifierSchema } from "./common.ts";
import {
  WorkerReadChannelSchema,
  WorkerTargetReceiptSchema,
} from "./worker-target-reference.ts";
import { RoomEventSchema } from "./room-event.ts";
/**
 * Raft's `raft channel mute|unmute --target '#channel'` carries the target and
 * nothing else. RAH accepts that form: the causal cursor and the idempotency
 * key are derived server-side, and a target may now be named without also
 * presenting a receipt. A presented receipt still requires its channel and is
 * still verified.
 */
export const WorkerChannelAttentionRequestSchema = z
  .object({
    channel: WorkerReadChannelSchema.optional(),
    contextReceipt: WorkerTargetReceiptSchema.optional(),
    basedOnRoomSeq: z.number().int().nonnegative().optional(),
    idempotencyKey: IdentifierSchema.optional(),
  })
  .strict()
  .refine(
    (v) => v.contextReceipt === undefined || v.channel !== undefined,
    "contextReceipt requires the channel it was issued for",
  );
export type WorkerChannelAttentionRequest = z.infer<
  typeof WorkerChannelAttentionRequestSchema
>;
export const AgentChannelAttentionSchema = z
  .object({
    activityMuted: z.boolean(),
    muteFromSeq: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type AgentChannelAttention = z.infer<typeof AgentChannelAttentionSchema>;
export const WorkerChannelAttentionResponseSchema =
  AgentChannelAttentionSchema.extend({
    roomId: IdentifierSchema,
    deduplicated: z.boolean(),
    event: RoomEventSchema,
  }).strict();
export type WorkerChannelAttentionResponse = z.infer<
  typeof WorkerChannelAttentionResponseSchema
>;
