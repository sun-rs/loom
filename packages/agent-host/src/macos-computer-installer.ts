import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { bootstrapStable, slotArtifactPath } from "@rah-os/k-carrier";

import {
  createMacOSComputerLaunchAgentPlan,
  type MacOSComputerLaunchAgentPlan,
} from "./macos-computer-launch-agent.ts";
import {
  NODE_K_CARRIER_COMPUTER_SUPERVISOR_CONFIGURATION_SCHEMA_VERSION,
  computerServiceSupervisorControlSocketPath,
  normalizeNodeKCarrierComputerSupervisorConfiguration,
  type NodeKCarrierComputerSupervisorConfiguration,
} from "./node-k-carrier-computer-supervisor-process.ts";
import {
  NODE_K_CARRIER_COMPUTER_SERVICE_CONFIGURATION_SCHEMA_VERSION,
  normalizeNodeKCarrierComputerServiceConfiguration,
  type NodeKCarrierComputerServiceConfiguration,
} from "./node-k-carrier-computer-service-entry.ts";
import {
  NODE_K_CARRIER_COMPUTER_SERVICE_OWNERSHIP_HOST_ID,
  NODE_K_CARRIER_COMPUTER_SERVICE_UPGRADE_CONTROL_HOST_ID,
} from "./node-k-carrier-computer-service-process.ts";
import {
  NODE_K_CARRIER_COMPUTER_UPGRADE_PROCESS_CONFIGURATION_SCHEMA_VERSION,
  normalizeNodeKCarrierComputerUpgradeProcessConfiguration,
  type NodeKCarrierComputerUpgradeProcessConfiguration,
} from "./node-k-carrier-computer-upgrade-process.ts";
import { UnixSocketInstanceLock } from "./agent-host-daemon.ts";
import { compareComputerReleaseVersions } from "./computer-release-source.ts";

const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_ARTIFACT_BYTES = 1_024 * 1_024 * 1_024;
const MAX_CONFIGURATION_BYTES = 1024 * 1_024;

export type VerifiedMacOSComputerInstallArtifact = Readonly<{
  path: string;
  sha256: string;
  size: number;
}>;

export type MacOSComputerLaunchAgentInstallInput = Readonly<{
  plan: MacOSComputerLaunchAgentPlan;
  serviceArtifact: VerifiedMacOSComputerInstallArtifact;
  serviceConfiguration: NodeKCarrierComputerServiceConfiguration;
  serviceVersion: string;
  supervisorArtifact: VerifiedMacOSComputerInstallArtifact;
  supervisorConfiguration: NodeKCarrierComputerSupervisorConfiguration;
  upgradeConfiguration: NodeKCarrierComputerUpgradeProcessConfiguration;
}>;

export type MacOSComputerLaunchAgentInstallResult = Readonly<{
  kind: "staged";
  plistPath: string;
  stableArtifactPath: string;
  supervisorExecutablePath: string;
}>;

/** Verifies source bytes without publishing or changing installation state. */
export async function verifyMacOSComputerInstallArtifacts(
  artifacts: readonly VerifiedMacOSComputerInstallArtifact[],
): Promise<void> {
  if (
    !Array.isArray(artifacts) ||
    artifacts.length === 0 ||
    artifacts.length > 8
  ) {
    throw new Error("install artifact set is invalid");
  }
  const verified = new Set<string>();
  for (const artifact of artifacts) {
    const identity = `${artifact.path}\0${artifact.size}\0${artifact.sha256}`;
    if (verified.has(identity)) continue;
    const opened = await openVerifiedArtifact(artifact);
    await opened.handle.close();
    verified.add(identity);
  }
}

/**
 * Stages an installation but deliberately never calls launchctl. The plist is
 * published last, after both signed descriptors, private configurations, and
 * K stable bootstrap are durable. Calling code retains explicit Human control
 * over bootstrap/kickstart and can inspect the staged paths first.
 */
