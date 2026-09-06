import type {
  RoomBootstrapReadRequest,
  RoomBootstrapReadResponse,
  RoomEventReadRequest,
  RoomEventReadResponse,
  RoomInboxReadRequest,
  RoomInboxReadResponse,
  RoomListReadRequest,
  RoomListReadResponse,
  RoomTaskListReadRequest,
  RoomTaskListReadResponse,
  RoomOlderMessagesReadRequest,
  RoomOlderMessagesReadResponse,
  RoomReadResponseMode,
  RoomReadWireErrorCode,
  RoomCommandReceipt,
  RoomHumanCommandOperation,
  CreateRoomRequest,
  AddRoomMemberRequest,
  PostRoomMessageRequest,
  AcknowledgeRoomRequest,
  AcknowledgeRoomInboxItemRequest,
  AcknowledgeRoomMessageRequest,
  CreateRoomTaskRequest,
  AcceptRoomTaskRequest,
  CancelRoomTaskRequest,
} from "@rah/runtime-protocol";
import {
  ROOM_READ_HTTP_STATUS_BY_ERROR_CODE,
  validateRoomCommandHttpEnvelope,
  validateRoomReadHttpEnvelope,
} from "@rah/runtime-protocol";

import {
  buildRequestHeaders,
  getBaseUrl,
  isAbortError,
  RAH_AUTH_REQUIRED_EVENT,
} from "./api-transport";

export class RoomApiError extends Error {
  readonly status: number;
  readonly code: RoomReadWireErrorCode;

  constructor(status: number, code: RoomReadWireErrorCode, message: string) {
    super(message);
    this.name = "RoomApiError";
    this.status = status;
    this.code = code;
  }
}

export class RoomApiProtocolError extends Error {
  constructor(message = "Room response violates the typed transport contract") {
    super(message);
    this.name = "RoomApiProtocolError";
  }
}

function parseEnvelope<T>(
  raw: string,
  response: Response,
  expectedMode: RoomReadResponseMode,
  expectedRoomId?: string,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RoomApiProtocolError("Room endpoint returned non-JSON data");
  }
  let envelope;
  try {
    envelope = validateRoomReadHttpEnvelope(parsed, expectedMode, expectedRoomId);
  } catch (error) {
    throw new RoomApiProtocolError(
      error instanceof Error ? error.message : undefined,
    );
  }
  if (!envelope.ok) {
    const expectedStatus = ROOM_READ_HTTP_STATUS_BY_ERROR_CODE[envelope.error.code];
    if (response.ok || response.status !== expectedStatus) {
      throw new RoomApiProtocolError("Room error code and HTTP status are inconsistent");
    }
    throw new RoomApiError(response.status, envelope.error.code, envelope.error.message);
  }
  if (!response.ok) {
    throw new RoomApiProtocolError("Room endpoint returned success data with an error status");
  }
  return envelope.data as T;
}

