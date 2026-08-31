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

import { validateComputerControlOrigin } from "./computer-control-origin.ts";

export const COMPUTER_ATTACHMENT_STORE_SCHEMA_VERSION = 1;
const MAX_STATE_BYTES = 256 * 1_024;

export type ComputerAttachment = {
  attachmentId: string;
  connectionId: string;
  createdAt: string;
  hostAccessToken: string;
  origin: string;
};

export type ComputerAttachmentStoreOptions = {
  statePath: string;
};

export class ComputerAttachmentStoreSecurityError extends Error {}
export class ComputerAttachmentStoreFormatError extends Error {}

export class ComputerAttachmentStore {
  readonly statePath: string;
  readonly #directory: string;

  constructor(options: ComputerAttachmentStoreOptions) {
    if (!isAbsolute(options.statePath)) {
      throw new ComputerAttachmentStoreSecurityError(
        "Computer attachment statePath must be absolute",
      );
    }
    this.statePath = resolve(options.statePath);
    this.#directory = dirname(this.statePath);
    if (
      basename(this.statePath).length === 0 ||
      this.statePath.includes("\0")
    ) {
      throw new ComputerAttachmentStoreSecurityError(
        "Computer attachment statePath is invalid",
      );
    }
  }

  async read(): Promise<ComputerAttachment[]> {
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
      return parseEnvelope(await readBounded(handle));
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return [];
      if (hasErrorCode(error, "ELOOP")) {
        throw new ComputerAttachmentStoreSecurityError(
          "Computer attachment file must not be a symbolic link",
        );
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async save(
    untrustedAttachments: readonly ComputerAttachment[],
  ): Promise<void> {
    const attachments = parseAttachments(untrustedAttachments);
    const serialized = `${JSON.stringify({
      attachments,
      schemaVersion: COMPUTER_ATTACHMENT_STORE_SCHEMA_VERSION,
    })}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_STATE_BYTES) {
      throw formatError("Computer attachment state exceeds 256 KiB");
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
}

function parseEnvelope(raw: string): ComputerAttachment[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ComputerAttachmentStoreFormatError(
      "Computer attachment state must be valid JSON",
    );
  }
  const envelope = requireRecord(value, "Computer attachment envelope");
  requireExactKeys(envelope, ["attachments", "schemaVersion"]);
  if (!Number.isSafeInteger(envelope.schemaVersion)) {
    throw formatError("schemaVersion must be a safe integer");
  }
  const version = envelope.schemaVersion as number;
  if (version > COMPUTER_ATTACHMENT_STORE_SCHEMA_VERSION) {
    throw formatError(
      `state uses newer Computer attachment schema ${String(version)}; this build supports ${String(COMPUTER_ATTACHMENT_STORE_SCHEMA_VERSION)}`,
    );
  }
  if (version !== COMPUTER_ATTACHMENT_STORE_SCHEMA_VERSION) {
    throw formatError(
      `unsupported Computer attachment schema ${String(version)}`,
    );
  }
  if (!Array.isArray(envelope.attachments)) {
    throw formatError("attachments must be an array");
  }
  return parseAttachments(envelope.attachments);
}

function parseAttachments(value: readonly unknown[]): ComputerAttachment[] {
  if (value.length > 128) {
    throw formatError("attachments may contain at most 128 records");
  }
  const attachmentIds = new Set<string>();
  const connectionIds = new Set<string>();
  return value.map((entry, index) => {
    const attachment = requireRecord(
      entry,
      `Computer attachment[${String(index)}]`,
    );
    requireExactKeys(attachment, [
      "attachmentId",
      "connectionId",
      "createdAt",
      "hostAccessToken",
      "origin",
    ]);
    const attachmentId = identifier(attachment.attachmentId, "attachmentId");
    const connectionId = identifier(attachment.connectionId, "connectionId");
    if (attachmentIds.has(attachmentId)) {
      throw formatError(`duplicate attachmentId: ${attachmentId}`);
    }
    if (connectionIds.has(connectionId)) {
      throw formatError(`duplicate connectionId: ${connectionId}`);
    }
    attachmentIds.add(attachmentId);
    connectionIds.add(connectionId);
    const createdAt = timestamp(attachment.createdAt, "createdAt");
    const hostAccessToken = boundedString(
      attachment.hostAccessToken,
      "hostAccessToken",
      4_096,
    );
    const rawOrigin = boundedString(attachment.origin, "origin", 2_048);
    let origin: string;
    try {
      origin = validateComputerControlOrigin(rawOrigin);
    } catch (error) {
      throw formatError(
        error instanceof Error ? error.message : "origin is invalid",
      );
    }
    return Object.freeze({
      attachmentId,
      connectionId,
      createdAt,
      hostAccessToken,
      origin,
    });
  });
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
    throw new ComputerAttachmentStoreSecurityError(
      `Computer attachment parent must be an owner-private directory: ${path}`,
    );
  }
}

async function rejectSymbolicLink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new ComputerAttachmentStoreSecurityError(
        "Computer attachment file must not be a symbolic link",
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
      throw new ComputerAttachmentStoreSecurityError(
        "Computer attachment file must not be a symbolic link",
      );
    }
    if (
      !metadata.isFile() ||
      (metadata.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" &&
        metadata.uid !== process.getuid())
    ) {
      throw new ComputerAttachmentStoreSecurityError(
        `Computer attachment state must be an owner-private regular file: ${path}`,
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
    throw new ComputerAttachmentStoreSecurityError(
      `Computer attachment state must be an owner-private regular file: ${path}`,
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
    throw formatError("Computer attachment state exceeds 256 KiB");
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

function boundedString(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw formatError(
      `${name} must contain between 1 and ${String(max)} characters`,
    );
  }
  return value;
}

function identifier(value: unknown, name: string): string {
  const result = boundedString(value, name, 256).trim();
  if (result.length === 0 || result.includes("\0")) {
    throw formatError(`${name} is invalid`);
  }
  return result;
}

function timestamp(value: unknown, name: string): string {
  const result = boundedString(value, name, 64);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      result,
    ) ||
    !Number.isFinite(Date.parse(result))
  ) {
    throw formatError(`${name} must be an ISO timestamp`);
  }
  return result;
}

function formatError(message: string): ComputerAttachmentStoreFormatError {
  return new ComputerAttachmentStoreFormatError(message);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
