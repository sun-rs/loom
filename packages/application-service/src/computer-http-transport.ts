import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import {
  ComputerErrorResponseSchema,
  ComputerExecutionCommandRequestSchema,
  ComputerHeartbeatRequestSchema,
  ComputerOperationAcknowledgeRequestSchema,
  ComputerOperationClaimRequestSchema,
  ComputerPlacementClaimRequestSchema,
  ComputerRuntimeOfferPublishRequestSchema,
  ComputerSessionOpenRequestSchema,
  ComputerWorkerCredentialIssueRequestSchema,
  ComputerWorkerCredentialIssueResponseSchema,
  ComputerWorkerCredentialRevokeRequestSchema,
} from "@rah-os/computer-protocol";
import { KernelError } from "@rah-os/kernel";

import type { ComputerApplicationService } from "./computer-application-service.ts";
import { WORKER_HTTP_ROUTE_PATHS } from "./worker-application-service.ts";

const MAX_BODY_BYTES = 64 * 1_024;
const MAX_WORKER_RELAY_BODY_BYTES = 128 * 1_024;
const MAX_WORKER_RELAY_RESPONSE_BYTES = 1_024 * 1_024;
const WORKER_RELAY_TIMEOUT_MS = 30_000;
const COMPUTER_ROUTES = new Set([
  "/v1/computer/heartbeat",
  "/v1/computer/executions/command",
  "/v1/computer/operations/acknowledge",
  "/v1/computer/operations/claim",
  "/v1/computer/placements/claim",
  "/v1/computer/runtime-offers/publish",
  "/v1/computer/session/open",
  "/v1/computer/worker-credentials/issue",
  "/v1/computer/worker-credentials/revoke",
]);
const WORKER_ROUTES = new Set<string>(WORKER_HTTP_ROUTE_PATHS);

class HttpRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type ComputerHttpTransportOptions = {
  computer: ComputerApplicationService;
  port?: number;
  workerRelay?: {
    advertisedOrigin?: string;
    fetch?: typeof fetch;
    targetOrigin: string;
  };
};

export class ComputerHttpTransport {
  readonly #computer: ComputerApplicationService;
  readonly #port: number;
  readonly #workerRelay:
    | {
        advertisedOrigin?: string;
        fetch: typeof fetch;
        targetOrigin: string;
      }
    | undefined;
  #origin: string | undefined;
  #server: Server | undefined;

