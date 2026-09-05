import { createHash, randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

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
  WorkerArtifactPrepareRequestSchema,
  WorkerArtifactUploadSchema,
  WorkerErrorResponseSchema,
  WorkerMessagePostResponseSchema,
  WorkerMessagePostRequestSchema,
  WorkerReminderCancelRequestSchema,
  WorkerReminderListRequestSchema,
  WorkerReminderListResponseSchema,
  WorkerReminderLogRequestSchema,
  WorkerReminderLogResponseSchema,
  WorkerReminderMutationResponseSchema,
  WorkerReminderScheduleRequestSchema,
  WorkerReminderSnoozeRequestSchema,
  WorkerReminderUpdateRequestSchema,
  WorkerManagedMcpCallRequestSchema,
  WorkerManagedMcpCallResponseSchema,
  WorkerManagedMcpCatalogRequestSchema,
  WorkerManagedMcpCatalogResponseSchema,
  WorkerSyncRequestSchema,
  WorkerSyncResponseSchema,
  WorkerTaskClaimRequestSchema,
  WorkerTaskClaimMessageRequestSchema,
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
  WorkerTaskReviewRequestSchema,
  WorkerTaskReviewResponseSchema,
  WorkerTaskReleaseRequestSchema,
  WorkerTaskStartRequestSchema,
  WorkerTaskSubmitRequestSchema,
  WorkerTaskSubmissionRequestSchema,
  WorkerTaskSubmissionResponseSchema,
  WorkerThreadUnfollowRequestSchema,
  WorkerThreadUnfollowResponseSchema,
  type ActivationCredentialScope,
  type TaskSubmissionRepositoryEvidence,
  type Task,
} from "@rah-os/protocol";

import type { ManagedMcpExecutorPort } from "./managed-mcp-executor.ts";

export type { ActivationCredentialScope } from "@rah-os/protocol";

export type IssuedActivationCredential = {
  accessToken: string;
  expiresAt: string;
  revoke: () => void;
};

export type WorkerApplicationServiceOptions = {
  deliveryEvidenceCollector?: TaskDeliveryEvidenceCollector;
  kernel: RoomKernel;
  now?: () => Date;
  taskClaimHeartbeatIntervalMs?: number;
  taskClaimLeaseMs?: number;
  managedMcpExecutor?: ManagedMcpExecutorPort;
  managedMcpTimeoutMs?: number;
};

export type TaskDeliveryEvidenceUnavailableReason =
  | "capture_failed"
  | "collector_unavailable"
  | "not_git"
  | "workspace_not_bound";

export type TaskDeliveryEvidenceBaseline =
  | {
      baseCommit: string;
      repositoryId: `sha256:${string}`;
      source: "git";
      workspaceRoot: string;
    }
  | {
      reason: TaskDeliveryEvidenceUnavailableReason;
      source: "unavailable";
      workspaceRoot: string;
    };

export type TaskDeliveryEvidenceCapture = {
  baseCommit: string;
  headCommit: string;
  patch: Uint8Array;
  repositoryId: `sha256:${string}`;
};

export type TaskDeliveryEvidenceCollector = {
  captureBaseline(input: {
    workspaceRoot: string;
  }): Promise<TaskDeliveryEvidenceBaseline>;
  captureSubmission(input: {
    baseline: Extract<TaskDeliveryEvidenceBaseline, { source: "git" }>;
  }): Promise<TaskDeliveryEvidenceCapture>;
};