export async function installMacOSComputerLaunchAgentFiles(
  input: MacOSComputerLaunchAgentInstallInput,
): Promise<MacOSComputerLaunchAgentInstallResult> {
  const plan = normalizePlan(input.plan);
  const supervisorConfiguration =
    normalizeNodeKCarrierComputerSupervisorConfiguration(
      input.supervisorConfiguration,
    );
  const serviceConfiguration =
    normalizeNodeKCarrierComputerServiceConfiguration(
      input.serviceConfiguration,
    );
  const upgradeConfiguration =
    normalizeNodeKCarrierComputerUpgradeProcessConfiguration(
      input.upgradeConfiguration,
    );
  validateConfigurationClosure({
    plan,
    serviceConfiguration,
    supervisorConfiguration,
    upgradeConfiguration,
  });
  if (supervisorConfiguration.stateDir !== plan.kStateDirectory) {
    throw new Error("supervisor stateDir does not match the LaunchAgent plan");
  }
  const serviceVersion = releaseVersion(input.serviceVersion);
  if (serviceConfiguration.buildVersion !== serviceVersion) {
    throw new Error(
      "serviceVersion does not match the Computer service buildVersion",
    );
  }
  const supervisorSource = await openVerifiedArtifact(input.supervisorArtifact);
  let serviceSource: OpenVerifiedArtifact | undefined;
  try {
    serviceSource = await openVerifiedArtifact(input.serviceArtifact);
    await Promise.all([
      ensurePrivateDirectory(plan.stateDirectory),
      ensurePrivateDirectory(plan.logDirectory),
      ensurePrivateDirectory(dirname(plan.supervisorConfigurationPath)),
      ensurePrivateDirectory(dirname(plan.supervisorExecutablePath)),
      ensurePrivateDirectory(
        dirname(supervisorConfiguration.serviceConfigurationPath),
      ),
      ensurePrivateDirectory(
        dirname(serviceConfiguration.upgradeConfigurationPath),
      ),
      ensurePrivateDirectory(dirname(upgradeConfiguration.receiptStatePath)),
      ensurePrivateDirectory(dirname(upgradeConfiguration.requestPath)),
      ensurePrivateDirectory(serviceConfiguration.supervisorDirectory),
      ensurePrivateDirectory(plan.kStateDirectory),
      ensureOwnedDirectory(dirname(plan.plistPath)),
      ensurePrivateDirectory(supervisorConfiguration.socketDirectory),
    ]);
    await materializeVerifiedArtifact(
      supervisorSource,
      plan.supervisorExecutablePath,
      0o500,
    );
    await writeExactFile(
      plan.supervisorConfigurationPath,
      Buffer.from(
        `${JSON.stringify({
          configuration: supervisorConfiguration,
          schemaVersion:
            NODE_K_CARRIER_COMPUTER_SUPERVISOR_CONFIGURATION_SCHEMA_VERSION,
        })}\n`,
      ),
      0o600,
    );
    await writeExactFile(
      supervisorConfiguration.serviceConfigurationPath,
      configurationEnvelope(
        NODE_K_CARRIER_COMPUTER_SERVICE_CONFIGURATION_SCHEMA_VERSION,
        serviceConfiguration,
      ),
      0o600,
    );
    await writeExactFile(
      serviceConfiguration.upgradeConfigurationPath,
      configurationEnvelope(
        NODE_K_CARRIER_COMPUTER_UPGRADE_PROCESS_CONFIGURATION_SCHEMA_VERSION,
        upgradeConfiguration,
      ),
      0o600,
    );
    const bootstrapPath = `${plan.kStateDirectory}/.bootstrap-service-${randomUUID()}`;
    try {
      await materializeVerifiedArtifact(serviceSource, bootstrapPath, 0o500);
      await bootstrapStable({
        artifactPath: bootstrapPath,
        stateDir: plan.kStateDirectory,
        version: serviceVersion,
      });
    } finally {
      await rm(bootstrapPath, { force: true });
    }
    await writeExactFile(plan.plistPath, Buffer.from(plan.plist), 0o644);
    return Object.freeze({
      kind: "staged",
      plistPath: plan.plistPath,
      stableArtifactPath: slotArtifactPath(plan.kStateDirectory, "stable"),
      supervisorExecutablePath: plan.supervisorExecutablePath,
    });
  } finally {
    await serviceSource?.handle.close();
    await supervisorSource.handle.close();
  }
}

type OpenVerifiedArtifact = Readonly<{
  handle: FileHandle;
  sha256: string;
  size: number;
}>;

