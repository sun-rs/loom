import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, rm, type FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import { compareComputerReleaseVersions } from "./computer-release-source.ts";

export const COMPUTER_UPGRADE_COORDINATOR_REQUEST_SCHEMA_VERSION = 1;
const MAX_REQUEST_BYTES = 64 * 1_024;
const MAX_ATTACHMENTS = 128;

export type ComputerUpgradeCoordinatorRequest = Readonly<{
  carrier: "rah-k";
  controlAttachmentId: string;
  currentArtifactPath: string;
  managedAttachmentIdentities: Readonly<Record<string, string>>;
  mode: "recover" | "upgrade";
  operationId: string;
  requestedAt: string;
  sourceBuildVersion: string;
  sourceComputerInstanceId: string;
  targetBuildVersion: string;
}>;

export class ComputerUpgradeCoordinatorRequestStoreSecurityError extends Error {}
export class ComputerUpgradeCoordinatorRequestStoreFormatError extends Error {}

/**
 * One non-secret, durable launch descriptor for the detached K coordinator.
 * Credentials never enter this file or argv: the coordinator reopens the
 * owner-private Computer attachment store through its composition root.
 */
export class ComputerUpgradeCoordinatorRequestStore {
  readonly requestPath: string;
  readonly #directory: string;

  constructor(options: { requestPath: string }) {
    if (
      !isAbsolute(options.requestPath) ||
      options.requestPath.includes("\0")
    ) {
      throw new ComputerUpgradeCoordinatorRequestStoreSecurityError(
        "Computer upgrade coordinator requestPath must be absolute",
      );
    }
    this.requestPath = resolve(options.requestPath);
    this.#directory = dirname(this.requestPath);
    if (basename(this.requestPath).length === 0) {
      throw new ComputerUpgradeCoordinatorRequestStoreSecurityError(
        "Computer upgrade coordinator requestPath is invalid",
      );
    }
  }

