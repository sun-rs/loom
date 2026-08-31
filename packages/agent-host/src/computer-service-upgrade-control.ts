import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lstat } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { dirname, isAbsolute } from "node:path";

export const COMPUTER_SERVICE_UPGRADE_CONTROL_PROTOCOL =
  "rah-computer-service-upgrade-control-v1";
const HEX_256 = /^[0-9a-f]{64}$/u;
const MAX_MESSAGE_BYTES = 64 * 1_024;
const MAX_ATTACHMENTS = 128;

export type ComputerServiceUpgradeControlOperation =
  "hold" | "release" | "stop";

export type ComputerServiceUpgradeControlResponse = Readonly<{
  accepted: true;
  operation: ComputerServiceUpgradeControlOperation;
  processId: number;
  serviceGeneration: string;
}>;

export type ComputerServiceUpgradeControlHandlerOptions = Readonly<{
  controlToken: string;
  holdManagedAttachments(
    expected: Readonly<Record<string, string>>,
  ): Promise<void>;
  processId?: number;
  releaseManagedAttachmentsHold(): Promise<void>;
  requestTimeoutMs?: number;
  scheduleStop(): void;
  serviceGeneration: string;
}>;

type NormalizedRequest = Readonly<{
  challenge: string;
  expectedManagedAttachmentIdentities?: Readonly<Record<string, string>>;
  expectedProcessId: number;
  expectedServiceGeneration: string;
  operation: ComputerServiceUpgradeControlOperation;
  protocol: typeof COMPUTER_SERVICE_UPGRADE_CONTROL_PROTOCOL;
}>;

/**
 * Mutating upgrade control is separate from read-only attestation. Every call
 * authenticates its exact intent and fences the target process incarnation.
 */
export function createComputerServiceUpgradeControlHandler(
  options: ComputerServiceUpgradeControlHandlerOptions,
): (socket: Socket) => void {
  const controlToken = token(options.controlToken);
  const processId = positiveInteger(
    options.processId ?? process.pid,
    "processId",
  );
  const serviceGeneration = identifier(
    options.serviceGeneration,
    "serviceGeneration",
    512,
  );
  const timeoutMs = positiveInteger(
    options.requestTimeoutMs ?? 2_000,
    "requestTimeoutMs",
  );
  return (socket) => {
    socket.setTimeout(timeoutMs, () => socket.destroy());
    collectLine(socket)
      .then(async (line) => {
        if (line === null) return;
        const envelope = record(JSON.parse(line) as unknown, "control request");
        exactKeys(envelope, ["mac", "request"]);
        const request = normalizeRequest(envelope.request);
        requireMac(envelope.mac, controlToken, requestPayload(request));
        if (
          request.expectedProcessId !== processId ||
          request.expectedServiceGeneration !== serviceGeneration
        ) {
          throw new Error("upgrade control request targets a stale service");
        }
        if (request.operation === "hold") {
          await options.holdManagedAttachments(
            request.expectedManagedAttachmentIdentities!,
          );
        } else if (request.operation === "release") {
          await options.releaseManagedAttachmentsHold();
        }
        const response = Object.freeze({
          accepted: true as const,
          challenge: request.challenge,
          operation: request.operation,
          processId,
          protocol: COMPUTER_SERVICE_UPGRADE_CONTROL_PROTOCOL,
          serviceGeneration,
        });
        const serialized = `${JSON.stringify({
          mac: mac(controlToken, responsePayload(response)),
          response,
        })}\n`;
        if (request.operation === "stop") {
          socket.end(serialized, options.scheduleStop);
        } else {
          socket.end(serialized);
        }
      })
      .catch(() => socket.destroy());
  };
}

