import { WorkerTaskUpdateRequestSchema } from "@rah-os/protocol";
import {
  WorkerTaskBatchCreateRequestSchema,
  WorkerTaskBatchClaimRequestSchema,
} from "@rah-os/protocol";
import {
  WorkerMessageCheckRequestSchema,
  WorkerMessageCheckResponseSchema,
} from "@rah-os/protocol";
import type { WorkerProfileMetadataPort } from "@rah-os/kernel";
import {
  WorkerIntrospectionRequestSchema,
  WorkerLiveVersionResponseSchema,
} from "@rah-os/protocol";
import {
  WorkerChannelAttentionRequestSchema,
  WorkerChannelAttentionResponseSchema,
} from "@rah-os/protocol";
import { StaleContextError } from "@rah-os/kernel";
import { WorkerTaskHeldResponseSchema } from "@rah-os/protocol";
import {
  WorkerTaskAmendRequestSchema,
  WorkerTaskDeleteRequestSchema,
  TaskDeleteResponseSchema,
  TASK_CARD_TRANSPORT_MAX_BYTES,
} from "@rah-os/protocol";
import {
  uploadWorkerSelfAvatar,
  type WorkerProfileImageStore,
} from "./worker-profile-image-upload.ts";
import {
  mapProfileImageStorageError,
  ProfileImageRequestError,
} from "./client-profile-image-routes.ts";
import { ProfileImageMimeTypeSchema } from "@rah-os/protocol";
import {
  WorkerSelfProfileGetRequestSchema,
  WorkerSelfProfileUpdateRequestSchema,
  WorkerSelfProfileResponseSchema,
  WorkerSelfProfileUpdateResponseSchema,
} from "@rah-os/protocol";
import {
  WorkerTaskAssignRequestSchema,
  WorkerTaskUnblockRequestSchema,
  WorkerTaskConvertRequestSchema,
} from "@rah-os/protocol";
import {
  WORKER_READ_ROUTE_PATHS,
  handleWorkerReadRequest,
} from "./worker-read-handler.ts";
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
  WorkerMessageReactionRequestSchema,
  MessageSocialItemSchema,
  ActivationCredentialScopeSchema,
  WorkerAcknowledgeRequestSchema,
  WorkerAcknowledgeResponseSchema,
  WorkerArtifactPrepareRequestSchema,
  WorkerArtifactUploadSchema,
  WorkerMessageAttachmentPrepareRequestSchema,
  WorkerMessageAttachmentUploadSchema,
  WorkerMessageAttachmentCancelRequestSchema,
  WorkerErrorResponseSchema,
  WORKER_MESSAGE_RESOLVE_NOT_FOUND_NEXT_ACTION,
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
  WorkerSyncRequestSchema,
  WorkerSyncResponseSchema,
  WorkerTaskClaimRequestSchema,
  WorkerTaskClaimMessageRequestSchema,
  WorkerTaskCreateRequestSchema,
  WorkerTaskBlockRequestSchema,
  WorkerTaskGetRequestSchema,
  WorkerTaskTrajectoryRequestSchema,
  WorkerTaskTrajectoryResponseSchema,
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
  WorkerTaskAddressSchema,
  WorkerTaskSubmitRequestSchema,
  WorkerTaskSubmissionRequestSchema,
  WorkerTaskSubmissionResponseSchema,
  WorkerThreadUnfollowRequestSchema,
  WorkerThreadUnfollowResponseSchema,
  type ActivationCredentialScope,
  type TaskSubmissionRepositoryEvidence,
  type Task,
} from "@rah-os/protocol";

export type { ActivationCredentialScope } from "@rah-os/protocol";

export type IssuedActivationCredential = {
  accessToken: string;
  expiresAt: string;
  revoke: () => void;
};

