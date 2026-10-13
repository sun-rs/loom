import { createDaemonInstanceFork } from "./daemon-instance-fork.ts";
import { runAgentDeletionReconciler } from "./agent-deletion-reconciler.ts";
import type { RuntimeGuideSettings } from "./runtime-guide-settings.ts";
import type { RuntimeSettings } from "./runtime-settings.ts";
import type { WorkerProfileMetadataPort } from "@rah-os/kernel";
import {
  DAEMON_BUILD_VERSION,
  DAEMON_PROTOCOL_VERSION,
} from "./daemon-health.ts";
import { GitTaskDeliveryEvidenceCollector } from "./git-task-delivery-evidence.ts";
import { createDaemonAgentSkillsReader } from "./daemon-agent-skills.ts";
import { createHash } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir, hostname } from "node:os";
import { ComputerFileBrowser } from "@rah-os/agent-host";

import {
  AgentMemoryCoordinator,
  quarantineAgentExecutionWorkspaceReset,
  type AgentExecutionWorkspaceCatalog,
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
  WorkerApplicationService,
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
import { RoomFileGcReconciler } from "./room-file-gc-reconciler.ts";
import { ProfileImageGcReconciler } from "./profile-image-gc-reconciler.ts";
import {
  buildLocalRuntimeInventoryResponse,
  type ConfiguredLocalRuntimeSnapshot,
} from "./local-runtime-inventory.ts";

import { ProfileImageStore } from "./profile-image-store.ts";
import {
  LocalComputerProfileStore,
  LocalComputerProfileStoreError,
} from "./local-computer-profile-store.ts";

export function createDaemonAgentMemoryCoordinator(input: {
  executionWorkspaces?: AgentExecutionWorkspaceCatalog;
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
    rootDirectory: join(
      input.config.stateDirectory,
      "supervisors",
      "agent-memory",
    ),
    // Owner 2026-09-26: a channel-home instance browses its Channel home and
    // attached directories; other Agents keep exposing only their memory.
    ...(input.executionWorkspaces === undefined
      ? {}
      : {
          resolveProjectDirectory: async (owner: string) =>
            await input.executionWorkspaces!.channelHomeDirectory(owner),
          resolveAttachedDirectories: async (owner: string) =>
            await input.executionWorkspaces!.attachedDirectories(owner),
          verifyAttachedDirectory: (owner: string, directory: string) =>
            input.executionWorkspaces!.verifyAttachedDirectory(
              owner,
              directory,
            ),
        }),
    // Typed App Inbox state is not a Room Message. The next canonical
    // Activation receives it until a dedicated maintenance lane exists.
    wake: () => false,
  });
}

export function createDaemonWorkerService(input: {
  profileMetadata?: WorkerProfileMetadataPort;
  config: DaemonConfig;
  kernel: RoomKernel;
}): WorkerApplicationService {
  return new WorkerApplicationService({
    ...(input.profileMetadata
      ? { profileMetadata: input.profileMetadata }
      : {}),
    serviceInfo: () => ({
      buildVersion: DAEMON_BUILD_VERSION,
      protocolVersion: DAEMON_PROTOCOL_VERSION,
    }),
    profileImageStore: openDaemonProfileImageStore(input.kernel),
    deliveryEvidenceCollector: new GitTaskDeliveryEvidenceCollector(),
    kernel: input.kernel,
    ...(input.config.taskClaimHeartbeatIntervalMs === undefined
      ? {}
      : {
          taskClaimHeartbeatIntervalMs:
            input.config.taskClaimHeartbeatIntervalMs,
        }),
    ...(input.config.taskClaimLeaseMs === undefined
      ? {}
      : { taskClaimLeaseMs: input.config.taskClaimLeaseMs }),
  });
}

export function openDaemonProfileImageStore(
  kernel: RoomKernel,
): ProfileImageStore {
  const store = new ProfileImageStore({
    directory: join(dirname(kernel.databasePath), "profile-images"),
  });
  store.reclaimStaleParts({ olderThanMs: Date.now() - 15 * 60_000 });
  kernel.profileImages.registerInventory(store.inventory());
  return store;
}

