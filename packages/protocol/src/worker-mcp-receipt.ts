import { WorkerMessageMutationResponseSchema } from "./worker-message.ts";

/** Model-visible projection after full response validation. The durable event and
 * delivery effects stay with the service; this receipt is never an ACK or a
 * Task/Activation completion claim. Retain exceptional outcomes for recovery. */
export function workerMcpPublishedReceipt(input: unknown) {
  const value = WorkerMessageMutationResponseSchema.parse(input);
  const event = value.event;
  if (event.type !== "message.posted" || event.aggregateType !== "message")
    throw new Error("Expected a published message result");
  return {
    state: "published" as const,
    messageId: event.aggregateId,
    roomSeq: event.roomSeq,
    ...(value.deduplicated ? { deduplicated: true } : {}),
    ...(value.replacedDraft === undefined
      ? {}
      : { replacedDraft: value.replacedDraft }),
    ...(!value.unresolvedMentionHandles?.length
      ? {}
      : { unresolvedMentionHandles: value.unresolvedMentionHandles }),
  };
}
