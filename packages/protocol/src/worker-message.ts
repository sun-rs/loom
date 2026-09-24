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
    basedOnRoomSeq: z.number().int().nonnegative().optional(),
    body: z.string().trim().min(1).optional(),
    /**
     * The post completes the reply to the delivered messages. It lets the
     * Host end the native turn once the post commits; it never acknowledges
     * delivery or changes a Task. Omitted on progress posts.
     */
    final: z.literal(true).optional(),
    heldDraftId: IdentifierSchema.optional(),
    idempotencyKey: IdentifierSchema.optional(),
    sendDraft: z.literal(true).optional(),
    threadId: IdentifierSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    // Raft's shape: a target and content. Everything else is server-derived.
    // A presented receipt still names the channel it was minted for.
    if (value.contextReceipt !== undefined && value.channel === undefined)
      context.addIssue({
        code: "custom",
        message: "contextReceipt requires the channel it was minted for",
        path: ["channel"],
      });
    if (value.sendDraft === true) {
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

/**
 * Raft's `formatDraftReplacedWarning` input: one draft is kept per target, so a
 * compose that replaces a live saved draft must say what it discarded. The
 * server is the only party that knows the previous body, so the send response
 * carries it and the CLI renders the warning.
 */
export const WorkerReplacedDraftSchema = z
  .object({ body: z.string().min(1) })
  .strict();

export const WorkerMessageMutationResponseSchema = z
  .object({
    activationIds: z.array(IdentifierSchema),
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    replacedDraft: WorkerReplacedDraftSchema.optional(),
    /**
     * The `@tokens` the author wrote that woke nobody. Raft carries the same
     * field on its send response and then raises MENTION_DELIVERY_FAILED while
     * the message stays queued; omitted when every token resolved.
     */
    unresolvedMentionHandles: z.array(z.string().min(1)).optional(),
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
    recoveryTarget: WorkerReadChannelSchema.optional(),
    newMessageCount: z.number().int().positive(),
    newerMessages: z.array(RoomEventSchema),
    omittedMessageCount: z.number().int().nonnegative(),
    reason: z.literal("newer_messages_available"),
    replacedDraft: WorkerReplacedDraftSchema.optional(),
    reholdCount: z.number().int().positive(),
    shownMessageCount: z.number().int().nonnegative(),
    continueAnywaySuggested: z.boolean(),
    seenUpToSeq: z.number().int().positive(),
    state: z.literal("held"),
  })
  .strict();
export type WorkerMessageHeldResponse = z.infer<
  typeof WorkerMessageHeldResponseSchema
>;

/**
 * Raft's `THREAD_CONTEXT_TARGET_CONFIRMATION_REQUIRED`. The send was refused,
 * not held for freshness: the participant's latest read context under this Room
 * is a Thread, yet the send targets the Room top-level. The composed content is
 * saved as a draft so the confirmation path is the ordinary `--send-draft`.
 */
export const WorkerMessageTargetConfirmationResponseSchema = z
  .object({
    activationIds: z.array(IdentifierSchema),
    heldDraftId: IdentifierSchema,
    parentTarget: WorkerReadChannelSchema,
    threadTarget: WorkerReadChannelSchema,
    threadSeq: z.number().int().positive(),
    reason: z.literal("thread_context_target_mismatch"),
    state: z.literal("target_confirmation_required"),
  })
  .strict();
export type WorkerMessageTargetConfirmationResponse = z.infer<
  typeof WorkerMessageTargetConfirmationResponseSchema
>;

export const WorkerMessagePostResponseSchema = z.union([
  WorkerMessageMutationResponseSchema,
  WorkerMessageHeldResponseSchema,
  WorkerMessageTargetConfirmationResponseSchema,
]);
export type WorkerMessagePostResponse = z.infer<
  typeof WorkerMessagePostResponseSchema
>;
