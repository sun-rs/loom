import {
  UnauthenticatedError,
  type AuthenticatedHostContext,
  type RoomKernel,
} from "@rah-os/kernel";

import type {
  ActivationEnvelope,
  RunExit,
  RunHandle,
  RuntimeAdapter,
} from "./runtime.ts";

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

type AgentHostOptions = {
  drainTimeoutMs?: number;
  host: AuthenticatedHostContext;
  kernel: RoomKernel;
  leaseMs: number;
  leaseRenewIntervalMs?: number;
  maintenanceWait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  onCycleResult?: (observation: HostCycleObservation) => void;
  pollIntervalMs?: number;
  retryAfterMs?: number;
  runTimeoutMs?: number;
  runtime: RuntimeAdapter;
  runtimeCancelTimeoutMs?: number;
  runtimeRecoveryTimeoutMs?: number;
  runtimeStartTimeoutMs?: number;
  timeoutWait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
};

export class AgentHost {
  readonly #drainTimeoutMs: number;
  readonly #host: AuthenticatedHostContext;
  readonly #hostId: string;
  readonly #consumerId: string;
  readonly #kernel: RoomKernel;
  readonly #leaseMs: number;
  readonly #leaseRenewIntervalMs: number;
  readonly #maintenanceWait: (
    delayMs: number,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly #onCycleResult:
    ((observation: HostCycleObservation) => void) | undefined;
  readonly #pollIntervalMs: number;
  readonly #retryAfterMs: number;
  readonly #runTimeoutMs: number;
  readonly #runtime: RuntimeAdapter;
  readonly #runtimeCancelTimeoutMs: number;
  readonly #runtimeRecoveryTimeoutMs: number;
  readonly #runtimeStartTimeoutMs: number;
  readonly #timeoutWait: (
    delayMs: number,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly #wait: (delayMs: number, signal: AbortSignal) => Promise<void>;
  #draining = false;
  #drainDeadlineAtMs: number | undefined;
  #runSignal: AbortSignal | undefined;

  constructor(options: AgentHostOptions) {
    if (!Number.isInteger(options.leaseMs) || options.leaseMs <= 0) {
      throw new Error("leaseMs must be a positive integer");
    }
    const participantIds = [...options.host.participantIds];
    if (participantIds.length === 0) {
      throw new Error("AgentHost requires at least one participant");
    }
    const retryAfterMs = options.retryAfterMs ?? 1_000;
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
    this.#host = options.host;
    this.#hostId = options.host.hostId;
    this.#consumerId = `${options.host.hostId}:runtime`;
    this.#kernel = options.kernel;
    this.#leaseMs = options.leaseMs;
    this.#leaseRenewIntervalMs = leaseRenewIntervalMs;
    this.#maintenanceWait = options.maintenanceWait ?? waitForDelay;
    this.#onCycleResult = options.onCycleResult;
    this.#pollIntervalMs = pollIntervalMs;
    this.#retryAfterMs = retryAfterMs;
    this.#runTimeoutMs = runTimeoutMs;
    this.#runtime = options.runtime;
    this.#runtimeCancelTimeoutMs = runtimeCancelTimeoutMs;
    this.#runtimeRecoveryTimeoutMs = runtimeRecoveryTimeoutMs;
    this.#runtimeStartTimeoutMs = runtimeStartTimeoutMs;
    this.#timeoutWait = options.timeoutWait ?? waitForDelay;
    this.#wait = options.wait ?? waitForDelay;
  }

