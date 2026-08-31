import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rm, type FileHandle } from "node:fs/promises";
import { createConnection } from "node:net";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RESIDENT_RUNNER_CONTROL_PROTOCOL,
  type ResidentRunnerControlDescriptor,
  type ResidentRunnerExitObservation,
} from "./resident-runner-policy.ts";
import type {
  ResidentRunnerProcessEvent,
  ResidentRunnerProcessHandle,
  ResidentRunnerProcessLauncher,
  ResidentRunnerRecoveryProbe,
  ResidentRunnerRecoveryResult,
} from "./resident-runner-supervisor.ts";

const CONFIG_ENV = "RAH_RESIDENT_RUNNER_CONFIG";
const TOKEN_ENV = "RAH_RESIDENT_RUNNER_TOKEN";
const MAX_ARGUMENT_BYTES = 64 * 1_024;
const MAX_ENVIRONMENT_BYTES = 256 * 1_024;
const MAX_RESPONSE_BYTES = 8 * 1_024;
const MAX_UNIX_SOCKET_PATH_BYTES = 100;
const ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const WRAPPER_ENTRY_PATH = fileURLToPath(
  new URL("./resident-runner-process.mjs", import.meta.url),
);

type ControlCommand = "inspect" | "launch" | "stop";
type ControlResponse = Record<string, unknown>;

export type NodeResidentRunnerControlPlaneOptions = {
  args: readonly string[];
  command: string;
  controlDirectory: string;
  controlRequestTimeoutMs?: number;
  cwd: string;
  env: Readonly<Record<string, string>>;
  launchTimeoutMs?: number;
  pollIntervalMs?: number;
  socketDirectory: string;
  terminationGraceMs?: number;
};

/**
 * POSIX resident-runner process boundary. A detached wrapper first exposes an
 * authenticated owner-private control socket without launching the target.
 * The caller may durably register that capability before `launch()` creates
 * the runner. The same control plane is the restart recovery probe.
 */
