import {
  UnauthenticatedError,
  type AuthenticatedHostContext,
} from "@rah-os/kernel";

import {
  AgentHost,
  startInstanceRuntimes,
  stopInstanceRuntimes,
  type AgentHostOptions,
} from "./agent-host.ts";
import { createKernelAgentHostControlPort } from "./agent-host-control.ts";
import {
  AgentStartGate,
  type AgentStartSchedulerSettings,
} from "./agent-start-coordinator.ts";
import {
  InstancePrewarmer,
  type InstancePrewarmOutcome,
  type InstancePrewarmSettings,
} from "./instance-prewarm.ts";

export type MultiLaneAgentHostOptions = Omit<
  AgentHostOptions,
  "control" | "kernel" | "manageHostLifecycle" | "startGate"
> & {
  capacity: number;
  /**
   * Bounds on how many Agents may be *starting* at once, ported from Raft's
   * `runtimeStartScheduler`. Omitted fields fall back to the environment and
   * then to Raft's defaults (5 concurrent starts, 500 ms apart).
   */
  runtimeStartScheduler?: Partial<AgentStartSchedulerSettings>;
  /** Owner 2026-09-27: instance runtime prewarming (runtime settings). */
  instancePrewarm?: Partial<InstancePrewarmSettings>;
  host: AuthenticatedHostContext;
  kernel: NonNullable<AgentHostOptions["kernel"]>;
  placementRuntimeResolver: NonNullable<
    AgentHostOptions["placementRuntimeResolver"]
  >;
};

export class MultiLaneAgentHost {
  #capacity: number;
  readonly #host: AuthenticatedHostContext;
  readonly #kernel: NonNullable<AgentHostOptions["kernel"]>;
  readonly #workers: AgentHost[];
  readonly #startGate: AgentStartGate;
  readonly #processHygiene: AgentHostOptions["processHygiene"];
  readonly #instanceRuntimePool: AgentHostOptions["instanceRuntimePool"];
  readonly #prewarmer: InstancePrewarmer | undefined;
  readonly #createWorker: () => AgentHost;
  #launchWorker: ((worker: AgentHost) => void) | undefined;
  #running = false;
  #admissionPaused = false;