async function openVerifiedArtifact(
  value: VerifiedMacOSComputerInstallArtifact,
): Promise<OpenVerifiedArtifact> {
  const path = absolutePath(value.path, "artifact path");
  if (
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    value.size > MAX_ARTIFACT_BYTES ||
    !SHA256.test(value.sha256)
  ) {
    throw new Error("verified install artifact descriptor is invalid");
  }
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (hasCode(error, "ELOOP")) {
      throw new Error("install artifact must not be a symlink");
    }
    throw error;
  }
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.size !== value.size ||
      (metadata.mode & 0o022) !== 0 ||
      (typeof process.getuid === "function" &&
        metadata.uid !== process.getuid())
    ) {
      throw new Error("install artifact metadata does not match descriptor");
    }
    const observed = await hashHandle(handle, value.size);
    if (observed !== value.sha256) {
      throw new Error("install artifact digest does not match descriptor");
    }
    return Object.freeze({
      handle,
      sha256: value.sha256,
      size: value.size,
    });
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function materializeVerifiedArtifact(
  source: OpenVerifiedArtifact,
  destinationPath: string,
  mode: number,
): Promise<void> {
  const destination = absolutePath(destinationPath, "artifact destination");
  if (
    await existingFileMatches(destination, source.sha256, source.size, mode)
  ) {
    return;
  }
  const temporaryPath = `${destination}.tmp-${String(process.pid)}-${randomUUID()}`;
  let output: FileHandle | undefined;
  try {
    output = await open(
      temporaryPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      mode,
    );
    const copiedDigest = await copyHandle(source.handle, output, source.size);
    if (copiedDigest !== source.sha256) {
      throw new Error("install artifact changed after verification");
    }
    await output.chmod(mode);
    await output.sync();
    await output.close();
    output = undefined;
    try {
      await link(temporaryPath, destination);
      await syncDirectory(dirname(destination));
    } catch (error) {
      if (
        !hasCode(error, "EEXIST") ||
        !(await existingFileMatches(
          destination,
          source.sha256,
          source.size,
          mode,
        ))
      ) {
        throw error;
      }
    }
  } finally {
    await output?.close();
    await rm(temporaryPath, { force: true });
  }
}

async function writeExactFile(
  destinationPath: string,
  bytes: Buffer,
  mode: number,
): Promise<void> {
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_CONFIGURATION_BYTES) {
    throw new Error("install file size is invalid");
  }
  const destination = absolutePath(destinationPath, "install destination");
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (await existingFileMatches(destination, digest, bytes.byteLength, mode)) {
    return;
  }
  const temporaryPath = `${destination}.tmp-${String(process.pid)}-${randomUUID()}`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      temporaryPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      mode,
    );
    await handle.writeFile(bytes);
    await handle.chmod(mode);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporaryPath, destination);
      await syncDirectory(dirname(destination));
    } catch (error) {
      if (
        !hasCode(error, "EEXIST") ||
        !(await existingFileMatches(
          destination,
          digest,
          bytes.byteLength,
          mode,
        ))
      ) {
        throw error;
      }
    }
  } finally {
    await handle?.close();
    await rm(temporaryPath, { force: true });
  }
}

async function existingFileMatches(
  path: string,
  sha256: string,
  size: number,
  mode: number,
): Promise<boolean> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.size !== size ||
      (metadata.mode & 0o777) !== mode ||
      (typeof process.getuid === "function" &&
        metadata.uid !== process.getuid())
    ) {
      throw new Error("installed file conflicts with the requested artifact");
    }
    if ((await hashHandle(handle, size)) !== sha256) {
      throw new Error("installed file conflicts with the requested artifact");
    }
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    if (hasCode(error, "ELOOP")) {
      throw new Error("installed file must not be a symlink");
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function hashHandle(handle: FileHandle, size: number): Promise<string> {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1_024);
  let position = 0;
  while (position < size) {
    const length = Math.min(buffer.byteLength, size - position);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    if (bytesRead <= 0) throw new Error("install artifact ended early");
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
}

async function copyHandle(
  source: FileHandle,
  destination: FileHandle,
  size: number,
): Promise<string> {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1_024);
  let position = 0;
  while (position < size) {
    const length = Math.min(buffer.byteLength, size - position);
    const { bytesRead } = await source.read(buffer, 0, length, position);
    if (bytesRead <= 0) throw new Error("install artifact ended early");
    hash.update(buffer.subarray(0, bytesRead));
    let written = 0;
    while (written < bytesRead) {
      const result = await destination.write(
        buffer,
        written,
        bytesRead - written,
      );
      if (result.bytesWritten <= 0) {
        throw new Error("install artifact could not be written");
      }
      written += result.bytesWritten;
    }
    position += bytesRead;
  }
  return hash.digest("hex");
}

