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
import { StringDecoder } from "node:string_decoder";
import { isSea } from "node:sea";
import { fileURLToPath } from "node:url";

import type {
  RuntimeFailure,
  RuntimeProfileProbeReport,
  RuntimeRecoveryDescriptor,
} from "@rah-os/protocol";
import { RuntimeTrajectoryAppendInputSchema } from "@rah-os/protocol";

import type {
  ActivationEnvelope,
  RunExit,
  RunHandle,
  RuntimeAdapter,
  RuntimeBusyNotice,
  RuntimeAvailability,
  RuntimeStartLifecycle,
} from "./runtime.ts";
import { classifyRuntimeFailure } from "./runtime-error-policy.ts";
import {
  LEGACY_RAH_WORKER_TOKEN_ENV,
  LEGACY_RAH_WORKER_TOKEN_FILE_ENV,
  RAH_AGENT_TOOL_BIN_ENV,
  RAH_WORKER_API_URL_ENV,
  RAH_WORKER_CLI_ENV,
  RAH_WORKER_SESSION_FILE_ENV,
} from "./worker-credential-file.ts";
import {
  RAH_AGENT_APP_INBOX_JSON_ENV,
  RAH_AGENT_MEMORY_DIR_ENV,
  RAH_AGENT_MEMORY_INDEX_ENV,
} from "./agent-memory-workspace.ts";
import { RAH_AGENT_MEMORY_BOOTSTRAP_JSON_ENV } from "./agent-memory-bootstrap.ts";
import { RAH_AGENT_MEMORY_SOURCE_FILE_ENV } from "./agent-memory-project.ts";

import { RuntimeBusyInput, validBusyNotice } from "./runtime-busy-input.ts";

export type GenericProcessAdapterOptions = {
  busyInputMode?: "direct" | "gated";
  guideRuntimeId?: string;
  nativeBusyInput?: boolean;
  activationEnvironment?: (
    input: ActivationEnvelope,
  ) => ActivationEnvironmentLease | Promise<ActivationEnvironmentLease>;
  args?: readonly string[];
  beforeStart?: () => Promise<void> | void;
  command: string;
  completedRunRetention?: number;
  cwd: string;
  diagnosticByteLimit?: number;
  env?: Readonly<Record<string, string>>;
  expectedExecutableIdentity?: NonNullable<
    RuntimeProfileProbeReport["executableIdentity"]
  >;
  recoveryProvenance?: RuntimeRecoveryProvenance;
  recordProviderSessionEvidence?: (
    input: ActivationEnvelope,
    evidence: RuntimeProviderSessionEvidence,
  ) => Promise<void> | void;
  supervisorControlTimeoutMs?: number;
  supervisorDirectory?: string;
  supervisorStartupTimeoutMs?: number;
  terminationGraceMs?: number;
};

/**
 * Host-private Provider continuity evidence. This frame shares the native
 * driver's fd3 transport but is intercepted before canonical trajectory
 * parsing, so Provider session identity never becomes Room or UI truth.
 */
export type RuntimeProviderSessionEvidence = Readonly<{
  protocol: "rah-provider-session/v1";
  provider: string;
  providerSessionId: string;
  state: "ready";
}>;

export type RuntimeRecoveryProvenance = Pick<
  Required<RuntimeRecoveryDescriptor>,
  "runtimeProfileDigest" | "runtimeProfileRevisionId"
> & {
  recoveryDriverImplementationVersions: Readonly<Record<string, string>>;
};

export type ActivationEnvironmentLease = {
  args?: readonly string[];
  diagnostics?: readonly string[];
  env: Readonly<Record<string, string>>;
  redactions?: readonly string[];
  release?: () => Promise<void> | void;
  /**
   * Digest of the daemon-compiled standing prompt this lease delivers. It keys
   * Provider session continuity so an edited Agent role or instructions cannot
   * resume a session started under the previous prompt. Adapters only forward
   * this value; they never derive it from prompt text of their own.
   */
  standingPromptDigest?: string;
};

export type ProcessDiagnostics = {
  stderr: string;
  stdout: string;
  truncated: boolean;
};

