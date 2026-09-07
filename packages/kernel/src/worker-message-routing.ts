import type { DatabaseSync } from "node:sqlite";

import { messageMentionCandidates, type RoomEvent } from "@rah-os/protocol";

import type { MessageRecipient } from "./collaboration-service.ts";
import { eventPayloadOptionalText } from "./event-payload.ts";
import { listRoomAgentRecipients } from "./room-agent-service.ts";
import { listFollowingAgentThreadRecipients } from "./agent-thread-subscriptions.ts";
import { text } from "./sqlite-row.ts";

export function workerReplyThreadId(input: {
  causalEvent: RoomEvent;
  participantId: string;
  taskThreadId?: string;
}): string | undefined {
  if (input.taskThreadId !== undefined) return input.taskThreadId;
  return eventPayloadOptionalText(input.causalEvent, "threadId");
}

/**
 * The Agents an Agent author may address by `@handle`. The membership and
 * enablement predicate mirrors {@link listRoomAgentRecipients}: a mention never
 * reaches outside the Room and never wakes a disabled Agent. Humans are not
 * Activation recipients, so only Agent members are mentionable.
 */
function mentionableRoomAgentHandles(
  database: DatabaseSync,
  roomId: string,
  excludedParticipantId: string,
): Map<string, string> {
  const byHandle = new Map<string, string>();
  for (const row of database
    .prepare(
      `SELECT principals.principal_id, principals.handle
       FROM memberships
       JOIN principals ON principals.principal_id = memberships.principal_id
       LEFT JOIN agent_definitions
         ON agent_definitions.participant_id = principals.principal_id
       WHERE memberships.room_id = ? AND principals.kind = 'agent'
         AND (agent_definitions.state IS NULL OR agent_definitions.state = 'enabled')
       ORDER BY principals.principal_id`,
    )
    .all(roomId)) {
    const participantId = text(row, "principal_id");
    if (participantId === excludedParticipantId) continue;
    byHandle.set(text(row, "handle"), participantId);
  }
  return byHandle;
}

/** Server-side resolution of `@handle` prose written by an Agent author. */
export function workerMentionRecipients(input: {
  body?: string | undefined;
  database: DatabaseSync;
  participantId: string;
  roomId: string;
}): MessageRecipient[] {
  if (input.body === undefined || input.body.trim().length === 0) return [];
  const byHandle = mentionableRoomAgentHandles(
    input.database,
    input.roomId,
    input.participantId,
  );
  if (byHandle.size === 0) return [];
  const mentioned = new Set<string>();
  for (const candidate of messageMentionCandidates(input.body, [
    ...byHandle.keys(),
  ])) {
    const participantId = byHandle.get(candidate.handle);
    if (participantId !== undefined) mentioned.add(participantId);
  }
  return [...mentioned].map((participantId) => ({
    participantId,
    reason: "mention" as const,
  }));
}

export function workerReplyRecipients(input: {
  body?: string | undefined;
  causalEvent: RoomEvent;
  database: DatabaseSync;
  participantId: string;
  roomId: string;
  threadId?: string;
}): MessageRecipient[] {
  const roomRecipients = listRoomAgentRecipients(
    input.database,
    input.roomId,
    input.threadId === undefined ? "room_policy" : "thread_subscription",
    input.participantId,
  );
  const result = new Map<string, MessageRecipient>();
  if (input.threadId === undefined) {
    for (const recipient of roomRecipients)
      result.set(recipient.participantId, recipient);
  } else {
    for (const recipient of listFollowingAgentThreadRecipients(input.database, {
      excludedParticipantId: input.participantId,
      roomId: input.roomId,
      threadId: input.threadId,
    })) {
      result.set(recipient.participantId, recipient);
    }
    const allowed = new Map(
      roomRecipients.map(
        (recipient) => [recipient.participantId, recipient] as const,
      ),
    );
    for (const participantId of causalRecipientIds(input.causalEvent)) {
      const recipient = allowed.get(participantId);
      if (recipient !== undefined) result.set(participantId, recipient);
    }
  }
  // A mention overrides membership and Thread routing for that participant: it
  // both raises the reason and adds an Agent the route would otherwise omit.
  for (const mention of workerMentionRecipients({
    body: input.body,
    database: input.database,
    participantId: input.participantId,
    roomId: input.roomId,
  })) {
    result.set(mention.participantId, mention);
  }
  return [...result.values()].sort((left, right) =>
    left.participantId.localeCompare(right.participantId),
  );
}

function causalRecipientIds(event: RoomEvent): string[] {
  const ids = new Set<string>();
  const recipientIds = event.payload.recipientIds;
  if (Array.isArray(recipientIds)) {
    for (const participantId of recipientIds) {
      if (typeof participantId === "string") ids.add(participantId);
    }
  }
  const recipients = event.payload.recipients;
  if (Array.isArray(recipients)) {
    for (const recipient of recipients) {
      const participantId =
        typeof recipient === "object" && recipient !== null
          ? (recipient as Record<string, unknown>).participantId
          : undefined;
      if (typeof participantId === "string") {
        ids.add(participantId);
      }
    }
  }
  return [...ids];
}

/**
 * A send-draft post carries no body: the prose being sent is the held draft's.
 * Read it without the active-draft assertions so that draft expiry, ownership
 * and idempotency stay the responsibility of the posting path.
 */
function heldDraftBody(
  database: DatabaseSync,
  heldDraftId: string,
): string | undefined {
  const row = database
    .prepare("SELECT body FROM held_message_drafts WHERE held_draft_id = ?")
    .get(heldDraftId);
  return row === undefined ? undefined : text(row, "body");
}

export function workerReplyRoute(input: {
  body?: string | undefined;
  causalEvent: RoomEvent;
  database: DatabaseSync;
  heldDraftId?: string | undefined;
  participantId: string;
  roomId: string;
  taskThreadId?: string;
}): { recipients: MessageRecipient[]; threadId?: string } {
  const threadId = workerReplyThreadId(input);
  const body =
    input.body ??
    (input.heldDraftId === undefined
      ? undefined
      : heldDraftBody(input.database, input.heldDraftId));
  return {
    recipients: workerReplyRecipients({
      ...(body === undefined ? {} : { body }),
      causalEvent: input.causalEvent,
      database: input.database,
      participantId: input.participantId,
      roomId: input.roomId,
      ...(threadId === undefined ? {} : { threadId }),
    }),
    ...(threadId === undefined ? {} : { threadId }),
  };
}
