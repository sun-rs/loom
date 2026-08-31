import {
  createHash,
  createPrivateKey,
  randomUUID,
  sign,
  type KeyObject,
} from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import {
  compareComputerReleaseVersions,
  createComputerReleaseManifestSignaturePayload,
  type ComputerReleaseManifest,
  type ComputerReleaseManifestTarget,
} from "./computer-release-source.ts";

const MAX_RELEASE_BYTES = 8 * 1_024 * 1_024 * 1_024;
const MAX_SIGNING_KEY_BYTES = 64 * 1_024;
const PLATFORM_KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const RELEASE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u;
const COPY_BUFFER_BYTES = 256 * 1_024;

export type ComputerReleasePublisherErrorCode =
  | "artifact_invalid"
  | "immutable_conflict"
  | "pointer_invalid"
  | "pointer_rollback"
  | "publication_invalid"
  | "publication_locked"
  | "signing_key_invalid"
  | "target_invalid";

export class ComputerReleasePublisherError extends Error {
  readonly code: ComputerReleasePublisherErrorCode;

  constructor(code: ComputerReleasePublisherErrorCode, message: string) {
    super(message);
    this.name = "ComputerReleasePublisherError";
    this.code = code;
  }
}

export type ComputerReleasePublicationTarget = Readonly<{
  artifactPath: string;
  file: string;
  platformKey: string;
}>;

export type ComputerReleasePublication = Readonly<{
  manifestPath: string;
  pointerPath: string;
  releaseDirectory: string;
  targets: Readonly<Record<string, ComputerReleaseManifestTarget>>;
  version: string;
}>;

export type PublishComputerReleaseOptions = Readonly<{
  privateKeyPath: string;
  rootDirectory: string;
  targets: readonly ComputerReleasePublicationTarget[];
  version: string;
}>;

/**
 * Publishes one immutable signed Computer release into a local owner-private
 * staging tree. Immutable artifacts and their signed manifest become durable
 * before the mutable latest-version pointer is atomically replaced.
 */
export async function publishComputerRelease(
  options: PublishComputerReleaseOptions,
): Promise<ComputerReleasePublication> {
  const version = validateVersion(options.version);
  const rootDirectory = absolutePath(
    options.rootDirectory,
    "release root directory",
    "publication_invalid",
  );
  const privateKeyPath = absolutePath(
    options.privateKeyPath,
    "release private key",
    "signing_key_invalid",
  );
  const targets = validateTargets(options.targets);
  const privateKey = await readPrivateSigningKey(privateKeyPath);
  await ensurePrivateDirectory(rootDirectory);

  const lockPath = join(rootDirectory, ".publish.lock");
  const lock = await acquirePublicationLock(lockPath);
  try {
    const pointerPath = join(rootDirectory, "manifest.json");
    const currentVersion = await readCurrentPointer(pointerPath);
    if (
      currentVersion !== null &&
      compareComputerReleaseVersions(version, currentVersion) < 0
    ) {
      throw publisherError(
        "pointer_rollback",
        "release pointer cannot move to an older version",
      );
    }

    const releaseDirectory = join(rootDirectory, version);
    await ensurePrivateDirectory(releaseDirectory);
    const manifestTargets: Record<string, ComputerReleaseManifestTarget> = {};
    for (const target of targets) {
      const published = await publishArtifact(
        target.artifactPath,
        join(releaseDirectory, target.file),
      );
      manifestTargets[target.platformKey] = Object.freeze({
        file: target.file,
        sha256: published.sha256,
        size: published.size,
      });
    }

    const manifest: ComputerReleaseManifest = Object.freeze({
      schemaVersion: 1,
      targets: Object.freeze(manifestTargets),
      version,
    });
    const signature = sign(
      null,
      createComputerReleaseManifestSignaturePayload(manifest),
      privateKey,
    ).toString("base64");
    const manifestBytes = Buffer.from(
      `${JSON.stringify({
        schemaVersion: manifest.schemaVersion,
        signature,
        targets: manifest.targets,
        version: manifest.version,
      })}\n`,
      "utf8",
    );
    const manifestPath = join(releaseDirectory, "manifest.json");
    await publishImmutableBytes(manifestPath, manifestBytes);
    await publishPointer(pointerPath, version);

    return Object.freeze({
      manifestPath,
      pointerPath,
      releaseDirectory,
      targets: manifest.targets,
      version,
    });
  } finally {
    await lock.close().catch(() => undefined);
    await rm(lockPath, { force: true });
    await syncDirectory(rootDirectory);
  }
}

async function readPrivateSigningKey(path: string): Promise<KeyObject> {
  const handle = await openSafeRegularFile(
    path,
    "signing_key_invalid",
    "release private key",
  );
  try {
    const stat = await handle.stat();
    requireOwned(stat.uid, "signing_key_invalid", "release private key");
    if ((stat.mode & 0o077) !== 0) {
      throw publisherError(
        "signing_key_invalid",
        "release private key must be owner-private",
      );
    }
    if (stat.size <= 0 || stat.size > MAX_SIGNING_KEY_BYTES) {
      throw publisherError(
        "signing_key_invalid",
        "release private key size is invalid",
      );
    }
    let key: KeyObject;
    try {
      key = createPrivateKey(await handle.readFile());
    } catch {
      throw publisherError(
        "signing_key_invalid",
        "release private key could not be parsed",
      );
    }
    if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") {
      throw publisherError(
        "signing_key_invalid",
        "release private key must be Ed25519",
      );
    }
    return key;
  } finally {
    await handle.close();
  }
}

