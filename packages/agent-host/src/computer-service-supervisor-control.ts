import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lstat } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { dirname, isAbsolute } from "node:path";

import type { Slot } from "@rah-os/k-carrier";

import type {
  ComputerServiceSupervisorControlPort,
  ComputerServiceSupervisorSnapshot,
} from "./computer-service-supervisor.ts";

export const COMPUTER_SERVICE_SUPERVISOR_CONTROL_PROTOCOL =
  "rah-computer-service-supervisor-control-v1";
const HEX_256 = /^[0-9a-f]{64}$/u;
const MAX_MESSAGE_BYTES = 16 * 1_024;

type SupervisorControlOperation =
  "start_for_handoff" | "status" | "stop_for_handoff";
type SupervisorControlRequest = Readonly<{
  challenge: string;
  expectedProcessId?: number;
  operation: SupervisorControlOperation;
  protocol: typeof COMPUTER_SERVICE_SUPERVISOR_CONTROL_PROTOCOL;
  slot?: Slot;
}>;

export type ComputerServiceSupervisorControlHandlerOptions = Readonly<{
  controlToken: string;
  requestTimeoutMs?: number;
  supervisor: ComputerServiceSupervisorControlPort &
    Readonly<{ snapshot(): ComputerServiceSupervisorSnapshot }>;
}>;

export type NodeComputerServiceSupervisorControlClientOptions = Readonly<{
  controlToken: string;
  socketPath: string;
  timeoutMs?: number;
}>;

/** Authenticated, enum-only local mutation surface for the launchd carrier. */
export function createComputerServiceSupervisorControlHandler(
  options: ComputerServiceSupervisorControlHandlerOptions,
): (socket: Socket) => void {
  const controlToken = token(options.controlToken);
  const timeoutMs = positiveInteger(
    options.requestTimeoutMs ?? 2_000,
    "requestTimeoutMs",
  );
  return (socket) => {
    socket.setTimeout(timeoutMs, () => socket.destroy());
    collectLine(socket)
      .then(async (line) => {
        if (line === null) return;
        const envelope = record(JSON.parse(line) as unknown, "request");
        exactKeys(envelope, ["mac", "request"]);
        const request = normalizeRequest(envelope.request);
        requireMac(envelope.mac, controlToken, JSON.stringify(request));
        const snapshot =
          request.operation === "status"
            ? options.supervisor.snapshot()
            : request.operation === "stop_for_handoff"
              ? await options.supervisor.stopForHandoff({
                  expectedProcessId: request.expectedProcessId!,
                })
              : await options.supervisor.startForHandoff(request.slot!);
        const response = Object.freeze({
          accepted: true as const,
          challenge: request.challenge,
          operation: request.operation,
          protocol: COMPUTER_SERVICE_SUPERVISOR_CONTROL_PROTOCOL,
          snapshot,
        });
        socket.end(
          `${JSON.stringify({
            mac: mac(controlToken, JSON.stringify(response)),
            response,
          })}\n`,
        );
      })
      .catch(() => socket.destroy());
  };
}

export class NodeComputerServiceSupervisorControlClient implements ComputerServiceSupervisorControlPort {
  readonly #controlToken: string;
  readonly #socketPath: string;
  readonly #timeoutMs: number;

  constructor(options: NodeComputerServiceSupervisorControlClientOptions) {
    this.#controlToken = token(options.controlToken);
    this.#socketPath = validateSocketPath(options.socketPath);
    this.#timeoutMs = positiveInteger(options.timeoutMs ?? 2_000, "timeoutMs");
  }

