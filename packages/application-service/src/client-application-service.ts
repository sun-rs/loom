import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import {
  type AuthenticatedActorContext,
  KernelError,
  type RoomKernel,
} from "@rah-os/kernel";
import {
  ClientAcknowledgeRequestSchema,
  ClientAcknowledgeResponseSchema,
  ClientErrorResponseSchema,
  ClientHealthResponseSchema,
  ClientInputRequestsListRequestSchema,
  ClientInputRequestsListResponseSchema,
  ClientRoomSyncRequestSchema,
  ClientRoomSyncResponseSchema,
  ClientTasksListRequestSchema,
  ClientTasksListResponseSchema,
  InputRequestResolveRequestSchema,
  InputRequestResolveResponseSchema,
  type ClientHealthResponse,
} from "@rah-os/protocol";

export type ClientApplicationServiceOptions = {
  bindHost?: "127.0.0.1";
  health: () => ClientHealthResponse;
  kernel: RoomKernel;
  port?: number;
};

class HttpRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const MAX_BODY_BYTES = 64 * 1_024;
const CLIENT_HEALTH_ROUTE = "/v1/client/health";
const CLIENT_DATA_ROUTES = new Set([
  "/v1/client/input-requests/list",
  "/v1/client/input-requests/resolve",
  "/v1/client/rooms/acknowledge",
  "/v1/client/rooms/sync",
  "/v1/client/tasks/list",
]);
const MAX_DELIVERED_CURSORS_PER_CONSUMER = 1_024;

type ClientSession = {
  actor: AuthenticatedActorContext;
  credentialHash: string;
};

export class ClientApplicationService {
  readonly #bindHost: "127.0.0.1";
  readonly #health: () => ClientHealthResponse;
  readonly #kernel: RoomKernel;
  readonly #port: number;
  readonly #deliveredCursors = new Map<string, Set<number>>();
  #origin: string | undefined;
  #server: Server | undefined;

