import { spawn, type ChildProcess } from "node:child_process";
import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ActivationEnvelope,
  RunExit,
  RunHandle,
  RuntimeAdapter,
  RuntimeAvailability,
  RuntimeStartLifecycle,
} from "./runtime.ts";

export type GenericProcessAdapterOptions = {
  activationEnvironment?: (
    input: ActivationEnvelope,
  ) => ActivationEnvironmentLease;
  args?: readonly string[];
  command: string;
  completedRunRetention?: number;
  cwd: string;
  diagnosticByteLimit?: number;
  env?: Readonly<Record<string, string>>;
  supervisorControlTimeoutMs?: number;
  supervisorDirectory?: string;
  supervisorStartupTimeoutMs?: number;
  terminationGraceMs?: number;
};

export type ActivationEnvironmentLease = {
  env: Readonly<Record<string, string>>;
  release?: () => void;
};

export type ProcessDiagnostics = {
  stderr: string;
  stdout: string;
  truncated: boolean;
};

type ProcessRun = {
  child: ChildProcess;
  exitPromise: Promise<RunExit>;
  exited: boolean;
  stderr: BoundedOutput;
  stdout: BoundedOutput;
  supervisorDescriptor?: SupervisorDescriptor;
};

type SupervisorDescriptor = {
  controlToken: string;
  resultPath: string;
  runAttemptId: string;
  runtimeRunId: string;
  socketPath: string;
  supervisorId: string;
};

const SUPERVISOR_DRIVER = "rah-process-supervisor-v1";
const SUPERVISOR_ENTRY_PATH = fileURLToPath(
  new URL("./process-supervisor.mjs", import.meta.url),
);
const SUPERVISOR_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class BoundedOutput {
  readonly #byteLimit: number;
  readonly #chunks: Buffer[] = [];
  #bytes = 0;
  truncated = false;

  constructor(byteLimit: number) {
    this.#byteLimit = byteLimit;
  }

  append(chunk: Buffer | string): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const available = this.#byteLimit - this.#bytes;
    if (available <= 0) {
      this.truncated = true;
      return;
    }

    const accepted = buffer.subarray(0, available);
    this.#chunks.push(accepted);
    this.#bytes += accepted.byteLength;
    if (accepted.byteLength < buffer.byteLength) this.truncated = true;
  }

  text(): string {
    return Buffer.concat(this.#chunks, this.#bytes).toString("utf8");
  }
}

export class GenericProcessAdapter implements RuntimeAdapter {
  readonly recoveryDrivers: readonly string[] =
    process.platform === "win32" ? [] : [SUPERVISOR_DRIVER];
  readonly #activationEnvironment:
    ((input: ActivationEnvelope) => ActivationEnvironmentLease) | undefined;
  readonly #args: readonly string[];
  readonly #command: string;
  readonly #completedRunIds: string[] = [];
  readonly #completedRunRetention: number;
  readonly #cwd: string;
  readonly #diagnosticByteLimit: number;
  readonly #env: Readonly<Record<string, string>>;
  readonly #runs = new Map<string, ProcessRun>();
  readonly #supervisorControlTimeoutMs: number;
  readonly #supervisorDirectory: string;
  readonly #supervisorSocketDirectory: string;
  readonly #supervisorStartupTimeoutMs: number;
  readonly #terminationGraceMs: number;

