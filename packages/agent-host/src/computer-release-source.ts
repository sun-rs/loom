import { createHash, randomUUID, verify, type KeyLike } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";

const MAX_MANIFEST_BYTES = 256 * 1_024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_ARTIFACT_DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_ARTIFACT_STALL_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RELEASE_BYTES = 8 * 1_024 * 1_024 * 1_024;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const PLATFORM_KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const RELEASE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;

export type ComputerReleaseSourceErrorCode =
  | "manifest_invalid"
  | "manifest_signature_invalid"
  | "artifact_download_failed"
  | "artifact_invalid"
  | "size_unattested"
  | "source_unavailable"
  | "target_unsupported"
  | "version_invalid";

export class ComputerReleaseSourceError extends Error {
  readonly code: ComputerReleaseSourceErrorCode;

  constructor(code: ComputerReleaseSourceErrorCode, message: string) {
    super(message);
    this.name = "ComputerReleaseSourceError";
    this.code = code;
  }
}

export type ComputerReleaseManifestTarget = Readonly<{
  file: string;
  sha256: string;
  size: number;
}>;

export type ComputerReleaseManifest = Readonly<{
  schemaVersion: 1;
  targets: Readonly<Record<string, ComputerReleaseManifestTarget>>;
  version: string;
}>;

export type VerifiedComputerRelease = Readonly<{
  file: string;
  platformKey: string;
  sha256: string;
  size: number;
  url: string;
  version: string;
}>;

export type VerifiedComputerReleaseArtifact = VerifiedComputerRelease &
  Readonly<{ path: string }>;

export type ComputerReleaseSourceOptions = Readonly<{
  artifactDownloadTimeoutMs?: number;
  artifactStallTimeoutMs?: number;
  baseUrl: string;
  fetch?: typeof fetch;
  maxReleaseBytes?: number;
  publicKey: KeyLike;
  timeoutMs?: number;
}>;

/**
 * Reads a minimal HTTPS release catalog and verifies each version manifest
 * with a pinned Ed25519 public key. The transport cannot replace an absent
 * signed size with Content-Length, and neither the catalog nor a remote
 * operation can supply a local path or command.
 */
export class ComputerReleaseSource {
  readonly #artifactDownloadTimeoutMs: number;
  readonly #artifactStallTimeoutMs: number;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #maxReleaseBytes: number;
  readonly #publicKey: KeyLike;
  readonly #timeoutMs: number;