  async stopForHandoff(input: {
    expectedProcessId: number;
  }): Promise<ComputerServiceSupervisorSnapshot> {
    return await this.#request({
      expectedProcessId: positiveInteger(
        input.expectedProcessId,
        "expectedProcessId",
      ),
      operation: "stop_for_handoff",
    });
  }

  async readStatus(): Promise<ComputerServiceSupervisorSnapshot> {
    return await this.#request({ operation: "status" });
  }

  async startForHandoff(
    slot: Slot,
  ): Promise<ComputerServiceSupervisorSnapshot> {
    if (slot !== "stable" && slot !== "experiment") {
      throw new Error("Computer supervisor control slot is invalid");
    }
    return await this.#request({ operation: "start_for_handoff", slot });
  }

  async #request(
    input:
      | Readonly<{
          expectedProcessId: number;
          operation: "stop_for_handoff";
        }>
      | Readonly<{ operation: "status" }>
      | Readonly<{
          operation: "start_for_handoff";
          slot: Slot;
        }>,
  ): Promise<ComputerServiceSupervisorSnapshot> {
    if (!(await assertOwnerPrivateSocket(this.#socketPath))) {
      throw new Error("Computer supervisor control is unavailable");
    }
    const request = normalizeRequest({
      challenge: randomBytes(32).toString("hex"),
      ...input,
      protocol: COMPUTER_SERVICE_SUPERVISOR_CONTROL_PROTOCOL,
    });
    const line = await requestLine(
      this.#socketPath,
      `${JSON.stringify({
        mac: mac(this.#controlToken, JSON.stringify(request)),
        request,
      })}\n`,
      this.#timeoutMs,
    );
    if (line === null) {
      throw new Error("Computer supervisor control request was rejected");
    }
    const envelope = record(JSON.parse(line) as unknown, "response");
    exactKeys(envelope, ["mac", "response"]);
    const response = normalizeResponse(envelope.response);
    if (
      response.challenge !== request.challenge ||
      response.operation !== request.operation
    ) {
      throw new Error("Computer supervisor control response is inconsistent");
    }
    requireMac(envelope.mac, this.#controlToken, JSON.stringify(response));
    return response.snapshot;
  }
}

function normalizeRequest(value: unknown): SupervisorControlRequest {
  const request = record(value, "supervisor control request");
  const operation = operationName(request.operation);
  exactKeys(
    request,
    operation === "stop_for_handoff"
      ? ["challenge", "expectedProcessId", "operation", "protocol"]
      : operation === "start_for_handoff"
        ? ["challenge", "operation", "protocol", "slot"]
        : ["challenge", "operation", "protocol"],
  );
  if (request.protocol !== COMPUTER_SERVICE_SUPERVISOR_CONTROL_PROTOCOL) {
    throw new Error("Computer supervisor control protocol is invalid");
  }
  return Object.freeze({
    challenge: challenge(request.challenge),
    ...(operation === "stop_for_handoff"
      ? {
          expectedProcessId: positiveInteger(
            request.expectedProcessId,
            "expectedProcessId",
          ),
        }
      : operation === "start_for_handoff"
        ? { slot: slot(request.slot) }
        : {}),
    operation,
    protocol: COMPUTER_SERVICE_SUPERVISOR_CONTROL_PROTOCOL,
  });
}

function normalizeResponse(value: unknown): Readonly<{
  accepted: true;
  challenge: string;
  operation: SupervisorControlOperation;
  protocol: typeof COMPUTER_SERVICE_SUPERVISOR_CONTROL_PROTOCOL;
  snapshot: ComputerServiceSupervisorSnapshot;
}> {
  const response = record(value, "supervisor control response");
  exactKeys(response, [
    "accepted",
    "challenge",
    "operation",
    "protocol",
    "snapshot",
  ]);
  if (
    response.accepted !== true ||
    response.protocol !== COMPUTER_SERVICE_SUPERVISOR_CONTROL_PROTOCOL
  ) {
    throw new Error("Computer supervisor control response is invalid");
  }
  return Object.freeze({
    accepted: true,
    challenge: challenge(response.challenge),
    operation: operationName(response.operation),
    protocol: COMPUTER_SERVICE_SUPERVISOR_CONTROL_PROTOCOL,
    snapshot: normalizeSnapshot(response.snapshot),
  });
}

function normalizeSnapshot(value: unknown): ComputerServiceSupervisorSnapshot {
  const snapshot = record(value, "supervisor snapshot");
  if (
    snapshot.kind === "new" ||
    snapshot.kind === "closed" ||
    snapshot.kind === "handoff_waiting"
  ) {
    exactKeys(snapshot, ["kind"]);
    return Object.freeze({ kind: snapshot.kind });
  }
  if (snapshot.kind !== "running") {
    throw new Error("Computer supervisor snapshot is invalid");
  }
  exactKeys(snapshot, ["kind", "processId", "slot"]);
  return Object.freeze({
    kind: "running",
    processId: positiveInteger(snapshot.processId, "processId"),
    slot: slot(snapshot.slot),
  });
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
    throw new Error("Computer supervisor control authentication failed");
  }
  const expected = Buffer.from(mac(controlToken, payload), "hex");
  const actual = Buffer.from(value, "hex");
  if (
    expected.byteLength !== actual.byteLength ||
    !timingSafeEqual(expected, actual)
  ) {
    throw new Error("Computer supervisor control authentication failed");
  }
}

async function collectLine(socket: Socket): Promise<string | null> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (value: string | null, error?: Error) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners("data");
      socket.removeAllListeners("end");
      if (error === undefined) resolve(value);
      else reject(error);
    };
    socket.on("data", (chunk: Buffer) => {
      const newline = chunk.indexOf(0x0a);
      const accepted = newline === -1 ? chunk : chunk.subarray(0, newline);
      bytes += accepted.byteLength;
      if (bytes > MAX_MESSAGE_BYTES) {
        finish(null, new Error("Computer supervisor request is too large"));
        return;
      }
      chunks.push(accepted);
      if (newline !== -1) finish(Buffer.concat(chunks, bytes).toString("utf8"));
    });
    socket.once("end", () =>
      finish(
        null,
        bytes === 0
          ? undefined
          : new Error("Computer supervisor request ended before newline"),
      ),
    );
    socket.once("error", (error) => finish(null, error));
  });
}

