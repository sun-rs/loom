import type { DatabaseSync } from "node:sqlite";

import type { RoomEvent } from "@rah-os/protocol";

import { integer } from "./sqlite-row.ts";

/** Raft shows at most this many held messages and counts the rest as omitted. */
const MAX_SHOWN_HELD_MESSAGES = 20;

/**
 * The bounded newer-message context Raft puts in front of a model when it holds
 * an action: the messages on the same target between what the caller was based
 * on and what exists now, capped, plus the count it did not show.
 * `formatFreshnessHoldOutput` renders exactly these fields, and the send hold
 * and the Task hold share it upstream.
 */
export function freshnessHoldContext(
  database: DatabaseSync,
  input: {
    basedOnRoomSeq: number;
    roomId: string;
    seenUpToSeq: number;
    threadId?: string | undefined;
    eventFromRow: (row: Record<string, unknown>) => RoomEvent;
  },
): {
  newMessageCount: number;
  newerMessages: RoomEvent[];
  omittedMessageCount: number;
  shownMessageCount: number;
} {
  const parameters: string[] = [input.roomId];
  const targetClause =
    input.threadId === undefined
      ? "messages.thread_id IS NULL"
      : "messages.thread_id = ?";
  if (input.threadId !== undefined) parameters.push(input.threadId);
  const newerRows = database
    .prepare(
      `SELECT room_events.*
         FROM messages
         JOIN room_events
           ON room_events.room_id = messages.room_id
          AND room_events.aggregate_id = messages.message_id
          AND room_events.type = 'message.posted'
         WHERE messages.room_id = ? AND ${targetClause}
           AND room_events.room_seq > ? AND room_events.room_seq <= ?
         ORDER BY room_events.room_seq
         LIMIT ${MAX_SHOWN_HELD_MESSAGES}`,
    )
    .all(...parameters, input.basedOnRoomSeq, input.seenUpToSeq);
  const countRow = database
    .prepare(
      `SELECT COUNT(*) AS count
         FROM messages
         JOIN room_events
           ON room_events.room_id = messages.room_id
          AND room_events.aggregate_id = messages.message_id
          AND room_events.type = 'message.posted'
         WHERE messages.room_id = ? AND ${targetClause}
           AND room_events.room_seq > ? AND room_events.room_seq <= ?`,
    )
    .get(...parameters, input.basedOnRoomSeq, input.seenUpToSeq)!;
  const newMessageCount = integer(countRow, "count");
  return {
    newMessageCount,
    newerMessages: newerRows.map((row) =>
      input.eventFromRow(row as Record<string, unknown>),
    ),
    omittedMessageCount: Math.max(0, newMessageCount - newerRows.length),
    shownMessageCount: newerRows.length,
  };
}
