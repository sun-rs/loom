import { WorkerMessageMutationResponseSchema } from "./worker-message.ts";

/** A transport receipt, never an ACK or a Task/Activation completion claim. */
export function workerMcpPublishedReceipt(input: unknown) {
  const value = WorkerMessageMutationResponseSchema.parse(input);
  const event = value.event;
  if (event.type !== "message.posted" || event.aggregateType !== "message")
    throw new Error("Expected a published message result");
  return {
    state: "published" as const,
    eventId: event.eventId,
    roomId: event.roomId,
    roomSeq: event.roomSeq,
    actorId: event.actorId,
    messageId: event.aggregateId,
    threadId:
      typeof event.payload.threadId === "string"
        ? event.payload.threadId
        : null,
    deduplicated: value.deduplicated,
    activationIds: value.activationIds,
    ...(value.replacedDraft === undefined
      ? {}
      : { replacedDraft: value.replacedDraft }),
    ...(value.unresolvedMentionHandles === undefined
      ? {}
      : { unresolvedMentionHandles: value.unresolvedMentionHandles }),
  };
}
