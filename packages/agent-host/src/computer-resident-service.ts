import type { HostExecutionWorkspaceBinding } from "@rah-os/protocol";
import { randomUUID } from "node:crypto";

import {
  COMPUTER_CONTROL_API_VERSION,
  ComputerExecutionCommandRequestSchema,
  ComputerExecutionCommandResponseSchema,
  ComputerHeartbeatRequestSchema,
  ComputerHeartbeatResponseSchema,
  ComputerOperationAcknowledgeRequestSchema,
  ComputerOperationAcknowledgeResponseSchema,
  ComputerOperationClaimRequestSchema,
  ComputerOperationClaimResponseSchema,
  ComputerPlacementClaimRequestSchema,
  ComputerPlacementClaimResponseSchema,
  ComputerRuntimeOfferPublishRequestSchema,
  ComputerRuntimeOfferPublishResponseSchema,
  ComputerSessionOpenRequestSchema,
  ComputerSessionOpenResponseSchema,
  ComputerWorkerCredentialIssueRequestSchema,
  ComputerWorkerCredentialIssueResponseSchema,
  ComputerWorkerCredentialRevokeRequestSchema,
  ComputerWorkerCredentialRevokeResponseSchema,
  type ComputerHeartbeatRequest,
  type ComputerHeartbeatResponse,
  type ComputerExecutionCommandRequest,
  type ComputerExecutionCommandResponse,
  type ComputerOperationAcknowledgeRequest,
  type ComputerOperationAcknowledgeResponse,
  type ComputerOperationClaimRequest,
  type ComputerOperationClaimResponse,
  type ComputerPlacementClaimRequest,
  type ComputerPlacementClaimResponse,
  type ComputerRuntimeOfferPublishRequest,
  type ComputerRuntimeOfferPublishResponse,
  type ComputerSessionOpenRequest,
  type ComputerSessionOpenResponse,
  type ComputerWorkerCredentialIssueRequest,
  type ComputerWorkerCredentialIssueResponse,
  type ComputerWorkerCredentialRevokeRequest,
  type ComputerWorkerCredentialRevokeResponse,
} from "@rah-os/computer-protocol";
import { RuntimeOfferSchema, type RuntimeOffer } from "@rah-os/protocol";

export type ComputerControlClientErrorKind =
  "conflict" | "protocol" | "unauthenticated" | "unavailable";

/**
 * A transport-neutral control-plane failure. The port implementation owns the
 * mapping from HTTP, WebSocket, or an in-process fixture into this small set.
 */
export class ComputerControlClientError extends Error {
  readonly kind: ComputerControlClientErrorKind;

  constructor(kind: ComputerControlClientErrorKind, message: string) {
    super(message);
    this.name = "ComputerControlClientError";
    this.kind = kind;
  }
}

export type ComputerControlClientPort = {
  acknowledgeOperation(
    sessionAccessToken: string,
    request: ComputerOperationAcknowledgeRequest,
  ): Promise<ComputerOperationAcknowledgeResponse>;
  commandExecution(
    sessionAccessToken: string,
    request: ComputerExecutionCommandRequest,
  ): Promise<ComputerExecutionCommandResponse>;
  claimPlacement(
    sessionAccessToken: string,
    request: ComputerPlacementClaimRequest,
  ): Promise<ComputerPlacementClaimResponse>;
  claimOperation(
    sessionAccessToken: string,
    request: ComputerOperationClaimRequest,
  ): Promise<ComputerOperationClaimResponse>;
  heartbeat(
    sessionAccessToken: string,
    request: ComputerHeartbeatRequest,
  ): Promise<ComputerHeartbeatResponse>;
  openSession(
    request: ComputerSessionOpenRequest,
  ): Promise<ComputerSessionOpenResponse>;
  publishRuntimeOffer(
    sessionAccessToken: string,
    request: ComputerRuntimeOfferPublishRequest,
  ): Promise<ComputerRuntimeOfferPublishResponse>;
  issueWorkerCredential(
    sessionAccessToken: string,
    request: ComputerWorkerCredentialIssueRequest,
  ): Promise<ComputerWorkerCredentialIssueResponse>;
  revokeWorkerCredential(
    sessionAccessToken: string,
    request: ComputerWorkerCredentialRevokeRequest,
  ): Promise<ComputerWorkerCredentialRevokeResponse>;
};

