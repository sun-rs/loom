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
    // Raft Computer 1.0.18 main.js:17204-17218: all guidance fields are optional.
    attention: z
      .object({
        state: z.string().max(2048).optional(),
        ordinaryActivity: z.string().max(2048).optional(),
        unmuteCommand: z.string().max(2048).optional(),
        unmuteApi: z.string().max(2048).optional(),
        muteCommand: z.string().max(2048).optional(),
        muteApi: z.string().max(2048).optional(),
        stillArrives: z.array(z.string().max(2048)).max(16).optional(),
        threadBoundary: z.string().max(2048).optional(),
        catchUp: z.string().max(2048).optional(),
      })
      .strict()
      .optional(),
    deduplicated: z.boolean(),
    event: RoomEventSchema,
  }).strict();
export type WorkerChannelAttentionResponse = z.infer<
  typeof WorkerChannelAttentionResponseSchema
>;
