import { z } from "zod";
import { MessageSchema } from "./collaboration.ts";
import { MessageReactionRequestSchema } from "./message-social.ts";
export const WorkerMessageSearchRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().max(2048).optional(),
  })
  .strict();
export type WorkerMessageSearchRequest = z.input<
  typeof WorkerMessageSearchRequestSchema
>;
export const WorkerMessageSearchResponseSchema = z
  .object({
    messages: z.array(MessageSchema).max(100),
    nextCursor: z.string().optional(),
  })
  .strict();
export const WorkerMessageReactionRequestSchema =
  MessageReactionRequestSchema.omit({ roomId: true });
export type WorkerMessageReactionRequest = z.infer<
  typeof WorkerMessageReactionRequestSchema
>;