export type WorkerApplicationServiceOptions = {
  profileMetadata?: WorkerProfileMetadataPort;
  serviceInfo?: () => { buildVersion: string; protocolVersion: number };
  deliveryEvidenceCollector?: TaskDeliveryEvidenceCollector;
  kernel: RoomKernel;
  profileImageStore?: WorkerProfileImageStore;
  now?: () => Date;
  taskClaimHeartbeatIntervalMs?: number;
  taskClaimLeaseMs?: number;
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
  messageCheck?: { cursor?: number; pending: Set<number> };
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

/**
 * Raft attaches a recovery instruction where it knows both the command and the
 * failure, and attaches none anywhere else — `apiFailureError` passes the
 * server's own `suggestedNextAction` through untouched and invents nothing
 * (`main.js@29998456`). RAH's dispatch is the place that knows both, so the
 * table below is keyed the same way Raft's per-command mappers are: route plus
 * stable code. It holds only rows whose upstream wording survives the move.
 *
 * Deliberately absent, with the evidence for each absence:
 *
 * - `execution_fenced`, `causal_cursor_not_delivered`, `cursor_not_delivered`,
 *   `stale_context`, `delivery_not_proven`, `runtime_termination_not_proven`,
 *   `task_not_submitted`: RAH-only fences. Raft has no code covering the same
 *   situation, and its nearest text ("rerun the task claim command if it is
 *   still correct", `main.js@32650425`) both belongs to a hold that exits 0
 *   and carries a judgment clause, so it is not portable here.
 * - `forbidden` on `/v1/worker/tasks/delete`: Raft's 403 guidance names a
 *   server admin and a "close it instead" path (`main.js@32672815`); RAH's
 *   Worker delete admits neither, and its 403 also covers two non-authority
 *   refusals, so upstream's sentence would misstate RAH.
 * - `not_found` on every other read route: Raft's `mapReadFailure` passes the
 *   server's action through and supplies no literal (`main.js@30186333`).
 */
const WORKER_ERROR_NEXT_ACTIONS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  "/v1/worker/messages/resolve": {
    not_found: WORKER_MESSAGE_RESOLVE_NOT_FOUND_NEXT_ACTION,
  },
};

function suggestedNextActionFor(
  route: string | undefined,
  code: string,
): { suggestedNextAction?: string } {
  const action =
    route === undefined ? undefined : WORKER_ERROR_NEXT_ACTIONS[route]?.[code];
  return action === undefined ? {} : { suggestedNextAction: action };
}

const MAX_BODY_BYTES = 128 * 1_024;
const DEFAULT_CREDENTIAL_TTL_MS = 30 * 60_000;
const DEFAULT_TASK_CLAIM_LEASE_MS = 5 * 60_000;
const WORKER_ARTIFACT_ROUTE =
  /^\/v1\/worker\/artifacts\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u;

const WORKER_MESSAGE_ATTACHMENT_ROUTE =
  /^\/v1\/worker\/attachments\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u;

export const WORKER_HTTP_ROUTE_PATHS = [
  "/v1/worker/attachments/prepare",
  "/v1/worker/attachments/cancel",
  ...WORKER_READ_ROUTE_PATHS,
  "/v1/worker/version",
  "/v1/worker/acknowledge",
  "/v1/worker/artifacts/prepare",
  "/v1/worker/messages/post",
  "/v1/worker/messages/search",
  "/v1/worker/messages/react",
  "/v1/worker/reminders/cancel",
  "/v1/worker/reminders/list",
  "/v1/worker/reminders/log",
  "/v1/worker/reminders/schedule",
  "/v1/worker/reminders/snooze",
  "/v1/worker/reminders/update",
  "/v1/worker/sync",
  "/v1/worker/message-check",
  "/v1/worker/threads/unfollow",
  "/v1/worker/channels/mute",
  "/v1/worker/channels/unmute",
  "/v1/worker/tasks/claim",
  "/v1/worker/tasks/claim-message",
  "/v1/worker/profile/self/get",
  "/v1/worker/profile/self/update",
  "/v1/worker/tasks/create",
  "/v1/worker/tasks/create-batch",
  "/v1/worker/tasks/claim-batch",
  "/v1/worker/tasks/assign",
  "/v1/worker/tasks/amend",
  "/v1/worker/tasks/delete",
  "/v1/worker/tasks/unblock",
  "/v1/worker/tasks/convert",
  "/v1/worker/tasks/block",
  "/v1/worker/tasks/get",
  "/v1/worker/tasks/input-status",
  "/v1/worker/tasks/progress",
  "/v1/worker/tasks/release",
  "/v1/worker/tasks/request-input",
  "/v1/worker/tasks/review",
  "/v1/worker/tasks/start",
  "/v1/worker/tasks/update-status",
  "/v1/worker/tasks/submit",
  "/v1/worker/tasks/submission",
  "/v1/worker/tasks/trajectory",
] as const;
const WORKER_ROUTES = new Set<string>(WORKER_HTTP_ROUTE_PATHS);

/**
 * Raft's Task family is addressed by `{ channel, task_number }`; only these
 * three Task routes are addressed by something other than a Task, so only they
 * refuse the pair. `tasks/convert` and `tasks/claim-message` address a message
 * and `tasks/create` addresses nothing yet, exactly as upstream.
 */
