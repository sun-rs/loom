import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lstat } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { dirname, isAbsolute } from "node:path";

import type { ComputerServiceReplacementAttestation } from "./computer-service-replacement.ts";

export const COMPUTER_SERVICE_OWNERSHIP_PROOF_PROTOCOL =
  "rah-computer-service-ownership-v1";
const HEX_256 = /^[0-9a-f]{64}$/u;
const MAX_MESSAGE_BYTES = 64 * 1_024;
const DEFAULT_HANDLER_TIMEOUT_MS = 2_000;

export type ComputerServiceOwnershipProofHandlerOptions = Readonly<{
  attestation(): Promise<ComputerServiceReplacementAttestation>;
  controlToken: string;
  processId?: number;
  requestTimeoutMs?: number;
}>;

export function createComputerServiceOwnershipProofToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Serves a challenge-bound HMAC attestation on the same Unix socket that owns
 * the service singleton. A file, pidfile, stdout line, or cached version can
 * therefore never prove exclusive service ownership on its own.
 */
export function createComputerServiceOwnershipProofHandler(
  options: ComputerServiceOwnershipProofHandlerOptions,
): (socket: Socket) => void {
  const controlToken = token(options.controlToken);
  const processId = positiveInteger(
    options.processId ?? process.pid,
    "processId",
  );
  const timeoutMs = positiveInteger(
    options.requestTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS,
    "requestTimeoutMs",
  );
  return (socket) => {
    socket.setTimeout(timeoutMs, () => socket.destroy());
    collectLine(socket)
      .then(async (line) => {
        if (line === null) return;
        const request = parseRequest(line);
        if (
          request.kind === "candidate" &&
          request.candidateProcessId !== processId
        ) {
          throw new Error("ownership proof candidate process is inconsistent");
        }
        const attestation = normalizeAttestation(await options.attestation());
        if (attestation.candidateProcessId !== processId) {
          throw new Error("ownership attestation process is inconsistent");
        }
        const payload = proofPayload(
          request.challenge,
          attestation,
          request.kind,
        );
        socket.end(
          `${JSON.stringify({
            attestation,
            challenge: request.challenge,
            ...(request.kind === "live" ? { kind: "live-attestation" } : {}),
            mac: createHmac("sha256", controlToken)
              .update(payload)
              .digest("hex"),
            protocol: COMPUTER_SERVICE_OWNERSHIP_PROOF_PROTOCOL,
          })}\n`,
        );
      })
      .catch(() => socket.destroy());
  };
}

export async function readComputerServiceOwnershipProof(input: {
  candidateProcessId: number;
  controlToken: string;
  socketPath: string;
  timeoutMs: number;
}): Promise<ComputerServiceReplacementAttestation | null> {
  const candidateProcessId = positiveInteger(
    input.candidateProcessId,
    "candidateProcessId",
  );
  const controlToken = token(input.controlToken);
  const socketPath = validateSocketPath(input.socketPath);
  const timeoutMs = positiveInteger(input.timeoutMs, "timeoutMs");
  if (!(await assertOwnerPrivateSocket(socketPath))) return null;
  const challenge = randomBytes(32).toString("hex");
  const line = await requestLine(
    socketPath,
    `${JSON.stringify({
      candidateProcessId,
      challenge,
      protocol: COMPUTER_SERVICE_OWNERSHIP_PROOF_PROTOCOL,
    })}\n`,
    timeoutMs,
  );
  if (line === null) return null;
  const envelope = record(JSON.parse(line) as unknown, "ownership proof");
  exactKeys(envelope, ["attestation", "challenge", "mac", "protocol"]);
  if (
    envelope.protocol !== COMPUTER_SERVICE_OWNERSHIP_PROOF_PROTOCOL ||
    envelope.challenge !== challenge
  ) {
    throw new Error("Computer service ownership proof challenge is invalid");
  }
  const attestation = normalizeAttestation(envelope.attestation);
  if (attestation.candidateProcessId !== candidateProcessId) {
    throw new Error("Computer service ownership proof process is invalid");
  }
  if (typeof envelope.mac !== "string" || !HEX_256.test(envelope.mac)) {
    throw new Error("Computer service ownership proof authentication failed");
  }
  const expected = Buffer.from(
    createHmac("sha256", controlToken)
      .update(proofPayload(challenge, attestation, "candidate"))
      .digest("hex"),
    "hex",
  );
  const observed = Buffer.from(envelope.mac, "hex");
  if (
    observed.byteLength !== expected.byteLength ||
    !timingSafeEqual(observed, expected)
  ) {
    throw new Error("Computer service ownership proof authentication failed");
  }
  return attestation;
}

