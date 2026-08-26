import { UnauthenticatedError } from "@rah-os/kernel";

import { AgentHost, type AgentHostOptions } from "./agent-host.ts";

export type MultiLaneAgentHostOptions = Omit<
  AgentHostOptions,
  "manageHostLifecycle"
> & {
  capacity: number;
  placementRuntimeResolver: NonNullable<
    AgentHostOptions["placementRuntimeResolver"]
  >;
};

export class MultiLaneAgentHost {
  readonly capacity: number;
  readonly #host: AgentHostOptions["host"];
  readonly #kernel: AgentHostOptions["kernel"];
  readonly #workers: AgentHost[];
  #running = false;

  constructor(options: MultiLaneAgentHostOptions) {
    if (!Number.isInteger(options.capacity) || options.capacity <= 0) {
      throw new Error("capacity must be a positive integer");
    }
    this.capacity = options.capacity;
    this.#host = options.host;
    this.#kernel = options.kernel;
    this.#workers = Array.from(
      { length: options.capacity },
      () => new AgentHost({ ...options, manageHostLifecycle: false }),
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
    try {
      this.#kernel.heartbeatHost(this.#host, { state: "online" });
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
      input.signal.removeEventListener("abort", beginDrain);
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
