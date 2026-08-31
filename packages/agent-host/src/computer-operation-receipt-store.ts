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

export const COMPUTER_OPERATION_RECEIPT_SCHEMA_VERSION = 1;
const MAX_STATE_BYTES = 32 * 1_024;

export type ComputerOperationReceiptPhase =
  | "claimed"
  | "draining"
  | "downloading"
  | "verifying"
  | "staging"
  | "replacing"
  | "restarting";

export type ComputerOperationReceipt = Readonly<
  | {
      action: "restart";
      operationId: string;
      pendingPhase?: Exclude<ComputerOperationReceiptPhase, "claimed">;
      phase: ComputerOperationReceiptPhase;
      requestedAt: string;
      sourceBuildVersion: string;
      sourceComputerInstanceId: string;
    }
  | {
      action: "upgrade";
      operationId: string;
      pendingPhase?: Exclude<ComputerOperationReceiptPhase, "claimed">;
      phase: ComputerOperationReceiptPhase;
      requestedAt: string;
      sourceBuildVersion: string;
      sourceComputerInstanceId: string;
      targetBuildVersion: string;
    }
>;

export type ComputerOperationReceiptStorePort = {
  clear(operationId: string): Promise<void>;
  read(): Promise<ComputerOperationReceipt | null>;
  save(receipt: ComputerOperationReceipt): Promise<void>;
};

export class ComputerOperationReceiptStoreSecurityError extends Error {}
export class ComputerOperationReceiptStoreFormatError extends Error {}

export class ComputerOperationReceiptStore implements ComputerOperationReceiptStorePort {
  readonly statePath: string;
  readonly #directory: string;

  constructor(options: { statePath: string }) {
    if (!isAbsolute(options.statePath)) {
      throw new ComputerOperationReceiptStoreSecurityError(
        "Computer operation receipt statePath must be absolute",
      );
    }
    this.statePath = resolve(options.statePath);
    this.#directory = dirname(this.statePath);
    if (
      basename(this.statePath).length === 0 ||
      this.statePath.includes("\0")
    ) {
      throw new ComputerOperationReceiptStoreSecurityError(
        "Computer operation receipt statePath is invalid",
      );
    }
  }

