import { WorkerReadChannelSchema } from "./worker-room-targets.ts";
import { TimestampSchema, IdentifierSchema } from "./common.ts";
import { z } from "zod";
import { MessageSchema } from "./collaboration.ts";
import { MessageReactionRequestSchema } from "./message-social.ts";
export const WorkerMessageSearchRequestSchema = z
  .object({
    query: z.string().trim().max(500).optional(),
    channel: WorkerReadChannelSchema.optional(),
    sender: IdentifierSchema.optional(),
    senderId: IdentifierSchema.optional(),
    after: TimestampSchema.optional(),
    before: TimestampSchema.optional(),
    sort: z.enum(["relevance", "recent"]).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z
      .string()
      .max(64 * 1024)
      .optional(),
  })
  .strict()
  .refine(
    (input) =>
      Boolean(
        input.query ||
        input.channel ||
        input.sender ||
        input.senderId ||
        input.before ||
        input.after,
      ),
    {
      message:
        "query is required unless a target, sender or time filter is provided",
    },
  )
  .refine((input) => Boolean(input.query) || input.sort !== "relevance", {
    message: "relevance requires a text query",
  });
export type WorkerMessageSearchRequest = z.input<
  typeof WorkerMessageSearchRequestSchema
>;
export const WorkerMessageSearchResponseSchema = z
  .object({
    messages: z.array(MessageSchema).max(100),
    frozenThroughRoomSeq: z.number().int().nonnegative().optional(),
    frozenRoomCount: z.number().int().min(0).max(500).optional(),
    nextCursor: z
      .string()
      .max(64 * 1024)
      .optional(),
  })
  .strict();
export type WorkerMessageSearchResponse = z.infer<
  typeof WorkerMessageSearchResponseSchema
>;
/**
 * Raft's `raft message react --message-id ID --emoji EMOJI [--remove]`: the
 * model names the message, the emoji and whether it is adding or removing, and
 * nothing else. `active` therefore defaults to the add side of Raft's toggle,
 * and both causal parameters are optional and derived server-side. An
 * explicitly presented cursor or key stays valid and stays fenced.
 */
export const WorkerMessageReactionRequestSchema =
  MessageReactionRequestSchema.omit({
    roomId: true,
    active: true,
    basedOnRoomSeq: true,
    idempotencyKey: true,
  }).extend({
    active: z.boolean().default(true),
    basedOnRoomSeq: z.number().int().nonnegative().optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  });
export type WorkerMessageReactionRequest = z.infer<
  typeof WorkerMessageReactionRequestSchema
>;
/** The Agent-facing form, before the server fills in what Raft never asks for. */
export type WorkerMessageReactionCommand = z.input<
  typeof WorkerMessageReactionRequestSchema
>;
