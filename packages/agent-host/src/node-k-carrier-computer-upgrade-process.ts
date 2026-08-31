import { createPublicKey } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { ComputerAttachmentStore } from "./computer-attachment-store.ts";
import { ComputerReleaseSource } from "./computer-release-source.ts";
import { readComputerServiceLiveAttestation } from "./computer-service-ownership-proof.ts";
import { ComputerUpgradeCoordinatorRequestStore } from "./computer-upgrade-coordinator-process.ts";
import type { ComputerUpgradeCoordinatorRunResult } from "./computer-upgrade-coordinator-runner.ts";
import type { KCarrierComputerUpgradeReadyInput } from "./k-carrier-computer-upgrade.ts";
import {
  createAttachmentBoundComputerUpgradeControl,
  createNodeKCarrierComputerUpgradeRunner,
} from "./node-k-carrier-computer-upgrade-runner.ts";

export const NODE_K_CARRIER_COMPUTER_UPGRADE_PROCESS_CONFIGURATION_SCHEMA_VERSION = 2;
const MAX_CONFIGURATION_BYTES = 128 * 1_024;
const HEX_256 = /^[0-9a-f]{64}$/u;

export type NodeKCarrierComputerUpgradeProcessConfiguration = Readonly<{
  attachmentStatePath: string;
  ownershipControlToken: string;
  ownershipSocketPath: string;
  receiptStatePath: string;
  releaseBaseUrl: string;
  releasePublicKeyPem: string;
  requestPath: string;
  runtimeProtocolVersion: number;
  serviceConfigurationPath: string;
  stateDir: string;
  supervisorControlSocketPath: string;
  supervisorControlTimeoutMs: number;
  supervisorControlToken: string;
  upgradeControlSocketPath: string;
  upgradeControlToken: string;
}>;

/**
 * Parses an already-open private descriptor. The launcher validates and opens
 * the file before spawn, eliminating a child-side pathname replacement race.
 */
export function readNodeKCarrierComputerUpgradeProcessConfiguration(
  descriptor: number,
): NodeKCarrierComputerUpgradeProcessConfiguration {
  if (!Number.isSafeInteger(descriptor) || descriptor < 0) {
    throw new Error("K coordinator configuration fd is invalid");
  }
  const metadata = fstatSync(descriptor);
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(
      "K coordinator configuration must be an owner-private regular file",
    );
  }
  if (metadata.size <= 0 || metadata.size > MAX_CONFIGURATION_BYTES) {
    throw new Error("K coordinator configuration size is invalid");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(descriptor, "utf8")) as unknown;
  } catch {
    throw new Error("K coordinator configuration must be valid JSON");
  }
  const envelope = record(parsed, "configuration envelope");
  exactKeys(envelope, ["configuration", "schemaVersion"]);
  if (
    envelope.schemaVersion !==
    NODE_K_CARRIER_COMPUTER_UPGRADE_PROCESS_CONFIGURATION_SCHEMA_VERSION
  ) {
    throw new Error("unsupported K coordinator configuration schema");
  }
  return normalizeNodeKCarrierComputerUpgradeProcessConfiguration(
    envelope.configuration,
  );
}

export function normalizeNodeKCarrierComputerUpgradeProcessConfiguration(
  value: unknown,
): NodeKCarrierComputerUpgradeProcessConfiguration {
  return parseConfiguration(value);
}

