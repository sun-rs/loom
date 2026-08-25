import { lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  AgentHost,
  AgentHostDaemon,
  GenericProcessAdapter,
  UnixSocketInstanceLock,
} from "@rah-os/agent-host";
import {
  ClientApplicationService,
  WorkerApplicationService,
} from "@rah-os/application-service";
import { KERNEL_SCHEMA_VERSION, RoomKernel } from "@rah-os/kernel";
import { CLIENT_API_VERSION } from "@rah-os/protocol";

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
      const runtimeOptions = this.#config.runtime;
      const runtime = new GenericProcessAdapter({
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