export class NodeResidentRunnerControlPlane
  implements ResidentRunnerProcessLauncher, ResidentRunnerRecoveryProbe
{
  readonly #args: readonly string[];
  readonly #command: string;
  readonly #controlDirectory: string;
  readonly #controlRequestTimeoutMs: number;
  readonly #cwd: string;
  readonly #env: Readonly<Record<string, string>>;
  readonly #launchTimeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #socketDirectory: string;
  readonly #terminationGraceMs: number;

  constructor(options: NodeResidentRunnerControlPlaneOptions) {
    if (process.platform === "win32") {
      throw new Error("resident runner control sockets require POSIX");
    }
    this.#command = requireAbsolutePath(options.command, "command");
    this.#cwd = requireAbsolutePath(options.cwd, "cwd");
    this.#controlDirectory = requireAbsolutePath(
      options.controlDirectory,
      "controlDirectory",
    );
    this.#socketDirectory = requireAbsolutePath(
      options.socketDirectory,
      "socketDirectory",
    );
    this.#args = validateArguments(options.args);
    this.#env = validateEnvironment(options.env);
    this.#controlRequestTimeoutMs = positiveInteger(
      options.controlRequestTimeoutMs ?? 2_000,
      "controlRequestTimeoutMs",
    );
    this.#launchTimeoutMs = positiveInteger(
      options.launchTimeoutMs ?? 10_000,
      "launchTimeoutMs",
    );
    this.#pollIntervalMs = positiveInteger(
      options.pollIntervalMs ?? 25,
      "pollIntervalMs",
    );
    this.#terminationGraceMs = positiveInteger(
      options.terminationGraceMs ?? 2_000,
      "terminationGraceMs",
    );
  }

  async prepare(input: {
    processControl: ResidentRunnerControlDescriptor;
    processGeneration: number;
  }): Promise<ResidentRunnerProcessHandle> {
    validateControlDescriptor(input.processControl);
    validateGeneration(input.processGeneration);
    await ensureOwnerPrivateDirectory(this.#controlDirectory);
    await ensureOwnerPrivateDirectory(this.#socketDirectory);
    const paths = this.#paths(input.processControl);
    await mkdir(paths.instanceDirectory, { mode: 0o700 });
    await assertOwnerPrivateDirectory(paths.instanceDirectory);

    const config = {
      args: this.#args,
      command: this.#command,
      controlRequestTimeoutMs: this.#controlRequestTimeoutMs,
      cwd: this.#cwd,
      instanceId: input.processControl.instanceId,
      launchTimeoutMs: this.#launchTimeoutMs,
      processGeneration: input.processGeneration,
      protocol: RESIDENT_RUNNER_CONTROL_PROTOCOL,
      resultPath: paths.resultPath,
      socketPath: paths.socketPath,
      targetEnv: this.#env,
      terminationGraceMs: this.#terminationGraceMs,
    };
    let child: ChildProcess | undefined;
    try {
      child = spawn(process.execPath, [WRAPPER_ENTRY_PATH], {
        cwd: this.#cwd,
        detached: true,
        env: {
          [CONFIG_ENV]: JSON.stringify(config),
          [TOKEN_ENV]: input.processControl.controlToken,
        },
        shell: false,
        stdio: ["ignore", "ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      const ready = await waitForWrapperReady(
        child,
        input.processControl,
        input.processGeneration,
        this.#launchTimeoutMs,
      );
      if (child.pid !== ready.processId) {
        throw new Error("resident wrapper readiness PID is inconsistent");
      }
      child.unref();
      return this.#handle(
        input.processControl,
        input.processGeneration,
        ready.processId,
        child,
      );
    } catch (error) {
      child?.kill("SIGKILL");
      await rm(paths.instanceDirectory, { force: true, recursive: true });
      throw error;
    }
  }

  async inspect(input: {
    processControl: ResidentRunnerControlDescriptor | undefined;
    processGeneration: number;
    processId: number | undefined;
  }): Promise<ResidentRunnerRecoveryResult> {
    validateGeneration(input.processGeneration);
    if (input.processControl === undefined) {
      if (input.processId !== undefined) {
        throw new Error(
          "legacy resident runner PID has no authenticated control capability",
        );
      }
      return { resolution: "absent" };
    }
    validateControlDescriptor(input.processControl);
    await assertOwnerPrivateDirectory(this.#controlDirectory);
    await assertOwnerPrivateDirectory(this.#socketDirectory);
    const paths = this.#paths(input.processControl);
    await assertOwnerPrivateDirectory(paths.instanceDirectory);
    const terminal = await readTerminalResult(
      paths.resultPath,
      input.processControl,
      input.processGeneration,
      true,
    );
    if (terminal !== null) {
      return { observation: terminal, resolution: "exited" };
    }

    let response: ControlResponse;
    try {
      await assertOwnerPrivateSocket(paths.socketPath);
      response = await requestControl(
        paths.socketPath,
        input.processControl,
        input.processGeneration,
        "inspect",
        this.#controlRequestTimeoutMs,
      );
    } catch (error) {
      const replay = await readTerminalResult(
        paths.resultPath,
        input.processControl,
        input.processGeneration,
        true,
      );
      if (replay !== null) {
        return { observation: replay, resolution: "exited" };
      }
      throw new Error(
        `resident runner control is unavailable without terminal proof: ${errorMessage(error)}`,
      );
    }
    const processId = positiveInteger(response.processId, "processId");
    if (input.processId !== undefined && processId !== input.processId) {
      throw new Error(
        "resident runner control PID does not match durable state",
      );
    }
    if (response.status === "terminal") {
      const replay = await readTerminalResult(
        paths.resultPath,
        input.processControl,
        input.processGeneration,
        false,
      );
      return { observation: replay, resolution: "exited" };
    }
    if (
      response.status !== "prepared" &&
      response.status !== "launching" &&
      response.status !== "starting" &&
      response.status !== "running"
    ) {
      throw new Error("resident runner control returned an invalid status");
    }
    const handle = this.#handle(
      input.processControl,
      input.processGeneration,
      processId,
    );
    return {
      handle,
      resolution: response.status === "running" ? "connected" : "prepared",
    };
  }

  #handle(
    processControl: ResidentRunnerControlDescriptor,
    processGeneration: number,
    processId: number,
    child?: ChildProcess,
  ): ResidentRunnerProcessHandle {
    const paths = this.#paths(processControl);
    return new NodeResidentRunnerProcessHandle({
      ...(child === undefined ? {} : { child }),
      controlRequestTimeoutMs: this.#controlRequestTimeoutMs,
      pollIntervalMs: this.#pollIntervalMs,
      processControl,
      processGeneration,
      processId,
      resultPath: paths.resultPath,
      socketPath: paths.socketPath,
    });
  }

  #paths(processControl: ResidentRunnerControlDescriptor): {
    instanceDirectory: string;
    resultPath: string;
    socketPath: string;
  } {
    const instanceDirectory = join(
      this.#controlDirectory,
      processControl.instanceId,
    );
    const socketPath = join(
      this.#socketDirectory,
      `${processControl.instanceId}.sock`,
    );
    if (Buffer.byteLength(socketPath, "utf8") > MAX_UNIX_SOCKET_PATH_BYTES) {
      throw new Error(
        "resident runner control socket path exceeds the portable POSIX limit",
      );
    }
    return {
      instanceDirectory,
      resultPath: join(instanceDirectory, "terminal.json"),
      socketPath,
    };
  }
}

type ProcessHandleOptions = {
  child?: ChildProcess;
  controlRequestTimeoutMs: number;
  pollIntervalMs: number;
  processControl: ResidentRunnerControlDescriptor;
  processGeneration: number;
  processId: number;
  resultPath: string;
  socketPath: string;
};

class NodeResidentRunnerProcessHandle implements ResidentRunnerProcessHandle {
  readonly processControl: ResidentRunnerControlDescriptor;
  readonly processGeneration: number;
  readonly processId: number;
  readonly #child: ChildProcess | undefined;
  readonly #controlRequestTimeoutMs: number;
  readonly #listeners = new Set<(event: ResidentRunnerProcessEvent) => void>();
  readonly #pollIntervalMs: number;
  readonly #resultPath: string;
  readonly #socketPath: string;
  #connected = false;
  #controlFailure: Error | undefined;
  #exit: ResidentRunnerExitObservation | undefined;
  #polling = false;
  #timer: NodeJS.Timeout | undefined;

  constructor(options: ProcessHandleOptions) {
    this.#child = options.child;
    this.#controlRequestTimeoutMs = options.controlRequestTimeoutMs;
    this.#pollIntervalMs = options.pollIntervalMs;
    this.processControl = options.processControl;
    this.processGeneration = options.processGeneration;
    this.processId = options.processId;
    this.#resultPath = options.resultPath;
    this.#socketPath = options.socketPath;
    this.#child?.once("close", () => {
      void this.#poll().catch((error: unknown) =>
        this.#recordControlFailure(error),
      );
    });
  }

  async launch(): Promise<void> {
    await requestControl(
      this.#socketPath,
      this.processControl,
      this.processGeneration,
      "launch",
      this.#controlRequestTimeoutMs,
    );
    this.#schedulePoll(0);
  }

  async stop(): Promise<void> {
    if (this.#exit !== undefined) return;
    await requestControl(
      this.#socketPath,
      this.processControl,
      this.processGeneration,
      "stop",
      this.#controlRequestTimeoutMs,
    );
    this.#schedulePoll(0);
  }

  subscribe(listener: (event: ResidentRunnerProcessEvent) => void): () => void {
    this.#listeners.add(listener);
    if (this.#exit !== undefined) {
      listener({ kind: "exited", observation: this.#exit });
    } else if (this.#connected) {
      listener({ kind: "connected" });
    } else {
      this.#schedulePoll(0);
    }
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0 && this.#timer !== undefined) {
        clearTimeout(this.#timer);
        this.#timer = undefined;
      }
    };
  }

  #emit(event: ResidentRunnerProcessEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  #schedulePoll(delay = this.#pollIntervalMs): void {
    if (
      this.#exit !== undefined ||
      this.#controlFailure !== undefined ||
      this.#polling ||
      this.#timer !== undefined ||
      this.#listeners.size === 0
    ) {
      return;
    }
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#poll().catch((error: unknown) =>
        this.#recordControlFailure(error),
      );
    }, delay);
    this.#timer.unref();
  }

  async #poll(): Promise<void> {
    if (this.#exit !== undefined || this.#polling) return;
    this.#polling = true;
    try {
      const terminal = await readTerminalResult(
        this.#resultPath,
        this.processControl,
        this.processGeneration,
        true,
      );
      if (terminal !== null) {
        this.#recordExit(terminal);
        return;
      }
      try {
        const response = await requestControl(
          this.#socketPath,
          this.processControl,
          this.processGeneration,
          "inspect",
          this.#controlRequestTimeoutMs,
        );
        if (response.status === "running" && !this.#connected) {
          this.#connected = true;
          this.#emit({ kind: "connected" });
        }
      } catch {
        const replay = await readTerminalResult(
          this.#resultPath,
          this.processControl,
          this.processGeneration,
          true,
        );
        if (replay !== null) {
          this.#recordExit(replay);
          return;
        }
      }
    } finally {
      this.#polling = false;
      this.#schedulePoll();
    }
  }

  #recordExit(observation: ResidentRunnerExitObservation): void {
    if (this.#exit !== undefined) return;
    this.#exit = observation;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#emit({ kind: "exited", observation });
  }

  #recordControlFailure(error: unknown): void {
    if (this.#controlFailure !== undefined || this.#exit !== undefined) return;
    this.#controlFailure =
      error instanceof Error ? error : new Error(String(error));
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#emit({
      kind: "control_failed",
      message: this.#controlFailure.message,
    });
  }
}