export function createDaemonAgentExecutionResetCoordinator(input: {
  executionWorkspaces?: AgentExecutionWorkspaceCatalog;
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
  const acquireFence = createAgentExecutionResetFenceAcquirer(
    createKernelAgentHostControlPort(input.kernel, input.host),
  );
  return new AgentExecutionResetCoordinator({
    acquireFence,
    ...(input.executionWorkspaces
      ? {
          finalizeCommittedWorkspace: async (receipt) => {
            if (receipt.mode !== "full") return;
            await input.executionWorkspaces!.finalizeCommitted(
              receipt.ownerParticipantId,
              receipt.operationId,
            );
            const lease = input.kernel.getAgentExclusiveOperationLease(
              receipt.operationId,
            );
            if (
              lease.participantId !== receipt.ownerParticipantId ||
              lease.ownerHostId !== input.host.hostId
            )
              throw new Error(
                "Committed reset lease identity does not match receipt",
              );
            if (lease.state === "active") {
              const recovered = await acquireFence(
                receipt.ownerParticipantId,
                receipt.operationId,
              );
              await recovered.release();
            }
          },
        }
      : {}),
    computerHostId: input.host.hostId,
    quarantineAgentWorkspace: async (ownerParticipantId, operationId) =>
      await quarantineAgentExecutionWorkspaceReset({
        quarantineMemory: () =>
          input.agentMemoryCoordinator.beginWorkspaceResetInsideFence(
            ownerParticipantId,
            operationId,
          ),
        quarantineExecution: async () =>
          input.executionWorkspaces?.quarantinePrivate(
            ownerParticipantId,
            operationId,
          ),
      }),
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

function createDaemonReminderReconciler(
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

function createDaemonRoomFileGcReconciler(
  kernel: RoomKernel,
  onFailure: (message: string) => void,
): RoomFileGcReconciler {
  return new RoomFileGcReconciler({
    onError: (error) =>
      onFailure(`Room file GC reconciliation failed: ${errorMessage(error)}`),
    onResult: (result) => {
      if (result.outstandingFailures > 0) {
        onFailure(
          `${result.outstandingFailures} Room file GC receipt(s) are waiting for retry`,
        );
      }
    },
    reconcile: () => kernel.files.reconcileRoomDeletionGc({ limit: 50 }),
  });
}

function createDaemonProfileImageGcReconciler(
  kernel: RoomKernel,
  profileImages: ProfileImageStore,
  onFailure: (message: string) => void,
): ProfileImageGcReconciler {
  return new ProfileImageGcReconciler({
    onError: (error) =>
      onFailure(
        `Profile image GC reconciliation failed: ${errorMessage(error)}`,
      ),
    onResult: (result) => {
      if (result.failed > 0) {
        onFailure(
          `${String(result.failed)} profile image GC operation(s) are waiting for retry`,
        );
      }
    },
    reconcile: () =>
      kernel.profileImages.reconcile({
        limit: 50,
        reclaimBlob: (avatarKey) => profileImages.reclaim(avatarKey),
      }),
  });
}

export function createDaemonBackgroundReconcilerRunners(
  kernel: RoomKernel,
  onFailure: (message: string) => void,
): ReadonlyArray<(signal: AbortSignal) => Promise<void>> {
  const profileImages = openDaemonProfileImageStore(kernel);
  const reconcilers = [
    createDaemonReminderReconciler(kernel, onFailure),
    createDaemonRoomFileGcReconciler(kernel, onFailure),
    createDaemonProfileImageGcReconciler(kernel, profileImages, onFailure),
  ];
  return [
    (signal: AbortSignal) =>
      runAgentDeletionReconciler(kernel, signal, onFailure),
    ...reconcilers.map(
      (reconciler) => async (signal: AbortSignal) =>
        await reconciler.run({ signal }),
    ),
  ];
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
      agentId: request.agentId,
      mode: request.mode,
      operationId,
      ownerParticipantId: existing.ownerParticipantId,
    });
  }

  const management = input.human.getWorkspaceAgentManagementView(
    actor,
    request.agentId,
  );
  const ownerParticipantId = management.agent.definition.participantId;
  const wasDisabled = management.agent.definition.state === "disabled";
  let disabled = false;
  const disabledResult = wasDisabled
    ? undefined
    : manageAgentStateAtLatest(input.human, actor, {
        agentId: request.agentId,
        basedOnRoomSeq: request.basedOnRoomSeq,
        idempotencyKey: `${request.idempotencyKey}:execution-reset:disable`,
        state: "disabled",
      });
  const disabledSeq = disabledResult?.event.roomSeq ?? request.basedOnRoomSeq;
  disabled = !wasDisabled;
  try {
    const receipt = await input.coordinator.reset(
      {
        agentId: request.agentId,
        mode: request.mode,
        operationId,
        ownerParticipantId,
      },
      {
        afterContinuity: async () => {
          manageAgentStateAtLatest(input.human, actor, {
            agentId: request.agentId,
            basedOnRoomSeq: disabledSeq,
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
        agentId: request.agentId,
        basedOnRoomSeq: disabledSeq,
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
        agentId: request.agentId,
        idempotencyKey: request.idempotencyKey,
      }),
    )
    .digest("hex")}`;
}

function manageAgentStateAtLatest(
  human: HumanApplicationPort,
  actor: AuthenticatedActorContext,
  input: Readonly<{
    agentId: string;
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
        agentId: input.agentId,
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
  skills?: NonNullable<AgentMemoryAdministrationPort["workspace"]>["skills"],
): AgentMemoryAdministrationPort {
  return Object.freeze({
    computerHostId,
    workspace: {
      ...(skills ? { skills } : {}),
      summary: (owner) => coordinator.summarizeWorkspace(owner),
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
  runtimeGuideSettings?: RuntimeGuideSettings;
  runtimeSettings?: RuntimeSettings;
  computerProfiles?: LocalComputerProfileStore;
  agentExecutionResetCoordinator: AgentExecutionResetCoordinator;
  agentMemoryCoordinator: AgentMemoryCoordinator;
  buildVersion: string;
  config: DaemonConfig;
  configuredLocalRuntimes: readonly ConfiguredLocalRuntimeSnapshot[];
  runtimeProfileRegistries: ReadonlyMap<string, RuntimeProfileRegistry>;
  refreshRuntimeCatalog?: ((offerId: string) => Promise<void>) | undefined;
  discoveredLocalClis: readonly LocalRuntimeInventoryEntry[];
  healthState: () => ClientHealthResponse["state"];
  host: AuthenticatedHostContext;
  human: HumanApplicationPort;
  kernel: RoomKernel;

  protocolVersion: number;
  webPushAdministration: WebPushAdministrationPort;
}): HumanHttpApplicationService {
  const profileImages = new ProfileImageStore({
    directory: join(input.config.stateDirectory, "profile-images"),
  });
  const computerProfiles =
    input.computerProfiles ??
    new LocalComputerProfileStore({
      path: join(input.config.stateDirectory, "computer-profiles.json"),
    });
  return new HumanHttpApplicationService({
    instanceFork: createDaemonInstanceFork({
      kernel: input.kernel,
      host: input.host,
      stateDirectory: input.config.stateDirectory,
      registries: input.runtimeProfileRegistries,
      configured: input.configuredLocalRuntimes,
      memory: input.agentMemoryCoordinator,
    }),
    computerFiles: new ComputerFileBrowser({
      hostId: input.host.hostId,
      label: hostname(),
      roots: input.config.fileReferenceRoots ?? ["/"],
      initialDirectory: input.config.fileReferenceRoots?.[0] ?? homedir(),
    }),
    ...(input.runtimeGuideSettings
      ? { runtimeGuideSettings: input.runtimeGuideSettings }
      : {}),
    ...(input.runtimeSettings
      ? { runtimeSettings: input.runtimeSettings }
      : {}),
    agentExecutionAdministration: createDaemonAgentExecutionAdministration({
      coordinator: input.agentExecutionResetCoordinator,
      human: input.human,
    }),
    agentMemoryAdministration: createDaemonAgentMemoryAdministration(
      input.agentMemoryCoordinator,
      input.host.hostId,
      createDaemonAgentSkillsReader({
        coordinator: input.agentMemoryCoordinator,
        configured: input.configuredLocalRuntimes,
      }),
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
        agentOnboard: false,
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

        memberRead: true,
        memberWrite: true,
        messageRead: true,
        messageForward: true,
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
    localRuntimeInventory: async (actor, request) => {
      if (input.kernel.getAuthenticatedPrincipal(actor).kind !== "human")
        throw new Error("Runtime catalog requires Human authority");
      if (request?.refreshOfferId) {
        if (!input.refreshRuntimeCatalog)
          throw new Error("Runtime model refresh unavailable");
        await input.refreshRuntimeCatalog(request.refreshOfferId);
      }
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

    port: input.config.client.port,
    profileImages: {
      upload: (_actor, mimeType, chunks) =>
        profileImages.upload(
          mimeType,
          chunks,
          ({ avatarKey }) =>
            input.kernel.profileImages.recordUpload(_actor, { avatarKey })
              .uploadIntentId,
        ),
      read: (_actor, avatarKey) => profileImages.read(avatarKey),
    },
    webPushAdministration: input.webPushAdministration,
  });
}

/** The Host credential's participants; v4 config must be a subset, v2/v3 equal. */
export function authorizedParticipantScope(
  config: DaemonConfig,
  hostParticipantIds: readonly string[],
): string[] {
  const configured = configuredParticipantIds(config);
  const authorized = [...hostParticipantIds].sort();
  const scopeMatches =
    config.schemaVersion === 4
      ? configured.every((participantId) => authorized.includes(participantId))
      : JSON.stringify(authorized) === JSON.stringify(configured);
  if (!scopeMatches) {
    throw new Error(
      "configured participant scope does not match the authenticated Host credential",
    );
  }
  return authorized;
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
