export type RoomParticipantKind = "human" | "agent" | "service";
export type RoomKind = "channel" | "direct" | "control";
export type RoomVisibility = "public" | "private";
export type RoomMembershipRole = "owner" | "admin" | "member";
import type { RoomAgentAvatarKey } from "./room-avatar";
export type RoomAttentionReason =
  | "mention"
  | "direct_message"
  | "room_policy"
  | "task_assignment"
  | "dependency_resolved"
  | "input_resolved";

/**
 * Inbox entries are durable user/agent notifications. Only entries explicitly
 * classified as activation work may create an Agent Activation.
 */
export type RoomInboxDisposition = "activation" | "notification";

export type RoomInboxEventType =
  | "message.posted"
  | "task.created"
  | "task.submitted"
  | "task.completed"
  | "task.cancelled"
  | "task.dependency_resolved"
  | "review.submitted";

export interface RoomPrincipal {
  principalId: string;
  handle: string;
  kind: RoomParticipantKind;
  displayName?: string;
  avatarKey?: RoomAgentAvatarKey;
  createdAt: string;
}

export interface RoomRecord {
  roomId: string;
  workspaceKey: string;
  kind: RoomKind;
  slug: string;
  name: string;
  visibility: RoomVisibility;
  createdAt: string;
  archivedAt?: string;
}

export interface RoomMembership {
  roomId: string;
  principalId: string;
  role: RoomMembershipRole;
  joinedAt: string;
}

export interface RoomMessage {
  messageId: string;
  roomId: string;
  roomSeq: number;
  actorId: string;
  body: string;
  threadId?: string;
  rootMessageId?: string;
  replyToMessageId?: string;
  createdAt: string;
}

export interface RoomEvent {
  eventId: string;
  roomId: string;
  roomSeq: number;
  type: string;
  actorId: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  schemaVersion: 1;
  createdAt: string;
}

export interface RoomInboxItem {
  inboxSeq: number;
  inboxItemId: string;
  roomId: string;
  participantId: string;
  eventId: string;
  eventSeq: number;
  /** Read-time event classification used for precise notification copy. */
  eventType?: RoomInboxEventType;
  aggregateType: "message" | "task" | "review";
  aggregateId: string;
  /** Canonical Task target, including Review events whose aggregate is a Review. */
  taskId?: string;
  reviewDisposition?: "approved" | "changes_requested";
  reason: RoomAttentionReason;
  disposition: RoomInboxDisposition;
  state: "pending" | "acknowledged";
  createdAt: string;
  acknowledgedAt?: string;
}

export interface RoomOutboxEntry {
  outboxSeq: number;
  outboxId: string;
  roomId: string;
  roomSeq: number;
  topic: "room.event" | "inbox.available";
  payload: Record<string, unknown>;
  createdAt: string;
  availableAt: string;
  attemptCount: number;
  leaseOwner?: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
  lastError?: string;
  quarantinedAt?: string;
  blockedAt?: string;
  failureClass?: string;
  actionRequired?: string;
  sticky?: boolean;
  lastAttemptId?: string;
  deliveryReceipt?: string;
  publishedBy?: string;
  publishedAt?: string;
}

export interface CreateRoomRequest {
  roomId?: string;
  workspaceKey: string;
  kind: Exclude<RoomKind, "control">;
  slug: string;
  name: string;
  visibility?: Extract<RoomVisibility, "private">;
  idempotencyKey: string;
}

export interface AddRoomMemberRequest {
  roomId: string;
  principalId: string;
  role: RoomMembershipRole;
  basedOnRoomSeq: number;
  idempotencyKey: string;
}

export interface PostRoomMessageRequest {
  roomId: string;
  body: string;
  mentionedPrincipalIds?: string[];
  replyToMessageId?: string;
  idempotencyKey: string;
}

export interface AcknowledgeRoomMessageRequest {
  roomId: string;
  messageId: string;
  basedOnRoomSeq: number;
  idempotencyKey: string;
}

export interface AcknowledgeRoomInboxItemRequest {
  roomId: string;
  inboxItemId: string;
  eventId: string;
  basedOnRoomSeq: number;
  idempotencyKey: string;
}

export interface AcknowledgeRoomRequest {
  roomId: string;
  throughRoomSeq: number;
  basedOnRoomSeq: number;
  idempotencyKey: string;
}

export interface SyncRoomRequest {
  roomId: string;
  afterSeq?: number;
  throughSeq?: number;
  limit?: number;
  bootstrap?: "latest";
}

export interface RoomSnapshot {
  room: RoomRecord;
  memberships: RoomMembership[];
  principals: RoomPrincipal[];
}

interface RoomSyncBase {
  cursorBefore: number;
  cursorAfter: number;
  latestRoomSeq: number;
  throughSeq: number;
  responseBytes: number;
}

