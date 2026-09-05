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

export interface RoomListReadRequest {
  cursor?: string;
  limit?: number;
}

export interface RoomListItem {
  room: RoomRecord;
  membership: RoomMembership;
  latestRoomSeq: number;
  participantCount: number;
  pendingAttentionCount: number;
  directPeer?: RoomPrincipal;
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
  mode: "inbox_page";
  items: RoomInboxItem[];
  inboxCursor: string;
}

export interface RoomListReadResponse {
  mode: "room_list";
  items: RoomListItem[];
  hasMore: boolean;
  roomListCursor?: string;
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

export type RoomReadWireErrorCode = RoomErrorCode | "internal";

/**
 * The single wire owner for Room read error semantics. Both the daemon adapter
 * and every typed client must consume this table instead of maintaining a
 * second status mapping.
 */
export const ROOM_READ_HTTP_STATUS_BY_ERROR_CODE: Readonly<
  Record<RoomReadWireErrorCode, number>
> = Object.freeze({
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_argument: 400,
  conflict: 409,
  stale_context: 409,
  idempotency_conflict: 409,
  resource_exhausted: 413,
  unavailable: 503,
  internal: 500,
});

export type RoomReadResponseData =
  | RoomBootstrapReadResponse
  | RoomEventReadResponse
  | RoomOlderMessagesReadResponse
  | RoomInboxReadResponse
  | RoomListReadResponse;

export type RoomReadHttpEnvelope =
  | { ok: true; data: RoomReadResponseData }
  | {
      ok: false;
      error: { code: RoomReadWireErrorCode; message: string };
    };

export type RoomReadResponseMode = RoomReadResponseData["mode"];

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

export function validateRoomListReadRequest(value: unknown): RoomListReadRequest {
  return readRequest(value, "RoomListReadRequest", {
    cursor: "optional",
    room: false,
  }) as RoomListReadRequest;
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

function requireBoolean(value: unknown, name: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
}

function requireNonNegativeSequence(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function requireResponseCursor(value: unknown, name: string, optional = false): void {
  if (value === undefined && optional) return;
  if (typeof value !== "string" || value.length < 1 || value.length > 4_096) {
    throw new Error(`${name} must contain 1 to 4096 characters`);
  }
}

function validateMessage(value: unknown): RoomMessage {
  const message = recordPayload(value, "RoomMessage");
  rejectUnknownKeys(
    message,
    ["messageId", "roomId", "roomSeq", "actorId", "body", "createdAt"],
    "RoomMessage",
  );
  requireIdentifier(message.messageId, "RoomMessage.messageId");
  requireIdentifier(message.roomId, "RoomMessage.roomId");
  requireSequence(message.roomSeq, "RoomMessage.roomSeq");
  requireIdentifier(message.actorId, "RoomMessage.actorId");
  if (typeof message.body !== "string" || !message.body || message.body.length > 100_000) {
    throw new Error("RoomMessage.body is invalid");
  }
  assertRoomTextStorageSafe(message.body, "RoomMessage.body");
  requireTimestamp(message.createdAt, "RoomMessage.createdAt");
  return message as unknown as RoomMessage;
}

function validateInboxItem(value: unknown): RoomInboxItem {
  const item = recordPayload(value, "RoomInboxItem");
  rejectUnknownKeys(
    item,
    [
      "inboxSeq",
      "inboxItemId",
      "roomId",
      "participantId",
      "eventId",
      "eventSeq",
      "reason",
      "state",
      "createdAt",
      "acknowledgedAt",
    ],
    "RoomInboxItem",
  );
  requireSequence(item.inboxSeq, "RoomInboxItem.inboxSeq");
  requireIdentifier(item.inboxItemId, "RoomInboxItem.inboxItemId");
  requireIdentifier(item.roomId, "RoomInboxItem.roomId");
  requireIdentifier(item.participantId, "RoomInboxItem.participantId");
  requireIdentifier(item.eventId, "RoomInboxItem.eventId");
  requireSequence(item.eventSeq, "RoomInboxItem.eventSeq");
  if (!ATTENTION_REASONS.has(item.reason as RoomAttentionReason)) {
    throw new Error("RoomInboxItem.reason is invalid");
  }
  if (item.state !== "pending" && item.state !== "acknowledged") {
    throw new Error("RoomInboxItem.state is invalid");
  }
  requireTimestamp(item.createdAt, "RoomInboxItem.createdAt");
  if (item.acknowledgedAt !== undefined) {
    requireTimestamp(item.acknowledgedAt, "RoomInboxItem.acknowledgedAt");
  }
  if (
    (item.state === "acknowledged") !== (typeof item.acknowledgedAt === "string")
  ) throw new Error("RoomInboxItem acknowledgement state is inconsistent");
  return item as unknown as RoomInboxItem;
}

function validateSnapshot(value: unknown): RoomSnapshot {
  const snapshot = recordPayload(value, "RoomSnapshot");
  rejectUnknownKeys(snapshot, ["room", "memberships", "principals"], "RoomSnapshot");
  const room = validateRoomRecord(snapshot.room);
  if (!Array.isArray(snapshot.memberships) || snapshot.memberships.length > 500) {
    throw new Error("RoomSnapshot.memberships is invalid");
  }
  if (!Array.isArray(snapshot.principals) || snapshot.principals.length > 500) {
    throw new Error("RoomSnapshot.principals is invalid");
  }
  const memberships = snapshot.memberships.map(validateMembership);
  const principals = snapshot.principals.map(validatePrincipal);
  const membershipIds = new Set<string>();
  for (const membership of memberships) {
    if (membership.roomId !== room.roomId || membershipIds.has(membership.principalId)) {
      throw new Error("RoomSnapshot membership graph is inconsistent");
    }
    membershipIds.add(membership.principalId);
  }
  const principalIds = new Set<string>();
  for (const principal of principals) {
    if (!membershipIds.has(principal.principalId) || principalIds.has(principal.principalId)) {
      throw new Error("RoomSnapshot principal graph is inconsistent");
    }
    principalIds.add(principal.principalId);
  }
  if (membershipIds.size !== principalIds.size || membershipIds.size < 1) {
    throw new Error("RoomSnapshot identity graph is incomplete");
  }
  return { room, memberships, principals };
}

function validateEventDto(value: unknown): RoomEventDto {
  const candidate = recordPayload(value, "RoomEventDto");
  if (Object.hasOwn(candidate, "idempotencyKey")) {
    throw new Error("RoomEventDto cannot expose idempotencyKey");
  }
  return toRoomEventDto({ ...candidate, idempotencyKey: "transport-validation" });
}

function requireArrayLimit(value: unknown, name: string): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > 500) {
    throw new Error(`${name} must contain at most 500 items`);
  }
}

function requireStrictlyIncreasing(values: readonly number[], name: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index]! <= values[index - 1]!) {
      throw new Error(`${name} must be strictly increasing`);
    }
  }
}

