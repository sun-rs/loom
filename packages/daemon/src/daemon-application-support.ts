import { lstat, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  AgentMemoryCoordinator,
  createAgentMemoryResetFenceAcquirer,
  createKernelAgentHostControlPort,
  ProviderSessionStore,
  RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import {
  type AgentMemoryAdministrationPort,
  HumanHttpApplicationService,
} from "@rah-os/application-service";
import {
  KERNEL_SCHEMA_VERSION,
  type AuthenticatedHostContext,
  type HumanApplicationPort,
  type RoomKernel,
} from "@rah-os/core";
import {
  CLIENT_API_VERSION,
  type ClientHealthResponse,
  type LocalRuntimeInventoryEntry,
} from "@rah-os/protocol";

import type { DaemonConfig } from "./config.ts";
import {
  buildLocalRuntimeInventoryResponse,
  type ConfiguredLocalRuntimeSnapshot,
} from "./local-runtime-inventory.ts";
import type { NodeManagedMcpExecutorRegistry } from "./managed-mcp-executor-registry.ts";

export function createDaemonAgentMemoryCoordinator(input: {
  host: AuthenticatedHostContext;
  kernel: RoomKernel;
  stateDirectory: string;
}): AgentMemoryCoordinator {
  const providerSessions = new ProviderSessionStore({
    rootDirectory: join(
      input.stateDirectory,
      "supervisors",
      "provider-sessions",
    ),
  });
  return new AgentMemoryCoordinator({
    acquireResetFence: createAgentMemoryResetFenceAcquirer(
      createKernelAgentHostControlPort(input.kernel, input.host),
    ),
    quarantineProviderContinuity: async (ownerParticipantId, operationId) =>
      await providerSessions.quarantineParticipant(
        ownerParticipantId,
        operationId,
      ),
    rootDirectory: join(input.stateDirectory, "supervisors", "agent-memory"),
    // Typed App Inbox state is not a Room Message. The next canonical
    // Activation receives it until a dedicated maintenance lane exists.
    wake: () => false,
  });
}

export function createDaemonAgentMemoryAdministration(
  coordinator: AgentMemoryCoordinator,
  computerHostId: string,
): AgentMemoryAdministrationPort {
  return Object.freeze({
    computerHostId,
    workspace: {
      list: (owner, path, hidden) =>
        coordinator.browseWorkspace(owner, path, hidden),
      read: (owner, path) => coordinator.previewWorkspaceFile(owner, path),
    },
    getCleanerConfig: (owner) => coordinator.getCleanerConfig(owner),
    patchCleanerConfig: (owner, patch) =>
      coordinator.patchCleanerConfig(owner, patch),
    inspectWorkspace: async (ownerParticipantId) =>
      await coordinator.inspectWorkspace(ownerParticipantId),
    readWorkspaceFile: async (ownerParticipantId, relativePath) =>
      await coordinator.readWorkspaceFile(ownerParticipantId, relativePath),
    resetWorkspace: async (ownerParticipantId, idempotencyKey) =>
      await coordinator.resetWorkspace(ownerParticipantId, idempotencyKey),
  });
}

export function createDaemonHumanClientService(input: {
  agentMemoryCoordinator: AgentMemoryCoordinator;
  buildVersion: string;
  config: DaemonConfig;
  configuredLocalRuntimes: readonly ConfiguredLocalRuntimeSnapshot[];
  discoveredLocalClis: readonly LocalRuntimeInventoryEntry[];
  healthState: () => ClientHealthResponse["state"];
  host: AuthenticatedHostContext;
  human: HumanApplicationPort;
  kernel: RoomKernel;
  managedMcpAdministration: NodeManagedMcpExecutorRegistry;
  protocolVersion: number;
}): HumanHttpApplicationService {
  return new HumanHttpApplicationService({
    agentMemoryAdministration: createDaemonAgentMemoryAdministration(
      input.agentMemoryCoordinator,
      input.host.hostId,
    ),
    bindHost: input.config.client.bindHost,
    health: () => ({
      apiVersion: CLIENT_API_VERSION,
      buildVersion: input.buildVersion,
      capabilities: {
        agentOnboard: true,
        agentRead: true,
        agentPresenceRead: true,
        agentWrite: true,
        fileShare: true,
        cursorAcknowledge: true,
        hints: false,
        inputRequestRead: true,
        inputRequestResolve: true,
        managedMcpRead: true,
        managedMcpWrite: true,
        memberRead: true,
        memberWrite: true,
        messageRead: true,
        messageWrite: true,
        roomRead: true,
        roomWrite: true,
        roomSync: true,
        taskRead: true,
        taskWrite: true,
        threadRead: true,
        threadWrite: true,
        workspaceRead: true,
        workspaceWrite: true,
      },
      kernelSchemaVersion: KERNEL_SCHEMA_VERSION,
      protocolVersion: input.protocolVersion,
      state: input.healthState(),
    }),
    human: input.human,
    localRuntimeInventory: (actor) =>
      buildLocalRuntimeInventoryResponse({
        actor,
        configured: input.configuredLocalRuntimes,
        discovered: input.discoveredLocalClis,
        hostId: input.host.hostId,
        kernel: input.kernel,
        staleAfterMs: input.config.hostStaleAfterMs,
      }),
    managedMcpAdministration: input.managedMcpAdministration,
    port: input.config.client.port,
  });
}

export function configuredParticipantIds(config: DaemonConfig): string[] {
  return config.schemaVersion === 4
    ? [...config.host.participantIds].sort()
    : [config.host.participantId];
}

export function openRuntimeProfileRegistry(
  registries: Map<string, RuntimeProfileRegistry>,
  databasePath: string,
  hostId: string,
): RuntimeProfileRegistry {
  const registryPath = resolve(databasePath);
  const existing = registries.get(registryPath);
  if (existing !== undefined) return existing;
  const registry = new RuntimeProfileRegistry({
    databasePath: registryPath,
    hostId,
  });
  try {
    registry.initialize();
  } catch (error) {
    registry.close();
    throw error;
  }
  registries.set(registryPath, registry);
  return registry;
}

export async function ensureOwnerPrivateDirectory(
  directory: string,
): Promise<void> {
  await mkdir(directory, { mode: 0o700, recursive: true });
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(
      `daemon state directory must be owner-private: ${directory}`,
    );
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runCoupledComponents(
  externalSignal: AbortSignal,
  components: Array<(signal: AbortSignal) => Promise<void>>,
): Promise<void> {
  const shutdown = new AbortController();
  const onExternalAbort = () => shutdown.abort(externalSignal.reason);
  externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  if (externalSignal.aborted) onExternalAbort();
  const tracked = components.map(async (component) => {
    try {
      await component(shutdown.signal);
      return { ok: true as const };
    } catch (error) {
      return { error, ok: false as const };
    }
  });
  const first = await Promise.race(tracked);
  shutdown.abort("daemon component stopped");
  const settled = await Promise.all(tracked);
  externalSignal.removeEventListener("abort", onExternalAbort);
  const failures = settled.flatMap((result) =>
    result.ok ? [] : [result.error],
  );
  if (!first.ok) throw first.error;
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "daemon components failed");
  }
  if (!externalSignal.aborted) {
    throw new Error("daemon component stopped before shutdown was requested");
  }
}