  constructor(options: ComputerReleaseSourceOptions) {
    this.#artifactDownloadTimeoutMs = positiveInteger(
      options.artifactDownloadTimeoutMs ?? DEFAULT_ARTIFACT_DOWNLOAD_TIMEOUT_MS,
      "artifactDownloadTimeoutMs",
    );
    this.#artifactStallTimeoutMs = positiveInteger(
      options.artifactStallTimeoutMs ?? DEFAULT_ARTIFACT_STALL_TIMEOUT_MS,
      "artifactStallTimeoutMs",
    );
    this.#baseUrl = validateBaseUrl(options.baseUrl);
    this.#fetch = options.fetch ?? fetch;
    this.#maxReleaseBytes = positiveInteger(
      options.maxReleaseBytes ?? DEFAULT_MAX_RELEASE_BYTES,
      "maxReleaseBytes",
    );
    this.#publicKey = options.publicKey;
    this.#timeoutMs = positiveInteger(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      "timeoutMs",
    );
  }

  async checkForUpdate(input: {
    currentVersion: string;
    platformKey: string;
  }): Promise<VerifiedComputerRelease | null> {
    const currentVersion = validateVersion(input.currentVersion);
    const platformKey = validatePlatformKey(input.platformKey);
    const pointer = parseReleasePointer(
      await this.#fetchJson(`${this.#baseUrl}/manifest.json`),
    );
    if (compareComputerReleaseVersions(pointer.version, currentVersion) <= 0) {
      return null;
    }
    return await this.fetchRelease(pointer.version, { platformKey });
  }

  async fetchRelease(
    untrustedVersion: string,
    input: { platformKey: string },
  ): Promise<VerifiedComputerRelease> {
    const version = validateVersion(untrustedVersion);
    const platformKey = validatePlatformKey(input.platformKey);
    const manifestUrl = `${this.#baseUrl}/${version}/manifest.json`;
    const signed = parseSignedManifest(
      await this.#fetchJson(manifestUrl),
      this.#maxReleaseBytes,
    );
    if (signed.manifest.version !== version) {
      throw sourceError(
        "manifest_invalid",
        "release manifest version does not match its immutable path",
      );
    }
    if (
      !verify(
        null,
        createComputerReleaseManifestSignaturePayload(signed.manifest),
        this.#publicKey,
        signed.signature,
      )
    ) {
      throw sourceError(
        "manifest_signature_invalid",
        "release manifest signature is invalid",
      );
    }
    const target = signed.manifest.targets[platformKey];
    if (target === undefined) {
      throw sourceError(
        "target_unsupported",
        `release manifest has no target for ${platformKey}`,
      );
    }
    return Object.freeze({
      file: target.file,
      platformKey,
      sha256: target.sha256,
      size: target.size,
      url: `${this.#baseUrl}/${version}/${target.file}`,
      version,
    });
  }

  async downloadVerifiedRelease(input: {
    destinationPath: string;
    platformKey: string;
    version: string;
  }): Promise<VerifiedComputerReleaseArtifact> {
    const release = await this.fetchRelease(input.version, {
      platformKey: input.platformKey,
    });
    return await this.materializeVerifiedRelease({
      destinationPath: input.destinationPath,
      release,
    });
  }

  async materializeVerifiedRelease(input: {
    destinationPath: string;
    onProgress?: (downloaded: number, total: number) => void;
    release: VerifiedComputerRelease;
  }): Promise<VerifiedComputerReleaseArtifact> {
    const release = validateVerifiedRelease(
      input.release,
      this.#baseUrl,
      this.#maxReleaseBytes,
    );
    const destinationPath = validateDestinationPath(input.destinationPath);
    const directory = dirname(destinationPath);
    await requireOwnerPrivateDirectory(directory);
    if (await pathExists(destinationPath)) {
      await verifyArtifactFile(destinationPath, release);
      input.onProgress?.(release.size, release.size);
      return Object.freeze({ ...release, path: destinationPath });
    }

    let response: Response;
    const downloadDeadlineMs = Date.now() + this.#artifactDownloadTimeoutMs;
    try {
      response = await this.#fetch(release.url, {
        headers: { accept: "application/octet-stream" },
        signal: AbortSignal.timeout(this.#artifactDownloadTimeoutMs),
      });
    } catch {
      throw sourceError(
        "artifact_download_failed",
        "Computer release artifact is unavailable",
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw sourceError(
        "artifact_download_failed",
        `Computer release artifact returned HTTP ${String(response.status)}`,
      );
    }
    if (
      response.url.length > 0 &&
      new URL(response.url).protocol !== "https:"
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw sourceError(
        "artifact_download_failed",
        "Computer release artifact redirected outside HTTPS",
      );
    }

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
      input.onProgress?.(0, release.size);
      await streamVerifiedArtifact(
        response,
        handle,
        release,
        {
          deadlineMs: downloadDeadlineMs,
          stallTimeoutMs: this.#artifactStallTimeoutMs,
        },
        input.onProgress,
      );
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        await link(temporaryPath, destinationPath);
      } catch (error) {
        if (!hasErrorCode(error, "EEXIST")) throw error;
        await verifyArtifactFile(destinationPath, release);
      }
      await syncDirectory(directory);
    } catch (error) {
      if (error instanceof ComputerReleaseSourceError) throw error;
      throw sourceError(
        "artifact_invalid",
        "Computer release artifact could not be stored safely",
      );
    } finally {
      await handle?.close();
      await response.body?.cancel().catch(() => undefined);
      await rm(temporaryPath, { force: true });
    }
    await verifyArtifactFile(destinationPath, release);
    return Object.freeze({ ...release, path: destinationPath });
  }

  async #fetchJson(url: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw sourceError(
        "source_unavailable",
        "Computer release source is unavailable",
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw sourceError(
        "source_unavailable",
        `Computer release source returned HTTP ${String(response.status)}`,
      );
    }
    return await readBoundedJson(response);
  }
}

