import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { compareComputerReleaseVersions } from "./computer-release-source.ts";
import type { VerifiedMacOSComputerInstallArtifact } from "./macos-computer-installer.ts";
import {
  createMacOSComputerProvisioning,
  type MacOSComputerProvisioningInput,
} from "./macos-computer-provisioning.ts";

const MAX_REQUEST_BYTES = 1_024 * 1_024;
const MAX_ARTIFACT_BYTES = 1_024 * 1_024 * 1_024;
const SHA256 = /^[0-9a-f]{64}$/u;

const REQUEST_KEYS = Object.freeze([
  "provisioning",
  "schemaVersion",
  "serviceArtifact",
  "serviceVersion",
  "supervisorArtifact",
] as const);
const PROVISIONING_KEYS = Object.freeze([
  "executableDirectory",
  "handoffTimeoutMs",
  "label",
  "logDirectory",
  "plistPath",
  "privateConfigurationDirectory",
  "release",
  "service",
  "socketDirectory",
  "stateDirectory",
  "stopTimeoutMs",
  "supervisorControlTimeoutMs",
] as const);
const RELEASE_KEYS = Object.freeze(["baseUrl", "publicKeyPem"] as const);
const ARTIFACT_KEYS = Object.freeze(["path", "sha256", "size"] as const);

export type MacOSComputerInstallRequest = Readonly<{
  provisioning: MacOSComputerProvisioningInput;
  schemaVersion: 1;
  serviceArtifact: VerifiedMacOSComputerInstallArtifact;
  serviceVersion: string;
  supervisorArtifact: VerifiedMacOSComputerInstallArtifact;
}>;

/**
 * Reads the complete operator installation intent from one owner-private file.
 * The request is data only: unknown fields, inline commands, environment, and
 * mutable path aliases are rejected before any installation or launchd work.
 */
export async function readMacOSComputerInstallRequest(
  requestPath: string,
): Promise<MacOSComputerInstallRequest> {
  const path = absolutePath(requestPath, "Computer install request path");
  const handle = await openRequest(path);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new Error("Computer install request must be a regular file");
    }
    if (
      typeof process.getuid === "function" &&
      metadata.uid !== process.getuid()
    ) {
      throw new Error("Computer install request must be owned by this user");
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new Error("Computer install request must be owner-private");
    }
    if (metadata.size <= 0 || metadata.size > MAX_REQUEST_BYTES) {
      throw new Error("Computer install request size is invalid");
    }
    const bytes = await readExact(handle, metadata.size);
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as unknown;
    } catch {
      throw new Error("Computer install request must be valid UTF-8 JSON");
    }
    return parseRequest(parsed);
  } finally {
    await handle.close();
  }
}

async function openRequest(path: string): Promise<FileHandle> {
  try {
    return await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (hasCode(error, "ELOOP")) {
      throw new Error("Computer install request must not be a symbolic link");
    }
    throw error;
  }
}

async function readExact(handle: FileHandle, size: number): Promise<Buffer> {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(bytes, offset, size - offset, offset);
    if (result.bytesRead === 0) {
      throw new Error("Computer install request changed while reading");
    }
    offset += result.bytesRead;
  }
  const metadata = await handle.stat();
  if (metadata.size !== size) {
    throw new Error("Computer install request changed while reading");
  }
  return bytes;
}

function parseRequest(value: unknown): MacOSComputerInstallRequest {
  const request = exactRecord(value, REQUEST_KEYS, "request");
  if (request.schemaVersion !== 1) {
    throw new Error("unsupported Computer install request schema");
  }
  const serviceVersion = releaseVersion(request.serviceVersion);
  const provisioning = provisioningInput(request.provisioning);
  const normalized = createMacOSComputerProvisioning(provisioning);
  if (normalized.serviceConfiguration.buildVersion !== serviceVersion) {
    throw new Error(
      "serviceVersion does not match the Computer service buildVersion",
    );
  }
  return deepFreeze({
    provisioning,
    schemaVersion: 1,
    serviceArtifact: installArtifact(
      request.serviceArtifact,
      "serviceArtifact",
    ),
    serviceVersion,
    supervisorArtifact: installArtifact(
      request.supervisorArtifact,
      "supervisorArtifact",
    ),
  });
}

function provisioningInput(value: unknown): MacOSComputerProvisioningInput {
  const provisioning = exactRecord(
    value,
    PROVISIONING_KEYS,
    "provisioning",
    new Set([
      "handoffTimeoutMs",
      "socketDirectory",
      "stopTimeoutMs",
      "supervisorControlTimeoutMs",
    ]),
  );
  const release = exactRecord(
    provisioning.release,
    RELEASE_KEYS,
    "provisioning.release",
  );
  return deepFreeze({
    executableDirectory: provisioning.executableDirectory,
    ...(provisioning.handoffTimeoutMs === undefined
      ? {}
      : { handoffTimeoutMs: provisioning.handoffTimeoutMs }),
    label: provisioning.label,
    logDirectory: provisioning.logDirectory,
    plistPath: provisioning.plistPath,
    privateConfigurationDirectory: provisioning.privateConfigurationDirectory,
    release: {
      baseUrl: release.baseUrl,
      publicKeyPem: release.publicKeyPem,
    },
    service: provisioning.service,
    ...(provisioning.socketDirectory === undefined
      ? {}
      : { socketDirectory: provisioning.socketDirectory }),
    stateDirectory: provisioning.stateDirectory,
    ...(provisioning.stopTimeoutMs === undefined
      ? {}
      : { stopTimeoutMs: provisioning.stopTimeoutMs }),
    ...(provisioning.supervisorControlTimeoutMs === undefined
      ? {}
      : {
          supervisorControlTimeoutMs: provisioning.supervisorControlTimeoutMs,
        }),
  }) as MacOSComputerProvisioningInput;
}

function installArtifact(
  value: unknown,
  name: string,
): VerifiedMacOSComputerInstallArtifact {
  const artifact = exactRecord(value, ARTIFACT_KEYS, name);
  if (
    !Number.isSafeInteger(artifact.size) ||
    (artifact.size as number) <= 0 ||
    (artifact.size as number) > MAX_ARTIFACT_BYTES ||
    typeof artifact.sha256 !== "string" ||
    !SHA256.test(artifact.sha256)
  ) {
    throw new Error(`${name} descriptor is invalid`);
  }
  return Object.freeze({
    path: absolutePath(artifact.path, `${name}.path`),
    sha256: artifact.sha256,
    size: artifact.size as number,
  });
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  name: string,
  optional = new Set<string>(),
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`Computer install ${name} shape is invalid`);
  }
  const record = value as Record<string, unknown>;
  const expected = new Set(keys);
  if (
    Object.keys(record).some((key) => !expected.has(key)) ||
    keys.some((key) => !optional.has(key) && !Object.hasOwn(record, key))
  ) {
    throw new Error(`Computer install ${name} shape is invalid`);
  }
  return record;
}

function releaseVersion(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("serviceVersion must be strict semver");
  }
  try {
    compareComputerReleaseVersions(value, value);
  } catch {
    throw new Error("serviceVersion must be strict semver");
  }
  return value;
}

function absolutePath(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    value.includes("\0") ||
    value.length > 4_096
  ) {
    throw new Error(`${name} must be an absolute path`);
  }
  return resolve(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
