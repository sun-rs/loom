import type { RoomOutboxEntry, RoomWakeHint } from "@rah/runtime-protocol";
import { validateRoomWakeHint } from "@rah/runtime-protocol";

export interface RoomOutboxLedgerPort {
  publishedOutboxHead(): number;
  claimOutbox(
    workerId: string,
    options?: { limit?: number; leaseMs?: number },
  ): RoomOutboxEntry[];
  completeOutbox(
    workerId: string,
    outboxSeq: number,
    leaseToken: string,
    deliveryReceipt: string,
  ): RoomOutboxEntry;
  failOutbox(
    workerId: string,
    outboxSeq: number,
    input: {
      error: string;
      retryAt: string;
      leaseToken: string;
      failureClass?: string;
    },
  ): RoomOutboxEntry;
  blockOutbox(
    workerId: string,
    outboxSeq: number,
    input: {
      error: string;
      failureClass: string;
      actionRequired: string;
      sticky: boolean;
      leaseToken: string;
    },
  ): RoomOutboxEntry;
  prunePublishedOutbox(input: {
    throughOutboxSeq: number;
    limit?: number;
  }): number;
}

export interface RoomOutboxDispatchResult {
  claimed: number;
  published: number;
  failed: number;
  blocked: number;
}

export interface RoomOutboxDispatcherStatus {
  running: boolean;
  inFlight: boolean;
  publishedCount: number;
  failureCount: number;
  lastPublishedAt?: string;
  lastError?: string;
}

export interface RoomOutboxDispatcherOptions {
  ledger: RoomOutboxLedgerPort;
  publishRoomEvent: RoomWakePublisher<
    Extract<RoomWakeHint, { topic: "room.event" }>
  >;
  publishInboxWake: RoomWakePublisher<
    Extract<RoomWakeHint, { topic: "inbox.available" }>
  >;
  workerId?: string;
  batchSize?: number;
  leaseMs?: number;
  publishTimeoutMs?: number;
  idleDelayMs?: number;
  baseRetryMs?: number;
  maxRetryMs?: number;
  jitterRatio?: number;
  publishedRetention?: number;
  pruneBatchSize?: number;
  now?: () => Date;
  random?: () => number;
  onError?: (error: unknown) => void;
}

export type RoomWakeDeliveryResult =
  | { status: "accepted"; receiptId: string }
  | {
      status: "retry";
      failureClass: string;
      retryAfterMs?: number;
      message: string;
    }
  | {
      status: "blocked";
      failureClass: string;
      actionRequired: string;
      sticky: boolean;
      message: string;
    };

export type RoomWakePublisher<T extends RoomWakeHint = RoomWakeHint> = (
  hint: T,
  context: { attemptId: string; signal: AbortSignal },
) => Promise<RoomWakeDeliveryResult> | RoomWakeDeliveryResult;

const DEFAULT_WORKER_ID = `room-outbox-${process.pid}`;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function payloadRecord(entry: RoomOutboxEntry): Record<string, unknown> {
  if (
    !entry.payload ||
    typeof entry.payload !== "object" ||
    Array.isArray(entry.payload)
  ) {
    throw new Error("Room outbox payload must be an object");
  }
  return entry.payload;
}

function exactPayloadKeys(
  payload: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(payload)) {
    if (!allowed.includes(key))
      throw new Error(`Room outbox payload contains unknown field ${key}`);
  }
}

export function roomWakeHintFromOutbox(entry: RoomOutboxEntry): RoomWakeHint {
  const payload = payloadRecord(entry);
  if (entry.topic === "room.event") {
    exactPayloadKeys(payload, ["eventId", "roomId", "roomSeq", "type"]);
    if (payload.roomId !== entry.roomId || payload.roomSeq !== entry.roomSeq) {
      throw new Error("Room outbox event payload does not match its envelope");
    }
    return validateRoomWakeHint({
      schema: "rah.room-wake.v1",
      hintId: entry.outboxId,
      topic: "room.event",
      eventId: payload.eventId,
      eventType: payload.type,
      roomId: entry.roomId,
      roomSeq: entry.roomSeq,
    });
  }
  if (entry.topic === "inbox.available") {
    exactPayloadKeys(payload, [
      "eventId",
      "headCursor",
      "participantId",
      "reason",
      "disposition",
      "roomId",
    ]);
    if (
      payload.roomId !== entry.roomId ||
      payload.headCursor !== entry.roomSeq
    ) {
      throw new Error("Room outbox inbox payload does not match its envelope");
    }
    return validateRoomWakeHint({
      schema: "rah.room-wake.v1",
      hintId: entry.outboxId,
      topic: "inbox.available",
      eventId: payload.eventId,
      participantId: payload.participantId,
      reason: payload.reason,
      disposition: payload.disposition,
      roomId: entry.roomId,
      roomSeq: entry.roomSeq,
    });
  }
  throw new Error(`Unsupported Room outbox topic ${String(entry.topic)}`);
}