  async read(): Promise<ComputerUpgradeCoordinatorRequest | null> {
    await requireOwnerPrivateDirectory(this.#directory);
    let handle: FileHandle | undefined;
    try {
      await rejectSymbolicLink(this.requestPath);
      handle = await open(
        this.requestPath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      requireOwnerPrivateRegularFile(await handle.stat());
      return parseEnvelope(await readBounded(handle));
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      if (hasCode(error, "ELOOP"))
        throw security("request must not be a symlink");
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async save(value: ComputerUpgradeCoordinatorRequest): Promise<void> {
    const request = parseRequest(value);
    const serialized = `${JSON.stringify({
      request,
      schemaVersion: COMPUTER_UPGRADE_COORDINATOR_REQUEST_SCHEMA_VERSION,
    })}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_REQUEST_BYTES) {
      throw format("Computer upgrade coordinator request exceeds 64 KiB");
    }
    await requireOwnerPrivateDirectory(this.#directory);
    const temporaryPath = `${this.requestPath}.tmp-${String(process.pid)}-${randomUUID()}`;
    let handle: FileHandle | undefined;
    let installed = false;
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
      try {
        await link(temporaryPath, this.requestPath);
        installed = true;
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
        const current = await this.read();
        if (
          current === null ||
          JSON.stringify(current) !== JSON.stringify(request)
        ) {
          throw format(
            "another Computer upgrade coordinator request is already active",
          );
        }
      }
    } finally {
      await handle?.close();
      await rm(temporaryPath, { force: true });
      if (installed) await syncDirectory(this.#directory);
    }
  }

  async clear(operationId: string): Promise<void> {
    const expected = identifier(operationId, "operationId", 512);
    const current = await this.read();
    if (current === null) return;
    if (current.operationId !== expected) {
      throw format("refusing to clear another coordinator request");
    }
    await validateExistingTarget(this.requestPath);
    await rm(this.requestPath);
    await syncDirectory(this.#directory);
  }
}

export type ComputerUpgradeCoordinatorLaunch = Readonly<{
  processId: number;
  requestPath: string;
}>;

export type NodeComputerUpgradeCoordinatorLauncherOptions = Readonly<{
  argumentPrefix?: readonly string[];
  executablePath: string;
  spawn?: (
    executablePath: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcess;
}>;

/**
 * Starts the coordinator in a new process group and deliberately inherits no
 * environment. The request path is the only dynamic argv value; optional
 * secret composition configuration crosses as an already-open private fd.
 */
export class NodeComputerUpgradeCoordinatorLauncher {
  readonly #argumentPrefix: readonly string[];
  readonly #executablePath: string;
  readonly #spawn: NonNullable<
    NodeComputerUpgradeCoordinatorLauncherOptions["spawn"]
  >;

  constructor(options: NodeComputerUpgradeCoordinatorLauncherOptions) {
    if (!isAbsolute(options.executablePath)) {
      throw new Error("coordinator executablePath must be absolute");
    }
    this.#executablePath = resolve(options.executablePath);
    const prefix = options.argumentPrefix ?? [];
    if (
      prefix.length > 16 ||
      prefix.some(
        (value) =>
          typeof value !== "string" ||
          value.length === 0 ||
          value.length > 4_096 ||
          value.includes("\0"),
      )
    ) {
      throw new Error("coordinator argumentPrefix is invalid");
    }
    this.#argumentPrefix = Object.freeze([...prefix]);
    this.#spawn = options.spawn ?? spawn;
  }

  async launch(input: {
    configurationPath?: string;
    requestPath: string;
  }): Promise<ComputerUpgradeCoordinatorLaunch> {
    const requestPath = absolutePath(input.requestPath, "requestPath");
    const request = await new ComputerUpgradeCoordinatorRequestStore({
      requestPath,
    }).read();
    if (request === null) {
      throw new Error("coordinator request is not durably available");
    }
    let configuration: FileHandle | undefined;
    let child: ChildProcess | undefined;
    try {
      if (input.configurationPath !== undefined) {
        configuration = await open(
          absolutePath(input.configurationPath, "configurationPath"),
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        requireOwnerPrivateRegularFile(await configuration.stat());
      }
      child = this.#spawn(
        this.#executablePath,
        [
          ...this.#argumentPrefix,
          requestPath,
          ...(configuration === undefined ? [] : ["--config-fd=3"]),
        ],
        {
          detached: true,
          env: Object.create(null) as NodeJS.ProcessEnv,
          stdio:
            configuration === undefined
              ? "ignore"
              : ["ignore", "ignore", "ignore", configuration.fd],
          windowsHide: true,
        },
      );
      await waitForSpawn(child);
      const processId = child.pid;
      if (!Number.isSafeInteger(processId) || (processId ?? 0) <= 0) {
        throw new Error("detached coordinator has no process id");
      }
      child.unref();
      return Object.freeze({ processId: processId!, requestPath });
    } catch (error) {
      child?.kill("SIGKILL");
      throw error;
    } finally {
      await configuration?.close();
    }
  }
}

function parseEnvelope(raw: string): ComputerUpgradeCoordinatorRequest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw format("Computer upgrade coordinator request must be valid JSON");
  }
  const envelope = record(value, "request envelope");
  exactKeys(envelope, ["request", "schemaVersion"]);
  if (
    envelope.schemaVersion !==
    COMPUTER_UPGRADE_COORDINATOR_REQUEST_SCHEMA_VERSION
  ) {
    throw format("unsupported Computer upgrade coordinator request schema");
  }
  return parseRequest(envelope.request);
}

function parseRequest(value: unknown): ComputerUpgradeCoordinatorRequest {
  const request = record(value, "coordinator request");
  exactKeys(request, [
    "carrier",
    "controlAttachmentId",
    "currentArtifactPath",
    "managedAttachmentIdentities",
    "mode",
    "operationId",
    "requestedAt",
    "sourceBuildVersion",
    "sourceComputerInstanceId",
    "targetBuildVersion",
  ]);
  if (request.carrier !== "rah-k") throw format("carrier must be rah-k");
  if (request.mode !== "upgrade" && request.mode !== "recover") {
    throw format("coordinator mode is invalid");
  }
  const requestedAt = identifier(request.requestedAt, "requestedAt", 64);
  const requestedDate = new Date(requestedAt);
  if (
    !Number.isFinite(requestedDate.getTime()) ||
    requestedDate.toISOString() !== requestedAt
  ) {
    throw format("requestedAt must be a canonical ISO timestamp");
  }
  const sourceBuildVersion = releaseVersion(
    request.sourceBuildVersion,
    "sourceBuildVersion",
  );
  const targetBuildVersion = releaseVersion(
    request.targetBuildVersion,
    "targetBuildVersion",
  );
  if (
    compareComputerReleaseVersions(targetBuildVersion, sourceBuildVersion) === 0
  ) {
    throw format("targetBuildVersion must differ from sourceBuildVersion");
  }
  const currentArtifactPath = absolutePath(
    request.currentArtifactPath,
    "currentArtifactPath",
  );
  const identities = attachmentIdentities(request.managedAttachmentIdentities);
  const controlAttachmentId = identifier(
    request.controlAttachmentId,
    "controlAttachmentId",
    256,
  );
  if (identities[controlAttachmentId] === undefined) {
    throw format(
      "controlAttachmentId must name one managed attachment identity",
    );
  }
  return Object.freeze({
    carrier: "rah-k",
    controlAttachmentId,
    currentArtifactPath,
    managedAttachmentIdentities: identities,
    mode: request.mode,
    operationId: identifier(request.operationId, "operationId", 512),
    requestedAt,
    sourceBuildVersion,
    sourceComputerInstanceId: identifier(
      request.sourceComputerInstanceId,
      "sourceComputerInstanceId",
      512,
    ),
    targetBuildVersion,
  });
}

function attachmentIdentities(
  value: unknown,
): Readonly<Record<string, string>> {
  const input = record(value, "managedAttachmentIdentities");
  const keys = Object.keys(input).sort();
  if (keys.length === 0 || keys.length > MAX_ATTACHMENTS) {
    throw format("managedAttachmentIdentities must contain 1 to 128 entries");
  }
  const output: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const key of keys) {
    const normalizedKey = identifier(key, "attachmentId", 256);
    const identity = identifier(input[key], "attachmentIdentity", 512);
    Object.defineProperty(output, normalizedKey, {
      configurable: false,
      enumerable: true,
      value: identity,
      writable: false,
    });
  }
  return Object.freeze(output);
}

function releaseVersion(value: unknown, name: string): string {
  const version = identifier(value, name, 128);
  try {
    compareComputerReleaseVersions(version, version);
  } catch {
    throw format(`${name} must be strict semver`);
  }
  return version;
}

async function waitForSpawn(child: ChildProcess): Promise<void> {
  if (child.pid !== undefined) return;
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      cleanup();
      rejectPromise(new Error("detached coordinator spawn timed out"));
    }, 5_000);
    const onError = (error: Error) => {
      cleanup();
      rejectPromise(error);
    };
    const onSpawn = () => {
      cleanup();
      resolvePromise();
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("spawn", onSpawn);
    };
    child.once("error", onError);
    child.once("spawn", onSpawn);
  });
}

async function readBounded(handle: FileHandle): Promise<string> {
  const metadata = await handle.stat();
  if (metadata.size <= 0 || metadata.size > MAX_REQUEST_BYTES) {
    throw format("Computer upgrade coordinator request size is invalid");
  }
  return await handle.readFile("utf8");
}

async function requireOwnerPrivateDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw security("request directory must be owner-private");
  }
}

function requireOwnerPrivateRegularFile(metadata: {
  isFile(): boolean;
  mode: number;
  uid: number;
}): void {
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw security("request file must be owner-private and regular");
  }
}

async function validateExistingTarget(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink())
      throw security("request must not be a symlink");
    requireOwnerPrivateRegularFile(metadata);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return;
    throw error;
  }
}

async function rejectSymbolicLink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw security("request must not be a symlink");
    }
  } catch (error) {
    if (hasCode(error, "ENOENT")) return;
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw format(`${name} must be an object`);
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
    throw format("Computer upgrade coordinator request has unexpected fields");
  }
}

function identifier(value: unknown, name: string, maxLength: number): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw format(`${name} is invalid`);
  }
  return value;
}

function absolutePath(value: unknown, name: string): string {
  const path = identifier(value, name, 4_096);
  if (!isAbsolute(path)) throw format(`${name} must be absolute`);
  return resolve(path);
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function security(
  message: string,
): ComputerUpgradeCoordinatorRequestStoreSecurityError {
  return new ComputerUpgradeCoordinatorRequestStoreSecurityError(message);
}

function format(
  message: string,
): ComputerUpgradeCoordinatorRequestStoreFormatError {
  return new ComputerUpgradeCoordinatorRequestStoreFormatError(message);
}