type ProcessRun = {
  busyInput: RuntimeBusyInput;
  activity: RuntimeTrajectoryCollector;
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
const MAX_REDACTION_SECRET_BYTES = 65_536;
const MAX_REDACTION_SCAN_CODE_UNITS = 65_536;
const MIN_REDACTION_SCAN_CODE_UNITS = 1_024;
const MAX_ACTIVITY_LINE_BYTES = 16_384;
const MAX_ACTIVITY_BUFFER_BYTES = 65_536;

/**
 * Diagnostics redaction for already-decoded trajectory strings. Trajectory
 * frames arrive whole on their own descriptor, so they need the substitution
 * BoundedOutput streams, not its incremental scanning machinery.
 */
export function redactTrajectoryText(
  value: string,
  redactions: readonly string[],
): string {
  const secrets = [
    ...new Set(redactions.filter((secret) => secret !== "")),
  ].sort((left, right) => right.length - left.length);
  return secrets.reduce(
    (text, secret) => text.split(secret).join("[REDACTED]"),
    value,
  );
}

function redactTrajectoryFrame(
  value: unknown,
  redactions: readonly string[],
): unknown {
  if (redactions.length === 0) return value;
  if (typeof value === "string") return redactTrajectoryText(value, redactions);
  if (Array.isArray(value)) {
    return value.map((item) => redactTrajectoryFrame(item, redactions));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactTrajectoryFrame(item, redactions),
      ]),
    );
  }
  return value;
}

const REDACTED_TRAJECTORY_FIELDS = new Set([
  "detail",
  "text",
  "title",
  "toolInput",
]);

class RuntimeTrajectoryCollector {
  readonly busyInput = new RuntimeBusyInput();
  readonly #activation: ActivationEnvelope;
  readonly #decoder = new StringDecoder("utf8");
  readonly #diagnostics: BoundedOutput;
  readonly #lifecycle: RuntimeStartLifecycle;
  readonly #redactions: readonly string[];
  readonly #runAttemptId: string;
  readonly #runtimeRunId: string;
  readonly #recordProviderSessionEvidence:
    GenericProcessAdapterOptions["recordProviderSessionEvidence"] | undefined;
  #buffer = "";
  #finished = false;
  #queue = Promise.resolve();
  #terminalFailure: RuntimeFailure | undefined;

  get terminalFailure(): RuntimeFailure | undefined {
    return this.#terminalFailure;
  }

  constructor(input: {
    activation: ActivationEnvelope;
    diagnostics: BoundedOutput;
    lifecycle: RuntimeStartLifecycle;
    recordProviderSessionEvidence?: GenericProcessAdapterOptions["recordProviderSessionEvidence"];
    redactions?: readonly string[];
    runAttemptId: string;
    runtimeRunId: string;
  }) {
    this.#activation = input.activation;
    this.#redactions = input.redactions ?? [];
    this.#diagnostics = input.diagnostics;
    this.#lifecycle = input.lifecycle;
    this.#runAttemptId = input.runAttemptId;
    this.#runtimeRunId = input.runtimeRunId;
    this.#recordProviderSessionEvidence = input.recordProviderSessionEvidence;
  }

  append(chunk: Buffer | string): void {
    if (this.#finished) {
      return;
    }
    const value = Buffer.isBuffer(chunk)
      ? this.#decoder.write(chunk)
      : String(chunk);
    this.#buffer += value;
    if (Buffer.byteLength(this.#buffer) > MAX_ACTIVITY_BUFFER_BYTES) {
      this.#diagnostics.append(
        "[rah-os] runtime trajectory frame buffer exceeded its safe limit\n",
      );
      this.#buffer = "";
      return;
    }
    this.#drainLines();
  }

  async finish(): Promise<void> {
    if (this.#finished) return await this.#queue;
    this.#finished = true;
    if (
      this.#lifecycle.recordTrajectory !== undefined ||
      this.#recordProviderSessionEvidence !== undefined
    ) {
      this.#buffer += this.#decoder.end();
      this.#drainLines();
      if (this.#buffer.trim() !== "") this.#enqueue(this.#buffer);
      this.#buffer = "";
    }
    await this.#queue;
  }

  #drainLines(): void {
    for (;;) {
      const newline = this.#buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line.trim() !== "") this.#enqueue(line);
    }
  }

  #redactEntry(frame: Record<string, unknown>): Record<string, unknown> {
    if (this.#redactions.length === 0) return frame;
    const entry = frame.entry;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return frame;
    }
    return {
      ...frame,
      entry: Object.fromEntries(
        Object.entries(entry).map(([key, value]) => [
          key,
          REDACTED_TRAJECTORY_FIELDS.has(key)
            ? redactTrajectoryFrame(value, this.#redactions)
            : value,
        ]),
      ),
    };
  }

  #enqueue(line: string): void {
    if (Buffer.byteLength(line) > MAX_ACTIVITY_LINE_BYTES) {
      this.#diagnostics.append(
        "[rah-os] ignored an oversized runtime trajectory frame\n",
      );
      return;
    }
    this.#queue = this.#queue.then(async () => {
      try {
        const frame = JSON.parse(line) as unknown;
        if (this.busyInput.receive(frame)) return;
        const providerSession = parseProviderSessionEvidence(frame);
        if (providerSession !== null) {
          await this.#recordProviderSessionEvidence?.(
            this.#activation,
            providerSession,
          );
          return;
        }
        const activity = RuntimeTrajectoryAppendInputSchema.parse({
          ...(typeof frame === "object" && frame !== null
            ? this.#redactEntry(frame as Record<string, unknown>)
            : {}),
          runAttemptId: this.#runAttemptId,
          runtimeRunId: this.#runtimeRunId,
        });
        if (
          activity.entry.kind === "status" &&
          activity.entry.activity === "error" &&
          activity.entry.detailKind === "runtime_error" &&
          activity.entry.detail !== undefined
        ) {
          this.#terminalFailure = classifyRuntimeFailure(activity.entry.detail);
        } else if (
          activity.entry.kind !== "status" ||
          activity.entry.activity !== "error"
        ) {
          this.#terminalFailure = undefined;
        }
        await this.#lifecycle.recordTrajectory?.(activity);
      } catch (error) {
        this.#diagnostics.append(
          `[rah-os] ignored runtime trajectory frame: ${errorMessage(error)}\n`,
        );
      }
    });
  }
}