/**
 * The Task routes whose upstream counterpart renders a freshness hold. Raft
 * holds three commands — claim, update, amend — and RAH's `claim-message` is
 * the message-id selector of the same claim.
 *
 * `submit` is RAH's share of Raft's `update`: `in_review` is reached upstream
 * only by `raft task update`, which holds, and the factory prompt says so
 * outright — "When done, set status to `in_review` so a human can validate via
 * `raft task update`". `task-submit` is the one Agent-facing RAH operation that
 * reaches that status.
 *
 * The rest of `update`'s statuses are not settled, and the evidence contains
 * the counterexamples that block the inference rather than merely lacking
 * support: `unclaim` reaches `todo` without holding, and
 * `task create --assignee @yourself` reaches `in_progress` without holding, so
 * "this transition holds upstream" cannot be argued from the target status.
 * `done` and `closed` have no Agent-facing RAH operation at all.
 */
const TASK_FRESHNESS_HOLD_ROUTES = new Set<string>([
  "/v1/worker/tasks/claim",
  "/v1/worker/tasks/claim-message",
  "/v1/worker/tasks/amend",
  "/v1/worker/tasks/submit",
  "/v1/worker/tasks/update-status",
]);

const TASK_ROUTES_WITHOUT_A_TASK = new Set<string>([
  "/v1/worker/tasks/claim-message",
  "/v1/worker/tasks/convert",
  "/v1/worker/tasks/create",
]);

/** Task read routes that already carry their own `channel` selector. */
const TASK_ROUTES_WITH_OWN_CHANNEL = new Set<string>([
  "/v1/worker/tasks/create-batch",
  "/v1/worker/tasks/claim-batch",
  "/v1/worker/tasks/history",
  "/v1/worker/tasks/list",
]);

export class WorkerApplicationService {
  readonly #profileMetadata: WorkerProfileMetadataPort | undefined;
  readonly #serviceInfo: WorkerApplicationServiceOptions["serviceInfo"];
  readonly #grants = new Map<string, WorkerGrant>();
  readonly #kernel: RoomKernel;
  readonly #profileImageStore: WorkerProfileImageStore | undefined;
  readonly #deliveryEvidenceCollector:
    TaskDeliveryEvidenceCollector | undefined;
  readonly #now: () => Date;
  readonly #taskClaimHeartbeatIntervalMs: number;
  readonly #taskClaimLeaseMs: number;

  #origin: string | undefined;
  #server: Server | undefined;