export function readNodeKCarrierComputerUpgradeProcessConfigurationPath(
  configurationPath: string,
): NodeKCarrierComputerUpgradeProcessConfiguration {
  const path = absolutePath(configurationPath, "configurationPath");
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (hasCode(error, "ELOOP")) {
      throw new Error("K coordinator configuration must not be a symlink");
    }
    throw error;
  }
  try {
    return readNodeKCarrierComputerUpgradeProcessConfiguration(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function createNodeKCarrierComputerUpgradeProcessRunner(
  configuration: NodeKCarrierComputerUpgradeProcessConfiguration,
  runtime: Readonly<{ fetch?: typeof fetch }> = {},
) {
  const normalized = parseConfiguration(configuration);
  const attachmentStore = new ComputerAttachmentStore({
    statePath: normalized.attachmentStatePath,
  });
  const releaseSource = new ComputerReleaseSource({
    baseUrl: normalized.releaseBaseUrl,
    ...(runtime.fetch === undefined ? {} : { fetch: runtime.fetch }),
    publicKey: createPublicKey(normalized.releasePublicKeyPem),
  });
  return createNodeKCarrierComputerUpgradeRunner({
    createControl: async (request, context) =>
      await createAttachmentBoundComputerUpgradeControl({
        attachmentStore,
        request,
        runtimeProtocolVersion: normalized.runtimeProtocolVersion,
        ...(context.kind === "execute"
          ? {}
          : {
              serviceIdentity: {
                buildVersion: context.ready.observedBuildVersion,
                computerInstanceId: context.ready.successorComputerInstanceId,
              },
            }),
      }),
    ownershipControlToken: normalized.ownershipControlToken,
    ownershipSocketPath: normalized.ownershipSocketPath,
    receiptStatePath: normalized.receiptStatePath,
    releaseSource,
    requestPath: normalized.requestPath,
    serviceConfigurationPath: normalized.serviceConfigurationPath,
    stateDir: normalized.stateDir,
    supervisorControlSocketPath: normalized.supervisorControlSocketPath,
    supervisorControlTimeoutMs: normalized.supervisorControlTimeoutMs,
    supervisorControlToken: normalized.supervisorControlToken,
    upgradeControlSocketPath: normalized.upgradeControlSocketPath,
    upgradeControlToken: normalized.upgradeControlToken,
  });
}

export async function acknowledgeNodeKCarrierComputerUpgradeSuccessor(
  configuration: NodeKCarrierComputerUpgradeProcessConfiguration,
  ready: KCarrierComputerUpgradeReadyInput,
) {
  await verifyNodeKCarrierComputerUpgradeSuccessor(configuration, ready);
  return await createNodeKCarrierComputerUpgradeProcessRunner(
    configuration,
  ).acknowledgeSuccessorReady(ready);
}

export async function verifyNodeKCarrierComputerUpgradeSuccessor(
  configuration: NodeKCarrierComputerUpgradeProcessConfiguration,
  ready: KCarrierComputerUpgradeReadyInput,
  runtime: Readonly<{
    currentProcessId?: number;
    readLiveAttestation?: typeof readComputerServiceLiveAttestation;
  }> = {},
): Promise<void> {
  const normalized = parseConfiguration(configuration);
  const currentProcessId = positiveInteger(
    runtime.currentProcessId ?? process.pid,
    "currentProcessId",
  );
  const request = await new ComputerUpgradeCoordinatorRequestStore({
    requestPath: normalized.requestPath,
  }).read();
  if (request === null) {
    throw new Error("successor has no durable Computer upgrade request");
  }
  if (
    ready.operationId !== request.operationId ||
    ready.observedBuildVersion !== request.targetBuildVersion ||
    ready.successorComputerInstanceId === request.sourceComputerInstanceId
  ) {
    throw new Error(
      "successor ready does not match the durable upgrade request",
    );
  }
  const readLive =
    runtime.readLiveAttestation ?? readComputerServiceLiveAttestation;
  const live = await readLive({
    controlToken: normalized.ownershipControlToken,
    socketPath: normalized.ownershipSocketPath,
    timeoutMs: 2_000,
  });
  if (live === null) {
    throw new Error("successor has no live Computer singleton attestation");
  }
  if (live.candidateProcessId !== currentProcessId) {
    throw new Error("calling process does not own the live Computer singleton");
  }
  if (
    live.buildVersion !== ready.observedBuildVersion ||
    live.candidateComputerInstanceId !== ready.successorComputerInstanceId ||
    JSON.stringify(live.managedAttachmentIdentities) !==
      JSON.stringify(request.managedAttachmentIdentities)
  ) {
    throw new Error(
      "live Computer singleton does not match the durable successor request",
    );
  }
}

export async function runNodeKCarrierComputerUpgradeProcess(input: {
  configurationFd: number;
  requestPath: string;
}): Promise<ComputerUpgradeCoordinatorRunResult> {
  const configuration = readNodeKCarrierComputerUpgradeProcessConfiguration(
    input.configurationFd,
  );
  const requestPath = absolutePath(input.requestPath, "requestPath");
  if (configuration.requestPath !== requestPath) {
    throw new Error(
      "K coordinator argv request does not match private configuration",
    );
  }
  return await createNodeKCarrierComputerUpgradeProcessRunner(
    configuration,
  ).run();
}

function parseConfiguration(
  value: unknown,
): NodeKCarrierComputerUpgradeProcessConfiguration {
  const configuration = record(value, "configuration");
  if (
    configuration.supervisorControlSocketPath === undefined ||
    configuration.supervisorControlTimeoutMs === undefined ||
    configuration.supervisorControlToken === undefined
  ) {
    throw new Error(
      "K coordinator requires the launchd-owned supervisor control contract",
    );
  }
  exactKeys(configuration, [
    "attachmentStatePath",
    "ownershipControlToken",
    "ownershipSocketPath",
    "receiptStatePath",
    "releaseBaseUrl",
    "releasePublicKeyPem",
    "requestPath",
    "runtimeProtocolVersion",
    "serviceConfigurationPath",
    "stateDir",
    "supervisorControlSocketPath",
    "supervisorControlTimeoutMs",
    "supervisorControlToken",
    "upgradeControlSocketPath",
    "upgradeControlToken",
  ]);
  const releaseBaseUrl = boundedString(
    configuration.releaseBaseUrl,
    "releaseBaseUrl",
    4_096,
  );
  let releaseUrl: URL;
  try {
    releaseUrl = new URL(releaseBaseUrl);
  } catch {
    throw new Error("releaseBaseUrl is invalid");
  }
  if (
    releaseUrl.protocol !== "https:" ||
    releaseUrl.username.length > 0 ||
    releaseUrl.password.length > 0 ||
    releaseUrl.search.length > 0 ||
    releaseUrl.hash.length > 0
  ) {
    throw new Error("releaseBaseUrl must be credential-free HTTPS");
  }
  const supervisorControlToken = boundedString(
    configuration.supervisorControlToken,
    "supervisorControlToken",
    64,
  );
  if (!HEX_256.test(supervisorControlToken)) {
    throw new Error("K coordinator supervisorControlToken is invalid");
  }
  return Object.freeze({
    attachmentStatePath: absolutePath(
      configuration.attachmentStatePath,
      "attachmentStatePath",
    ),
    ownershipControlToken: boundedString(
      configuration.ownershipControlToken,
      "ownershipControlToken",
      4_096,
    ),
    ownershipSocketPath: absolutePath(
      configuration.ownershipSocketPath,
      "ownershipSocketPath",
    ),
    receiptStatePath: absolutePath(
      configuration.receiptStatePath,
      "receiptStatePath",
    ),
    releaseBaseUrl: releaseUrl.toString().replace(/\/$/u, ""),
    releasePublicKeyPem: boundedString(
      configuration.releasePublicKeyPem,
      "releasePublicKeyPem",
      16 * 1_024,
    ),
    requestPath: absolutePath(configuration.requestPath, "requestPath"),
    runtimeProtocolVersion: positiveInteger(
      configuration.runtimeProtocolVersion,
      "runtimeProtocolVersion",
    ),
    serviceConfigurationPath: absolutePath(
      configuration.serviceConfigurationPath,
      "serviceConfigurationPath",
    ),
    stateDir: absolutePath(configuration.stateDir, "stateDir"),
    supervisorControlSocketPath: absolutePath(
      configuration.supervisorControlSocketPath,
      "supervisorControlSocketPath",
    ),
    supervisorControlTimeoutMs: positiveInteger(
      configuration.supervisorControlTimeoutMs,
      "supervisorControlTimeoutMs",
    ),
    supervisorControlToken,
    upgradeControlSocketPath: absolutePath(
      configuration.upgradeControlSocketPath,
      "upgradeControlSocketPath",
    ),
    upgradeControlToken: boundedString(
      configuration.upgradeControlToken,
      "upgradeControlToken",
      4_096,
    ),
  });
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
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
    throw new Error("K coordinator configuration has unexpected fields");
  }
}

function absolutePath(value: unknown, name: string): string {
  const path = boundedString(value, name, 4_096);
  if (!isAbsolute(path)) throw new Error(`${name} must be absolute`);
  return resolve(path);
}

function boundedString(
  value: unknown,
  name: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.includes("\0")
  ) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value as number;
}