function validateTargets(
  values: readonly ComputerReleasePublicationTarget[],
): readonly ComputerReleasePublicationTarget[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > 64) {
    throw publisherError(
      "target_invalid",
      "release publication requires between 1 and 64 targets",
    );
  }
  const platformKeys = new Set<string>();
  const files = new Set<string>();
  const normalized = values.map((value) => {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.keys(value).sort().join(",") !== "artifactPath,file,platformKey" ||
      typeof value.platformKey !== "string" ||
      !PLATFORM_KEY.test(value.platformKey) ||
      typeof value.file !== "string" ||
      !RELEASE_FILE.test(value.file) ||
      value.file === "." ||
      value.file === ".."
    ) {
      throw publisherError("target_invalid", "release target is invalid");
    }
    if (platformKeys.has(value.platformKey) || files.has(value.file)) {
      throw publisherError(
        "target_invalid",
        "release target platform keys and file names must be unique",
      );
    }
    platformKeys.add(value.platformKey);
    files.add(value.file);
    return Object.freeze({
      artifactPath: absolutePath(
        value.artifactPath,
        `release artifact ${value.platformKey}`,
        "artifact_invalid",
      ),
      file: value.file,
      platformKey: value.platformKey,
    });
  });
  normalized.sort((left, right) =>
    left.platformKey.localeCompare(right.platformKey),
  );
  return Object.freeze(normalized);
}

async function acquirePublicationLock(path: string): Promise<FileHandle> {
  try {
    const handle = await open(
      path,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(`${String(process.pid)}\n`);
    await handle.sync();
    return handle;
  } catch (error) {
    if (hasCode(error, "EEXIST")) {
      throw publisherError(
        "publication_locked",
        "another release publication is active or needs operator recovery",
      );
    }
    throw error;
  }
}

async function readCurrentPointer(path: string): Promise<string | null> {
  let bytes: Buffer;
  try {
    const handle = await openSafeRegularFile(
      path,
      "pointer_invalid",
      "release pointer",
    );
    try {
      const stat = await handle.stat();
      requireOwned(stat.uid, "pointer_invalid", "release pointer");
      if ((stat.mode & 0o077) !== 0 || stat.size <= 0 || stat.size > 4_096) {
        throw publisherError(
          "pointer_invalid",
          "release pointer storage is not owner-private and bounded",
        );
      }
      bytes = await handle.readFile();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw publisherError("pointer_invalid", "release pointer is not JSON");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "schemaVersion,version"
  ) {
    throw publisherError("pointer_invalid", "release pointer is not strict");
  }
  const pointer = value as { schemaVersion?: unknown; version?: unknown };
  if (pointer.schemaVersion !== 1 || typeof pointer.version !== "string") {
    throw publisherError("pointer_invalid", "release pointer is not strict");
  }
  try {
    return validateVersion(pointer.version);
  } catch {
    throw publisherError(
      "pointer_invalid",
      "release pointer version is invalid",
    );
  }
}

async function publishArtifact(
  sourcePath: string,
  destinationPath: string,
): Promise<Readonly<{ sha256: string; size: number }>> {
  const source = await openSafeRegularFile(
    sourcePath,
    "artifact_invalid",
    "release artifact",
  );
  let output: FileHandle | undefined;
  const temporaryPath = `${destinationPath}.tmp-${String(process.pid)}-${randomUUID()}`;
  try {
    const before = await source.stat();
    if (before.size <= 0 || before.size > MAX_RELEASE_BYTES) {
      throw publisherError(
        "artifact_invalid",
        "release artifact size is invalid",
      );
    }
    output = await open(
      temporaryPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    let offset = 0;
    while (offset < before.size) {
      const length = Math.min(buffer.byteLength, before.size - offset);
      const { bytesRead } = await source.read(buffer, 0, length, offset);
      if (bytesRead <= 0) {
        throw publisherError(
          "artifact_invalid",
          "release artifact ended before its observed size",
        );
      }
      digest.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        const result = await output.write(
          buffer,
          written,
          bytesRead - written,
          offset + written,
        );
        if (result.bytesWritten <= 0) {
          throw publisherError(
            "artifact_invalid",
            "release artifact could not be staged",
          );
        }
        written += result.bytesWritten;
      }
      offset += bytesRead;
    }
    const after = await source.stat();
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    ) {
      throw publisherError(
        "artifact_invalid",
        "release artifact changed while it was being staged",
      );
    }
    const sha256 = digest.digest("hex");
    await output.chmod(0o600);
    await output.sync();
    await output.close();
    output = undefined;
    try {
      await link(temporaryPath, destinationPath);
      await syncDirectory(dirname(destinationPath));
    } catch (error) {
      if (
        !hasCode(error, "EEXIST") ||
        !(await existingArtifactMatches(destinationPath, sha256, before.size))
      ) {
        if (hasCode(error, "EEXIST")) {
          throw publisherError(
            "immutable_conflict",
            "published release artifact conflicts with immutable bytes",
          );
        }
        throw error;
      }
    }
    return Object.freeze({ sha256, size: before.size });
  } finally {
    await source.close();
    await output?.close();
    await rm(temporaryPath, { force: true });
  }
}

async function existingArtifactMatches(
  path: string,
  expectedSha256: string,
  expectedSize: number,
): Promise<boolean> {
  const handle = await openSafeRegularFile(
    path,
    "immutable_conflict",
    "published release artifact",
  );
  try {
    const stat = await handle.stat();
    requireOwned(stat.uid, "immutable_conflict", "published release artifact");
    if ((stat.mode & 0o077) !== 0 || stat.size !== expectedSize) return false;
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    let position = 0;
    while (position < stat.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.byteLength, stat.size - position),
        position,
      );
      if (bytesRead <= 0) return false;
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return digest.digest("hex") === expectedSha256;
  } finally {
    await handle.close();
  }
}

