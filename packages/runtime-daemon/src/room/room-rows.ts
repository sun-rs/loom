import type {
  RoomEvent,
  RoomInboxItem,
  RoomMembership,
  RoomMessage,
  RoomOutboxEntry,
  RoomPrincipal,
  RoomRecord,
} from "@rah/runtime-protocol";

export type RoomSqlRow = Record<string, unknown>;

export function text(row: RoomSqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`expected ${key} to be text`);
  return value;
}

export function optionalText(row: RoomSqlRow, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`expected ${key} to be text or null`);
  return value;
}

export function integer(row: RoomSqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`expected ${key} to be an integer`);
  }
  return value;
}

export function principalFromRow(row: RoomSqlRow): RoomPrincipal {
  const displayName = optionalText(row, "display_name");
  return {
    principalId: text(row, "principal_id"),
    handle: text(row, "handle"),
    kind: text(row, "kind") as RoomPrincipal["kind"],
    ...(displayName ? { displayName } : {}),
    createdAt: text(row, "created_at"),
  };
}

export function roomFromRow(row: RoomSqlRow): RoomRecord {
  const archivedAt = optionalText(row, "archived_at");
  return {
    roomId: text(row, "room_id"),
    workspaceKey: text(row, "workspace_key"),
    kind: text(row, "kind") as RoomRecord["kind"],
    slug: text(row, "slug"),
    name: text(row, "name"),
    visibility: text(row, "visibility") as RoomRecord["visibility"],
    createdAt: text(row, "created_at"),
    ...(archivedAt ? { archivedAt } : {}),
  };
}

export function membershipFromRow(row: RoomSqlRow): RoomMembership {
  return {
    roomId: text(row, "room_id"),
    principalId: text(row, "principal_id"),
    role: text(row, "role") as RoomMembership["role"],
    joinedAt: text(row, "joined_at"),
  };
}

export function eventFromRow(row: RoomSqlRow): RoomEvent {
  return {
    eventId: text(row, "event_id"),
    roomId: text(row, "room_id"),
    roomSeq: integer(row, "room_seq"),
    type: text(row, "type"),
    actorId: text(row, "actor_id"),
    aggregateType: text(row, "aggregate_type"),
    aggregateId: text(row, "aggregate_id"),
    payload: JSON.parse(text(row, "payload_json")) as Record<string, unknown>,
    idempotencyKey: text(row, "idempotency_key"),
    schemaVersion: 1,
    createdAt: text(row, "created_at"),
  };
}

export function messageFromRow(row: RoomSqlRow): RoomMessage {
  return {
    messageId: text(row, "message_id"),
    roomId: text(row, "room_id"),
    roomSeq: integer(row, "room_seq"),
    actorId: text(row, "actor_id"),
    body: text(row, "body"),
    createdAt: text(row, "created_at"),
  };
}

export function inboxFromRow(row: RoomSqlRow): RoomInboxItem {
  const acknowledgedAt = optionalText(row, "acknowledged_at");
  return {
    inboxSeq: integer(row, "inbox_seq"),
    inboxItemId: text(row, "inbox_item_id"),
    roomId: text(row, "room_id"),
    participantId: text(row, "participant_id"),
    eventId: text(row, "event_id"),
    eventSeq: integer(row, "event_seq"),
    reason: text(row, "reason") as RoomInboxItem["reason"],
    state: text(row, "state") as RoomInboxItem["state"],
    createdAt: text(row, "created_at"),
    ...(acknowledgedAt ? { acknowledgedAt } : {}),
  };
}

export function outboxFromRow(row: RoomSqlRow): RoomOutboxEntry {
  const leaseOwner = optionalText(row, "lease_owner");
  const leaseToken = optionalText(row, "lease_token");
  const leaseExpiresAt = optionalText(row, "lease_expires_at");
  const lastError = optionalText(row, "last_error");
  const publishedBy = optionalText(row, "published_by");
  const publishedAt = optionalText(row, "published_at");
  const quarantinedAt = optionalText(row, "quarantined_at");
  const blockedAt = optionalText(row, "blocked_at");
  const failureClass = optionalText(row, "failure_class");
  const actionRequired = optionalText(row, "action_required");
  const lastAttemptId = optionalText(row, "last_attempt_id");
  const deliveryReceipt = optionalText(row, "delivery_receipt");
  return {
    outboxSeq: integer(row, "outbox_seq"),
    outboxId: text(row, "outbox_id"),
    roomId: text(row, "room_id"),
    roomSeq: integer(row, "room_seq"),
    topic: text(row, "topic") as RoomOutboxEntry["topic"],
    payload: quarantinedAt
      ? {}
      : JSON.parse(text(row, "payload_json")) as Record<string, unknown>,
    createdAt: text(row, "created_at"),
    availableAt: text(row, "available_at"),
    attemptCount: integer(row, "attempt_count"),
    ...(leaseOwner ? { leaseOwner } : {}),
    ...(leaseToken ? { leaseToken } : {}),
    ...(leaseExpiresAt ? { leaseExpiresAt } : {}),
    ...(lastError ? { lastError } : {}),
    ...(quarantinedAt ? { quarantinedAt } : {}),
    ...(blockedAt ? { blockedAt } : {}),
    ...(failureClass ? { failureClass } : {}),
    ...(actionRequired ? { actionRequired } : {}),
    ...(integer(row, "sticky") === 1 ? { sticky: true } : {}),
    ...(lastAttemptId ? { lastAttemptId } : {}),
    ...(deliveryReceipt ? { deliveryReceipt } : {}),
    ...(publishedBy ? { publishedBy } : {}),
    ...(publishedAt ? { publishedAt } : {}),
  };
}
