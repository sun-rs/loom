import { createHash, randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import {
  KernelError,
  type AuthenticatedHostContext,
  type AuthenticatedWorkerExecutionContext,
  type RoomKernel,
} from "@rah-os/kernel";
import {
  ActivationCredentialScopeSchema,
  WorkerAcknowledgeRequestSchema,
  WorkerAcknowledgeResponseSchema,
  WorkerErrorResponseSchema,
  WorkerSyncRequestSchema,
  WorkerSyncResponseSchema,
  WorkerTaskClaimRequestSchema,
  WorkerTaskBlockRequestSchema,
  WorkerTaskGetRequestSchema,
  WorkerTaskGetResponseSchema,
  WorkerTaskInputStatusRequestSchema,
  WorkerTaskInputStatusResponseSchema,
  WorkerTaskMutationResponseSchema,
  WorkerTaskAttentionMutationResponseSchema,
  WorkerTaskProgressRequestSchema,
  WorkerTaskRequestInputRequestSchema,
  WorkerTaskRequestInputResponseSchema,
  WorkerTaskReleaseRequestSchema,
  WorkerTaskStartRequestSchema,
  WorkerTaskSubmitRequestSchema,
  type ActivationCredentialScope,
  type Task,
} from "@rah-os/protocol";

export type { ActivationCredentialScope } from "@rah-os/protocol";

export type IssuedActivationCredential = {
  accessToken: string;
  revoke: () => void;
};

export type WorkerApplicationServiceOptions = {
  kernel: RoomKernel;
  now?: () => Date;
  taskClaimHeartbeatIntervalMs?: number;
  taskClaimLeaseMs?: number;
};

type WorkerGrant = {
  claimedTaskIds: Set<string>;
  deliveredCursors: Set<number>;
  execution: AuthenticatedWorkerExecutionContext;
  expiresAtMs: number;
  heartbeatTimer?: NodeJS.Timeout;
  knownRoomSeqs: Set<number>;
  scope: ActivationCredentialScope;
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
const DEFAULT_CREDENTIAL_TTL_MS = 30 * 60_000;
const DEFAULT_TASK_CLAIM_LEASE_MS = 5 * 60_000;

const WORKER_ROUTES = new Set([
  "/v1/worker/acknowledge",
  "/v1/worker/sync",
  "/v1/worker/tasks/claim",
  "/v1/worker/tasks/block",
  "/v1/worker/tasks/get",
  "/v1/worker/tasks/input-status",
  "/v1/worker/tasks/progress",
  "/v1/worker/tasks/release",
  "/v1/worker/tasks/request-input",
  "/v1/worker/tasks/start",
  "/v1/worker/tasks/submit",
]);

export class WorkerApplicationService {
  readonly #grants = new Map<string, WorkerGrant>();
  readonly #kernel: RoomKernel;
  readonly #now: () => Date;
  readonly #taskClaimHeartbeatIntervalMs: number;
  readonly #taskClaimLeaseMs: number;
  #origin: string | undefined;
  #server: Server | undefined;

  constructor(options: WorkerApplicationServiceOptions) {
    this.#kernel = options.kernel;
    this.#now = options.now ?? (() => new Date());
    this.#taskClaimLeaseMs =
      options.taskClaimLeaseMs ?? DEFAULT_TASK_CLAIM_LEASE_MS;
    if (
      !Number.isInteger(this.#taskClaimLeaseMs) ||
      this.#taskClaimLeaseMs <= 0
    ) {
      throw new Error("taskClaimLeaseMs must be a positive integer");
    }
    this.#taskClaimHeartbeatIntervalMs =
      options.taskClaimHeartbeatIntervalMs ??
      Math.max(1, Math.floor(this.#taskClaimLeaseMs / 3));
    if (
      !Number.isInteger(this.#taskClaimHeartbeatIntervalMs) ||
      this.#taskClaimHeartbeatIntervalMs <= 0 ||
      this.#taskClaimHeartbeatIntervalMs >= this.#taskClaimLeaseMs
    ) {
      throw new Error(
        "taskClaimHeartbeatIntervalMs must be positive and less than taskClaimLeaseMs",
      );
    }
  }

  get origin(): string {
    if (this.#origin === undefined) {
      throw new Error("WorkerApplicationService has not started");
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
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolvePromise();
      });
    });
    const address = server.address() as AddressInfo | null;
    if (address === null) {
      server.close();
      throw new Error("WorkerApplicationService did not acquire an address");
    }
    this.#server = server;
    this.#origin = `http://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    for (const grant of this.#grants.values()) {
      this.#stopTaskHeartbeat(grant);
    }
    this.#grants.clear();
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

  issueActivationCredential(
    host: AuthenticatedHostContext,
    uncheckedScope: ActivationCredentialScope,
    options: { ttlMs?: number } = {},
  ): IssuedActivationCredential {
    if (this.#server === undefined) {
      throw new Error(
        "WorkerApplicationService must start before issuing tokens",
      );
    }
    const scope = ActivationCredentialScopeSchema.parse({
      activationId: uncheckedScope.activationId,
      consumerId: uncheckedScope.consumerId,
      hostId: uncheckedScope.hostId,
      participantId: uncheckedScope.participantId,
      roomId: uncheckedScope.roomId,
      runAttemptId: uncheckedScope.runAttemptId,
      toSeq: uncheckedScope.toSeq,
    });
    const execution = this.#kernel.authorizeWorkerExecution(host, scope);
    const ttlMs = options.ttlMs ?? DEFAULT_CREDENTIAL_TTL_MS;
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
      throw new Error("ttlMs must be a positive integer");
    }

    const accessToken = `rah_wat_${randomBytes(32).toString("base64url")}`;
    const tokenHash = hashToken(accessToken);
    this.#grants.set(tokenHash, {
      claimedTaskIds: new Set<string>(),
      deliveredCursors: new Set<number>(),
      execution,
      expiresAtMs: this.#now().getTime() + ttlMs,
      knownRoomSeqs: new Set<number>(),
      scope: {
        activationId: scope.activationId,
        consumerId: scope.consumerId,
        hostId: scope.hostId,
        participantId: scope.participantId,
        roomId: scope.roomId,
        runAttemptId: scope.runAttemptId,
        toSeq: scope.toSeq,
      },
    });
    return {
      accessToken,
      revoke: () => {
        this.#deleteGrant(tokenHash);
      },
    };
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
    if (route === undefined || !WORKER_ROUTES.has(route)) {
      throw new HttpRequestError("not_found", "route was not found", 404);
    }

    const grant = this.#authenticate(request);
    const body = await readJsonObject(request);
    if (route === "/v1/worker/sync") {
      const { afterSeq } = parseWorkerRequest(WorkerSyncRequestSchema, body);
      if (afterSeq !== undefined && !grant.deliveredCursors.has(afterSeq)) {
        throw new HttpRequestError(
          "invalid_continuation",
          "afterSeq was not delivered to this worker credential",
          409,
        );
      }
      if (afterSeq !== undefined && afterSeq > grant.scope.toSeq) {
        throw new HttpRequestError(
          "continuation_out_of_scope",
          "afterSeq exceeds this Activation range",
          409,
        );
      }
      const delivery = this.#kernel.syncWorker(grant.execution, {
        ...(afterSeq === undefined ? {} : { afterSeq }),
      });
      grant.deliveredCursors.add(delivery.cursorAfter);
      grant.knownRoomSeqs.add(delivery.cursorAfter);
      writeJson(response, 200, WorkerSyncResponseSchema.parse(delivery));
      return;
    }

    if (route === "/v1/worker/tasks/get") {
      const { taskId } = parseWorkerRequest(WorkerTaskGetRequestSchema, body);
      const task = this.#kernel.getWorkerTask(grant.execution, { taskId });
      this.#synchronizeTaskHeartbeat(grant, task);
      writeJson(response, 200, WorkerTaskGetResponseSchema.parse({ task }));
      return;
    }

    if (route === "/v1/worker/tasks/input-status") {
      const { taskId } = parseWorkerRequest(
        WorkerTaskInputStatusRequestSchema,
        body,
      );
      const inputRequest = this.#kernel.getWorkerTaskInputStatus(
        grant.execution,
        { taskId },
      );
      writeJson(
        response,
        200,
        WorkerTaskInputStatusResponseSchema.parse({ inputRequest }),
      );
      return;
    }

    if (route.startsWith("/v1/worker/tasks/")) {
      const mutation = this.#handleTaskCommand(route, body, grant);
      grant.knownRoomSeqs.add(mutation.event.roomSeq);
      this.#synchronizeTaskHeartbeat(grant, mutation.task);
      writeJson(
        response,
        200,
        route === "/v1/worker/tasks/request-input"
          ? WorkerTaskRequestInputResponseSchema.parse(mutation)
          : route === "/v1/worker/tasks/block" ||
              route === "/v1/worker/tasks/release"
            ? WorkerTaskAttentionMutationResponseSchema.parse(mutation)
            : WorkerTaskMutationResponseSchema.parse(mutation),
      );
      return;
    }

    const { throughSeq } = parseWorkerRequest(
      WorkerAcknowledgeRequestSchema,
      body,
    );
    if (!grant.deliveredCursors.has(throughSeq)) {
      throw new HttpRequestError(
        "cursor_not_delivered",
        "throughSeq was not delivered to this worker credential",
        409,
      );
    }
    if (throughSeq > grant.scope.toSeq) {
      throw new HttpRequestError(
        "cursor_out_of_scope",
        "throughSeq exceeds this Activation range",
        409,
      );
    }
    this.#kernel.acknowledgeWorkerCursor(grant.execution, {
      throughSeq,
    });
    writeJson(
      response,
      200,
      WorkerAcknowledgeResponseSchema.parse({
        acknowledgedThrough: throughSeq,
      }),
    );
  }

  #handleTaskCommand(
    route: string,
    body: Record<string, unknown>,
    grant: WorkerGrant,
  ) {
    if (route === "/v1/worker/tasks/claim") {
      const command = parseWorkerRequest(WorkerTaskClaimRequestSchema, body);
      this.#requireKnownCausalCursor(grant, command.basedOnRoomSeq);
      return this.#kernel.claimTask(grant.execution, {
        ...command,
        leaseMs: this.#taskClaimLeaseMs,
      });
    }
    if (route === "/v1/worker/tasks/start") {
      const command = parseWorkerRequest(WorkerTaskStartRequestSchema, body);
      this.#requireKnownCausalCursor(grant, command.basedOnRoomSeq);
      return this.#kernel.startTask(grant.execution, {
        ...command,
        leaseMs: this.#taskClaimLeaseMs,
      });
    }
    if (route === "/v1/worker/tasks/progress") {
      const command = parseWorkerRequest(WorkerTaskProgressRequestSchema, body);
      this.#requireKnownCausalCursor(grant, command.basedOnRoomSeq);
      return this.#kernel.progressTask(grant.execution, {
        ...command,
        leaseMs: this.#taskClaimLeaseMs,
      });
    }
    if (route === "/v1/worker/tasks/release") {
      const command = parseWorkerRequest(WorkerTaskReleaseRequestSchema, body);
      this.#requireKnownCausalCursor(grant, command.basedOnRoomSeq);
      return this.#kernel.releaseTask(grant.execution, command);
    }
    if (route === "/v1/worker/tasks/block") {
      const command = parseWorkerRequest(WorkerTaskBlockRequestSchema, body);
      this.#requireKnownCausalCursor(grant, command.basedOnRoomSeq);
      return this.#kernel.blockTask(grant.execution, command);
    }
    if (route === "/v1/worker/tasks/request-input") {
      const command = parseWorkerRequest(
        WorkerTaskRequestInputRequestSchema,
        body,
      );
      this.#requireKnownCausalCursor(grant, command.basedOnRoomSeq);
      return this.#kernel.requestTaskInput(grant.execution, command);
    }
    const command = parseWorkerRequest(WorkerTaskSubmitRequestSchema, body);
    this.#requireKnownCausalCursor(grant, command.basedOnRoomSeq);
    return this.#kernel.submitTask(grant.execution, command);
  }

  #requireKnownCausalCursor(grant: WorkerGrant, basedOnRoomSeq: number): void {
    if (!grant.knownRoomSeqs.has(basedOnRoomSeq)) {
      throw new HttpRequestError(
        "causal_cursor_not_delivered",
        "basedOnRoomSeq was neither delivered nor produced for this worker credential",
        409,
      );
    }
  }

  #synchronizeTaskHeartbeat(grant: WorkerGrant, task: Task): void {
    if (task.state === "claimed" || task.state === "in_progress") {
      grant.claimedTaskIds.add(task.taskId);
    } else {
      grant.claimedTaskIds.delete(task.taskId);
    }
    if (grant.claimedTaskIds.size === 0) {
      this.#stopTaskHeartbeat(grant);
      return;
    }
    if (grant.heartbeatTimer !== undefined) return;
    grant.heartbeatTimer = setInterval(() => {
      for (const taskId of [...grant.claimedTaskIds]) {
        try {
          const renewed = this.#kernel.heartbeatTaskClaim(grant.execution, {
            leaseMs: this.#taskClaimLeaseMs,
            taskId,
          });
          if (renewed.state !== "claimed" && renewed.state !== "in_progress") {
            grant.claimedTaskIds.delete(taskId);
          }
        } catch {
          grant.claimedTaskIds.delete(taskId);
        }
      }
      if (grant.claimedTaskIds.size === 0) {
        this.#stopTaskHeartbeat(grant);
      }
    }, this.#taskClaimHeartbeatIntervalMs);
    grant.heartbeatTimer.unref();
  }

  #stopTaskHeartbeat(grant: WorkerGrant): void {
    if (grant.heartbeatTimer !== undefined) {
      clearInterval(grant.heartbeatTimer);
      delete grant.heartbeatTimer;
    }
  }

  #deleteGrant(tokenHash: string): void {
    const grant = this.#grants.get(tokenHash);
    if (grant !== undefined) this.#stopTaskHeartbeat(grant);
    this.#grants.delete(tokenHash);
  }

  #authenticate(request: IncomingMessage): WorkerGrant {
    const authorization = request.headers.authorization;
    if (
      authorization === undefined ||
      Array.isArray(authorization) ||
      !authorization.startsWith("Bearer ")
    ) {
      throw new HttpRequestError(
        "unauthenticated",
        "worker authentication failed",
        401,
      );
    }
    const accessToken = authorization.slice("Bearer ".length);
    if (accessToken.length === 0) {
      throw new HttpRequestError(
        "unauthenticated",
        "worker authentication failed",
        401,
      );
    }
    const tokenHash = hashToken(accessToken);
    const grant = this.#grants.get(tokenHash);
    if (grant === undefined) {
      throw new HttpRequestError(
        "unauthenticated",
        "worker authentication failed",
        401,
      );
    }
    if (grant.expiresAtMs <= this.#now().getTime()) {
      this.#deleteGrant(tokenHash);
      throw new HttpRequestError(
        "unauthenticated",
        "worker authentication failed",
        401,
      );
    }
    return grant;
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
        WorkerErrorResponseSchema.parse({
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
        WorkerErrorResponseSchema.parse({
          error: { code: error.code, message: error.message },
        }),
      );
      return;
    }
    writeJson(
      response,
      500,
      WorkerErrorResponseSchema.parse({
        error: {
          code: "internal_error",
          message: "internal server error",
        },
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

function parseWorkerRequest<T>(
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

function hashToken(accessToken: string): string {
  return createHash("sha256").update(accessToken, "utf8").digest("hex");
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
