import {
  createDaemonExecutionWorkspaceComposition,
  legacyWorkspaceMountDescriptors,
} from "./daemon-execution-workspace-composition.ts";
import { RuntimeGuideSettings } from "./runtime-guide-settings.ts";
import { LocalComputerProfileStore } from "./local-computer-profile-store.ts";
import { createDaemonWorkerProfileMetadata } from "./daemon-worker-profile-metadata.ts";
import { join } from "node:path";
import {
  AgentHost,
  AgentHostDaemon,
  AgentExecutionResetCoordinator,
  AgentMemoryCoordinator,
  combineActivationEnvironmentLeases,
  GenericProcessAdapter,
  createWorkerToolTransportEnvironment,
  MultiLaneAgentHost,
  RuntimeCredentialEnvironmentBinding,
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
  UnixSocketInstanceLock,
  type AgentHostOptions,
  type RuntimeAdapter,
} from "@rah-os/agent-host";
import {
  HumanHttpApplicationService,
  WorkerApplicationService,
} from "@rah-os/application-service";
import { RahCore, RoomKernel } from "@rah-os/core";
import {
  type PlacementDecision,
  type RuntimeRecoveryDescriptor,
} from "@rah-os/protocol";
import type { DaemonConfig } from "./config.ts";
import {
  DAEMON_BUILD_VERSION,
  DAEMON_PROTOCOL_VERSION,
  type DaemonHealthSnapshot,
} from "./daemon-health.ts";
import {
  createRegistryBackedRuntimeRecovery,
  createRegistryBackedRuntimeRecoveryFromRegistries,
} from "./registry-runtime-recovery.ts";
import {
  LocalWakeSignal,
  OutboxWakeDispatcher,
} from "./outbox-wake-dispatcher.ts";
import { RuntimeOfferPublisher } from "./runtime-offer-publisher.ts";
import { createDaemonWebPush } from "./daemon-web-push.ts";
import {
  assertRuntimeProfileRevisionStillActive,
  createConfiguredRuntime,
} from "./runtime-profile-composition.ts";
import { FileSecretProvider, type SecretProvider } from "./secret-provider.ts";
import {
  configuredRuntimeSnapshotWithValidation,
  discoverKnownLocalClis,
  type ConfiguredLocalRuntimeSnapshot,
} from "./local-runtime-inventory.ts";

import {
  configuredParticipantIds,
  createDaemonAgentExecutionResetCoordinator,
  createDaemonAgentMemoryCoordinator,
  createDaemonBackgroundReconcilerRunners,
  createDaemonHumanClientService,
  ensureOwnerPrivateDirectory,
  errorMessage,
  openRuntimeProfileRegistry,
  createDaemonWorkerService,
  runCoupledComponents,
} from "./daemon-application-support.ts";

export {
  DAEMON_BUILD_VERSION,
  DAEMON_PROTOCOL_VERSION,
  type DaemonHealthSnapshot,
} from "./daemon-health.ts";

export class DaemonApplication {
  readonly #config: DaemonConfig;
  readonly #secretProvider: SecretProvider;
  #clientOrigin: string | undefined;
  #health: DaemonHealthSnapshot;
  #running = false;

