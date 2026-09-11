import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  createReadStream,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { WorkspaceMountDescriptorSchema } from "@rah-os/protocol";

import {
  SystemComputerSecretProvider,
  type ComputerSecretProvider,
  type ComputerSecretReference,
} from "./macos-keychain-secret-provider.ts";
import { computerArtifactBuildVersion } from "./computer-artifact-build.ts";
import { compareComputerReleaseVersions } from "./computer-release-source.ts";
import {
  ComputerAttachmentStore,
  type ComputerAttachment,
} from "./computer-attachment-store.ts";
import type { ComputerControlClientPort } from "./computer-resident-service.ts";
import { createRemoteComputerServiceAttachmentWorkload } from "./computer-service-attachment-workload.ts";
import { ComputerUpgradeParkedAttachmentStore } from "./k-carrier-computer-host-adapter.ts";
import { NodeHttpComputerControlClient } from "./node-http-computer-control-client.ts";
import {
  NODE_K_CARRIER_COMPUTER_SERVICE_OWNERSHIP_HOST_ID,
  NODE_K_CARRIER_COMPUTER_SERVICE_UPGRADE_CONTROL_HOST_ID,
  runNodeKCarrierComputerServiceProcess,
  type NodeKCarrierComputerServiceProcessOptions,
} from "./node-k-carrier-computer-service-process.ts";
import {
  readNodeKCarrierComputerUpgradeProcessConfigurationPath,
  type NodeKCarrierComputerUpgradeProcessConfiguration,
} from "./node-k-carrier-computer-upgrade-process.ts";
import { recoverNodeKCarrierComputerUpgradeOnServiceStartup } from "./computer-upgrade-startup-recovery.ts";
import { UnixSocketInstanceLock } from "./agent-host-daemon.ts";
import {
  RuntimeCredentialEnvironmentBinding,
  RuntimeImplementationRegistry,
} from "./runtime-implementation-registry.ts";
import { RuntimeProfileRegistry } from "./runtime-profile-registry.ts";
import { RemoteRuntimeProfileSet } from "./remote-runtime-profile-composition.ts";

export const NODE_K_CARRIER_COMPUTER_SERVICE_CONFIGURATION_SCHEMA_VERSION = 1;
const MAX_CONFIGURATION_BYTES = 256 * 1_024;
const MAX_CAPACITY = 128;
const MAX_RUNTIMES = 128;

export type NodeKCarrierComputerServiceRuntimeConfiguration = Readonly<{
  credentialBindings: Readonly<Record<string, ComputerSecretReference>>;
  offer: Readonly<{
    leaseMs: number;
    maxConcurrent: number;
    runtimeOfferId: string;
  }>;
  registryDatabasePath: string;
  runtimeProfileId: string;
}>;

export type NodeKCarrierComputerServiceConfiguration = Readonly<{
  activationLeaseMs: number;
  attachmentReconcileIntervalMs: number;
  attachmentStatePath: string;
  buildVersion: string;
  capacity: number;
  controlRequestTimeoutMs: number;
  runtimeProtocolVersion: number;
  runtimeRegistryOwnerId: string;
  runtimes: readonly NodeKCarrierComputerServiceRuntimeConfiguration[];
  socketDirectory: string;
  supervisorDirectory: string;
  upgradeConfigurationPath: string;
  workspace: Readonly<{
    cwd: string;
    mode: "in_place";
    workspaceDefinitionId: string;
    workspaceMountDigest: string;
    workspaceMountRevisionId: string;
  }>;
}>;

export type NodeKCarrierComputerServiceCommandRuntime = Readonly<{
  artifactBuildVersion?: typeof computerArtifactBuildVersion;
  readConfiguration?: typeof readNodeKCarrierComputerServiceConfiguration;
  runConfiguredService?: typeof runNodeKCarrierComputerServiceFromConfiguration;
}>;

export type NodeKCarrierComputerConfiguredServiceRuntime = Readonly<{
  computerInstanceId?: string;
  createControlClient?: (
    attachment: Readonly<ComputerAttachment>,
  ) => ComputerControlClientPort;
  implementations?: RuntimeImplementationRegistry;
  loadUpgradeConfiguration?: (
    path: string,
  ) => NodeKCarrierComputerUpgradeProcessConfiguration;
  processId?: number;
  recoverUpgrade?: typeof recoverNodeKCarrierComputerUpgradeOnServiceStartup;
  runServiceProcess?: typeof runNodeKCarrierComputerServiceProcess;
  secretProvider?: ComputerSecretProvider;
  selfCommand?: Readonly<{
    argumentPrefix: readonly string[];
    executablePath: string;
  }>;
  supervisorShutdownSignal?: AbortSignal;
}>;