export type ComputerResidentServiceState =
  "connected" | "connecting" | "degraded" | "disconnected" | "stopped";

export type ComputerResidentServiceSnapshot = {
  consecutiveFailures: number;
  hostId?: string;
  hostInstanceId?: string;
  lastError?: string;
  participantIds?: readonly string[];
  state: ComputerResidentServiceState;
};

export type ComputerResidentServiceTerminalReason =
  "attachment_revoked" | "configuration";

export class ComputerResidentServiceTerminalError extends Error {
  readonly reason: ComputerResidentServiceTerminalReason;

  constructor(reason: ComputerResidentServiceTerminalReason, message: string) {
    super(message);
    this.name = "ComputerResidentServiceTerminalError";
    this.reason = reason;
  }
}

export type ComputerResidentIdentity = {
  hostId: string;
  hostInstanceId: string;
};

export type ComputerResidentServiceOptions = {
  buildVersion: string;
  client: ComputerControlClientPort;
  computerInstanceId?: string;
  connectionId: string;
  onConnected?: (
    snapshot: Readonly<ComputerResidentServiceSnapshot>,
  ) => void | Promise<void>;
  processId?: number;
  reconcileIntervalMs?: number;
  runtimeOffers(
    identity: Readonly<ComputerResidentIdentity>,
    executionWorkspaceBindings?: readonly HostExecutionWorkspaceBinding[],
  ): Promise<readonly RuntimeOffer[]>;
  runtimeProtocolVersion: number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
};

type Session = ComputerSessionOpenResponse;

/**
 * Owns the local Computer's authenticated control session and Offer
 * reconciliation. It deliberately knows nothing about Room, Placement truth,
 * or an application-service implementation; those stay behind the port.
 */