function validateListItem(value: unknown): RoomListItem {
  const item = recordPayload(value, "RoomListItem");
  rejectUnknownKeys(
    item,
    [
      "room",
      "membership",
      "latestRoomSeq",
      "participantCount",
      "pendingAttentionCount",
      "directPeer",
    ],
    "RoomListItem",
  );
  const room = validateRoomRecord(item.room);
  const membership = validateMembership(item.membership);
  if (membership.roomId !== room.roomId) {
    throw new Error("RoomListItem membership must identify its Room");
  }
  requireSequence(item.latestRoomSeq, "RoomListItem.latestRoomSeq");
  requireSequence(item.participantCount, "RoomListItem.participantCount");
  requireNonNegativeSequence(item.pendingAttentionCount, "RoomListItem.pendingAttentionCount");
  const directPeer = item.directPeer === undefined ? undefined : validatePrincipal(item.directPeer);
  if (room.kind !== "direct" && directPeer) {
    throw new Error("Only a Direct Room may carry directPeer");
  }
  if (
    room.kind === "direct" &&
    ((item.participantCount === 2) !== Boolean(directPeer))
  ) throw new Error("Direct Room peer projection is inconsistent");
  if (directPeer?.principalId === membership.principalId) {
    throw new Error("Direct Room peer must differ from the current membership");
  }
  return {
    room,
    membership,
    latestRoomSeq: item.latestRoomSeq,
    participantCount: item.participantCount,
    pendingAttentionCount: item.pendingAttentionCount,
    ...(directPeer ? { directPeer } : {}),
  };
}

