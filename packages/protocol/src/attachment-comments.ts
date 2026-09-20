import { MessageMentionBindingSchema } from "./collaboration.ts";
import { z } from "zod";
import { IdentifierSchema } from "./common.ts";
// Raft 1.0.18 preserves an extensible type/data anchor, including lines,
// csv-rows, md-section, html-region and video-timestamp from Web 1.12.0.
export const AttachmentCommentAnchorSchema = z
  .object({
    type: z.string().trim().min(1).max(100),
    data: z.record(z.string(), z.unknown()),
  })
  .strict()
  .refine(
    (value) => JSON.stringify(value).length <= 16384,
    "anchor exceeds the bounded metadata budget",
  );
export const AttachmentCommentsRequestSchema = z
  .object({
    attachmentId: IdentifierSchema,
    limit: z.number().int().min(1).max(100).default(50),
    beforeRoomSeq: z.number().int().positive().optional(),
  })
  .strict();
export type AttachmentCommentsRequest = z.input<
  typeof AttachmentCommentsRequestSchema
>;
export const AttachmentCommentPostRequestSchema = z
  .object({
    attachmentId: IdentifierSchema,
    body: z.string().trim().min(1).max(10000),
    anchor: AttachmentCommentAnchorSchema.nullable().optional(),
    recipientIds: z.array(IdentifierSchema).max(100).default([]),
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
  })
  .strict();
export type AttachmentCommentPostRequest = z.input<
  typeof AttachmentCommentPostRequestSchema
>;
export const AttachmentCommentsResponseSchema = z
  .object({
    roomId: IdentifierSchema,
    messageId: IdentifierSchema,
    comments: z
      .array(
        z
          .object({
            id: IdentifierSchema,
            roomId: IdentifierSchema,
            roomSeq: z.number().int().positive(),
            senderId: IdentifierSchema,
            senderType: z.enum(["human", "agent"]),
            senderName: z.string(),
            reactions: z.array(
              z
                .object({
                  emoji: z.string(),
                  reactorId: IdentifierSchema,
                  reactorType: z.enum(["human", "agent"]),
                  createdAt: z.string(),
                })
                .strict(),
            ),
            content: z.string(),
            mentions: z.array(MessageMentionBindingSchema).optional(),
            createdAt: z.string(),
            anchor: AttachmentCommentAnchorSchema.nullable(),
          })
          .strict(),
      )
      .max(100),
    threadId: IdentifierSchema.optional(),
    threadRootMessageId: IdentifierSchema.optional(),
    nextBeforeRoomSeq: z.number().int().positive().optional(),
    viewer: z.object({ canComment: z.boolean() }).strict(),
  })
  .strict();
export type AttachmentCommentsResponse = z.infer<
  typeof AttachmentCommentsResponseSchema
>;