async function requestControl(
  socketPath: string,
  processControl: ResidentRunnerControlDescriptor,
  processGeneration: number,
  command: ControlCommand,
  timeoutMs: number,
): Promise<ControlResponse> {
  return new Promise((resolvePromise, reject) => {
    const socket = createConnection(socketPath);
    let response = "";
    let settled = false;
    const finish = (error?: Error, value?: ControlResponse): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error !== undefined) reject(error);
      else resolvePromise(value ?? {});
    };
    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs, () =>
      finish(new Error("resident runner control request timed out")),
    );
    socket.once("error", (error) => finish(error));
    socket.once("close", () =>
      finish(new Error("resident runner control closed without a response")),
    );
    socket.on("data", (chunk) => {
      response += chunk;
      if (Buffer.byteLength(response) > MAX_RESPONSE_BYTES) {
        finish(new Error("resident runner control response is too large"));
        return;
      }
      const newline = response.indexOf("\n");
      if (newline < 0) return;
      let result: unknown;
      try {
        result = JSON.parse(response.slice(0, newline));
      } catch {
        finish(new Error("resident runner control response is invalid JSON"));
        return;
      }
      if (!isRecord(result) || result.ok !== true) {
        finish(
          new Error(
            isRecord(result) && typeof result.error === "string"
              ? result.error
              : "resident runner control request was rejected",
          ),
        );
        return;
      }
      finish(undefined, result);
    });
    socket.once("connect", () => {
      socket.write(
        `${JSON.stringify({
          command,
          controlToken: processControl.controlToken,
          instanceId: processControl.instanceId,
          processGeneration,
          protocol: processControl.protocol,
        })}\n`,
      );
    });
  });
}

