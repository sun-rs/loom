import { lstat, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  AgentHost,
  AgentHostDaemon,
  GenericProcessAdapter,
  MultiLaneAgentHost,
  RuntimeCredentialEnvironmentBinding,
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
  UnixSocketInstanceLock,
  type AgentHostOptions,
  type RuntimeAdapter,
} from "@rah-os/agent-host";
import {
  ClientApplicationService,
  WorkerApplicationService,
} from "@rah-os/application-service";
import {
  KERNEL_SCHEMA_VERSION,
  RahCore,
  type AuthenticatedHostContext,
  RoomKernel,
} from "@rah-os/core";
import {
  CLIENT_API_VERSION,
  type RuntimeRecoveryDescriptor,
  type RuntimeProfileRevision,
  type WorkspaceMountDescriptor,
} from "@rah-os/protocol";

import type { DaemonConfig } from "./config.ts";
import {
  createRegistryBackedRuntimeRecovery,
  createRegistryBackedRuntimeRecoveryFromRegistries,
} from "./registry-runtime-recovery.ts";
import {
  LocalWakeSignal,
  OutboxWakeDispatcher,
} from "./outbox-wake-dispatcher.ts";
import { RuntimeOfferPublisher } from "./runtime-offer-publisher.ts";
import { FileSecretProvider, type SecretProvider } from "./secret-provider.ts";

export const DAEMON_BUILD_VERSION = "0.1.0";
export const DAEMON_PROTOCOL_VERSION = 1;

export type DaemonHealthSnapshot = {
  buildVersion: string;
  hostId: string;
  participantId?: string;
  participantIds: string[];
  protocolVersion: number;
  state: "failed" | "offline" | "online" | "starting";
  lastCycleAt?: string;
  lastCycleState?: "completed" | "failed" | "recovered";
  lastError?: string;
  startedAt?: string;
};

