import { createHash } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  AgentMemoryCoordinator,
  AgentExecutionResetCoordinator,
  createAgentExecutionResetFenceAcquirer,
  createAgentMemoryResetFenceAcquirer,
  createKernelAgentHostControlPort,
  ProviderSessionStore,
  ReminderReconciler,
  RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import {
  type AgentExecutionAdministrationPort,
  type AgentMemoryAdministrationPort,
  type ComputerProfileAdministrationPort,
  HumanHttpApplicationService,
  type TaskReassignmentAdministrationPort,
  type WebPushAdministrationPort,
} from "@rah-os/application-service";
import {
  KERNEL_SCHEMA_VERSION,
  type AuthenticatedHostContext,
  type AuthenticatedActorContext,
  type HumanApplicationPort,
  type RoomKernel,
  RuntimeTerminationProofError,
  StaleContextError,
  ConflictError,
  IdempotencyConflictError,
} from "@rah-os/core";
import {
  CLIENT_API_VERSION,
  type ClientAgentExecutionResetRequest,
  type ClientAgentExecutionResetResponse,
  type ClientHealthResponse,
  type ClientTaskReassignRequest,
  type ClientTaskReassignmentResponse,
  type ClientComputerProfileUpdateRequest,
  type LocalRuntimeInventoryEntry,
} from "@rah-os/protocol";

import type { DaemonConfig } from "./config.ts";
import {
  buildLocalRuntimeInventoryResponse,
  type ConfiguredLocalRuntimeSnapshot,
} from "./local-runtime-inventory.ts";
import type { NodeManagedMcpExecutorRegistry } from "./managed-mcp-executor-registry.ts";
import { ProfileImageStore } from "./profile-image-store.ts";
import {
  LocalComputerProfileStore,
  LocalComputerProfileStoreError,
} from "./local-computer-profile-store.ts";

export function createDaemonAgentMemoryCoordinator(input: {
  config: DaemonConfig;
  host: AuthenticatedHostContext;
  kernel: RoomKernel;
}): AgentMemoryCoordinator {
  const providerSessions = new ProviderSessionStore({
    rootDirectory: join(
      input.config.stateDirectory,
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
    projectDirectory:
      input.config.schemaVersion === 4
        ? input.config.workspace.cwd
        : input.config.runtime.cwd,
    rootDirectory: join(
      input.config.stateDirectory,
      "supervisors",
      "agent-memory",
    ),
    // Typed App Inbox state is not a Room Message. The next canonical
    // Activation receives it until a dedicated maintenance lane exists.
    wake: () => false,
  });
}

export function createDaemonAgentExecutionResetCoordinator(input: {
  agentMemoryCoordinator: Pick<
    AgentMemoryCoordinator,
    "beginWorkspaceResetInsideFence"
  >;
  host: AuthenticatedHostContext;
  kernel: RoomKernel;
  stateDirectory: string;
}): AgentExecutionResetCoordinator {
  const providerSessions = new ProviderSessionStore({
    rootDirectory: join(
      input.stateDirectory,
      "supervisors",
      "provider-sessions",
    ),
  });
  return new AgentExecutionResetCoordinator({
    acquireFence: createAgentExecutionResetFenceAcquirer(
      createKernelAgentHostControlPort(input.kernel, input.host),
    ),
    computerHostId: input.host.hostId,
    quarantineAgentWorkspace: async (ownerParticipantId, operationId) =>
      await input.agentMemoryCoordinator.beginWorkspaceResetInsideFence(
        ownerParticipantId,
        operationId,
      ),
    quarantineProviderContinuity: async (ownerParticipantId, operationId) =>
      await providerSessions.quarantineParticipant(
        ownerParticipantId,
        operationId,
      ),
    rootDirectory: join(
      input.stateDirectory,
      "supervisors",
      "agent-execution-reset",
    ),
  });
}

export function createDaemonReminderReconciler(
  kernel: RoomKernel,
  onFailure: (message: string) => void,
): ReminderReconciler {
  return new ReminderReconciler({
    onError: (error) =>
      onFailure(`Reminder reconciliation failed: ${errorMessage(error)}`),
    onResult: (result) => {
      if (result.exhausted > 0) {
        onFailure(
          `${result.exhausted} Reminder delivery receipt(s) exhausted their retry budget`,
        );
      }
    },
    reconcile: () => kernel.reminders.reconcileDue(),
  });
}

export function createDaemonAgentExecutionAdministration(input: {
  coordinator: Pick<AgentExecutionResetCoordinator, "receipt" | "reset">;
  human: HumanApplicationPort;
}): AgentExecutionAdministrationPort {
  return Object.freeze({
    reset: async (actor, request) =>
      await resetAgentExecution(input, actor, request),
  });
}

export function createDaemonTaskReassignmentAdministration(input: {
  human: HumanApplicationPort;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): TaskReassignmentAdministrationPort {
  const pollIntervalMs = input.pollIntervalMs ?? 50;
  const timeoutMs = input.timeoutMs ?? 30_000;
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error("pollIntervalMs must be a positive integer");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive integer");
  }
  return Object.freeze({
    reassign: async (actor, request) =>
      await reassignTaskAfterTerminalProof(
        input.human,
        actor,
        request,
        pollIntervalMs,
        timeoutMs,
      ),
  });
}

async function reassignTaskAfterTerminalProof(
  human: HumanApplicationPort,
  actor: AuthenticatedActorContext,
  request: ClientTaskReassignRequest,
  pollIntervalMs: number,
  timeoutMs: number,
): Promise<ClientTaskReassignmentResponse> {
  const requested = human.requestTaskReassignment(actor, request);
  if (requested.operation.state === "assigned") return requested;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return human.continueTaskReassignment(actor, {
        operationId: requested.operation.operationId,
      });
    } catch (error) {
      if (!(error instanceof RuntimeTerminationProofError)) throw error;
      if (Date.now() >= deadline) {
        throw new RuntimeTerminationProofError(
          `Task reassignment ${requested.operation.operationId} is still waiting for Host terminal proof`,
        );
      }
      await new Promise<void>((resolveDelay) =>
        setTimeout(resolveDelay, pollIntervalMs),
      );
    }
  }
}