async function publishImmutableBytes(
  destinationPath: string,
  bytes: Buffer,
): Promise<void> {
  const temporaryPath = `${destinationPath}.tmp-${String(process.pid)}-${randomUUID()}`;
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
    await handle.writeFile(bytes);
    await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporaryPath, destinationPath);
      await syncDirectory(dirname(destinationPath));
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      const existing = await readOwnerPrivateFile(
        destinationPath,
        "immutable_conflict",
        "signed release manifest",
        256 * 1_024,
      );
      if (!existing.equals(bytes)) {
        throw publisherError(
          "immutable_conflict",
          "signed release manifest conflicts with immutable bytes",
        );
      }
    }
  } finally {
    await handle?.close();
    await rm(temporaryPath, { force: true });
  }
}

async function publishPointer(path: string, version: string): Promise<void> {
  const bytes = Buffer.from(
    `${JSON.stringify({ schemaVersion: 1, version })}\n`,
    "utf8",
  );
  if (await pathExists(path)) {
    const current = await readCurrentPointer(path);
    if (current === version) {
      const existing = await readOwnerPrivateFile(
        path,
        "pointer_invalid",
        "release pointer",
        4_096,
      );
      if (!existing.equals(bytes)) {
        throw publisherError(
          "pointer_invalid",
          "release pointer bytes are not canonical",
        );
      }
      return;
    }
    if (
      current !== null &&
      compareComputerReleaseVersions(version, current) < 0
    ) {
      throw publisherError(
        "pointer_rollback",
        "release pointer cannot move to an older version",
      );
    }
  }
  const temporaryPath = `${path}.tmp-${String(process.pid)}-${randomUUID()}`;
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
    await handle.writeFile(bytes);
    await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
    await syncDirectory(dirname(path));
  } finally {
    await handle?.close();
    await rm(temporaryPath, { force: true });
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw publisherError(
      "publication_invalid",
      "release publication directory must be a real directory",
    );
  }
  requireOwned(
    stat.uid,
    "publication_invalid",
    "release publication directory",
  );
  if ((stat.mode & 0o077) !== 0) {
    throw publisherError(
      "publication_invalid",
      "release publication directory must be owner-private",
    );
  }
}

async function readOwnerPrivateFile(
  path: string,
  code: ComputerReleasePublisherErrorCode,
  name: string,
  maxBytes: number,
): Promise<Buffer> {
  const handle = await openSafeRegularFile(path, code, name);
  try {
    const stat = await handle.stat();
    requireOwned(stat.uid, code, name);
    if ((stat.mode & 0o077) !== 0 || stat.size <= 0 || stat.size > maxBytes) {
      throw publisherError(code, `${name} is not owner-private and bounded`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function openSafeRegularFile(
  path: string,
  code: ComputerReleasePublisherErrorCode,
  name: string,
): Promise<FileHandle> {
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (hasCode(error, "ELOOP")) {
      throw publisherError(code, `${name} cannot be a symbolic link`);
    }
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw publisherError(code, `${name} must be a regular file`);
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

function requireOwned(
  uid: number,
  code: ComputerReleasePublisherErrorCode,
  name: string,
): void {
  const currentUid = process.getuid?.();
  if (currentUid !== undefined && uid !== currentUid) {
    throw publisherError(code, `${name} must be owned by the current user`);
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

function validateVersion(value: string): string {
  try {
    compareComputerReleaseVersions(value, value);
    return value;
  } catch {
    throw publisherError(
      "publication_invalid",
      "release version must be strict semver",
    );
  }
}

function absolutePath(
  value: string,
  name: string,
  code: ComputerReleasePublisherErrorCode,
): string {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    value.includes("\0") ||
    basename(value).length === 0
  ) {
    throw publisherError(code, `${name} must be an absolute path`);
  }
  return resolve(value);
}

function publisherError(
  code: ComputerReleasePublisherErrorCode,
  message: string,
): ComputerReleasePublisherError {
  return new ComputerReleasePublisherError(code, message);
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