export interface RoomEventPage extends RoomSyncBase {
  mode: "event_page";
  hasMore: boolean;
  snapshot: null;
  events: RoomEvent[];
}

export interface RoomLatestBootstrap extends RoomSyncBase {
  mode: "latest_bootstrap";
  messageFloorSeq: number;
  snapshotSeq: number;
  snapshot: RoomSnapshot;
  recentMessages: RoomMessage[];
}

export type RoomSyncResult = RoomEventPage | RoomLatestBootstrap;

export interface RoomMessagePage {
  mode: "forward" | "backward";
  cursorBefore: number;
  cursorAfter: number;
  throughRoomSeq: number;
  hasMore: boolean;
  responseBytes: number;
  messages: RoomMessage[];
}

export interface RoomMutationResult<T> {
  value: T;
  event: RoomEvent;
  deduplicated: boolean;
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * SQLite TEXT and JSON must observe the same JavaScript string. Embedded NUL
 * and isolated UTF-16 surrogates do not round-trip through node:sqlite.
 */
export function assertRoomTextStorageSafe(value: string, field: string): void {
  if (value.includes("\u0000")) {
    throw new Error(`${field} must not contain U+0000`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw new Error(`${field} must contain well-formed Unicode`);
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new Error(`${field} must contain well-formed Unicode`);
    }
  }
}

function requireIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new Error(`${field} must be a stable identifier`);
  }
}

function requireObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], name: string) {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) {
    throw new Error(`${name} contains unknown field ${unknown[0]}`);
  }
}

export function validateCreateRoomRequest(value: unknown): CreateRoomRequest {
  requireObject(value, "CreateRoomRequest");
  rejectUnknownKeys(
    value,
    ["roomId", "workspaceKey", "kind", "slug", "name", "visibility", "idempotencyKey"],
    "CreateRoomRequest",
  );
  if (value.roomId !== undefined) requireIdentifier(value.roomId, "roomId");
  requireIdentifier(value.workspaceKey, "workspaceKey");
  requireIdentifier(value.slug, "slug");
  requireIdentifier(value.idempotencyKey, "idempotencyKey");
  if (value.kind !== "channel" && value.kind !== "direct") {
    throw new Error("client-created Room kind must be channel or direct");
  }
  if (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > 120) {
    throw new Error("name must contain 1 to 120 characters");
  }
  assertRoomTextStorageSafe(value.name, "name");
  if (value.visibility !== undefined && value.visibility !== "private") {
    throw new Error("client-created Rooms are private until workspace ACL is available");
  }
  return {
    ...(value.roomId !== undefined ? { roomId: value.roomId as string } : {}),
    workspaceKey: value.workspaceKey as string,
    kind: value.kind,
    slug: value.slug as string,
    name: value.name.trim(),
    visibility: "private",
    idempotencyKey: value.idempotencyKey as string,
  };
}

export function validateAddRoomMemberRequest(value: unknown): AddRoomMemberRequest {
  requireObject(value, "AddRoomMemberRequest");
  rejectUnknownKeys(
    value,
    ["roomId", "principalId", "role", "basedOnRoomSeq", "idempotencyKey"],
    "AddRoomMemberRequest",
  );
  requireIdentifier(value.roomId, "roomId");
  requireIdentifier(value.principalId, "principalId");
  requireIdentifier(value.idempotencyKey, "idempotencyKey");
  if (value.role !== "owner" && value.role !== "admin" && value.role !== "member") {
    throw new Error("role must be owner, admin, or member");
  }
  if (!Number.isInteger(value.basedOnRoomSeq) || Number(value.basedOnRoomSeq) < 0) {
    throw new Error("basedOnRoomSeq must be a non-negative integer");
  }
  return value as unknown as AddRoomMemberRequest;
}

export function validatePostRoomMessageRequest(value: unknown): PostRoomMessageRequest {
  requireObject(value, "PostRoomMessageRequest");
  rejectUnknownKeys(
    value,
    ["roomId", "body", "mentionedPrincipalIds", "replyToMessageId", "idempotencyKey"],
    "PostRoomMessageRequest",
  );
  requireIdentifier(value.roomId, "roomId");
  requireIdentifier(value.idempotencyKey, "idempotencyKey");
  if (value.replyToMessageId !== undefined) {
    requireIdentifier(value.replyToMessageId, "replyToMessageId");
  }
  if (typeof value.body !== "string" || !value.body.trim() || value.body.length > 100_000) {
    throw new Error("body must contain 1 to 100000 characters");
  }
  assertRoomTextStorageSafe(value.body, "body");
  if (value.mentionedPrincipalIds !== undefined) {
    if (!Array.isArray(value.mentionedPrincipalIds) || value.mentionedPrincipalIds.length > 100) {
      throw new Error("mentionedPrincipalIds must be an array with at most 100 mentions");
    }
    for (const principalId of value.mentionedPrincipalIds) {
      requireIdentifier(principalId, "mentionedPrincipalIds[]");
    }
    if (new Set(value.mentionedPrincipalIds).size !== value.mentionedPrincipalIds.length) {
      throw new Error("mentionedPrincipalIds must not contain duplicates");
    }
  }
  const mentionedPrincipalIds = value.mentionedPrincipalIds as string[] | undefined;
  return {
    roomId: value.roomId as string,
    body: value.body,
    ...(mentionedPrincipalIds && mentionedPrincipalIds.length > 0
      ? { mentionedPrincipalIds: [...mentionedPrincipalIds].sort() }
      : {}),
    ...(value.replyToMessageId !== undefined
      ? { replyToMessageId: value.replyToMessageId as string }
      : {}),
    idempotencyKey: value.idempotencyKey as string,
  };
}

