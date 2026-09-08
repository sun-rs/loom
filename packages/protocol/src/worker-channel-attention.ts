import { z } from "zod";
import { IdentifierSchema } from "./common.ts";
import {
  WorkerReadChannelSchema,
  WorkerTargetReceiptSchema,
} from "./worker-target-reference.ts";
import { RoomEventSchema } from "./room-event.ts";
export const WorkerChannelAttentionRequestSchema = z
  .object({
    channel: WorkerReadChannelSchema.optional(),
    contextReceipt: WorkerTargetReceiptSchema.optional(),
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
  })
  .strict()
  .refine(
    (v) => (v.channel === undefined) === (v.contextReceipt === undefined),
    "channel and contextReceipt must be supplied together",
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
