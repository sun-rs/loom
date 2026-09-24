import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";
import { RoomEventSchema } from "./room-event.ts";
import { WorkerAddressingSchema } from "./worker-addressing.ts";

/**
 * PRESENT-ONLY body fetch for the wake input. It takes no range: the range is
 * the Activation's own `[from_seq, to_seq]` intersected with the credential's
 * frozen head, resolved server-side. Nothing in this request can influence
 * which sequences are rendered, the page bound, or the digest.
 *
 * It is not a delivery: it registers no delivered cursor, advances no
 * subscription cursor and no read position, and appends no Room event. The
 * record it writes only becomes usable for an implicit acknowledgement after
 * the Host registers the send under the Host credential.
 */
export const WorkerMessagePresentRequestSchema = z.object({}).strict();
export type WorkerMessagePresentRequest = z.infer<
  typeof WorkerMessagePresentRequestSchema
>;

export const WorkerMessagePresentResponseSchema = z
  .object({
    fromSeq: z.number().int().positive(),
    toSeq: z.number().int().positive(),
    /** Server-computed over the rendered events; never accepted from a client. */
    contentDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    /** Every Room event whose content was rendered, any type, in seq order. */
    events: z.array(RoomEventSchema).max(20),
    /**
     * Every sequence the rendering covers: the rendered events plus the
     * execution-audit events `message-check` also omits. Bounded by the
     * Kernel's scan cap.
     */
    presentedSeqs: z.array(z.number().int().positive()).max(256),
    /** Canonical `#room` / `@handle` names, as `message-check` renders them. */
    addressing: WorkerAddressingSchema.optional(),
    /**
     * The sequence through which this rendering is continuous evidence. A
     * causal marker or freshness floor may be built on this number and on no
     * larger one. Zero when the first event in the range already degraded.
     */
    presentedThroughSeq: z.number().int().nonnegative(),
    /**
     * The unrendered tail as a bounded summary. Enumerating it would make the
     * response size track the ledger, so the range is stated, not listed;
     * everything in it stays unacknowledged and needs `message-check`.
     */
    noticeCount: z.number().int().nonnegative(),
    noticeFromSeq: z.number().int().positive().optional(),
    noticeToSeq: z.number().int().positive().optional(),
    renderedAt: TimestampSchema,
    sentAt: TimestampSchema.optional(),
    /**
     * Present only on a retry whose previous RunAttempt ended with neither a
     * committed post nor a delivery confirmation (`delivery_not_proven`).
     * Read from the Activation's durable retry record; never client-supplied.
     */
    previousAttemptUnconfirmed: z.literal(true).optional(),
    /**
     * Present only on a retry whose previous RunAttempt committed a post in
     * this Room for this Activation yet ended without acknowledging delivery:
     * that post's message id, a neutral fact (it may be progress or one
     * target's answer). Kernel-derived; never client-supplied.
     */
    previousAttemptReplyMessageId: IdentifierSchema.optional(),
    /**
     * Present only beside `previousAttemptReplyMessageId` when that post
     * carries this Activation's final-reply marker. Kernel-derived.
     */
    previousAttemptReplyFinal: z.literal(true).optional(),
  })
  .strict()
  .refine((value) => value.toSeq >= value.fromSeq, {
    message: "presented range is inverted",
  })
  .refine(
    (value) => {
      const covered = new Set(value.presentedSeqs);
      return (
        value.events.every((event) => covered.has(event.roomSeq)) &&
        value.presentedSeqs.every(
          (seq, index) => index === 0 || seq > value.presentedSeqs[index - 1]!,
        )
      );
    },
    { message: "presented events and presented sequences must agree" },
  )
  .refine(
    (value) =>
      value.presentedThroughSeq === 0 ||
      value.presentedSeqs.includes(value.presentedThroughSeq) ||
      value.presentedThroughSeq === value.toSeq,
    { message: "the presented prefix head must be a presented sequence" },
  );
export type WorkerMessagePresentResponse = z.infer<
  typeof WorkerMessagePresentResponseSchema
>;
