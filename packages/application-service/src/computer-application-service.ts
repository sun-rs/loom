import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  ComputerHeartbeatRequestSchema,
  ComputerHeartbeatResponseSchema,
  ComputerExecutionCommandRequestSchema,
  ComputerExecutionCommandResponseSchema,
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
  type ComputerControlCapability,
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
import {
  ForbiddenError,
  UnauthenticatedError,
  type AuthenticatedHostContext,
  type ComputerApplicationPort,
} from "@rah-os/kernel";
import type { ActivationCredentialScope } from "@rah-os/protocol";

const DEFAULT_SESSION_TTL_MS = 60_000;
const DEFAULT_TAKEOVER_AFTER_MS = 30_000;
const MAX_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;

export type ComputerApplicationServiceOptions = {
  computer: ComputerApplicationPort;
  createSessionAccessToken?: () => string;
  now?: () => Date;
  sessionTtlMs?: number;
  takeoverAfterMs?: number;
  workerCredentials?: ComputerWorkerCredentialIssuerPort;
};

export type ComputerWorkerCredentialIssuerPort = {
  readonly origin: string;
  issueActivationCredential(
    host: AuthenticatedHostContext,
    scope: ActivationCredentialScope,
  ): {
    accessToken: string;
    expiresAt: string;
    revoke(): void;
  };
};

type ComputerSession = {
  accessToken: string;
  accessTokenHash: string;
  capabilities: ReadonlySet<ComputerControlCapability>;
  connectionKey: string;
  computerInstanceId: string;
  expiresAtMs: number;
  host: AuthenticatedHostContext;
  openResponse: ComputerSessionOpenResponse;
};

type ComputerConnection = {
  computerInstanceId: string;
  host: AuthenticatedHostContext;
};

type ComputerWorkerGrant = {
  expiresAtMs: number;
  hostCredentialId: string;
  hostId: string;
  hostInstanceId: string;
  revoke(): void;
  revoked: boolean;
};

function positiveInteger(
  value: number,
  name: string,
  maximum?: number,
): number {
  if (
    !Number.isInteger(value) ||
    value <= 0 ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new Error(
      maximum === undefined
        ? `${name} must be a positive integer`
        : `${name} must be a positive integer at most ${String(maximum)}`,
    );
  }
  return value;
}

function tokenHash(accessToken: string): string {
  return createHash("sha256").update(accessToken, "utf8").digest("hex");
}

export class ComputerApplicationService {
  readonly #computer: ComputerApplicationPort;
  readonly #connectionIndex = new Map<string, string>();
  readonly #connections = new Map<string, ComputerConnection>();
  readonly #createSessionAccessToken: () => string;
  readonly #now: () => Date;
  readonly #sessionTtlMs: number;
  readonly #sessionsByTokenHash = new Map<string, ComputerSession>();
  readonly #takeoverAfterMs: number;
  readonly #workerCredentials: ComputerWorkerCredentialIssuerPort | undefined;
  readonly #workerGrants = new Map<string, ComputerWorkerGrant>();