async function resetAgentExecution(
  input: {
    coordinator: Pick<AgentExecutionResetCoordinator, "receipt" | "reset">;
    human: HumanApplicationPort;
  },
  actor: AuthenticatedActorContext,
  request: ClientAgentExecutionResetRequest,
): Promise<ClientAgentExecutionResetResponse> {
  const operationId = executionResetOperationId(request);
  const existing = await input.coordinator.receipt(operationId);
  if (existing !== null) {
    return await input.coordinator.reset({
      agentDefinitionId: request.agentDefinitionId,
      mode: request.mode,
      operationId,
      ownerParticipantId: existing.ownerParticipantId,
    });
  }

  const management = input.human.getWorkspaceAgentManagementView(
    actor,
    request.agentDefinitionId,
  );
  const ownerParticipantId = management.agent.definition.participantId;
  let disabled = false;
  const disabledResult = manageAgentStateAtLatest(input.human, actor, {
    agentDefinitionId: request.agentDefinitionId,
    basedOnRoomSeq: request.basedOnRoomSeq,
    idempotencyKey: `${request.idempotencyKey}:execution-reset:disable`,
    state: "disabled",
  });
  disabled = true;
  try {
    const receipt = await input.coordinator.reset(
      {
        agentDefinitionId: request.agentDefinitionId,
        mode: request.mode,
        operationId,
        ownerParticipantId,
      },
      {
        afterContinuity: async () => {
          manageAgentStateAtLatest(input.human, actor, {
            agentDefinitionId: request.agentDefinitionId,
            basedOnRoomSeq: disabledResult.event.roomSeq,
            idempotencyKey: `${request.idempotencyKey}:execution-reset:enable`,
            state: "enabled",
          });
          disabled = false;
        },
      },
    );
    return receipt;
  } catch (error) {
    if (!disabled) throw error;
    try {
      manageAgentStateAtLatest(input.human, actor, {
        agentDefinitionId: request.agentDefinitionId,
        basedOnRoomSeq: disabledResult.event.roomSeq,
        idempotencyKey: `${request.idempotencyKey}:execution-reset:restore`,
        state: "enabled",
      });
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        "Agent execution reset failed and the Agent could not be re-enabled",
      );
    }
    throw error;
  }
}

function executionResetOperationId(
  request: ClientAgentExecutionResetRequest,
): string {
  return `agent_execution_reset_${createHash("sha256")
    .update(
      JSON.stringify({
        agentDefinitionId: request.agentDefinitionId,
        idempotencyKey: request.idempotencyKey,
      }),
    )
    .digest("hex")}`;
}