  async reconcileOrphanOnce(): Promise<OrphanRecoveryCycleResult> {
    const recoveryDrivers = [...new Set(this.#runtime.recoveryDrivers ?? [])];
    const recover = this.#runtime.recover;
    if (recover === undefined || recoveryDrivers.length === 0) {
      return { state: "idle" };
    }
    this.#heartbeat();
    const runtimeProcess = this.#kernel.leaseNextRuntimeRecovery(this.#host, {
      driverIds: recoveryDrivers,
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
      exit = await Promise.race([
        withDeadline(
          recover.call(this.#runtime, {
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
        this.#kernel.retryRuntimeRecovery(this.#host, {
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
      this.#kernel.recordRecoveredRuntimeTermination(this.#host, {
        exit,
        recoveryAttemptCount: runtimeProcess.recoveryAttemptCount,
        runtimeProcessId: runtimeProcess.runtimeProcessId,
      });
      this.#kernel.resolveActivationQuarantine(this.#host, {
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
    this.#heartbeat();
    const activation = this.#kernel.leaseNextActivation(this.#host, {
      leaseMs: this.#leaseMs,
    });
    if (activation === null) return { state: "idle" };

    try {
      const availability = await this.#runtime.probe();
      if (!availability.available) {
        return this.#retryFailedActivation(
          activation.activationId,
          availability.detail ?? "runtime is unavailable",
        );
      }
    } catch (error) {
      return this.#retryFailedActivation(
        activation.activationId,
        errorMessage(error),
      );
    }

    const runAttempt = this.#kernel.createRunAttempt(this.#host, {
      activationId: activation.activationId,
    });
    const envelope: ActivationEnvelope = {
      activationId: activation.activationId,
      consumerId: this.#consumerId,
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
      run = await withDeadline(
        this.#runtime.start(envelope, {
          registerPrepared: async (candidate) => {
            if (preparedRun !== undefined) {
              throw new Error(
                "runtime registered more than one prepared handle",
              );
            }
            this.#kernel.prepareRunAttemptRuntime(this.#host, {
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
      this.#kernel.markRunAttemptRunning(this.#host, {
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
        const termination = await this.#cancelRuntime(startedHandle);
        if (termination.kind === "unproven") {
          const quarantineFailure = `${failure}; prepared runtime termination was not proven: ${termination.error}`;
          return this.#quarantineFailedActivation(
            activation.activationId,
            quarantineFailure,
          );
        }
        const proofFailure = this.#recordTerminationOrQuarantine({
          activationId: activation.activationId,
          exit: termination.exit,
          failure,
          run: preparedRun,
          runAttemptId: runAttempt.runAttemptId,
          runState: "failed",
        });
        if (proofFailure !== null) return proofFailure;
        this.#kernel.finishRunAttempt(this.#host, {
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
        return this.#retryFailedActivation(activation.activationId, failure);
      }
      if (startedHandle !== undefined) {
        const termination = await this.#cancelRuntime(startedHandle);
        const quarantineFailure =
          termination.kind === "unproven"
            ? `${failure}; unregistered runtime termination was not proven: ${termination.error}`
            : `${failure}; runtime launched without a durable recovery capability`;
        return this.#quarantineFailedActivation(
          activation.activationId,
          quarantineFailure,
        );
      }
      this.#kernel.finishRunAttempt(this.#host, {
        error: failure,
        runAttemptId: runAttempt.runAttemptId,
        state: "failed",
      });
      return this.#retryFailedActivation(activation.activationId, failure);
    }

    if (run === undefined) {
      throw new Error("runtime start returned no handle");
    }

    const supervisor = new AbortController();
    const reapOutcome: Promise<RuntimeOutcome> = this.#runtime.reap(run).then(
      (exit): RuntimeOutcome => ({ exit, kind: "exit" }),
      (error: unknown): RuntimeOutcome => ({
        error: errorMessage(error),
        kind: "reap_failed",
      }),
    );
    const timeoutOutcome = this.#timeoutWait(
      this.#runTimeoutMs,
      supervisor.signal,
    ).then<RuntimeOutcome>(() => ({ kind: "timeout" }));
    const maintenanceOutcome = this.#maintainRunLease(
      activation.activationId,
      supervisor.signal,
    );
    const drainOutcome = this.#waitForDrainDeadline(supervisor.signal);
    const outcome = await Promise.race([
      reapOutcome,
      timeoutOutcome,
      maintenanceOutcome,
      drainOutcome,
    ]);
    supervisor.abort();
    await Promise.all([maintenanceOutcome, drainOutcome]);

    if (outcome.kind === "drain_timeout") {
      const failure = `daemon drain timed out after ${this.#drainTimeoutMs}ms`;
      const termination = await this.#cancelRuntime(run);
      if (termination.kind === "unproven") {
        const quarantineFailure = `${failure}; runtime termination was not proven: ${termination.error}`;
        return this.#quarantineFailedActivation(
          activation.activationId,
          quarantineFailure,
        );
      }
      const proofFailure = this.#recordTerminationOrQuarantine({
        activationId: activation.activationId,
        exit: termination.exit,
        failure,
        run,
        runAttemptId: runAttempt.runAttemptId,
        runState: "cancelled",
      });
      if (proofFailure !== null) return proofFailure;
      this.#kernel.finishRunAttempt(this.#host, {
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
      return this.#retryFailedActivation(activation.activationId, failure);
    }

    if (outcome.kind === "timeout") {
      const failure = `runtime timed out after ${this.#runTimeoutMs}ms`;
      const termination = await this.#cancelRuntime(run);
      if (termination.kind === "unproven") {
        const quarantineFailure = `${failure}; runtime termination was not proven: ${termination.error}`;
        return this.#quarantineFailedActivation(
          activation.activationId,
          quarantineFailure,
        );
      }
      const proofFailure = this.#recordTerminationOrQuarantine({
        activationId: activation.activationId,
        exit: termination.exit,
        failure,
        run,
        runAttemptId: runAttempt.runAttemptId,
        runState: "timed_out",
      });
      if (proofFailure !== null) return proofFailure;
      this.#kernel.finishRunAttempt(this.#host, {
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
      return this.#retryFailedActivation(activation.activationId, failure);
    }
    if (outcome.kind === "maintenance_failed") {
      const termination = await this.#cancelRuntime(run);
      if (termination.kind === "unproven") {
        const quarantineFailure = `${outcome.error}; runtime termination was not proven: ${termination.error}`;
        return this.#quarantineFailedActivation(
          activation.activationId,
          quarantineFailure,
        );
      }
      const proofFailure = this.#recordTerminationOrQuarantine({
        activationId: activation.activationId,
        exit: termination.exit,
        failure: outcome.error,
        run,
        runAttemptId: runAttempt.runAttemptId,
        runState: "failed",
      });
      if (proofFailure !== null) return proofFailure;
      this.#kernel.finishRunAttempt(this.#host, {
        error: outcome.error,
        runAttemptId: runAttempt.runAttemptId,
        state: "failed",
      });
      return this.#retryFailedActivation(
        activation.activationId,
        outcome.error,
      );
    }
    if (outcome.kind === "reap_failed") {
      const termination = await this.#cancelRuntime(run);
      if (termination.kind === "unproven") {
        const quarantineFailure = `${outcome.error}; runtime termination was not proven: ${termination.error}`;
        return this.#quarantineFailedActivation(
          activation.activationId,
          quarantineFailure,
        );
      }
      const proofFailure = this.#recordTerminationOrQuarantine({
        activationId: activation.activationId,
        exit: termination.exit,
        failure: outcome.error,
        run,
        runAttemptId: runAttempt.runAttemptId,
        runState: "failed",
      });
      if (proofFailure !== null) return proofFailure;
      this.#kernel.finishRunAttempt(this.#host, {
        error: outcome.error,
        runAttemptId: runAttempt.runAttemptId,
        state: "failed",
      });
      return this.#retryFailedActivation(
        activation.activationId,
        outcome.error,
      );
    }
    if (outcome.kind === "stopped") {
      const failure = "runtime supervisor stopped unexpectedly";
      const termination = await this.#cancelRuntime(run);
      if (termination.kind === "unproven") {
        const quarantineFailure = `${failure}; runtime termination was not proven: ${termination.error}`;
        return this.#quarantineFailedActivation(
          activation.activationId,
          quarantineFailure,
        );
      }
      const proofFailure = this.#recordTerminationOrQuarantine({
        activationId: activation.activationId,
        exit: termination.exit,
        failure,
        run,
        runAttemptId: runAttempt.runAttemptId,
        runState: "failed",
      });
      if (proofFailure !== null) return proofFailure;
      this.#kernel.finishRunAttempt(this.#host, {
        error: failure,
        runAttemptId: runAttempt.runAttemptId,
        state: "failed",
      });
      return this.#retryFailedActivation(activation.activationId, failure);
    }

    const exit = outcome.exit;
    const proofFailure = this.#recordTerminationOrQuarantine({
      activationId: activation.activationId,
      exit,
      failure: "runtime exited but its termination proof was not persisted",
      run,
      runAttemptId: runAttempt.runAttemptId,
      runState: "failed",
    });
    if (proofFailure !== null) return proofFailure;
    try {
      this.#kernel.finishRunAttempt(this.#host, {
        ...(exit.code === null ? {} : { exitCode: exit.code }),
        ...(exit.signal === undefined ? {} : { exitSignal: exit.signal }),
        runAttemptId: runAttempt.runAttemptId,
        state: "exited",
      });
      if (exit.code !== 0) {
        return this.#retryFailedActivation(
          activation.activationId,
          `runtime exited with code ${String(exit.code)}`,
        );
      }
    } catch (error) {
      const failure = errorMessage(error);
      this.#kernel.finishRunAttempt(this.#host, {
        error: failure,
        runAttemptId: runAttempt.runAttemptId,
        state: "failed",
      });
      return this.#retryFailedActivation(activation.activationId, failure);
    }

    try {
      this.#kernel.completeActivation(this.#host, {
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
      return this.#retryFailedActivation(
        activation.activationId,
        errorMessage(error),
      );
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
      try {
        this.#heartbeat();
      } catch {
        // An abort listener must never turn shutdown into an uncaught exception.
      }
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
      try {
        this.#kernel.heartbeatHost(this.#host, {
          state: "offline",
        });
      } catch (error) {
        if (!(error instanceof UnauthenticatedError)) throw error;
      }
      this.#draining = false;
      this.#drainDeadlineAtMs = undefined;
      this.#runSignal = undefined;
    }
  }

  #heartbeat(): void {
    this.#kernel.heartbeatHost(this.#host, {
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

  #retryFailedActivation(
    activationId: string,
    failure: string,
  ): HostCycleResult {
    try {
      this.#kernel.retryActivation(this.#host, {
        activationId,
        error: failure,
        retryAfterMs: this.#retryAfterMs,
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

  #quarantineFailedActivation(
    activationId: string,
    failure: string,
  ): HostCycleResult {
    try {
      this.#kernel.quarantineActivation(this.#host, {
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

  #recordTerminationOrQuarantine(input: {
    activationId: string;
    exit: RunExit;
    failure: string;
    run: RunHandle;
    runAttemptId: string;
    runState: "exited" | "failed" | "cancelled" | "timed_out";
  }): HostCycleResult | null {
    try {
      this.#kernel.recordRuntimeTermination(this.#host, {
        exit: input.exit,
        runAttemptId: input.runAttemptId,
        runtimeRunId: input.run.runId,
      });
      return null;
    } catch (error) {
      const quarantineFailure = `${input.failure}; durable runtime termination proof failed: ${errorMessage(error)}`;
      return this.#quarantineFailedActivation(
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
        this.#heartbeat();
        this.#kernel.renewActivationLease(this.#host, {
          activationId,
          leaseMs: this.#leaseMs,
        });
      } catch (error) {
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
        this.#heartbeat();
        this.#kernel.renewRuntimeRecoveryLease(this.#host, {
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

  async #cancelRuntime(run: RunHandle): Promise<TerminationOutcome> {
    try {
      return {
        exit: await withDeadline(
          this.#runtime.cancel(run),
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
