import type { IncomingMessage, ServerResponse } from "node:http";
import type { RoomHumanCommandOperation } from "@rah/runtime-protocol";

import type { DeviceAuthPrincipal } from "../device-auth";
import { applyCorsHeaders } from "../http-server-cors";
import { HttpRequestBodyError, readJsonBody } from "../http-server-response";
import type { RoomCommandHttpAdapter } from "./room-command-http-adapter";
import { roomError } from "./room-errors";

export const MAX_ROOM_COMMAND_REQUEST_BYTES = 256 * 1024;

export const ROOM_COMMAND_HTTP_ROUTES: Readonly<Record<string, RoomHumanCommandOperation>> =
  Object.freeze({
    "/api/room/v1/rooms/create": "create_room",
    "/api/room/v1/members/add": "add_member",
    "/api/room/v1/messages/post": "post_message",
    "/api/room/v1/rooms/acknowledge": "acknowledge_room",
    "/api/room/v1/inbox/acknowledge": "acknowledge_inbox_item",
    "/api/room/v1/messages/acknowledge": "acknowledge_message",
    "/api/room/v1/tasks/create": "create_task",
    "/api/room/v1/tasks/accept": "accept_task",
    "/api/room/v1/tasks/cancel": "cancel_task",
  });

export function isRoomCommandHttpPath(pathname: string): boolean {
  return ROOM_COMMAND_HTTP_ROUTES[pathname] !== undefined;
}

function write(
  req: IncomingMessage,
  res: ServerResponse,
  response: ReturnType<RoomCommandHttpAdapter["execute"]>,
): void {
  applyCorsHeaders(req, res);
  res.writeHead(response.status, response.headers);
  res.end(response.body);
}

export function writeRoomCommandHttpFailure(args: {
  adapter: RoomCommandHttpAdapter;
  error: unknown;
  req: IncomingMessage;
  res: ServerResponse;
  statusOverride?: number;
}): void {
  write(args.req, args.res, args.adapter.errorResponse(args.error, args.statusOverride));
}

export async function handleRoomCommandHttpRequest(args: {
  pathname: string;
  principal: DeviceAuthPrincipal | null;
  adapter: RoomCommandHttpAdapter;
  req: IncomingMessage;
  res: ServerResponse;
}): Promise<boolean> {
  const operation = ROOM_COMMAND_HTTP_ROUTES[args.pathname];
  if (!operation) return false;
  if (args.req.method !== "POST") {
    write(args.req, args.res, args.adapter.errorResponse(
      roomError("invalid_argument", "Room command endpoints require POST"),
      405,
    ));
    return true;
  }
  let body: unknown;
  try {
    body = await readJsonBody(args.req, MAX_ROOM_COMMAND_REQUEST_BYTES);
  } catch (error) {
    const mapped = error instanceof HttpRequestBodyError
      ? roomError(error.kind === "too_large" ? "resource_exhausted" : "invalid_argument", error.message)
      : error;
    write(args.req, args.res, args.adapter.errorResponse(mapped));
    return true;
  }
  write(args.req, args.res, args.adapter.execute(args.principal, operation, body));
  return true;
}
