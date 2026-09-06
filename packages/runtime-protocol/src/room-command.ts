import type {
  AcknowledgeRoomRequest,
  AcknowledgeRoomInboxItemRequest,
  AcknowledgeRoomMessageRequest,
  AddRoomMemberRequest,
  CreateRoomRequest,
  PostRoomMessageRequest,
} from "./room";
import {
  assertRoomTextStorageSafe,
  validateAcknowledgeRoomMessageRequest,
  validateAcknowledgeRoomInboxItemRequest,
  validateAcknowledgeRoomRequest,
  validateAddRoomMemberRequest,
  validateCreateRoomRequest,
  validatePostRoomMessageRequest,
} from "./room";
import {
  ROOM_ERROR_CODES,
  type RoomErrorCode,
  type RoomReadWireErrorCode,
} from "./room-read";

export type RoomHumanCommandOperation =
  | "create_room"
  | "add_member"
  | "post_message"
  | "acknowledge_room"
  | "acknowledge_inbox_item"
  | "acknowledge_message"
  | "create_task"
  | "accept_task"
  | "cancel_task";

export interface CreateRoomTaskRequest {
  roomId: string;
  sourceMessageId: string;
  title: string;
  description?: string;
  assigneeId: string;
  reviewerIds: string[];
  dependencyTaskIds?: string[];
  basedOnRoomSeq: number;
  idempotencyKey: string;
}

export interface AcceptRoomTaskRequest {
  roomId: string;
  taskId: string;
  basedOnRoomSeq: number;
  summary: string;
  idempotencyKey: string;
}

export interface CancelRoomTaskRequest {
  roomId: string;
  taskId: string;
  basedOnRoomSeq: number;
  reason: string;
  idempotencyKey: string;
}

export type RoomHumanCommandRequest =
  | CreateRoomRequest
  | AddRoomMemberRequest
  | PostRoomMessageRequest
  | AcknowledgeRoomRequest
  | AcknowledgeRoomInboxItemRequest
  | AcknowledgeRoomMessageRequest
  | CreateRoomTaskRequest
  | AcceptRoomTaskRequest
  | CancelRoomTaskRequest;

export interface RoomCommandReceipt {
  operation: RoomHumanCommandOperation;
  roomId: string;
  aggregateId: string;
  roomSeq: number;
  deduplicated: boolean;
}

export type RoomCommandHttpEnvelope =
  | { ok: true; data: RoomCommandReceipt }
  | { ok: false; error: { code: RoomReadWireErrorCode; message: string } };

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, fields: readonly string[], name: string): void {
  const accepted = new Set(fields);
  const unknown = Object.keys(value).find((field) => !accepted.has(field));
  if (unknown) throw new Error(`${name} contains unknown field ${unknown}`);
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new Error(`${name} must be a stable identifier`);
  }
  return value;
}

function identifiers(value: unknown, name: string, required: boolean): string[] | undefined {
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || (required && value.length === 0) || value.length > 100) {
    throw new Error(`${name} must contain ${required ? "1 to" : "at most"} 100 identifiers`);
  }
  const result = value.map((item) => identifier(item, `${name}[]`));
  if (new Set(result).size !== result.length) throw new Error(`${name} must not contain duplicates`);
  return [...result].sort();
}

export function validateCreateRoomTaskRequest(value: unknown): CreateRoomTaskRequest {
  const input = object(value, "CreateRoomTaskRequest");
  exact(input, [
    "roomId", "sourceMessageId", "title", "description", "assigneeId",
    "reviewerIds", "dependencyTaskIds", "basedOnRoomSeq", "idempotencyKey",
  ], "CreateRoomTaskRequest");
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 240) throw new Error("title must contain 1 to 240 characters");
  assertRoomTextStorageSafe(title, "title");
  const description = input.description;
  if (description !== undefined && (typeof description !== "string" || description.length > 8_192)) {
    throw new Error("description must contain at most 8192 characters");
  }
  if (typeof description === "string") assertRoomTextStorageSafe(description, "description");
  if (!Number.isSafeInteger(input.basedOnRoomSeq) || Number(input.basedOnRoomSeq) < 0) {
    throw new Error("basedOnRoomSeq must be a non-negative safe integer");
  }
  const reviewerIds = identifiers(input.reviewerIds, "reviewerIds", true)!;
  if (reviewerIds.includes(identifier(input.assigneeId, "assigneeId"))) {
    throw new Error("assigneeId cannot also be a reviewer");
  }
  const dependencyTaskIds = identifiers(input.dependencyTaskIds, "dependencyTaskIds", false);
  return {
    roomId: identifier(input.roomId, "roomId"),
    sourceMessageId: identifier(input.sourceMessageId, "sourceMessageId"),
    title,
    ...(description !== undefined ? { description } : {}),
    assigneeId: identifier(input.assigneeId, "assigneeId"),
    reviewerIds,
    ...(dependencyTaskIds?.length ? { dependencyTaskIds } : {}),
    basedOnRoomSeq: Number(input.basedOnRoomSeq),
    idempotencyKey: identifier(input.idempotencyKey, "idempotencyKey"),
  };
}