  constructor(options: GenericProcessAdapterOptions) {
    if (options.command.length === 0) {
      throw new Error("process command must not be empty");
    }
    if (!Number.isInteger(options.diagnosticByteLimit ?? 262_144)) {
      throw new Error("diagnosticByteLimit must be an integer");
    }
    if ((options.diagnosticByteLimit ?? 262_144) <= 0) {
      throw new Error("diagnosticByteLimit must be greater than zero");
    }
    if (!Number.isInteger(options.terminationGraceMs ?? 5_000)) {
      throw new Error("terminationGraceMs must be an integer");
    }
    if ((options.terminationGraceMs ?? 5_000) < 0) {
      throw new Error("terminationGraceMs must not be negative");
    }
    if (!Number.isInteger(options.completedRunRetention ?? 100)) {
      throw new Error("completedRunRetention must be an integer");
    }
    if ((options.completedRunRetention ?? 100) < 0) {
      throw new Error("completedRunRetention must not be negative");
    }
    if (!Number.isInteger(options.supervisorStartupTimeoutMs ?? 5_000)) {
      throw new Error("supervisorStartupTimeoutMs must be an integer");
    }
    if ((options.supervisorStartupTimeoutMs ?? 5_000) <= 0) {
      throw new Error("supervisorStartupTimeoutMs must be greater than zero");
    }
    const supervisorControlTimeoutMs =
      options.supervisorControlTimeoutMs ??
      (options.terminationGraceMs ?? 5_000) + 5_000;
    if (!Number.isInteger(supervisorControlTimeoutMs)) {
      throw new Error("supervisorControlTimeoutMs must be an integer");
    }
    if (supervisorControlTimeoutMs <= 0) {
      throw new Error("supervisorControlTimeoutMs must be greater than zero");
    }

    this.#args = [...(options.args ?? [])];
    this.#activationEnvironment = options.activationEnvironment;
    this.#command = options.command;
    this.#completedRunRetention = options.completedRunRetention ?? 100;
    this.#cwd = options.cwd;
    this.#diagnosticByteLimit = options.diagnosticByteLimit ?? 262_144;
    this.#env = { ...(options.env ?? {}) };
    this.#supervisorControlTimeoutMs = supervisorControlTimeoutMs;
    this.#supervisorDirectory = resolve(
      options.supervisorDirectory ??
        (process.platform === "win32"
          ? tmpdir()
          : `/tmp/rah-os-supervisors-${String(process.getuid?.() ?? "user")}`),
    );
    this.#supervisorSocketDirectory = resolve(
      `/tmp/rah-os-control-${String(process.getuid?.() ?? "user")}`,
    );
    this.#supervisorStartupTimeoutMs =
      options.supervisorStartupTimeoutMs ?? 5_000;
    this.#terminationGraceMs = options.terminationGraceMs ?? 5_000;
  }

  async probe(): Promise<RuntimeAvailability> {
    const candidates = this.#commandCandidates();
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.X_OK);
        return { available: true };
      } catch {
        // Try the next PATH entry.
      }
    }

    return {
      available: false,
      detail: `command is not executable: ${this.#command}`,
    };
  }

  async start(
    input: ActivationEnvelope,
    lifecycle: RuntimeStartLifecycle,
  ): Promise<RunHandle> {
    if (process.platform !== "win32") {
      return await this.#startSupervised(input, lifecycle);
    }
    return await this.#startDirect(input, lifecycle);
  }

  async #startDirect(
    input: ActivationEnvelope,
    lifecycle: RuntimeStartLifecycle,
  ): Promise<RunHandle> {
    const runId = `process:${randomUUID()}`;
    const runHandle = {
      recoveryDescriptor: {
        driver: "unrecoverable-process-v1",
        metadata: {},
        recoveryKey: runId,
      },
      runId,
    };
    await lifecycle.registerPrepared(runHandle);
    const stdout = new BoundedOutput(this.#diagnosticByteLimit);
    const stderr = new BoundedOutput(this.#diagnosticByteLimit);
    const environmentLease = this.#activationEnvironment?.(input);
    let released = false;
    const releaseEnvironment = (): void => {
      if (released) return;
      released = true;
      try {
        environmentLease?.release?.();
      } catch (error) {
        stderr.append(
          `[rah-os] activation environment release failed: ${errorMessage(error)}\n`,
        );
      }
    };

    let child: ChildProcess;
    try {
      child = spawn(this.#command, this.#args, {
        cwd: this.#cwd,
        detached: process.platform !== "win32",
        env: {
          ...process.env,
          ...this.#env,
          ...environmentLease?.env,
          RAH_ACTIVATION_ID: input.activationId,
          RAH_ACTIVATION_REASON: input.reason,
          RAH_CONSUMER_ID: input.consumerId,
          RAH_FROM_SEQ: String(input.fromSeq),
          RAH_HOST_ID: input.hostId,
          RAH_PARTICIPANT_ID: input.participantId,
          RAH_ROOM_ID: input.roomId,
          RAH_RUN_ATTEMPT_ID: input.runAttemptId,
          RAH_TO_SEQ: String(input.toSeq),
        },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      releaseEnvironment();
      throw error;
    }

    child.stdout?.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.append(chunk));

    let resolveExit!: (exit: RunExit) => void;
    const exitPromise = new Promise<RunExit>((resolvePromise) => {
      resolveExit = resolvePromise;
    });
    const run: ProcessRun = {
      child,
      exitPromise,
      exited: false,
      stderr,
      stdout,
    };

    let spawned = false;
    child.once("close", (code, signal) => {
      run.exited = true;
      releaseEnvironment();
      resolveExit(signal === null ? { code } : { code, signal });
      if (spawned) this.#retainCompletedRun(runId);
    });

    this.#runs.set(runId, run);
    try {
      await new Promise<void>((resolvePromise, reject) => {
        child.once("spawn", () => {
          spawned = true;
          resolvePromise();
        });
        child.once("error", (error) => {
          if (spawned) {
            stderr.append(`[rah-os] process error: ${error.message}\n`);
          } else {
            releaseEnvironment();
            reject(error);
          }
        });
      });
    } catch (error) {
      this.#runs.delete(runId);
      throw error;
    }
    return runHandle;
  }

  async cancel(handle: RunHandle): Promise<RunExit> {
    const run = this.#run(handle);
    if (run.exited) return await run.exitPromise;

    if (run.supervisorDescriptor !== undefined) {
      const existingResult = await this.#readTerminalResult(
        run.supervisorDescriptor,
        true,
      );
      if (existingResult !== null) return existingResult;
      await this.#requestSupervisorControl(
        run.supervisorDescriptor,
        "terminate",
      );
      return await run.exitPromise;
    }

    this.#signal(run, "SIGTERM");
    if (await this.#waitForExit(run, this.#terminationGraceMs)) {
      return await run.exitPromise;
    }

    this.#signal(run, "SIGKILL");
    return await run.exitPromise;
  }

  async reap(handle: RunHandle): Promise<RunExit> {
    return await this.#run(handle).exitPromise;
  }

  async recover(
    input: Parameters<NonNullable<RuntimeAdapter["recover"]>>[0],
  ): Promise<RunExit> {
    const descriptor = this.#parseSupervisorDescriptor(
      input.recoveryDescriptor,
      input.runAttemptId,
      input.runtimeRunId,
    );
    await this.#assertSecureDirectory(this.#supervisorDirectory);
    await this.#assertSecureDirectory(this.#supervisorSocketDirectory);
    await this.#assertSecureDirectory(
      resolve(this.#supervisorDirectory, descriptor.supervisorId),
    );
    const existingResult = await this.#readTerminalResult(descriptor, true);
    if (existingResult !== null) return existingResult;

    try {
      await this.#requestSupervisorControl(descriptor, "terminate");
    } catch (error) {
      const racedResult = await this.#readTerminalResult(descriptor, true);
      if (racedResult !== null) return racedResult;
      throw error;
    }
    return await this.#readTerminalResult(descriptor, false);
  }

  diagnostics(handle: RunHandle): ProcessDiagnostics {
    const run = this.#run(handle);
    return {
      stderr: run.stderr.text(),
      stdout: run.stdout.text(),
      truncated: run.stderr.truncated || run.stdout.truncated,
    };
  }

  release(handle: RunHandle): void {
    const run = this.#run(handle);
    if (!run.exited) {
      throw new Error(`cannot release active process run: ${handle.runId}`);
    }
    this.#runs.delete(handle.runId);
    const retainedIndex = this.#completedRunIds.indexOf(handle.runId);
    if (retainedIndex >= 0) this.#completedRunIds.splice(retainedIndex, 1);
  }

  #commandCandidates(): string[] {
    if (isAbsolute(this.#command)) return [this.#command];
    if (this.#command.includes("/")) return [resolve(this.#cwd, this.#command)];

    const path = this.#env.PATH ?? process.env.PATH ?? "";
    return path
      .split(delimiter)
      .filter((entry) => entry.length > 0)
      .map((entry) => resolve(entry, this.#command));
  }

  async #ensureSecureDirectory(directory: string): Promise<void> {
    await mkdir(directory, { mode: 0o700, recursive: true });
    await this.#assertSecureDirectory(directory);
  }

  async #assertSecureDirectory(directory: string): Promise<void> {
    const stats = await lstat(directory);
    const currentUid = process.getuid?.();
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      (currentUid !== undefined && stats.uid !== currentUid) ||
      (stats.mode & 0o077) !== 0
    ) {
      throw new Error(
        `process supervisor directory is not private and owner-controlled: ${directory}`,
      );
    }
  }

  async #startSupervised(
    input: ActivationEnvelope,
    lifecycle: RuntimeStartLifecycle,
  ): Promise<RunHandle> {
    await this.#ensureSecureDirectory(this.#supervisorDirectory);
    await this.#ensureSecureDirectory(this.#supervisorSocketDirectory);
    const supervisorId = randomUUID();
    const runId = `process:${randomUUID()}`;
    const runDirectory = resolve(this.#supervisorDirectory, supervisorId);
    await mkdir(runDirectory, { mode: 0o700 });
    const descriptor: SupervisorDescriptor = {
      controlToken: randomBytes(32).toString("hex"),
      resultPath: resolve(runDirectory, "result.json"),
      runAttemptId: input.runAttemptId,
      runtimeRunId: runId,
      socketPath: resolve(
        this.#supervisorSocketDirectory,
        `${supervisorId}.sock`,
      ),
      supervisorId,
    };
    const stdout = new BoundedOutput(this.#diagnosticByteLimit);
    const stderr = new BoundedOutput(this.#diagnosticByteLimit);
    const environmentLease = this.#activationEnvironment?.(input);
    let released = false;
    const releaseEnvironment = (): void => {
      if (released) return;
      released = true;
      try {
        environmentLease?.release?.();
      } catch (error) {
        stderr.append(
          `[rah-os] activation environment release failed: ${errorMessage(error)}\n`,
        );
      }
    };
    const supervisorConfig = {
      args: this.#args,
      command: this.#command,
      controlRequestTimeoutMs: this.#supervisorControlTimeoutMs,
      cwd: this.#cwd,
      resultPath: descriptor.resultPath,
      runAttemptId: input.runAttemptId,
      runtimeRunId: runId,
      socketPath: descriptor.socketPath,
      startupTimeoutMs: this.#supervisorStartupTimeoutMs,
      supervisorId,
      terminationGraceMs: this.#terminationGraceMs,
    };

    let child: ChildProcess;
    try {
      child = spawn(process.execPath, [SUPERVISOR_ENTRY_PATH], {
        cwd: this.#cwd,
        detached: true,
        env: {
          ...process.env,
          ...this.#env,
          ...environmentLease?.env,
          RAH_ACTIVATION_ID: input.activationId,
          RAH_ACTIVATION_REASON: input.reason,
          RAH_CONSUMER_ID: input.consumerId,
          RAH_FROM_SEQ: String(input.fromSeq),
          RAH_HOST_ID: input.hostId,
          RAH_PARTICIPANT_ID: input.participantId,
          RAH_PROCESS_SUPERVISOR_CONFIG: JSON.stringify(supervisorConfig),
          RAH_PROCESS_SUPERVISOR_TOKEN: descriptor.controlToken,
          RAH_ROOM_ID: input.roomId,
          RAH_RUN_ATTEMPT_ID: input.runAttemptId,
          RAH_TO_SEQ: String(input.toSeq),
        },
        shell: false,
        stdio: ["ignore", "pipe", "pipe", "pipe"],
      });
    } catch (error) {
      releaseEnvironment();
      await rm(runDirectory, { force: true, recursive: true });
      throw error;
    }

    child.stdout?.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.append(chunk));

    let resolveExit!: (exit: RunExit) => void;
    let rejectExit!: (error: unknown) => void;
    const exitPromise = new Promise<RunExit>(
      (resolvePromise, rejectPromise) => {
        resolveExit = resolvePromise;
        rejectExit = rejectPromise;
      },
    );
    void exitPromise.catch(() => undefined);
    const run: ProcessRun = {
      child,
      exitPromise,
      exited: false,
      stderr,
      stdout,
      supervisorDescriptor: descriptor,
    };
    let durablePrepared = false;
    child.once("close", async () => {
      run.exited = true;
      releaseEnvironment();
      try {
        resolveExit(await this.#readTerminalResult(descriptor, false));
      } catch (error) {
        rejectExit(error);
      }
      if (durablePrepared) this.#retainCompletedRun(runId);
    });
    this.#runs.set(runId, run);

    const recoveryDescriptor = {
      driver: SUPERVISOR_DRIVER,
      metadata: { controlToken: descriptor.controlToken },
      recoveryKey: supervisorId,
    };
    try {
      const readiness = child.stdio[3] as NodeJS.ReadableStream | null;
      await this.#waitForSupervisorReady(child, readiness, supervisorId);
      const runHandle = { recoveryDescriptor, runId };
      await lifecycle.registerPrepared(runHandle);
      durablePrepared = true;
      await this.#requestSupervisorControl(descriptor, "launch");
      return runHandle;
    } catch (error) {
      if (!durablePrepared) {
        this.#runs.delete(runId);
        await this.#requestSupervisorControl(descriptor, "terminate").catch(
          () => child.kill("SIGKILL"),
        );
        releaseEnvironment();
        await rm(runDirectory, { force: true, recursive: true });
      } else {
        stderr.append(
          `[rah-os] prepared runtime launch failed: ${errorMessage(error)}\n`,
        );
        await this.#requestSupervisorControl(descriptor, "terminate").catch(
          () => undefined,
        );
        await exitPromise.catch(() => undefined);
      }
      throw error;
    }
  }

  async #waitForSupervisorReady(
    child: ChildProcess,
    readiness: NodeJS.ReadableStream | null,
    supervisorId: string,
  ): Promise<void> {
    if (readiness === null) {
      throw new Error("process supervisor readiness channel is unavailable");
    }
    await new Promise<void>((resolvePromise, reject) => {
      let settled = false;
      let response = "";
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener("error", onError);
        readiness.removeListener("data", onData);
        readiness.removeListener("end", onEnd);
        if (error) reject(error);
        else resolvePromise();
      };
      const onError = (error: Error): void => finish(error);
      const onEnd = (): void => {
        if (!settled) {
          finish(new Error("process supervisor closed before ready"));
        }
      };
      const onData = (chunk: Buffer | string): void => {
        response += chunk.toString();
        if (Buffer.byteLength(response) > 8_192) {
          finish(
            new Error("process supervisor readiness response is too large"),
          );
          return;
        }
        const newline = response.indexOf("\n");
        if (newline < 0) return;
        try {
          const ready = JSON.parse(response.slice(0, newline)) as {
            error?: unknown;
            status?: unknown;
            supervisorId?: unknown;
          };
          if (
            ready.status !== "prepared" ||
            ready.supervisorId !== supervisorId
          ) {
            finish(
              new Error(
                typeof ready.error === "string"
                  ? ready.error
                  : "invalid process supervisor readiness response",
              ),
            );
            return;
          }
          finish();
        } catch (error) {
          finish(
            new Error(
              `invalid process supervisor readiness response: ${errorMessage(error)}`,
            ),
          );
        }
      };
      const timer = setTimeout(
        () => finish(new Error("process supervisor startup timed out")),
        this.#supervisorStartupTimeoutMs,
      );
      child.once("error", onError);
      readiness.on("data", onData);
      readiness.once("end", onEnd);
    });
  }

  #parseSupervisorDescriptor(
    recoveryDescriptor: NonNullable<RunHandle["recoveryDescriptor"]>,
    runAttemptId: string,
    runtimeRunId: string,
  ): SupervisorDescriptor {
    if (recoveryDescriptor.driver !== SUPERVISOR_DRIVER) {
      throw new Error(
        `unsupported process recovery driver: ${recoveryDescriptor.driver}`,
      );
    }
    const supervisorId = recoveryDescriptor.recoveryKey;
    if (!SUPERVISOR_ID_PATTERN.test(supervisorId)) {
      throw new Error("invalid process supervisor recovery key");
    }
    const metadataKeys = Object.keys(recoveryDescriptor.metadata);
    const controlToken = recoveryDescriptor.metadata.controlToken;
    if (
      metadataKeys.length !== 1 ||
      metadataKeys[0] !== "controlToken" ||
      typeof controlToken !== "string" ||
      !/^[0-9a-f]{64}$/.test(controlToken)
    ) {
      throw new Error("invalid process supervisor recovery metadata");
    }
    const runDirectory = resolve(this.#supervisorDirectory, supervisorId);
    return {
      controlToken,
      resultPath: resolve(runDirectory, "result.json"),
      runAttemptId,
      runtimeRunId,
      socketPath: resolve(
        this.#supervisorSocketDirectory,
        `${supervisorId}.sock`,
      ),
      supervisorId,
    };
  }

  async #requestSupervisorControl(
    descriptor: SupervisorDescriptor,
    command: "launch" | "terminate",
  ): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
      const socket = createConnection(descriptor.socketPath);
      let response = "";
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolvePromise();
      };
      socket.setEncoding("utf8");
      socket.setTimeout(this.#supervisorControlTimeoutMs, () => {
        finish(new Error("process supervisor control request timed out"));
      });
      socket.once("error", (error) => finish(error));
      socket.once("close", () => {
        finish(new Error("process supervisor closed without a response"));
      });
      socket.on("data", (chunk) => {
        response += chunk;
        if (Buffer.byteLength(response) > 8_192) {
          finish(new Error("process supervisor control response is too large"));
          return;
        }
        const newline = response.indexOf("\n");
        if (newline < 0) return;
        try {
          const result = JSON.parse(response.slice(0, newline)) as {
            error?: unknown;
            ok?: unknown;
          };
          if (result.ok !== true) {
            finish(
              new Error(
                typeof result.error === "string"
                  ? result.error
                  : "process supervisor rejected control request",
              ),
            );
            return;
          }
          finish();
        } catch (error) {
          finish(
            new Error(
              `invalid process supervisor control response: ${errorMessage(error)}`,
            ),
          );
        }
      });
      socket.once("connect", () => {
        socket.write(
          `${JSON.stringify({
            command,
            controlToken: descriptor.controlToken,
            protocol: SUPERVISOR_DRIVER,
            runAttemptId: descriptor.runAttemptId,
            runtimeRunId: descriptor.runtimeRunId,
            supervisorId: descriptor.supervisorId,
          })}\n`,
        );
      });
    });
  }

  async #readTerminalResult(
    descriptor: SupervisorDescriptor,
    allowMissing: false,
  ): Promise<RunExit>;
  async #readTerminalResult(
    descriptor: SupervisorDescriptor,
    allowMissing: true,
  ): Promise<RunExit | null>;
  async #readTerminalResult(
    descriptor: SupervisorDescriptor,
    allowMissing: boolean,
  ): Promise<RunExit | null> {
    let contents: string;
    try {
      contents = await readFile(descriptor.resultPath, "utf8");
    } catch (error) {
      if (
        allowMissing &&
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
    let result: unknown;
    try {
      result = JSON.parse(contents);
    } catch (error) {
      throw new Error(
        `invalid process supervisor terminal result: ${errorMessage(error)}`,
      );
    }
    if (!isRecord(result) || !isRecord(result.payload)) {
      throw new Error("invalid process supervisor terminal result");
    }
    const payload = result.payload;
    const exit = payload.exit;
    if (
      typeof result.mac !== "string" ||
      payload.protocol !== SUPERVISOR_DRIVER ||
      payload.runAttemptId !== descriptor.runAttemptId ||
      payload.runtimeRunId !== descriptor.runtimeRunId ||
      payload.supervisorId !== descriptor.supervisorId ||
      !isRunExit(exit)
    ) {
      throw new Error("invalid process supervisor terminal result");
    }
    const expectedMac = createHmac("sha256", descriptor.controlToken)
      .update(JSON.stringify(payload))
      .digest("hex");
    const expected = Buffer.from(expectedMac, "utf8");
    const actual = Buffer.from(result.mac, "utf8");
    if (
      expected.byteLength !== actual.byteLength ||
      !timingSafeEqual(expected, actual)
    ) {
      throw new Error("supervisor identity authentication failed");
    }
    return exit;
  }

  #run(handle: RunHandle): ProcessRun {
    const run = this.#runs.get(handle.runId);
    if (!run) throw new Error(`unknown process run: ${handle.runId}`);
    return run;
  }

  #retainCompletedRun(runId: string): void {
    this.#completedRunIds.push(runId);
    while (this.#completedRunIds.length > this.#completedRunRetention) {
      const evictedRunId = this.#completedRunIds.shift();
      if (evictedRunId !== undefined) this.#runs.delete(evictedRunId);
    }
  }

  #signal(run: ProcessRun, signal: NodeJS.Signals): void {
    const pid = run.child.pid;
    if (pid === undefined || pid <= 0) {
      throw new Error("cannot signal a process without a valid pid");
    }

    try {
      if (process.platform === "win32") {
        run.child.kill(signal);
      } else {
        process.kill(-pid, signal);
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") {
        return;
      }
      throw error;
    }
  }

  async #waitForExit(run: ProcessRun, durationMs: number): Promise<boolean> {
    if (run.exited) return true;

    return await new Promise<boolean>((resolvePromise) => {
      const timer = setTimeout(() => resolvePromise(false), durationMs);
      run.exitPromise.then(() => {
        clearTimeout(timer);
        resolvePromise(true);
      });
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRunExit(value: unknown): value is RunExit {
  if (!isRecord(value)) return false;
  if (!(value.code === null || Number.isInteger(value.code))) return false;
  if (!(value.signal === undefined || typeof value.signal === "string")) {
    return false;
  }
  return Object.keys(value).every((key) => key === "code" || key === "signal");
}
