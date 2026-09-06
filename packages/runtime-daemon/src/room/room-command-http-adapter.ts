import type {
  RoomCommandHttpEnvelope,
  RoomHumanCommandOperation,
} from "@rah/runtime-protocol";
import { ROOM_READ_HTTP_STATUS_BY_ERROR_CODE } from "@rah/runtime-protocol";

import type { DeviceAuthPrincipal } from "../device-auth";
import { RoomDomainError } from "./room-errors";
import type { RoomReadHttpResponse } from "./room-read-http-adapter";
import type { RoomCommandService } from "./room-command-service";

const MAX_PUBLIC_ERROR_MESSAGE_LENGTH = 512;

export class RoomCommandHttpAdapter {
  readonly #service: RoomCommandService;

  constructor(service: RoomCommandService) {
    this.#service = service;
  }

  execute(
    principal: DeviceAuthPrincipal | null,
    operation: RoomHumanCommandOperation,
    rawRequest: unknown,
  ): RoomReadHttpResponse {
    try {
      return this.#serialize(200, {
        ok: true,
        data: this.#service.execute(principal, operation, rawRequest),
      });
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  errorResponse(error: unknown, statusOverride?: number): RoomReadHttpResponse {
    if (error instanceof RoomDomainError) {
      return this.#serialize(
        statusOverride ?? ROOM_READ_HTTP_STATUS_BY_ERROR_CODE[error.code],
        {
          ok: false,
          error: {
            code: error.code,
            message: error.code === "forbidden"
              ? "Room access is forbidden"
              : error.code === "unauthenticated"
                ? "Room access requires an authenticated device"
                : error.message.slice(0, MAX_PUBLIC_ERROR_MESSAGE_LENGTH),
          },
        },
      );
    }
    return this.#serialize(statusOverride ?? 500, {
      ok: false,
      error: { code: "internal", message: "Internal Room command failure" },
    });
  }

  #serialize(status: number, envelope: RoomCommandHttpEnvelope): RoomReadHttpResponse {
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
