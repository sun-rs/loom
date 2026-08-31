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
  ComputerControlClientError,
  type ComputerControlClientPort,
} from "./computer-resident-service.ts";
import { validateComputerControlOrigin } from "./computer-control-origin.ts";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 256 * 1_024;

type ProtocolSchema<T> = {
  parse(value: unknown): T;
};

export type NodeHttpComputerControlClientOptions = {
  fetch?: typeof fetch;
  hostAccessToken: string;
  origin: string;
  timeoutMs?: number;
};

/**
 * The only HTTP knowledge required by AgentHost. Cleartext is deliberately
 * confined to a numeric loopback origin; LAN and remote Computers require TLS.
 */
export class NodeHttpComputerControlClient implements ComputerControlClientPort {
  readonly #fetch: typeof fetch;
  readonly #hostAccessToken: string;
  readonly #origin: string;
  readonly #timeoutMs: number;

  constructor(options: NodeHttpComputerControlClientOptions) {
    this.#origin = validateComputerControlOrigin(options.origin);
    this.#hostAccessToken = validateToken(
      options.hostAccessToken,
      "hostAccessToken",
    );
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = positiveInteger(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      "timeoutMs",
    );
  }

  openSession(
    request: ComputerSessionOpenRequest,
  ): Promise<ComputerSessionOpenResponse> {
    return this.#post(
      "/v1/computer/session/open",
      this.#hostAccessToken,
      ComputerSessionOpenRequestSchema.parse(request),
      ComputerSessionOpenResponseSchema,
    );
  }

  acknowledgeOperation(
    sessionAccessToken: string,
    request: ComputerOperationAcknowledgeRequest,
  ): Promise<ComputerOperationAcknowledgeResponse> {
    return this.#post(
      "/v1/computer/operations/acknowledge",
      validateToken(sessionAccessToken, "sessionAccessToken"),
      ComputerOperationAcknowledgeRequestSchema.parse(request),
      ComputerOperationAcknowledgeResponseSchema,
    );
  }

  claimOperation(
    sessionAccessToken: string,
    request: ComputerOperationClaimRequest,
  ): Promise<ComputerOperationClaimResponse> {
    return this.#post(
      "/v1/computer/operations/claim",
      validateToken(sessionAccessToken, "sessionAccessToken"),
      ComputerOperationClaimRequestSchema.parse(request),
      ComputerOperationClaimResponseSchema,
    );
  }

  commandExecution(
    sessionAccessToken: string,
    request: ComputerExecutionCommandRequest,
  ): Promise<ComputerExecutionCommandResponse> {
    return this.#post(
      "/v1/computer/executions/command",
      validateToken(sessionAccessToken, "sessionAccessToken"),
      ComputerExecutionCommandRequestSchema.parse(request),
      ComputerExecutionCommandResponseSchema,
    );
  }

  heartbeat(
    sessionAccessToken: string,
    request: ComputerHeartbeatRequest,
  ): Promise<ComputerHeartbeatResponse> {
    return this.#post(
      "/v1/computer/heartbeat",
      validateToken(sessionAccessToken, "sessionAccessToken"),
      ComputerHeartbeatRequestSchema.parse(request),
      ComputerHeartbeatResponseSchema,
    );
  }

  publishRuntimeOffer(
    sessionAccessToken: string,
    request: ComputerRuntimeOfferPublishRequest,
  ): Promise<ComputerRuntimeOfferPublishResponse> {
    return this.#post(
      "/v1/computer/runtime-offers/publish",
      validateToken(sessionAccessToken, "sessionAccessToken"),
      ComputerRuntimeOfferPublishRequestSchema.parse(request),
      ComputerRuntimeOfferPublishResponseSchema,
    );
  }

  issueWorkerCredential(
    sessionAccessToken: string,
    request: ComputerWorkerCredentialIssueRequest,
  ): Promise<ComputerWorkerCredentialIssueResponse> {
    return this.#post(
      "/v1/computer/worker-credentials/issue",
      validateToken(sessionAccessToken, "sessionAccessToken"),
      ComputerWorkerCredentialIssueRequestSchema.parse(request),
      ComputerWorkerCredentialIssueResponseSchema,
    );
  }

  revokeWorkerCredential(
    sessionAccessToken: string,
    request: ComputerWorkerCredentialRevokeRequest,
  ): Promise<ComputerWorkerCredentialRevokeResponse> {
    return this.#post(
      "/v1/computer/worker-credentials/revoke",
      validateToken(sessionAccessToken, "sessionAccessToken"),
      ComputerWorkerCredentialRevokeRequestSchema.parse(request),
      ComputerWorkerCredentialRevokeResponseSchema,
    );
  }

  claimPlacement(
    sessionAccessToken: string,
    request: ComputerPlacementClaimRequest,
  ): Promise<ComputerPlacementClaimResponse> {
    return this.#post(
      "/v1/computer/placements/claim",
      validateToken(sessionAccessToken, "sessionAccessToken"),
      ComputerPlacementClaimRequestSchema.parse(request),
      ComputerPlacementClaimResponseSchema,
    );
  }

  async #post<Request extends object, Response>(
    path: string,
    accessToken: string,
    request: Request,
    responseSchema: ProtocolSchema<Response>,
  ): Promise<Response> {
    let response: globalThis.Response;
    try {
      response = await this.#fetch(`${this.#origin}${path}`, {
        body: JSON.stringify(request),
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      if (error instanceof ComputerControlClientError) throw error;
      throw new ComputerControlClientError(
        "unavailable",
        "Computer control endpoint is unavailable",
      );
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw classifyHttpFailure(response.status);
    }
    const body = await readBoundedJson(response);
    try {
      return responseSchema.parse(body);
    } catch {
      throw new ComputerControlClientError(
        "protocol",
        "Computer control endpoint returned an invalid response",
      );
    }
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const body = response.body;
  if (body === null) {
    throw new ComputerControlClientError(
      "protocol",
      "Computer control endpoint returned an empty response",
    );
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = Buffer.from(result.value);
      bytes += chunk.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ComputerControlClientError(
          "protocol",
          "Computer control response exceeds 256 KiB",
        );
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof ComputerControlClientError) throw error;
    throw new ComputerControlClientError(
      "unavailable",
      "Computer control response could not be read",
    );
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")) as unknown;
  } catch {
    throw new ComputerControlClientError(
      "protocol",
      "Computer control endpoint returned invalid JSON",
    );
  }
}

function classifyHttpFailure(status: number): ComputerControlClientError {
  if (status === 401 || status === 403) {
    return new ComputerControlClientError(
      "unauthenticated",
      "Computer control authentication failed",
    );
  }
  if (status === 409) {
    return new ComputerControlClientError(
      "conflict",
      "Computer control generation is temporarily fenced",
    );
  }
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return new ComputerControlClientError(
      "unavailable",
      "Computer control endpoint is temporarily unavailable",
    );
  }
  return new ComputerControlClientError(
    "protocol",
    `Computer control request failed with HTTP ${String(status)}`,
  );
}

function validateToken(value: string, name: string): string {
  if (value.length === 0 || value.length > 4_096) {
    throw new Error(`${name} must contain between 1 and 4096 characters`);
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}
