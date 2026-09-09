import type { DatabaseSync } from "node:sqlite";

import type { RoomEvent } from "@rah-os/protocol";

import { integer, text } from "./sqlite-row.ts";
import { readWorkerTargetReadPosition } from "./worker-target-read-position.ts";

/**
 * Read-only projection of two facts the Kernel already owns but has never put
 * in a Worker delivery: what this participant was already shown at a target,
 * and what it has already said there since.
 *
 * Raft's long-lived agent session filters notifications for messages already
 * put in front of the model (`filterUncontributedMessages` /
 * `pruneContributedToPending`). RAH cannot drop the wake — the per-Activation
 * acknowledge fence means a message shown during an earlier Activation was
 * never acknowledged, so a second Activation is structurally required. The port
 * is therefore to carry the already-presented fact in the delivery instead of
 * suppressing the delivery.
 *
 * Nothing here writes: the read position is read exactly as recorded by
 * `worker-target-read-position.ts` and is never advanced by a sync.
 */

/** The listed ids are a sample; `count` is always the whole number. */
const RESPONDED_AFTER_SAMPLE_LIMIT = 5;

/**
 * A sync window is already bounded by its own row limit and byte cap; this caps
 * the ledger reads this projection may add on top of it. Events are annotated in
 * delivery order, so the annotated set is deterministic.
 */
const ANNOTATED_EVENT_LIMIT = 20;

const ROOM_TARGET_KEY = "";

export type WorkerPresentedTarget = {
  roomId: string;
  threadId?: string;
  presentedThroughSeq: number;
};

export type WorkerPresentedEvent = {
  roomSeq: number;
  messageId: string;
  threadId?: string;
  alreadyPresented: true;
  presentedThroughSeq: number;
  respondedAfter: { messageIds: string[]; count: number };
};

export type WorkerPresentedContext = {
  targets: WorkerPresentedTarget[];
  events: WorkerPresentedEvent[];
};

function eventThreadId(event: RoomEvent): string | undefined {
  const threadId = (event.payload as { threadId?: unknown }).threadId;
  return typeof threadId === "string" && threadId.length > 0
    ? threadId
    : undefined;
}

function eventMessageId(event: RoomEvent): string | undefined {
  const messageId = (event.payload as { messageId?: unknown }).messageId;
  return typeof messageId === "string" && messageId.length > 0
    ? messageId
    : event.aggregateId.length > 0
      ? event.aggregateId
      : undefined;
}

function respondedAfter(
  database: DatabaseSync,
  input: {
    participantId: string;
    roomId: string;
    threadId: string | undefined;
    afterRoomSeq: number;
  },
): { messageIds: string[]; count: number } {
  const targetClause =
    input.threadId === undefined
      ? "messages.thread_id IS NULL"
      : "messages.thread_id = ?";
  const parameters: (string | number)[] = [input.roomId];
  if (input.threadId !== undefined) parameters.push(input.threadId);
  parameters.push(input.participantId, input.afterRoomSeq);
  const from = `FROM messages
       JOIN room_events
         ON room_events.room_id = messages.room_id
        AND room_events.aggregate_id = messages.message_id
        AND room_events.type = 'message.posted'
       WHERE messages.room_id = ? AND ${targetClause}
         AND room_events.actor_id = ?
         AND room_events.room_seq > ?`;
  const rows = database
    .prepare(
      `SELECT messages.message_id AS message_id ${from}
       ORDER BY room_events.room_seq LIMIT ${RESPONDED_AFTER_SAMPLE_LIMIT}`,
    )
    .all(...parameters);
  const countRow = database
    .prepare(`SELECT COUNT(*) AS count ${from}`)
    .get(...parameters)!;
  return {
    count: integer(countRow, "count"),
    messageIds: rows.map((row) => text(row, "message_id")),
  };
}

/**
 * Returns `undefined` when no delivered event was already presented, so the
 * delivery keeps its existing shape whenever there is nothing new to say.
 */
export function collectWorkerPresentedContext(
  database: DatabaseSync,
  input: { events: RoomEvent[]; participantId: string; roomId: string },
): WorkerPresentedContext | undefined {
  const positions = new Map<string, number | undefined>();
  const positionFor = (threadId: string | undefined): number | undefined => {
    const key = threadId ?? ROOM_TARGET_KEY;
    if (!positions.has(key)) {
      positions.set(
        key,
        readWorkerTargetReadPosition(database, {
          participantId: input.participantId,
          roomId: input.roomId,
          ...(threadId === undefined ? {} : { threadId }),
        }),
      );
    }
    return positions.get(key);
  };

  const targets: WorkerPresentedTarget[] = [];
  const seenTargets = new Set<string>();
  const events: WorkerPresentedEvent[] = [];
  for (const event of input.events) {
    if (events.length >= ANNOTATED_EVENT_LIMIT) break;
    if (event.type !== "message.posted" || event.roomId !== input.roomId)
      continue;
    const messageId = eventMessageId(event);
    if (messageId === undefined) continue;
    const threadId = eventThreadId(event);
    const presentedThroughSeq = positionFor(threadId);
    if (
      presentedThroughSeq === undefined ||
      event.roomSeq > presentedThroughSeq
    )
      continue;
    const targetKey = threadId ?? ROOM_TARGET_KEY;
    if (!seenTargets.has(targetKey)) {
      seenTargets.add(targetKey);
      targets.push({
        presentedThroughSeq,
        roomId: input.roomId,
        ...(threadId === undefined ? {} : { threadId }),
      });
    }
    events.push({
      alreadyPresented: true,
      messageId,
      presentedThroughSeq,
      respondedAfter: respondedAfter(database, {
        afterRoomSeq: event.roomSeq,
        participantId: input.participantId,
        roomId: input.roomId,
        threadId,
      }),
      roomSeq: event.roomSeq,
      ...(threadId === undefined ? {} : { threadId }),
    });
  }
  return events.length === 0 ? undefined : { events, targets };
}
