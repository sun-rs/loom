import type { DatabaseSync } from "node:sqlite";

import type { RoomEvent } from "@rah-os/protocol";

import { integer } from "./sqlite-row.ts";
import { SYSTEM_PRINCIPAL_ID } from "./system-principal.ts";

/**
 * Kernel system notices (the wake-chain limit notice, evo §37 A) are not a
 * collaborator's newer message: they never hold a send or a Task action
 * (full review 2 P2-1). They stay visible in the Channel and in reads.
 */
export const NOT_SYSTEM_NOTICE_SQL = `NOT (messages.actor_id = '${SYSTEM_PRINCIPAL_ID}'
  AND json_extract(room_events.payload_json, '$.systemNotice') IS NOT NULL)`;

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
    /**
     * The send hold is target-scoped: a send addresses one Thread, or the Room
     * top level. A Task hold is not — the stale context can come from any
     * Thread in the Room, so it passes `"room"` and filters nothing, rather
     * than showing top-level messages and hiding the Thread the work is in.
     */
    threadId?: string | "room" | undefined;
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
    input.threadId === "room"
      ? "1 = 1"
      : input.threadId === undefined
        ? "messages.thread_id IS NULL"
        : "messages.thread_id = ?";
  if (input.threadId !== undefined && input.threadId !== "room")
    parameters.push(input.threadId);
  const newerRows = database
    .prepare(
      `SELECT room_events.*
         FROM messages
         JOIN room_events
           ON room_events.room_id = messages.room_id
          AND room_events.aggregate_id = messages.message_id
          AND room_events.type = 'message.posted'
         WHERE messages.room_id = ? AND ${targetClause}
           AND ${NOT_SYSTEM_NOTICE_SQL}
           AND room_events.room_seq > ? AND room_events.room_seq <= ?
         ORDER BY room_events.room_seq DESC
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
           AND ${NOT_SYSTEM_NOTICE_SQL}
           AND room_events.room_seq > ? AND room_events.room_seq <= ?`,
    )
    .get(...parameters, input.basedOnRoomSeq, input.seenUpToSeq)!;
  const newMessageCount = integer(countRow, "count");
  return {
    newMessageCount,
    // Selected newest-first so the cap drops the oldest, then reversed for
    // display. The notice says "showing latest N of M" and calls what it
    // dropped "earlier": selecting ascending returned the OLDEST N and made
    // both statements false, hiding exactly the corrections and cancellations
    // an Agent most needs before it retries.
    newerMessages: newerRows
      .map((row) => input.eventFromRow(row as Record<string, unknown>))
      .reverse(),
    omittedMessageCount: Math.max(0, newMessageCount - newerRows.length),
    shownMessageCount: newerRows.length,
  };
}
