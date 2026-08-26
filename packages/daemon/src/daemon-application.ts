import { lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  AgentHost,
  AgentHostDaemon,
  buildRuntimeOfferFromProfile,
  GenericProcessAdapter,
  RuntimeCredentialEnvironmentBinding,
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
  UnixSocketInstanceLock,
  type RuntimeAdapter,
} from "@rah-os/agent-host";
import {
  ClientApplicationService,
  WorkerApplicationService,
} from "@rah-os/application-service";
import {
  AuthenticatedHostContext,
  KERNEL_SCHEMA_VERSION,
  RoomKernel,
  UnauthenticatedError,
} from "@rah-os/kernel";
import {
  CLIENT_API_VERSION,
  type RuntimeRecoveryDescriptor,
  type RuntimeProfileProbeReport,
  type RuntimeProfileRevision,
} from "@rah-os/protocol";

import type { DaemonConfig } from "./config.ts";
import {
  LocalWakeSignal,
  OutboxWakeDispatcher,
} from "./outbox-wake-dispatcher.ts";
import { FileSecretProvider, type SecretProvider } from "./secret-provider.ts";

export const DAEMON_BUILD_VERSION = "0.1.0";
export const DAEMON_PROTOCOL_VERSION = 1;

export type DaemonHealthSnapshot = {
  buildVersion: string;
  hostId: string;
  participantId: string;
  protocolVersion: number;
  state: "failed" | "offline" | "online" | "starting";
  lastCycleAt?: string;
  lastCycleState?: "completed" | "failed" | "recovered";
  lastError?: string;
  startedAt?: string;
};

