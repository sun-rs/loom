import type {
  RoomAttentionReason,
  RoomEvent,
  RoomInboxItem,
  RoomMembership,
  RoomMessage,
  RoomPrincipal,
  RoomRecord,
  RoomSnapshot,
} from "./room";
import { assertRoomTextStorageSafe } from "./room";

export type RoomEventDto =
  | RoomCreatedEventDto
  | RoomMembershipAddedEventDto
  | RoomMessagePostedEventDto
  | RoomMessageAcknowledgedEventDto;

interface RoomEventDtoBase {
  eventId: string;
  roomId: string;
  roomSeq: number;
  actorId: string;
  aggregateType: "room" | "membership" | "message";
  aggregateId: string;
  schemaVersion: 1;
  createdAt: string;
}

export interface RoomCreatedEventDto extends RoomEventDtoBase {
  type: "room.created";
  aggregateType: "room";
  payload: {
    room: RoomRecord;
    ownerMembership: RoomMembership;
    ownerPrincipal: RoomPrincipal;
  };
}

export interface RoomMembershipAddedEventDto extends RoomEventDtoBase {
  type: "membership.added";
  aggregateType: "membership";
  payload: { membership: RoomMembership; principal: RoomPrincipal };
}

export interface RoomMessagePostedEventDto extends RoomEventDtoBase {
  type: "message.posted";
  aggregateType: "message";
  payload: {
    body: string;
    attention: Array<{ principalId: string; reason: RoomAttentionReason }>;
    createdAt: string;
  };
}

export interface RoomMessageAcknowledgedEventDto extends RoomEventDtoBase {
  type: "message.acknowledged";
  aggregateType: "message";
  payload: {
    messageId: string;
    participantId: string;
    acknowledgedAt: string;
  };
}

export interface RoomBootstrapReadRequest {
  roomId: string;
  limit?: number;
}

export interface RoomEventReadRequest {
  roomId: string;
  cursor: string;
  limit?: number;
}

export interface RoomOlderMessagesReadRequest {
  roomId: string;
  cursor: string;
  limit?: number;
}

export interface RoomInboxReadRequest {
  cursor?: string;
  limit?: number;
}

export interface RoomBootstrapReadResponse {
  mode: "latest_bootstrap";
  snapshot: RoomSnapshot;
  snapshotSeq: number;
  latestRoomSeq: number;
  recentMessages: RoomMessage[];
  eventCursor: string;
  olderMessagesCursor?: string;
}

export interface RoomEventReadResponse {
  mode: "event_page";
  events: RoomEventDto[];
  latestRoomSeq: number;
  hasMore: boolean;
  eventCursor: string;
}

export interface RoomOlderMessagesReadResponse {
  mode: "older_messages";
  messages: RoomMessage[];
  hasMore: boolean;
  olderMessagesCursor?: string;
}

export interface RoomInboxReadResponse {
  items: RoomInboxItem[];
  inboxCursor: string;
}

export const ROOM_ERROR_CODES = [
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "stale_context",
  "idempotency_conflict",
  "resource_exhausted",
  "unavailable",
  "invalid_argument",
] as const;

export type RoomErrorCode = typeof ROOM_ERROR_CODES[number];

export type RoomReadResponseData =
  | RoomBootstrapReadResponse
  | RoomEventReadResponse
  | RoomOlderMessagesReadResponse
  | RoomInboxReadResponse;

export type RoomReadHttpEnvelope =
  | { ok: true; data: RoomReadResponseData }
  | {
      ok: false;
      error: { code: RoomErrorCode | "internal"; message: string };
    };

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ATTENTION_REASONS = new Set<RoomAttentionReason>([
  "mention",
  "direct_message",
  "room_policy",
  "task_assignment",
  "dependency_resolved",
  "input_resolved",
]);

function requireObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  name: string,
): void {
  const known = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !known.has(key));
  if (unknown) throw new Error(`${name} contains unknown field ${unknown}`);
}

function requireIdentifier(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new Error(`${name} must be a stable identifier`);
  }
}

