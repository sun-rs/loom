import type {
  RoomBootstrapReadRequest,
  RoomBootstrapReadResponse,
  RoomEventReadRequest,
  RoomEventReadResponse,
  RoomInboxReadRequest,
  RoomInboxReadResponse,
  RoomListReadRequest,
  RoomListReadResponse,
  RoomOlderMessagesReadRequest,
  RoomOlderMessagesReadResponse,
  RoomReadResponseMode,
  RoomReadWireErrorCode,
} from "@rah/runtime-protocol";
import {
  ROOM_READ_HTTP_STATUS_BY_ERROR_CODE,
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