/**
 * Asks the authenticated owner of the singleton socket to identify itself.
 * Unlike replacement proof, the caller need not trust a pidfile first.
 */
export async function readComputerServiceLiveAttestation(input: {
  controlToken: string;
  socketPath: string;
  timeoutMs: number;
}): Promise<ComputerServiceReplacementAttestation | null> {
  const controlToken = token(input.controlToken);
  const socketPath = validateSocketPath(input.socketPath);
  const timeoutMs = positiveInteger(input.timeoutMs, "timeoutMs");
  if (!(await assertOwnerPrivateSocket(socketPath))) return null;
  const challenge = randomBytes(32).toString("hex");
  const line = await requestLine(
    socketPath,
    `${JSON.stringify({
      challenge,
      kind: "live-attestation",
      protocol: COMPUTER_SERVICE_OWNERSHIP_PROOF_PROTOCOL,
    })}\n`,
    timeoutMs,
  );
  if (line === null) return null;
  const envelope = record(JSON.parse(line) as unknown, "ownership proof");
  exactKeys(envelope, ["attestation", "challenge", "kind", "mac", "protocol"]);
  if (
    envelope.protocol !== COMPUTER_SERVICE_OWNERSHIP_PROOF_PROTOCOL ||
    envelope.kind !== "live-attestation" ||
    envelope.challenge !== challenge
  ) {
    throw new Error("Computer service ownership proof challenge is invalid");
  }
  const attestation = normalizeAttestation(envelope.attestation);
  requireMac(envelope.mac, controlToken, challenge, attestation, "live");
  return attestation;
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
        finish(
          null,
          new Error("Computer service ownership request is too large"),
        );
        return;
      }
      chunks.push(accepted);
      if (newline !== -1) finish(Buffer.concat(chunks, bytes).toString("utf8"));
    });
    socket.once("end", () => {
      if (bytes === 0) finish(null);
      else
        finish(
          null,
          new Error("Computer service ownership request was truncated"),
        );
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
        finish(
          null,
          new Error("Computer service ownership proof is too large"),
        );
        return;
      }
      chunks.push(accepted);
      if (newline !== -1) finish(Buffer.concat(chunks, bytes).toString("utf8"));
    });
    socket.once("end", () => {
      if (bytes === 0) finish(null);
      else
        finish(
          null,
          new Error("Computer service ownership proof was truncated"),
        );
    });
    socket.once("error", (error) => {
      if (isTransientSocketError(error)) finish(null);
      else finish(null, error);
    });
  });
}

function parseRequest(line: string):
  | Readonly<{
      candidateProcessId: number;
      challenge: string;
      kind: "candidate";
    }>
  | Readonly<{ challenge: string; kind: "live" }> {
  const request = record(JSON.parse(line) as unknown, "ownership request");
  if (request.kind === "live-attestation") {
    exactKeys(request, ["challenge", "kind", "protocol"]);
    if (
      request.protocol !== COMPUTER_SERVICE_OWNERSHIP_PROOF_PROTOCOL ||
      typeof request.challenge !== "string" ||
      !HEX_256.test(request.challenge)
    ) {
      throw new Error("Computer service ownership request is invalid");
    }
    return Object.freeze({ challenge: request.challenge, kind: "live" });
  }
  exactKeys(request, ["candidateProcessId", "challenge", "protocol"]);
  if (
    request.protocol !== COMPUTER_SERVICE_OWNERSHIP_PROOF_PROTOCOL ||
    typeof request.challenge !== "string" ||
    !HEX_256.test(request.challenge)
  ) {
    throw new Error("Computer service ownership request is invalid");
  }
  return Object.freeze({
    candidateProcessId: positiveInteger(
      request.candidateProcessId,
      "candidateProcessId",
    ),
    challenge: request.challenge,
    kind: "candidate",
  });
}

