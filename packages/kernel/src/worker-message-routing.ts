import type { DatabaseSync } from "node:sqlite";

import type { RoomEvent } from "@rah-os/protocol";

import type { MessageRecipient } from "./collaboration-service.ts";
import { eventPayloadOptionalText } from "./event-payload.ts";
import { listRoomAgentRecipients } from "./room-agent-service.ts";
import { listFollowingAgentThreadRecipients } from "./agent-thread-subscriptions.ts";

export function workerReplyThreadId(input: {
  causalEvent: RoomEvent;
  participantId: string;
  taskThreadId?: string;
}): string | undefined {
  if (input.taskThreadId !== undefined) return input.taskThreadId;
  return eventPayloadOptionalText(input.causalEvent, "threadId");
}

export function workerReplyRecipients(input: {
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
  if (input.threadId === undefined) return roomRecipients;
  const result = new Map(
    listFollowingAgentThreadRecipients(input.database, {
      excludedParticipantId: input.participantId,
      roomId: input.roomId,
      threadId: input.threadId,
    }).map((recipient) => [recipient.participantId, recipient] as const),
  );
  const allowed = new Map(
    roomRecipients.map(
      (recipient) => [recipient.participantId, recipient] as const,
    ),
  );
  for (const participantId of causalRecipientIds(input.causalEvent)) {
    const recipient = allowed.get(participantId);
    if (recipient !== undefined) result.set(participantId, recipient);
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

export function workerReplyRoute(input: {
  causalEvent: RoomEvent;
  database: DatabaseSync;
  participantId: string;
  roomId: string;
  taskThreadId?: string;
}): { recipients: MessageRecipient[]; threadId?: string } {
  const threadId = workerReplyThreadId(input);
  return {
    recipients: workerReplyRecipients({
      causalEvent: input.causalEvent,
      database: input.database,
      participantId: input.participantId,
      roomId: input.roomId,
      ...(threadId === undefined ? {} : { threadId }),
    }),
    ...(threadId === undefined ? {} : { threadId }),
  };
}