  constructor(options: WorkerApplicationServiceOptions) {
    this.#serviceInfo = options.serviceInfo;
    this.#profileMetadata = options.profileMetadata;
    this.#kernel = options.kernel;
    this.#profileImageStore = options.profileImageStore;
    this.#deliveryEvidenceCollector = options.deliveryEvidenceCollector;
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
        this.#writeError(response, error, request.url);
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
    if (
      route === "/v1/worker/profile/self/avatar" &&
      request.method === "PUT"
    ) {
      this.#authenticate(request);
      if (!this.#profileImageStore)
        throw new HttpRequestError(
          "profile_image_unavailable",
          "profile image storage is unavailable",
          503,
        );
      const mimeType = ProfileImageMimeTypeSchema.safeParse(
        request.headers["content-type"]?.split(";")[0]?.trim(),
      );
      if (!mimeType.success)
        throw new HttpRequestError(
          "profile_image_invalid",
          "unsupported profile image MIME type",
          400,
        );
      try {
        const result = await uploadWorkerSelfAvatar({
          profiles: this.#kernel.workerSelfProfile,
          execution: () => this.#authenticate(request).execution,
          store: this.#profileImageStore,
          mimeType: mimeType.data,
          chunks: request,
        });
        writeJson(response, 200, result);
      } catch (error) {
        throw mapProfileImageStorageError(error);
      }
      return;
    }

    const messageAttachmentMatch =
      route === undefined ? null : WORKER_MESSAGE_ATTACHMENT_ROUTE.exec(route);
    const artifactMatch =
      messageAttachmentMatch ??
      (route === undefined ? null : WORKER_ARTIFACT_ROUTE.exec(route));
    if (artifactMatch !== null) {
      if (request.method === "GET") {
        const grant = this.#authenticate(request);
        const download = await this.#kernel.files.downloadWorkerTaskArtifact(
          grant.execution,
          artifactMatch[1]!,
          messageAttachmentMatch !== null,
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
      const upload =
        messageAttachmentMatch === null
          ? await this.#kernel.files.uploadWorker(
              grant.execution,
              artifactMatch[1]!,
              request,
              () => {
                this.#authenticate(request);
              },
            )
          : await this.#kernel.files.uploadWorkerMessage(
              grant.execution,
              artifactMatch[1]!,
              request,
              () => {
                this.#authenticate(request);
              },
            );
      writeJson(
        response,
        200,
        (messageAttachmentMatch === null
          ? WorkerArtifactUploadSchema
          : WorkerMessageAttachmentUploadSchema
        ).parse(upload),
      );
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

    this.#authenticate(request);
    const body = await readJsonObject(
      request,
      route === "/v1/worker/tasks/amend"
        ? TASK_CARD_TRANSPORT_MAX_BYTES
        : MAX_BODY_BYTES,
    );
    const grant = this.#authenticate(request);
    if (route.startsWith("/v1/worker/tasks/"))
      this.#resolveTaskAddressing(route, body, grant);
    if (route === "/v1/worker/version") {
      const input = parseWorkerRequest(WorkerIntrospectionRequestSchema, body);
      this.#kernel.workerReads.whoami(grant.execution, input);
      const version = this.#serviceInfo?.();
      writeJson(
        response,
        200,
        WorkerLiveVersionResponseSchema.parse({
          source: "serving_daemon",
          buildVersion: version?.buildVersion ?? null,
          protocolVersion: version?.protocolVersion ?? null,
        }),
      );
      return;
    }
    const readResult = handleWorkerReadRequest(
      this.#kernel,
      grant.execution,
      route,
      body,
      parseWorkerRequest,
      this.#profileMetadata,
    );
    if (readResult !== undefined) {
      writeJson(response, 200, readResult);
      return;
    }
    if (route === "/v1/worker/profile/self/get") {
      const command = parseWorkerRequest(
        WorkerSelfProfileGetRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        WorkerSelfProfileResponseSchema.parse(
          this.#kernel.workerSelfProfile.get(grant.execution, command),
        ),
      );
      return;
    }
    if (route === "/v1/worker/profile/self/update") {
      const command = parseWorkerRequest(
        WorkerSelfProfileUpdateRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        WorkerSelfProfileUpdateResponseSchema.parse(
          this.#kernel.workerSelfProfile.update(grant.execution, command),
        ),
      );
      return;
    }
    if (route === "/v1/worker/attachments/prepare") {
      const command = parseWorkerRequest(
        WorkerMessageAttachmentPrepareRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        WorkerMessageAttachmentUploadSchema.parse(
          this.#kernel.files.prepareWorkerMessage(grant.execution, command),
        ),
      );
      return;
    }
    if (route === "/v1/worker/attachments/cancel") {
      const command = parseWorkerRequest(
        WorkerMessageAttachmentCancelRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        WorkerMessageAttachmentUploadSchema.parse(
          this.#kernel.files.cancelWorkerMessage(grant.execution, command),
        ),
      );
      return;
    }
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
    if (route === "/v1/worker/message-check") {
      const { replay } = parseWorkerRequest(
        WorkerMessageCheckRequestSchema,
        body,
      );
      const check =
        replay || grant.messageCheck === undefined
          ? (grant.messageCheck = { pending: new Set<number>() })
          : grant.messageCheck;
      const delivery = this.#kernel.syncWorker(grant.execution, {
        ...(check.cursor === undefined
          ? { replayDelivery: true }
          : { afterSeq: check.cursor }),
      });
      grant.deliveredCursors.add(delivery.cursorAfter);
      grant.knownRoomSeqs.add(delivery.cursorAfter);
      check.pending.add(delivery.cursorAfter);
      writeJson(
        response,
        200,
        WorkerMessageCheckResponseSchema.parse({
          delivery,
          throughSeq: grant.scope.toSeq,
        }),
      );
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

    if (route === "/v1/worker/tasks/trajectory") {
      const command = parseWorkerRequest(
        WorkerTaskTrajectoryRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        WorkerTaskTrajectoryResponseSchema.parse(
          this.#kernel.listWorkerTaskTrajectory(grant.execution, command),
        ),
      );
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

    if (route === "/v1/worker/messages/react") {
      const command = parseWorkerRequest(
        WorkerMessageReactionRequestSchema,
        body,
      );
      // Nothing is presented in the minimal form, so there is no claimed cursor
      // to fence; a presented one is fenced exactly as before.
      if (body.basedOnRoomSeq !== undefined)
        this.#requireKnownCausalCursor(grant, command.basedOnRoomSeq!);
      writeJson(
        response,
        200,
        MessageSocialItemSchema.parse(
          this.#kernel.messageSocial.reactWorker(grant.execution, command),
        ),
      );
      return;
    }
    if (route === "/v1/worker/messages/post") {
      const command = parseWorkerRequest(WorkerMessagePostRequestSchema, body);
      // An omitted cursor is derived by the Kernel from the Activation head
      // this credential already carries, so there is no presented number to
      // fence; a presented one is fenced exactly as before.
      if (command.channel === undefined && command.basedOnRoomSeq !== undefined)
        this.#requireKnownCausalCursor(grant, command.basedOnRoomSeq);
      const mutation = this.#kernel.postWorkerMessage(grant.execution, command);
      if ("event" in mutation && command.channel === undefined) {
        grant.knownRoomSeqs.add(mutation.event.roomSeq);
      }
      writeJson(response, 200, WorkerMessagePostResponseSchema.parse(mutation));
      return;
    }

    if (
      route === "/v1/worker/channels/mute" ||
      route === "/v1/worker/channels/unmute"
    ) {
      const command = parseWorkerRequest(
        WorkerChannelAttentionRequestSchema,
        body,
      );
      if (command.channel === undefined && command.basedOnRoomSeq !== undefined)
        this.#requireKnownCausalCursor(grant, command.basedOnRoomSeq);
      const result = this.#kernel.workerChannelAttention.set(
        grant.execution,
        command,
        route.endsWith("/mute"),
      );
      if (command.channel === undefined)
        grant.knownRoomSeqs.add(result.event.roomSeq);
      writeJson(
        response,
        200,
        WorkerChannelAttentionResponseSchema.parse(result),
      );
      return;
    }
    if (route === "/v1/worker/threads/unfollow") {
      const command = parseWorkerRequest(
        WorkerThreadUnfollowRequestSchema,
        body,
      );
      if (command.basedOnRoomSeq !== undefined)
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
        if (command.basedOnRoomSeq !== undefined)
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

    if (route === "/v1/worker/tasks/delete") {
      const presented = parseWorkerRequest(WorkerTaskDeleteRequestSchema, body);
      // Raft's `task delete` never names a Room: the Task is already addressed.
      // A `--target/--number` address resolved one above; a `--task-id` is
      // deleted in the Room this Activation is bound to, which is the only Room
      // the Kernel would have accepted anyway.
      const addressed = {
        ...presented,
        roomId: presented.roomId ?? grant.scope.roomId,
      };
      const command = this.#resolveTaskCommand(
        grant,
        addressed,
        { operation: "task-delete", subjectId: body.taskId as string },
        // Deletion fences inside the Kernel, after the replay check, so a
        // durable receipt still replays through a credential that never
        // delivered the original cursor.
        { fence: false },
      );
      const deleted = this.#kernel.taskDeletions.worker(
        grant.execution,
        command,
        () => {
          if (presented.basedOnRoomSeq !== undefined)
            this.#requireKnownCausalCursor(grant, presented.basedOnRoomSeq);
        },
      );
      grant.knownRoomSeqs.add(deleted.event.roomSeq);
      writeJson(response, 200, TaskDeleteResponseSchema.parse(deleted));
      return;
    }
    if (
      route === "/v1/worker/tasks/create-batch" ||
      route === "/v1/worker/tasks/claim-batch"
    ) {
      if (body.basedOnRoomSeq !== undefined)
        this.#requireKnownCausalCursor(grant, body.basedOnRoomSeq as number);
      try {
        const input = route.endsWith("create-batch")
          ? parseWorkerRequest(WorkerTaskBatchCreateRequestSchema, body)
          : parseWorkerRequest(WorkerTaskBatchClaimRequestSchema, body);
        const batch = this.#kernel.workerTaskManagement.batch(
          grant.execution,
          route.endsWith("create-batch") ? "create" : "claim",
          input,
          this.#taskClaimLeaseMs,
        );
        for (const mutation of batch.mutations) {
          grant.knownRoomSeqs.add(mutation.event.roomSeq);
          this.#synchronizeTaskHeartbeat(grant, mutation.task);
        }
        writeJson(response, 200, batch.response);
      } catch (error) {
        if (
          !(error instanceof StaleContextError) ||
          !route.endsWith("claim-batch")
        )
          throw error;
        writeJson(
          response,
          200,
          WorkerTaskHeldResponseSchema.parse(
            this.#kernel.workerReads.freshnessHold(grant.execution, {
              basedOnRoomSeq: error.basedOnRoomSeq ?? 0,
              seenUpToSeq: error.latestRoomSeq,
            }),
          ),
        );
      }
      return;
    }
    if (route.startsWith("/v1/worker/tasks/")) {
      // Raft holds a Task claim and amendment on stale context exactly as it
      // holds a send: the bounded newer context is a rendered result on stdout
      // and the command exits 0, with the mutation not applied and no draft
      // saved (`dist-UT7IQEHX.js@2818799`, `@2840513`). RAH raised a bare 409
      // instead, so an Agent that lost a race got a failure with nothing to
      // read and no path forward.
      //
      // Raft's third hold is its single status setter, whose `--status` takes
      // one of todo/in_progress/in_review/done/closed. `blocked` has no
      // same-name value there and assign/unassign/unclaim have no hold branch
      // upstream, which establishes the absence of a direct mapping and not
      // RAH's local concurrency semantics for them. The hold therefore stays on
      // the routes whose mapping the evidence fixes.
      let mutation;
      try {
        mutation = await this.#handleTaskCommand(route, body, grant, () => {
          this.#authenticate(request);
        });
      } catch (error) {
        if (
          !(error instanceof StaleContextError) ||
          !TASK_FRESHNESS_HOLD_ROUTES.has(route)
        )
          throw error;
        writeJson(
          response,
          200,
          WorkerTaskHeldResponseSchema.parse(
            this.#kernel.workerReads.freshnessHold(grant.execution, {
              basedOnRoomSeq: error.basedOnRoomSeq ?? 0,
              seenUpToSeq: error.latestRoomSeq,
            }),
          ),
        );
        return;
      }
      grant.knownRoomSeqs.add(mutation.event.roomSeq);
      if (route !== "/v1/worker/tasks/amend")
        this.#synchronizeTaskHeartbeat(grant, mutation.task);
      writeJson(
        response,
        200,
        route === "/v1/worker/tasks/request-input"
          ? WorkerTaskRequestInputResponseSchema.parse(mutation)
          : route === "/v1/worker/tasks/review"
            ? WorkerTaskReviewResponseSchema.parse(mutation)
            : route === "/v1/worker/tasks/unblock" ||
                route === "/v1/worker/tasks/block" ||
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
    if (grant.messageCheck?.pending.has(throughSeq)) {
      grant.messageCheck.cursor = throughSeq;
      grant.messageCheck.pending.clear();
    }
    writeJson(
      response,
      200,
      WorkerAcknowledgeResponseSchema.parse({
        acknowledgedThrough: throughSeq,
      }),
    );
  }

  /**
   * Raft addresses a Task as `--target "#channel" --number N`. The pair is
   * resolved to the canonical Task id here, before any command schema sees the
   * body, so every Task command keeps one addressing shape downstream and every
   * existing authority check — Activation delivery for a mutation, Room
   * visibility for a read — is applied to the resolved id unchanged. A number
   * in a Room this credential cannot act in therefore fails in the same place,
   * and with the same error, as the equivalent `--task-id` does today.
   */
  #resolveTaskAddressing(
    route: string,
    body: Record<string, unknown>,
    grant: WorkerGrant,
  ): void {
    if (TASK_ROUTES_WITH_OWN_CHANNEL.has(route)) return;
    if (body.channel === undefined && body.taskNumber === undefined) return;
    if (TASK_ROUTES_WITHOUT_A_TASK.has(route))
      throw new HttpRequestError(
        "unexpected_field",
        "field channel is not accepted",
        400,
      );
    if (body.taskId !== undefined)
      throw new HttpRequestError(
        "invalid_field",
        "taskId: a Task is addressed by taskId or by channel with taskNumber, not both",
        400,
      );
    const address = parseWorkerRequest(WorkerTaskAddressSchema, {
      ...(body.channel === undefined ? {} : { channel: body.channel }),
      ...(body.taskNumber === undefined ? {} : { taskNumber: body.taskNumber }),
    });
    const resolved = this.#kernel.resolveWorkerTaskAddress(
      grant.execution,
      address,
    );
    delete body.channel;
    delete body.taskNumber;
    body.taskId = resolved.taskId;
    // `tasks/delete` is RAH's one Task command that also names its Room; the
    // address already carries it.
    if (route === "/v1/worker/tasks/delete" && body.roomId === undefined)
      body.roomId = resolved.roomId;
  }

  /**
   * Raft's Task commands carry neither a causal cursor nor an idempotency key,
   * so the minimal form is the normal form here: whatever the Agent omitted is
   * resolved from Kernel-owned state, mirroring `/v1/worker/messages/post`.
   * A cursor that WAS presented is still fenced against this credential's
   * delivered and produced sequences before anything else happens.
   */
  #resolveTaskCommand<
    T extends {
      basedOnRoomSeq?: number | undefined;
      idempotencyKey?: string | undefined;
    },
  >(
    grant: WorkerGrant,
    command: T,
    identity: {
      operation: string;
      subjectId?: string | undefined;
      content?: readonly (string | null)[] | undefined;
    },
    options: { fence?: boolean } = {},
  ): T & { basedOnRoomSeq: number; idempotencyKey: string } {
    if (options.fence !== false && command.basedOnRoomSeq !== undefined)
      this.#requireKnownCausalCursor(grant, command.basedOnRoomSeq);
    return {
      ...command,
      ...this.#kernel.resolveWorkerTaskCommandCausality(grant.execution, {
        ...identity,
        ...(command.basedOnRoomSeq === undefined
          ? {}
          : { basedOnRoomSeq: command.basedOnRoomSeq }),
        ...(command.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: command.idempotencyKey }),
      }),
    };
  }

  async #handleTaskCommand(
    route: string,
    body: Record<string, unknown>,
    grant: WorkerGrant,
    assertAuthorized: () => void,
  ) {
    if (route === "/v1/worker/tasks/update-status") {
      const presented = parseWorkerRequest(WorkerTaskUpdateRequestSchema, body);
      if (presented.basedOnRoomSeq !== undefined)
        this.#requireKnownCausalCursor(grant, presented.basedOnRoomSeq);
      const command = this.#kernel.workerTaskManagement.resolveStatus(
        grant.execution,
        presented,
      );
      if (command.status === "in_review") {
        const summary = this.#kernel.workerTaskManagement.statusSummary(
          grant.execution,
          command,
        );
        return this.#handleTaskSubmission(
          {
            taskId: command.taskId,
            basedOnRoomSeq: command.basedOnRoomSeq,
            idempotencyKey: command.idempotencyKey,
            summary,
          },
          grant,
          assertAuthorized,
        );
      }
      return this.#kernel.workerTaskManagement.status(
        grant.execution,
        command,
        this.#taskClaimLeaseMs,
      );
    }
    if (route === "/v1/worker/tasks/amend") {
      const command = this.#resolveTaskCommand(
        grant,
        parseWorkerRequest(WorkerTaskAmendRequestSchema, body),
        {
          operation: "task-amend",
          subjectId: body.taskId as string,
          content: [
            (body.title as string | undefined) ?? null,
            (body.description as string | null | undefined) ?? null,
          ],
        },
      );
      return this.#kernel.taskAmendments.worker(grant.execution, command);
    }
    if (route === "/v1/worker/tasks/unblock") {
      const command = this.#resolveTaskCommand(
        grant,
        parseWorkerRequest(WorkerTaskUnblockRequestSchema, body),
        { operation: "task-unblock", subjectId: body.taskId as string },
      );
      return this.#kernel.workerTaskManagement.unblock(
        grant.execution,
        command,
      );
    }
    if (route === "/v1/worker/tasks/assign") {
      const command = this.#resolveTaskCommand(
        grant,
        parseWorkerRequest(WorkerTaskAssignRequestSchema, body),
        {
          operation: "task-assign",
          subjectId: body.taskId as string,
          content: [(body.assigneeId as string | null | undefined) ?? null],
        },
      );
      const { activationIds: _activationIds, ...mutation } =
        this.#kernel.workerTaskManagement.assign(grant.execution, command);
      return mutation;
    }
    if (route === "/v1/worker/tasks/convert") {
      const command = this.#resolveTaskCommand(
        grant,
        parseWorkerRequest(WorkerTaskConvertRequestSchema, body),
        { operation: "task-convert", subjectId: body.messageId as string },
      );
      const { activationIds: _activationIds, ...mutation } =
        this.#kernel.workerTaskManagement.convert(grant.execution, command);
      return mutation;
    }
    if (route === "/v1/worker/tasks/claim-message") {
      const command = this.#resolveTaskCommand(
        grant,
        parseWorkerRequest(WorkerTaskClaimMessageRequestSchema, body),
        {
          operation: "task-claim-message",
          subjectId: body.messageId as string,
          content: [(body.rationale as string | undefined) ?? null],
        },
      );
      return this.#kernel.claimMessageAsTask(grant.execution, {
        ...command,
        leaseMs: this.#taskClaimLeaseMs,
      });
    }
    if (route === "/v1/worker/tasks/create") {
      const command = this.#resolveTaskCommand(
        grant,
        parseWorkerRequest(WorkerTaskCreateRequestSchema, body),
        {
          operation: "task-create",
          content: [
            (body.title as string | undefined) ?? null,
            (body.assigneeId as string | undefined) ?? null,
          ],
        },
      );
      const { assigneeId, ...rest } = command;
      return this.#kernel.createWorkerTask(grant.execution, {
        ...rest,
        ...(assigneeId === undefined ? {} : { assigneeId }),
        leaseMs: this.#taskClaimLeaseMs,
      });
    }
    if (route === "/v1/worker/tasks/claim") {
      const command = this.#resolveTaskCommand(
        grant,
        parseWorkerRequest(WorkerTaskClaimRequestSchema, body),
        { operation: "task-claim", subjectId: body.taskId as string },
      );
      return this.#kernel.claimTask(grant.execution, {
        ...command,
        leaseMs: this.#taskClaimLeaseMs,
      });
    }
    if (route === "/v1/worker/tasks/start") {
      const command = this.#resolveTaskCommand(
        grant,
        parseWorkerRequest(WorkerTaskStartRequestSchema, body),
        { operation: "task-start", subjectId: body.taskId as string },
      );
      return this.#kernel.startTask(grant.execution, {
        ...command,
        leaseMs: this.#taskClaimLeaseMs,
      });
    }
    if (route === "/v1/worker/tasks/progress") {
      const command = this.#resolveTaskCommand(
        grant,
        parseWorkerRequest(WorkerTaskProgressRequestSchema, body),
        {
          operation: "task-progress",
          subjectId: body.taskId as string,
          content: [(body.progress as string | undefined) ?? null],
        },
      );
      return this.#kernel.progressTask(grant.execution, {
        ...command,
        leaseMs: this.#taskClaimLeaseMs,
      });
    }
    if (route === "/v1/worker/tasks/release") {
      const command = this.#resolveTaskCommand(
        grant,
        parseWorkerRequest(WorkerTaskReleaseRequestSchema, body),
        { operation: "task-release", subjectId: body.taskId as string },
      );
      return this.#kernel.releaseTask(grant.execution, command);
    }
    if (route === "/v1/worker/tasks/block") {
      const command = this.#resolveTaskCommand(
        grant,
        parseWorkerRequest(WorkerTaskBlockRequestSchema, body),
        {
          operation: "task-block",
          subjectId: body.taskId as string,
          content: [(body.reason as string | undefined) ?? null],
        },
      );
      return this.#kernel.blockTask(grant.execution, command);
    }
    if (route === "/v1/worker/tasks/request-input") {
      const command = this.#resolveTaskCommand(
        grant,
        parseWorkerRequest(WorkerTaskRequestInputRequestSchema, body),
        {
          operation: "task-request-input",
          subjectId: body.taskId as string,
          content: [(body.question as string | undefined) ?? null],
        },
      );
      return this.#kernel.requestTaskInput(grant.execution, command);
    }
    if (route === "/v1/worker/tasks/review") {
      const command = this.#resolveTaskCommand(
        grant,
        parseWorkerRequest(WorkerTaskReviewRequestSchema, body),
        {
          operation: "task-review",
          subjectId: body.taskId as string,
          content: [
            (body.disposition as string | undefined) ?? null,
            (body.summary as string | undefined) ?? null,
          ],
        },
      );
      return this.#kernel.taskReviews.reviewTask(grant.execution, command);
    }
    return this.#handleTaskSubmission(body, grant, assertAuthorized);
  }

  async #handleTaskSubmission(
    body: Record<string, unknown>,
    grant: WorkerGrant,
    assertAuthorized: () => void,
  ) {
    const command = this.#resolveTaskCommand(
      grant,
      parseWorkerRequest(WorkerTaskSubmitRequestSchema, body),
      {
        operation: "task-submit",
        subjectId: body.taskId as string,
        content: [
          (body.summary as string | undefined) ?? null,
          body.verification === undefined
            ? null
            : JSON.stringify(body.verification),
        ],
      },
    );
    const replay = this.#kernel.replayTaskSubmission(grant.execution, {
      idempotencyKey: command.idempotencyKey,
      summary: command.summary,
      taskId: command.taskId,
      ...(command.verification === undefined
        ? {}
        : { verification: command.verification }),
    });
    if (replay !== null) return replay;
    const deliveryRepository = await this.#captureTaskDeliveryEvidence(
      grant,
      command.taskId,
      command.idempotencyKey,
      assertAuthorized,
    );
    assertAuthorized();
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
    assertAuthorized: () => void,
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
    assertAuthorized();
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
          assertAuthorized,
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

  #writeError(
    response: ServerResponse,
    error: unknown,
    route?: string | undefined,
  ): void {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    if (
      error instanceof HttpRequestError ||
      error instanceof ProfileImageRequestError
    ) {
      writeJson(
        response,
        error.status,
        WorkerErrorResponseSchema.parse({
          error: {
            code: error.code,
            message: error.message,
            ...suggestedNextActionFor(route, error.code),
          },
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
          error: {
            code: error.code,
            message: error.message,
            ...suggestedNextActionFor(route, error.code),
          },
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
  maxBytes = MAX_BODY_BYTES,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maxBytes) {
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
