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
  host: AuthenticatedHostContext;
  kernel: NonNullable<AgentHostOptions["kernel"]>;
  placementRuntimeResolver: NonNullable<
    AgentHostOptions["placementRuntimeResolver"]
  >;
};

export class MultiLaneAgentHost {
  readonly capacity: number;
  readonly #host: AuthenticatedHostContext;
  readonly #kernel: NonNullable<AgentHostOptions["kernel"]>;
  readonly #workers: AgentHost[];
  readonly #startGate: AgentStartGate;
  readonly #processHygiene: AgentHostOptions["processHygiene"];
  readonly #instanceRuntimePool: AgentHostOptions["instanceRuntimePool"];
  #running = false;

  constructor(options: MultiLaneAgentHostOptions) {
    if (!Number.isInteger(options.capacity) || options.capacity <= 0) {
      throw new Error("capacity must be a positive integer");
    }
    this.capacity = options.capacity;
    this.#host = options.host;
    this.#kernel = options.kernel;
    this.#startGate = new AgentStartGate(options.runtimeStartScheduler ?? {});
    this.#processHygiene = options.processHygiene;
    this.#instanceRuntimePool = options.instanceRuntimePool;
    this.#workers = Array.from(
      { length: options.capacity },
      () =>
        new AgentHost({
          ...options,
          manageHostLifecycle: false,
          startGate: this.#startGate,
        }),
    );
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
              `[rah-os] host-start leftover-process janitor failed: ${error instanceof Error ? error.message : String(error)}\n`,
            );
          });
        janitorLoop = this.#processHygiene.runPeriodic(
          control,
          janitorStop.signal,
        );
      }
      if (this.#instanceRuntimePool !== undefined)
        await startInstanceRuntimes(this.#instanceRuntimePool);
      const outcomes = await Promise.allSettled(
        this.#workers.map(async (worker) => {
          try {
            await worker.run({ signal: shutdown.signal });
          } catch (error) {
            shutdown.abort(error);
            throw error;
          }
        }),
      );
      failures = outcomes.flatMap((outcome) =>
        outcome.status === "rejected" ? [outcome.reason] : [],
      );
    } finally {
      janitorStop.abort();
      await janitorLoop;
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
