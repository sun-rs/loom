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
export const WorkerMessageReactionRequestSchema =
  MessageReactionRequestSchema.omit({ roomId: true });
export type WorkerMessageReactionRequest = z.infer<
  typeof WorkerMessageReactionRequestSchema
>;
