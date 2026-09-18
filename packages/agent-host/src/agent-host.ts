import { resolveRuntimeDeliveryMode } from "./runtime.ts";
import { maintainRuntimeBusyNotices } from "./runtime-busy-notices.ts";
import { watchRuntimeLiveness } from "./runtime-watchdog.ts";
import {
  ActivationCancellationRequestedError,
  AgentExecutionPausedError,
  AuthenticatedHostContext,
  UnauthenticatedError,
  type Activation,
  type RoomKernel,
  type RunAttempt,
} from "@rah-os/kernel";
import type {
  PlacementDecision,
  RuntimeFailure,
  RuntimeRecoveryDescriptor,
} from "@rah-os/protocol";

import type {
  ActivationEnvelope,
  RunExit,
  RunHandle,
  RuntimeAdapter,
} from "./runtime.ts";
import {
  createKernelAgentHostControlPort,
  type AgentHostControlPort,
} from "./agent-host-control.ts";
import {
  RUNTIME_ERROR_RETRY_JITTER_RATIO,
  runtimeErrorRetryDelay,
  runtimeErrorJitterRandom,
} from "./runtime-error-policy.ts";
import type { AgentStartGate } from "./agent-start-coordinator.ts";

const DEFAULT_ACTIVATION_RETRY_DELAY_MS = 10_000;

export type HostCycleResult =
  | { state: "idle" }
  | {
      activationId: string;
      exit: RunExit;
      runAttemptId: string;
      runId: string;
      state: "completed";
    }
  | {
      activationId: string;
      error: string;
      state: "failed";
    }
  | {
      activationId: string;
      reason: string;
      state: "cancelled";
    };

export type OrphanRecoveryCycleResult =
  | { state: "idle" }
  | {
      activationId: string;
      exit: RunExit;
      runAttemptId: string;
      runtimeProcessId: string;
      state: "recovered";
    }
  | {
      error: string;
      runtimeProcessId?: string;
      state: "failed";
    };

export type HostCycleObservation =
  | { kind: "activation"; result: Exclude<HostCycleResult, { state: "idle" }> }
  | {
      kind: "recovery";
      result: Exclude<OrphanRecoveryCycleResult, { state: "idle" }>;
    };

export type AgentHostIdentity = Readonly<{
  credentialId?: string;
  hostId: string;
  instanceId: string;
  participantIds: readonly string[];
}>;

export type AgentHostOptions = {
  guideEnabled?: (runtimeId: string | undefined) => boolean;
  control?: AgentHostControlPort;
  drainTimeoutMs?: number;
  host: AgentHostIdentity;
  kernel?: RoomKernel;
  leaseMs: number;
  leaseRenewIntervalMs?: number;
  manageHostLifecycle?: boolean;
  maintenanceWait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  onCycleResult?: (observation: HostCycleObservation) => void;
  pollIntervalMs?: number;
  retryAfterMs?: number;
  retryJitterRandom?: () => number;
  retryJitterRatio?: number;
  runTimeoutMs?: number;
  runtime: RuntimeAdapter;
  placementRuntimeResolver?: (placement: PlacementDecision) => RuntimeAdapter;
  runtimeCancelTimeoutMs?: number;
  runtimeRecoveryDrivers?: readonly string[];
  runtimeRecoveryResolver?: (
    descriptor: RuntimeRecoveryDescriptor,
  ) => RuntimeAdapter;
  runtimeRecoveryTimeoutMs?: number;
  runtimeStartTimeoutMs?: number;
  startGate?: AgentStartGate;
  timeoutWait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
};

/**
 * Outcome of the gated runtime start. `lease-lost` carries the renewal failure
 * taken after the start slot was granted, so the caller can resolve a
 * cancellation rather than treat it as a start failure.
 */
type GatedRuntimeStart =
  { error: unknown; kind: "lease-lost" } | { kind: "started"; run: RunHandle };

export class AgentHost {
  readonly #guideEnabled: (runtimeId: string | undefined) => boolean;
  readonly #drainTimeoutMs: number;
  readonly #host: AgentHostIdentity;
  readonly #hostId: string;
  readonly #consumerId: string;
  readonly #control: AgentHostControlPort;
  readonly #leaseMs: number;
  readonly #leaseRenewIntervalMs: number;
  readonly #manageHostLifecycle: boolean;
  readonly #maintenanceWait: (
    delayMs: number,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly #onCycleResult:
    ((observation: HostCycleObservation) => void) | undefined;
  readonly #pollIntervalMs: number;
  readonly #placementRuntimeResolver:
    ((placement: PlacementDecision) => RuntimeAdapter) | undefined;
  readonly #retryAfterMs: number;
  readonly #retryJitterRandom: () => number;
  readonly #retryJitterRatio: number;
  readonly #runTimeoutMs: number;
  readonly #runtime: RuntimeAdapter;
  readonly #runtimeCancelTimeoutMs: number;
  readonly #runtimeRecoveryDrivers: readonly string[];
  readonly #runtimeRecoveryResolver:
    ((descriptor: RuntimeRecoveryDescriptor) => RuntimeAdapter) | undefined;
  readonly #runtimeRecoveryTimeoutMs: number;
  readonly #runtimeStartTimeoutMs: number;
  readonly #timeoutWait: (
    delayMs: number,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly #wait: (delayMs: number, signal: AbortSignal) => Promise<void>;
  readonly #startGate: AgentStartGate | undefined;
  #draining = false;
  #drainDeadlineAtMs: number | undefined;
  #runSignal: AbortSignal | undefined;

