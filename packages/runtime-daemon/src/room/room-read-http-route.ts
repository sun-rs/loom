import type { IncomingMessage, ServerResponse } from "node:http";

import type { DeviceAuthPrincipal } from "../device-auth";
import { applyCorsHeaders } from "../http-server-cors";
import { HttpRequestBodyError, readJsonBody } from "../http-server-response";
import { roomError } from "./room-errors";
import type {
  RoomReadHttpAdapter,
  RoomReadHttpOperation,
  RoomReadHttpResponse,
} from "./room-read-http-adapter";

export const MAX_ROOM_READ_REQUEST_BYTES = 64 * 1024;

export const ROOM_READ_HTTP_ROUTES: Readonly<Record<string, RoomReadHttpOperation>> =
  Object.freeze({
    "/api/room/v1/bootstrap": "bootstrap",
    "/api/room/v1/events": "events",
    "/api/room/v1/older-messages": "older_messages",
    "/api/room/v1/inbox": "inbox",
    "/api/room/v1/rooms": "rooms",
    "/api/room/v1/tasks": "tasks",
  });

function writeRoomReadResponse(
  req: IncomingMessage,
  res: ServerResponse,
  response: RoomReadHttpResponse,
): void {
  applyCorsHeaders(req, res);
  res.writeHead(response.status, response.headers);
  res.end(response.body);
}

export function isRoomReadHttpPath(pathname: string): boolean {
  return ROOM_READ_HTTP_ROUTES[pathname] !== undefined;
}

export function writeRoomReadHttpFailure(args: {
  adapter: RoomReadHttpAdapter;
  error: unknown;
  req: IncomingMessage;
  res: ServerResponse;
  statusOverride?: number;
}): void {
  writeRoomReadResponse(
    args.req,
    args.res,
    args.adapter.errorResponse(args.error, args.statusOverride),
  );
}

/** Returns true only when the exact Room API path was owned by this router. */
export async function handleRoomReadHttpRequest(args: {
  pathname: string;
  principal: DeviceAuthPrincipal | null;
  adapter: RoomReadHttpAdapter;
  req: IncomingMessage;
  res: ServerResponse;
}): Promise<boolean> {
  const operation = ROOM_READ_HTTP_ROUTES[args.pathname];
  if (!operation) return false;

  if (args.req.method !== "POST") {
    writeRoomReadResponse(
      args.req,
      args.res,
      args.adapter.errorResponse(
        roomError("invalid_argument", "Room read endpoints require POST"),
        405,
      ),
    );
    return true;
  }

  let body: unknown;
  try {
    body = await readJsonBody(args.req, MAX_ROOM_READ_REQUEST_BYTES);
  } catch (error) {
    const mapped = error instanceof HttpRequestBodyError
      ? roomError(
          error.kind === "too_large" ? "resource_exhausted" : "invalid_argument",
          error.message,
        )
      : error;
    writeRoomReadResponse(args.req, args.res, args.adapter.errorResponse(mapped));
    return true;
  }

  writeRoomReadResponse(
    args.req,
    args.res,
    args.adapter.execute(args.principal, operation, body),
  );
  return true;
}
