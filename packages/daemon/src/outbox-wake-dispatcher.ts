import { MultiLaneAgentHost } from "@rah-os/agent-host";
import type { RoomKernel } from "@rah-os/core";

import { InstanceRuntimeHintDispatcher } from "./instance-runtime-hint-dispatcher.ts";

export interface ContentFreeWakePublisher {
  publish(): Promise<void> | void;
}

export class LocalWakeSignal implements ContentFreeWakePublisher {
  readonly #waiters = new Set<() => void>();
  #pending = false;

  publish(): void {
    if (this.#waiters.size === 0) {
      this.#pending = true;
      return;
    }
    this.#pending = false;
    for (const wake of [...this.#waiters]) wake();
  }

  async wait(delayMs: number, signal: AbortSignal): Promise<void> {
    if (this.#pending) {
      this.#pending = false;
      return;
    }
    if (signal.aborted) return;
    let registeredWaiter: (() => void) | undefined;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(finish, delayMs);
      const onAbort = () => finish();
      registeredWaiter = finish;
      this.#waiters.add(finish);
      signal.addEventListener("abort", onAbort, { once: true });

      function finish(): void {
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        resolve();
      }
    }).finally(() => {
      if (registeredWaiter !== undefined) {
        this.#waiters.delete(registeredWaiter);
      }
    });
  }
}

export class OutboxWakeDispatcher {
  readonly #dispatcherId: string;
  readonly #kernel: RoomKernel;
  readonly #leaseMs: number;
  readonly #pollIntervalMs: number;
  readonly #publisher: ContentFreeWakePublisher;
  readonly #retryAfterMs: number;

  constructor(input: {
    dispatcherId: string;
    kernel: RoomKernel;
    leaseMs: number;
    pollIntervalMs: number;
    publisher: ContentFreeWakePublisher;
    retryAfterMs: number;
  }) {
    if (input.dispatcherId.trim().length === 0) {
      throw new Error("dispatcherId is required");
    }
    for (const [name, value, allowZero] of [
      ["leaseMs", input.leaseMs, false],
      ["pollIntervalMs", input.pollIntervalMs, false],
      ["retryAfterMs", input.retryAfterMs, true],
    ] as const) {
      if (!Number.isInteger(value) || (allowZero ? value < 0 : value <= 0)) {
        throw new Error(
          `${name} must be ${allowZero ? "a non-negative" : "a positive"} integer`,
        );
      }
    }
    this.#dispatcherId = input.dispatcherId;
    this.#kernel = input.kernel;
    this.#leaseMs = input.leaseMs;
    this.#pollIntervalMs = input.pollIntervalMs;
    this.#publisher = input.publisher;
    this.#retryAfterMs = input.retryAfterMs;
  }

  async run(input: { signal: AbortSignal }): Promise<void> {
    while (!input.signal.aborted) {
      const entry = this.#kernel.leaseNextOutbox({
        dispatcherId: this.#dispatcherId,
        leaseMs: this.#leaseMs,
        topics: ["activation.requested"],
      });
      if (entry === null) {
        await waitForDelay(this.#pollIntervalMs, input.signal);
        continue;
      }
      try {
        await this.#publisher.publish();
        this.#kernel.acknowledgeOutboxPublished({
          dispatcherId: this.#dispatcherId,
          outboxId: entry.outboxId,
        });
      } catch (error) {
        this.#kernel.retryOutbox({
          dispatcherId: this.#dispatcherId,
          error: error instanceof Error ? error.message : String(error),
          outboxId: entry.outboxId,
          retryAfterMs: this.#retryAfterMs,
        });
      }
    }
  }
}

/**
 * The daemon's Outbox consumers for this Host: Activation wake hints, and
 * (owner 2026-09-27) instance runtime hints — prewarm a created instance,
 * retire a removed one — when the Host runs multi-lane with a warm pool.
 */
export function createOutboxDispatcherRunners(input: {
  config: {
    outboxLeaseMs: number;
    outboxPollIntervalMs: number;
    outboxRetryAfterMs: number;
  };
  host: { hostId: string; instanceId: string };
  kernel: RoomKernel;
  /** Re-observed before a prewarm (the new instance's channel-home mount). */
  publishers: ReadonlyArray<{
    publishAvailable(): boolean;
    refreshWorkspaceMounts(): Promise<void>;
  }>;
  runner: unknown;
  wakeSignal: ContentFreeWakePublisher;
}): Array<(signal: AbortSignal) => Promise<void>> {
  const { config, host, kernel } = input;
  const wake = new OutboxWakeDispatcher({
    dispatcherId: `${host.hostId}:${host.instanceId}:wake`,
    kernel,
    leaseMs: config.outboxLeaseMs,
    pollIntervalMs: config.outboxPollIntervalMs,
    publisher: {
      publish: async () => {
        // New instances may have no published channel-home mount yet. A wake
        // before this observation can be consumed by an idle lane, leaving
        // the durable Activation waiting for the coarse reconciliation poll.
        // Keep preparation on the Host; a failure retries the Outbox hint.
        for (const publisher of input.publishers) {
          await publisher.refreshWorkspaceMounts();
          publisher.publishAvailable();
        }
        await input.wakeSignal.publish();
      },
    },
    retryAfterMs: config.outboxRetryAfterMs,
  });
  const runners = [async (signal: AbortSignal) => await wake.run({ signal })];
  if (input.runner instanceof MultiLaneAgentHost) {
    const hints = new InstanceRuntimeHintDispatcher({
      beforePrewarm: async () => {
        for (const publisher of input.publishers) {
          await publisher.refreshWorkspaceMounts();
          publisher.publishAvailable();
        }
      },
      dispatcherId: `${host.hostId}:${host.instanceId}:instance-runtime`,
      kernel,
      leaseMs: config.outboxLeaseMs,
      pollIntervalMs: config.outboxPollIntervalMs,
      target: input.runner,
    });
    runners.push(async (signal: AbortSignal) => await hints.run({ signal }));
  }
  return runners;
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
