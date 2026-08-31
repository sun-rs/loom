import { randomBytes, randomUUID } from "node:crypto";

import {
  classifyResidentRunnerExit,
  reduceResidentRunner,
  RESIDENT_RUNNER_CONTROL_PROTOCOL,
  type ResidentRunnerControlDescriptor,
  type ResidentRunnerExitObservation,
  type ResidentRunnerPolicyOptions,
  type ResidentRunnerState,
} from "./resident-runner-policy.ts";
import type { ResidentRunnerStateStore } from "./resident-runner-state-store.ts";

export type ResidentRunnerProcessEvent = Readonly<
  | { kind: "connected" }
  | { kind: "control_failed"; message: string }
  | { kind: "exited"; observation: ResidentRunnerExitObservation }
>;

export interface ResidentRunnerProcessHandle {
  readonly processControl: ResidentRunnerControlDescriptor;
  readonly processId: number;
  readonly processGeneration: number;
  launch(): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (event: ResidentRunnerProcessEvent) => void): () => void;
}

export interface ResidentRunnerProcessLauncher {
  prepare(input: {
    processControl: ResidentRunnerControlDescriptor;
    processGeneration: number;
  }): Promise<ResidentRunnerProcessHandle>;
}

export type ResidentRunnerRecoveryResult =
  | Readonly<{ resolution: "absent" }>
  | Readonly<{
      handle: ResidentRunnerProcessHandle;
      resolution: "connected" | "prepared";
    }>
  | Readonly<{
      observation: ResidentRunnerExitObservation;
      resolution: "exited";
    }>;

export interface ResidentRunnerRecoveryProbe {
  inspect(input: {
    processGeneration: number;
    processControl: ResidentRunnerControlDescriptor | undefined;
    processId: number | undefined;
  }): Promise<ResidentRunnerRecoveryResult>;
}

export type ResidentRunnerSupervisorOptions = {
  launcher: ResidentRunnerProcessLauncher;
  nowMs?: () => number;
  policy?: ResidentRunnerPolicyOptions;
  recoveryProbe: ResidentRunnerRecoveryProbe;
  store: ResidentRunnerStateStore;
};

/**
 * Serializes one resident Computer runner's policy, durable state and process
 * effects. It does not own Room or Placement state and it never parses child
 * output. The process handle must emit explicit connection and terminal facts.
 */
export class ResidentRunnerSupervisor {
  readonly #launcher: ResidentRunnerProcessLauncher;
  readonly #nowMs: () => number;
  readonly #policy: ResidentRunnerPolicyOptions;
  readonly #recoveryProbe: ResidentRunnerRecoveryProbe;
  readonly #store: ResidentRunnerStateStore;
  #backgroundError: Error | undefined;
  #handle: ResidentRunnerProcessHandle | undefined;
  #initialized = false;
  #queue: Promise<void> = Promise.resolve();
  #state: ResidentRunnerState | undefined;
  #unsubscribe: (() => void) | undefined;

  constructor(options: ResidentRunnerSupervisorOptions) {
    this.#launcher = options.launcher;
    this.#nowMs = options.nowMs ?? (() => Date.now());
    this.#policy = options.policy ?? {};
    this.#recoveryProbe = options.recoveryProbe;
    this.#store = options.store;
  }