  constructor(options: ComputerApplicationServiceOptions) {
    this.#computer = options.computer;
    this.#now = options.now ?? (() => new Date());
    this.#sessionTtlMs = positiveInteger(
      options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
      "sessionTtlMs",
      MAX_SESSION_TTL_MS,
    );
    this.#takeoverAfterMs = positiveInteger(
      options.takeoverAfterMs ?? DEFAULT_TAKEOVER_AFTER_MS,
      "takeoverAfterMs",
    );
    this.#createSessionAccessToken =
      options.createSessionAccessToken ??
      (() => `rah_host_session_${randomBytes(32).toString("base64url")}`);
    this.#workerCredentials = options.workerCredentials;
  }

  openSession(
    hostAccessToken: string,
    untrustedRequest: ComputerSessionOpenRequest,
  ): ComputerSessionOpenResponse {
    const request = ComputerSessionOpenRequestSchema.parse(untrustedRequest);
    this.#removeExpiredSessions();
    const authenticatedHost =
      this.#computer.authenticateHostAccessToken(hostAccessToken);
    const connectionKey = `${authenticatedHost.credentialId}\u0000${request.connectionId}`;
    const existingHash = this.#connectionIndex.get(connectionKey);
    if (existingHash !== undefined) {
      const existing = this.#sessionsByTokenHash.get(existingHash);
      if (
        existing !== undefined &&
        existing.expiresAtMs > this.#now().getTime() &&
        existing.computerInstanceId === request.computerInstanceId
      ) {
        return existing.openResponse;
      }
      this.#connectionIndex.delete(connectionKey);
    }

    const priorConnection = this.#connections.get(connectionKey);
    const host =
      priorConnection?.computerInstanceId === request.computerInstanceId
        ? priorConnection.host
        : authenticatedHost;

    const record = this.#computer.heartbeatHost(host, {
      buildVersion: request.computerBuildVersion,
      processId: request.processId,
      protocolVersion: request.runtimeProtocolVersion,
      state: "online",
      takeoverAfterMs: this.#takeoverAfterMs,
    });
    const serverTime = this.#now();
    const accessToken = this.#uniqueSessionAccessToken();
    const accessTokenHash = tokenHash(accessToken);
    const expiresAtMs = serverTime.getTime() + this.#sessionTtlMs;
    const response = ComputerSessionOpenResponseSchema.parse({
      acceptedControlApiVersion: 1,
      hostId: record.hostId,
      hostInstanceId: record.instanceId,
      serverTime: serverTime.toISOString(),
      sessionAccessToken: accessToken,
      sessionExpiresAt: new Date(expiresAtMs).toISOString(),
    });
    this.#invalidateHostSessions(record.hostId, record.instanceId);
    this.#connections.set(connectionKey, {
      computerInstanceId: request.computerInstanceId,
      host,
    });
    const session: ComputerSession = {
      accessToken,
      accessTokenHash,
      capabilities: new Set(request.capabilities),
      connectionKey,
      computerInstanceId: request.computerInstanceId,
      expiresAtMs,
      host,
      openResponse: response,
    };
    this.#sessionsByTokenHash.set(accessTokenHash, session);
    this.#connectionIndex.set(connectionKey, accessTokenHash);
    return response;
  }

  heartbeat(
    sessionAccessToken: string,
    untrustedRequest: ComputerHeartbeatRequest,
  ): ComputerHeartbeatResponse {
    const request = ComputerHeartbeatRequestSchema.parse(untrustedRequest);
    const session = this.#requireSession(sessionAccessToken);
    const record = this.#computer.heartbeatHost(session.host, {
      state: request.state,
      ...(request.buildVersion === undefined
        ? {}
        : { buildVersion: request.buildVersion }),
      ...(request.processId === undefined
        ? {}
        : { processId: request.processId }),
      ...(request.protocolVersion === undefined
        ? {}
        : { protocolVersion: request.protocolVersion }),
    });
    const serverTime = this.#now();
    session.expiresAtMs = serverTime.getTime() + this.#sessionTtlMs;
    const response = ComputerHeartbeatResponseSchema.parse({
      host: record,
      serverTime: serverTime.toISOString(),
      sessionExpiresAt: new Date(session.expiresAtMs).toISOString(),
    });
    session.openResponse = ComputerSessionOpenResponseSchema.parse({
      ...session.openResponse,
      serverTime: response.serverTime,
      sessionExpiresAt: response.sessionExpiresAt,
    });
    if (request.state === "offline") {
      this.#removeSession(session);
      this.#revokeWorkerGrants(session.host);
    }
    return response;
  }

  publishRuntimeOffer(
    sessionAccessToken: string,
    untrustedRequest: ComputerRuntimeOfferPublishRequest,
  ): ComputerRuntimeOfferPublishResponse {
    const request =
      ComputerRuntimeOfferPublishRequestSchema.parse(untrustedRequest);
    const session = this.#requireSession(sessionAccessToken);
    return ComputerRuntimeOfferPublishResponseSchema.parse({
      offer: this.#computer.publishRuntimeOffer(session.host, request.offer),
    });
  }

  claimPlacement(
    sessionAccessToken: string,
    untrustedRequest: ComputerPlacementClaimRequest,
  ): ComputerPlacementClaimResponse {
    const request = ComputerPlacementClaimRequestSchema.parse(untrustedRequest);
    const session = this.#requireSession(sessionAccessToken);
    return ComputerPlacementClaimResponseSchema.parse({
      claim: this.#computer.claimNextPlacement(session.host, request),
    });
  }

  claimOperation(
    sessionAccessToken: string,
    untrustedRequest: ComputerOperationClaimRequest,
  ): ComputerOperationClaimResponse {
    ComputerOperationClaimRequestSchema.parse(untrustedRequest);
    const session = this.#requireSession(sessionAccessToken);
    this.#requireCapability(session, "managed_operations");
    const claim = this.#computer.claimNextComputerOperation;
    if (claim === undefined) {
      throw new Error("managed Computer operations are not configured");
    }
    const operation = claim(session.host);
    return ComputerOperationClaimResponseSchema.parse({
      operation:
        operation === null
          ? null
          : operation.action === "restart"
            ? {
                action: operation.action,
                operationId: operation.operationId,
                requestedAt: operation.requestedAt,
              }
            : {
                action: operation.action,
                operationId: operation.operationId,
                requestedAt: operation.requestedAt,
                targetBuildVersion: operation.targetBuildVersion,
              },
    });
  }

  acknowledgeOperation(
    sessionAccessToken: string,
    untrustedRequest: ComputerOperationAcknowledgeRequest,
  ): ComputerOperationAcknowledgeResponse {
    const request =
      ComputerOperationAcknowledgeRequestSchema.parse(untrustedRequest);
    const session = this.#requireSession(sessionAccessToken);
    this.#requireCapability(session, "managed_operations");
    const acknowledge = this.#computer.acknowledgeComputerOperation;
    if (acknowledge === undefined) {
      throw new Error("managed Computer operations are not configured");
    }
    const operation = acknowledge(session.host, request);
    return ComputerOperationAcknowledgeResponseSchema.parse({
      accepted: true,
      terminal: operation.state === "failed" || operation.state === "succeeded",
    });
  }

  commandExecution(
    sessionAccessToken: string,
    untrustedRequest: ComputerExecutionCommandRequest,
  ): ComputerExecutionCommandResponse {
    const request =
      ComputerExecutionCommandRequestSchema.parse(untrustedRequest);
    const session = this.#requireSession(sessionAccessToken);
    const response: ComputerExecutionCommandResponse = (() => {
      switch (request.kind) {
        case "activation.renew":
          return {
            activation: this.#computer.renewActivationLease(
              session.host,
              request,
            ),
            kind: request.kind,
          };
        case "runtime.prepare":
          return {
            kind: request.kind,
            runtimeProcess: this.#computer.prepareRunAttemptRuntime(
              session.host,
              request,
            ),
          };
        case "run.start":
          return {
            kind: request.kind,
            runAttempt: this.#computer.markRunAttemptRunning(
              session.host,
              request,
            ),
          };
        case "run.trajectory.append":
          return {
            activity: this.#computer.appendRunTrajectory(session.host, request),
            kind: request.kind,
          };
        case "runtime.terminate":
          return {
            kind: request.kind,
            runtimeProcess: this.#computer.recordRuntimeTermination(
              session.host,
              {
                exit: {
                  code: request.exit.code,
                  ...(request.exit.signal === undefined
                    ? {}
                    : { signal: request.exit.signal }),
                },
                runAttemptId: request.runAttemptId,
                runtimeRunId: request.runtimeRunId,
              },
            ),
          };
        case "run.finish":
          return {
            kind: request.kind,
            runAttempt: this.#computer.finishRunAttempt(session.host, {
              ...(request.error === undefined ? {} : { error: request.error }),
              ...(request.exitCode === undefined
                ? {}
                : { exitCode: request.exitCode }),
              ...(request.exitSignal === undefined
                ? {}
                : { exitSignal: request.exitSignal }),
              runAttemptId: request.runAttemptId,
              state: request.state,
            }),
          };
        case "activation.complete":
          return {
            activation: this.#computer.completeActivation(
              session.host,
              request,
            ),
            kind: request.kind,
          };
        case "activation.retry":
          return {
            activation: this.#computer.retryActivation(session.host, request),
            kind: request.kind,
          };
        case "activation.quarantine":
          return {
            activation: this.#computer.quarantineActivation(
              session.host,
              request,
            ),
            kind: request.kind,
          };
        case "activation.cancellation.resolve":
          return {
            activation: this.#computer.resolveActivationCancellation(
              session.host,
              request,
            ),
            kind: request.kind,
          };
      }
    })();
    return ComputerExecutionCommandResponseSchema.parse(response);
  }

  issueWorkerCredential(
    sessionAccessToken: string,
    untrustedRequest: ComputerWorkerCredentialIssueRequest,
  ): ComputerWorkerCredentialIssueResponse {
    const issuer = this.#workerCredentials;
    if (issuer === undefined) {
      throw new Error("remote Worker credentials are not configured");
    }
    const request =
      ComputerWorkerCredentialIssueRequestSchema.parse(untrustedRequest);
    const session = this.#requireSession(sessionAccessToken);
    this.#removeExpiredWorkerGrants();
    if (this.#workerGrants.size >= 4_096) {
      throw new Error("remote Worker credential capacity is exhausted");
    }
    const credential = issuer.issueActivationCredential(session.host, {
      activationId: request.activationId,
      consumerId: request.consumerId,
      hostId: session.host.hostId,
      participantId: request.participantId,
      roomId: request.roomId,
      runAttemptId: request.runAttemptId,
      toSeq: request.toSeq,
    });
    const credentialId = `worker_credential_${randomUUID()}`;
    let response: ComputerWorkerCredentialIssueResponse;
    try {
      response = ComputerWorkerCredentialIssueResponseSchema.parse({
        credentialId,
        expiresAt: credential.expiresAt,
        workerAccessToken: credential.accessToken,
        workerApiOrigin: issuer.origin,
      });
      if (Date.parse(response.expiresAt) <= this.#now().getTime()) {
        throw new Error("remote Worker credential must expire in the future");
      }
    } catch (error) {
      credential.revoke();
      throw error;
    }
    this.#workerGrants.set(credentialId, {
      expiresAtMs: Date.parse(response.expiresAt),
      hostCredentialId: session.host.credentialId,
      hostId: session.host.hostId,
      hostInstanceId: session.host.instanceId,
      revoke: credential.revoke,
      revoked: false,
    });
    return response;
  }

  revokeWorkerCredential(
    sessionAccessToken: string,
    untrustedRequest: ComputerWorkerCredentialRevokeRequest,
  ): ComputerWorkerCredentialRevokeResponse {
    const request =
      ComputerWorkerCredentialRevokeRequestSchema.parse(untrustedRequest);
    const session = this.#requireSession(sessionAccessToken);
    this.#removeExpiredWorkerGrants();
    const grant = this.#workerGrants.get(request.credentialId);
    if (
      grant === undefined ||
      grant.hostCredentialId !== session.host.credentialId ||
      grant.hostInstanceId !== session.host.instanceId
    ) {
      throw new UnauthenticatedError("Worker credential revocation failed");
    }
    if (!grant.revoked) {
      grant.revoke();
      grant.revoked = true;
    }
    return ComputerWorkerCredentialRevokeResponseSchema.parse({
      revoked: true,
    });
  }

  dispose(): void {
    for (const grant of this.#workerGrants.values()) this.#revokeGrant(grant);
    this.#workerGrants.clear();
    this.#connectionIndex.clear();
    this.#connections.clear();
    this.#sessionsByTokenHash.clear();
  }

  #invalidateHostSessions(hostId: string, currentInstanceId: string): void {
    for (const session of this.#sessionsByTokenHash.values()) {
      if (session.host.hostId === hostId) this.#removeSession(session);
    }
    for (const grant of this.#workerGrants.values()) {
      if (
        grant.hostId === hostId &&
        grant.hostInstanceId !== currentInstanceId
      ) {
        this.#revokeGrant(grant);
      }
    }
  }

  #removeExpiredSessions(): void {
    const now = this.#now().getTime();
    for (const session of this.#sessionsByTokenHash.values()) {
      if (session.expiresAtMs <= now) this.#removeSession(session);
    }
  }

  #removeExpiredWorkerGrants(): void {
    const now = this.#now().getTime();
    for (const [credentialId, grant] of this.#workerGrants) {
      if (grant.expiresAtMs > now && !grant.revoked) continue;
      this.#revokeGrant(grant);
      if (grant.expiresAtMs <= now) this.#workerGrants.delete(credentialId);
    }
  }

  #revokeWorkerGrants(host: AuthenticatedHostContext): void {
    for (const grant of this.#workerGrants.values()) {
      if (
        grant.hostCredentialId === host.credentialId &&
        grant.hostInstanceId === host.instanceId
      ) {
        this.#revokeGrant(grant);
      }
    }
  }

  #revokeGrant(grant: ComputerWorkerGrant): void {
    if (grant.revoked) return;
    grant.revoke();
    grant.revoked = true;
  }

  #removeSession(session: ComputerSession): void {
    this.#sessionsByTokenHash.delete(session.accessTokenHash);
    if (
      this.#connectionIndex.get(session.connectionKey) ===
      session.accessTokenHash
    ) {
      this.#connectionIndex.delete(session.connectionKey);
    }
  }

  #requireSession(accessToken: string): ComputerSession {
    this.#removeExpiredSessions();
    if (accessToken.length < 32 || accessToken.length > 512) {
      throw new UnauthenticatedError("computer session authentication failed");
    }
    const session = this.#sessionsByTokenHash.get(tokenHash(accessToken));
    if (session === undefined || session.accessToken !== accessToken) {
      throw new UnauthenticatedError("computer session authentication failed");
    }
    return session;
  }

  #requireCapability(
    session: ComputerSession,
    capability: ComputerControlCapability,
  ): void {
    if (!session.capabilities.has(capability)) {
      throw new ForbiddenError(
        `Computer session does not advertise ${capability}`,
      );
    }
  }

  #uniqueSessionAccessToken(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const accessToken = this.#createSessionAccessToken();
      if (accessToken.length < 32) {
        throw new Error(
          "Computer session access token must be at least 32 characters",
        );
      }
      if (!this.#sessionsByTokenHash.has(tokenHash(accessToken)))
        return accessToken;
    }
    throw new Error(
      "Computer session access token generator collided repeatedly",
    );
  }
}
