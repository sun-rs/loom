import type {
  MessageReferenceReadState,
  MessageReferenceReadStateRecord,
  RoomEvent,
} from "@rah-os/protocol";

export type MessageReferenceReadStateIndex = ReadonlyMap<
  string,
  Readonly<Record<string, MessageReferenceReadState>>
>;

/** Project a bounded canonical API result into the renderer's O(1) lookup. */
export function messageReferenceReadStateRecordsIndex(
  records: readonly MessageReferenceReadStateRecord[],
): MessageReferenceReadStateIndex {
  const mutable = new Map<string, Record<string, MessageReferenceReadState>>();
  for (const record of records) {
    const states = mutable.get(record.messageId) ?? {};
    states[record.principalId] = record.readState;
    mutable.set(record.messageId, states);
  }
  return mutable;
}

function stringField(value: unknown, name: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field = (value as Record<string, unknown>)[name];
  return typeof field === "string" ? field : undefined;
}

function numberField(value: unknown, name: string): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field = (value as Record<string, unknown>)[name];
  return typeof field === "number" && Number.isInteger(field)
    ? field
    : undefined;
}

/**
 * Presentation of the canonical Inbox receipt. Absence of a message.posted
 * recipient record means no dot; body text and Agent presence never imply read.
 */
export function messageMentionReadStates(
  messageId: string,
  events: readonly RoomEvent[],
): Readonly<Record<string, MessageReferenceReadState>> {
  return messageMentionReadStateIndex(events).get(messageId) ?? {};
}

/** Build once per complete canonical replay, then project each Message in O(1). */
export function messageMentionReadStateIndex(
  events: readonly RoomEvent[],
): MessageReferenceReadStateIndex {
  const acknowledgedThrough = new Map<string, number>();
  for (const event of events) {
    if (event.type !== "inbox.acknowledged") continue;
    const participantId = stringField(event.payload, "participantId");
    const throughSeq = numberField(event.payload, "throughSeq");
    if (participantId === undefined || throughSeq === undefined) continue;
    acknowledgedThrough.set(
      participantId,
      Math.max(acknowledgedThrough.get(participantId) ?? 0, throughSeq),
    );
  }
  const result = new Map<
    string,
    Readonly<Record<string, MessageReferenceReadState>>
  >();
  for (const event of events) {
    if (
      event.type !== "message.posted" ||
      !Array.isArray(event.payload.recipients)
    )
      continue;
    const messageId =
      stringField(event.payload, "messageId") ?? event.aggregateId;
    const participantIds = event.payload.recipients.flatMap((recipient) =>
      stringField(recipient, "participantId") !== undefined &&
      stringField(recipient, "reason") === "mention"
        ? [stringField(recipient, "participantId")!]
        : [],
    );
    if (participantIds.length === 0) continue;
    result.set(
      messageId,
      Object.fromEntries(
        [...new Set(participantIds)].map((participantId) => [
          participantId,
          (acknowledgedThrough.get(participantId) ?? 0) >= event.roomSeq
            ? "read"
            : "unread",
        ]),
      ),
    );
  }
  return result;
}