function requireSequence(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

function requireTimestamp(value: unknown, name: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`${name} must be an ISO-8601 UTC timestamp`);
  }
}

function validateLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 500) {
    throw new Error("limit must be between 1 and 500");
  }
  return Number(value);
}

function validateCursor(value: unknown, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.length < 1 || value.length > 4_096) {
    throw new Error("cursor must contain 1 to 4096 characters");
  }
  return value;
}

function readRequest(
  value: unknown,
  name: string,
  options: { cursor: "required" | "optional" | "forbidden"; room: boolean },
): { roomId?: string; cursor?: string; limit?: number } {
  requireObject(value, name);
  const allowed = [
    ...(options.room ? ["roomId"] : []),
    ...(options.cursor === "forbidden" ? [] : ["cursor"]),
    "limit",
  ];
  rejectUnknownKeys(value, allowed, name);
  if (options.room) requireIdentifier(value.roomId, "roomId");
  const cursor = options.cursor === "forbidden"
    ? undefined
    : validateCursor(value.cursor, options.cursor === "required");
  const limit = validateLimit(value.limit);
  return {
    ...(options.room ? { roomId: value.roomId as string } : {}),
    ...(cursor ? { cursor } : {}),
    ...(limit ? { limit } : {}),
  };
}

export function validateRoomBootstrapReadRequest(value: unknown): RoomBootstrapReadRequest {
  return readRequest(value, "RoomBootstrapReadRequest", {
    cursor: "forbidden",
    room: true,
  }) as RoomBootstrapReadRequest;
}

export function validateRoomEventReadRequest(value: unknown): RoomEventReadRequest {
  return readRequest(value, "RoomEventReadRequest", {
    cursor: "required",
    room: true,
  }) as RoomEventReadRequest;
}

export function validateRoomOlderMessagesReadRequest(
  value: unknown,
): RoomOlderMessagesReadRequest {
  return readRequest(value, "RoomOlderMessagesReadRequest", {
    cursor: "required",
    room: true,
  }) as RoomOlderMessagesReadRequest;
}

export function validateRoomInboxReadRequest(value: unknown): RoomInboxReadRequest {
  return readRequest(value, "RoomInboxReadRequest", {
    cursor: "optional",
    room: false,
  }) as RoomInboxReadRequest;
}