export function createRegistryBackedRuntimeRecovery(input: {
  cwd: string;
  implementations: RuntimeImplementationRegistry;
  registry: RuntimeProfileRegistry;
  supervisorDirectory: string;
}): {
  driverIds: readonly string[];
  resolve(descriptor: RuntimeRecoveryDescriptor): RuntimeAdapter;
} {
  return {
    driverIds: input.implementations.recoveryDrivers(),
    resolve: (descriptor) => {
      if (
        descriptor.runtimeProfileRevisionId === undefined ||
        descriptor.runtimeProfileDigest === undefined ||
        descriptor.recoveryImplementationVersion === undefined
      ) {
        throw new Error(
          "registry-backed runtime recovery descriptor lacks immutable profile provenance",
        );
      }
      const recoveryRevision = input.registry.getRevision(
        descriptor.runtimeProfileRevisionId,
      );
      if (recoveryRevision.contentDigest !== descriptor.runtimeProfileDigest) {
        throw new Error(
          `runtime recovery profile digest mismatch: ${descriptor.runtimeProfileRevisionId}`,
        );
      }
      const installedRecoveryVersion =
        input.implementations.recoveryDriverImplementationVersion(
          descriptor.driver,
        );
      if (
        installedRecoveryVersion !== descriptor.recoveryImplementationVersion
      ) {
        throw new Error(
          `runtime recovery implementation version mismatch: ${descriptor.driver}`,
        );
      }
      return input.implementations.createRecoveryRuntime(
        recoveryRevision,
        descriptor.driver,
        {
          cwd: input.cwd,
          supervisorDirectory: input.supervisorDirectory,
        },
      );
    },
  };
}

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
      participantId: this.#config.host.participantId,
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

    let kernel: RoomKernel | undefined;
    let clientService: ClientApplicationService | undefined;
    let workerService: WorkerApplicationService | undefined;
    let runtimeProfileRegistry: RuntimeProfileRegistry | undefined;
    let executionFailure: unknown;
    try {
      await ensureOwnerPrivateDirectory(this.#config.stateDirectory);
      const hostAccessToken = await this.#secretProvider.load(
        this.#config.host.credential,
      );
      kernel = new RoomKernel({
        databasePath: join(this.#config.stateDirectory, "room.db"),
      });
      kernel.initialize();
      const host = kernel.authenticateHostAccessToken(hostAccessToken);
      if (host.hostId !== this.#config.host.hostId) {
        throw new Error(
          "configured hostId does not match the authenticated Host credential",
        );
      }
      if (
        host.participantIds.length !== 1 ||
        host.participantIds[0] !== this.#config.host.participantId
      ) {
        throw new Error(
          "daemon core currently requires one Host credential scoped to exactly the configured participant",
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
      let runtimeOfferPublisher: RuntimeOfferPublisher | undefined;
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
      } else {
        const runtimeOptions = this.#config.runtime;
        runtimeProfileRegistry = new RuntimeProfileRegistry({
          databasePath: runtimeOptions.registryDatabasePath,
          hostId: host.hostId,
        });
        runtimeProfileRegistry.initialize();
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
        runtimeOfferPublisher = new RuntimeOfferPublisher({
          host,
          kernel,
          leaseMs: runtimeOptions.offer.leaseMs,
          maxConcurrent: runtimeOptions.offer.maxConcurrent,
          probeReport,
          revisionIsActive: () => {
            try {
              assertRuntimeProfileRevisionStillActive(
                runtimeProfileRegistry!,
                activeRevision,
              );
              return true;
            } catch {
              return false;
            }
          },
          refreshIntervalMs: runtimeOptions.offer.refreshIntervalMs,
          refreshProbe: async () =>
            runtimeProfileRegistry!.recordProbeReport(
              await implementations.probeRevision(activeRevision, {
                cwd: runtimeOptions.cwd,
              }),
            ),
          runtimeOfferId: runtimeOptions.offer.runtimeOfferId,
          runtimeProfileRevision: activeRevision,
        });
      }
      const availability = await runtime.probe();
      if (!availability.available) {
        throw new Error(availability.detail ?? "runtime is unavailable");
      }
      const wakeSignal = new LocalWakeSignal();
      const runner = new AgentHost({
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
        ...(runtimeOfferPublisher === undefined
          ? {}
          : {
              lifecycle: {
                afterOnline: () => runtimeOfferPublisher.publishAvailable(),
                beforeDraining: () =>
                  runtimeOfferPublisher.publishUnavailable(),
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
            roomSync: true,
            taskRead: true,
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
        ...(runtimeOfferPublisher === undefined
          ? []
          : [
              async (signal: AbortSignal) =>
                await runtimeOfferPublisher.run(signal),
            ]),
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
    try {
      runtimeProfileRegistry?.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      kernel?.close();
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

class RuntimeOfferPublisher {
  readonly #host: AuthenticatedHostContext;
  readonly #kernel: RoomKernel;
  readonly #leaseMs: number;
  readonly #maxConcurrent: number;
  #probeReport: RuntimeProfileProbeReport;
  readonly #refreshProbe: () => Promise<RuntimeProfileProbeReport>;
  readonly #revisionIsActive: () => boolean;
  readonly #refreshIntervalMs: number;
  readonly #runtimeOfferId: string;
  readonly #runtimeExecutableIdentity:
    RuntimeProfileProbeReport["executableIdentity"] | undefined;
  readonly #runtimeProfileRevision: RuntimeProfileRevision;
  #lastObservedAtMs = 0;

  constructor(input: {
    host: AuthenticatedHostContext;
    kernel: RoomKernel;
    leaseMs: number;
    maxConcurrent: number;
    probeReport: RuntimeProfileProbeReport;
    refreshIntervalMs: number;
    refreshProbe: () => Promise<RuntimeProfileProbeReport>;
    revisionIsActive: () => boolean;
    runtimeOfferId: string;
    runtimeProfileRevision: RuntimeProfileRevision;
  }) {
    this.#host = input.host;
    this.#kernel = input.kernel;
    this.#leaseMs = input.leaseMs;
    this.#maxConcurrent = input.maxConcurrent;
    this.#probeReport = structuredClone(input.probeReport);
    this.#refreshIntervalMs = input.refreshIntervalMs;
    this.#refreshProbe = input.refreshProbe;
    this.#revisionIsActive = input.revisionIsActive;
    this.#runtimeOfferId = input.runtimeOfferId;
    this.#runtimeExecutableIdentity = structuredClone(
      input.probeReport.executableIdentity,
    );
    this.#runtimeProfileRevision = structuredClone(
      input.runtimeProfileRevision,
    );
  }

  async run(signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted) {
        await waitForAbortOrDelay(this.#refreshIntervalMs, signal);
        if (signal.aborted) break;
        this.#probeReport = await this.#refreshProbe();
        this.#tryPublish(this.#currentOfferState());
      }
    } finally {
      this.publishUnavailable();
    }
  }

  publishAvailable(): boolean {
    return this.#tryPublish(this.#currentOfferState());
  }

  publishUnavailable(): boolean {
    return this.#tryPublish("unavailable");
  }

  #currentOfferState(): "available" | "unavailable" {
    const current = this.#probeReport.executableIdentity;
    const expected = this.#runtimeExecutableIdentity;
    return this.#revisionIsActive() &&
      this.#probeReport.available &&
      current !== undefined &&
      expected !== undefined &&
      current.requestedExecutable === expected.requestedExecutable &&
      current.resolvedExecutablePath === expected.resolvedExecutablePath &&
      current.contentDigest === expected.contentDigest &&
      current.byteLength === expected.byteLength
      ? "available"
      : "unavailable";
  }

  #tryPublish(state: "available" | "unavailable"): boolean {
    try {
      this.#publish(state);
      return true;
    } catch (error) {
      if (
        error instanceof UnauthenticatedError &&
        error.message === "Host daemon instance is not active"
      ) {
        return false;
      }
      throw error;
    }
  }

  #publish(state: "available" | "unavailable"): void {
    const observedAtMs = Math.max(Date.now(), this.#lastObservedAtMs + 1);
    this.#lastObservedAtMs = observedAtMs;
    this.#kernel.publishRuntimeOffer(
      this.#host,
      buildRuntimeOfferFromProfile({
        hostId: this.#host.hostId,
        hostInstanceId: this.#host.instanceId,
        leaseUntil: new Date(observedAtMs + this.#leaseMs).toISOString(),
        maxConcurrent: this.#maxConcurrent,
        observedAt: new Date(observedAtMs).toISOString(),
        probeReport: this.#probeReport,
        runtimeOfferId: this.#runtimeOfferId,
        runtimeProfileRevision: this.#runtimeProfileRevision,
        state,
      }),
    );
  }
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

async function waitForAbortOrDelay(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolvePromise) => {
    const timer = setTimeout(finish, delayMs);
    const onAbort = () => finish();
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolvePromise();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