function assertRuntimeProfileRevisionStillActive(
  registry: RuntimeProfileRegistry,
  expectedRevision: RuntimeProfileRevision,
): void {
  const current = registry.getActiveRevision(expectedRevision.runtimeProfileId);
  if (
    current === null ||
    current.state !== "active" ||
    current.runtimeProfileRevisionId !==
      expectedRevision.runtimeProfileRevisionId ||
    current.contentDigest !== expectedRevision.contentDigest
  ) {
    throw new Error(
      `RuntimeProfile ${expectedRevision.runtimeProfileId} active revision changed; restart the daemon to select the new revision`,
    );
  }
}

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
    let clientService: ClientApplicationService | undefined;
    let workerService: WorkerApplicationService | undefined;
    const runtimeProfileRegistries = new Map<string, RuntimeProfileRegistry>();
    let executionFailure: unknown;
    try {
      await ensureOwnerPrivateDirectory(this.#config.stateDirectory);
      const hostAccessToken = await this.#secretProvider.load(
        this.#config.host.credential,
      );
      core = RahCore.open({
        databasePath: join(this.#config.stateDirectory, "room.db"),
        ...(this.#config.schemaVersion === 4
          ? {
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
      if (
        JSON.stringify([...host.participantIds].sort()) !==
        JSON.stringify(configuredParticipantIds(this.#config))
      ) {
        throw new Error(
          "configured participant scope does not match the authenticated Host credential",
        );
      }

      workerService = new WorkerApplicationService({
        kernel,
        ...(this.#config.taskClaimHeartbeatIntervalMs === undefined
          ? {}
          : {
              taskClaimHeartbeatIntervalMs:
                this.#config.taskClaimHeartbeatIntervalMs,
            }),
        ...(this.#config.taskClaimLeaseMs === undefined
          ? {}
          : { taskClaimLeaseMs: this.#config.taskClaimLeaseMs }),
      });
      await workerService.start();
      const activeWorkerService = workerService;
      let runtime: RuntimeAdapter;
      const runtimeOfferPublishers: RuntimeOfferPublisher[] = [];
      let placementRuntimeResolver:
        ((placement: { runtimeOfferId: string }) => RuntimeAdapter) | undefined;
      let runtimeRecoveryDrivers: readonly string[] | undefined;
      let runtimeRecoveryResolver:
        ((descriptor: RuntimeRecoveryDescriptor) => RuntimeAdapter) | undefined;
      if (this.#config.schemaVersion === 2) {
        const runtimeOptions = this.#config.runtime;
        runtime = new GenericProcessAdapter({
          activationEnvironment: (scope) => {
            const credential = activeWorkerService.issueActivationCredential(
              host,
              scope,
            );
            return {
              env: {
                RAH_WORKER_API_URL: activeWorkerService.origin,
                RAH_WORKER_TOKEN: credential.accessToken,
              },
              redactions: [credential.accessToken],
              release: credential.revoke,
            };
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
        runtime = implementations.createRuntime(activeRevision, probeReport, {
          activationEnvironment: async (scope) => {
            const secretLease = await credentialEnvironment.resolve();
            const credential = activeWorkerService.issueActivationCredential(
              host,
              scope,
            );
            return {
              env: {
                ...secretLease.env,
                RAH_WORKER_API_URL: activeWorkerService.origin,
                RAH_WORKER_TOKEN: credential.accessToken,
              },
              redactions: [
                ...(secretLease.redactions ?? []),
                credential.accessToken,
              ],
              release: () => {
                credential.revoke();
                secretLease.release?.();
              },
            };
          },
          beforeStart: () =>
            assertRuntimeProfileRevisionStillActive(
              runtimeProfileRegistry!,
              activeRevision,
            ),
          cwd: runtimeOptions.cwd,
          supervisorDirectory: join(this.#config.stateDirectory, "supervisors"),
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
            refreshProbe: async () =>
              runtimeProfileRegistry.recordProbeReport(
                await implementations.probeRevision(activeRevision, {
                  cwd: runtimeOptions.cwd,
                }),
              ),
            runtimeOfferId: runtimeOptions.offer.runtimeOfferId,
            runtimeProfileRevision: activeRevision,
          }),
        );
      } else {
        const v4Config = this.#config;
        const implementations = new RuntimeImplementationRegistry();
        const runtimesByOfferId = new Map<string, RuntimeAdapter>();
        const workspaceMountDescriptors: WorkspaceMountDescriptor[] = [
          {
            modes: [v4Config.workspace.mode],
            workspaceDefinitionId: v4Config.workspace.workspaceDefinitionId,
            workspaceMountDigest: v4Config.workspace.workspaceMountDigest,
            workspaceMountRevisionId:
              v4Config.workspace.workspaceMountRevisionId,
          },
        ];
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
          const probeReport = runtimeProfileRegistry.recordProbeReport(
            await implementations.probeRevision(activeRevision, {
              cwd: v4Config.workspace.cwd,
            }),
          );
          if (!probeReport.available) {
            throw new Error(
              `active RuntimeProfile probe failed: ${probeReport.failureCode ?? "unavailable"}`,
            );
          }
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
          const configuredRuntime = implementations.createRuntime(
            activeRevision,
            probeReport,
            {
              activationEnvironment: async (scope) => {
                const secretLease = await credentialEnvironment.resolve();
                const credential =
                  activeWorkerService.issueActivationCredential(host, scope);
                return {
                  env: {
                    ...secretLease.env,
                    RAH_WORKER_API_URL: activeWorkerService.origin,
                    RAH_WORKER_TOKEN: credential.accessToken,
                  },
                  redactions: [
                    ...(secretLease.redactions ?? []),
                    credential.accessToken,
                  ],
                  release: () => {
                    credential.revoke();
                    secretLease.release?.();
                  },
                };
              },
              beforeStart: () =>
                assertRuntimeProfileRevisionStillActive(
                  runtimeProfileRegistry,
                  activeRevision,
                ),
              cwd: v4Config.workspace.cwd,
              supervisorDirectory: join(v4Config.stateDirectory, "supervisors"),
            },
          );
          const availability = await configuredRuntime.probe();
          if (!availability.available) {
            throw new Error(availability.detail ?? "runtime is unavailable");
          }
          runtimesByOfferId.set(
            runtimeOptions.offer.runtimeOfferId,
            configuredRuntime,
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
              refreshProbe: async () =>
                runtimeProfileRegistry.recordProbeReport(
                  await implementations.probeRevision(activeRevision, {
                    cwd: v4Config.workspace.cwd,
                  }),
                ),
              runtimeOfferId: runtimeOptions.offer.runtimeOfferId,
              runtimeProfileRevision: activeRevision,
              workspaceMountDescriptors,
            }),
          );
        }
        runtime = runtimesByOfferId.values().next().value!;
        placementRuntimeResolver = (placement) => {
          const selected = runtimesByOfferId.get(placement.runtimeOfferId);
          if (selected === undefined) {
            throw new Error(
              `Placement references unconfigured RuntimeOffer ${placement.runtimeOfferId}`,
            );
          }
          return selected;
        };
        const recovery = createRegistryBackedRuntimeRecoveryFromRegistries({
          cwd: v4Config.workspace.cwd,
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
      const runnerOptions = {
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
              lifecycle: {
                afterOnline: () => {
                  for (const publisher of runtimeOfferPublishers) {
                    publisher.publishAvailable();
                  }
                },
                beforeDraining: () => {
                  for (const publisher of runtimeOfferPublishers) {
                    publisher.publishUnavailable();
                  }
                },
              },
            }),
        metadata: {
          buildVersion: DAEMON_BUILD_VERSION,
          processId: process.pid,
          protocolVersion: DAEMON_PROTOCOL_VERSION,
          takeoverAfterMs: this.#config.hostStaleAfterMs,
        },
        runner,
      });
      clientService = new ClientApplicationService({
        bindHost: this.#config.client.bindHost,
        health: () => ({
          apiVersion: CLIENT_API_VERSION,
          buildVersion: DAEMON_BUILD_VERSION,
          capabilities: {
            cursorAcknowledge: true,
            hints: false,
            inputRequestRead: true,
            inputRequestResolve: true,
            memberRead: true,
            memberWrite: true,
            messageRead: true,
            messageWrite: true,
            roomRead: true,
            roomSync: true,
            taskRead: true,
            taskWrite: true,
            threadRead: true,
            threadWrite: true,
            workspaceRead: true,
          },
          kernelSchemaVersion: KERNEL_SCHEMA_VERSION,
          protocolVersion: DAEMON_PROTOCOL_VERSION,
          state: this.#health.state,
        }),
        kernel,
        port: this.#config.client.port,
      });
      await clientService.start();
      this.#clientOrigin = clientService.origin;
      this.#health = { ...this.#health, state: "online" };
      await runCoupledComponents(input.signal, [
        async (signal) => await daemon.run({ signal }),
        async (signal) => await wakeDispatcher.run({ signal }),
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

function configuredParticipantIds(config: DaemonConfig): string[] {
  return config.schemaVersion === 4
    ? [...config.host.participantIds].sort()
    : [config.host.participantId];
}

function openRuntimeProfileRegistry(
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

async function ensureOwnerPrivateDirectory(directory: string): Promise<void> {
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runCoupledComponents(
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
