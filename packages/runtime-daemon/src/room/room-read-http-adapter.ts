import type {
  RoomBootstrapReadRequest,
  RoomBootstrapReadResponse,
  RoomEventReadRequest,
  RoomEventReadResponse,
  RoomInboxReadRequest,
  RoomInboxReadResponse,
  RoomOlderMessagesReadRequest,
  RoomOlderMessagesReadResponse,
  RoomReadHttpEnvelope,
  RoomReadResponseData,
} from "@rah/runtime-protocol";

import type { DeviceAuthPrincipal } from "../device-auth";
import { RoomDomainError, roomError, type RoomErrorCode } from "./room-errors";
import { ROOM_READ_HTTP_RESPONSE_BYTE_LIMIT } from "./room-read-budget";

export {
  ROOM_READ_HTTP_RESPONSE_BYTE_LIMIT,
  ROOM_READ_HTTP_SUCCESS_ENVELOPE_BYTES,
} from "./room-read-budget";

export type RoomReadHttpOperation =
  | "bootstrap"
  | "events"
  | "older_messages"
  | "inbox";

export interface RoomReadHttpResponse {
  status: number;
  headers: Readonly<Record<"content-type" | "cache-control" | "content-length", string>>;
  body: Buffer;
}

export interface RoomReadApplicationPort {
  bootstrap(
    principal: DeviceAuthPrincipal | null,
    request: RoomBootstrapReadRequest,
  ): RoomBootstrapReadResponse;
  readEvents(
    principal: DeviceAuthPrincipal | null,
    request: RoomEventReadRequest,
  ): RoomEventReadResponse;
  readOlderMessages(
    principal: DeviceAuthPrincipal | null,
    request: RoomOlderMessagesReadRequest,
  ): RoomOlderMessagesReadResponse;
  readInbox(
    principal: DeviceAuthPrincipal | null,
    request: RoomInboxReadRequest,
  ): RoomInboxReadResponse;
}

const ROOM_ERROR_STATUS: Readonly<Record<RoomErrorCode, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_argument: 400,
  conflict: 409,
  stale_context: 409,
  idempotency_conflict: 409,
  resource_exhausted: 413,
  unavailable: 503,
};

const MAX_PUBLIC_ERROR_MESSAGE_LENGTH = 512;

/**
 * A pre-serialized, read-only HTTP application adapter for Room reads.
 *
 * This module deliberately does not register routes or read credentials. The
 * daemon's existing DeviceAuthManager must authenticate the request and pass
 * the resulting principal here. The returned Buffer is the exact wire body so
 * a later router cannot accidentally exceed the one MiB response contract by
 * wrapping or re-stringifying the application response.
 */
export class RoomReadHttpAdapter {
  readonly #port: RoomReadApplicationPort;

  constructor(port: RoomReadApplicationPort) {
    this.#port = port;
  }

  execute(
    principal: DeviceAuthPrincipal | null,
    operation: RoomReadHttpOperation,
    rawRequest: unknown,
  ): RoomReadHttpResponse {
    try {
      if (!principal) {
        throw roomError("unauthenticated", "Room access requires an authenticated device");
      }
      let data: RoomReadResponseData;
      switch (operation) {
        case "bootstrap":
          data = this.#port.bootstrap(principal, rawRequest as RoomBootstrapReadRequest);
          break;
        case "events":
          data = this.#port.readEvents(principal, rawRequest as RoomEventReadRequest);
          break;
        case "older_messages":
          data = this.#port.readOlderMessages(
            principal,
            rawRequest as RoomOlderMessagesReadRequest,
          );
          break;
        case "inbox":
          data = this.#port.readInbox(principal, rawRequest as RoomInboxReadRequest);
          break;
        default:
          throw roomError("invalid_argument", "Unknown Room read operation");
      }
      const response = this.#serialize(200, { ok: true, data });
      if (response.body.byteLength > ROOM_READ_HTTP_RESPONSE_BYTE_LIMIT) {
        return this.#domainError(roomError(
          "resource_exhausted",
          "Room read response exceeds the one MiB wire budget",
        ));
      }
      return response;
    } catch (error) {
      if (error instanceof RoomDomainError) return this.#domainError(error);
      return this.#serialize(500, {
        ok: false,
        error: { code: "internal", message: "Internal Room read failure" },
      });
    }
  }

  #domainError(error: RoomDomainError): RoomReadHttpResponse {
    return this.#serialize(ROOM_ERROR_STATUS[error.code], {
      ok: false,
      error: {
        code: error.code,
        message: this.#publicMessage(error),
      },
    });
  }

  #publicMessage(error: RoomDomainError): string {
    if (error.code === "unauthenticated") {
      return "Room access requires an authenticated device";
    }
    if (error.code === "forbidden") return "Room access is forbidden";
    return error.message.slice(0, MAX_PUBLIC_ERROR_MESSAGE_LENGTH);
  }

  #serialize(status: number, envelope: RoomReadHttpEnvelope): RoomReadHttpResponse {
    const body = Buffer.from(JSON.stringify(envelope), "utf8");
    return {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "content-length": String(body.byteLength),
      },
      body,
    };
  }
}