function manageAgentStateAtLatest(
  human: HumanApplicationPort,
  actor: AuthenticatedActorContext,
  input: Readonly<{
    agentDefinitionId: string;
    basedOnRoomSeq: number;
    idempotencyKey: string;
    state: "disabled" | "enabled";
  }>,
) {
  let basedOnRoomSeq = input.basedOnRoomSeq;
  for (;;) {
    try {
      return human.manageWorkspaceAgent(actor, {
        action: "set_state",
        agentDefinitionId: input.agentDefinitionId,
        basedOnRoomSeq,
        idempotencyKey: input.idempotencyKey,
        state: input.state,
      });
    } catch (error) {
      if (!(error instanceof StaleContextError)) throw error;
      basedOnRoomSeq = error.latestRoomSeq;
    }
  }
}

export function createDaemonAgentMemoryAdministration(
  coordinator: AgentMemoryCoordinator,
  computerHostId: string,
): AgentMemoryAdministrationPort {
  return Object.freeze({
    computerHostId,
    workspace: {
      roots: (owner) => coordinator.workspaceRoots(owner),
      list: (owner, rootId, path, hidden) =>
        coordinator.browseWorkspace(owner, rootId, path, hidden),
      read: (owner, rootId, path) =>
        coordinator.previewWorkspaceFile(owner, rootId, path),
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

export function createDaemonComputerProfileAdministration(
  store: LocalComputerProfileStore,
  hostId: string,
): ComputerProfileAdministrationPort {
  return Object.freeze({
    update: (_actor, command: ClientComputerProfileUpdateRequest) => {
      if (command.hostId !== hostId) {
        throw new ConflictError(
          "Computer profile may only update the attached local Computer",
        );
      }
      try {
        return store.update(command);
      } catch (error) {
        if (!(error instanceof LocalComputerProfileStoreError)) throw error;
        if (error.code === "idempotency_conflict") {
          throw new IdempotencyConflictError(error.message);
        }
        throw new ConflictError(error.message);
      }
    },
  });
}

export function createDaemonHumanClientService(input: {
  agentExecutionResetCoordinator: AgentExecutionResetCoordinator;
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
  webPushAdministration: WebPushAdministrationPort;
}): HumanHttpApplicationService {
  const profileImages = new ProfileImageStore({
    directory: join(input.config.stateDirectory, "profile-images"),
  });
  const computerProfiles = new LocalComputerProfileStore({
    path: join(input.config.stateDirectory, "computer-profiles.json"),
  });
  return new HumanHttpApplicationService({
    agentExecutionAdministration: createDaemonAgentExecutionAdministration({
      coordinator: input.agentExecutionResetCoordinator,
      human: input.human,
    }),
    agentMemoryAdministration: createDaemonAgentMemoryAdministration(
      input.agentMemoryCoordinator,
      input.host.hostId,
    ),
    taskReassignmentAdministration: createDaemonTaskReassignmentAdministration({
      human: input.human,
    }),
    bindHost: input.config.client.bindHost,
    computerProfileAdministration: createDaemonComputerProfileAdministration(
      computerProfiles,
      input.host.hostId,
    ),
    health: () => ({
      apiVersion: CLIENT_API_VERSION,
      buildVersion: input.buildVersion,
      capabilities: {
        agentOnboard: true,
        agentExecutionReset: true,
        agentExecutionFullReset: true,
        agentRead: true,
        agentPresenceRead: true,
        agentWrite: true,
        computerProfileWrite: true,
        fileShare: true,
        messageSocial: true,
        sidebarPreferences: true,
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
        roomAgentSos: true,
        roomWrite: true,
        roomSync: true,
        taskRead: true,
        taskReassignment: true,
        taskWrite: true,
        threadRead: true,
        threadWrite: true,
        workspaceRead: true,
        workspaceWrite: true,
        webPush: true,
      },
      kernelSchemaVersion: KERNEL_SCHEMA_VERSION,
      protocolVersion: input.protocolVersion,
      state: input.healthState(),
    }),
    human: input.human,
    localRuntimeInventory: (actor) => {
      const computerProfile = computerProfiles.read(input.host.hostId);
      return buildLocalRuntimeInventoryResponse({
        actor,
        ...(computerProfile === undefined ? {} : { computerProfile }),
        configured: input.configuredLocalRuntimes,
        discovered: input.discoveredLocalClis,
        hostId: input.host.hostId,
        kernel: input.kernel,
        staleAfterMs: input.config.hostStaleAfterMs,
      });
    },
    managedMcpAdministration: input.managedMcpAdministration,
    port: input.config.client.port,
    profileImages: {
      upload: (_actor, mimeType, chunks) =>
        profileImages.upload(mimeType, chunks),
      read: (_actor, avatarKey) => profileImages.read(avatarKey),
    },
    webPushAdministration: input.webPushAdministration,
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