  constructor(input: {
    config: DaemonConfig;
    secretProvider?: SecretProvider;
  }) {
    this.#config = structuredClone(input.config);
    this.#secretProvider = input.secretProvider ?? new FileSecretProvider();
    this.#health = {
      buildVersion: DAEMON_BUILD_VERSION,
      hostId: this.#config.host.hostId,
      ...(this.#config.schemaVersion === 4
        ? {}
        : { participantId: this.#config.host.participantId }),
      participantIds: configuredParticipantIds(this.#config),
      protocolVersion: DAEMON_PROTOCOL_VERSION,
      state: "offline",
    };
  }

  health(): DaemonHealthSnapshot {
    return structuredClone(this.#health);
  }

  clientOrigin(): string | undefined {
    return this.#clientOrigin;
  }

  async run(input: { signal: AbortSignal }): Promise<void> {
    if (this.#running) throw new Error("DaemonApplication is already running");
    if (input.signal.aborted) return;
    this.#running = true;
    this.#health = {
      ...this.#health,
      state: "starting",
      startedAt: new Date().toISOString(),
    };

    let core: RahCore | undefined;
    let kernel: RoomKernel | undefined;
    let clientService: HumanHttpApplicationService | undefined;
    let agentMemoryCoordinator: AgentMemoryCoordinator | undefined;
    let agentExecutionResetCoordinator:
      AgentExecutionResetCoordinator | undefined;
    let workerService: WorkerApplicationService | undefined;
    const runtimeProfileRegistries = new Map<string, RuntimeProfileRegistry>();
    const configuredLocalRuntimes: ConfiguredLocalRuntimeSnapshot[] = [];
    let executionFailure: unknown;
    try {
      await ensureOwnerPrivateDirectory(this.#config.stateDirectory);
      const runtimeGuideSettings = new RuntimeGuideSettings(
        join(this.#config.stateDirectory, "runtime-guide.json"),
      );
      const computerProfiles = new LocalComputerProfileStore({
        path: join(this.#config.stateDirectory, "computer-profiles.json"),
      });
      const hostAccessToken = await this.#secretProvider.load(
        this.#config.host.credential,
      );
      core = RahCore.open({
        databasePath: join(this.#config.stateDirectory, "room.db"),
        ...(this.#config.schemaVersion === 4
          ? {
              inPlaceWorkspaceSharing:
                this.#config.workspace.sharing ?? "shared",
              placementCapacityPolicy: {
                defaultMaxConcurrent: this.#config.host.maxConcurrent,
                hostLimits: [
                  {
                    hostId: this.#config.host.hostId,
                    maxConcurrent: this.#config.host.maxConcurrent,
                  },
                ],
                runtimeProfileLimits: this.#config.runtimes.map((runtime) => ({
                  hostId: this.#config.host.hostId,
                  maxConcurrent: runtime.offer.maxConcurrent,
                  runtimeProfileId: runtime.runtimeProfileId,
                })),
              },
            }
          : {}),
      });
      kernel = core.kernel;
      const host = kernel.authenticateHostAccessToken(hostAccessToken);
      if (host.hostId !== this.#config.host.hostId) {
        throw new Error(
          "configured hostId does not match the authenticated Host credential",
        );
      }
      const configuredParticipants = configuredParticipantIds(this.#config);
      const authorizedParticipants = [...host.participantIds].sort();
      const scopeMatches =
        this.#config.schemaVersion === 4
          ? configuredParticipants.every((participantId) =>
              authorizedParticipants.includes(participantId),
            )
          : JSON.stringify(authorizedParticipants) ===
            JSON.stringify(configuredParticipants);
      if (!scopeMatches) {
        throw new Error(
          "configured participant scope does not match the authenticated Host credential",
        );
      }
      this.#health = {
        ...this.#health,
        participantIds: authorizedParticipants,
      };
      const webPush = await createDaemonWebPush({
        host,
        kernel,
        leaseMs: this.#config.outboxLeaseMs,
        pollIntervalMs: this.#config.outboxPollIntervalMs,
        retryAfterMs: this.#config.outboxRetryAfterMs,
        stateDirectory: join(this.#config.stateDirectory, "transport"),
      });
      workerService = createDaemonWorkerService({
        profileMetadata: createDaemonWorkerProfileMetadata({
          hostId: host.hostId,
          kernel,
          computerProfiles,
          registries: runtimeProfileRegistries,
        }),
        config: this.#config,
        kernel,
      });
      await workerService.start();
      const activeWorkerService = workerService;
      const {
        executionWorkspaces,
        refreshExecutionWorkspaces,
        resolveRuntimeWorkspace,
        createRecoveryCwdResolver,
        createLifecycle: createWorkspaceLifecycle,
      } = await createDaemonExecutionWorkspaceComposition({
        config: this.#config,
        host,
        kernel,
      });
      const activeAgentMemoryCoordinator = (agentMemoryCoordinator =
        createDaemonAgentMemoryCoordinator({
          ...(executionWorkspaces ? { executionWorkspaces } : {}),
          config: this.#config,
          host,
          kernel,
        }));
      agentExecutionResetCoordinator =
        createDaemonAgentExecutionResetCoordinator({
          ...(executionWorkspaces ? { executionWorkspaces } : {}),
          agentMemoryCoordinator: activeAgentMemoryCoordinator,
          host,
          kernel,
          stateDirectory: this.#config.stateDirectory,
        });
      const activeAgentExecutionResetCoordinator =
        agentExecutionResetCoordinator;
      let runtime: RuntimeAdapter;
      const runtimeOfferPublishers: RuntimeOfferPublisher[] = [];
      let placementRuntimeResolver:
        ((placement: PlacementDecision) => RuntimeAdapter) | undefined;
      let runtimeRecoveryDrivers: readonly string[] | undefined;
      let runtimeRecoveryResolver:
        ((descriptor: RuntimeRecoveryDescriptor) => RuntimeAdapter) | undefined;
      if (this.#config.schemaVersion === 2) {
        const runtimeOptions = this.#config.runtime;
        runtime = new GenericProcessAdapter({
          activationEnvironment: async (scope) => {
            const leases = [];
            try {
              if (scope.agent !== undefined) {
                leases.push(
                  await activeAgentMemoryCoordinator.prepareRuntimeActivation(
                    scope.agent,
                    {
                      activationId: scope.activationId,
                      computerHostId: scope.hostId,
                      roomId: scope.roomId,
                      runAttemptId: scope.runAttemptId,
                    },
                    { cwd: runtimeOptions.cwd },
                  ),
                );
              }
              const credential =
                await activeWorkerService.issueActivationCredentialForWorkspace(
                  host,
                  scope,
                  { workspaceRoot: runtimeOptions.cwd },
                );
              leases.push(
                await createWorkerToolTransportEnvironment({
                  credentialDirectory: join(
                    this.#config.stateDirectory,
                    "worker-credentials",
                  ),
                  revokeCredential: credential.revoke,
                  workerAccessToken: credential.accessToken,
                  workerApiOrigin: activeWorkerService.origin,
                }),
              );
              return combineActivationEnvironmentLeases(
                leases,
                "legacy local Runtime activation environment release failed",
              );
            } catch (error) {
              try {
                await combineActivationEnvironmentLeases(
                  leases,
                  "legacy local Runtime activation setup cleanup failed",
                ).release?.();
              } catch (cleanupError) {
                throw new AggregateError(
                  [error, cleanupError],
                  "legacy local Runtime activation setup and cleanup failed",
                );
              }
              throw error;
            }
          },
          args: runtimeOptions.args,
          command: runtimeOptions.command,
          cwd: runtimeOptions.cwd,
          ...(runtimeOptions.diagnosticByteLimit === undefined
            ? {}
            : { diagnosticByteLimit: runtimeOptions.diagnosticByteLimit }),
          env: runtimeOptions.env,
          ...(runtimeOptions.supervisorControlTimeoutMs === undefined
            ? {}
            : {
                supervisorControlTimeoutMs:
                  runtimeOptions.supervisorControlTimeoutMs,
              }),
          supervisorDirectory: join(this.#config.stateDirectory, "supervisors"),
          ...(runtimeOptions.supervisorStartupTimeoutMs === undefined
            ? {}
            : {
                supervisorStartupTimeoutMs:
                  runtimeOptions.supervisorStartupTimeoutMs,
              }),
          ...(runtimeOptions.terminationGraceMs === undefined
            ? {}
            : { terminationGraceMs: runtimeOptions.terminationGraceMs }),
        });
      } else if (this.#config.schemaVersion === 3) {
        const runtimeOptions = this.#config.runtime;
        const runtimeProfileRegistry = openRuntimeProfileRegistry(
          runtimeProfileRegistries,
          runtimeOptions.registryDatabasePath,
          host.hostId,
        );
        const activeRevision = runtimeProfileRegistry.getActiveRevision(
          runtimeOptions.runtimeProfileId,
        );
        if (activeRevision === null) {
          throw new Error(
            `RuntimeProfile ${runtimeOptions.runtimeProfileId} has no active revision`,
          );
        }
        const implementations = new RuntimeImplementationRegistry();
        const probeReport = runtimeProfileRegistry.recordProbeReport(
          await implementations.probeRevision(activeRevision, {
            cwd: runtimeOptions.cwd,
          }),
        );
        if (!probeReport.available) {
          throw new Error(
            `active RuntimeProfile probe failed: ${probeReport.failureCode ?? "unavailable"}`,
          );
        }
        configuredLocalRuntimes.push(
          configuredRuntimeSnapshotWithValidation({
            probeReport,
            registry: runtimeProfileRegistry,
            runtimeOfferId: runtimeOptions.offer.runtimeOfferId,
            runtimeProfileRevision: activeRevision,
          }),
        );
        const credentialEnvironment = new RuntimeCredentialEnvironmentBinding({
          manifest: activeRevision.manifest,
          resolvers: Object.fromEntries(
            Object.entries(runtimeOptions.credentialBindings).map(
              ([slotId, reference]) => [
                slotId,
                async () => await this.#secretProvider.load(reference),
              ],
            ),
          ),
        });
        runtime = createConfiguredRuntime({
          guideEnabled: (runtimeId) => runtimeGuideSettings.enabled(runtimeId),
          agentMemoryCoordinator: activeAgentMemoryCoordinator,
          credentialEnvironment,
          cwd: runtimeOptions.cwd,
          host,
          implementations,
          probeReport,
          runtimeProfileRegistry,
          runtimeProfileRevision: activeRevision,
          supervisorDirectory: join(this.#config.stateDirectory, "supervisors"),
          workerService: activeWorkerService,
        });
        const recovery = createRegistryBackedRuntimeRecovery({
          cwd: runtimeOptions.cwd,
          implementations,
          registry: runtimeProfileRegistry,
          supervisorDirectory: join(this.#config.stateDirectory, "supervisors"),
        });
        runtimeRecoveryDrivers = recovery.driverIds;
        runtimeRecoveryResolver = recovery.resolve;
        runtimeOfferPublishers.push(
          new RuntimeOfferPublisher({
            host,
            kernel,
            leaseMs: runtimeOptions.offer.leaseMs,
            maxConcurrent: runtimeOptions.offer.maxConcurrent,
            probeReport,
            revisionIsActive: () => {
              try {
                assertRuntimeProfileRevisionStillActive(
                  runtimeProfileRegistry,
                  activeRevision,
                );
                return true;
              } catch {
                return false;
              }
            },
            refreshIntervalMs: runtimeOptions.offer.refreshIntervalMs,
            refreshAvailability: async () =>
              await implementations.probeReportAppearsRunnable(
                activeRevision,
                probeReport,
              ),
            runtimeOfferId: runtimeOptions.offer.runtimeOfferId,
            runtimeProfileRevision: activeRevision,
          }),
        );
      } else {
        const v4Config = this.#config;
        const implementations = new RuntimeImplementationRegistry();
        const runtimesByOfferId = new Map<
          string,
          (placement: PlacementDecision) => RuntimeAdapter
        >();
        let defaultRuntime: RuntimeAdapter | undefined;
        const workspaceMountDescriptors = legacyWorkspaceMountDescriptors(
          v4Config.workspace,
        );
        for (const runtimeOptions of v4Config.runtimes) {
          const runtimeProfileRegistry = openRuntimeProfileRegistry(
            runtimeProfileRegistries,
            runtimeOptions.registryDatabasePath,
            host.hostId,
          );
          const activeRevision = runtimeProfileRegistry.getActiveRevision(
            runtimeOptions.runtimeProfileId,
          );
          if (activeRevision === null) {
            throw new Error(
              `RuntimeProfile ${runtimeOptions.runtimeProfileId} has no active revision`,
            );
          }
          const probeReport =
            v4Config.startupProbeMode === "reuse-latest"
              ? runtimeProfileRegistry.getLatestProbeReport(
                  activeRevision.runtimeProfileRevisionId,
                )
              : runtimeProfileRegistry.recordProbeReport(
                  await implementations.probeRevision(activeRevision, {
                    cwd: v4Config.workspace.cwd,
                  }),
                );
          if (probeReport === null) {
            throw new Error(
              `active RuntimeProfile ${activeRevision.runtimeProfileRevisionId} has no prepared probe report`,
            );
          }
          if (!probeReport.available) {
            throw new Error(
              `active RuntimeProfile probe failed: ${probeReport.failureCode ?? "unavailable"}`,
            );
          }
          configuredLocalRuntimes.push(
            configuredRuntimeSnapshotWithValidation({
              probeReport,
              registry: runtimeProfileRegistry,
              runtimeOfferId: runtimeOptions.offer.runtimeOfferId,
              runtimeProfileRevision: activeRevision,
            }),
          );
          const credentialEnvironment = new RuntimeCredentialEnvironmentBinding(
            {
              manifest: activeRevision.manifest,
              resolvers: Object.fromEntries(
                Object.entries(runtimeOptions.credentialBindings).map(
                  ([slotId, reference]) => [
                    slotId,
                    async () => await this.#secretProvider.load(reference),
                  ],
                ),
              ),
            },
          );
          const placementKernel = kernel;
          if (placementKernel === undefined) {
            throw new Error("config v4 requires an initialized RoomKernel");
          }
          const createRuntimeForPlacement = (
            placement?: PlacementDecision,
          ): RuntimeAdapter => {
            let placementProbeReport = probeReport;
            if (placement?.runtimeOfferObservationId !== undefined) {
              const observation = placementKernel.getRuntimeOfferObservation(
                placement.runtimeOfferObservationId,
              );
              if (
                observation.runtimeOfferId !== placement.runtimeOfferId ||
                observation.runtimeProfileRevisionId !==
                  placement.runtimeProfileRevisionId ||
                (placement.runtimeOfferSnapshotDigest !== undefined &&
                  observation.runtimeOfferSnapshotDigest !==
                    placement.runtimeOfferSnapshotDigest)
              ) {
                throw new Error(
                  `Placement ${placement.placementId} does not match its immutable RuntimeOffer observation`,
                );
              }
              const probeReportRef = observation.probeReportRef;
              if (probeReportRef === undefined) {
                throw new Error(
                  `Placement ${placement.placementId} RuntimeOffer observation has no probe evidence`,
                );
              }
              placementProbeReport = runtimeProfileRegistry.getProbeReport(
                probeReportRef.probeReportId,
              );
              if (
                placementProbeReport.probeDigest !== probeReportRef.probeDigest
              ) {
                throw new Error(
                  `Placement ${placement.placementId} RuntimeOffer probe digest does not match the registry`,
                );
              }
            }
            return createConfiguredRuntime({
              guideEnabled: (runtimeId) =>
                runtimeGuideSettings.enabled(runtimeId),
              agentMemoryCoordinator: activeAgentMemoryCoordinator,
              credentialEnvironment,
              ...resolveRuntimeWorkspace(placement, v4Config.workspace.cwd),
              host,
              implementations,
              probeReport: placementProbeReport,
              ...(placement?.resolvedModel === undefined
                ? {}
                : { resolvedModel: placement.resolvedModel }),
              ...(placement?.toolAccessMode === undefined
                ? {}
                : { toolAccessMode: placement.toolAccessMode }),
              runtimeProfileRegistry,
              runtimeProfileRevision: activeRevision,
              supervisorDirectory: join(v4Config.stateDirectory, "supervisors"),
              workerService: activeWorkerService,
            });
          };
          const configuredRuntime = createRuntimeForPlacement();
          const availability = await configuredRuntime.probe();
          if (!availability.available) {
            throw new Error(availability.detail ?? "runtime is unavailable");
          }
          defaultRuntime ??= configuredRuntime;
          runtimesByOfferId.set(
            runtimeOptions.offer.runtimeOfferId,
            (placement) => createRuntimeForPlacement(placement),
          );
          runtimeOfferPublishers.push(
            new RuntimeOfferPublisher({
              host,
              kernel,
              leaseMs: runtimeOptions.offer.leaseMs,
              maxConcurrent: runtimeOptions.offer.maxConcurrent,
              probeReport,
              revisionIsActive: () => {
                try {
                  assertRuntimeProfileRevisionStillActive(
                    runtimeProfileRegistry,
                    activeRevision,
                  );
                  return true;
                } catch {
                  return false;
                }
              },
              refreshIntervalMs: runtimeOptions.offer.refreshIntervalMs,
              refreshAvailability: async () =>
                await implementations.probeReportAppearsRunnable(
                  activeRevision,
                  probeReport,
                ),
              runtimeOfferId: runtimeOptions.offer.runtimeOfferId,
              runtimeProfileRevision: activeRevision,
              workspaceMountDescriptors,
              refreshWorkspaceMountDescriptors: refreshExecutionWorkspaces,
            }),
          );
        }
        if (defaultRuntime === undefined) {
          throw new Error("daemon config v4 requires at least one Runtime");
        }
        runtime = defaultRuntime;
        placementRuntimeResolver = (placement) => {
          const selected = runtimesByOfferId.get(placement.runtimeOfferId);
          if (selected === undefined) {
            throw new Error(
              `Placement references unconfigured RuntimeOffer ${placement.runtimeOfferId}`,
            );
          }
          return selected(placement);
        };
        const recovery = createRegistryBackedRuntimeRecoveryFromRegistries({
          cwd: v4Config.workspace.cwd,
          resolveCwd: createRecoveryCwdResolver(v4Config.workspace.cwd),
          implementations,
          registries: [...runtimeProfileRegistries.values()],
          supervisorDirectory: join(v4Config.stateDirectory, "supervisors"),
        });
        runtimeRecoveryDrivers = recovery.driverIds;
        runtimeRecoveryResolver = recovery.resolve;
      }
      const availability = await runtime.probe();
      if (!availability.available) {
        throw new Error(availability.detail ?? "runtime is unavailable");
      }
      const wakeSignal = new LocalWakeSignal();
      const discoveredLocalClis = await discoverKnownLocalClis();
      const runnerOptions = {
        guideEnabled: (runtimeId: string | undefined) =>
          runtimeGuideSettings.enabled(runtimeId),
        drainTimeoutMs: this.#config.drainTimeoutMs,
        host,
        kernel,
        leaseMs: this.#config.leaseMs,
        ...(this.#config.leaseRenewIntervalMs === undefined
          ? {}
          : { leaseRenewIntervalMs: this.#config.leaseRenewIntervalMs }),
        onCycleResult: ({ result }) => {
          this.#health = {
            ...this.#health,
            ...(result.state === "failed" ? { lastError: result.error } : {}),
            lastCycleAt: new Date().toISOString(),
            lastCycleState: result.state,
          };
        },
        pollIntervalMs: this.#config.pollIntervalMs,
        ...(this.#config.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: this.#config.retryAfterMs }),
        runTimeoutMs: this.#config.runTimeoutMs,
        runtime,
        runtimeCancelTimeoutMs: this.#config.runtimeCancelTimeoutMs,
        ...(runtimeRecoveryDrivers === undefined
          ? {}
          : { runtimeRecoveryDrivers }),
        ...(runtimeRecoveryResolver === undefined
          ? {}
          : { runtimeRecoveryResolver }),
        runtimeRecoveryTimeoutMs: this.#config.runtimeRecoveryTimeoutMs,
        runtimeStartTimeoutMs: this.#config.runtimeStartTimeoutMs,
        wait: async (delayMs, signal) => await wakeSignal.wait(delayMs, signal),
      } satisfies AgentHostOptions;
      const runner =
        placementRuntimeResolver === undefined
          ? new AgentHost(runnerOptions)
          : new MultiLaneAgentHost({
              ...runnerOptions,
              capacity:
                this.#config.schemaVersion === 4
                  ? this.#config.host.maxConcurrent
                  : 1,
              placementRuntimeResolver,
            });
      const wakeDispatcher = new OutboxWakeDispatcher({
        dispatcherId: `${host.hostId}:${host.instanceId}:wake`,
        kernel,
        leaseMs: this.#config.outboxLeaseMs,
        pollIntervalMs: this.#config.outboxPollIntervalMs,
        publisher: wakeSignal,
        retryAfterMs: this.#config.outboxRetryAfterMs,
      });
      const backgroundReconcilerRunners =
        createDaemonBackgroundReconcilerRunners(kernel, (lastError) => {
          this.#health = { ...this.#health, lastError };
        });
      const daemon = new AgentHostDaemon({
        host,
        instanceLock: new UnixSocketInstanceLock({
          directory:
            this.#config.lockDirectory ??
            `/tmp/rah-os-daemon-${String(process.getuid?.() ?? "user")}`,
          hostId: host.hostId,
        }),
        kernel,
        ...(runtimeOfferPublishers.length === 0
          ? {}
          : {
              lifecycle: createWorkspaceLifecycle(
                activeAgentExecutionResetCoordinator,
                runtimeOfferPublishers,
              ),
            }),
        metadata: {
          buildVersion: DAEMON_BUILD_VERSION,
          processId: process.pid,
          protocolVersion: DAEMON_PROTOCOL_VERSION,
          takeoverAfterMs: this.#config.hostStaleAfterMs,
        },
        runner,
      });
      clientService = createDaemonHumanClientService({
        runtimeGuideSettings,
        computerProfiles,
        agentExecutionResetCoordinator: activeAgentExecutionResetCoordinator,
        agentMemoryCoordinator: activeAgentMemoryCoordinator,
        buildVersion: DAEMON_BUILD_VERSION,
        config: this.#config,
        configuredLocalRuntimes,
        discoveredLocalClis,
        healthState: () => this.#health.state,
        host,
        human: core.human,
        kernel,

        protocolVersion: DAEMON_PROTOCOL_VERSION,
        webPushAdministration: webPush.administration,
      });
      await clientService.start();
      this.#clientOrigin = clientService.origin;
      this.#health = { ...this.#health, state: "online" };
      await runCoupledComponents(input.signal, [
        async (signal) => await daemon.run({ signal }),
        async (signal) => await wakeDispatcher.run({ signal }),
        ...backgroundReconcilerRunners,
        async (signal) => await webPush.dispatcher.run({ signal }),
        ...runtimeOfferPublishers.map(
          (publisher) => async (signal: AbortSignal) =>
            await publisher.run(signal),
        ),
      ]);
    } catch (error) {
      executionFailure = error;
      this.#health = {
        ...this.#health,
        lastError: errorMessage(error),
        state: "failed",
      };
    }

    const cleanupErrors: unknown[] = [];
    try {
      await clientService?.close();
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      this.#clientOrigin = undefined;
    }
    try {
      await agentMemoryCoordinator?.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await workerService?.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    for (const registry of runtimeProfileRegistries.values()) {
      try {
        registry.close();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      core?.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    const cleanupFailure =
      cleanupErrors.length === 0
        ? undefined
        : cleanupErrors.length === 1
          ? cleanupErrors[0]
          : new AggregateError(cleanupErrors, "daemon cleanup failed");
    if (cleanupFailure !== undefined) {
      this.#health = {
        ...this.#health,
        lastError: errorMessage(cleanupFailure),
        state: "failed",
      };
    }
    this.#running = false;

    if (executionFailure === undefined && cleanupFailure === undefined) {
      this.#health = { ...this.#health, state: "offline" };
      return;
    }
    if (executionFailure !== undefined && cleanupFailure !== undefined) {
      throw new AggregateError(
        [executionFailure, cleanupFailure],
        "daemon execution and cleanup both failed",
      );
    }
    throw executionFailure ?? cleanupFailure;
  }
}