  constructor(options: AgentHostOptions) {
    this.#guideEnabled = options.guideEnabled ?? (() => false);
    if (!Number.isInteger(options.leaseMs) || options.leaseMs <= 0) {
      throw new Error("leaseMs must be a positive integer");
    }
    const participantIds = [...options.host.participantIds];
    if (participantIds.length === 0) {
      throw new Error("AgentHost requires at least one participant");
    }
    const retryAfterMs =
      options.retryAfterMs ?? DEFAULT_ACTIVATION_RETRY_DELAY_MS;
    if (!Number.isInteger(retryAfterMs) || retryAfterMs < 0) {
      throw new Error("retryAfterMs must be a non-negative integer");
    }
    const pollIntervalMs = options.pollIntervalMs ?? 1_000;
    if (!Number.isInteger(pollIntervalMs) || pollIntervalMs <= 0) {
      throw new Error("pollIntervalMs must be a positive integer");
    }
    const leaseRenewIntervalMs =
      options.leaseRenewIntervalMs ??
      Math.max(1, Math.floor(options.leaseMs / 3));
    if (
      !Number.isInteger(leaseRenewIntervalMs) ||
      leaseRenewIntervalMs <= 0 ||
      leaseRenewIntervalMs >= options.leaseMs
    ) {
      throw new Error(
        "leaseRenewIntervalMs must be positive and less than leaseMs",
      );
    }
    const runTimeoutMs = options.runTimeoutMs ?? 30 * 60_000;
    if (!Number.isInteger(runTimeoutMs) || runTimeoutMs <= 0) {
      throw new Error("runTimeoutMs must be a positive integer");
    }
    const drainTimeoutMs = options.drainTimeoutMs ?? 30_000;
    const runtimeCancelTimeoutMs = options.runtimeCancelTimeoutMs ?? 15_000;
    const runtimeRecoveryTimeoutMs = options.runtimeRecoveryTimeoutMs ?? 60_000;
    const runtimeStartTimeoutMs = options.runtimeStartTimeoutMs ?? 30_000;
    for (const [name, value] of [
      ["drainTimeoutMs", drainTimeoutMs],
      ["runtimeCancelTimeoutMs", runtimeCancelTimeoutMs],
      ["runtimeRecoveryTimeoutMs", runtimeRecoveryTimeoutMs],
      ["runtimeStartTimeoutMs", runtimeStartTimeoutMs],
    ] as const) {
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
      }
    }
    this.#drainTimeoutMs = drainTimeoutMs;
    this.#startGate = options.startGate;
    this.#host = options.host;
    this.#hostId = options.host.hostId;
    this.#consumerId = `${options.host.hostId}:runtime`;
    if ((options.kernel === undefined) === (options.control === undefined)) {
      throw new Error("AgentHost requires exactly one Kernel or control port");
    }
    if (options.kernel !== undefined) {
      if (!(options.host instanceof AuthenticatedHostContext)) {
        throw new Error(
          "Kernel-backed AgentHost requires an authenticated Host context",
        );
      }
      this.#control = createKernelAgentHostControlPort(
        options.kernel,
        options.host,
      );
    } else {
      this.#control = options.control!;
    }
    this.#leaseMs = options.leaseMs;
    this.#leaseRenewIntervalMs = leaseRenewIntervalMs;
    this.#manageHostLifecycle = options.manageHostLifecycle ?? true;
    this.#maintenanceWait = options.maintenanceWait ?? waitForDelay;
    this.#onCycleResult = options.onCycleResult;
    this.#pollIntervalMs = pollIntervalMs;
    this.#placementRuntimeResolver = options.placementRuntimeResolver;
    this.#retryAfterMs = retryAfterMs;
    this.#retryJitterRandom =
      options.retryJitterRandom ?? runtimeErrorJitterRandom;
    this.#retryJitterRatio =
      options.retryJitterRatio ?? RUNTIME_ERROR_RETRY_JITTER_RATIO;
    this.#runTimeoutMs = runTimeoutMs;
    this.#runtime = options.runtime;
    this.#runtimeCancelTimeoutMs = runtimeCancelTimeoutMs;
    this.#runtimeRecoveryDrivers = [
      ...new Set(
        options.runtimeRecoveryDrivers ?? options.runtime.recoveryDrivers ?? [],
      ),
    ];
    this.#runtimeRecoveryResolver = options.runtimeRecoveryResolver;
    this.#runtimeRecoveryTimeoutMs = runtimeRecoveryTimeoutMs;
    this.#runtimeStartTimeoutMs = runtimeStartTimeoutMs;
    this.#timeoutWait = options.timeoutWait ?? waitForDelay;
    this.#wait = options.wait ?? waitForDelay;
  }

  async reconcileOrphanOnce(): Promise<OrphanRecoveryCycleResult> {
    if (this.#runtimeRecoveryDrivers.length === 0) {
      return { state: "idle" };
    }
    await this.#heartbeat();
    const runtimeProcess = await this.#control.leaseNextRuntimeRecovery({
      driverIds: [...this.#runtimeRecoveryDrivers],
      leaseMs: this.#leaseMs,
    });
    if (runtimeProcess === null) return { state: "idle" };

    const recoverySupervisor = new AbortController();
    const recoveryMaintenance = this.#maintainRecoveryLease(
      runtimeProcess.runtimeProcessId,
      runtimeProcess.recoveryAttemptCount,
      recoverySupervisor.signal,
    );
    const maintenanceFailure = recoveryMaintenance.then<RunExit>(
      async (outcome) => {
        if (outcome.kind === "maintenance_failed") {
          throw new Error(outcome.error);
        }
        return await new Promise<RunExit>(() => {});
      },
    );
    let exit: RunExit;
    try {
      const recoveryRuntime =
        this.#runtimeRecoveryResolver?.(runtimeProcess.recoveryDescriptor) ??
        this.#runtime;
      const recover = recoveryRuntime.recover;
      if (
        recover === undefined ||
        !(recoveryRuntime.recoveryDrivers ?? []).includes(
          runtimeProcess.recoveryDescriptor.driver,
        )
      ) {
        throw new Error(
          `runtime recovery driver is unavailable: ${runtimeProcess.recoveryDescriptor.driver}`,
        );
      }
      exit = await Promise.race([
        withDeadline(
          recover.call(recoveryRuntime, {
            recoveryDescriptor: runtimeProcess.recoveryDescriptor,
            runAttemptId: runtimeProcess.runAttemptId,
            runtimeRunId: runtimeProcess.runtimeRunId,
          }),
          this.#runtimeRecoveryTimeoutMs,
          "runtime recovery",
        ),
        maintenanceFailure,
      ]);
    } catch (error) {
      recoverySupervisor.abort();
      await recoveryMaintenance;
      const failure = `runtime orphan recovery failed: ${errorMessage(error)}`;
      try {
        await this.#control.retryRuntimeRecovery({
          error: failure,
          recoveryAttemptCount: runtimeProcess.recoveryAttemptCount,
          retryAfterMs: this.#retryAfterMs,
          runtimeProcessId: runtimeProcess.runtimeProcessId,
        });
      } catch (retryError) {
        return {
          error: `${failure}; durable recovery retry failed: ${errorMessage(retryError)}`,
          runtimeProcessId: runtimeProcess.runtimeProcessId,
          state: "failed",
        };
      }
      return {
        error: failure,
        runtimeProcessId: runtimeProcess.runtimeProcessId,
        state: "failed",
      };
    }
    recoverySupervisor.abort();
    await recoveryMaintenance;

    try {
      await this.#control.recordRecoveredRuntimeTermination({
        exit,
        recoveryAttemptCount: runtimeProcess.recoveryAttemptCount,
        runtimeProcessId: runtimeProcess.runtimeProcessId,
      });
      await this.#control.resolveActivationQuarantine({
        activationId: runtimeProcess.activationId,
      });
      return {
        activationId: runtimeProcess.activationId,
        exit,
        runAttemptId: runtimeProcess.runAttemptId,
        runtimeProcessId: runtimeProcess.runtimeProcessId,
        state: "recovered",
      };
    } catch (error) {
      return {
        error: `durable orphan recovery failed: ${errorMessage(error)}`,
        runtimeProcessId: runtimeProcess.runtimeProcessId,
        state: "failed",
      };
    }
  }

  async reconcileOnce(): Promise<HostCycleResult> {
    await this.#heartbeat();
    let activation: Activation;
    let runAttempt: RunAttempt | undefined;
    let agentContext: ActivationEnvelope["agent"];
    let runtime = this.#runtime;
    if (this.#placementRuntimeResolver === undefined) {
      const leased = await this.#control.leaseNextActivation({
        leaseMs: this.#leaseMs,
      });
      if (leased === null) return { state: "idle" };
      activation = leased;
    } else {
      await this.#control.scheduleNextPlacement({ leaseMs: this.#leaseMs });
      const claim = await this.#control.claimNextPlacement({
        leaseMs: this.#leaseMs,
      });
      if (claim === null) return { state: "idle" };
      activation = claim.activation;
      agentContext = claim.agentContext;
      runAttempt = claim.runAttempt;
      try {
        runtime = this.#placementRuntimeResolver(claim.placement);
      } catch (error) {
        return this.#failClaimedActivation(
          activation,
          runAttempt.runAttemptId,
          `runtime placement resolution failed: ${errorMessage(error)}`,
        );
      }
    }

    try {
      await this.#control.renewActivationLease({
        activationId: activation.activationId,
        leaseMs: this.#leaseMs,
      });
    } catch (error) {
      if (error instanceof ActivationCancellationRequestedError) {
        if (runAttempt !== undefined) {
          await this.#control.finishRunAttempt({
            error: error.message,
            runAttemptId: runAttempt.runAttemptId,
            state: "cancelled",
          });
        }
        await this.#control.resolveActivationCancellation({
          activationId: activation.activationId,
        });
        return {
          activationId: activation.activationId,
          reason: error.message,
          state: "cancelled",
        };
      }
      const agentPaused = error instanceof AgentExecutionPausedError;
      const stopReason = agentPaused
        ? error.message
        : `pre-launch lease validation failed: ${errorMessage(error)}`;
      if (runAttempt !== undefined) {
        try {
          await this.#control.finishRunAttempt({
            error: stopReason,
            runAttemptId: runAttempt.runAttemptId,
            state: agentPaused ? "cancelled" : "failed",
          });
        } catch (error) {
          return {
            activationId: activation.activationId,
            error: `${stopReason}; failed to close pre-launch RunAttempt: ${errorMessage(error)}`,
            state: "failed",
          };
        }
      }
      return this.#retryFailedActivation(activation, stopReason);
    }

    try {
      const availability = await runtime.probe();
      if (!availability.available) {
        const failure = availability.detail ?? "runtime is unavailable";
        return runAttempt === undefined
          ? this.#retryFailedActivation(activation, failure)
          : this.#failClaimedActivation(
              activation,
              runAttempt.runAttemptId,
              failure,
            );
      }
    } catch (error) {
      const failure = errorMessage(error);
      return runAttempt === undefined
        ? this.#retryFailedActivation(activation, failure)
        : this.#failClaimedActivation(
            activation,
            runAttempt.runAttemptId,
            failure,
          );
    }

    try {
      await this.#control.renewActivationLease({
        activationId: activation.activationId,
        leaseMs: this.#leaseMs,
      });
    } catch (error) {
      return this.#failPreStartLease(error, activation, runAttempt);
    }

    runAttempt ??= await this.#control.createRunAttempt({
      activationId: activation.activationId,
    });
    const envelope: ActivationEnvelope = {
      activationId: activation.activationId,
      ...(agentContext === undefined ? {} : { agent: agentContext }),
      consumerId: this.#consumerId,
      ...(runAttempt.contextManifest === undefined
        ? {}
        : { contextManifest: runAttempt.contextManifest }),
      fromSeq: activation.fromSeq,
      hostId: this.#hostId,
      participantId: activation.participantId,
      reason: activation.reason,
      roomId: activation.roomId,
      runAttemptId: runAttempt.runAttemptId,
      toSeq: activation.toSeq,
    };

    let preparedRun: RunHandle | undefined;
    let run: RunHandle | undefined;
    try {
      const startRuntime = () =>
        withDeadline(
          runtime.start(envelope, {
            recordTrajectory: async (activity) => {
              await this.#control.appendRunTrajectory(activity);
            },
            registerPrepared: async (candidate) => {
              if (preparedRun !== undefined) {
                throw new Error(
                  "runtime registered more than one prepared handle",
                );
              }
              await this.#control.prepareRunAttemptRuntime({
                recoveryDescriptor: candidate.recoveryDescriptor ?? {
                  driver: "unrecoverable-runtime",
                  metadata: {},
                  recoveryKey: candidate.runId,
                },
                runAttemptId: runAttempt.runAttemptId,
                runtimeRunId: candidate.runId,
              });
              preparedRun = candidate;
            },
          }),
          this.#runtimeStartTimeoutMs,
          "runtime start",
        );
      // Upstream Raft bounds how many Agents may be *starting* at once — never
      // how many may be running — with AgentStartCoordinator. The gate is the
      // port of that queue-and-pump; without one, every lane starts at once.
      //
      // The queue wait sits before run supervision begins, so nothing renews
      // the activation lease while a lane waits for a start slot. Renew again
      // once the slot is in hand: that restores the invariant this host had
      // before the gate existed — the un-renewed window is exactly the bounded
      // `runtime.start` — and a cancellation or an expiry that landed during
      // the wait is discovered here, before a runtime is spawned. Raft has no
      // activation lease, so there is no upstream contract to copy; this keeps
      // a RAH invariant that the ported gate widened.
      let gated: GatedRuntimeStart;
      if (this.#startGate === undefined) {
        gated = { kind: "started", run: await startRuntime() };
      } else {
        gated = await this.#startGate.runStart(
          activation.participantId,
          async (): Promise<GatedRuntimeStart> => {
            try {
              await this.#control.renewActivationLease({
                activationId: activation.activationId,
                leaseMs: this.#leaseMs,
              });
            } catch (error) {
              return { error, kind: "lease-lost" };
            }
            return { kind: "started", run: await startRuntime() };
          },
        );
      }
      if (gated.kind === "lease-lost") {
        return this.#failPreStartLease(gated.error, activation, runAttempt);
      }
      run = gated.run;
      if (
        preparedRun === undefined ||
        preparedRun.runId !== run.runId ||
        JSON.stringify(preparedRun.recoveryDescriptor) !==
          JSON.stringify(run.recoveryDescriptor)
      ) {
        throw new Error(
          "runtime launch did not match its durably prepared handle",
        );
      }
      await this.#control.markRunAttemptRunning({
        recoveryDescriptor: run.recoveryDescriptor ?? {
          driver: "unrecoverable-runtime",
          metadata: {},
          recoveryKey: run.runId,
        },
        runAttemptId: runAttempt.runAttemptId,
        runtimeRunId: run.runId,
      });
    } catch (error) {
      const failure = errorMessage(error);
      const startedHandle = preparedRun ?? run;
      if (preparedRun !== undefined && startedHandle !== undefined) {
        const termination = await this.#cancelRuntime(runtime, startedHandle);
        if (termination.kind === "unproven") {
          const quarantineFailure = `${failure}; prepared runtime termination was not proven: ${termination.error}`;
          return this.#quarantineFailedActivation(
            activation.activationId,
            quarantineFailure,
          );
        }
        const proofFailure = await this.#recordTerminationOrQuarantine({
          activationId: activation.activationId,
          exit: termination.exit,
          failure,
          run: preparedRun,
          runAttemptId: runAttempt.runAttemptId,
          runState: "failed",
        });
        if (proofFailure !== null) return proofFailure;
        await this.#control.finishRunAttempt({
          error: failure,
          ...(termination.exit.code === null
            ? {}
            : { exitCode: termination.exit.code }),
          ...(termination.exit.signal === undefined
            ? {}
            : { exitSignal: termination.exit.signal }),
          runAttemptId: runAttempt.runAttemptId,
          state: "failed",
        });
        return this.#retryFailedActivation(activation, failure);
      }
      if (startedHandle !== undefined) {
        const termination = await this.#cancelRuntime(runtime, startedHandle);
        const quarantineFailure =
          termination.kind === "unproven"
            ? `${failure}; unregistered runtime termination was not proven: ${termination.error}`
            : `${failure}; runtime launched without a durable recovery capability`;
        return this.#quarantineFailedActivation(
          activation.activationId,
          quarantineFailure,
        );
      }
      await this.#control.finishRunAttempt({
        error: failure,
        runAttemptId: runAttempt.runAttemptId,
        state: "failed",
      });
      return this.#retryFailedActivation(activation, failure);
    }

    if (run === undefined) {
      throw new Error("runtime start returned no handle");
    }

    const supervisor = new AbortController();
    const reapOutcome: Promise<RuntimeOutcome> = runtime.reap(run).then(
      (exit): RuntimeOutcome => ({ exit, kind: "exit" }),
      (error: unknown): RuntimeOutcome => ({
        error: errorMessage(error),
        kind: "reap_failed",
      }),
    );
    const timeoutOutcome = watchRuntimeLiveness({
      intervalMs: this.#runTimeoutMs,
      run,
      runtime,
      signal: supervisor.signal,
      wait: this.#timeoutWait,
    });
    const maintenanceOutcome = this.#maintainRunLease(
      activation.activationId,
      supervisor.signal,
    );
    const busyNotices = maintainRuntimeBusyNotices({
      guideEnabled: () =>
        resolveRuntimeDeliveryMode(
          runtime,
          this.#guideEnabled(runtime.guideRuntimeId),
        ) !== "wait",
      activationId: activation.activationId,
      runAttemptId: runAttempt.runAttemptId,
      run,
      runtime,
      control: this.#control,
      signal: supervisor.signal,
      wait: waitForDelay,
    });
    const drainOutcome = this.#waitForDrainDeadline(supervisor.signal);
    const outcome = await Promise.race([
      reapOutcome,
      timeoutOutcome,
      maintenanceOutcome,
      drainOutcome,
    ]);
    supervisor.abort();
    await Promise.all([maintenanceOutcome, drainOutcome, busyNotices]);

    if (outcome.kind === "activation_cancelled") {
      const termination = await this.#cancelRuntime(runtime, run);
      if (termination.kind === "unproven") {
        return this.#quarantineFailedActivation(
          activation.activationId,
          `${outcome.error}; runtime termination was not proven: ${termination.error}`,
        );
      }
      const proofFailure = await this.#recordTerminationOrQuarantine({
        activationId: activation.activationId,
        exit: termination.exit,
        failure: outcome.error,
        run,
        runAttemptId: runAttempt.runAttemptId,
        runState: "cancelled",
      });
      if (proofFailure !== null) return proofFailure;
      await this.#control.finishRunAttempt({
        error: outcome.error,
        ...(termination.exit.code === null
          ? {}
          : { exitCode: termination.exit.code }),
        ...(termination.exit.signal === undefined
          ? {}
          : { exitSignal: termination.exit.signal }),
        runAttemptId: runAttempt.runAttemptId,
        state: "cancelled",
      });
      await this.#control.resolveActivationCancellation({
        activationId: activation.activationId,
      });
      return {
        activationId: activation.activationId,
        reason: outcome.error,
        state: "cancelled",
      };
    }

    if (outcome.kind === "agent_disabled" || outcome.kind === "drain_timeout") {
      const failure =
        outcome.kind === "agent_disabled"
          ? outcome.error
          : `daemon drain timed out after ${this.#drainTimeoutMs}ms`;
      const termination = await this.#cancelRuntime(runtime, run);
      if (termination.kind === "unproven") {
        const quarantineFailure = `${failure}; runtime termination was not proven: ${termination.error}`;
        return this.#quarantineFailedActivation(
          activation.activationId,
          quarantineFailure,
        );
      }
      const proofFailure = await this.#recordTerminationOrQuarantine({
        activationId: activation.activationId,
        exit: termination.exit,
        failure,
        run,
        runAttemptId: runAttempt.runAttemptId,
        runState: "cancelled",
      });
      if (proofFailure !== null) return proofFailure;
      await this.#control.finishRunAttempt({
        error: failure,
        ...(termination.exit.code === null
          ? {}
          : { exitCode: termination.exit.code }),
        ...(termination.exit.signal === undefined
          ? {}
          : { exitSignal: termination.exit.signal }),
        runAttemptId: runAttempt.runAttemptId,
        state: "cancelled",
      });
      return this.#retryFailedActivation(activation, failure);
    }

    if (outcome.kind === "timeout") {
      const failure = `runtime timed out after ${this.#runTimeoutMs}ms`;
      const termination = await this.#cancelRuntime(runtime, run);
      if (termination.kind === "unproven") {
        const quarantineFailure = `${failure}; runtime termination was not proven: ${termination.error}`;
        return this.#quarantineFailedActivation(
          activation.activationId,
          quarantineFailure,
        );
      }
      const proofFailure = await this.#recordTerminationOrQuarantine({
        activationId: activation.activationId,
        exit: termination.exit,
        failure,
        run,
        runAttemptId: runAttempt.runAttemptId,
        runState: "timed_out",
      });
      if (proofFailure !== null) return proofFailure;
      await this.#control.finishRunAttempt({
        error: failure,
        ...(termination.exit.code === null
          ? {}
          : { exitCode: termination.exit.code }),
        ...(termination.exit.signal === undefined
          ? {}
          : { exitSignal: termination.exit.signal }),
        runAttemptId: runAttempt.runAttemptId,
        state: "timed_out",
      });
      return this.#retryFailedActivation(activation, failure);
    }
    if (outcome.kind === "maintenance_failed") {
      const termination = await this.#cancelRuntime(runtime, run);
      if (termination.kind === "unproven") {
        const quarantineFailure = `${outcome.error}; runtime termination was not proven: ${termination.error}`;
        return this.#quarantineFailedActivation(
          activation.activationId,
          quarantineFailure,
        );
      }
      const proofFailure = await this.#recordTerminationOrQuarantine({
        activationId: activation.activationId,
        exit: termination.exit,
        failure: outcome.error,
        run,
        runAttemptId: runAttempt.runAttemptId,
        runState: "failed",
      });
      if (proofFailure !== null) return proofFailure;
      await this.#control.finishRunAttempt({
        error: outcome.error,
        runAttemptId: runAttempt.runAttemptId,
        state: "failed",
      });
      return this.#retryFailedActivation(activation, outcome.error);
    }
    if (outcome.kind === "reap_failed") {
      const termination = await this.#cancelRuntime(runtime, run);
      if (termination.kind === "unproven") {
        const quarantineFailure = `${outcome.error}; runtime termination was not proven: ${termination.error}`;
        return this.#quarantineFailedActivation(
          activation.activationId,
          quarantineFailure,
        );
      }
      const proofFailure = await this.#recordTerminationOrQuarantine({
        activationId: activation.activationId,
        exit: termination.exit,
        failure: outcome.error,
        run,
        runAttemptId: runAttempt.runAttemptId,
        runState: "failed",
      });
      if (proofFailure !== null) return proofFailure;
      await this.#control.finishRunAttempt({
        error: outcome.error,
        runAttemptId: runAttempt.runAttemptId,
        state: "failed",
      });
      return this.#retryFailedActivation(activation, outcome.error);
    }
    if (outcome.kind === "stopped") {
      const failure = "runtime supervisor stopped unexpectedly";
      const termination = await this.#cancelRuntime(runtime, run);
      if (termination.kind === "unproven") {
        const quarantineFailure = `${failure}; runtime termination was not proven: ${termination.error}`;
        return this.#quarantineFailedActivation(
          activation.activationId,
          quarantineFailure,
        );
      }
      const proofFailure = await this.#recordTerminationOrQuarantine({
        activationId: activation.activationId,
        exit: termination.exit,
        failure,
        run,
        runAttemptId: runAttempt.runAttemptId,
        runState: "failed",
      });
      if (proofFailure !== null) return proofFailure;
      await this.#control.finishRunAttempt({
        error: failure,
        runAttemptId: runAttempt.runAttemptId,
        state: "failed",
      });
      return this.#retryFailedActivation(activation, failure);
    }

    const exit = outcome.exit;
    const proofFailure = await this.#recordTerminationOrQuarantine({
      activationId: activation.activationId,
      exit,
      failure: "runtime exited but its termination proof was not persisted",
      run,
      runAttemptId: runAttempt.runAttemptId,
      runState: "failed",
    });
    if (proofFailure !== null) return proofFailure;
    try {
      await this.#control.finishRunAttempt({
        ...(exit.code === null ? {} : { exitCode: exit.code }),
        ...(exit.signal === undefined ? {} : { exitSignal: exit.signal }),
        runAttemptId: runAttempt.runAttemptId,
        state: "exited",
      });
      if (exit.code !== 0) {
        return this.#retryFailedActivation(
          activation,
          exit.failure?.message ??
            `runtime exited with code ${String(exit.code)}`,
          exit.failure,
        );
      }
    } catch (error) {
      const failure = errorMessage(error);
      await this.#control.finishRunAttempt({
        error: failure,
        runAttemptId: runAttempt.runAttemptId,
        state: "failed",
      });
      return this.#retryFailedActivation(activation, failure);
    }

    try {
      await this.#control.completeActivation({
        activationId: activation.activationId,
        consumerId: this.#consumerId,
      });
      return {
        activationId: activation.activationId,
        exit,
        runAttemptId: runAttempt.runAttemptId,
        runId: run.runId,
        state: "completed",
      };
    } catch (error) {
      return this.#retryFailedActivation(activation, errorMessage(error));
    }
  }

  async run(input: { signal: AbortSignal }): Promise<void> {
    if (this.#runSignal !== undefined) {
      throw new Error("AgentHost is already running");
    }
    this.#runSignal = input.signal;
    this.#draining = false;
    const beginDrain = () => {
      this.#draining = true;
      this.#drainDeadlineAtMs ??= Date.now() + this.#drainTimeoutMs;
      void this.#heartbeat().catch(() => {
        // An abort listener must never turn shutdown into an uncaught exception.
      });
    };
    input.signal.addEventListener("abort", beginDrain, { once: true });
    if (input.signal.aborted) beginDrain();
    try {
      while (!input.signal.aborted) {
        const recovery = await this.reconcileOrphanOnce();
        if (recovery.state !== "idle") {
          this.#reportCycle({ kind: "recovery", result: recovery });
        }
        if (input.signal.aborted) break;
        const result = await this.reconcileOnce();
        if (result.state !== "idle") {
          this.#reportCycle({ kind: "activation", result });
        }
        if (recovery.state === "idle" && result.state === "idle") {
          await this.#wait(this.#pollIntervalMs, input.signal);
        }
      }
    } finally {
      input.signal.removeEventListener("abort", beginDrain);
      if (this.#manageHostLifecycle) {
        try {
          await this.#control.heartbeatHost({
            state: "offline",
          });
        } catch (error) {
          if (!(error instanceof UnauthenticatedError)) throw error;
        }
      }
      this.#draining = false;
      this.#drainDeadlineAtMs = undefined;
      this.#runSignal = undefined;
    }
  }

  async #heartbeat(): Promise<void> {
    await this.#control.heartbeatHost({
      state: this.#draining ? "draining" : "online",
    });
  }

  #reportCycle(observation: HostCycleObservation): void {
    try {
      this.#onCycleResult?.(observation);
    } catch {
      // An observation sink cannot own or interrupt reconciliation.
    }
  }

  /**
   * Resolve a lease renewal that failed on the way into a Run. Shared by the
   * renewal taken before the start gate and the one taken after the gate hands
   * back a start slot, so a cancellation that arrived while this lane sat in
   * the start queue resolves the cancellation instead of being retried as a
   * start failure.
   */
  async #failPreStartLease(
    error: unknown,
    activation: Pick<Activation, "activationId" | "attemptCount">,
    runAttempt: { runAttemptId: string } | undefined,
  ): Promise<HostCycleResult> {
    if (error instanceof ActivationCancellationRequestedError) {
      if (runAttempt !== undefined) {
        await this.#control.finishRunAttempt({
          error: error.message,
          runAttemptId: runAttempt.runAttemptId,
          state: "cancelled",
        });
      }
      await this.#control.resolveActivationCancellation({
        activationId: activation.activationId,
      });
      return {
        activationId: activation.activationId,
        reason: error.message,
        state: "cancelled",
      };
    }
    const failure = `pre-start lease validation failed: ${errorMessage(error)}`;
    return runAttempt === undefined
      ? this.#retryFailedActivation(activation, failure)
      : this.#failClaimedActivation(
          activation,
          runAttempt.runAttemptId,
          failure,
        );
  }

  async #retryFailedActivation(
    activation: Pick<Activation, "activationId" | "attemptCount">,
    failure: string,
    runtimeFailure?: RuntimeFailure,
  ): Promise<HostCycleResult> {
    const { activationId } = activation;
    try {
      await this.#control.retryActivation({
        activationId,
        error: failure,
        retryAfterMs: runtimeErrorRetryDelay(
          this.#retryAfterMs,
          activation.attemptCount,
          this.#retryJitterRatio,
          this.#retryJitterRandom,
        ),
        ...(runtimeFailure === undefined
          ? {}
          : { retryDisposition: runtimeFailure.retryDisposition }),
      });
      return { activationId, error: failure, state: "failed" };
    } catch (retryError) {
      return {
        activationId,
        error: `${failure}; durable retry failed: ${errorMessage(retryError)}`,
        state: "failed",
      };
    }
  }

  async #failClaimedActivation(
    activation: Pick<Activation, "activationId" | "attemptCount">,
    runAttemptId: string,
    failure: string,
  ): Promise<HostCycleResult> {
    const { activationId } = activation;
    try {
      await this.#control.finishRunAttempt({
        error: failure,
        runAttemptId,
        state: "failed",
      });
    } catch (error) {
      return {
        activationId,
        error: `${failure}; failed to close pre-launch RunAttempt: ${errorMessage(error)}`,
        state: "failed",
      };
    }
    return await this.#retryFailedActivation(activation, failure);
  }

  async #quarantineFailedActivation(
    activationId: string,
    failure: string,
  ): Promise<HostCycleResult> {
    try {
      await this.#control.quarantineActivation({
        activationId,
        error: failure,
      });
      return { activationId, error: failure, state: "failed" };
    } catch (quarantineError) {
      return {
        activationId,
        error: `${failure}; durable quarantine failed: ${errorMessage(quarantineError)}`,
        state: "failed",
      };
    }
  }

  async #recordTerminationOrQuarantine(input: {
    activationId: string;
    exit: RunExit;
    failure: string;
    run: RunHandle;
    runAttemptId: string;
    runState: "exited" | "failed" | "cancelled" | "timed_out";
  }): Promise<HostCycleResult | null> {
    try {
      await this.#control.recordRuntimeTermination({
        exit: input.exit,
        runAttemptId: input.runAttemptId,
        runtimeRunId: input.run.runId,
      });
      return null;
    } catch (error) {
      const quarantineFailure = `${input.failure}; durable runtime termination proof failed: ${errorMessage(error)}`;
      return await this.#quarantineFailedActivation(
        input.activationId,
        quarantineFailure,
      );
    }
  }

  async #maintainRunLease(
    activationId: string,
    signal: AbortSignal,
  ): Promise<RuntimeOutcome> {
    while (!signal.aborted) {
      await this.#maintenanceWait(this.#leaseRenewIntervalMs, signal);
      if (signal.aborted) return { kind: "stopped" };
      try {
        await this.#heartbeat();
        await this.#control.renewActivationLease({
          activationId,
          leaseMs: this.#leaseMs,
        });
      } catch (error) {
        if (error instanceof ActivationCancellationRequestedError) {
          return { error: error.message, kind: "activation_cancelled" };
        }
        if (error instanceof AgentExecutionPausedError) {
          return { error: error.message, kind: "agent_disabled" };
        }
        return {
          error: `lease maintenance failed: ${errorMessage(error)}`,
          kind: "maintenance_failed",
        };
      }
    }
    return { kind: "stopped" };
  }

  async #maintainRecoveryLease(
    runtimeProcessId: string,
    recoveryAttemptCount: number,
    signal: AbortSignal,
  ): Promise<RecoveryMaintenanceOutcome> {
    while (!signal.aborted) {
      await this.#maintenanceWait(this.#leaseRenewIntervalMs, signal);
      if (signal.aborted) return { kind: "stopped" };
      try {
        await this.#heartbeat();
        await this.#control.renewRuntimeRecoveryLease({
          leaseMs: this.#leaseMs,
          recoveryAttemptCount,
          runtimeProcessId,
        });
      } catch (error) {
        return {
          error: `recovery lease maintenance failed: ${errorMessage(error)}`,
          kind: "maintenance_failed",
        };
      }
    }
    return { kind: "stopped" };
  }

  async #cancelRuntime(
    runtime: RuntimeAdapter,
    run: RunHandle,
  ): Promise<TerminationOutcome> {
    try {
      return {
        exit: await withDeadline(
          runtime.cancel(run),
          this.#runtimeCancelTimeoutMs,
          "runtime cancellation",
        ),
        kind: "terminated",
      };
    } catch (error) {
      return { error: errorMessage(error), kind: "unproven" };
    }
  }

  async #waitForDrainDeadline(
    cancellation: AbortSignal,
  ): Promise<RuntimeOutcome> {
    const shutdown = this.#runSignal;
    if (shutdown === undefined) {
      if (!cancellation.aborted) {
        await new Promise<void>((resolve) => {
          cancellation.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
      }
      return { kind: "stopped" };
    }
    if (!shutdown.aborted) {
      const first = await waitForEitherAbort(shutdown, cancellation);
      if (first === "cancelled") return { kind: "stopped" };
    }
    if (cancellation.aborted) return { kind: "stopped" };
    const deadline =
      this.#drainDeadlineAtMs ?? Date.now() + this.#drainTimeoutMs;
    await waitForDelay(Math.max(0, deadline - Date.now()), cancellation);
    return cancellation.aborted
      ? { kind: "stopped" }
      : { kind: "drain_timeout" };
  }
}

type RuntimeOutcome =
  | { error: string; kind: "activation_cancelled" }
  | { error: string; kind: "agent_disabled" }
  | { kind: "drain_timeout" }
  | { exit: RunExit; kind: "exit" }
  | { error: string; kind: "maintenance_failed" }
  | { error: string; kind: "reap_failed" }
  | { kind: "stopped" }
  | { kind: "timeout" };

type RecoveryMaintenanceOutcome =
  { error: string; kind: "maintenance_failed" } | { kind: "stopped" };

type TerminationOutcome =
  { exit: RunExit; kind: "terminated" } | { error: string; kind: "unproven" };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function waitForEitherAbort(
  shutdown: AbortSignal,
  cancellation: AbortSignal,
): Promise<"cancelled" | "shutdown"> {
  if (shutdown.aborted) return "shutdown";
  if (cancellation.aborted) return "cancelled";
  return await new Promise((resolve) => {
    const onShutdown = () => finish("shutdown");
    const onCancellation = () => finish("cancelled");
    shutdown.addEventListener("abort", onShutdown, { once: true });
    cancellation.addEventListener("abort", onCancellation, { once: true });

    function finish(result: "cancelled" | "shutdown"): void {
      shutdown.removeEventListener("abort", onShutdown);
      cancellation.removeEventListener("abort", onCancellation);
      resolve(result);
    }
  });
}

async function waitForDelay(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(done, delayMs);
    signal.addEventListener("abort", done, { once: true });

    function done(): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