  constructor(options: ClientApplicationServiceOptions) {
    this.#bindHost = options.bindHost ?? "127.0.0.1";
    this.#health = options.health;
    this.#kernel = options.kernel;
    this.#port = options.port ?? 0;
    if (
      !Number.isInteger(this.#port) ||
      this.#port < 0 ||
      this.#port > 65_535
    ) {
      throw new Error("port must be an integer between 0 and 65535");
    }
  }

  get origin(): string {
    if (this.#origin === undefined) {
      throw new Error("ClientApplicationService has not started");
    }
    return this.#origin;
  }

  async start(): Promise<void> {
    if (this.#server !== undefined) return;

    const server = createServer((request, response) => {
      void this.#handle(request, response).catch((error: unknown) => {
        this.#writeError(response, error);
      });
    });
    server.requestTimeout = 5_000;
    server.headersTimeout = 5_000;

    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(this.#port, this.#bindHost, () => {
        server.off("error", reject);
        resolvePromise();
      });
    });
    const address = server.address() as AddressInfo | null;
    if (address === null) {
      server.close();
      throw new Error("ClientApplicationService did not acquire an address");
    }
    this.#server = server;
    this.#origin = `http://${this.#bindHost}:${String(address.port)}`;
  }

  async close(): Promise<void> {
    this.#deliveredCursors.clear();
    this.#origin = undefined;
    const server = this.#server;
    this.#server = undefined;
    if (server === undefined || !server.listening) return;

    await new Promise<void>((resolvePromise, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolvePromise();
      });
    });
  }

  async #handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const route = request.url;
    if (route === CLIENT_HEALTH_ROUTE) {
      if (request.method !== "GET") {
        throw new HttpRequestError(
          "method_not_allowed",
          "health only supports GET",
          405,
        );
      }
      writeJson(
        response,
        200,
        ClientHealthResponseSchema.parse(this.#health()),
      );
      return;
    }
    if (route === undefined || !CLIENT_DATA_ROUTES.has(route)) {
      throw new HttpRequestError("not_found", "route was not found", 404);
    }
    if (request.method !== "POST") {
      throw new HttpRequestError(
        "method_not_allowed",
        "data routes only support POST",
        405,
      );
    }

    const session = this.#authenticate(request);
    const actor = session.actor;
    const body = await readJsonObject(request);
    if (route === "/v1/client/rooms/sync") {
      const command = parseClientRequest(ClientRoomSyncRequestSchema, body);
      const deliveryKey = this.#deliveryKey(session, command);
      const knownCursors = this.#deliveredCursors.get(deliveryKey);
      const delivery = this.#kernel.sync(actor, {
        consumerId: command.consumerId,
        roomId: command.roomId,
        ...(command.afterSeq === undefined
          ? {}
          : { afterSeq: command.afterSeq }),
        ...(command.limit === undefined ? {} : { limit: command.limit }),
      });
      if (
        command.afterSeq !== undefined &&
        command.afterSeq > delivery.cursorBefore &&
        !knownCursors?.has(command.afterSeq)
      ) {
        throw new HttpRequestError(
          "invalid_continuation",
          "afterSeq was neither acknowledged nor delivered for this client credential",
          409,
        );
      }
      this.#rememberDeliveredCursor(deliveryKey, delivery.cursorAfter);
      writeJson(response, 200, ClientRoomSyncResponseSchema.parse(delivery));
      return;
    }
    if (route === "/v1/client/rooms/acknowledge") {
      const command = parseClientRequest(ClientAcknowledgeRequestSchema, body);
      const deliveryKey = this.#deliveryKey(session, command);
      const durableCursor = this.#kernel.sync(actor, {
        consumerId: command.consumerId,
        limit: 1,
        roomId: command.roomId,
      }).cursorBefore;
      if (
        command.throughSeq > durableCursor &&
        !this.#deliveredCursors.get(deliveryKey)?.has(command.throughSeq)
      ) {
        throw new HttpRequestError(
          "cursor_not_delivered",
          "throughSeq was not delivered for this client credential",
          409,
        );
      }
      this.#kernel.acknowledgeCursor(actor, command);
      this.#forgetAcknowledgedCursors(deliveryKey, command.throughSeq);
      writeJson(
        response,
        200,
        ClientAcknowledgeResponseSchema.parse({
          acknowledgedThrough: command.throughSeq,
        }),
      );
      return;
    }
    if (route === "/v1/client/tasks/list") {
      const command = parseClientRequest(ClientTasksListRequestSchema, body);
      writeJson(
        response,
        200,
        ClientTasksListResponseSchema.parse({
          tasks: this.#kernel.listTasks(actor, command),
        }),
      );
      return;
    }
    if (route === "/v1/client/input-requests/list") {
      const command = parseClientRequest(
        ClientInputRequestsListRequestSchema,
        body,
      );
      const inputRequests = this.#kernel
        .listInputRequests(actor, { roomId: command.roomId })
        .filter(
          (inputRequest) =>
            command.state === undefined || inputRequest.state === command.state,
        );
      writeJson(
        response,
        200,
        ClientInputRequestsListResponseSchema.parse({ inputRequests }),
      );
      return;
    }

    const command = parseClientRequest(InputRequestResolveRequestSchema, body);
    writeJson(
      response,
      200,
      InputRequestResolveResponseSchema.parse(
        this.#kernel.resolveInputRequest(actor, command),
      ),
    );
  }

  #authenticate(request: IncomingMessage): ClientSession {
    const authorization = request.headers.authorization;
    if (
      authorization === undefined ||
      Array.isArray(authorization) ||
      !authorization.startsWith("Bearer ")
    ) {
      throw new HttpRequestError(
        "unauthenticated",
        "client authentication failed",
        401,
      );
    }
    const accessToken = authorization.slice("Bearer ".length);
    if (accessToken.length === 0) {
      throw new HttpRequestError(
        "unauthenticated",
        "client authentication failed",
        401,
      );
    }
    return {
      actor: this.#kernel.authenticateHumanAccessToken(accessToken),
      credentialHash: hashToken(accessToken),
    };
  }

  #deliveryKey(
    session: ClientSession,
    input: { consumerId: string; roomId: string },
  ): string {
    return JSON.stringify([
      session.credentialHash,
      input.roomId,
      input.consumerId,
    ]);
  }

  #rememberDeliveredCursor(key: string, cursor: number): void {
    let cursors = this.#deliveredCursors.get(key);
    if (cursors === undefined) {
      cursors = new Set<number>();
      this.#deliveredCursors.set(key, cursors);
    }
    cursors.add(cursor);
    while (cursors.size > MAX_DELIVERED_CURSORS_PER_CONSUMER) {
      const oldest = cursors.values().next().value as number | undefined;
      if (oldest === undefined) break;
      cursors.delete(oldest);
    }
  }

  #forgetAcknowledgedCursors(key: string, throughSeq: number): void {
    const cursors = this.#deliveredCursors.get(key);
    if (cursors === undefined) return;
    for (const cursor of cursors) {
      if (cursor <= throughSeq) cursors.delete(cursor);
    }
    if (cursors.size === 0) this.#deliveredCursors.delete(key);
  }

  #writeError(response: ServerResponse, error: unknown): void {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    if (error instanceof HttpRequestError) {
      writeJson(
        response,
        error.status,
        ClientErrorResponseSchema.parse({
          error: { code: error.code, message: error.message },
        }),
      );
      return;
    }
    if (error instanceof KernelError) {
      const status =
        error.code === "unauthenticated"
          ? 401
          : error.code === "forbidden"
            ? 403
            : error.code === "not_found"
              ? 404
              : 409;
      writeJson(
        response,
        status,
        ClientErrorResponseSchema.parse({
          error: { code: error.code, message: error.message },
        }),
      );
      return;
    }
    writeJson(
      response,
      500,
      ClientErrorResponseSchema.parse({
        error: { code: "internal_error", message: "internal server error" },
      }),
    );
  }
}

async function readJsonObject(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      throw new HttpRequestError(
        "body_too_large",
        "request body exceeds 64 KiB",
        413,
      );
    }
    chunks.push(buffer);
  }
  if (bytes === 0) return {};

  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
  } catch {
    throw new HttpRequestError("invalid_json", "body must be JSON", 400);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpRequestError(
      "invalid_body",
      "body must be a JSON object",
      400,
    );
  }
  return value as Record<string, unknown>;
}

type ProtocolSchema<T> = {
  safeParse(value: unknown):
    | { data: T; success: true }
    | {
        error: {
          issues: Array<{
            code: string;
            keys?: string[];
            message: string;
            path: PropertyKey[];
          }>;
        };
        success: false;
      };
};

function parseClientRequest<T>(
  schema: ProtocolSchema<T>,
  body: Record<string, unknown>,
): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  if (issue?.code === "unrecognized_keys") {
    const unexpected = issue.keys?.[0] ?? "unknown";
    throw new HttpRequestError(
      "unexpected_field",
      `field ${unexpected} is not accepted`,
      400,
    );
  }
  const field = issue?.path[0];
  throw new HttpRequestError(
    "invalid_field",
    `${typeof field === "string" ? field : "request"}: ${issue?.message ?? "invalid value"}`,
    400,
  );
}

function writeJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  response.statusCode = status;
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function hashToken(accessToken: string): string {
  return createHash("sha256").update(accessToken, "utf8").digest("hex");
}