export class RoomOutboxDispatcher {
  readonly #options: Required<
    Pick<
      RoomOutboxDispatcherOptions,
      | "workerId"
      | "batchSize"
      | "leaseMs"
      | "publishTimeoutMs"
      | "idleDelayMs"
      | "baseRetryMs"
      | "maxRetryMs"
      | "jitterRatio"
      | "publishedRetention"
      | "pruneBatchSize"
      | "now"
      | "random"
      | "onError"
    >
  > &
    Pick<
      RoomOutboxDispatcherOptions,
      "ledger" | "publishRoomEvent" | "publishInboxWake"
    >;
  readonly #stopController = new AbortController();
  #running = false;
  #closed = false;
  #timer: NodeJS.Timeout | undefined;
  #dispatchPromise: Promise<RoomOutboxDispatchResult> | undefined;
  #publishedCount = 0;
  #failureCount = 0;
  #lastPublishedAt: string | undefined;
  #lastError: string | undefined;

  constructor(options: RoomOutboxDispatcherOptions) {
    const leaseMs = options.leaseMs ?? 30_000;
    const publishTimeoutMs = options.publishTimeoutMs ?? 10_000;
    const baseRetryMs = options.baseRetryMs ?? 500;
    const maxRetryMs = options.maxRetryMs ?? 30_000;
    const jitterRatio = options.jitterRatio ?? 0.2;
    const idleDelayMs = options.idleDelayMs ?? 1_000;
    const publishedRetention = options.publishedRetention ?? 10_000;
    const pruneBatchSize = options.pruneBatchSize ?? 500;
    if (options.workerId !== undefined && !options.workerId.trim()) {
      throw new Error("Room dispatcher workerId must not be empty");
    }
    if (
      !Number.isInteger(options.batchSize ?? 50) ||
      (options.batchSize ?? 50) < 1 ||
      (options.batchSize ?? 50) > 500
    )
      throw new Error("Room dispatcher batchSize is invalid");
    if (publishTimeoutMs < 1 || publishTimeoutMs >= leaseMs) {
      throw new Error(
        "Room dispatcher publishTimeoutMs must be positive and shorter than leaseMs",
      );
    }
    if (baseRetryMs < 1 || maxRetryMs < baseRetryMs) {
      throw new Error("Room dispatcher retry bounds are invalid");
    }
    if (jitterRatio < 0 || jitterRatio > 1) {
      throw new Error(
        "Room dispatcher jitterRatio must be between zero and one",
      );
    }
    if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) {
      throw new Error(
        "Room dispatcher leaseMs must be between 1000 and 300000",
      );
    }
    if (!Number.isInteger(publishTimeoutMs)) {
      throw new Error("Room dispatcher publishTimeoutMs must be an integer");
    }
    if (
      !Number.isInteger(idleDelayMs) ||
      idleDelayMs < 10 ||
      idleDelayMs > 300_000
    ) {
      throw new Error(
        "Room dispatcher idleDelayMs must be between 10 and 300000",
      );
    }
    if (
      !Number.isInteger(publishedRetention) ||
      publishedRetention < 0 ||
      publishedRetention > 1_000_000
    ) {
      throw new Error(
        "Room dispatcher publishedRetention must be between 0 and 1000000",
      );
    }
    if (
      !Number.isInteger(pruneBatchSize) ||
      pruneBatchSize < 1 ||
      pruneBatchSize > 500
    ) {
      throw new Error(
        "Room dispatcher pruneBatchSize must be between 1 and 500",
      );
    }
    this.#options = {
      ledger: options.ledger,
      publishRoomEvent: options.publishRoomEvent,
      publishInboxWake: options.publishInboxWake,
      workerId: options.workerId ?? DEFAULT_WORKER_ID,
      batchSize: options.batchSize ?? 50,
      leaseMs,
      publishTimeoutMs,
      idleDelayMs,
      baseRetryMs,
      maxRetryMs,
      jitterRatio,
      publishedRetention,
      pruneBatchSize,
      now: options.now ?? (() => new Date()),
      random: options.random ?? Math.random,
      onError: options.onError ?? (() => undefined),
    };
  }

  start(): void {
    if (this.#closed) throw new Error("Room outbox dispatcher is closed");
    if (this.#running) return;
    this.#running = true;
    this.#schedule(0);
  }

  async dispatchOnce(): Promise<RoomOutboxDispatchResult> {
    if (this.#closed) throw new Error("Room outbox dispatcher is closed");
    if (this.#dispatchPromise) return this.#dispatchPromise;
    const operation = this.#dispatchAvailable();
    this.#dispatchPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.#dispatchPromise === operation)
        this.#dispatchPromise = undefined;
    }
  }

  status(): RoomOutboxDispatcherStatus {
    return {
      running: this.#running && !this.#closed,
      inFlight: Boolean(this.#dispatchPromise),
      publishedCount: this.#publishedCount,
      failureCount: this.#failureCount,
      ...(this.#lastPublishedAt
        ? { lastPublishedAt: this.#lastPublishedAt }
        : {}),
      ...(this.#lastError ? { lastError: this.#lastError } : {}),
    };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#stopController.abort(new Error("Room outbox dispatcher stopped"));
    await this.#dispatchPromise;
  }

  async #dispatchAvailable(): Promise<RoomOutboxDispatchResult> {
    const result: RoomOutboxDispatchResult = {
      claimed: 0,
      published: 0,
      failed: 0,
      blocked: 0,
    };
    for (let index = 0; index < this.#options.batchSize; index += 1) {
      const entry = this.#options.ledger.claimOutbox(this.#options.workerId, {
        limit: 1,
        leaseMs: this.#options.leaseMs,
      })[0];
      if (!entry) break;
      result.claimed += 1;
      const leaseToken = entry.leaseToken;
      if (!leaseToken) {
        throw new Error(
          `Room outbox entry ${entry.outboxSeq} has no lease token`,
        );
      }
      let hint: RoomWakeHint;
      try {
        hint = roomWakeHintFromOutbox(entry);
      } catch (error) {
        const message = errorMessage(error);
        try {
          this.#options.ledger.blockOutbox(
            this.#options.workerId,
            entry.outboxSeq,
            {
              error: message,
              failureClass: "invalid_payload",
              actionRequired: "repair or discard the invalid durable outbox entry",
              sticky: true,
              leaseToken,
            },
          );
        } catch (leaseError) {
          this.#reportError(leaseError);
        }
        result.blocked += 1;
        this.#failureCount += 1;
        this.#lastError = message;
        this.#reportError(error);
        continue;
      }
      try {
        const delivery = await this.#publishWithDeadline(hint, leaseToken);
        if (delivery.status === "accepted") {
          this.#options.ledger.completeOutbox(
            this.#options.workerId,
            entry.outboxSeq,
            leaseToken,
            delivery.receiptId,
          );
          result.published += 1;
          this.#publishedCount += 1;
          this.#lastPublishedAt = this.#options.now().toISOString();
          this.#lastError = undefined;
        } else if (delivery.status === "blocked") {
          this.#options.ledger.blockOutbox(
            this.#options.workerId,
            entry.outboxSeq,
            {
              error: delivery.message,
              failureClass: delivery.failureClass,
              actionRequired: delivery.actionRequired,
              sticky: delivery.sticky,
              leaseToken,
            },
          );
          result.blocked += 1;
          this.#failureCount += 1;
          this.#lastError = delivery.message;
          this.#reportError(new Error(delivery.message));
        } else {
          const retryDelay = Math.max(
            this.#retryDelay(entry.attemptCount),
            delivery.retryAfterMs ?? 0,
          );
          this.#options.ledger.failOutbox(
            this.#options.workerId,
            entry.outboxSeq,
            {
              error: delivery.message,
              failureClass: delivery.failureClass,
              retryAt: new Date(
                this.#options.now().getTime() + retryDelay,
              ).toISOString(),
              leaseToken,
            },
          );
          result.failed += 1;
          this.#failureCount += 1;
          this.#lastError = delivery.message;
          this.#reportError(new Error(delivery.message));
        }
      } catch (error) {
        const message = errorMessage(error);
        try {
          this.#options.ledger.failOutbox(
            this.#options.workerId,
            entry.outboxSeq,
            {
              error: message,
              retryAt: new Date(
                this.#options.now().getTime() +
                  this.#retryDelay(entry.attemptCount),
              ).toISOString(),
              leaseToken,
            },
          );
        } catch (leaseError) {
          this.#reportError(leaseError);
        }
        result.failed += 1;
        this.#failureCount += 1;
        this.#lastError = message;
        this.#reportError(error);
      }
    }
    this.#prunePublishedHistory();
    return result;
  }

  #prunePublishedHistory(): void {
    try {
      // The head is read from durable state instead of this process's current
      // publish batch. An idle dispatch therefore repairs the crash window
      // between completeOutbox() and this bounded maintenance step.
      const throughOutboxSeq =
        this.#options.ledger.publishedOutboxHead() -
        this.#options.publishedRetention;
      if (throughOutboxSeq < 1) return;
      this.#options.ledger.prunePublishedOutbox({
        throughOutboxSeq,
        limit: this.#options.pruneBatchSize,
      });
    } catch (error) {
      // Publication is already durable. Maintenance failures are observable but
      // must not turn successful delivery into a duplicate retry.
      this.#reportError(error);
    }
  }

  #retryDelay(attemptCount: number): number {
    const exponential = Math.min(
      this.#options.maxRetryMs,
      this.#options.baseRetryMs *
        2 ** Math.min(20, Math.max(0, attemptCount - 1)),
    );
    const jitter =
      1 + (this.#options.random() * 2 - 1) * this.#options.jitterRatio;
    return Math.min(
      this.#options.maxRetryMs,
      Math.max(1, Math.round(exponential * jitter)),
    );
  }

  #publishWithDeadline(
    hint: RoomWakeHint,
    attemptId: string,
  ): Promise<RoomWakeDeliveryResult> {
    const controller = new AbortController();
    const stop = () => controller.abort(this.#stopController.signal.reason);
    if (this.#stopController.signal.aborted) stop();
    else
      this.#stopController.signal.addEventListener("abort", stop, {
        once: true,
      });
    const timer = setTimeout(() => {
      controller.abort(new Error("Room outbox publish timed out"));
    }, this.#options.publishTimeoutMs);
    timer.unref?.();
    const aborted = new Promise<never>((_resolve, reject) => {
      if (controller.signal.aborted) reject(controller.signal.reason);
      else
        controller.signal.addEventListener(
          "abort",
          () => reject(controller.signal.reason),
          { once: true },
        );
    });
    return Promise.race([
      Promise.resolve().then(() =>
        hint.topic === "room.event"
          ? this.#options.publishRoomEvent(hint, {
              attemptId,
              signal: controller.signal,
            })
          : this.#options.publishInboxWake(hint, {
              attemptId,
              signal: controller.signal,
            }),
      ),
      aborted,
    ]).finally(() => {
      clearTimeout(timer);
      this.#stopController.signal.removeEventListener("abort", stop);
    });
  }

  #schedule(delayMs: number): void {
    if (!this.#running || this.#closed || this.#timer) return;
    this.#timer = setTimeout(
      () => {
        this.#timer = undefined;
        void this.dispatchOnce()
          .catch((error) => {
            this.#failureCount += 1;
            this.#lastError = errorMessage(error);
            this.#reportError(error);
          })
          .finally(() => this.#schedule(this.#options.idleDelayMs));
      },
      Math.max(0, delayMs),
    );
    this.#timer.unref?.();
  }

  #reportError(error: unknown): void {
    try {
      this.#options.onError(error);
    } catch {
      // Observability callbacks must never interrupt durable queue progress.
    }
  }
}