function normalizeAttestation(
  value: unknown,
): ComputerServiceReplacementAttestation {
  const attestation = record(value, "service attestation");
  exactKeys(attestation, [
    "buildVersion",
    "candidateComputerInstanceId",
    "candidateProcessId",
    "managedAttachmentIds",
    "managedAttachmentIdentities",
    "serviceGeneration",
    "sourceProcessId",
  ]);
  if (!Array.isArray(attestation.managedAttachmentIds)) {
    throw new Error("managedAttachmentIds must be an array");
  }
  const managedAttachmentIds = attestation.managedAttachmentIds.map(
    (value, index) =>
      boundedString(value, `managedAttachmentIds[${String(index)}]`, 512),
  );
  const sorted = [...managedAttachmentIds].sort();
  if (
    new Set(managedAttachmentIds).size !== managedAttachmentIds.length ||
    managedAttachmentIds.some((value, index) => value !== sorted[index])
  ) {
    throw new Error("managedAttachmentIds must be sorted and unique");
  }
  const identities = record(
    attestation.managedAttachmentIdentities,
    "managedAttachmentIdentities",
  );
  const identityKeys = Object.keys(identities).sort();
  if (
    identityKeys.length !== managedAttachmentIds.length ||
    identityKeys.some((value, index) => value !== managedAttachmentIds[index])
  ) {
    throw new Error("managed attachment identity set is incomplete");
  }
  const managedAttachmentIdentities: Record<string, string> = {};
  for (const attachmentId of managedAttachmentIds) {
    Object.defineProperty(managedAttachmentIdentities, attachmentId, {
      configurable: false,
      enumerable: true,
      value: boundedString(
        identities[attachmentId],
        `managedAttachmentIdentities.${attachmentId}`,
        512,
      ),
      writable: false,
    });
  }
  return Object.freeze({
    buildVersion: boundedString(attestation.buildVersion, "buildVersion", 128),
    candidateComputerInstanceId: boundedString(
      attestation.candidateComputerInstanceId,
      "candidateComputerInstanceId",
      512,
    ),
    candidateProcessId: positiveInteger(
      attestation.candidateProcessId,
      "candidateProcessId",
    ),
    managedAttachmentIds: Object.freeze(managedAttachmentIds),
    managedAttachmentIdentities: Object.freeze(managedAttachmentIdentities),
    serviceGeneration: boundedString(
      attestation.serviceGeneration,
      "serviceGeneration",
      512,
    ),
    sourceProcessId: positiveInteger(
      attestation.sourceProcessId,
      "sourceProcessId",
    ),
  });
}

function proofPayload(
  challenge: string,
  attestation: ComputerServiceReplacementAttestation,
  kind: "candidate" | "live",
): string {
  return JSON.stringify({
    attestation,
    challenge,
    ...(kind === "live" ? { kind: "live-attestation" } : {}),
    protocol: COMPUTER_SERVICE_OWNERSHIP_PROOF_PROTOCOL,
  });
}

function requireMac(
  value: unknown,
  controlToken: string,
  challenge: string,
  attestation: ComputerServiceReplacementAttestation,
  kind: "candidate" | "live",
): void {
  if (typeof value !== "string" || !HEX_256.test(value)) {
    throw new Error("Computer service ownership proof authentication failed");
  }
  const expected = Buffer.from(
    createHmac("sha256", controlToken)
      .update(proofPayload(challenge, attestation, kind))
      .digest("hex"),
    "hex",
  );
  const observed = Buffer.from(value, "hex");
  if (
    observed.byteLength !== expected.byteLength ||
    !timingSafeEqual(observed, expected)
  ) {
    throw new Error("Computer service ownership proof authentication failed");
  }
}

async function assertOwnerPrivateSocket(socketPath: string): Promise<boolean> {
  let socket;
  try {
    socket = await lstat(socketPath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
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
    throw new Error("Computer service ownership socket is not owner-private");
  }
  return true;
}

function validateSocketPath(value: string): string {
  if (
    !isAbsolute(value) ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > 103
  ) {
    throw new Error("Computer service ownership socket path is invalid");
  }
  return value;
}

function token(value: string): string {
  if (!HEX_256.test(value)) {
    throw new Error("Computer service ownership control token is invalid");
  }
  return value;
}

function boundedString(value: unknown, name: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    value.includes("\0")
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
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error("Computer service ownership message shape is invalid");
  }
}

function isTransientSocketError(error: unknown): boolean {
  return ["ECONNREFUSED", "ENOENT", "ENOTSOCK", "ECONNRESET"].some((code) =>
    hasErrorCode(error, code),
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