export function createComputerReleaseManifestSignaturePayload(
  manifest: ComputerReleaseManifest,
): Buffer {
  const targets: Record<string, ComputerReleaseManifestTarget> = {};
  for (const platformKey of Object.keys(manifest.targets).sort()) {
    const target = manifest.targets[platformKey];
    if (target === undefined) continue;
    targets[platformKey] = {
      file: target.file,
      sha256: target.sha256,
      size: target.size,
    };
  }
  return Buffer.from(
    JSON.stringify({
      schemaVersion: manifest.schemaVersion,
      targets,
      version: manifest.version,
    }),
    "utf8",
  );
}

export function compareComputerReleaseVersions(
  left: string,
  right: string,
): -1 | 0 | 1 {
  const first = parseVersion(left);
  const second = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const a = first.numbers[index] ?? 0n;
    const b = second.numbers[index] ?? 0n;
    if (a !== b) return a < b ? -1 : 1;
  }
  if (first.prerelease === null && second.prerelease === null) return 0;
  if (first.prerelease === null) return 1;
  if (second.prerelease === null) return -1;
  const count = Math.min(first.prerelease.length, second.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    const a = first.prerelease[index] ?? "";
    const b = second.prerelease[index] ?? "";
    if (a === b) continue;
    const aNumeric = /^\d+$/u.test(a);
    const bNumeric = /^\d+$/u.test(b);
    if (aNumeric && bNumeric) return BigInt(a) < BigInt(b) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a < b ? -1 : 1;
  }
  if (first.prerelease.length === second.prerelease.length) return 0;
  return first.prerelease.length < second.prerelease.length ? -1 : 1;
}

type ParsedVersion = Readonly<{
  numbers: readonly [bigint, bigint, bigint];
  prerelease: readonly string[] | null;
}>;

function parseVersion(value: string): ParsedVersion {
  const match = SEMVER.exec(value);
  if (match === null) {
    throw sourceError(
      "version_invalid",
      "Computer release version must be strict x.y.z(-pre) semver",
    );
  }
  const prerelease = match[4]?.split(".") ?? null;
  if (
    prerelease?.some(
      (identifier) =>
        /^\d+$/u.test(identifier) &&
        identifier.length > 1 &&
        identifier.startsWith("0"),
    )
  ) {
    throw sourceError(
      "version_invalid",
      "Computer release numeric prerelease identifiers cannot be zero-padded",
    );
  }
  return Object.freeze({
    numbers: Object.freeze([
      BigInt(match[1]!),
      BigInt(match[2]!),
      BigInt(match[3]!),
    ] as const),
    prerelease: prerelease === null ? null : Object.freeze(prerelease),
  });
}

function validateVersion(value: string): string {
  compareComputerReleaseVersions(value, value);
  return value;
}

function parseReleasePointer(value: unknown): Readonly<{ version: string }> {
  const pointer = record(value, "release pointer");
  exactKeys(pointer, ["schemaVersion", "version"], "release pointer");
  if (pointer.schemaVersion !== 1) {
    throw sourceError("manifest_invalid", "unsupported release pointer schema");
  }
  return Object.freeze({ version: validateVersion(pointer.version as string) });
}

function parseSignedManifest(
  value: unknown,
  maxReleaseBytes: number,
): Readonly<{ manifest: ComputerReleaseManifest; signature: Buffer }> {
  const envelope = record(value, "signed release manifest");
  exactKeys(
    envelope,
    ["schemaVersion", "signature", "targets", "version"],
    "signed release manifest",
  );
  if (envelope.schemaVersion !== 1) {
    throw sourceError(
      "manifest_invalid",
      "unsupported release manifest schema",
    );
  }
  const version = validateVersion(envelope.version as string);
  const targetsValue = record(envelope.targets, "release targets");
  const platformKeys = Object.keys(targetsValue).sort();
  if (platformKeys.length === 0 || platformKeys.length > 64) {
    throw sourceError(
      "manifest_invalid",
      "release manifest targets must contain between 1 and 64 entries",
    );
  }
  const targets: Record<string, ComputerReleaseManifestTarget> = {};
  for (const platformKey of platformKeys) {
    validatePlatformKey(platformKey);
    const target = record(
      targetsValue[platformKey],
      `release target ${platformKey}`,
    );
    exactKeys(
      target,
      ["file", "sha256", "size"],
      `release target ${platformKey}`,
      Object.hasOwn(target, "size") ? "manifest_invalid" : "size_unattested",
    );
    if (
      typeof target.size !== "number" ||
      !Number.isSafeInteger(target.size) ||
      target.size <= 0 ||
      target.size > maxReleaseBytes
    ) {
      throw sourceError(
        "size_unattested",
        `release target ${platformKey} has no acceptable signed size`,
      );
    }
    if (
      typeof target.file !== "string" ||
      !RELEASE_FILE.test(target.file) ||
      target.file === "." ||
      target.file === ".."
    ) {
      throw sourceError(
        "manifest_invalid",
        `release target ${platformKey} has an unsafe file name`,
      );
    }
    if (typeof target.sha256 !== "string" || !SHA256.test(target.sha256)) {
      throw sourceError(
        "manifest_invalid",
        `release target ${platformKey} has an invalid SHA-256`,
      );
    }
    targets[platformKey] = Object.freeze({
      file: target.file,
      sha256: target.sha256,
      size: target.size,
    });
  }
  const signature = parseSignature(envelope.signature);
  return Object.freeze({
    manifest: Object.freeze({
      schemaVersion: 1,
      targets: Object.freeze(targets),
      version,
    }),
    signature,
  });
}