  initialize(): Promise<ResidentRunnerState> {
    return this.#enqueue(async () => {
      if (this.#initialized) return this.#requireState();
      if (this.#state === undefined) {
        this.#state = await this.#store.loadForSupervisorStartup();
        if (this.#state.lifecycle === "recovering") {
          await this.#store.save(this.#state);
        }
      }
      if (this.#state.lifecycle === "recovering") {
        const processGeneration = this.#state.processGeneration;
        const processControl = this.#state.processControl;
        const processId = this.#state.processId;
        const result = await this.#recoveryProbe.inspect({
          processGeneration,
          processControl,
          processId,
        });
        if (result.resolution === "exited") {
          await this.#applyStateEvent({
            exitClass: classifyResidentRunnerExit(result.observation),
            kind: "process_exit",
            nowMs: this.#time(),
            processGeneration,
          });
          this.#initialized = true;
          return this.#requireState();
        }
        if (
          result.resolution !== "absent" &&
          (result.handle.processGeneration !== processGeneration ||
            (processId !== undefined &&
              result.handle.processId !== processId) ||
            !sameProcessControl(result.handle.processControl, processControl))
        ) {
          throw new Error(
            "recovery handle identity does not match persisted runner",
          );
        }
        if (result.resolution !== "absent") {
          await this.#applyStateEvent({
            kind: "recovery_resolved",
            processGeneration,
            processId: result.handle.processId,
            resolution: result.resolution,
          });
          this.#attachHandle(result.handle);
          if (result.resolution === "prepared") {
            this.#initialized = true;
            if (this.#requireState().desired) await result.handle.launch();
            else await result.handle.stop();
          }
        } else {
          await this.#applyStateEvent({
            kind: "recovery_resolved",
            processGeneration,
            resolution: "absent",
          });
        }
      }
      this.#initialized = true;
      return this.#requireState();
    });
  }

  reconcile(desired: boolean): Promise<ResidentRunnerState> {
    return this.#enqueue(async () => {
      this.#requireInitialized();
      const result = reduceResidentRunner(
        this.#requireState(),
        { desired, kind: "reconcile", nowMs: this.#time() },
        this.#policy,
      );
      await this.#persist(result.state);
      if (result.effect?.kind === "spawn") {
        await this.#prepareAndLaunch(result.effect.processGeneration);
      } else if (
        desired &&
        this.#state?.lifecycle === "starting" &&
        this.#handle !== undefined
      ) {
        await this.#handle.launch();
      } else if (
        result.effect?.kind === "stop" ||
        (!desired &&
          this.#state?.lifecycle === "stopping" &&
          this.#handle !== undefined)
      ) {
        await this.#stopCurrent();
      }
      return this.#requireState();
    });
  }

  operatorReset(): Promise<ResidentRunnerState> {
    return this.#enqueue(async () => {
      this.#requireInitialized();
      await this.#applyStateEvent({
        kind: "operator_reset",
        nowMs: this.#time(),
      });
      return this.#requireState();
    });
  }

  flush(): Promise<ResidentRunnerState> {
    return this.#enqueue(async () => {
      if (this.#backgroundError !== undefined) throw this.#backgroundError;
      return this.#requireState();
    });
  }

  state(): ResidentRunnerState {
    this.#requireInitialized();
    return this.#requireState();
  }

  async #prepareAndLaunch(processGeneration: number): Promise<void> {
    const processControl: ResidentRunnerControlDescriptor = Object.freeze({
      controlToken: randomBytes(32).toString("hex"),
      instanceId: randomUUID(),
      protocol: RESIDENT_RUNNER_CONTROL_PROTOCOL,
    });
    let handle: ResidentRunnerProcessHandle;
    try {
      handle = await this.#launcher.prepare({
        processControl,
        processGeneration,
      });
    } catch {
      // Launcher rejection is contractually allowed only when no child
      // survived the failed spawn attempt.
      await this.#applyStateEvent({
        exitClass: "crash",
        kind: "process_exit",
        nowMs: this.#time(),
        processGeneration,
      });
      return;
    }
    if (
      handle.processGeneration !== processGeneration ||
      !sameProcessControl(handle.processControl, processControl)
    ) {
      await handle.stop().catch(() => undefined);
      throw new Error("prepared runner identity does not match request");
    }
    this.#attachHandle(handle);
    try {
      await this.#applyStateEvent({
        kind: "process_prepared",
        processControl,
        processGeneration,
        processId: handle.processId,
      });
    } catch (error) {
      await handle.stop().catch(() => undefined);
      throw error;
    }
    await handle.launch();
  }

  async #stopCurrent(): Promise<void> {
    const handle = this.#handle;
    if (handle === undefined) {
      throw new Error("active resident runner has no proven process handle");
    }
    await handle.stop();
  }

  #attachHandle(handle: ResidentRunnerProcessHandle): void {
    this.#detachHandle();
    this.#backgroundError = undefined;
    this.#handle = handle;
    this.#unsubscribe = handle.subscribe((event) => {
      if (event.kind === "control_failed") {
        this.#backgroundError ??= new Error(event.message);
        return;
      }
      if (event.kind === "connected") {
        void this.#enqueue(async () => {
          await this.#applyStateEvent({
            kind: "connection_confirmed",
            processGeneration: handle.processGeneration,
          });
        });
        return;
      }
      void this.#enqueue(async () => {
        if (this.#handle === handle) this.#detachHandle();
        await this.#applyStateEvent({
          exitClass: classifyResidentRunnerExit(event.observation),
          kind: "process_exit",
          nowMs: this.#time(),
          processGeneration: handle.processGeneration,
        });
      });
    });
  }

  #detachHandle(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#handle = undefined;
  }

  async #applyStateEvent(
    event: Parameters<typeof reduceResidentRunner>[1],
  ): Promise<void> {
    const result = reduceResidentRunner(
      this.#requireState(),
      event,
      this.#policy,
    );
    await this.#persist(result.state);
  }

  async #persist(state: ResidentRunnerState): Promise<void> {
    await this.#store.save(state);
    this.#state = state;
  }

  #time(): number {
    const value = this.#nowMs();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Resident Runner clock must return epoch milliseconds");
    }
    return value;
  }

  #requireInitialized(): void {
    if (!this.#initialized) {
      throw new Error("ResidentRunnerSupervisor has not initialized");
    }
  }

  #requireState(): ResidentRunnerState {
    if (this.#state === undefined) {
      throw new Error("ResidentRunnerSupervisor state is unavailable");
    }
    return this.#state;
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.#queue.then(operation, operation);
    this.#queue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
}

function sameProcessControl(
  actual: ResidentRunnerControlDescriptor,
  expected: ResidentRunnerControlDescriptor | undefined,
): boolean {
  return (
    expected !== undefined &&
    actual.protocol === expected.protocol &&
    actual.instanceId === expected.instanceId &&
    actual.controlToken === expected.controlToken
  );
}
