import type { ClientPushSubscription, WebPushPayload } from "@rah-os/protocol";

type PushKernel = {
  leaseNextOutbox(input: {
    dispatcherId: string;
    leaseMs: number;
    topics: string[];
  }): {
    outboxId: string;
    roomId: string;
    roomSeq: number;
    createdAt?: string;
  } | null;
  humanNotifications: {
    webPush: {
      project(input: {
        roomId: string;
        roomSeq: number;
      }): Array<{ payload: WebPushPayload; principalId: string }>;
    };
  };
  acknowledgeOutboxPublished(input: {
    dispatcherId: string;
    outboxId: string;
  }): unknown;
  retryOutbox(input: {
    dispatcherId: string;
    error: string;
    outboxId: string;
    retryAfterMs: number;
  }): unknown;
};

export type WebPushTransport = {
  send(
    subscription: ClientPushSubscription,
    payload: WebPushPayload,
  ): Promise<void>;
};

type SubscriptionStore = {
  list(principalId: string): Promise<ClientPushSubscription[]>;
  remove(principalId: string, endpoint: string): Promise<boolean>;
};

export class WebPushOutboxDispatcher {
  readonly #dispatcherId: string;
  readonly #kernel: PushKernel;
  readonly #leaseMs: number;
  readonly #pollIntervalMs: number;
  readonly #retryAfterMs: number;
  readonly #subscriptions: SubscriptionStore;
  readonly #transport: WebPushTransport;

  constructor(input: {
    dispatcherId: string;
    kernel: PushKernel;
    leaseMs: number;
    pollIntervalMs: number;
    retryAfterMs: number;
    subscriptions: SubscriptionStore;
    transport: WebPushTransport;
  }) {
    this.#dispatcherId = input.dispatcherId;
    this.#kernel = input.kernel;
    this.#leaseMs = input.leaseMs;
    this.#pollIntervalMs = input.pollIntervalMs;
    this.#retryAfterMs = input.retryAfterMs;
    this.#subscriptions = input.subscriptions;
    this.#transport = input.transport;
  }

  async run(input: { signal: AbortSignal }): Promise<void> {
    while (!input.signal.aborted) {
      const entry = this.#kernel.leaseNextOutbox({
        dispatcherId: this.#dispatcherId,
        leaseMs: this.#leaseMs,
        topics: ["room.event"],
      });
      if (!entry) {
        await wait(this.#pollIntervalMs, input.signal);
        continue;
      }
      try {
        const stale =
          entry.createdAt !== undefined &&
          Date.now() - Date.parse(entry.createdAt) > 15 * 60_000;
        for (const candidate of stale
          ? []
          : this.#kernel.humanNotifications.webPush.project(entry)) {
          const subscriptions = await this.#subscriptions.list(
            candidate.principalId,
          );
          for (const subscription of subscriptions) {
            try {
              await this.#transport.send(subscription, candidate.payload);
            } catch (error) {
              const statusCode =
                typeof error === "object" &&
                error !== null &&
                "statusCode" in error
                  ? Number(error.statusCode)
                  : undefined;
              if (statusCode === 404 || statusCode === 410) {
                await this.#subscriptions.remove(
                  candidate.principalId,
                  subscription.endpoint,
                );
                continue;
              }
              throw error;
            }
          }
        }
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

async function wait(delayMs: number, signal: AbortSignal) {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(done, delayMs);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