function eventBase(value: Record<string, unknown>): RoomEventDtoBase {
  rejectUnknownKeys(
    value,
    [
      "eventId",
      "roomId",
      "roomSeq",
      "type",
      "actorId",
      "aggregateType",
      "aggregateId",
      "payload",
      "idempotencyKey",
      "schemaVersion",
      "createdAt",
    ],
    "RoomEvent",
  );
  requireIdentifier(value.eventId, "eventId");
  requireIdentifier(value.roomId, "roomId");
  requireSequence(value.roomSeq, "roomSeq");
  requireIdentifier(value.actorId, "actorId");
  requireIdentifier(value.aggregateId, "aggregateId");
  requireIdentifier(value.idempotencyKey, "idempotencyKey");
  if (value.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  requireTimestamp(value.createdAt, "createdAt");
  if (
    value.aggregateType !== "room" &&
    value.aggregateType !== "membership" &&
    value.aggregateType !== "message"
  ) {
    throw new Error("aggregateType is unsupported");
  }
  return {
    eventId: value.eventId,
    roomId: value.roomId,
    roomSeq: value.roomSeq,
    actorId: value.actorId,
    aggregateType: value.aggregateType,
    aggregateId: value.aggregateId,
    schemaVersion: 1,
    createdAt: value.createdAt,
  };
}

function recordPayload(value: unknown, name: string): Record<string, unknown> {
  requireObject(value, name);
  return value;
}

function validateRoomRecord(value: unknown): RoomRecord {
  const room = recordPayload(value, "RoomRecord");
  rejectUnknownKeys(
    room,
    ["roomId", "workspaceKey", "kind", "slug", "name", "visibility", "createdAt", "archivedAt"],
    "RoomRecord",
  );
  requireIdentifier(room.roomId, "RoomRecord.roomId");
  requireIdentifier(room.workspaceKey, "RoomRecord.workspaceKey");
  requireIdentifier(room.slug, "RoomRecord.slug");
  if (room.kind !== "channel" && room.kind !== "direct" && room.kind !== "control") {
    throw new Error("RoomRecord.kind is invalid");
  }
  if (room.visibility !== "public" && room.visibility !== "private") {
    throw new Error("RoomRecord.visibility is invalid");
  }
  if (typeof room.name !== "string" || !room.name || room.name.length > 120) {
    throw new Error("RoomRecord.name is invalid");
  }
  assertRoomTextStorageSafe(room.name, "RoomRecord.name");
  requireTimestamp(room.createdAt, "RoomRecord.createdAt");
  if (room.archivedAt !== undefined) requireTimestamp(room.archivedAt, "RoomRecord.archivedAt");
  return room as unknown as RoomRecord;
}

function validateMembership(value: unknown): RoomMembership {
  const membership = recordPayload(value, "RoomMembership");
  rejectUnknownKeys(membership, ["roomId", "principalId", "role", "joinedAt"], "RoomMembership");
  requireIdentifier(membership.roomId, "RoomMembership.roomId");
  requireIdentifier(membership.principalId, "RoomMembership.principalId");
  if (
    membership.role !== "owner" &&
    membership.role !== "admin" &&
    membership.role !== "member"
  ) throw new Error("RoomMembership.role is invalid");
  requireTimestamp(membership.joinedAt, "RoomMembership.joinedAt");
  return membership as unknown as RoomMembership;
}

function validatePrincipal(value: unknown): RoomPrincipal {
  const principal = recordPayload(value, "RoomPrincipal");
  rejectUnknownKeys(
    principal,
    ["principalId", "handle", "kind", "displayName", "createdAt"],
    "RoomPrincipal",
  );
  requireIdentifier(principal.principalId, "RoomPrincipal.principalId");
  requireIdentifier(principal.handle, "RoomPrincipal.handle");
  if (
    principal.kind !== "human" &&
    principal.kind !== "agent" &&
    principal.kind !== "service"
  ) throw new Error("RoomPrincipal.kind is invalid");
  if (
    principal.displayName !== undefined &&
    (typeof principal.displayName !== "string" ||
      !principal.displayName ||
      principal.displayName.length > 120)
  ) throw new Error("RoomPrincipal.displayName is invalid");
  if (typeof principal.displayName === "string") {
    assertRoomTextStorageSafe(principal.displayName, "RoomPrincipal.displayName");
  }
  requireTimestamp(principal.createdAt, "RoomPrincipal.createdAt");
  return principal as unknown as RoomPrincipal;
}

/**
 * Converts the internal append-only event record into the only event shapes a
 * client may fold. Command idempotency keys and unknown future payloads never
 * cross this boundary accidentally.
 */
export function toRoomEventDto(value: RoomEvent | unknown): RoomEventDto {
  requireObject(value, "RoomEvent");
  const base = eventBase(value);
  const payload = recordPayload(value.payload, "RoomEvent.payload");

  if (value.type === "room.created") {
    if (base.aggregateType !== "room") throw new Error("room.created aggregateType must be room");
    rejectUnknownKeys(
      payload,
      ["room", "ownerMembership", "ownerPrincipal"],
      "room.created payload",
    );
    const room = validateRoomRecord(payload.room);
    const ownerMembership = validateMembership(payload.ownerMembership);
    const ownerPrincipal = validatePrincipal(payload.ownerPrincipal);
    if (room.roomId !== base.roomId || base.aggregateId !== base.roomId) {
      throw new Error("room.created aggregateId and roomId must identify the payload Room");
    }
    if (room.createdAt !== base.createdAt) {
      throw new Error("room.created time must match the event occurrence time");
    }
    if (
      ownerMembership.roomId !== room.roomId ||
      ownerMembership.role !== "owner" ||
      ownerMembership.joinedAt !== base.createdAt ||
      ownerMembership.principalId !== ownerPrincipal.principalId ||
      ownerPrincipal.principalId !== base.actorId ||
      ownerPrincipal.kind !== "human"
    ) throw new Error("room.created owner identity graph is inconsistent");
    return {
      ...base,
      aggregateType: "room",
      type: "room.created",
      payload: { room, ownerMembership, ownerPrincipal },
    };
  }

  if (value.type === "membership.added") {
    if (base.aggregateType !== "membership") {
      throw new Error("membership.added aggregateType must be membership");
    }
    rejectUnknownKeys(payload, ["membership", "principal"], "membership.added payload");
    const membership = validateMembership(payload.membership);
    const principal = validatePrincipal(payload.principal);
    if (membership.roomId !== base.roomId || membership.principalId !== base.aggregateId) {
      throw new Error("membership.added aggregateId must identify the payload membership");
    }
    if (membership.joinedAt !== base.createdAt) {
      throw new Error("membership.added time must match the event occurrence time");
    }
    if (principal.principalId !== membership.principalId) {
      throw new Error("membership.added principal must identify the payload membership");
    }
    return {
      ...base,
      aggregateType: "membership",
      type: "membership.added",
      payload: { membership, principal },
    };
  }

  if (value.type === "message.posted") {
    if (base.aggregateType !== "message") {
      throw new Error("message.posted aggregateType must be message");
    }
    rejectUnknownKeys(payload, ["body", "attention", "createdAt"], "message.posted payload");
    if (typeof payload.body !== "string" || !payload.body || payload.body.length > 100_000) {
      throw new Error("message.posted body is invalid");
    }
    assertRoomTextStorageSafe(payload.body, "message.posted body");
    requireTimestamp(payload.createdAt, "message.posted createdAt");
    if (payload.createdAt !== base.createdAt) {
      throw new Error("message.posted createdAt must match the event occurrence time");
    }
    if (!Array.isArray(payload.attention) || payload.attention.length > 500) {
      throw new Error("message.posted attention is invalid");
    }
    const attention = payload.attention.map((entry, index) => {
      const item = recordPayload(entry, `message.posted attention[${index}]`);
      rejectUnknownKeys(item, ["principalId", "reason"], `message.posted attention[${index}]`);
      requireIdentifier(item.principalId, `message.posted attention[${index}].principalId`);
      if (!ATTENTION_REASONS.has(item.reason as RoomAttentionReason)) {
        throw new Error(`message.posted attention[${index}].reason is invalid`);
      }
      return { principalId: item.principalId, reason: item.reason as RoomAttentionReason };
    });
    return {
      ...base,
      aggregateType: "message",
      type: "message.posted",
      payload: { body: payload.body, attention, createdAt: payload.createdAt },
    };
  }

  if (value.type === "message.acknowledged") {
    if (base.aggregateType !== "message") {
      throw new Error("message.acknowledged aggregateType must be message");
    }
    rejectUnknownKeys(
      payload,
      ["messageId", "participantId", "acknowledgedAt"],
      "message.acknowledged payload",
    );
    requireIdentifier(payload.messageId, "message.acknowledged messageId");
    requireIdentifier(payload.participantId, "message.acknowledged participantId");
    requireTimestamp(payload.acknowledgedAt, "message.acknowledged acknowledgedAt");
    if (payload.messageId !== base.aggregateId) {
      throw new Error("message.acknowledged aggregateId must identify the payload message");
    }
    if (payload.participantId !== base.actorId) {
      throw new Error("message.acknowledged participant must match the event actor");
    }
    if (payload.acknowledgedAt !== base.createdAt) {
      throw new Error("message.acknowledged time must match the event occurrence time");
    }
    return {
      ...base,
      aggregateType: "message",
      type: "message.acknowledged",
      payload: {
        messageId: payload.messageId,
        participantId: payload.participantId,
        acknowledgedAt: payload.acknowledgedAt,
      },
    };
  }

  throw new Error(`unsupported Room event type ${String(value.type)}`);
}