export function readNodeKCarrierComputerServiceConfiguration(
  descriptor: number,
): NodeKCarrierComputerServiceConfiguration {
  if (!Number.isSafeInteger(descriptor) || descriptor < 0) {
    throw new Error("Computer service configuration fd is invalid");
  }
  const metadata = fstatSync(descriptor);
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(
      "Computer service configuration must be an owner-private regular file",
    );
  }
  if (metadata.size <= 0 || metadata.size > MAX_CONFIGURATION_BYTES) {
    throw new Error("Computer service configuration size is invalid");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(descriptor, "utf8")) as unknown;
  } catch {
    throw new Error("Computer service configuration must be valid JSON");
  }
  const envelope = record(parsed, "configuration envelope");
  exactKeys(envelope, ["configuration", "schemaVersion"]);
  if (
    envelope.schemaVersion !==
    NODE_K_CARRIER_COMPUTER_SERVICE_CONFIGURATION_SCHEMA_VERSION
  ) {
    throw new Error("unsupported Computer service configuration schema");
  }
  return normalizeNodeKCarrierComputerServiceConfiguration(
    envelope.configuration,
  );
}

export function readNodeKCarrierComputerServiceConfigurationPath(
  configurationPath: string,
): NodeKCarrierComputerServiceConfiguration {
  const path = absolutePath(configurationPath, "configurationPath");
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (hasCode(error, "ELOOP")) {
      throw new Error("Computer service configuration must not be a symlink");
    }
    throw error;
  }
  try {
    return readNodeKCarrierComputerServiceConfiguration(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function normalizeNodeKCarrierComputerServiceConfiguration(
  value: unknown,
): NodeKCarrierComputerServiceConfiguration {
  const configuration = record(value, "configuration");
  exactKeys(configuration, [
    "activationLeaseMs",
    "attachmentReconcileIntervalMs",
    "attachmentStatePath",
    "buildVersion",
    "capacity",
    "controlRequestTimeoutMs",
    "runtimeProtocolVersion",
    "runtimeRegistryOwnerId",
    "runtimes",
    "socketDirectory",
    "supervisorDirectory",
    "upgradeConfigurationPath",
    "workspace",
  ]);
  const buildVersion = identifier(
    configuration.buildVersion,
    "buildVersion",
    128,
  );
  compareComputerReleaseVersions(buildVersion, buildVersion);
  const capacity = positiveInteger(configuration.capacity, "capacity");
  if (capacity > MAX_CAPACITY) {
    throw new Error(`capacity must not exceed ${String(MAX_CAPACITY)}`);
  }
  const rawRuntimes = configuration.runtimes;
  if (
    !Array.isArray(rawRuntimes) ||
    rawRuntimes.length === 0 ||
    rawRuntimes.length > MAX_RUNTIMES
  ) {
    throw new Error("runtimes must contain 1 to 128 entries");
  }
  const runtimeOfferIds = new Set<string>();
  const runtimeProfileKeys = new Set<string>();
  let advertisedCapacity = 0;
  const runtimes = rawRuntimes.map((entry, index) => {
    const parsed = runtimeConfiguration(entry, index);
    if (runtimeOfferIds.has(parsed.offer.runtimeOfferId)) {
      throw new Error(
        `duplicate runtimeOfferId: ${parsed.offer.runtimeOfferId}`,
      );
    }
    runtimeOfferIds.add(parsed.offer.runtimeOfferId);
    const profileKey = `${parsed.registryDatabasePath}\0${parsed.runtimeProfileId}`;
    if (runtimeProfileKeys.has(profileKey)) {
      throw new Error(
        `duplicate RuntimeProfile binding: ${parsed.runtimeProfileId}`,
      );
    }
    runtimeProfileKeys.add(profileKey);
    advertisedCapacity += parsed.offer.maxConcurrent;
    return parsed;
  });
  if (advertisedCapacity > capacity) {
    throw new Error(
      "RuntimeOffer capacity must not exceed Computer service capacity",
    );
  }
  const workspace = workspaceConfiguration(configuration.workspace);
  return Object.freeze({
    activationLeaseMs: positiveInteger(
      configuration.activationLeaseMs,
      "activationLeaseMs",
    ),
    attachmentReconcileIntervalMs: positiveInteger(
      configuration.attachmentReconcileIntervalMs,
      "attachmentReconcileIntervalMs",
    ),
    attachmentStatePath: absolutePath(
      configuration.attachmentStatePath,
      "attachmentStatePath",
    ),
    buildVersion,
    capacity,
    controlRequestTimeoutMs: positiveInteger(
      configuration.controlRequestTimeoutMs,
      "controlRequestTimeoutMs",
    ),
    runtimeProtocolVersion: positiveInteger(
      configuration.runtimeProtocolVersion,
      "runtimeProtocolVersion",
    ),
    runtimeRegistryOwnerId: identifier(
      configuration.runtimeRegistryOwnerId,
      "runtimeRegistryOwnerId",
      512,
    ),
    runtimes: Object.freeze(runtimes),
    socketDirectory: absolutePath(
      configuration.socketDirectory,
      "socketDirectory",
    ),
    supervisorDirectory: absolutePath(
      configuration.supervisorDirectory,
      "supervisorDirectory",
    ),
    upgradeConfigurationPath: absolutePath(
      configuration.upgradeConfigurationPath,
      "upgradeConfigurationPath",
    ),
    workspace,
  });
}

/** Exact child argv contract emitted by the launchd-owned supervisor. */
export async function runNodeKCarrierComputerServiceCommand(
  arguments_: readonly string[],
  runtime: NodeKCarrierComputerServiceCommandRuntime = {},
): Promise<0> {
  if (
    arguments_.length !== 3 ||
    arguments_[0] !== "__computer-service" ||
    arguments_[1] !== "--config-fd=3" ||
    arguments_[2] !== "--supervisor-fd=4"
  ) {
    throw new Error(
      "usage: rah-os-computer __computer-service --config-fd=3 --supervisor-fd=4",
    );
  }
  const configurationFd = 3;
  const supervisorFd = 4;
  const readConfiguration =
    runtime.readConfiguration ?? readNodeKCarrierComputerServiceConfiguration;
  let configuration: NodeKCarrierComputerServiceConfiguration;
  try {
    configuration = readConfiguration(configurationFd);
  } finally {
    if (runtime.readConfiguration === undefined) closeSync(configurationFd);
  }
  const artifactBuildVersion =
    runtime.artifactBuildVersion?.() ?? computerArtifactBuildVersion();
  if (
    artifactBuildVersion !== undefined &&
    configuration.buildVersion !== artifactBuildVersion
  ) {
    throw new Error(
      "Computer service buildVersion does not match the signed artifact build",
    );
  }
  await (
    runtime.runConfiguredService ??
    runNodeKCarrierComputerServiceFromConfiguration
  )({ configuration, configurationFd, supervisorFd });
  return 0;
}

export async function runNodeKCarrierComputerServiceFromConfiguration(input: {
  configuration: NodeKCarrierComputerServiceConfiguration;
  configurationFd: number;
  runtime?: NodeKCarrierComputerConfiguredServiceRuntime;
  supervisorFd: number;
}): Promise<Readonly<{ kind: "stopped" }>> {
  const configuration = normalizeNodeKCarrierComputerServiceConfiguration(
    input.configuration,
  );
  const runtime = input.runtime ?? {};
  const processId = runtime.processId ?? process.pid;
  const computerInstanceId = identifier(
    runtime.computerInstanceId ?? randomUUID(),
    "computerInstanceId",
    512,
  );
  const loadUpgrade =
    runtime.loadUpgradeConfiguration ??
    readNodeKCarrierComputerUpgradeProcessConfigurationPath;
  const upgradeConfiguration = loadUpgrade(
    configuration.upgradeConfigurationPath,
  );
  validateUpgradeConfiguration(configuration, upgradeConfiguration);
  const implementations =
    runtime.implementations ?? new RuntimeImplementationRegistry();
  const secretProvider =
    runtime.secretProvider ?? new SystemComputerSecretProvider();
  const registries = new Map<string, RuntimeProfileRegistry>();
  let runtimeProfiles: RemoteRuntimeProfileSet | undefined;
  const shutdownLease =
    runtime.supervisorShutdownSignal === undefined
      ? createSupervisorLease(input.supervisorFd)
      : {
          close: () => undefined,
          signal: runtime.supervisorShutdownSignal,
        };
  try {
    const workspaceMountDescriptors = [
      WorkspaceMountDescriptorSchema.parse({
        modes: [configuration.workspace.mode],
        workspaceDefinitionId: configuration.workspace.workspaceDefinitionId,
        workspaceMountDigest: configuration.workspace.workspaceMountDigest,
        workspaceMountRevisionId:
          configuration.workspace.workspaceMountRevisionId,
      }),
    ];
    const profileEntries = [];
    for (const runtimeConfiguration of configuration.runtimes) {
      let registry = registries.get(runtimeConfiguration.registryDatabasePath);
      if (registry === undefined) {
        registry = new RuntimeProfileRegistry({
          databasePath: runtimeConfiguration.registryDatabasePath,
          hostId: configuration.runtimeRegistryOwnerId,
        });
        registries.set(runtimeConfiguration.registryDatabasePath, registry);
        registry.initialize();
      }
      const revision = registry.getActiveRevision(
        runtimeConfiguration.runtimeProfileId,
      );
      if (revision === null) {
        throw new Error(
          `RuntimeProfile ${runtimeConfiguration.runtimeProfileId} has no active revision`,
        );
      }
      const probeReport = registry.recordProbeReport(
        await implementations.probeRevision(revision, {
          cwd: configuration.workspace.cwd,
        }),
      );
      if (!probeReport.available) {
        throw new Error(
          `active RuntimeProfile probe failed: ${probeReport.failureCode ?? "unavailable"}`,
        );
      }
      const credentialEnvironment = new RuntimeCredentialEnvironmentBinding({
        manifest: revision.manifest,
        resolvers: Object.fromEntries(
          Object.entries(runtimeConfiguration.credentialBindings).map(
            ([slotId, reference]) => [
              slotId,
              async () => await secretProvider.load(reference),
            ],
          ),
        ),
      });
      profileEntries.push({
        credentialEnvironment,
        cwd: configuration.workspace.cwd,
        leaseMs: runtimeConfiguration.offer.leaseMs,
        maxConcurrent: runtimeConfiguration.offer.maxConcurrent,
        probeReport,
        runtimeOfferId: runtimeConfiguration.offer.runtimeOfferId,
        runtimeProfileRegistry: registry,
        runtimeProfileRevision: revision,
        workspaceMountDescriptors,
      });
    }
    runtimeProfiles = new RemoteRuntimeProfileSet({
      implementations,
      profiles: profileEntries,
      supervisorDirectory: configuration.supervisorDirectory,
    });
    const activeRuntimeProfiles = runtimeProfiles;
    const attachmentStore = new ComputerAttachmentStore({
      statePath: configuration.attachmentStatePath,
    });
    const createControlClient =
      runtime.createControlClient ??
      ((attachment: Readonly<ComputerAttachment>) =>
        new NodeHttpComputerControlClient({
          hostAccessToken: attachment.hostAccessToken,
          origin: attachment.origin,
          timeoutMs: configuration.controlRequestTimeoutMs,
        }));
    const workload = createRemoteComputerServiceAttachmentWorkload({
      agentHost: ({ resident }) => {
        const binding = activeRuntimeProfiles.createRuntimeBinding(resident);
        return {
          leaseMs: configuration.activationLeaseMs,
          placementRuntimeResolver: binding.placementRuntimeResolver,
          runtime: binding.runtime,
        };
      },
      attachmentStore,
      buildVersion: configuration.buildVersion,
      capacity: configuration.capacity,
      clientFactory: createControlClient,
      computerInstanceId,
      parkedStore: new ComputerUpgradeParkedAttachmentStore({
        stateDir: upgradeConfiguration.stateDir,
      }),
      processId,
      reconcileIntervalMs: configuration.attachmentReconcileIntervalMs,
      runtimeOffers: async ({ identity, executionWorkspaceBindings }) => {
        if (executionWorkspaceBindings !== undefined)
          await activeRuntimeProfiles.prepareExecutionWorkspaces(
            executionWorkspaceBindings,
          );
        return activeRuntimeProfiles.runtimeOffers(identity);
      },
      runtimeProtocolVersion: configuration.runtimeProtocolVersion,
    });
    const selfCommand = runtime.selfCommand ?? currentSelfCommand();
    const recoverUpgrade =
      runtime.recoverUpgrade ??
      recoverNodeKCarrierComputerUpgradeOnServiceStartup;
    const startupRecovery = async () => {
      const result = await recoverUpgrade({
        argumentPrefix: [...selfCommand.argumentPrefix, "__computer-upgrade"],
        configuration: upgradeConfiguration,
        configurationPath: configuration.upgradeConfigurationPath,
        currentProcessId: processId,
        executablePath: selfCommand.executablePath,
      });
      if (result.kind === "recovery_required") {
        throw new Error(
          `Computer upgrade startup recovery failed closed: ${result.failureCode}`,
        );
      }
      return result;
    };
    const processOptions: NodeKCarrierComputerServiceProcessOptions = {
      buildVersion: configuration.buildVersion,
      computerInstanceId,
      ownershipControlToken: upgradeConfiguration.ownershipControlToken,
      processId,
      shutdownSignal: shutdownLease.signal,
      socketDirectory: configuration.socketDirectory,
      startupRecovery,
      upgradeControlToken: upgradeConfiguration.upgradeControlToken,
      workload,
    };
    return await (
      runtime.runServiceProcess ?? runNodeKCarrierComputerServiceProcess
    )(processOptions);
  } finally {
    shutdownLease.close();
    await runtimeProfiles?.close();
    for (const registry of registries.values()) registry.close();
  }
}

function validateUpgradeConfiguration(
  configuration: NodeKCarrierComputerServiceConfiguration,
  upgrade: NodeKCarrierComputerUpgradeProcessConfiguration,
): void {
  if (upgrade.attachmentStatePath !== configuration.attachmentStatePath) {
    throw new Error(
      "Computer service attachment state does not match upgrade configuration",
    );
  }
  if (upgrade.runtimeProtocolVersion !== configuration.runtimeProtocolVersion) {
    throw new Error(
      "Computer service Runtime protocol does not match upgrade configuration",
    );
  }
  const ownershipSocketPath = new UnixSocketInstanceLock({
    directory: configuration.socketDirectory,
    hostId: NODE_K_CARRIER_COMPUTER_SERVICE_OWNERSHIP_HOST_ID,
  }).socketPath;
  const upgradeControlSocketPath = new UnixSocketInstanceLock({
    directory: configuration.socketDirectory,
    hostId: NODE_K_CARRIER_COMPUTER_SERVICE_UPGRADE_CONTROL_HOST_ID,
  }).socketPath;
  if (upgrade.ownershipSocketPath !== ownershipSocketPath) {
    throw new Error(
      "Computer service ownership socket does not match upgrade configuration",
    );
  }
  if (upgrade.upgradeControlSocketPath !== upgradeControlSocketPath) {
    throw new Error(
      "Computer service upgrade socket does not match upgrade configuration",
    );
  }
}

function createSupervisorLease(descriptor: number): Readonly<{
  close(): void;
  signal: AbortSignal;
}> {
  if (!Number.isSafeInteger(descriptor) || descriptor < 0) {
    throw new Error("Computer service supervisor fd is invalid");
  }
  const metadata = fstatSync(descriptor);
  if (!metadata.isFIFO() && !metadata.isSocket()) {
    throw new Error("Computer service supervisor fd must be a pipe or socket");
  }
  const controller = new AbortController();
  const stream = createReadStream("", { autoClose: false, fd: descriptor });
  const onEnd = () => controller.abort("Computer supervisor lease ended");
  const onError = () => controller.abort("Computer supervisor lease failed");
  stream.once("end", onEnd);
  stream.once("error", onError);
  stream.resume();
  let closed = false;
  return Object.freeze({
    close: () => {
      if (closed) return;
      closed = true;
      stream.off("end", onEnd);
      stream.off("error", onError);
      stream.destroy();
      try {
        closeSync(descriptor);
      } catch {
        // The supervisor may already have closed the lease on process exit.
      }
    },
    signal: controller.signal,
  });
}

function currentSelfCommand(): Readonly<{
  argumentPrefix: readonly string[];
  executablePath: string;
}> {
  const commandIndex = process.argv.indexOf("__computer-service");
  if (commandIndex < 1) {
    throw new Error("Computer service self command could not be derived");
  }
  return Object.freeze({
    argumentPrefix: Object.freeze(process.argv.slice(1, commandIndex)),
    executablePath: resolve(process.execPath),
  });
}

function runtimeConfiguration(
  value: unknown,
  index: number,
): NodeKCarrierComputerServiceRuntimeConfiguration {
  const runtime = record(value, `runtimes[${String(index)}]`);
  exactKeys(runtime, [
    "credentialBindings",
    "offer",
    "registryDatabasePath",
    "runtimeProfileId",
  ]);
  const offer = record(runtime.offer, `runtimes[${String(index)}].offer`);
  exactKeys(offer, ["leaseMs", "maxConcurrent", "runtimeOfferId"]);
  const leaseMs = positiveInteger(
    offer.leaseMs,
    `runtimes[${String(index)}].offer.leaseMs`,
  );
  if (leaseMs > 5 * 60_000) {
    throw new Error("RuntimeOffer leaseMs must not exceed five minutes");
  }
  const maxConcurrent = positiveInteger(
    offer.maxConcurrent,
    `runtimes[${String(index)}].offer.maxConcurrent`,
  );
  if (maxConcurrent > MAX_CAPACITY) {
    throw new Error("RuntimeOffer maxConcurrent must not exceed 128");
  }
  return Object.freeze({
    credentialBindings: credentialBindings(runtime.credentialBindings, index),
    offer: Object.freeze({
      leaseMs,
      maxConcurrent,
      runtimeOfferId: identifier(
        offer.runtimeOfferId,
        `runtimes[${String(index)}].offer.runtimeOfferId`,
        512,
      ),
    }),
    registryDatabasePath: absolutePath(
      runtime.registryDatabasePath,
      `runtimes[${String(index)}].registryDatabasePath`,
    ),
    runtimeProfileId: identifier(
      runtime.runtimeProfileId,
      `runtimes[${String(index)}].runtimeProfileId`,
      512,
    ),
  });
}

function credentialBindings(
  value: unknown,
  runtimeIndex: number,
): Readonly<Record<string, ComputerSecretReference>> {
  const bindings = record(
    value,
    `runtimes[${String(runtimeIndex)}].credentialBindings`,
  );
  if (Object.keys(bindings).length > 128) {
    throw new Error("credentialBindings must not exceed 128 entries");
  }
  const output = Object.create(null) as Record<string, ComputerSecretReference>;
  for (const [rawSlotId, rawReference] of Object.entries(bindings)) {
    const slotId = identifier(rawSlotId, "credential slotId", 256);
    const reference = record(rawReference, `credentialBindings.${slotId}`);
    if (reference.source === "file") {
      exactKeys(reference, ["path", "source"]);
      output[slotId] = Object.freeze({
        path: absolutePath(reference.path, `credentialBindings.${slotId}.path`),
        source: "file",
      });
      continue;
    }
    if (reference.source === "macos-keychain") {
      exactKeys(reference, ["account", "service", "source"]);
      output[slotId] = Object.freeze({
        account: identifier(
          reference.account,
          `credentialBindings.${slotId}.account`,
          512,
        ),
        service: identifier(
          reference.service,
          `credentialBindings.${slotId}.service`,
          512,
        ),
        source: "macos-keychain",
      });
      continue;
    }
    throw new Error(
      `credentialBindings.${slotId}.source must be file or macos-keychain`,
    );
  }
  return Object.freeze(output);
}

function workspaceConfiguration(
  value: unknown,
): NodeKCarrierComputerServiceConfiguration["workspace"] {
  const workspace = record(value, "workspace");
  exactKeys(workspace, [
    "cwd",
    "mode",
    "workspaceDefinitionId",
    "workspaceMountDigest",
    "workspaceMountRevisionId",
  ]);
  if (workspace.mode !== "in_place") {
    throw new Error("workspace.mode must be in_place");
  }
  const descriptor = WorkspaceMountDescriptorSchema.parse({
    modes: [workspace.mode],
    workspaceDefinitionId: workspace.workspaceDefinitionId,
    workspaceMountDigest: workspace.workspaceMountDigest,
    workspaceMountRevisionId: workspace.workspaceMountRevisionId,
  });
  return Object.freeze({
    cwd: absolutePath(workspace.cwd, "workspace.cwd"),
    mode: "in_place",
    workspaceDefinitionId: descriptor.workspaceDefinitionId,
    workspaceMountDigest: descriptor.workspaceMountDigest,
    workspaceMountRevisionId: descriptor.workspaceMountRevisionId,
  });
}

function absolutePath(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    value.length > 4_096 ||
    value.includes("\0")
  ) {
    throw new Error(`${name} must be an absolute path`);
  }
  return resolve(value);
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function identifier(value: unknown, name: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${name} is invalid`);
  }
  return value;
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
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error("Computer service configuration shape is invalid");
  }
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