function parseSignature(value: unknown): Buffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !BASE64.test(value)
  ) {
    throw sourceError(
      "manifest_signature_invalid",
      "release manifest signature encoding is invalid",
    );
  }
  const signature = Buffer.from(value, "base64");
  if (signature.byteLength !== 64 || signature.toString("base64") !== value) {
    throw sourceError(
      "manifest_signature_invalid",
      "release manifest signature length is invalid",
    );
  }
  return signature;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const body = response.body;
  if (body === null) {
    throw sourceError("source_unavailable", "release source returned no body");
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = Buffer.from(result.value);
      bytes += chunk.byteLength;
      if (bytes > MAX_MANIFEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw sourceError(
          "manifest_invalid",
          "release manifest exceeds 256 KiB",
        );
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof ComputerReleaseSourceError) throw error;
    throw sourceError(
      "source_unavailable",
      "release manifest body could not be read",
    );
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")) as unknown;
  } catch {
    throw sourceError("manifest_invalid", "release manifest is not JSON");
  }
}

async function streamVerifiedArtifact(
  response: Response,
  handle: FileHandle,
  release: VerifiedComputerRelease,
  timeout: Readonly<{ deadlineMs: number; stallTimeoutMs: number }>,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  const body = response.body;
  if (body === null) {
    throw sourceError(
      "artifact_download_failed",
      "release artifact has no body",
    );
  }
  const reader = body.getReader();
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    while (true) {
      const remainingMs = timeout.deadlineMs - Date.now();
      if (remainingMs <= 0) {
        await reader.cancel().catch(() => undefined);
        throw sourceError(
          "artifact_download_failed",
          "release artifact exceeded its total download budget",
        );
      }
      const result = await readArtifactChunk(
        reader,
        Math.min(timeout.stallTimeoutMs, remainingMs),
      );
      if (result.done) break;
      const chunk = Buffer.from(result.value);
      bytes += chunk.byteLength;
      if (bytes > release.size) {
        await reader.cancel().catch(() => undefined);
        throw sourceError(
          "artifact_invalid",
          "release artifact exceeds its signed size",
        );
      }
      hash.update(chunk);
      await writeAll(handle, chunk);
      onProgress?.(bytes, release.size);
    }
  } catch (error) {
    if (error instanceof ComputerReleaseSourceError) throw error;
    throw sourceError(
      "artifact_download_failed",
      "release artifact body could not be read",
    );
  } finally {
    reader.releaseLock();
  }
  if (bytes !== release.size || hash.digest("hex") !== release.sha256) {
    throw sourceError(
      "artifact_invalid",
      "release artifact does not match its signed size and SHA-256",
    );
  }
}

async function readArtifactChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<
  Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>
> {
  const timeout = new Error("artifact read stalled");
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(timeout), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error !== timeout) throw error;
    await reader.cancel().catch(() => undefined);
    throw sourceError(
      "artifact_download_failed",
      "release artifact made no progress before the stall timeout",
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function writeAll(handle: FileHandle, chunk: Buffer): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const written = await handle.write(
      chunk,
      offset,
      chunk.byteLength - offset,
      null,
    );
    if (written.bytesWritten <= 0) {
      throw sourceError(
        "artifact_invalid",
        "release artifact staging made no write progress",
      );
    }
    offset += written.bytesWritten;
  }
}