  async read(): Promise<ComputerOperationReceipt | null> {
    await requireOwnerPrivateDirectory(this.#directory);
    let handle: FileHandle | undefined;
    try {
      await rejectSymbolicLink(this.statePath);
      handle = await open(
        this.statePath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      requireOwnerPrivateRegularFile(await handle.stat(), this.statePath);
      return parseEnvelope(await readBounded(handle));
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return null;
      if (hasErrorCode(error, "ELOOP")) {
        throw new ComputerOperationReceiptStoreSecurityError(
          "Computer operation receipt must not be a symbolic link",
        );
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async save(untrustedReceipt: ComputerOperationReceipt): Promise<void> {
    const receipt = parseReceipt(untrustedReceipt);
    const serialized = `${JSON.stringify({
      receipt,
      schemaVersion: COMPUTER_OPERATION_RECEIPT_SCHEMA_VERSION,
    })}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_STATE_BYTES) {
      throw formatError("Computer operation receipt exceeds 32 KiB");
    }
    await requireOwnerPrivateDirectory(this.#directory);
    await validateExistingTarget(this.statePath);
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
      await handle.writeFile(serialized, "utf8");
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

  async clear(operationId: string): Promise<void> {
    const expected = identifier(operationId, "operationId");
    const current = await this.read();
    if (current === null) return;
    if (current.operationId !== expected) {
      throw new ComputerOperationReceiptStoreFormatError(
        "refusing to clear another Computer operation receipt",
      );
    }
    await validateExistingTarget(this.statePath);
    await rm(this.statePath);
    await syncDirectory(this.#directory);
  }
}

function parseEnvelope(raw: string): ComputerOperationReceipt {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw formatError("Computer operation receipt must be valid JSON");
  }
  const envelope = requireRecord(value, "Computer operation receipt envelope");
  requireExactKeys(envelope, ["receipt", "schemaVersion"]);
  if (!Number.isSafeInteger(envelope.schemaVersion)) {
    throw formatError("schemaVersion must be a safe integer");
  }
  const version = envelope.schemaVersion as number;
  if (version > COMPUTER_OPERATION_RECEIPT_SCHEMA_VERSION) {
    throw formatError(
      `receipt uses newer schema ${String(version)}; this build supports ${String(COMPUTER_OPERATION_RECEIPT_SCHEMA_VERSION)}`,
    );
  }
  if (version !== COMPUTER_OPERATION_RECEIPT_SCHEMA_VERSION) {
    throw formatError(`unsupported receipt schema ${String(version)}`);
  }
  return parseReceipt(envelope.receipt);
}

function parseReceipt(value: unknown): ComputerOperationReceipt {
  const receipt = requireRecord(value, "Computer operation receipt");
  const action = enumValue(receipt.action, "action", ["restart", "upgrade"]);
  requireExactKeys(
    receipt,
    action === "restart"
      ? [
          "action",
          "operationId",
          ...(Object.hasOwn(receipt, "pendingPhase") ? ["pendingPhase"] : []),
          "phase",
          "requestedAt",
          "sourceBuildVersion",
          "sourceComputerInstanceId",
        ]
      : [
          "action",
          "operationId",
          ...(Object.hasOwn(receipt, "pendingPhase") ? ["pendingPhase"] : []),
          "phase",
          "requestedAt",
          "sourceBuildVersion",
          "sourceComputerInstanceId",
          "targetBuildVersion",
        ],
  );
  const phase = enumValue(receipt.phase, "phase", [
    "claimed",
    "draining",
    "downloading",
    "verifying",
    "staging",
    "replacing",
    "restarting",
  ]);
  const allowed =
    action === "restart"
      ? ["claimed", "draining", "restarting"]
      : [
          "claimed",
          "draining",
          "downloading",
          "verifying",
          "staging",
          "replacing",
          "restarting",
        ];
  if (!allowed.includes(phase)) {
    throw formatError(`${phase} is not valid for ${action}`);
  }
  const pendingPhase = Object.hasOwn(receipt, "pendingPhase")
    ? enumValue(receipt.pendingPhase, "pendingPhase", [
        "draining",
        "downloading",
        "verifying",
        "staging",
        "replacing",
        "restarting",
      ])
    : undefined;
  if (pendingPhase !== undefined) {
    const currentIndex = allowed.indexOf(phase);
    if (
      !allowed.includes(pendingPhase) ||
      allowed.indexOf(pendingPhase) !== currentIndex + 1
    ) {
      throw formatError("pendingPhase must immediately follow phase");
    }
  }
  const common = {
    action,
    operationId: identifier(receipt.operationId, "operationId"),
    ...(pendingPhase === undefined ? {} : { pendingPhase }),
    phase,
    requestedAt: timestamp(receipt.requestedAt, "requestedAt"),
    sourceBuildVersion: buildVersion(
      receipt.sourceBuildVersion,
      "sourceBuildVersion",
    ),
    sourceComputerInstanceId: identifier(
      receipt.sourceComputerInstanceId,
      "sourceComputerInstanceId",
    ),
  };
  return Object.freeze(
    action === "restart"
      ? common
      : {
          ...common,
          action,
          targetBuildVersion: buildVersion(
            receipt.targetBuildVersion,
            "targetBuildVersion",
          ),
        },
  ) as ComputerOperationReceipt;
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
    throw new ComputerOperationReceiptStoreSecurityError(
      `Computer operation receipt parent must be owner-private: ${path}`,
    );
  }
}

async function rejectSymbolicLink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new ComputerOperationReceiptStoreSecurityError(
        "Computer operation receipt must not be a symbolic link",
      );
    }
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return;
    throw error;
  }
}

async function validateExistingTarget(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new ComputerOperationReceiptStoreSecurityError(
        "Computer operation receipt must not be a symbolic link",
      );
    }
    requireOwnerPrivateRegularFile(metadata, path);
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
    throw new ComputerOperationReceiptStoreSecurityError(
      `Computer operation receipt must be owner-private: ${path}`,
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
    throw formatError("Computer operation receipt exceeds 32 KiB");
  }
  return buffer.subarray(0, bytesRead).toString("utf8");
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw formatError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw formatError(`expected keys ${wanted.join(", ")}`);
  }
}

function identifier(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.includes("\0")
  ) {
    throw formatError(`${name} is invalid`);
  }
  return value;
}

function buildVersion(value: unknown, name: string): string {
  const result = identifier(value, name).trim();
  if (result.length === 0 || result.length > 128) {
    throw formatError(`${name} is invalid`);
  }
  return result;
}

function timestamp(value: unknown, name: string): string {
  const result = identifier(value, name);
  if (!Number.isFinite(Date.parse(result)))
    throw formatError(`${name} is invalid`);
  return result;
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  name: string,
  values: Values,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw formatError(`${name} is invalid`);
  }
  return value;
}

function formatError(
  message: string,
): ComputerOperationReceiptStoreFormatError {
  return new ComputerOperationReceiptStoreFormatError(message);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