export function validateAcknowledgeRoomMessageRequest(
  value: unknown,
): AcknowledgeRoomMessageRequest {
  requireObject(value, "AcknowledgeRoomMessageRequest");
  rejectUnknownKeys(
    value,
    ["roomId", "messageId", "basedOnRoomSeq", "idempotencyKey"],
    "AcknowledgeRoomMessageRequest",
  );
  requireIdentifier(value.roomId, "roomId");
  requireIdentifier(value.messageId, "messageId");
  requireIdentifier(value.idempotencyKey, "idempotencyKey");
  if (!Number.isInteger(value.basedOnRoomSeq) || Number(value.basedOnRoomSeq) < 0) {
    throw new Error("basedOnRoomSeq must be a non-negative integer");
  }
  return value as unknown as AcknowledgeRoomMessageRequest;
}

export function validateAcknowledgeRoomInboxItemRequest(
  value: unknown,
): AcknowledgeRoomInboxItemRequest {
  requireObject(value, "AcknowledgeRoomInboxItemRequest");
  rejectUnknownKeys(
    value,
    ["roomId", "inboxItemId", "eventId", "basedOnRoomSeq", "idempotencyKey"],
    "AcknowledgeRoomInboxItemRequest",
  );
  for (const field of ["roomId", "inboxItemId", "eventId", "idempotencyKey"] as const) {
    requireIdentifier(value[field], field);
  }
  if (!Number.isSafeInteger(value.basedOnRoomSeq) || Number(value.basedOnRoomSeq) < 0) {
    throw new Error("basedOnRoomSeq must be a non-negative safe integer");
  }
  return value as unknown as AcknowledgeRoomInboxItemRequest;
}

export function validateAcknowledgeRoomRequest(value: unknown): AcknowledgeRoomRequest {
  requireObject(value, "AcknowledgeRoomRequest");
  rejectUnknownKeys(
    value,
    ["roomId", "throughRoomSeq", "basedOnRoomSeq", "idempotencyKey"],
    "AcknowledgeRoomRequest",
  );
  requireIdentifier(value.roomId, "roomId");
  requireIdentifier(value.idempotencyKey, "idempotencyKey");
  for (const field of ["throughRoomSeq", "basedOnRoomSeq"] as const) {
    if (!Number.isSafeInteger(value[field]) || Number(value[field]) < 0) {
      throw new Error(`${field} must be a non-negative safe integer`);
    }
  }
  if (Number(value.throughRoomSeq) > Number(value.basedOnRoomSeq)) {
    throw new Error("throughRoomSeq cannot exceed basedOnRoomSeq");
  }
  return value as unknown as AcknowledgeRoomRequest;
}

export function validateSyncRoomRequest(value: unknown): SyncRoomRequest {
  requireObject(value, "SyncRoomRequest");
  rejectUnknownKeys(
    value,
    ["roomId", "afterSeq", "throughSeq", "limit", "bootstrap"],
    "SyncRoomRequest",
  );
  requireIdentifier(value.roomId, "roomId");
  if (value.bootstrap !== undefined && value.bootstrap !== "latest") {
    throw new Error("bootstrap must be latest");
  }
  if (
    value.bootstrap !== undefined &&
    (value.afterSeq !== undefined || value.throughSeq !== undefined)
  ) {
    throw new Error("latest bootstrap cannot include afterSeq or throughSeq");
  }
  for (const key of ["afterSeq", "throughSeq"] as const) {
    if (value[key] !== undefined && (!Number.isInteger(value[key]) || Number(value[key]) < 0)) {
      throw new Error(`${key} must be a non-negative integer`);
    }
  }
  const limit = value.limit;
  if (
    limit !== undefined &&
    (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 500)
  ) {
    throw new Error("limit must be between 1 and 500");
  }
  return value as unknown as SyncRoomRequest;
}
