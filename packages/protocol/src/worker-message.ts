import { WorkerReadChannelSchema } from "./worker-room-targets.ts";
import { WorkerTargetReceiptSchema } from "./worker-room-targets.ts";
import { z } from "zod";

import { IdentifierSchema } from "./common.ts";
import { RoomEventSchema } from "./room-event.ts";

export const WorkerMessagePostRequestSchema = z
  .object({
    channel: WorkerReadChannelSchema.optional(),
    contextReceipt: WorkerTargetReceiptSchema.optional(),
    anyway: z.boolean().optional(),
    attachmentIds: z.array(IdentifierSchema).max(10).optional(),
    commentAttachmentId: IdentifierSchema.optional(),
    basedOnRoomSeq: z.number().int().nonnegative(),
    body: z.string().trim().min(1).optional(),
    heldDraftId: IdentifierSchema.optional(),
    idempotencyKey: IdentifierSchema,
    sendDraft: z.literal(true).optional(),
    threadId: IdentifierSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.channel === undefined) !== (value.contextReceipt === undefined))
      context.addIssue({
        code: "custom",
        message: "channel and contextReceipt must be supplied together",
      });
    if (value.sendDraft === true) {
      if (value.heldDraftId === undefined) {
        context.addIssue({
          code: "custom",
          message: "heldDraftId is required when sendDraft is true",
          path: ["heldDraftId"],
        });
      }
      if (
        value.body !== undefined ||
        value.attachmentIds !== undefined ||
        value.commentAttachmentId !== undefined
      ) {
        context.addIssue({
          code: "custom",
          message:
            "body and attachmentIds must be omitted when sendDraft is true",
          path: ["body"],
        });
      }
      return;
    }
    if (value.body === undefined && !value.attachmentIds?.length) {
      context.addIssue({
        code: "custom",
        message: "body or attachmentIds is required for a composed message",
        path: ["body"],
      });
    }
    if (value.heldDraftId !== undefined || value.anyway !== undefined) {
      context.addIssue({
        code: "custom",
        message: "heldDraftId and anyway require sendDraft",
        path: [value.heldDraftId === undefined ? "anyway" : "heldDraftId"],
      });
    }
  });
export type WorkerMessagePostRequest = z.infer<
  typeof WorkerMessagePostRequestSchema
>;

export const WorkerMessageMutationResponseSchema = z
  .object({
    activationIds: z.array(IdentifierSchema),
    deduplicated: z.boolean(),
    event: RoomEventSchema,
  })
  .strict();
export type WorkerMessageMutationResponse = z.infer<
  typeof WorkerMessageMutationResponseSchema
>;

export const WorkerMessageHeldResponseSchema = z
  .object({
    activationIds: z.array(IdentifierSchema),
    basedOnRoomSeq: z.number().int().nonnegative(),
    heldDraftId: IdentifierSchema,
    newMessageCount: z.number().int().positive(),
    newerMessages: z.array(RoomEventSchema),
    omittedMessageCount: z.number().int().nonnegative(),
    reason: z.literal("newer_messages_available"),
    reholdCount: z.number().int().positive(),
    continueAnywaySuggested: z.boolean(),
    seenUpToSeq: z.number().int().positive(),
    state: z.literal("held"),
  })
  .strict();
export type WorkerMessageHeldResponse = z.infer<
  typeof WorkerMessageHeldResponseSchema
>;

export const WorkerMessagePostResponseSchema = z.union([
  WorkerMessageMutationResponseSchema,
  WorkerMessageHeldResponseSchema,
]);
export type WorkerMessagePostResponse = z.infer<
  typeof WorkerMessagePostResponseSchema
>;
