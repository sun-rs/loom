import { createHash, createPublicKey, randomBytes } from "node:crypto";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { UnixSocketInstanceLock } from "./agent-host-daemon.ts";
import { computerServiceSupervisorControlSocketPath } from "./node-k-carrier-computer-supervisor-process.ts";
import {
  NODE_K_CARRIER_COMPUTER_SERVICE_OWNERSHIP_HOST_ID,
  NODE_K_CARRIER_COMPUTER_SERVICE_UPGRADE_CONTROL_HOST_ID,
} from "./node-k-carrier-computer-service-process.ts";
import {
  normalizeNodeKCarrierComputerServiceConfiguration,
  readNodeKCarrierComputerServiceConfigurationPath,
  type NodeKCarrierComputerServiceConfiguration,
} from "./node-k-carrier-computer-service-entry.ts";
import {
  normalizeNodeKCarrierComputerSupervisorConfiguration,
  readNodeKCarrierComputerSupervisorConfigurationPath,
  type NodeKCarrierComputerSupervisorConfiguration,
} from "./node-k-carrier-computer-supervisor-process.ts";
import {
  normalizeNodeKCarrierComputerUpgradeProcessConfiguration,
  readNodeKCarrierComputerUpgradeProcessConfigurationPath,
  type NodeKCarrierComputerUpgradeProcessConfiguration,
} from "./node-k-carrier-computer-upgrade-process.ts";
import {
  createMacOSComputerLaunchAgentPlan,
  type MacOSComputerLaunchAgentPlan,
} from "./macos-computer-launch-agent.ts";

const CONTROL_TOKEN = /^[0-9a-f]{64}$/u;

export type MacOSComputerProvisioningServiceConfiguration = Omit<
  NodeKCarrierComputerServiceConfiguration,
  | "attachmentStatePath"
  | "socketDirectory"
  | "supervisorDirectory"
  | "upgradeConfigurationPath"
>;

export type MacOSComputerProvisioningInput = Readonly<{
  executableDirectory: string;
  handoffTimeoutMs?: number;
  label: string;
  logDirectory: string;
  plistPath: string;
  privateConfigurationDirectory: string;
  release: Readonly<{
    baseUrl: string;
    publicKeyPem: string;
  }>;
  service: MacOSComputerProvisioningServiceConfiguration;
  socketDirectory?: string;
  stateDirectory: string;
  stopTimeoutMs?: number;
  supervisorControlTimeoutMs?: number;
}>;

export type MacOSComputerProvisioning = Readonly<{
  plan: MacOSComputerLaunchAgentPlan;
  serviceConfiguration: NodeKCarrierComputerServiceConfiguration;
  supervisorConfiguration: NodeKCarrierComputerSupervisorConfiguration;
  upgradeConfiguration: NodeKCarrierComputerUpgradeProcessConfiguration;
}>;

export type MacOSComputerProvisioningRuntime = Readonly<{
  createToken?: () => string;
}>;

/**
 * Derives the complete private configuration closure for one per-user Mac
 * Computer. Paths and control capabilities have one owner here; callers do
 * not manually copy them across service, K coordinator, supervisor, or plist.
 */