export async function requestComputerServiceUpgradeControl(
  input: Readonly<{
    controlToken: string;
    expectedManagedAttachmentIdentities?: Readonly<Record<string, string>>;
    expectedProcessId: number;
    expectedServiceGeneration: string;
    operation: ComputerServiceUpgradeControlOperation;
    socketPath: string;
    timeoutMs: number;
  }>,
): Promise<ComputerServiceUpgradeControlResponse> {
  const controlToken = token(input.controlToken);
  const socketPath = validateSocketPath(input.socketPath);
  const timeoutMs = positiveInteger(input.timeoutMs, "timeoutMs");
  if (!(await assertOwnerPrivateSocket(socketPath))) {
    throw new Error("Computer service upgrade control is unavailable");
  }
  const request = normalizeRequest({
    challenge: randomBytes(32).toString("hex"),
    ...(input.expectedManagedAttachmentIdentities === undefined
      ? {}
      : {
          expectedManagedAttachmentIdentities:
            input.expectedManagedAttachmentIdentities,
        }),
    expectedProcessId: input.expectedProcessId,
    expectedServiceGeneration: input.expectedServiceGeneration,
    operation: input.operation,
    protocol: COMPUTER_SERVICE_UPGRADE_CONTROL_PROTOCOL,
  });
  const line = await requestLine(
    socketPath,
    `${JSON.stringify({
      mac: mac(controlToken, requestPayload(request)),
      request,
    })}\n`,
    timeoutMs,
  );
  if (line === null) {
    throw new Error("Computer service upgrade control request was rejected");
  }
  const envelope = record(JSON.parse(line) as unknown, "control response");
  exactKeys(envelope, ["mac", "response"]);
  const response = normalizeResponse(envelope.response);
  if (
    response.challenge !== request.challenge ||
    response.operation !== request.operation ||
    response.processId !== request.expectedProcessId ||
    response.serviceGeneration !== request.expectedServiceGeneration
  ) {
    throw new Error(
      "Computer service upgrade control response is inconsistent",
    );
  }
  requireMac(envelope.mac, controlToken, responsePayload(response));
  return Object.freeze({
    accepted: true,
    operation: response.operation,
    processId: response.processId,
    serviceGeneration: response.serviceGeneration,
  });
}

function normalizeRequest(value: unknown): NormalizedRequest {
  const request = record(value, "control request body");
  const operation = operationName(request.operation);
  exactKeys(
    request,
    operation === "hold"
      ? [
          "challenge",
          "expectedManagedAttachmentIdentities",
          "expectedProcessId",
          "expectedServiceGeneration",
          "operation",
          "protocol",
        ]
      : [
          "challenge",
          "expectedProcessId",
          "expectedServiceGeneration",
          "operation",
          "protocol",
        ],
  );
  if (request.protocol !== COMPUTER_SERVICE_UPGRADE_CONTROL_PROTOCOL) {
    throw new Error("Computer service upgrade control protocol is invalid");
  }
  return Object.freeze({
    challenge: challenge(request.challenge),
    ...(operation === "hold"
      ? {
          expectedManagedAttachmentIdentities: attachmentIdentities(
            request.expectedManagedAttachmentIdentities,
          ),
        }
      : {}),
    expectedProcessId: positiveInteger(
      request.expectedProcessId,
      "expectedProcessId",
    ),
    expectedServiceGeneration: identifier(
      request.expectedServiceGeneration,
      "expectedServiceGeneration",
      512,
    ),
    operation,
    protocol: COMPUTER_SERVICE_UPGRADE_CONTROL_PROTOCOL,
  });
}

function normalizeResponse(value: unknown): Readonly<{
  accepted: true;
  challenge: string;
  operation: ComputerServiceUpgradeControlOperation;
  processId: number;
  protocol: typeof COMPUTER_SERVICE_UPGRADE_CONTROL_PROTOCOL;
  serviceGeneration: string;
}> {
  const response = record(value, "control response body");
  exactKeys(response, [
    "accepted",
    "challenge",
    "operation",
    "processId",
    "protocol",
    "serviceGeneration",
  ]);
  if (
    response.accepted !== true ||
    response.protocol !== COMPUTER_SERVICE_UPGRADE_CONTROL_PROTOCOL
  ) {
    throw new Error("Computer service upgrade control response is invalid");
  }
  return Object.freeze({
    accepted: true,
    challenge: challenge(response.challenge),
    operation: operationName(response.operation),
    processId: positiveInteger(response.processId, "processId"),
    protocol: COMPUTER_SERVICE_UPGRADE_CONTROL_PROTOCOL,
    serviceGeneration: identifier(
      response.serviceGeneration,
      "serviceGeneration",
      512,
    ),
  });
}

function requestPayload(request: NormalizedRequest): string {
  return JSON.stringify(request);
}

function responsePayload(response: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(response);
}

function mac(controlToken: string, payload: string): string {
  return createHmac("sha256", controlToken).update(payload).digest("hex");
}

function requireMac(
  value: unknown,
  controlToken: string,
  payload: string,
): void {
  if (typeof value !== "string" || !HEX_256.test(value)) {
    throw new Error("Computer service upgrade control authentication failed");
  }
  const expected = Buffer.from(mac(controlToken, payload), "hex");
  const actual = Buffer.from(value, "hex");
  if (
    actual.byteLength !== expected.byteLength ||
    !timingSafeEqual(actual, expected)
  ) {
    throw new Error("Computer service upgrade control authentication failed");
  }
}

