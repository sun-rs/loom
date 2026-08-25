import type {
  ActivationEnvelope,
  RunExit,
  RunHandle,
  RuntimeAdapter,
  RuntimeAvailability,
  RuntimeRecoveryInput,
  RuntimeStartLifecycle,
} from "./runtime.ts";

export class FakeRuntimeAdapter implements RuntimeAdapter {
  readonly recoveryDrivers: readonly string[];
  readonly cancellations: RunHandle[] = [];
  readonly starts: ActivationEnvelope[] = [];
  #nextRun = 1;
  #queuedExits: RunExit[] = [];
  readonly #onReap: ((run: RunHandle) => Promise<RunExit>) | undefined;
  readonly #onRecover:
    ((input: RuntimeRecoveryInput) => Promise<RunExit> | RunExit) | undefined;
  readonly #onCancel:
    ((run: RunHandle) => Promise<RunExit> | RunExit) | undefined;
  readonly #onStart:
    ((input: ActivationEnvelope) => Promise<void> | void) | undefined;

  constructor(
    options: {
      onCancel?: (run: RunHandle) => Promise<RunExit> | RunExit;
      onReap?: (run: RunHandle) => Promise<RunExit>;
      onRecover?: (input: RuntimeRecoveryInput) => Promise<RunExit> | RunExit;
      onStart?: (input: ActivationEnvelope) => Promise<void> | void;
    } = {},
  ) {
    this.#onCancel = options.onCancel;
    this.#onReap = options.onReap;
    this.#onRecover = options.onRecover;
    this.#onStart = options.onStart;
    this.recoveryDrivers =
      options.onRecover === undefined ? [] : ["fake-runtime"];
  }

  enqueueExit(exit: RunExit): void {
    this.#queuedExits.push(exit);
  }

  async probe(): Promise<RuntimeAvailability> {
    return { available: true };
  }

  async start(
    input: ActivationEnvelope,
    lifecycle: RuntimeStartLifecycle,
  ): Promise<RunHandle> {
    this.starts.push(structuredClone(input));
    const runId = `fake-run-${this.#nextRun++}`;
    const run = {
      recoveryDescriptor: {
        driver: "fake-runtime",
        metadata: {},
        recoveryKey: runId,
      },
      runId,
    };
    await lifecycle.registerPrepared(run);
    await this.#onStart?.(input);
    return run;
  }

  async cancel(run: RunHandle): Promise<RunExit> {
    this.cancellations.push(run);
    return (await this.#onCancel?.(run)) ?? { code: null, signal: "SIGTERM" };
  }

  async reap(run: RunHandle): Promise<RunExit> {
    if (this.#onReap) return await this.#onReap(run);
    return this.#queuedExits.shift() ?? { code: 0 };
  }

  async recover(input: RuntimeRecoveryInput): Promise<RunExit> {
    if (this.#onRecover === undefined) {
      throw new Error("fake runtime recovery is unavailable");
    }
    return await this.#onRecover(input);
  }
}