async function requestLine(
  socketPath: string,
  request: string,
  timeoutMs: number,
): Promise<string | null> {
  return await new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const timer = setTimeout(() => finish(null), timeoutMs);
    const finish = (value: string | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error === undefined) resolve(value);
      else reject(error);
    };
    socket.once("connect", () => socket.write(request));
    socket.on("data", (chunk: Buffer) => {
      const newline = chunk.indexOf(0x0a);
      const accepted = newline === -1 ? chunk : chunk.subarray(0, newline);
      bytes += accepted.byteLength;
      if (bytes > MAX_MESSAGE_BYTES) {
        finish(null, new Error("Computer supervisor response is too large"));
        return;
      }
      chunks.push(accepted);
      if (newline !== -1) finish(Buffer.concat(chunks, bytes).toString("utf8"));
    });
    socket.once("end", () => finish(null));
    socket.once("error", (error) => {
      if (isTransientSocketError(error)) finish(null);
      else finish(null, error);
    });
  });
}

async function assertOwnerPrivateSocket(path: string): Promise<boolean> {
  let socket;
  try {
    socket = await lstat(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
  const directory = await lstat(dirname(path));
  const owner = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    !socket.isSocket() ||
    socket.isSymbolicLink() ||
    (socket.mode & 0o077) !== 0 ||
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (directory.mode & 0o077) !== 0 ||
    (owner !== null && (socket.uid !== owner || directory.uid !== owner))
  ) {
    throw new Error("Computer supervisor control socket is not private");
  }
  return true;
}

function validateSocketPath(value: string): string {
  if (
    !isAbsolute(value) ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > 103
  ) {
    throw new Error("Computer supervisor control socket path is invalid");
  }
  return value;
}

function operationName(value: unknown): SupervisorControlOperation {
  if (
    value !== "start_for_handoff" &&
    value !== "status" &&
    value !== "stop_for_handoff"
  ) {
    throw new Error("Computer supervisor control operation is invalid");
  }
  return value;
}

function slot(value: unknown): Slot {
  if (value !== "stable" && value !== "experiment") {
    throw new Error("Computer supervisor control slot is invalid");
  }
  return value;
}

function challenge(value: unknown): string {
  if (typeof value !== "string" || !HEX_256.test(value)) {
    throw new Error("Computer supervisor control challenge is invalid");
  }
  return value;
}

function token(value: string): string {
  if (!HEX_256.test(value)) {
    throw new Error("Computer supervisor control token is invalid");
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
    throw new Error("Computer supervisor control shape is invalid");
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