  constructor(options: ComputerHttpTransportOptions) {
    this.#computer = options.computer;
    this.#port = options.port ?? 0;
    this.#workerRelay =
      options.workerRelay === undefined
        ? undefined
        : {
            ...(options.workerRelay.advertisedOrigin === undefined
              ? {}
              : {
                  advertisedOrigin: validateAdvertisedWorkerOrigin(
                    options.workerRelay.advertisedOrigin,
                  ),
                }),
            fetch: options.workerRelay.fetch ?? fetch,
            targetOrigin: validateLoopbackWorkerTarget(
              options.workerRelay.targetOrigin,
            ),
          };
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
      throw new Error("ComputerHttpTransport has not started");
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
    server.maxConnections = 128;

    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(this.#port, "127.0.0.1", () => {
        server.off("error", reject);
        resolvePromise();
      });
    });
    const address = server.address() as AddressInfo | null;
    if (address === null) {
      server.close();
      throw new Error("ComputerHttpTransport did not acquire an address");
    }
    this.#server = server;
    this.#origin = `http://127.0.0.1:${String(address.port)}`;
  }

  async close(): Promise<void> {
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
    if (request.method !== "POST") {
      throw new HttpRequestError(
        "method_not_allowed",
        "only POST is supported",
        405,
      );
    }
    const route = request.url;
    if (route !== undefined && WORKER_ROUTES.has(route)) {
      await this.#relayWorkerRequest(request, response, route);
      return;
    }
    if (route === undefined || !COMPUTER_ROUTES.has(route)) {
      throw new HttpRequestError("not_found", "route was not found", 404);
    }
    const accessToken = bearerToken(request);
    const body = await readJsonObject(request);
    if (route === "/v1/computer/session/open") {
      writeJson(
        response,
        200,
        this.#computer.openSession(
          accessToken,
          parseComputerRequest(ComputerSessionOpenRequestSchema, body),
        ),
      );
      return;
    }
    if (route === "/v1/computer/heartbeat") {
      writeJson(
        response,
        200,
        this.#computer.heartbeat(
          accessToken,
          parseComputerRequest(ComputerHeartbeatRequestSchema, body),
        ),
      );
      return;
    }
    if (route === "/v1/computer/runtime-offers/publish") {
      writeJson(
        response,
        200,
        this.#computer.publishRuntimeOffer(
          accessToken,
          parseComputerRequest(ComputerRuntimeOfferPublishRequestSchema, body),
        ),
      );
      return;
    }
    if (route === "/v1/computer/executions/command") {
      writeJson(
        response,
        200,
        this.#computer.commandExecution(
          accessToken,
          parseComputerRequest(ComputerExecutionCommandRequestSchema, body),
        ),
      );
      return;
    }
    if (route === "/v1/computer/operations/claim") {
      writeJson(
        response,
        200,
        this.#computer.claimOperation(
          accessToken,
          parseComputerRequest(ComputerOperationClaimRequestSchema, body),
        ),
      );
      return;
    }
    if (route === "/v1/computer/operations/acknowledge") {
      writeJson(
        response,
        200,
        this.#computer.acknowledgeOperation(
          accessToken,
          parseComputerRequest(ComputerOperationAcknowledgeRequestSchema, body),
        ),
      );
      return;
    }
    if (route === "/v1/computer/worker-credentials/issue") {
      const issued = this.#computer.issueWorkerCredential(
        accessToken,
        parseComputerRequest(ComputerWorkerCredentialIssueRequestSchema, body),
      );
      writeJson(
        response,
        200,
        this.#workerRelay === undefined
          ? issued
          : ComputerWorkerCredentialIssueResponseSchema.parse({
              ...issued,
              workerApiOrigin:
                this.#workerRelay.advertisedOrigin ?? this.origin,
            }),
      );
      return;
    }
    if (route === "/v1/computer/worker-credentials/revoke") {
      writeJson(
        response,
        200,
        this.#computer.revokeWorkerCredential(
          accessToken,
          parseComputerRequest(
            ComputerWorkerCredentialRevokeRequestSchema,
            body,
          ),
        ),
      );
      return;
    }
    writeJson(
      response,
      200,
      this.#computer.claimPlacement(
        accessToken,
        parseComputerRequest(ComputerPlacementClaimRequestSchema, body),
      ),
    );
  }

  async #relayWorkerRequest(
    request: IncomingMessage,
    response: ServerResponse,
    route: string,
  ): Promise<void> {
    const relay = this.#workerRelay;
    if (relay === undefined) {
      throw new HttpRequestError("not_found", "route was not found", 404);
    }
    const authorization = request.headers.authorization;
    if (authorization === undefined || Array.isArray(authorization)) {
      throw new HttpRequestError(
        "unauthenticated",
        "worker authentication failed",
        401,
      );
    }
    const body = await readBoundedBody(request, MAX_WORKER_RELAY_BODY_BYTES);
    let upstream: Response;
    try {
      upstream = await relay.fetch(`${relay.targetOrigin}${route}`, {
        body,
        headers: {
          authorization,
          "content-type": "application/json",
        },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(WORKER_RELAY_TIMEOUT_MS),
      });
    } catch {
      throw new HttpRequestError(
        "worker_relay_unavailable",
        "worker application service is unavailable",
        502,
      );
    }
    const upstreamBody = await readBoundedFetchResponse(
      upstream,
      MAX_WORKER_RELAY_RESPONSE_BYTES,
    );
    response.writeHead(upstream.status, {
      "cache-control": "no-store",
      "content-length": String(upstreamBody.byteLength),
      "content-type": "application/json; charset=utf-8",
    });
    response.end(upstreamBody);
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
        ComputerErrorResponseSchema.parse({
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
        ComputerErrorResponseSchema.parse({
          error: { code: error.code, message: error.message },
        }),
      );
      return;
    }
    writeJson(
      response,
      500,
      ComputerErrorResponseSchema.parse({
        error: { code: "internal_error", message: "internal server error" },
      }),
    );
  }
}

function bearerToken(request: IncomingMessage): string {
  const authorization = request.headers.authorization;
  if (
    authorization === undefined ||
    Array.isArray(authorization) ||
    !authorization.startsWith("Bearer ")
  ) {
    throw new HttpRequestError(
      "unauthenticated",
      "computer authentication failed",
      401,
    );
  }
  const accessToken = authorization.slice("Bearer ".length);
  if (accessToken.length === 0 || accessToken.length > 4_096) {
    throw new HttpRequestError(
      "unauthenticated",
      "computer authentication failed",
      401,
    );
  }
  return accessToken;
}

async function readJsonObject(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const raw = await readBoundedBody(request, MAX_BODY_BYTES);
  if (raw.byteLength === 0) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
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

async function readBoundedBody(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maximumBytes) {
      throw new HttpRequestError(
        "body_too_large",
        "request body exceeds the transport limit",
        413,
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes);
}

async function readBoundedFetchResponse(
  response: Response,
  maximumBytes: number,
): Promise<Buffer> {
  const body = response.body;
  if (body === null) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  const reader = body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = Buffer.from(result.value);
      bytes += chunk.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new HttpRequestError(
          "worker_relay_response_too_large",
          "worker application response exceeds the transport limit",
          502,
        );
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof HttpRequestError) throw error;
    throw new HttpRequestError(
      "worker_relay_unavailable",
      "worker application service is unavailable",
      502,
    );
  }
  return Buffer.concat(chunks, bytes);
}

function validateLoopbackWorkerTarget(origin: string): string {
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]")
  ) {
    throw new Error(
      "worker relay targetOrigin must be a numeric loopback HTTP origin",
    );
  }
  return origin;
}

function validateAdvertisedWorkerOrigin(origin: string): string {
  const parsed = ComputerWorkerCredentialIssueResponseSchema.parse({
    credentialId: "origin-validation",
    expiresAt: "2099-01-01T00:00:00.000Z",
    workerAccessToken: "x".repeat(32),
    workerApiOrigin: origin,
  });
  return parsed.workerApiOrigin;
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

function parseComputerRequest<T>(
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