function attachmentIdentities(
  value: unknown,
): Readonly<Record<string, string>> {
  const input = record(value, "expectedManagedAttachmentIdentities");
  const keys = Object.keys(input).sort();
  if (keys.length > MAX_ATTACHMENTS) {
    throw new Error("expected managed attachment set exceeds 128 entries");
  }
  const output: Record<string, string> = {};
  for (const key of keys) {
    const attachmentId = identifier(key, "attachmentId", 256);
    Object.defineProperty(output, attachmentId, {
      configurable: false,
      enumerable: true,
      value: identifier(input[key], `attachment.${attachmentId}`, 512),
      writable: false,
    });
  }
  return Object.freeze(output);
}

async function collectLine(socket: Socket): Promise<string | null> {
  return await new Promise<string | null>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (result: string | null, error?: Error) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners("data");
      socket.removeAllListeners("end");
      if (error === undefined) resolve(result);
      else reject(error);
    };
    socket.on("data", (chunk: Buffer) => {
      const newline = chunk.indexOf(0x0a);
      const accepted = newline === -1 ? chunk : chunk.subarray(0, newline);
      bytes += accepted.byteLength;
      if (bytes > MAX_MESSAGE_BYTES) {
        finish(null, new Error("upgrade control request is too large"));
        return;
      }
      chunks.push(accepted);
      if (newline !== -1) finish(Buffer.concat(chunks, bytes).toString("utf8"));
    });
    socket.once("end", () => {
      if (bytes === 0) finish(null);
      else finish(null, new Error("upgrade control request was truncated"));
    });
    socket.once("error", (error) => finish(null, error));
  });
}

async function requestLine(
  socketPath: string,
  request: string,
  timeoutMs: number,
): Promise<string | null> {
  return await new Promise<string | null>((resolve, reject) => {
    const socket = createConnection(socketPath);
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const timer = setTimeout(() => finish(null), timeoutMs);
    const finish = (result: string | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error === undefined) resolve(result);
      else reject(error);
    };
    socket.once("connect", () => socket.write(request));
    socket.on("data", (chunk: Buffer) => {
      const newline = chunk.indexOf(0x0a);
      const accepted = newline === -1 ? chunk : chunk.subarray(0, newline);
      bytes += accepted.byteLength;
      if (bytes > MAX_MESSAGE_BYTES) {
        finish(null, new Error("upgrade control response is too large"));
        return;
      }
      chunks.push(accepted);
      if (newline !== -1) finish(Buffer.concat(chunks, bytes).toString("utf8"));
    });
    socket.once("end", () => {
      if (bytes === 0) finish(null);
      else finish(null, new Error("upgrade control response was truncated"));
    });
    socket.once("error", (error) => {
      if (isTransientSocketError(error)) finish(null);
      else finish(null, error);
    });
  });
}

async function assertOwnerPrivateSocket(socketPath: string): Promise<boolean> {
  let socket;
  try {
    socket = await lstat(socketPath);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
  const directory = await lstat(dirname(socketPath));
  const owner = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (directory.mode & 0o077) !== 0 ||
    !socket.isSocket() ||
    socket.isSymbolicLink() ||
    (socket.mode & 0o077) !== 0 ||
    (owner !== null && (directory.uid !== owner || socket.uid !== owner))
  ) {
    throw new Error("Computer service upgrade control socket is not private");
  }
  return true;
}

function validateSocketPath(value: string): string {
  if (
    !isAbsolute(value) ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > 103
  ) {
    throw new Error("Computer service upgrade control socket path is invalid");
  }
  return value;
}

function operationName(value: unknown): ComputerServiceUpgradeControlOperation {
  if (value !== "hold" && value !== "release" && value !== "stop") {
    throw new Error("Computer service upgrade control operation is invalid");
  }
  return value;
}

function challenge(value: unknown): string {
  if (typeof value !== "string" || !HEX_256.test(value)) {
    throw new Error("Computer service upgrade control challenge is invalid");
  }
  return value;
}

function token(value: string): string {
  if (!HEX_256.test(value)) {
    throw new Error("Computer service upgrade control token is invalid");
  }
  return value;
}

function identifier(value: unknown, name: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (
    actual.length !== sorted.length ||
    actual.some((key, index) => key !== sorted[index])
  ) {
    throw new Error("Computer service upgrade control shape is invalid");
  }
}

function isTransientSocketError(error: unknown): boolean {
  return ["ECONNREFUSED", "ENOENT", "ENOTSOCK", "ECONNRESET"].some((code) =>
    hasCode(error, code),
  );
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
