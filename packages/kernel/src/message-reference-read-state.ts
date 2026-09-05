import type { DatabaseSync } from "node:sqlite";

import type { MessageReferenceReadStateRecord } from "@rah-os/protocol";

import { requireRoomMember } from "./collaboration-policy.ts";
import { text } from "./sqlite-row.ts";

/**
 * Resolve exact mention receipts for a bounded visible Message window.
 * Inbox is the canonical delivery/acknowledgement owner; browser replay depth
 * and Agent presence are deliberately irrelevant to the result.
 */
export function listMessageReferenceReadStates(
  database: DatabaseSync,
  actorId: string,
  input: { messageIds: string[]; roomId: string },
): MessageReferenceReadStateRecord[] {
  requireRoomMember(database, input.roomId, actorId);
  if (input.messageIds.length === 0) return [];
  if (input.messageIds.length > 200) {
    throw new Error("messageIds cannot contain more than 200 entries");
  }
  if (new Set(input.messageIds).size !== input.messageIds.length) {
    throw new Error("messageIds must be unique");
  }
  const placeholders = input.messageIds.map(() => "?").join(", ");
  return database
    .prepare(
      `SELECT
         room_events.aggregate_id AS message_id,
         inbox_items.participant_id,
         inbox_items.state
       FROM room_events
       JOIN inbox_items ON inbox_items.event_id = room_events.event_id
       WHERE room_events.room_id = ?
         AND room_events.type = 'message.posted'
         AND room_events.aggregate_id IN (${placeholders})
         AND inbox_items.reason = 'mention'
       ORDER BY room_events.room_seq, inbox_items.participant_id`,
    )
    .all(input.roomId, ...input.messageIds)
    .map((row) => ({
      messageId: text(row, "message_id"),
      principalId: text(row, "participant_id"),
      readState:
        text(row, "state") === "acknowledged"
          ? ("read" as const)
          : ("unread" as const),
    }));
}