function normalizePlan(
  value: MacOSComputerLaunchAgentPlan,
): MacOSComputerLaunchAgentPlan {
  const normalized = createMacOSComputerLaunchAgentPlan({
    kStateDirectory: value.kStateDirectory,
    label: value.label,
    logDirectory: value.logDirectory,
    plistPath: value.plistPath,
    stateDirectory: value.stateDirectory,
    supervisorConfigurationPath: value.supervisorConfigurationPath,
    supervisorExecutablePath: value.supervisorExecutablePath,
  });
  if (
    normalized.plist !== value.plist ||
    JSON.stringify(normalized.programArguments) !==
      JSON.stringify(value.programArguments)
  ) {
    throw new Error("LaunchAgent plan is inconsistent");
  }
  return normalized;
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error("install private directory is not owner-private");
  }
}

async function ensureOwnedDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o755, recursive: true });
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o022) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error("LaunchAgent directory is not owner-controlled");
  }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function configurationEnvelope(
  schemaVersion: number,
  configuration: object,
): Buffer {
  const bytes = Buffer.from(
    `${JSON.stringify({ configuration, schemaVersion })}\n`,
  );
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_CONFIGURATION_BYTES) {
    throw new Error("install configuration size is invalid");
  }
  return bytes;
}

function validateConfigurationClosure(input: {
  plan: MacOSComputerLaunchAgentPlan;
  serviceConfiguration: NodeKCarrierComputerServiceConfiguration;
  supervisorConfiguration: NodeKCarrierComputerSupervisorConfiguration;
  upgradeConfiguration: NodeKCarrierComputerUpgradeProcessConfiguration;
}): void {
  const {
    plan,
    serviceConfiguration,
    supervisorConfiguration,
    upgradeConfiguration,
  } = input;
  if (
    new Set([
      plan.supervisorConfigurationPath,
      supervisorConfiguration.serviceConfigurationPath,
      serviceConfiguration.upgradeConfigurationPath,
    ]).size !== 3
  ) {
    throw new Error("Computer private configuration paths must be distinct");
  }
  if (
    supervisorConfiguration.stateDir !== plan.kStateDirectory ||
    upgradeConfiguration.stateDir !== plan.kStateDirectory
  ) {
    throw new Error("Computer configuration K state does not match the plan");
  }
  if (
    supervisorConfiguration.serviceConfigurationPath !==
    upgradeConfiguration.serviceConfigurationPath
  ) {
    throw new Error("Computer service configuration paths do not match");
  }
  if (
    serviceConfiguration.attachmentStatePath !==
      upgradeConfiguration.attachmentStatePath ||
    serviceConfiguration.runtimeProtocolVersion !==
      upgradeConfiguration.runtimeProtocolVersion
  ) {
    throw new Error("Computer service and upgrade configuration do not match");
  }
  if (
    serviceConfiguration.socketDirectory !==
    supervisorConfiguration.socketDirectory
  ) {
    throw new Error("Computer service and supervisor sockets do not match");
  }
  const socketDirectory = serviceConfiguration.socketDirectory;
  if (
    upgradeConfiguration.ownershipSocketPath !==
      serviceSocketPath(
        socketDirectory,
        NODE_K_CARRIER_COMPUTER_SERVICE_OWNERSHIP_HOST_ID,
      ) ||
    upgradeConfiguration.upgradeControlSocketPath !==
      serviceSocketPath(
        socketDirectory,
        NODE_K_CARRIER_COMPUTER_SERVICE_UPGRADE_CONTROL_HOST_ID,
      ) ||
    upgradeConfiguration.supervisorControlSocketPath !==
      computerServiceSupervisorControlSocketPath(socketDirectory)
  ) {
    throw new Error("Computer control socket closure is inconsistent");
  }
  if (
    upgradeConfiguration.supervisorControlToken !==
    supervisorConfiguration.controlToken
  ) {
    throw new Error("Computer supervisor control capability does not match");
  }
  if (
    new Set([
      supervisorConfiguration.controlToken,
      upgradeConfiguration.ownershipControlToken,
      upgradeConfiguration.upgradeControlToken,
    ]).size !== 3
  ) {
    throw new Error("Computer control capabilities must be unique");
  }
}

function serviceSocketPath(directory: string, hostId: string): string {
  return new UnixSocketInstanceLock({ directory, hostId }).socketPath;
}

function releaseVersion(value: string): string {
  if (typeof value !== "string") throw new Error("serviceVersion is invalid");
  try {
    compareComputerReleaseVersions(value, value);
  } catch {
    throw new Error("serviceVersion must be strict semver");
  }
  return value;
}

function absolutePath(value: string, name: string): string {
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

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
