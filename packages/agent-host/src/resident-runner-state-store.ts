import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import {
  createResidentRunnerState,
  recoverResidentRunnerState,
  RESIDENT_RUNNER_CONTROL_PROTOCOL,
  type ResidentRunnerControlDescriptor,
  type ResidentRunnerDegradedReason,
  type ResidentRunnerLifecycle,
  type ResidentRunnerState,
} from "./resident-runner-policy.ts";

export const RESIDENT_RUNNER_STATE_SCHEMA_VERSION = 2;
const MAX_STATE_BYTES = 64 * 1_024;

const LIFECYCLES = new Set<ResidentRunnerLifecycle>([
  "stopped",
  "recovering",
  "starting",
  "running",
  "stopping",
  "crashed",
  "degraded",
]);
const DEGRADED_REASONS = new Set<ResidentRunnerDegradedReason>([
  "crash_budget_exhausted",
  "configuration",
  "attachment_revoked",
]);

export class ResidentRunnerStateStoreSecurityError extends Error {}
export class ResidentRunnerStateStoreFormatError extends Error {}

export type ResidentRunnerStateStoreOptions = {
  statePath: string;
};

export class ResidentRunnerStateStore {
  readonly statePath: string;
  readonly #directory: string;

  constructor(options: ResidentRunnerStateStoreOptions) {
    if (!isAbsolute(options.statePath)) {
      throw new ResidentRunnerStateStoreSecurityError(
        "Resident Runner statePath must be absolute",
      );
    }
    this.statePath = resolve(options.statePath);
    this.#directory = dirname(this.statePath);
    if (
      basename(this.statePath).length === 0 ||
      this.statePath.includes("\0")
    ) {
      throw new ResidentRunnerStateStoreSecurityError(
        "Resident Runner statePath is invalid",
      );
    }
  }

