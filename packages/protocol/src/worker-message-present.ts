import { z } from "zod";

import { TimestampSchema } from "./common.ts";
import { RoomEventSchema } from "./room-event.ts";

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
    presentedSeqs: z.array(z.number().int().positive()).max(20),
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
  })
  .strict()
  .refine((value) => value.toSeq >= value.fromSeq, {
    message: "presented range is inverted",
  })
  .refine(
    (value) =>
      value.events.length === value.presentedSeqs.length &&
      value.events.every(
        (event, index) => event.roomSeq === value.presentedSeqs[index],
      ),
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
