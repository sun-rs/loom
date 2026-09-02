import {
  ActivationReasonSchema,
  ActivationSchema,
  InboxStateSchema,
  InputRequestSchema,
  type Activation,
  type InputRequest,
} from "@rah-os/protocol";

import {
  integer,
  jsonObject,
  nullableText,
  text,
  type Row,
} from "./sqlite-row.ts";
import type { InboxItem, OutboxEntry } from "./types.ts";

export function inputRequestProjectionFromRow(row: Row): InputRequest {
  const answer = nullableText(row, "answer");
  const resolvedBy = nullableText(row, "resolved_by");
  const resolvedAt = nullableText(row, "resolved_at");
  const cancelledAt = nullableText(row, "cancelled_at");
  const cancelledBy = nullableText(row, "cancelled_by");
  const cancellationReason = nullableText(row, "cancellation_reason");
  return InputRequestSchema.parse({
    inputRequestId: text(row, "input_request_id"),
    roomId: text(row, "room_id"),
    taskId: text(row, "task_id"),
    requesterId: text(row, "requester_id"),
    responderId: text(row, "responder_id"),
    question: text(row, "question"),
    state: text(row, "state"),
    ...(answer === null ? {} : { answer }),
    ...(resolvedBy === null ? {} : { resolvedBy }),
    ...(cancelledAt === null ? {} : { cancelledAt }),
    ...(cancelledBy === null ? {} : { cancelledBy }),
    ...(cancellationReason === null ? {} : { cancellationReason }),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
    ...(resolvedAt === null ? {} : { resolvedAt }),
  });
}

export function activationProjectionFromRow(row: Row): Activation {
  const leaseOwner = nullableText(row, "lease_owner");
  const leaseUntil = nullableText(row, "lease_until");
  const lastError = nullableText(row, "last_error");
  return ActivationSchema.parse({
    activationId: text(row, "activation_id"),
    roomId: text(row, "room_id"),
    participantId: text(row, "participant_id"),
    fromSeq: integer(row, "from_seq"),
    toSeq: integer(row, "to_seq"),
    reason: text(row, "reason"),
    state: text(row, "state"),
    ...(leaseOwner === null ? {} : { leaseOwner }),
    ...(leaseUntil === null ? {} : { leaseUntil }),
    attemptCount: integer(row, "attempt_count"),
    availableAt: text(row, "available_at"),
    ...(lastError === null ? {} : { lastError }),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  });
}

export function inboxProjectionFromRow(row: Row): InboxItem {
  const acknowledgedAt = nullableText(row, "acknowledged_at");
  return {
    inboxItemId: text(row, "inbox_item_id"),
    roomId: text(row, "room_id"),
    participantId: text(row, "participant_id"),
    eventId: text(row, "event_id"),
    eventSeq: integer(row, "event_seq"),
    reason: ActivationReasonSchema.parse(text(row, "reason")),
    state: InboxStateSchema.parse(text(row, "state")),
    createdAt: text(row, "created_at"),
    ...(acknowledgedAt === null ? {} : { acknowledgedAt }),
  };
}

export function outboxProjectionFromRow(row: Row): OutboxEntry {
  const publishedAt = nullableText(row, "published_at");
  const leaseOwner = nullableText(row, "lease_owner");
  const leaseUntil = nullableText(row, "lease_until");
  const lastError = nullableText(row, "last_error");
  return {
    outboxId: text(row, "outbox_id"),
    roomId: text(row, "room_id"),
    roomSeq: integer(row, "room_seq"),
    topic: text(row, "topic"),
    payload: jsonObject(row, "payload_json"),
    createdAt: text(row, "created_at"),
    availableAtMs: integer(row, "available_at_ms"),
    attemptCount: integer(row, "attempt_count"),
    ...(publishedAt === null ? {} : { publishedAt }),
    ...(leaseOwner === null ? {} : { leaseOwner }),
    ...(leaseUntil === null ? {} : { leaseUntil }),
    ...(lastError === null ? {} : { lastError }),
  };
}