class BoundedOutput {
  readonly #byteLimit: number;
  readonly #chunks: Buffer[] = [];
  readonly #decoder = new StringDecoder("utf8");
  readonly #maxRedactionLength: number;
  readonly #redactions: readonly string[];
  readonly #scanCodeUnitLimit: number;
  #finished = false;
  #pending = "";
  #redactedPrefixLength = 0;
  #storedBytes = 0;
  #observedBytes = 0;
  truncated = false;

  constructor(byteLimit: number, redactions: readonly string[]) {
    this.#byteLimit = byteLimit;
    this.#redactions = [
      ...new Set(redactions.filter((value) => value !== "")),
    ].sort((left, right) => right.length - left.length);
    this.#maxRedactionLength = this.#redactions.reduce(
      (longest, value) => Math.max(longest, value.length),
      0,
    );
    this.#scanCodeUnitLimit = Math.max(
      1,
      Math.min(
        MAX_REDACTION_SCAN_CODE_UNITS,
        Math.max(MIN_REDACTION_SCAN_CODE_UNITS, byteLimit),
      ),
    );
    this.#redactions.forEach((value) => {
      const bytes = Buffer.byteLength(value);
      if (bytes > MAX_REDACTION_SECRET_BYTES) {
        throw new Error(
          "diagnostic redaction value exceeds the safe byte limit",
        );
      }
    });
  }

  append(chunk: Buffer | string): void {
    if (this.#finished) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.#observedBytes += buffer.byteLength;
    if (this.#observedBytes > this.#byteLimit) this.truncated = true;
    if (this.#storedBytes >= this.#byteLimit) return;
    this.#appendDecoded(this.#decoder.write(buffer));
  }

  finish(): void {
    if (this.#finished) return;
    this.#finished = true;
    if (this.#storedBytes >= this.#byteLimit) {
      this.#decoder.end();
      this.#pending = "";
      this.#redactedPrefixLength = 0;
      return;
    }
    this.#pending += this.#decoder.end();
    this.#drain(true);
  }

  text(): string {
    return Buffer.concat(this.#chunks, this.#storedBytes).toString("utf8");
  }

  #appendSanitized(value: string): void {
    if (value.length === 0) return;
    const available = this.#byteLimit - this.#storedBytes;
    if (available <= 0) {
      this.truncated = true;
      return;
    }
    const accepted = truncateUtf8(value, available);
    const buffer = Buffer.from(accepted);
    if (buffer.byteLength > 0) {
      this.#chunks.push(buffer);
      this.#storedBytes += buffer.byteLength;
    }
    if (accepted.length < value.length) this.truncated = true;
  }

  #appendDecoded(value: string): void {
    let offset = 0;
    while (offset < value.length) {
      let end = Math.min(value.length, offset + this.#scanCodeUnitLimit);
      if (
        end < value.length &&
        isHighSurrogate(value.charCodeAt(end - 1)) &&
        isLowSurrogate(value.charCodeAt(end))
      ) {
        end -= 1;
      }
      this.#pending += value.slice(offset, end);
      this.#drain(false);
      offset = end;
      if (this.#storedBytes >= this.#byteLimit) {
        this.#pending = "";
        this.#redactedPrefixLength = 0;
        return;
      }
    }
  }

  #drain(final: boolean): void {
    const retainedLength = final
      ? 0
      : Math.max(0, this.#maxRedactionLength - 1);
    let safeLength = final
      ? this.#pending.length
      : Math.max(0, this.#pending.length - retainedLength);
    if (
      !final &&
      safeLength > 0 &&
      safeLength < this.#pending.length &&
      isHighSurrogate(this.#pending.charCodeAt(safeLength - 1)) &&
      isLowSurrogate(this.#pending.charCodeAt(safeLength))
    ) {
      safeLength -= 1;
    }
    if (safeLength === 0) return;

    const previousRedactedPrefixLength = this.#redactedPrefixLength;
    const components = this.#redactionComponents(final);
    let cursor = 0;
    for (const component of components) {
      if (component.start >= safeLength) break;
      if (cursor < component.start) {
        this.#appendSanitized(
          this.#pending.slice(cursor, Math.min(component.start, safeLength)),
        );
      }
      if (
        component.start < safeLength &&
        !(previousRedactedPrefixLength > 0 && component.start === 0)
      ) {
        this.#appendSanitized("[REDACTED]");
      }
      cursor = Math.min(component.end, safeLength);
      if (cursor >= safeLength) break;
    }
    if (cursor < safeLength) {
      this.#appendSanitized(this.#pending.slice(cursor, safeLength));
    }

    this.#redactedPrefixLength = 0;
    for (const component of components) {
      if (component.start < safeLength && component.end > safeLength) {
        this.#redactedPrefixLength = component.end - safeLength;
        break;
      }
    }
    this.#pending = this.#pending.slice(safeLength);
  }

  #redactionComponents(
    includePartialSuffix: boolean,
  ): Array<{ start: number; end: number }> {
    const starts = new Uint32Array(this.#pending.length + 1);
    const ends = new Uint32Array(this.#pending.length + 1);
    if (this.#redactedPrefixLength > 0) {
      starts[0] = (starts[0] ?? 0) + 1;
      const end = Math.min(this.#redactedPrefixLength, this.#pending.length);
      ends[end] = (ends[end] ?? 0) + 1;
    }
    for (const secret of this.#redactions) {
      let searchFrom = 0;
      while (searchFrom <= this.#pending.length - secret.length) {
        const start = this.#pending.indexOf(secret, searchFrom);
        if (start < 0) break;
        starts[start] = (starts[start] ?? 0) + 1;
        const end = start + secret.length;
        ends[end] = (ends[end] ?? 0) + 1;
        searchFrom = start + 1;
      }
    }
    if (includePartialSuffix) {
      const partialLength = this.#pendingSecretPrefixLength();
      if (partialLength > 0) {
        const start = this.#pending.length - partialLength;
        starts[start] = (starts[start] ?? 0) + 1;
        ends[this.#pending.length] = (ends[this.#pending.length] ?? 0) + 1;
      }
    }

    const components: Array<{ start: number; end: number }> = [];
    let active = 0;
    let componentStart = -1;
    for (let position = 0; position <= this.#pending.length; position += 1) {
      active -= ends[position] ?? 0;
      if (active === 0 && componentStart >= 0) {
        components.push({ end: position, start: componentStart });
        componentStart = -1;
      }
      const starting = starts[position] ?? 0;
      if (starting > 0) {
        if (active === 0) componentStart = position;
        active += starting;
      }
    }
    return components;
  }

  #pendingSecretPrefixLength(): number {
    return this.#redactions.reduce((longest, secret) => {
      if (secret.length - 1 <= longest) return longest;
      return Math.max(
        longest,
        longestProperPrefixAtSuffix(secret, this.#pending),
      );
    }, 0);
  }
}

export class GenericProcessAdapter implements RuntimeAdapter {
  readonly busyInputMode: "direct" | "gated" | undefined;
  readonly guideRuntimeId: string | undefined;
  readonly #nativeBusyInput: boolean;
  get busyInputSupported(): boolean {
    return this.#nativeBusyInput;
  }
  readonly recoveryDrivers: readonly string[] =
    process.platform === "win32" ? [] : [SUPERVISOR_DRIVER];
  readonly #activationEnvironment:
    | ((
        input: ActivationEnvelope,
      ) => ActivationEnvironmentLease | Promise<ActivationEnvironmentLease>)
    | undefined;
  readonly #args: readonly string[];
  readonly #beforeStart: (() => Promise<void> | void) | undefined;
  readonly #command: string;
  readonly #completedRunIds: string[] = [];
  readonly #completedRunRetention: number;
  readonly #cwd: string;
  readonly #diagnosticByteLimit: number;
  readonly #env: Readonly<Record<string, string>>;
  readonly #expectedExecutableIdentity:
    NonNullable<RuntimeProfileProbeReport["executableIdentity"]> | undefined;
  readonly #recoveryProvenance: RuntimeRecoveryProvenance | undefined;
  readonly #recordProviderSessionEvidence:
    GenericProcessAdapterOptions["recordProviderSessionEvidence"] | undefined;
  readonly #runs = new Map<string, ProcessRun>();
  readonly #supervisorControlTimeoutMs: number;
  readonly #supervisorDirectory: string;
  readonly #supervisorSocketDirectory: string;
  readonly #supervisorStartupTimeoutMs: number;
  readonly #terminationGraceMs: number;

  constructor(options: GenericProcessAdapterOptions) {
    this.#nativeBusyInput = options.nativeBusyInput === true;
    this.guideRuntimeId = options.guideRuntimeId;
    this.busyInputMode = options.busyInputMode;
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
    this.#beforeStart = options.beforeStart;
    this.#activationEnvironment = options.activationEnvironment;
    this.#command = options.command;
    this.#completedRunRetention = options.completedRunRetention ?? 100;
    this.#cwd = options.cwd;
    this.#diagnosticByteLimit = options.diagnosticByteLimit ?? 262_144;
    this.#env = { ...(options.env ?? {}) };
    this.#expectedExecutableIdentity =
      options.expectedExecutableIdentity === undefined
        ? undefined
        : structuredClone(options.expectedExecutableIdentity);
    this.#recoveryProvenance =
      options.recoveryProvenance === undefined
        ? undefined
        : structuredClone(options.recoveryProvenance);
    this.#recordProviderSessionEvidence = options.recordProviderSessionEvidence;
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
    try {
      await this.#beforeStart?.();
    } catch (error) {
      return { available: false, detail: errorMessage(error) };
    }
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
    await this.#beforeStart?.();
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
    const environmentLease = await this.#activationEnvironment?.(input);
    let launchArgs: readonly string[];
    let stdout: BoundedOutput;
    let stderr: BoundedOutput;
    try {
      stdout = new BoundedOutput(
        this.#diagnosticByteLimit,
        environmentLease?.redactions ?? [],
      );
      stderr = new BoundedOutput(
        this.#diagnosticByteLimit,
        environmentLease?.redactions ?? [],
      );
      launchArgs = activationArguments(this.#args, environmentLease?.args);
      appendActivationDiagnostics(stderr, environmentLease?.diagnostics);
    } catch (error) {
      try {
        await environmentLease?.release?.();
      } catch {
        // Preserve the redaction validation failure.
      }
      throw error;
    }
    let released = false;
    const releaseEnvironment = async (): Promise<void> => {
      if (released) return;
      released = true;
      try {
        await environmentLease?.release?.();
      } catch (error) {
        stderr.append(
          `[rah-os] activation environment release failed: ${errorMessage(error)}\n`,
        );
      }
    };
    try {
      await lifecycle.registerPrepared(runHandle);
    } catch (error) {
      await releaseEnvironment();
      throw error;
    }

    let child: ChildProcess;
    try {
      child = spawn(this.#command, launchArgs, {
        cwd: this.#cwd,
        detached: process.platform !== "win32",
        env: this.#createActivationProcessEnvironment(input, environmentLease),
        shell: false,
        stdio: [
          this.#nativeBusyInput ? "pipe" : "ignore",
          "pipe",
          "pipe",
          "pipe",
        ],
      });
    } catch (error) {
      await releaseEnvironment();
      throw error;
    }

    child.stdout?.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.append(chunk));
    child.stdin?.on("error", () => {
      /* write callback/receipt handles EPIPE */
    });
    const activity = new RuntimeTrajectoryCollector({
      activation: input,
      diagnostics: stderr,
      lifecycle,
      recordProviderSessionEvidence: this.#recordProviderSessionEvidence,
      redactions: environmentLease?.redactions ?? [],
      runAttemptId: input.runAttemptId,
      runtimeRunId: runId,
    });
    (child.stdio[3] as NodeJS.ReadableStream | null)?.on(
      "data",
      (chunk: Buffer) => activity.append(chunk),
    );

    let resolveExit!: (exit: RunExit) => void;
    const exitPromise = new Promise<RunExit>((resolvePromise) => {
      resolveExit = resolvePromise;
    });
    const run: ProcessRun = {
      busyInput: activity.busyInput,
      activity,
      child,
      exitPromise,
      exited: false,
      stderr,
      stdout,
    };

    let spawned = false;
    child.once("close", async (code, signal) => {
      run.exited = true;
      await releaseEnvironment();
      await activity.finish();
      stdout.finish();
      stderr.finish();
      resolveExit({
        code,
        ...(activity.terminalFailure === undefined
          ? {}
          : { failure: activity.terminalFailure }),
        ...(signal === null ? {} : { signal }),
      });
      if (spawned) this.#retainCompletedRun(runId);
    });

    this.#runs.set(runId, run);
    try {
      await new Promise<void>((resolvePromise, reject) => {
        child.once("spawn", () => {
          spawned = true;
          resolvePromise();
        });
        child.once("error", async (error) => {
          if (spawned) {
            stderr.append(`[rah-os] process error: ${error.message}\n`);
          } else {
            await releaseEnvironment();
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

  async notifyBusy(
    handle: RunHandle,
    notice: RuntimeBusyNotice,
  ): Promise<boolean> {
    const run = this.#runs.get(handle.runId);
    if (
      !this.#nativeBusyInput ||
      !run ||
      run.exited ||
      !validBusyNotice(notice)
    )
      return false;
    return await run.busyInput.send(
      { fingerprint: notice.fingerprint, text: notice.text },
      async (line) => {
        if (run.exited) throw new Error("runtime exited");
        if (run.supervisorDescriptor) {
          await this.#requestSupervisorControl(
            run.supervisorDescriptor,
            "notify",
            line,
          );
        } else {
          const stdin = run.child.stdin;
          if (!stdin?.writable || stdin.writableLength > 8192)
            throw new Error("runtime stdin unavailable");
          await new Promise<void>((resolve, reject) =>
            stdin.write(line, (error) => (error ? reject(error) : resolve())),
          );
        }
      },
    );
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

    // Let a structured adapter translate the graceful signal into its native
    // Provider cancellation before the hard deadline targets descendants.
    this.#signalLeader(run, "SIGTERM");
    if (await this.#waitForExit(run, this.#terminationGraceMs)) {
      return await run.exitPromise;
    }

    this.#signalGroup(run, "SIGKILL");
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
    let environmentLease: ActivationEnvironmentLease | undefined;
    let launchArgs: readonly string[];
    let stdout: BoundedOutput;
    let stderr: BoundedOutput;
    try {
      environmentLease = await this.#activationEnvironment?.(input);
      stdout = new BoundedOutput(
        this.#diagnosticByteLimit,
        environmentLease?.redactions ?? [],
      );
      stderr = new BoundedOutput(
        this.#diagnosticByteLimit,
        environmentLease?.redactions ?? [],
      );
      launchArgs = activationArguments(this.#args, environmentLease?.args);
      appendActivationDiagnostics(stderr, environmentLease?.diagnostics);
    } catch (error) {
      try {
        await environmentLease?.release?.();
      } catch {
        // Preserve the environment/redaction validation failure.
      }
      await rm(runDirectory, { force: true, recursive: true });
      throw error;
    }
    let released = false;
    const releaseEnvironment = async (): Promise<void> => {
      if (released) return;
      released = true;
      try {
        await environmentLease?.release?.();
      } catch (error) {
        stderr.append(
          `[rah-os] activation environment release failed: ${errorMessage(error)}\n`,
        );
      }
    };
    const supervisorConfig = {
      nativeBusyInput: this.#nativeBusyInput,
      args: launchArgs,
      command: this.#command,
      controlRequestTimeoutMs: this.#supervisorControlTimeoutMs,
      cwd: this.#cwd,
      expectedExecutableIdentity: this.#expectedExecutableIdentity,
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
      child = spawn(
        process.execPath,
        isSea() ? ["__runtime-process-supervisor"] : [SUPERVISOR_ENTRY_PATH],
        {
          cwd: this.#cwd,
          detached: true,
          env: {
            ...this.#createActivationProcessEnvironment(
              input,
              environmentLease,
            ),
            RAH_PROCESS_SUPERVISOR_CONFIG: JSON.stringify(supervisorConfig),
            RAH_PROCESS_SUPERVISOR_TOKEN: descriptor.controlToken,
          },
          shell: false,
          stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
        },
      );
    } catch (error) {
      await releaseEnvironment();
      await rm(runDirectory, { force: true, recursive: true });
      throw error;
    }

    child.stdout?.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.append(chunk));
    child.stdin?.on("error", () => {
      /* write callback/receipt handles EPIPE */
    });
    const activity = new RuntimeTrajectoryCollector({
      activation: input,
      diagnostics: stderr,
      lifecycle,
      recordProviderSessionEvidence: this.#recordProviderSessionEvidence,
      redactions: environmentLease?.redactions ?? [],
      runAttemptId: input.runAttemptId,
      runtimeRunId: runId,
    });
    (child.stdio[4] as NodeJS.ReadableStream | null)?.on(
      "data",
      (chunk: Buffer) => activity.append(chunk),
    );

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
      busyInput: activity.busyInput,
      activity,
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
      await releaseEnvironment();
      await activity.finish();
      stdout.finish();
      stderr.finish();
      try {
        const terminal = await this.#readTerminalResult(descriptor, false);
        resolveExit({
          ...terminal,
          ...(activity.terminalFailure === undefined
            ? {}
            : { failure: activity.terminalFailure }),
        });
      } catch (error) {
        rejectExit(error);
      }
      if (durablePrepared) this.#retainCompletedRun(runId);
    });
    this.#runs.set(runId, run);

    const recoveryDescriptor = {
      driver: SUPERVISOR_DRIVER,
      metadata: { controlToken: descriptor.controlToken },
      ...this.#recoveryDescriptorProvenance(SUPERVISOR_DRIVER),
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
        await releaseEnvironment();
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

  #createActivationProcessEnvironment(
    input: ActivationEnvelope,
    environmentLease: ActivationEnvironmentLease | undefined,
  ): NodeJS.ProcessEnv {
    const inheritedEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.#env,
    };
    delete inheritedEnvironment[LEGACY_RAH_WORKER_TOKEN_ENV];
    delete inheritedEnvironment[RAH_WORKER_API_URL_ENV];
    delete inheritedEnvironment[RAH_WORKER_SESSION_FILE_ENV];
    delete inheritedEnvironment[LEGACY_RAH_WORKER_TOKEN_FILE_ENV];
    delete inheritedEnvironment[RAH_AGENT_TOOL_BIN_ENV];
    delete inheritedEnvironment[RAH_WORKER_CLI_ENV];
    delete inheritedEnvironment.RAH_PROVIDER_LAUNCH_ARGS_JSON;
    delete inheritedEnvironment.RAH_AGENT_CONTEXT_JSON;
    delete inheritedEnvironment.RAH_CONTEXT_MANIFEST_JSON;
    delete inheritedEnvironment[RAH_AGENT_MEMORY_DIR_ENV];
    delete inheritedEnvironment[RAH_AGENT_MEMORY_INDEX_ENV];
    delete inheritedEnvironment[RAH_AGENT_MEMORY_BOOTSTRAP_JSON_ENV];
    delete inheritedEnvironment[RAH_AGENT_MEMORY_SOURCE_FILE_ENV];
    delete inheritedEnvironment[RAH_AGENT_APP_INBOX_JSON_ENV];
    delete inheritedEnvironment.RAH_AGENT_INBOX_API_URL;
    delete inheritedEnvironment.RAH_AGENT_INBOX_SESSION_FILE;
    delete inheritedEnvironment.RAH_AGENT_INBOX_CLI;
    const environment: NodeJS.ProcessEnv = {
      ...inheritedEnvironment,
      ...environmentLease?.env,
      ...(input.agent === undefined
        ? {}
        : { RAH_AGENT_CONTEXT_JSON: JSON.stringify(input.agent) }),
      ...(input.contextManifest === undefined
        ? {}
        : {
            RAH_CONTEXT_MANIFEST_JSON: JSON.stringify(input.contextManifest),
          }),
      RAH_ACTIVATION_ID: input.activationId,
      RAH_ACTIVATION_REASON: input.reason,
      RAH_CONSUMER_ID: input.consumerId,
      RAH_FROM_SEQ: String(input.fromSeq),
      RAH_HOST_ID: input.hostId,
      RAH_PARTICIPANT_ID: input.participantId,
      RAH_ROOM_ID: input.roomId,
      RAH_RUN_ATTEMPT_ID: input.runAttemptId,
      RAH_TO_SEQ: String(input.toSeq),
    };
    delete environment[LEGACY_RAH_WORKER_TOKEN_ENV];
    const toolDirectory = environment[RAH_AGENT_TOOL_BIN_ENV];
    delete environment[RAH_AGENT_TOOL_BIN_ENV];
    if (toolDirectory !== undefined) {
      environment.PATH = `${toolDirectory}${delimiter}${environment.PATH ?? ""}`;
    }
    return environment;
  }

  #recoveryDescriptorProvenance(
    driver: string,
  ): Partial<RuntimeRecoveryDescriptor> {
    if (this.#recoveryProvenance === undefined) return {};
    const recoveryImplementationVersion =
      this.#recoveryProvenance.recoveryDriverImplementationVersions[driver];
    if (recoveryImplementationVersion === undefined) {
      throw new Error(
        `missing recovery implementation provenance for driver ${driver}`,
      );
    }
    return {
      recoveryImplementationVersion,
      runtimeProfileDigest: this.#recoveryProvenance.runtimeProfileDigest,
      runtimeProfileRevisionId:
        this.#recoveryProvenance.runtimeProfileRevisionId,
    };
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
    command: "launch" | "terminate" | "notify",
    input?: string,
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
            ...(input === undefined ? {} : { input }),
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

  #signalLeader(run: ProcessRun, signal: NodeJS.Signals): void {
    const pid = run.child.pid;
    if (pid === undefined || pid <= 0) {
      throw new Error("cannot signal a process without a valid pid");
    }

    try {
      run.child.kill(signal);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") {
        return;
      }
      throw error;
    }
  }

  #signalGroup(run: ProcessRun, signal: NodeJS.Signals): void {
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

function parseProviderSessionEvidence(
  value: unknown,
): RuntimeProviderSessionEvidence | null {
  if (!isRecord(value) || value.protocol !== "rah-provider-session/v1") {
    return null;
  }
  if (
    Object.keys(value).sort().join("\0") !==
      ["protocol", "provider", "providerSessionId", "state"]
        .sort()
        .join("\0") ||
    value.state !== "ready" ||
    !isSafeProviderSessionText(value.provider, 512) ||
    !isSafeProviderSessionText(value.providerSessionId, 4_096)
  ) {
    throw new Error("invalid Provider session evidence frame");
  }
  return {
    protocol: "rah-provider-session/v1",
    provider: value.provider,
    providerSessionId: value.providerSessionId,
    state: "ready",
  };
}

function isSafeProviderSessionText(
  value: unknown,
  lengthLimit: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= lengthLimit &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function activationArguments(
  fixed: readonly string[],
  activation: readonly string[] | undefined,
): readonly string[] {
  const combined = [...fixed, ...(activation ?? [])];
  if (combined.length > 512) {
    throw new Error("runtime argument count exceeds the safe limit");
  }
  let bytes = 0;
  for (const argument of combined) {
    if (typeof argument !== "string" || argument.includes("\0")) {
      throw new Error("runtime arguments must be NUL-free strings");
    }
    bytes += Buffer.byteLength(argument);
    if (bytes > 256 * 1_024) {
      throw new Error("runtime arguments exceed the safe byte limit");
    }
  }
  return combined;
}

function appendActivationDiagnostics(
  diagnostics: BoundedOutput,
  lines: readonly string[] | undefined,
): void {
  if (lines === undefined) return;
  if (lines.length > 32) {
    throw new Error("activation setup diagnostics exceed the safe count");
  }
  for (const line of lines) {
    if (typeof line !== "string" || line.includes("\0")) {
      throw new Error("activation setup diagnostics must be NUL-free strings");
    }
    diagnostics.append(`[rah-os] ${line.slice(0, 2_048)}\n`);
  }
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function longestProperPrefixAtSuffix(pattern: string, value: string): number {
  if (pattern.length <= 1 || value.length === 0) return 0;
  const failure = new Uint32Array(pattern.length);
  let matched = 0;
  for (let index = 1; index < pattern.length; index += 1) {
    while (matched > 0 && pattern[index] !== pattern[matched]) {
      matched = failure[matched - 1] ?? 0;
    }
    if (pattern[index] === pattern[matched]) matched += 1;
    failure[index] = matched;
  }

  matched = 0;
  const start = Math.max(0, value.length - (pattern.length - 1));
  for (let index = start; index < value.length; index += 1) {
    while (matched > 0 && value[index] !== pattern[matched]) {
      matched = failure[matched - 1] ?? 0;
    }
    if (value[index] === pattern[matched]) matched += 1;
    if (matched === pattern.length) {
      matched = failure[matched - 1] ?? 0;
    }
  }
  return matched;
}

function truncateUtf8(value: string, byteLimit: number): string {
  const buffer = Buffer.from(value);
  if (buffer.byteLength <= byteLimit) return value;

  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let end = byteLimit; end >= Math.max(0, byteLimit - 3); end -= 1) {
    try {
      return decoder.decode(buffer.subarray(0, end));
    } catch {
      // Retry without the incomplete UTF-8 code point at the boundary.
    }
  }
  return "";
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
  if (
    value.failure !== undefined &&
    (typeof value.failure !== "object" || value.failure === null)
  ) {
    return false;
  }
  return Object.keys(value).every((key) =>
    ["code", "failure", "signal"].includes(key),
  );
}