  constructor(options: MultiLaneAgentHostOptions) {
    if (!Number.isInteger(options.capacity) || options.capacity <= 0) {
      throw new Error("capacity must be a positive integer");
    }
    this.#capacity = options.capacity;
    this.#host = options.host;
    this.#kernel = options.kernel;
    this.#startGate = new AgentStartGate(options.runtimeStartScheduler ?? {});
    this.#processHygiene = options.processHygiene;
    this.#instanceRuntimePool = options.instanceRuntimePool;
    const pool = options.instanceRuntimePool;
    const retire = pool?.retire?.bind(pool);
    const hygiene = options.processHygiene;
    const hygieneControl = createKernelAgentHostControlPort(
      options.kernel,
      options.host,
    );
    this.#prewarmer =
      retire === undefined
        ? undefined
        : new InstancePrewarmer({
            // Full review 2 batch 1 #2: the same cleanup admission as a
            // claimed turn (AgentHost), checked after the start gate.
            ...(hygiene === undefined
              ? {}
              : {
                  admit: async (participantId: string) =>
                    await hygiene.admit(hygieneControl, participantId),
                }),
            host: options.host,
            kernel: options.kernel,
            open: false,
            pool: { retire },
            resolveRuntime: options.placementRuntimeResolver,
            ...(options.instancePrewarm === undefined
              ? {}
              : { settings: options.instancePrewarm }),
            startGate: this.#startGate,
          });
    this.#createWorker = () => {
      const worker = new AgentHost({
        ...options,
        manageHostLifecycle: false,
        startGate: this.#startGate,
      });
      if (this.#admissionPaused) void worker.pauseAdmission();
      return worker;
    };
    this.#workers = Array.from({ length: options.capacity }, () =>
      this.#createWorker(),
    );
  }

  get capacity(): number {
    return this.#capacity;
  }

  /** Review round 2 P1-2: every lane (and any lane added later) stops claiming. */
  async pauseAdmission(): Promise<void> {
    this.#admissionPaused = true;
    await Promise.all(this.#workers.map((worker) => worker.pauseAdmission()));
  }

  resumeAdmission(): void {
    this.#admissionPaused = false;
    for (const worker of this.#workers) worker.resumeAdmission();
  }

  /**
   * Runtime concurrency setting. Raising adds lanes immediately, even while
   * running; lowering keeps the existing lanes (they idle), because the Kernel
   * Host cap already bounds how many placements exist and a lane is never
   * stopped under a running Activation.
   */
  setCapacity(capacity: number): void {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("capacity must be a positive integer");
    }
    this.#capacity = capacity;
    while (this.#workers.length < capacity) {
      const worker = this.#createWorker();
      this.#workers.push(worker);
      this.#launchWorker?.(worker);
    }
  }

  /** Runtime start-rate setting; applies to the next start admission. */
  updateStartScheduler(settings: Partial<AgentStartSchedulerSettings>): void {
    this.#startGate.updateSettings(settings);
  }

  /** Runtime prewarm setting; applies to the next prewarm. */
  updatePrewarmSettings(settings: Partial<InstancePrewarmSettings>): void {
    this.#prewarmer?.updateSettings(settings);
  }

  /** The Host can take a prewarm hint now (its pool started). */
  acceptsPrewarm(): boolean {
    return this.#prewarmer?.accepting ?? true;
  }

  /** Kernel `instance.runtime` hint: prewarm a newly created instance. */
  async prewarmInstance(
    participantId: string,
  ): Promise<InstancePrewarmOutcome> {
    return this.#prewarmer === undefined
      ? { kind: "skipped", participantId, reason: "no_warm_pool" }
      : await this.#prewarmer.prewarm(participantId);
  }

  /** Kernel `instance.runtime` hint: the instance left its Channel. */
  async retireInstance(participantId: string): Promise<void> {
    await this.#prewarmer?.retire(participantId);
  }

  async run(input: { signal: AbortSignal }): Promise<void> {
    if (this.#running) {
      throw new Error("MultiLaneAgentHost is already running");
    }
    if (input.signal.aborted) return;
    this.#running = true;
    const shutdown = new AbortController();
    const beginDrain = () => shutdown.abort(input.signal.reason);
    input.signal.addEventListener("abort", beginDrain, { once: true });
    if (input.signal.aborted) beginDrain();
    let failures: unknown[] = [];
    // S2-0: one janitor for all lanes, before any lane can launch.
    const janitorStop = new AbortController();
    let janitorLoop: Promise<void> = Promise.resolve();
    try {
      this.#kernel.heartbeatHost(this.#host, { state: "online" });
      if (this.#processHygiene !== undefined) {
        const control = createKernelAgentHostControlPort(
          this.#kernel,
          this.#host,
        );
        await this.#processHygiene
          .janitor(control, "host_start")
          .catch((error: unknown) => {
            process.stderr.write(
              `[rah-os] host-start leftover-process janitor failed (admission paused until a scan succeeds): ${error instanceof Error ? error.message : String(error)}\n`,
            );
          });
        janitorLoop = this.#processHygiene.runPeriodic(
          control,
          janitorStop.signal,
        );
      }
      if (this.#instanceRuntimePool !== undefined)
        await startInstanceRuntimes(this.#instanceRuntimePool);
      // Owner 2026-09-27: after the start janitor, recently active instances
      // get their warm runtime back in the background (lanes do not wait).
      this.#prewarmer?.open();
      void this.#prewarmer?.prewarmRecentlyActive().catch(() => undefined);
      const runs: Promise<void>[] = [];
      this.#launchWorker = (worker) => {
        runs.push(
          (async () => {
            try {
              await worker.run({ signal: shutdown.signal });
            } catch (error) {
              shutdown.abort(error);
              throw error;
            }
          })(),
        );
      };
      for (const worker of this.#workers) this.#launchWorker(worker);
      // Lanes added by setCapacity while running join the same settlement.
      let outcomes: PromiseSettledResult<void>[] = [];
      while (outcomes.length < runs.length)
        outcomes = await Promise.allSettled([...runs]);
      this.#launchWorker = undefined;
      failures = outcomes.flatMap((outcome) =>
        outcome.status === "rejected" ? [outcome.reason] : [],
      );
    } finally {
      this.#launchWorker = undefined;
      janitorStop.abort();
      await janitorLoop;
      await this.#prewarmer?.close();
      await stopInstanceRuntimes(this.#instanceRuntimePool);
      input.signal.removeEventListener("abort", beginDrain);
      this.#startGate.cancelAll("MultiLaneAgentHost stopped");
      try {
        this.#kernel.heartbeatHost(this.#host, { state: "offline" });
      } catch (error) {
        if (!(error instanceof UnauthenticatedError)) failures.push(error);
      }
      this.#running = false;
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, "MultiLaneAgentHost workers failed");
    }
  }
}