async function readTerminalResult(
  resultPath: string,
  processControl: ResidentRunnerControlDescriptor,
  processGeneration: number,
  allowMissing: false,
): Promise<ResidentRunnerExitObservation>;
async function readTerminalResult(
  resultPath: string,
  processControl: ResidentRunnerControlDescriptor,
  processGeneration: number,
  allowMissing: true,
): Promise<ResidentRunnerExitObservation | null>;
async function readTerminalResult(
  resultPath: string,
  processControl: ResidentRunnerControlDescriptor,
  processGeneration: number,
  allowMissing: boolean,
): Promise<ResidentRunnerExitObservation | null> {
  let handle: FileHandle | undefined;
  try {
    await rejectSymbolicLink(resultPath);
    handle = await open(resultPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    requireOwnerPrivateFile(metadata, resultPath);
    const contents = await handle.readFile("utf8");
    if (Buffer.byteLength(contents) > MAX_RESPONSE_BYTES) {
      throw new Error("resident runner terminal result is too large");
    }
    const result: unknown = JSON.parse(contents);
    if (
      !isRecord(result) ||
      !hasExactKeys(result, ["mac", "payload"]) ||
      !isRecord(result.payload) ||
      !hasExactKeys(result.payload, [
        "instanceId",
        "observation",
        "processGeneration",
        "protocol",
      ])
    ) {
      throw new Error("resident runner terminal result is invalid");
    }
    const payload = result.payload;
    const observation = parseObservation(payload.observation);
    if (
      payload.protocol !== RESIDENT_RUNNER_CONTROL_PROTOCOL ||
      payload.instanceId !== processControl.instanceId ||
      payload.processGeneration !== processGeneration ||
      typeof result.mac !== "string"
    ) {
      throw new Error("resident runner terminal result identity is invalid");
    }
    const expectedMac = createHmac("sha256", processControl.controlToken)
      .update(JSON.stringify(payload))
      .digest("hex");
    const expected = Buffer.from(expectedMac, "utf8");
    const actual = Buffer.from(result.mac, "utf8");
    if (
      expected.byteLength !== actual.byteLength ||
      !timingSafeEqual(expected, actual)
    ) {
      throw new Error("resident runner terminal authentication failed");
    }
    return observation;
  } catch (error) {
    if (allowMissing && hasErrorCode(error, "ENOENT")) return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

async function waitForWrapperReady(
  child: ChildProcess,
  processControl: ResidentRunnerControlDescriptor,
  processGeneration: number,
  timeoutMs: number,
): Promise<{ processId: number }> {
  const readiness = child.stdio[3] as NodeJS.ReadableStream | null | undefined;
  if (readiness === null || readiness === undefined) {
    throw new Error("resident wrapper readiness channel is unavailable");
  }
  return new Promise((resolvePromise, reject) => {
    let response = "";
    let settled = false;
    const finish = (error?: Error, processId?: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("error", onError);
      readiness.off("data", onData);
      readiness.off("end", onEnd);
      if (error !== undefined) reject(error);
      else resolvePromise({ processId: processId! });
    };
    const onError = (error: Error): void => finish(error);
    const onEnd = (): void =>
      finish(new Error("resident wrapper closed before readiness"));
    const onData = (chunk: Buffer | string): void => {
      response += chunk.toString();
      if (Buffer.byteLength(response) > MAX_RESPONSE_BYTES) {
        finish(new Error("resident wrapper readiness is too large"));
        return;
      }
      const newline = response.indexOf("\n");
      if (newline < 0) return;
      try {
        const ready: unknown = JSON.parse(response.slice(0, newline));
        if (
          !isRecord(ready) ||
          ready.status !== "prepared" ||
          ready.instanceId !== processControl.instanceId ||
          ready.processGeneration !== processGeneration
        ) {
          finish(
            new Error(
              isRecord(ready) && typeof ready.error === "string"
                ? ready.error
                : "resident wrapper readiness identity is invalid",
            ),
          );
          return;
        }
        finish(undefined, positiveInteger(ready.processId, "processId"));
      } catch (error) {
        finish(
          new Error(
            `resident wrapper readiness is invalid: ${errorMessage(error)}`,
          ),
        );
      }
    };
    const timer = setTimeout(
      () => finish(new Error("resident wrapper startup timed out")),
      timeoutMs,
    );
    child.once("error", onError);
    readiness.on("data", onData);
    readiness.once("end", onEnd);
  });
}

async function ensureOwnerPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  await assertOwnerPrivateDirectory(path);
}

async function assertOwnerPrivateDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (Number(metadata.mode) & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(`resident runner directory is not owner-private: ${path}`);
  }
}

async function assertOwnerPrivateSocket(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isSocket() ||
    metadata.isSymbolicLink() ||
    (Number(metadata.mode) & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(
      `resident runner control socket is not owner-private: ${path}`,
    );
  }
}

async function rejectSymbolicLink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new Error("resident runner terminal result must not be a symlink");
    }
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return;
    throw error;
  }
}