export class ComputerResidentService {
  readonly #buildVersion: string;
  readonly #client: ComputerControlClientPort;
  readonly #computerInstanceId: string;
  readonly #connectionId: string;
  readonly #onConnected:
    ComputerResidentServiceOptions["onConnected"] | undefined;
  readonly #processId: number;
  readonly #reconcileIntervalMs: number;
  readonly #runtimeOffers: ComputerResidentServiceOptions["runtimeOffers"];
  readonly #runtimeProtocolVersion: number;
  readonly #wait: (delayMs: number, signal: AbortSignal) => Promise<void>;
  #reconcilePromise: Promise<ComputerResidentServiceSnapshot> | undefined;
  #running = false;
  #session: Session | undefined;
  #snapshot: ComputerResidentServiceSnapshot = {
    consecutiveFailures: 0,
    state: "disconnected",
  };
  #stopped = false;
  readonly #stopController = new AbortController();

  constructor(options: ComputerResidentServiceOptions) {
    const request = ComputerSessionOpenRequestSchema.parse({
      capabilities: [
        "managed_operations",
        "placement_pull",
        "runtime_offer_publish",
        "runtime_activity_publish",
        "terminal_proof",
        "worker_credential_issue",
      ],
      computerBuildVersion: options.buildVersion,
      computerInstanceId: options.computerInstanceId ?? randomUUID(),
      connectionId: options.connectionId,
      controlApiVersions: [COMPUTER_CONTROL_API_VERSION],
      processId: options.processId ?? process.pid,
      runtimeProtocolVersion: options.runtimeProtocolVersion,
    });
    this.#buildVersion = request.computerBuildVersion;
    this.#client = options.client;
    this.#computerInstanceId = request.computerInstanceId;
    this.#connectionId = request.connectionId;
    this.#onConnected = options.onConnected;
    this.#processId = request.processId;
    this.#reconcileIntervalMs = positiveInteger(
      options.reconcileIntervalMs ?? 5_000,
      "reconcileIntervalMs",
    );
    this.#runtimeOffers = options.runtimeOffers;
    this.#runtimeProtocolVersion = request.runtimeProtocolVersion;
    this.#wait = options.wait ?? waitForDelay;
  }

  snapshot(): ComputerResidentServiceSnapshot {
    return {
      ...this.#snapshot,
      ...(this.#snapshot.participantIds === undefined
        ? {}
        : { participantIds: [...this.#snapshot.participantIds] }),
    };
  }

  async claimPlacement(
    untrustedRequest: ComputerPlacementClaimRequest,
  ): Promise<ComputerPlacementClaimResponse> {
    const request = ComputerPlacementClaimRequestSchema.parse(untrustedRequest);
    return ComputerPlacementClaimResponseSchema.parse(
      await this.#withSession((session) =>
        this.#client.claimPlacement(session.sessionAccessToken, request),
      ),
    );
  }

  async claimOperation(
    untrustedRequest: ComputerOperationClaimRequest,
  ): Promise<ComputerOperationClaimResponse> {
    const request = ComputerOperationClaimRequestSchema.parse(untrustedRequest);
    return ComputerOperationClaimResponseSchema.parse(
      await this.#withSession((session) =>
        this.#client.claimOperation(session.sessionAccessToken, request),
      ),
    );
  }

  async acknowledgeOperation(
    untrustedRequest: ComputerOperationAcknowledgeRequest,
  ): Promise<ComputerOperationAcknowledgeResponse> {
    const request =
      ComputerOperationAcknowledgeRequestSchema.parse(untrustedRequest);
    return ComputerOperationAcknowledgeResponseSchema.parse(
      await this.#withSession((session) =>
        this.#client.acknowledgeOperation(session.sessionAccessToken, request),
      ),
    );
  }

  async commandExecution(
    untrustedRequest: ComputerExecutionCommandRequest,
  ): Promise<ComputerExecutionCommandResponse> {
    const request =
      ComputerExecutionCommandRequestSchema.parse(untrustedRequest);
    return ComputerExecutionCommandResponseSchema.parse(
      await this.#withSession((session) =>
        this.#client.commandExecution(session.sessionAccessToken, request),
      ),
    );
  }

  async heartbeatNow(
    untrustedRequest: ComputerHeartbeatRequest,
  ): Promise<ComputerHeartbeatResponse> {
    const request = ComputerHeartbeatRequestSchema.parse(untrustedRequest);
    const response = ComputerHeartbeatResponseSchema.parse(
      await this.#withSession((session) =>
        this.#client.heartbeat(session.sessionAccessToken, request),
      ),
    );
    this.#snapshot = {
      consecutiveFailures: 0,
      hostId: response.host.hostId,
      hostInstanceId: response.host.instanceId,
      participantIds: [...response.host.participantIds],
      state: request.state === "offline" ? "disconnected" : "connected",
    };
    if (request.state === "offline") this.#session = undefined;
    return response;
  }

  async issueWorkerCredential(
    untrustedRequest: ComputerWorkerCredentialIssueRequest,
  ): Promise<ComputerWorkerCredentialIssueResponse> {
    const request =
      ComputerWorkerCredentialIssueRequestSchema.parse(untrustedRequest);
    return ComputerWorkerCredentialIssueResponseSchema.parse(
      await this.#withSession((session) =>
        this.#client.issueWorkerCredential(session.sessionAccessToken, request),
      ),
    );
  }

  async revokeWorkerCredential(
    untrustedRequest: ComputerWorkerCredentialRevokeRequest,
  ): Promise<ComputerWorkerCredentialRevokeResponse> {
    const request =
      ComputerWorkerCredentialRevokeRequestSchema.parse(untrustedRequest);
    return ComputerWorkerCredentialRevokeResponseSchema.parse(
      await this.#withSession((session) =>
        this.#client.revokeWorkerCredential(
          session.sessionAccessToken,
          request,
        ),
      ),
    );
  }

  reconcileOnce(): Promise<ComputerResidentServiceSnapshot> {
    if (this.#stopped) return Promise.resolve(this.snapshot());
    if (this.#reconcilePromise !== undefined) return this.#reconcilePromise;
    const operation = this.#reconcile();
    this.#reconcilePromise = operation;
    const clear = () => {
      if (this.#reconcilePromise === operation)
        this.#reconcilePromise = undefined;
    };
    void operation.then(clear, clear);
    return operation;
  }

  async run(input: { signal: AbortSignal }): Promise<void> {
    if (this.#running) {
      throw new Error("ComputerResidentService is already running");
    }
    if (this.#stopped) {
      throw new Error("ComputerResidentService has already stopped");
    }
    this.#running = true;
    const signal = AbortSignal.any([input.signal, this.#stopController.signal]);
    try {
      while (!signal.aborted && !this.#stopped) {
        await this.reconcileOnce();
        if (signal.aborted || this.#stopped) break;
        await this.#wait(this.#reconcileIntervalMs, signal);
      }
    } finally {
      this.#running = false;
      if (input.signal.aborted && !this.#stopped) await this.stop();
    }
  }

  async stop(): Promise<ComputerResidentServiceSnapshot> {
    this.#stopped = true;
    this.#stopController.abort("Computer resident service stopped");
    const inFlight = this.#reconcilePromise;
    if (inFlight !== undefined) {
      try {
        await inFlight;
      } catch {
        // The terminal outcome is superseded by an explicit local stop.
      }
    }
    await this.#reportOffline();
    this.#snapshot = {
      consecutiveFailures: this.#snapshot.consecutiveFailures,
      state: "stopped",
    };
    return this.snapshot();
  }

  async #reconcile(): Promise<ComputerResidentServiceSnapshot> {
    const previousState = this.#snapshot.state;
    this.#snapshot = {
      ...this.#snapshot,
      state: "connecting",
    };
    try {
      const session = this.#session ?? (await this.#openSession());
      const heartbeat = await this.#publishOnlineState(session);
      this.#snapshot = {
        consecutiveFailures: 0,
        hostId: session.hostId,
        hostInstanceId: session.hostInstanceId,
        participantIds: [...heartbeat.host.participantIds],
        state: "connected",
      };
      if (previousState !== "connected") {
        await this.#onConnected?.(this.snapshot());
      }
      return this.snapshot();
    } catch (error) {
      try {
        return this.#handleFailure(error);
      } catch (terminalError) {
        if (terminalError instanceof ComputerResidentServiceTerminalError) {
          await this.#reportOffline();
        }
        throw terminalError;
      }
    }
  }

  async #reportOffline(): Promise<void> {
    const session = this.#session;
    this.#session = undefined;
    if (session === undefined) return;
    try {
      const request = ComputerHeartbeatRequestSchema.parse({
        buildVersion: this.#buildVersion,
        processId: this.#processId,
        protocolVersion: this.#runtimeProtocolVersion,
        state: "offline",
      });
      ComputerHeartbeatResponseSchema.parse(
        await this.#client.heartbeat(session.sessionAccessToken, request),
      );
    } catch {
      // Session TTL and generation fencing remain the failure backstop.
    }
  }

  async #openSession(): Promise<Session> {
    const request = ComputerSessionOpenRequestSchema.parse({
      capabilities: [
        "managed_operations",
        "placement_pull",
        "runtime_offer_publish",
        "runtime_activity_publish",
        "terminal_proof",
        "worker_credential_issue",
      ],
      computerBuildVersion: this.#buildVersion,
      computerInstanceId: this.#computerInstanceId,
      connectionId: this.#connectionId,
      controlApiVersions: [COMPUTER_CONTROL_API_VERSION],
      processId: this.#processId,
      runtimeProtocolVersion: this.#runtimeProtocolVersion,
    });
    const response = ComputerSessionOpenResponseSchema.parse(
      await this.#client.openSession(request),
    );
    this.#session = response;
    return response;
  }

  async #publishOnlineState(
    session: Session,
  ): Promise<ComputerHeartbeatResponse> {
    const heartbeatRequest = ComputerHeartbeatRequestSchema.parse({
      buildVersion: this.#buildVersion,
      processId: this.#processId,
      protocolVersion: this.#runtimeProtocolVersion,
      state: "online",
    });
    const heartbeat = ComputerHeartbeatResponseSchema.parse(
      await this.#client.heartbeat(
        session.sessionAccessToken,
        heartbeatRequest,
      ),
    );
    if (
      heartbeat.host.hostId !== session.hostId ||
      heartbeat.host.instanceId !== session.hostInstanceId
    ) {
      throw new ComputerControlClientError(
        "protocol",
        "heartbeat identity does not match the opened Computer session",
      );
    }

    const bindings = heartbeat.executionWorkspaceBindings;
    if (
      bindings?.some(
        (binding) =>
          !heartbeat.host.participantIds.includes(binding.participantId),
      )
    )
      throw new ComputerControlClientError(
        "protocol",
        "Execution binding exceeds authorized Host participant scope",
      );
    const offers = await this.#runtimeOffers(
      {
        hostId: session.hostId,
        hostInstanceId: session.hostInstanceId,
      },
      bindings,
    );
    for (const untrustedOffer of offers) {
      const offer = RuntimeOfferSchema.parse(untrustedOffer);
      if (
        offer.hostId !== session.hostId ||
        offer.hostInstanceId !== session.hostInstanceId
      ) {
        throw new ComputerControlClientError(
          "protocol",
          "RuntimeOffer identity does not match the opened Computer session",
        );
      }
      const request = ComputerRuntimeOfferPublishRequestSchema.parse({ offer });
      const response = ComputerRuntimeOfferPublishResponseSchema.parse(
        await this.#client.publishRuntimeOffer(
          session.sessionAccessToken,
          request,
        ),
      );
      if (
        response.offer.runtimeOfferId !== offer.runtimeOfferId ||
        response.offer.hostId !== session.hostId ||
        response.offer.hostInstanceId !== session.hostInstanceId
      ) {
        throw new ComputerControlClientError(
          "protocol",
          "published RuntimeOffer projection does not match the request",
        );
      }
    }
    return heartbeat;
  }

  async #withSession<Response>(
    operation: (session: Session) => Promise<Response>,
  ): Promise<Response> {
    let session = await this.#requireCommandSession();
    try {
      return await operation(session);
    } catch (error) {
      if (
        !(error instanceof ComputerControlClientError) ||
        error.kind !== "unauthenticated"
      ) {
        throw error;
      }
      this.#session = undefined;
      session = await this.#requireCommandSession();
      return await operation(session);
    }
  }

  async #requireCommandSession(): Promise<Session> {
    if (this.#stopped) {
      throw new ComputerControlClientError(
        "unavailable",
        "Computer resident service is stopped",
      );
    }
    if (this.#session === undefined) await this.reconcileOnce();
    if (this.#session === undefined) {
      throw new ComputerControlClientError(
        "unavailable",
        "Computer resident service has no authenticated session",
      );
    }
    return this.#session;
  }

  #handleFailure(error: unknown): ComputerResidentServiceSnapshot {
    const hadSession = this.#session !== undefined;
    if (
      error instanceof ComputerControlClientError &&
      error.kind === "unauthenticated"
    ) {
      this.#session = undefined;
      if (!hadSession) {
        throw this.#terminal(
          "attachment_revoked",
          "Computer attachment was revoked",
        );
      }
      return this.#retryable("Computer control session expired");
    }
    if (
      error instanceof ComputerControlClientError &&
      (error.kind === "unavailable" || error.kind === "conflict")
    ) {
      return this.#retryable(redactError(error.message, this.#session));
    }
    const message =
      error instanceof Error ? error.message : "invalid Computer configuration";
    throw this.#terminal("configuration", redactError(message, this.#session));
  }

  #retryable(message: string): ComputerResidentServiceSnapshot {
    this.#snapshot = {
      consecutiveFailures: this.#snapshot.consecutiveFailures + 1,
      lastError: message,
      state: "disconnected",
    };
    return this.snapshot();
  }

  #terminal(
    reason: ComputerResidentServiceTerminalReason,
    message: string,
  ): ComputerResidentServiceTerminalError {
    this.#snapshot = {
      consecutiveFailures: this.#snapshot.consecutiveFailures + 1,
      lastError: message,
      state: "degraded",
    };
    return new ComputerResidentServiceTerminalError(reason, message);
  }
}

function redactError(message: string, session: Session | undefined): string {
  if (session === undefined) return message;
  return message.replaceAll(session.sessionAccessToken, "[redacted]");
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

async function waitForDelay(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
  });
}