export function createMacOSComputerProvisioning(
  input: MacOSComputerProvisioningInput,
  runtime: MacOSComputerProvisioningRuntime = {},
): MacOSComputerProvisioning {
  const stateDirectory = input.stateDirectory;
  const kStateDirectory = join(stateDirectory, "k");
  const socketDirectory =
    input.socketDirectory ?? defaultSocketDirectory(input.label);
  const serviceConfigurationPath = join(
    input.privateConfigurationDirectory,
    "service.json",
  );
  const upgradeConfigurationPath = join(
    input.privateConfigurationDirectory,
    "upgrade.json",
  );
  const supervisorConfigurationPath = join(
    input.privateConfigurationDirectory,
    "supervisor.json",
  );
  const plan = createMacOSComputerLaunchAgentPlan({
    kStateDirectory,
    label: input.label,
    logDirectory: input.logDirectory,
    plistPath: input.plistPath,
    stateDirectory,
    supervisorConfigurationPath,
    supervisorExecutablePath: join(
      input.executableDirectory,
      "rah-os-computer",
    ),
  });
  const createToken =
    runtime.createToken ?? (() => randomBytes(32).toString("hex"));
  const supervisorControlToken = controlToken(createToken());
  const ownershipControlToken = controlToken(createToken());
  const upgradeControlToken = controlToken(createToken());
  if (
    new Set([
      supervisorControlToken,
      ownershipControlToken,
      upgradeControlToken,
    ]).size !== 3
  ) {
    throw new Error("Computer control capabilities must be unique");
  }
  const serviceConfiguration =
    normalizeNodeKCarrierComputerServiceConfiguration({
      ...input.service,
      attachmentStatePath: join(
        stateDirectory,
        "attachments",
        "attachments.json",
      ),
      socketDirectory,
      supervisorDirectory: join(stateDirectory, "runtime-supervisors"),
      upgradeConfigurationPath,
    });
  const supervisorConfiguration =
    normalizeNodeKCarrierComputerSupervisorConfiguration({
      controlToken: supervisorControlToken,
      handoffTimeoutMs: input.handoffTimeoutMs ?? 30_000,
      serviceArgumentPrefix: [],
      serviceConfigurationPath,
      socketDirectory,
      stateDir: kStateDirectory,
      stopTimeoutMs: input.stopTimeoutMs ?? 10_000,
    });
  const releasePublicKey = createPublicKey(input.release.publicKeyPem);
  if (releasePublicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Computer release public key must be Ed25519");
  }
  const upgradeConfiguration =
    normalizeNodeKCarrierComputerUpgradeProcessConfiguration({
      attachmentStatePath: serviceConfiguration.attachmentStatePath,
      ownershipControlToken,
      ownershipSocketPath: serviceSocketPath(
        socketDirectory,
        NODE_K_CARRIER_COMPUTER_SERVICE_OWNERSHIP_HOST_ID,
      ),
      receiptStatePath: join(
        stateDirectory,
        "upgrade",
        "operation-receipt.json",
      ),
      releaseBaseUrl: input.release.baseUrl,
      releasePublicKeyPem: input.release.publicKeyPem,
      requestPath: join(stateDirectory, "upgrade", "request.json"),
      runtimeProtocolVersion: serviceConfiguration.runtimeProtocolVersion,
      serviceConfigurationPath,
      stateDir: kStateDirectory,
      supervisorControlSocketPath:
        computerServiceSupervisorControlSocketPath(socketDirectory),
      supervisorControlTimeoutMs: input.supervisorControlTimeoutMs ?? 5_000,
      supervisorControlToken,
      upgradeControlSocketPath: serviceSocketPath(
        socketDirectory,
        NODE_K_CARRIER_COMPUTER_SERVICE_UPGRADE_CONTROL_HOST_ID,
      ),
      upgradeControlToken,
    });
  return Object.freeze({
    plan,
    serviceConfiguration,
    supervisorConfiguration,
    upgradeConfiguration,
  });
}

/**
 * Reuses the exact private capabilities of a prior staged installation. An
 * absent closure creates a fresh one; a partial, foreign, or stale closure is
 * never repaired by guessing or rotating only part of the capability set.
 */
export async function resolveMacOSComputerProvisioning(
  input: MacOSComputerProvisioningInput,
): Promise<MacOSComputerProvisioning> {
  const paths = {
    service: join(input.privateConfigurationDirectory, "service.json"),
    supervisor: join(input.privateConfigurationDirectory, "supervisor.json"),
    upgrade: join(input.privateConfigurationDirectory, "upgrade.json"),
  };
  const [service, supervisor, upgrade] = await Promise.all([
    readOptionalConfiguration(() =>
      readNodeKCarrierComputerServiceConfigurationPath(paths.service),
    ),
    readOptionalConfiguration(() =>
      readNodeKCarrierComputerSupervisorConfigurationPath(paths.supervisor),
    ),
    readOptionalConfiguration(() =>
      readNodeKCarrierComputerUpgradeProcessConfigurationPath(paths.upgrade),
    ),
  ]);
  const present = [service, supervisor, upgrade].filter(
    (value) => value !== undefined,
  ).length;
  if (present === 0) return createMacOSComputerProvisioning(input);
  if (
    service === undefined ||
    supervisor === undefined ||
    upgrade === undefined
  ) {
    throw new Error("staged Computer private configuration set is incomplete");
  }
  const tokens = [
    supervisor.controlToken,
    upgrade.ownershipControlToken,
    upgrade.upgradeControlToken,
  ];
  const resolved = createMacOSComputerProvisioning(input, {
    createToken: () => tokens.shift()!,
  });
  if (
    !isDeepStrictEqual(service, resolved.serviceConfiguration) ||
    !isDeepStrictEqual(supervisor, resolved.supervisorConfiguration) ||
    !isDeepStrictEqual(upgrade, resolved.upgradeConfiguration)
  ) {
    throw new Error(
      "staged Computer private configuration conflicts with the install request",
    );
  }
  return resolved;
}

async function readOptionalConfiguration<T>(
  read: () => T,
): Promise<T | undefined> {
  try {
    return read();
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

function serviceSocketPath(directory: string, hostId: string): string {
  return new UnixSocketInstanceLock({ directory, hostId }).socketPath;
}

function controlToken(value: string): string {
  if (!CONTROL_TOKEN.test(value)) {
    throw new Error(
      "Computer control capability must be 256-bit lowercase hex",
    );
  }
  return value;
}

function defaultSocketDirectory(label: string): string {
  const labelDigest = createHash("sha256")
    .update(label, "utf8")
    .digest("hex")
    .slice(0, 12);
  return `/tmp/rahc-${String(process.getuid?.() ?? 0)}-${labelDigest}`;
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
