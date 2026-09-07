import type { DatabaseSync } from "node:sqlite";

import type { RoomEvent } from "@rah-os/protocol";

import { IdempotencyConflictError } from "./errors.ts";
import type { Row } from "./sqlite-row.ts";

export function findRoomEventByIdempotencyKey(
  database: DatabaseSync,
  roomId: string,
  idempotencyKey: string,
): Row | undefined {
  return database
    .prepare(
      "SELECT * FROM room_events WHERE room_id = ? AND idempotency_key = ?",
    )
    .get(roomId, idempotencyKey);
}

export function assertTaskEventReplay(
  event: RoomEvent,
  expected: {
    actorId: string;
    aggregateId?: string;
    eventType: string;
    payload: Record<string, unknown>;
  },
): RoomEvent {
  const payloadMatches = Object.entries(expected.payload).every(
    ([key, value]) =>
      JSON.stringify(event.payload[key]) === JSON.stringify(value),
  );
  if (
    event.type !== expected.eventType ||
    event.actorId !== expected.actorId ||
    event.aggregateType !== "task" ||
    (expected.aggregateId !== undefined &&
      event.aggregateId !== expected.aggregateId) ||
    !payloadMatches
  ) {
    throw new IdempotencyConflictError(
      `idempotency key ${event.idempotencyKey} was already used for another mutation`,
    );
  }
  return event;
}