async function verifyArtifactFile(
  path: string,
  release: VerifiedComputerRelease,
): Promise<void> {
  await rejectSymbolicLink(path);
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      (metadata.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" &&
        metadata.uid !== process.getuid()) ||
      metadata.size !== release.size
    ) {
      throw sourceError(
        "artifact_invalid",
        "staged release artifact metadata is invalid",
      );
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1_024);
    let position = 0;
    while (position < release.size) {
      const read = await handle.read(
        buffer,
        0,
        Math.min(buffer.byteLength, release.size - position),
        position,
      );
      if (read.bytesRead === 0) break;
      hash.update(buffer.subarray(0, read.bytesRead));
      position += read.bytesRead;
    }
    if (position !== release.size || hash.digest("hex") !== release.sha256) {
      throw sourceError(
        "artifact_invalid",
        "staged release artifact bytes are invalid",
      );
    }
  } catch (error) {
    if (error instanceof ComputerReleaseSourceError) throw error;
    if (hasErrorCode(error, "ELOOP")) {
      throw sourceError(
        "artifact_invalid",
        "staged release artifact must not be a symbolic link",
      );
    }
    throw sourceError(
      "artifact_invalid",
      "staged release artifact cannot be verified",
    );
  } finally {
    await handle?.close();
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
    throw sourceError(
      "artifact_invalid",
      "release staging directory must be owner-private",
    );
  }
}

async function rejectSymbolicLink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw sourceError(
        "artifact_invalid",
        "staged release artifact must not be a symbolic link",
      );
    }
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return;
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
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

function validateDestinationPath(value: string): string {
  if (
    !isAbsolute(value) ||
    value.includes("\0") ||
    basename(value).length === 0
  ) {
    throw sourceError(
      "artifact_invalid",
      "release destination path must be an absolute file path",
    );
  }
  return resolve(value);
}

function validateVerifiedRelease(
  value: unknown,
  baseUrl: string,
  maxReleaseBytes: number,
): VerifiedComputerRelease {
  const release = record(value, "verified release descriptor");
  exactKeys(
    release,
    ["file", "platformKey", "sha256", "size", "url", "version"],
    "verified release descriptor",
  );
  const version = validateVersion(release.version as string);
  const platformKey = validatePlatformKey(release.platformKey as string);
  if (
    typeof release.file !== "string" ||
    !RELEASE_FILE.test(release.file) ||
    release.file === "." ||
    release.file === ".."
  ) {
    throw sourceError(
      "artifact_invalid",
      "verified release descriptor has an unsafe file name",
    );
  }
  if (typeof release.sha256 !== "string" || !SHA256.test(release.sha256)) {
    throw sourceError(
      "artifact_invalid",
      "verified release descriptor has an invalid SHA-256",
    );
  }
  if (
    typeof release.size !== "number" ||
    !Number.isSafeInteger(release.size) ||
    release.size <= 0 ||
    release.size > maxReleaseBytes
  ) {
    throw sourceError(
      "artifact_invalid",
      "verified release descriptor has an invalid signed size",
    );
  }
  const expectedUrl = `${baseUrl}/${version}/${release.file}`;
  if (release.url !== expectedUrl) {
    throw sourceError(
      "artifact_invalid",
      "verified release descriptor does not belong to this source",
    );
  }
  return Object.freeze({
    file: release.file,
    platformKey,
    sha256: release.sha256,
    size: release.size,
    url: expectedUrl,
    version,
  });
}

function validateBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw sourceError("source_unavailable", "release base URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw sourceError(
      "source_unavailable",
      "release base URL must be credential-free HTTPS",
    );
  }
  return url.toString().replace(/\/$/u, "");
}

function validatePlatformKey(value: string): string {
  if (!PLATFORM_KEY.test(value)) {
    throw sourceError("manifest_invalid", "platform key is invalid");
  }
  return value;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw sourceError("manifest_invalid", `${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  name: string,
  missingCode: ComputerReleaseSourceErrorCode = "manifest_invalid",
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw sourceError(missingCode, `${name} has unexpected or missing fields`);
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw sourceError("manifest_invalid", `${name} must be a positive integer`);
  }
  return value;
}

function sourceError(
  code: ComputerReleaseSourceErrorCode,
  message: string,
): ComputerReleaseSourceError {
  return new ComputerReleaseSourceError(code, message);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