function requireOwnerPrivateFile(
  metadata: Awaited<ReturnType<FileHandle["stat"]>>,
  path: string,
): void {
  if (
    !metadata.isFile() ||
    (Number(metadata.mode) & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(
      `resident runner terminal result is not owner-private: ${path}`,
    );
  }
}

function parseObservation(value: unknown): ResidentRunnerExitObservation {
  if (!isRecord(value)) throw new Error("terminal observation is invalid");
  const allowed = new Set(["code", "reason", "signal"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("terminal observation has unexpected fields");
  }
  if (
    value.code !== null &&
    (!Number.isSafeInteger(value.code) || (value.code as number) < 0)
  ) {
    throw new Error("terminal observation code is invalid");
  }
  if (value.signal !== null && typeof value.signal !== "string") {
    throw new Error("terminal observation signal is invalid");
  }
  if (
    value.reason !== undefined &&
    value.reason !== "configuration" &&
    value.reason !== "attachment_revoked"
  ) {
    throw new Error("terminal observation reason is invalid");
  }
  return {
    code: value.code as number | null,
    ...(value.reason === undefined
      ? {}
      : { reason: value.reason as "configuration" | "attachment_revoked" }),
    signal: value.signal as string | null,
  };
}

function validateControlDescriptor(
  value: ResidentRunnerControlDescriptor,
): void {
  if (
    value.protocol !== RESIDENT_RUNNER_CONTROL_PROTOCOL ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value.instanceId,
    ) ||
    !/^[0-9a-f]{64}$/u.test(value.controlToken)
  ) {
    throw new Error("resident runner control descriptor is invalid");
  }
}

function validateGeneration(value: number): void {
  positiveInteger(value, "processGeneration");
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value as number;
}

function requireAbsolutePath(value: string, name: string): string {
  if (!isAbsolute(value) || value.includes("\0")) {
    throw new Error(`${name} must be an absolute path without NUL`);
  }
  return resolve(value);
}

function validateArguments(values: readonly string[]): readonly string[] {
  let bytes = 0;
  const result = values.map((value) => {
    if (typeof value !== "string" || value.includes("\0")) {
      throw new Error("resident runner arguments must be strings without NUL");
    }
    bytes += Buffer.byteLength(value, "utf8");
    return value;
  });
  if (bytes > MAX_ARGUMENT_BYTES) {
    throw new Error("resident runner arguments exceed 64 KiB");
  }
  return Object.freeze(result);
}

function validateEnvironment(
  values: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (
    CONFIG_ENV in values ||
    TOKEN_ENV in values ||
    "NODE_CHANNEL_FD" in values ||
    "RAH_RESIDENT_PROCESS_GENERATION" in values
  ) {
    throw new Error("resident runner environment contains a reserved key");
  }
  let bytes = 0;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!ENVIRONMENT_KEY.test(key) || value.includes("\0")) {
      throw new Error("resident runner environment is invalid");
    }
    bytes += Buffer.byteLength(key, "utf8") + Buffer.byteLength(value, "utf8");
    result[key] = value;
  }
  if (bytes > MAX_ENVIRONMENT_BYTES) {
    throw new Error("resident runner environment exceeds 256 KiB");
  }
  return Object.freeze(result);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