function validateResponseData(value: unknown): RoomReadResponseData {
  const data = recordPayload(value, "RoomReadResponseData");
  if (data.mode === "latest_bootstrap") {
    rejectUnknownKeys(
      data,
      [
        "mode",
        "snapshot",
        "snapshotSeq",
        "latestRoomSeq",
        "recentMessages",
        "eventCursor",
        "olderMessagesCursor",
      ],
      "RoomBootstrapReadResponse",
    );
    const snapshot = validateSnapshot(data.snapshot);
    requireSequence(data.snapshotSeq, "snapshotSeq");
    requireSequence(data.latestRoomSeq, "latestRoomSeq");
    const snapshotSeq = data.snapshotSeq;
    const latestRoomSeq = data.latestRoomSeq;
    if (snapshotSeq > latestRoomSeq) throw new Error("snapshotSeq exceeds Room head");
    requireArrayLimit(data.recentMessages, "recentMessages");
    const recentMessages = data.recentMessages.map(validateMessage);
    requireStrictlyIncreasing(recentMessages.map((message) => message.roomSeq), "recentMessages");
    if (recentMessages.some((message) =>
      message.roomId !== snapshot.room.roomId || message.roomSeq > snapshotSeq)) {
      throw new Error("recentMessages fall outside the snapshot window");
    }
    requireResponseCursor(data.eventCursor, "eventCursor");
    requireResponseCursor(data.olderMessagesCursor, "olderMessagesCursor", true);
    return data as unknown as RoomBootstrapReadResponse;
  }
  if (data.mode === "event_page") {
    rejectUnknownKeys(
      data,
      ["mode", "events", "latestRoomSeq", "hasMore", "eventCursor"],
      "RoomEventReadResponse",
    );
    requireArrayLimit(data.events, "events");
    const events = data.events.map(validateEventDto);
    requireNonNegativeSequence(data.latestRoomSeq, "latestRoomSeq");
    const latestRoomSeq = data.latestRoomSeq;
    requireBoolean(data.hasMore, "hasMore");
    requireResponseCursor(data.eventCursor, "eventCursor");
    requireStrictlyIncreasing(events.map((event) => event.roomSeq), "events");
    if (data.hasMore && events.length === 0) {
      throw new Error("event page must make progress when hasMore is true");
    }
    if (events.some((event) => event.roomSeq > latestRoomSeq)) {
      throw new Error("Room event exceeds the reported Room head");
    }
    return { ...data, events } as RoomEventReadResponse;
  }
  if (data.mode === "older_messages") {
    rejectUnknownKeys(
      data,
      ["mode", "messages", "hasMore", "olderMessagesCursor"],
      "RoomOlderMessagesReadResponse",
    );
    requireArrayLimit(data.messages, "messages");
    const messages = data.messages.map(validateMessage);
    requireStrictlyIncreasing(messages.map((message) => message.roomSeq), "messages");
    requireBoolean(data.hasMore, "hasMore");
    requireResponseCursor(data.olderMessagesCursor, "olderMessagesCursor", true);
    if (data.hasMore !== (typeof data.olderMessagesCursor === "string")) {
      throw new Error("olderMessagesCursor must be present exactly when hasMore is true");
    }
    if (data.hasMore && messages.length === 0) {
      throw new Error("older message page must make progress when hasMore is true");
    }
    return { ...data, messages } as RoomOlderMessagesReadResponse;
  }
  if (data.mode === "inbox_page") {
    rejectUnknownKeys(data, ["mode", "items", "inboxCursor"], "RoomInboxReadResponse");
    requireArrayLimit(data.items, "items");
    const items = data.items.map(validateInboxItem);
    requireStrictlyIncreasing(items.map((item) => item.inboxSeq), "Inbox items");
    requireResponseCursor(data.inboxCursor, "inboxCursor");
    return { ...data, items } as RoomInboxReadResponse;
  }
  if (data.mode === "room_list") {
    rejectUnknownKeys(
      data,
      ["mode", "items", "hasMore", "roomListCursor"],
      "RoomListReadResponse",
    );
    requireArrayLimit(data.items, "items");
    const items = data.items.map(validateListItem);
    requireBoolean(data.hasMore, "hasMore");
    requireResponseCursor(data.roomListCursor, "roomListCursor", true);
    if (data.hasMore !== (typeof data.roomListCursor === "string")) {
      throw new Error("roomListCursor must be present exactly when hasMore is true");
    }
    if (data.hasMore && items.length === 0) {
      throw new Error("Room list page must make progress when hasMore is true");
    }
    const roomIds = new Set(items.map((item) => item.room.roomId));
    if (roomIds.size !== items.length) throw new Error("Room list contains duplicate Rooms");
    return { ...data, items } as RoomListReadResponse;
  }
  throw new Error("RoomReadResponseData.mode is unsupported");
}

/** Strict runtime boundary used before browser code trusts a Room response. */
export function validateRoomReadHttpEnvelope(
  value: unknown,
  expectedMode?: RoomReadResponseMode,
  expectedRoomId?: string,
): RoomReadHttpEnvelope {
  const envelope = recordPayload(value, "RoomReadHttpEnvelope");
  if (envelope.ok === true) {
    rejectUnknownKeys(envelope, ["ok", "data"], "RoomReadHttpEnvelope");
    const data = validateResponseData(envelope.data);
    if (expectedMode !== undefined && data.mode !== expectedMode) {
      throw new Error(`expected Room response mode ${expectedMode}`);
    }
    if (expectedRoomId !== undefined) {
      if (data.mode === "latest_bootstrap" && data.snapshot.room.roomId !== expectedRoomId) {
        throw new Error("Room bootstrap response does not match the requested Room");
      }
      if (data.mode === "event_page" && data.events.some((event) =>
        event.roomId !== expectedRoomId)) {
        throw new Error("Room event response does not match the requested Room");
      }
      if (data.mode === "older_messages" && data.messages.some((message) =>
        message.roomId !== expectedRoomId)) {
        throw new Error("Room message response does not match the requested Room");
      }
    }
    return { ok: true, data };
  }
  if (envelope.ok === false) {
    rejectUnknownKeys(envelope, ["ok", "error"], "RoomReadHttpEnvelope");
    const error = recordPayload(envelope.error, "RoomReadHttpEnvelope.error");
    rejectUnknownKeys(error, ["code", "message"], "RoomReadHttpEnvelope.error");
    if (
      (error.code !== "internal" && !ROOM_ERROR_CODES.includes(error.code as RoomErrorCode)) ||
      typeof error.message !== "string" ||
      !error.message ||
      error.message.length > 512
    ) throw new Error("RoomReadHttpEnvelope.error is invalid");
    return {
      ok: false,
      error: { code: error.code as RoomReadWireErrorCode, message: error.message },
    };
  }
  throw new Error("RoomReadHttpEnvelope.ok must be a boolean");
}