function validateTaskDecisionRequest(
  value: unknown,
  kind: "accept" | "cancel",
): AcceptRoomTaskRequest | CancelRoomTaskRequest {
  const input = object(value, kind === "accept" ? "AcceptRoomTaskRequest" : "CancelRoomTaskRequest");
  const textField = kind === "accept" ? "summary" : "reason";
  exact(input, ["roomId", "taskId", "basedOnRoomSeq", textField, "idempotencyKey"], `${kind} Task request`);
  const content = typeof input[textField] === "string" ? input[textField].trim() : "";
  if (!content || content.length > 8_192) throw new Error(`${textField} must contain 1 to 8192 characters`);
  assertRoomTextStorageSafe(content, textField);
  if (!Number.isSafeInteger(input.basedOnRoomSeq) || Number(input.basedOnRoomSeq) < 0) {
    throw new Error("basedOnRoomSeq must be a non-negative safe integer");
  }
  const shared = {
    roomId: identifier(input.roomId, "roomId"),
    taskId: identifier(input.taskId, "taskId"),
    basedOnRoomSeq: Number(input.basedOnRoomSeq),
    idempotencyKey: identifier(input.idempotencyKey, "idempotencyKey"),
  };
  return kind === "accept"
    ? { ...shared, summary: content }
    : { ...shared, reason: content };
}

export function validateRoomHumanCommandRequest(
  operation: RoomHumanCommandOperation,
  value: unknown,
): RoomHumanCommandRequest {
  switch (operation) {
    case "create_room": return validateCreateRoomRequest(value);
    case "add_member": return validateAddRoomMemberRequest(value);
    case "post_message": return validatePostRoomMessageRequest(value);
    case "acknowledge_room": return validateAcknowledgeRoomRequest(value);
    case "acknowledge_inbox_item": return validateAcknowledgeRoomInboxItemRequest(value);
    case "acknowledge_message": return validateAcknowledgeRoomMessageRequest(value);
    case "create_task": return validateCreateRoomTaskRequest(value);
    case "accept_task": return validateTaskDecisionRequest(value, "accept");
    case "cancel_task": return validateTaskDecisionRequest(value, "cancel");
  }
}

export function validateRoomCommandHttpEnvelope(
  value: unknown,
  expectedOperation: RoomHumanCommandOperation,
): RoomCommandHttpEnvelope {
  const envelope = object(value, "RoomCommandHttpEnvelope");
  if (envelope.ok === true) {
    exact(envelope, ["ok", "data"], "RoomCommandHttpEnvelope");
    const data = object(envelope.data, "RoomCommandReceipt");
    exact(data, ["operation", "roomId", "aggregateId", "roomSeq", "deduplicated"], "RoomCommandReceipt");
    if (data.operation !== expectedOperation) throw new Error("Room command operation does not match");
    if (!Number.isSafeInteger(data.roomSeq) || Number(data.roomSeq) < 1) {
      throw new Error("RoomCommandReceipt.roomSeq must be a positive safe integer");
    }
    if (typeof data.deduplicated !== "boolean") {
      throw new Error("RoomCommandReceipt.deduplicated must be boolean");
    }
    return {
      ok: true,
      data: {
        operation: expectedOperation,
        roomId: identifier(data.roomId, "RoomCommandReceipt.roomId"),
        aggregateId: identifier(data.aggregateId, "RoomCommandReceipt.aggregateId"),
        roomSeq: Number(data.roomSeq),
        deduplicated: data.deduplicated,
      },
    };
  }
  if (envelope.ok === false) {
    exact(envelope, ["ok", "error"], "RoomCommandHttpEnvelope");
    const error = object(envelope.error, "RoomCommandHttpEnvelope.error");
    exact(error, ["code", "message"], "RoomCommandHttpEnvelope.error");
    if (
      (error.code !== "internal" &&
        !ROOM_ERROR_CODES.includes(error.code as RoomErrorCode)) ||
      typeof error.message !== "string" ||
      !error.message ||
      error.message.length > 512
    ) {
      throw new Error("Room command error is invalid");
    }
    return {
      ok: false,
      error: {
        code: error.code as RoomReadWireErrorCode,
        message: error.message,
      },
    };
  }
  throw new Error("RoomCommandHttpEnvelope.ok must be boolean");
}