async function requestRoom<T>(
  path: string,
  request: unknown,
  expectedMode: RoomReadResponseMode,
  expectedRoomId?: string,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  const body = JSON.stringify(request);
  try {
    response = await fetch(`${getBaseUrl()}${path}`, {
      method: "POST",
      body,
      cache: "no-store",
      credentials: "include",
      headers: buildRequestHeaders({ body }),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error(error instanceof Error ? error.message : "Room network request failed");
  }
  if (response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(RAH_AUTH_REQUIRED_EVENT));
  }
  const raw = await response.text();
  return parseEnvelope<T>(raw, response, expectedMode, expectedRoomId);
}

const ROOM_COMMAND_PATHS: Readonly<Record<RoomHumanCommandOperation, string>> = Object.freeze({
  create_room: "/api/room/v1/rooms/create",
  add_member: "/api/room/v1/members/add",
  post_message: "/api/room/v1/messages/post",
  acknowledge_room: "/api/room/v1/rooms/acknowledge",
  acknowledge_inbox_item: "/api/room/v1/inbox/acknowledge",
  acknowledge_message: "/api/room/v1/messages/acknowledge",
  create_task: "/api/room/v1/tasks/create",
  accept_task: "/api/room/v1/tasks/accept",
  cancel_task: "/api/room/v1/tasks/cancel",
});

async function commandRoom(
  operation: RoomHumanCommandOperation,
  request: unknown,
  signal?: AbortSignal,
): Promise<RoomCommandReceipt> {
  let response: Response;
  const body = JSON.stringify(request);
  try {
    response = await fetch(`${getBaseUrl()}${ROOM_COMMAND_PATHS[operation]}`, {
      method: "POST",
      body,
      cache: "no-store",
      credentials: "include",
      headers: buildRequestHeaders({ body }),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error(error instanceof Error ? error.message : "Room network request failed");
  }
  if (response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(RAH_AUTH_REQUIRED_EVENT));
  }
  let envelope;
  try {
    envelope = validateRoomCommandHttpEnvelope(await response.json(), operation);
  } catch (error) {
    throw new RoomApiProtocolError(error instanceof Error ? error.message : undefined);
  }
  if (!envelope.ok) {
    const expectedStatus = ROOM_READ_HTTP_STATUS_BY_ERROR_CODE[envelope.error.code];
    if (response.ok || response.status !== expectedStatus) {
      throw new RoomApiProtocolError("Room command error code and HTTP status are inconsistent");
    }
    throw new RoomApiError(response.status, envelope.error.code, envelope.error.message);
  }
  if (!response.ok) throw new RoomApiProtocolError("Room command returned success with an error status");
  return envelope.data;
}

export function createRoom(request: CreateRoomRequest, signal?: AbortSignal) {
  return commandRoom("create_room", request, signal);
}

export function addRoomMember(request: AddRoomMemberRequest, signal?: AbortSignal) {
  return commandRoom("add_member", request, signal);
}

export function postRoomMessage(request: PostRoomMessageRequest, signal?: AbortSignal) {
  return commandRoom("post_message", request, signal);
}

export function acknowledgeRoomMessage(
  request: AcknowledgeRoomMessageRequest,
  signal?: AbortSignal,
) {
  return commandRoom("acknowledge_message", request, signal);
}

export function acknowledgeRoom(request: AcknowledgeRoomRequest, signal?: AbortSignal) {
  return commandRoom("acknowledge_room", request, signal);
}

export function acknowledgeRoomInboxItem(
  request: AcknowledgeRoomInboxItemRequest,
  signal?: AbortSignal,
) {
  return commandRoom("acknowledge_inbox_item", request, signal);
}

export function createRoomTask(request: CreateRoomTaskRequest, signal?: AbortSignal) {
  return commandRoom("create_task", request, signal);
}

export function acceptRoomTask(request: AcceptRoomTaskRequest, signal?: AbortSignal) {
  return commandRoom("accept_task", request, signal);
}

export function cancelRoomTask(request: CancelRoomTaskRequest, signal?: AbortSignal) {
  return commandRoom("cancel_task", request, signal);
}

export function bootstrapRoom(
  request: RoomBootstrapReadRequest,
  signal?: AbortSignal,
): Promise<RoomBootstrapReadResponse> {
  return requestRoom(
    "/api/room/v1/bootstrap",
    request,
    "latest_bootstrap",
    request.roomId,
    signal,
  );
}

export function readRoomEvents(
  request: RoomEventReadRequest,
  signal?: AbortSignal,
): Promise<RoomEventReadResponse> {
  return requestRoom("/api/room/v1/events", request, "event_page", request.roomId, signal);
}

export function readOlderRoomMessages(
  request: RoomOlderMessagesReadRequest,
  signal?: AbortSignal,
): Promise<RoomOlderMessagesReadResponse> {
  return requestRoom(
    "/api/room/v1/older-messages",
    request,
    "older_messages",
    request.roomId,
    signal,
  );
}

export function readRoomInbox(
  request: RoomInboxReadRequest = {},
  signal?: AbortSignal,
): Promise<RoomInboxReadResponse> {
  return requestRoom("/api/room/v1/inbox", request, "inbox_page", undefined, signal);
}

export function listRooms(
  request: RoomListReadRequest = {},
  signal?: AbortSignal,
): Promise<RoomListReadResponse> {
  return requestRoom("/api/room/v1/rooms", request, "room_list", undefined, signal);
}

export function listRoomTasks(
  request: RoomTaskListReadRequest,
  signal?: AbortSignal,
): Promise<RoomTaskListReadResponse> {
  return requestRoom("/api/room/v1/tasks", request, "task_list", request.roomId, signal);
}
