import {
  MultiLaneAgentHost,
  type MultiLaneAgentHostOptions,
} from "@rah-os/agent-host";
import { RoomKernel, type RoomKernelOptions } from "@rah-os/kernel";

export type RahCoreOptions = RoomKernelOptions;

export type CoreMultiLaneAgentHostOptions = Omit<
  MultiLaneAgentHostOptions,
  "kernel"
>;

export type RahCoreState = "created" | "open" | "closed";

export class RahCore {
  readonly #kernel: RoomKernel;
  #state: RahCoreState = "created";

  constructor(options: RahCoreOptions) {
    this.#kernel = new RoomKernel(options);
  }

  static open(options: RahCoreOptions): RahCore {
    return new RahCore(options).initialize();
  }

  get state(): RahCoreState {
    return this.#state;
  }

  get kernel(): RoomKernel {
    this.#assertOpen();
    return this.#kernel;
  }

  initialize(): this {
    if (this.#state === "closed") {
      throw new Error("RahCore cannot be reopened after close");
    }
    if (this.#state === "created") {
      this.#kernel.initialize();
      this.#state = "open";
    }
    return this;
  }

  createMultiLaneAgentHost(
    options: CoreMultiLaneAgentHostOptions,
  ): MultiLaneAgentHost {
    this.#assertOpen();
    return new MultiLaneAgentHost({ ...options, kernel: this.#kernel });
  }

  close(): void {
    if (this.#state === "closed") return;
    this.#kernel.close();
    this.#state = "closed";
  }

  #assertOpen(): void {
    if (this.#state !== "open") {
      throw new Error(`RahCore is not open (state: ${this.#state})`);
    }
  }
}
