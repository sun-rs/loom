import type { RoomEvent } from "@rah-os/protocol";

import { IdempotencyConflictError } from "./errors.ts";

export function assertInputRequestEventReplay(
  event: RoomEvent,
  expected: {
    actorId: string;
    aggregateId?: string;
    eventType: "input.requested" | "input.resolved";
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
    event.aggregateType !== "input_request" ||
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
