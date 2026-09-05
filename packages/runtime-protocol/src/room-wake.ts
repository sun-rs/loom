import type { RoomAttentionReason } from "./room";

export interface RoomEventWakeHint {
  schema: "rah.room-wake.v1";
  hintId: string;
  topic: "room.event";
  eventId: string;
  eventType: string;
  roomId: string;
  roomSeq: number;
}

export interface RoomInboxAvailableWakeHint {
  schema: "rah.room-wake.v1";
  hintId: string;
  topic: "inbox.available";
  eventId: string;
  participantId: string;
  reason: RoomAttentionReason;
  roomId: string;
  roomSeq: number;
}

export type RoomWakeHint = RoomEventWakeHint | RoomInboxAvailableWakeHint;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EVENT_TYPE = /^[a-z][a-z0-9_.-]{0,99}$/;
const ATTENTION_REASONS = new Set<RoomAttentionReason>([
  "mention",
  "direct_message",
  "room_policy",
  "task_assignment",
  "dependency_resolved",
  "input_resolved",
]);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("RoomWakeHint must be an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`RoomWakeHint contains unknown field ${key}`);
  }
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new Error(`RoomWakeHint.${name} is invalid`);
  }
  return value;
}

function sequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error("RoomWakeHint.roomSeq must be a positive safe integer");
  }
  return Number(value);
}

/**
 * Validates the intentionally content-free, lossy wake envelope. Consumers
 * must sync canonical Room state after receiving it; the hint is never truth.
 */
export function validateRoomWakeHint(value: unknown): RoomWakeHint {
  const hint = record(value);
  if (hint.topic === "room.event") {
    exactKeys(hint, ["schema", "hintId", "topic", "eventId", "eventType", "roomId", "roomSeq"]);
    if (hint.schema !== "rah.room-wake.v1") throw new Error("RoomWakeHint.schema is invalid");
    if (typeof hint.eventType !== "string" || !EVENT_TYPE.test(hint.eventType)) {
      throw new Error("RoomWakeHint.eventType is invalid");
    }
    return {
      schema: "rah.room-wake.v1",
      hintId: identifier(hint.hintId, "hintId"),
      topic: "room.event",
      eventId: identifier(hint.eventId, "eventId"),
      eventType: hint.eventType,
      roomId: identifier(hint.roomId, "roomId"),
      roomSeq: sequence(hint.roomSeq),
    };
  }
  if (hint.topic === "inbox.available") {
    exactKeys(
      hint,
      ["schema", "hintId", "topic", "eventId", "participantId", "reason", "roomId", "roomSeq"],
    );
    if (hint.schema !== "rah.room-wake.v1") throw new Error("RoomWakeHint.schema is invalid");
    if (!ATTENTION_REASONS.has(hint.reason as RoomAttentionReason)) {
      throw new Error("RoomWakeHint.reason is invalid");
    }
    return {
      schema: "rah.room-wake.v1",
      hintId: identifier(hint.hintId, "hintId"),
      topic: "inbox.available",
      eventId: identifier(hint.eventId, "eventId"),
      participantId: identifier(hint.participantId, "participantId"),
      reason: hint.reason as RoomAttentionReason,
      roomId: identifier(hint.roomId, "roomId"),
      roomSeq: sequence(hint.roomSeq),
    };
  }
  throw new Error("RoomWakeHint.topic is unsupported");
}