type WorkerGrant = {
  claimedTaskIds: Set<string>;
  deliveredCursors: Set<number>;
  deliveryEvidenceBaseline?: TaskDeliveryEvidenceBaseline;
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

const MAX_BODY_BYTES = 128 * 1_024;
const DEFAULT_CREDENTIAL_TTL_MS = 30 * 60_000;
const DEFAULT_TASK_CLAIM_LEASE_MS = 5 * 60_000;
const DEFAULT_MANAGED_MCP_TIMEOUT_MS = 25_000;
const WORKER_ARTIFACT_ROUTE =
  /^\/v1\/worker\/artifacts\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u;

export const WORKER_HTTP_ROUTE_PATHS = [
  "/v1/worker/acknowledge",
  "/v1/worker/artifacts/prepare",
  "/v1/worker/messages/post",
  "/v1/worker/mcp/call",
  "/v1/worker/mcp/tools",
  "/v1/worker/reminders/cancel",
  "/v1/worker/reminders/list",
  "/v1/worker/reminders/log",
  "/v1/worker/reminders/schedule",
  "/v1/worker/reminders/snooze",
  "/v1/worker/reminders/update",
  "/v1/worker/sync",
  "/v1/worker/threads/unfollow",
  "/v1/worker/tasks/claim",
  "/v1/worker/tasks/claim-message",
  "/v1/worker/tasks/block",
  "/v1/worker/tasks/get",
  "/v1/worker/tasks/input-status",
  "/v1/worker/tasks/progress",
  "/v1/worker/tasks/release",
  "/v1/worker/tasks/request-input",
  "/v1/worker/tasks/review",
  "/v1/worker/tasks/start",
  "/v1/worker/tasks/submit",
  "/v1/worker/tasks/submission",
] as const;
const WORKER_ROUTES = new Set<string>(WORKER_HTTP_ROUTE_PATHS);

export class WorkerApplicationService {
  readonly #grants = new Map<string, WorkerGrant>();
  readonly #kernel: RoomKernel;
  readonly #deliveryEvidenceCollector:
    TaskDeliveryEvidenceCollector | undefined;
  readonly #now: () => Date;
  readonly #taskClaimHeartbeatIntervalMs: number;
  readonly #taskClaimLeaseMs: number;
  readonly #managedMcpExecutor: ManagedMcpExecutorPort | undefined;
  readonly #managedMcpTimeoutMs: number;
  #origin: string | undefined;
  #server: Server | undefined;

  constructor(options: WorkerApplicationServiceOptions) {
    this.#kernel = options.kernel;
    this.#deliveryEvidenceCollector = options.deliveryEvidenceCollector;
    this.#managedMcpExecutor = options.managedMcpExecutor;
    this.#managedMcpTimeoutMs =
      options.managedMcpTimeoutMs ?? DEFAULT_MANAGED_MCP_TIMEOUT_MS;
    if (
      !Number.isInteger(this.#managedMcpTimeoutMs) ||
      this.#managedMcpTimeoutMs <= 0
    ) {
      throw new Error("managedMcpTimeoutMs must be a positive integer");
    }
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
    server.requestTimeout = 120_000;
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
    return this.#issueActivationCredential(host, uncheckedScope, options);
  }

  async issueActivationCredentialForWorkspace(
    host: AuthenticatedHostContext,
    uncheckedScope: ActivationCredentialScope,
    options: { ttlMs?: number; workspaceRoot: string },
  ): Promise<IssuedActivationCredential> {
    const collector = this.#deliveryEvidenceCollector;
    let baseline: TaskDeliveryEvidenceBaseline;
    if (collector === undefined) {
      baseline = {
        reason: "collector_unavailable",
        source: "unavailable",
        workspaceRoot: options.workspaceRoot,
      };
    } else {
      try {
        baseline = await collector.captureBaseline({
          workspaceRoot: options.workspaceRoot,
        });
      } catch {
        baseline = {
          reason: "capture_failed",
          source: "unavailable",
          workspaceRoot: options.workspaceRoot,
        };
      }
    }
    return this.#issueActivationCredential(host, uncheckedScope, {
      ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
      deliveryEvidenceBaseline: baseline,
    });
  }

  #issueActivationCredential(
    host: AuthenticatedHostContext,
    uncheckedScope: ActivationCredentialScope,
    options: {
      deliveryEvidenceBaseline?: TaskDeliveryEvidenceBaseline;
      ttlMs?: number;
    },
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
    const expiresAtMs = this.#now().getTime() + ttlMs;
    this.#grants.set(tokenHash, {
      claimedTaskIds: new Set<string>(),
      deliveredCursors: new Set<number>(),
      ...(options.deliveryEvidenceBaseline === undefined
        ? {}
        : { deliveryEvidenceBaseline: options.deliveryEvidenceBaseline }),
      execution,
      expiresAtMs,
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
      expiresAt: new Date(expiresAtMs).toISOString(),
      revoke: () => {
        this.#deleteGrant(tokenHash);
      },
    };
  }

  async #handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const route = request.url;
    const artifactMatch =
      route === undefined ? null : WORKER_ARTIFACT_ROUTE.exec(route);
    if (artifactMatch !== null) {
      if (request.method === "GET") {
        const grant = this.#authenticate(request);
        const download = await this.#kernel.files.downloadWorkerTaskArtifact(
          grant.execution,
          artifactMatch[1]!,
        );
        response.statusCode = 200;
        response.setHeader("content-length", String(download.attachment.size));
        response.setHeader("content-type", download.attachment.mimeType);
        response.setHeader("cache-control", "private, no-store");
        await pipeline(download.stream, response);
        return;
      }
      if (request.method !== "PUT") {
        throw new HttpRequestError(
          "method_not_allowed",
          "artifact content requires GET or PUT",
          405,
        );
      }
      const grant = this.#authenticate(request);
      const upload = await this.#kernel.files.uploadWorker(
        grant.execution,
        artifactMatch[1]!,
        request,
      );
      writeJson(response, 200, WorkerArtifactUploadSchema.parse(upload));
      return;
    }
    if (request.method !== "POST") {
      throw new HttpRequestError(
        "method_not_allowed",
        "only POST is supported",
        405,
      );
    }
    if (route === undefined || !WORKER_ROUTES.has(route)) {
      throw new HttpRequestError("not_found", "route was not found", 404);
    }

    const grant = this.#authenticate(request);
    const body = await readJsonObject(request);
    if (route === "/v1/worker/artifacts/prepare") {
      const command = parseWorkerRequest(
        WorkerArtifactPrepareRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        WorkerArtifactUploadSchema.parse(
          this.#kernel.files.prepareWorker(grant.execution, command),
        ),
      );
      return;
    }
    if (route === "/v1/worker/mcp/tools") {
      parseWorkerRequest(WorkerManagedMcpCatalogRequestSchema, body);
      writeJson(
        response,
        200,
        WorkerManagedMcpCatalogResponseSchema.parse(
          this.#kernel.managedMcp.listCatalog(grant.execution),
        ),
      );
      return;
    }
    if (route === "/v1/worker/mcp/call") {
      const command = parseWorkerRequest(
        WorkerManagedMcpCallRequestSchema,
        body,
      );
      const authorized = this.#kernel.managedMcp.authorizeCall(
        grant.execution,
        command,
      );
      const executor = this.#managedMcpExecutor;
      if (executor === undefined) {
        this.#kernel.managedMcp.failCall(grant.execution, {
          failureCode: "executor_unavailable",
          managedMcpCallId: authorized.call.managedMcpCallId,
        });
        throw new HttpRequestError(
          "managed_mcp_unavailable",
          "managed MCP executor is unavailable",
          503,
        );
      }
      const controller = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      let result: ReturnType<typeof WorkerManagedMcpCallResponseSchema.parse>;
      try {
        result = WorkerManagedMcpCallResponseSchema.parse(
          await Promise.race([
            executor.call(
              { ...authorized.call, executorRef: authorized.executorRef },
              { signal: controller.signal },
            ),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                reject(new ManagedMcpTimeoutError());
              }, this.#managedMcpTimeoutMs);
            }),
          ]),
        );
      } catch (error) {
        const failureCode =
          error instanceof ManagedMcpTimeoutError
            ? "timeout"
            : error instanceof Error && error.name === "ZodError"
              ? "invalid_result"
              : "executor_failed";
        this.#kernel.managedMcp.failCall(grant.execution, {
          failureCode,
          managedMcpCallId: authorized.call.managedMcpCallId,
        });
        throw new HttpRequestError(
          failureCode === "timeout"
            ? "managed_mcp_timeout"
            : "managed_mcp_failed",
          failureCode === "timeout"
            ? "managed MCP call timed out"
            : "managed MCP call failed",
          failureCode === "timeout" ? 504 : 502,
        );
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      const completed = this.#kernel.managedMcp.completeCall(grant.execution, {
        managedMcpCallId: authorized.call.managedMcpCallId,
        result,
      });
      writeJson(response, 200, completed);
      return;
    }
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

    if (route === "/v1/worker/tasks/submission") {
      const command = parseWorkerRequest(
        WorkerTaskSubmissionRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        WorkerTaskSubmissionResponseSchema.parse({
          submission: this.#kernel.taskReviews.getWorkerTaskSubmission(
            grant.execution,
            command,
          ),
        }),
      );
      return;
    }

    if (route === "/v1/worker/messages/post") {
      const command = parseWorkerRequest(WorkerMessagePostRequestSchema, body);
      this.#requireKnownCausalCursor(grant, command.basedOnRoomSeq);
      const mutation = this.#kernel.postWorkerMessage(grant.execution, command);
      if ("event" in mutation) {
        grant.knownRoomSeqs.add(mutation.event.roomSeq);
      }
      writeJson(response, 200, WorkerMessagePostResponseSchema.parse(mutation));
      return;
    }

    if (route === "/v1/worker/threads/unfollow") {
      const command = parseWorkerRequest(
        WorkerThreadUnfollowRequestSchema,
        body,
      );
      this.#requireKnownCausalCursor(grant, command.basedOnRoomSeq);
      const mutation = this.#kernel.unfollowWorkerThread(
        grant.execution,
        command,
      );
      grant.knownRoomSeqs.add(mutation.event.roomSeq);
      writeJson(
        response,
        200,
        WorkerThreadUnfollowResponseSchema.parse(mutation),
      );
      return;
    }

    if (route === "/v1/worker/reminders/list") {
      const command = parseWorkerRequest(WorkerReminderListRequestSchema, body);
      writeJson(
        response,
        200,
        WorkerReminderListResponseSchema.parse({
          reminders: this.#kernel.reminders.listWorker(
            grant.execution,
            command,
          ),
        }),
      );
      return;
    }
    if (route === "/v1/worker/reminders/log") {
      const command = parseWorkerRequest(WorkerReminderLogRequestSchema, body);
      writeJson(
        response,
        200,
        WorkerReminderLogResponseSchema.parse(
          this.#kernel.reminders.log(grant.execution, command),
        ),
      );
      return;
    }
    if (route.startsWith("/v1/worker/reminders/")) {
      let mutation;
      if (route === "/v1/worker/reminders/schedule") {
        const command = parseWorkerRequest(
          WorkerReminderScheduleRequestSchema,
          body,
        );
        this.#requireKnownCausalCursor(grant, command.basedOnRoomSeq);
        mutation = this.#kernel.reminders.schedule(grant.execution, command);
      } else if (route === "/v1/worker/reminders/cancel") {
        mutation = this.#kernel.reminders.cancel(
          grant.execution,
          parseWorkerRequest(WorkerReminderCancelRequestSchema, body),
        );
      } else if (route === "/v1/worker/reminders/snooze") {
        mutation = this.#kernel.reminders.snooze(
          grant.execution,
          parseWorkerRequest(WorkerReminderSnoozeRequestSchema, body),
        );
      } else {
        mutation = this.#kernel.reminders.update(
          grant.execution,
          parseWorkerRequest(WorkerReminderUpdateRequestSchema, body),
        );
      }
      writeJson(
        response,
        200,
        WorkerReminderMutationResponseSchema.parse(mutation),
      );
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
      const mutation = await this.#handleTaskCommand(route, body, grant);
      grant.knownRoomSeqs.add(mutation.event.roomSeq);
      this.#synchronizeTaskHeartbeat(grant, mutation.task);
      writeJson(
        response,
        200,
        route === "/v1/worker/tasks/request-input"
          ? WorkerTaskRequestInputResponseSchema.parse(mutation)
          : route === "/v1/worker/tasks/review"
            ? WorkerTaskReviewResponseSchema.parse(mutation)
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

  async #handleTaskCommand(
    route: string,
    body: Record<string, unknown>,
    grant: WorkerGrant,
  ) {
    if (route === "/v1/worker/tasks/claim-message") {
      const command = parseWorkerRequest(
        WorkerTaskClaimMessageRequestSchema,
        body,
      );
      this.#requireKnownCausalCursor(grant, command.basedOnRoomSeq);
      return this.#kernel.claimMessageAsTask(grant.execution, {
        ...command,
        leaseMs: this.#taskClaimLeaseMs,
      });
    }
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
    if (route === "/v1/worker/tasks/review") {
      const command = parseWorkerRequest(WorkerTaskReviewRequestSchema, body);
      this.#requireKnownCausalCursor(grant, command.basedOnRoomSeq);
      return this.#kernel.taskReviews.reviewTask(grant.execution, command);
    }
    const command = parseWorkerRequest(WorkerTaskSubmitRequestSchema, body);
    this.#requireKnownCausalCursor(grant, command.basedOnRoomSeq);
    const deliveryRepository = await this.#captureTaskDeliveryEvidence(
      grant,
      command.taskId,
      command.idempotencyKey,
    );
    return this.#kernel.submitTask(grant.execution, {
      basedOnRoomSeq: command.basedOnRoomSeq,
      deliveryRepository,
      idempotencyKey: command.idempotencyKey,
      summary: command.summary,
      taskId: command.taskId,
      ...(command.verification === undefined
        ? {}
        : { verification: command.verification }),
    });
  }

  async #captureTaskDeliveryEvidence(
    grant: WorkerGrant,
    taskId: string,
    idempotencyKey: string,
  ): Promise<TaskSubmissionRepositoryEvidence> {
    const baseline = grant.deliveryEvidenceBaseline;
    if (baseline === undefined) {
      return { reason: "workspace_not_bound", source: "unavailable" };
    }
    if (baseline.source === "unavailable") {
      return { reason: baseline.reason, source: "unavailable" };
    }
    const collector = this.#deliveryEvidenceCollector;
    if (collector === undefined) {
      return { reason: "collector_unavailable", source: "unavailable" };
    }
    let capture: TaskDeliveryEvidenceCapture;
    try {
      capture = await collector.captureSubmission({ baseline });
    } catch {
      throw new HttpRequestError(
        "delivery_evidence_capture_failed",
        "Git delivery evidence could not be frozen; retry after the workspace is stable",
        503,
      );
    }
    if (
      capture.baseCommit !== baseline.baseCommit ||
      capture.repositoryId !== baseline.repositoryId
    ) {
      throw new HttpRequestError(
        "delivery_evidence_identity_changed",
        "Git repository identity changed during this RunAttempt",
        409,
      );
    }
    const patchDigest = `sha256:${createHash("sha256")
      .update(capture.patch)
      .digest("hex")}` as const;
    let patchAttachmentId: string | undefined;
    if (capture.patch.byteLength > 0) {
      const requestKey = `task-delivery:${createHash("sha256")
        .update(`${taskId}\u0000${idempotencyKey}`, "utf8")
        .digest("hex")}`;
      const prepared = this.#kernel.files.prepareWorker(grant.execution, {
        filename: "rah-task-delivery.patch",
        idempotencyKey: requestKey,
        mimeType: "text/x-diff",
        size: capture.patch.byteLength,
        taskId,
      });
      patchAttachmentId = prepared.attachmentId;
      if (prepared.state === "pending") {
        const uploaded = await this.#kernel.files.uploadWorker(
          grant.execution,
          prepared.attachmentId,
          Readable.from([capture.patch]),
        );
        if (uploaded.sha256 !== patchDigest.slice("sha256:".length)) {
          throw new HttpRequestError(
            "delivery_evidence_digest_mismatch",
            "Frozen Git patch digest did not match the stored Artifact",
            500,
          );
        }
      } else if (
        prepared.state !== "completed" &&
        prepared.state !== "consumed"
      ) {
        throw new HttpRequestError(
          "delivery_evidence_artifact_unavailable",
          `Frozen Git patch Artifact is ${prepared.state}`,
          409,
        );
      } else if (
        prepared.sha256 !== undefined &&
        prepared.sha256 !== patchDigest.slice("sha256:".length)
      ) {
        throw new HttpRequestError(
          "delivery_evidence_digest_mismatch",
          "Frozen Git patch retry did not match the original Artifact",
          409,
        );
      }
    }
    return {
      baseCommit: capture.baseCommit,
      headCommit: capture.headCommit,
      ...(patchAttachmentId === undefined ? {} : { patchAttachmentId }),
      patchDigest,
      patchSize: capture.patch.byteLength,
      repositoryId: capture.repositoryId,
      source: "host_observed",
      vcs: "git",
    };
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

class ManagedMcpTimeoutError extends Error {}

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
        "request body exceeds 128 KiB",
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