  async read(): Promise<ResidentRunnerState> {
    await requireOwnerPrivateDirectory(this.#directory);
    let handle: FileHandle | undefined;
    try {
      await rejectSymbolicLink(this.statePath);
      handle = await open(
        this.statePath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const metadata = await handle.stat();
      requireOwnerPrivateRegularFile(metadata, this.statePath);
      const raw = await readBounded(handle);
      return parseEnvelope(raw);
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return createResidentRunnerState();
      if (hasErrorCode(error, "ELOOP")) {
        throw new ResidentRunnerStateStoreSecurityError(
          "Resident Runner state file must not be a symbolic link",
        );
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async loadForSupervisorStartup(): Promise<ResidentRunnerState> {
    return recoverResidentRunnerState(await this.read());
  }

  async save(untrustedState: ResidentRunnerState): Promise<void> {
    const state = parseState(untrustedState);
    await requireOwnerPrivateDirectory(this.#directory);
    await rejectSymbolicLink(this.statePath);
    const temporaryPath = `${this.statePath}.tmp-${String(process.pid)}-${randomUUID()}`;
    let handle: FileHandle | undefined;
    try {
      handle = await open(
        temporaryPath,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      await handle.writeFile(
        `${JSON.stringify({
          schemaVersion: RESIDENT_RUNNER_STATE_SCHEMA_VERSION,
          state: serializableState(state),
        })}\n`,
        "utf8",
      );
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.statePath);
      await syncDirectory(this.#directory);
    } finally {
      await handle?.close();
      await rm(temporaryPath, { force: true });
    }
  }
}

async function requireOwnerPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new ResidentRunnerStateStoreSecurityError(
      `Resident Runner state parent must be an owner-private directory: ${path}`,
    );
  }
}

async function rejectSymbolicLink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new ResidentRunnerStateStoreSecurityError(
        "Resident Runner state file must not be a symbolic link",
      );
    }
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return;
    throw error;
  }
}

function requireOwnerPrivateRegularFile(
  metadata: Awaited<ReturnType<FileHandle["stat"]>>,
  path: string,
): void {
  if (
    !metadata.isFile() ||
    (Number(metadata.mode) & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new ResidentRunnerStateStoreSecurityError(
      `Resident Runner state must be an owner-private regular file: ${path}`,
    );
  }
}

async function readBounded(handle: FileHandle): Promise<string> {
  const buffer = Buffer.allocUnsafe(MAX_STATE_BYTES + 1);
  let bytesRead = 0;
  while (bytesRead < buffer.byteLength) {
    const result = await handle.read(
      buffer,
      bytesRead,
      buffer.byteLength - bytesRead,
      null,
    );
    if (result.bytesRead === 0) break;
    bytesRead += result.bytesRead;
  }
  if (bytesRead > MAX_STATE_BYTES) {
    throw new ResidentRunnerStateStoreFormatError(
      "Resident Runner state exceeds 64 KiB",
    );
  }
  return buffer.subarray(0, bytesRead).toString("utf8");
}

function parseEnvelope(raw: string): ResidentRunnerState {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ResidentRunnerStateStoreFormatError(
      "Resident Runner state must be valid JSON",
    );
  }
  const envelope = requireRecord(value, "Resident Runner state envelope");
  requireExactKeys(envelope, ["schemaVersion", "state"]);
  const schemaVersion = envelope.schemaVersion;
  if (
    typeof schemaVersion !== "number" ||
    !Number.isSafeInteger(schemaVersion)
  ) {
    throw new ResidentRunnerStateStoreFormatError(
      "Resident Runner schemaVersion must be a safe integer",
    );
  }
  if (schemaVersion > RESIDENT_RUNNER_STATE_SCHEMA_VERSION) {
    throw new ResidentRunnerStateStoreFormatError(
      `state uses newer Resident Runner schema ${String(schemaVersion)}; this build supports ${String(RESIDENT_RUNNER_STATE_SCHEMA_VERSION)}`,
    );
  }
  if (schemaVersion < 1) {
    throw new ResidentRunnerStateStoreFormatError(
      `unsupported Resident Runner schema ${String(schemaVersion)}`,
    );
  }
  return parseState(envelope.state, schemaVersion);
}

function parseState(
  value: unknown,
  schemaVersion = RESIDENT_RUNNER_STATE_SCHEMA_VERSION,
): ResidentRunnerState {
  const state = requireRecord(value, "Resident Runner state");
  requireExactKeys(state, [
    "crashTimestampsMs",
    "degradedReason",
    "desired",
    "lifecycle",
    "processControl",
    "processGeneration",
    "processId",
    "retryAtMs",
  ]);
  if (!Array.isArray(state.crashTimestampsMs)) {
    throw formatError("crashTimestampsMs must be an array");
  }
  const crashTimestampsMs = state.crashTimestampsMs.map((timestamp, index) =>
    nonNegativeSafeInteger(timestamp, `crashTimestampsMs[${String(index)}]`),
  );
  for (let index = 1; index < crashTimestampsMs.length; index += 1) {
    if (crashTimestampsMs[index]! < crashTimestampsMs[index - 1]!) {
      throw formatError("crashTimestampsMs must be ordered");
    }
  }
  if (typeof state.desired !== "boolean") {
    throw formatError("desired must be a boolean");
  }
  if (
    typeof state.lifecycle !== "string" ||
    !LIFECYCLES.has(state.lifecycle as ResidentRunnerLifecycle)
  ) {
    throw formatError("lifecycle is invalid");
  }
  const lifecycle = state.lifecycle as ResidentRunnerLifecycle;
  const processGeneration = nonNegativeSafeInteger(
    state.processGeneration,
    "processGeneration",
  );
  const processId = optionalPositiveSafeInteger(state.processId, "processId");
  const processControl = optionalProcessControl(state.processControl);
  if (
    processGeneration === 0 &&
    lifecycle !== "stopped" &&
    lifecycle !== "degraded"
  ) {
    throw formatError("an active lifecycle requires a process generation");
  }
  if (
    (lifecycle === "running" ||
      lifecycle === "recovering" ||
      lifecycle === "stopping") &&
    processId === undefined
  ) {
    throw formatError(`${lifecycle} lifecycle requires processId`);
  }
  if (
    schemaVersion >= 2 &&
    (lifecycle === "running" ||
      lifecycle === "recovering" ||
      lifecycle === "stopping" ||
      processId !== undefined) &&
    processControl === undefined
  ) {
    throw formatError(`${lifecycle} lifecycle requires processControl`);
  }
  if (
    (lifecycle === "stopped" ||
      lifecycle === "crashed" ||
      lifecycle === "degraded") &&
    processControl !== undefined
  ) {
    throw formatError(`${lifecycle} lifecycle cannot retain processControl`);
  }
  if (
    (lifecycle === "stopped" ||
      lifecycle === "crashed" ||
      lifecycle === "degraded") &&
    processId !== undefined
  ) {
    throw formatError(`${lifecycle} lifecycle cannot retain processId`);
  }
  const degradedReason = optionalDegradedReason(state.degradedReason);
  if (lifecycle === "degraded" && degradedReason === undefined) {
    throw formatError("degraded lifecycle requires degradedReason");
  }
  if (lifecycle !== "degraded" && degradedReason !== undefined) {
    throw formatError("degradedReason is valid only for degraded lifecycle");
  }
  const retryAtMs = optionalNonNegativeSafeInteger(
    state.retryAtMs,
    "retryAtMs",
  );
  if (
    retryAtMs !== undefined &&
    lifecycle !== "stopped" &&
    lifecycle !== "crashed"
  ) {
    throw formatError(
      "retryAtMs is valid only for stopped or crashed lifecycle",
    );
  }
  return Object.freeze({
    crashTimestampsMs: Object.freeze(crashTimestampsMs),
    degradedReason,
    desired: state.desired,
    lifecycle,
    processControl,
    processGeneration,
    processId,
    retryAtMs,
  });
}

function serializableState(
  state: ResidentRunnerState,
): Record<string, unknown> {
  return {
    crashTimestampsMs: [...state.crashTimestampsMs],
    ...(state.degradedReason === undefined
      ? {}
      : { degradedReason: state.degradedReason }),
    desired: state.desired,
    lifecycle: state.lifecycle,
    ...(state.processControl === undefined
      ? {}
      : { processControl: state.processControl }),
    processGeneration: state.processGeneration,
    ...(state.processId === undefined ? {} : { processId: state.processId }),
    ...(state.retryAtMs === undefined ? {} : { retryAtMs: state.retryAtMs }),
  };
}

function optionalProcessControl(
  value: unknown,
): ResidentRunnerControlDescriptor | undefined {
  if (value === undefined) return undefined;
  const descriptor = requireRecord(value, "processControl");
  const keys = Object.keys(descriptor).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "controlToken" ||
    keys[1] !== "instanceId" ||
    keys[2] !== "protocol" ||
    descriptor.protocol !== RESIDENT_RUNNER_CONTROL_PROTOCOL ||
    typeof descriptor.instanceId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      descriptor.instanceId,
    ) ||
    typeof descriptor.controlToken !== "string" ||
    !/^[0-9a-f]{64}$/u.test(descriptor.controlToken)
  ) {
    throw formatError("processControl is invalid");
  }
  return Object.freeze({
    controlToken: descriptor.controlToken,
    instanceId: descriptor.instanceId,
    protocol: RESIDENT_RUNNER_CONTROL_PROTOCOL,
  });
}

function optionalDegradedReason(
  value: unknown,
): ResidentRunnerDegradedReason | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !DEGRADED_REASONS.has(value as ResidentRunnerDegradedReason)
  ) {
    throw formatError("degradedReason is invalid");
  }
  return value as ResidentRunnerDegradedReason;
}

function optionalNonNegativeSafeInteger(
  value: unknown,
  name: string,
): number | undefined {
  return value === undefined ? undefined : nonNegativeSafeInteger(value, name);
}

function optionalPositiveSafeInteger(
  value: unknown,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw formatError(`${name} must be a positive safe integer`);
  }
  return value as number;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw formatError(`${name} must be a non-negative safe integer`);
  }
  return value as number;
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw formatError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unexpected !== undefined) {
    throw formatError(`unexpected field ${unexpected}`);
  }
  for (const required of allowed.filter(
    (key) =>
      key !== "degradedReason" &&
      key !== "processControl" &&
      key !== "processId" &&
      key !== "retryAtMs",
  )) {
    if (!(required in value)) throw formatError(`missing field ${required}`);
  }
}

function formatError(message: string): ResidentRunnerStateStoreFormatError {
  return new ResidentRunnerStateStoreFormatError(
    `Invalid Resident Runner state: ${message}`,
  );
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
