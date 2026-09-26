import type { RoomKernel } from "@rah-os/core";
import { INSTANCE_RUNTIME_HINT_TOPIC } from "@rah-os/kernel";

/** The Host operations a Kernel `instance.runtime` hint asks for. */
export type InstanceRuntimeHintTarget = {
  prewarmInstance(participantId: string): Promise<unknown>;
  retireInstance(participantId: string): Promise<void>;
};

/**
 * Owner 2026-09-27 (contract §6a): delivers the Kernel's durable
 * `instance.runtime` Outbox hints to this Host — prewarm a newly created Role
 * instance, retire the runtime of a removed one. A hint is content free and
 * best effort: a lost or failed prewarm only means the instance's first turn
 * starts cold, and a lost retire leaves the runtime to its idle TTL. Before
 * a prewarm the Host re-observes its execution workspaces (the new
 * instance's channel-home mount) so the prewarm plan and the first turn see
 * the same mount.
 */
export class InstanceRuntimeHintDispatcher {
  readonly #dispatcherId: string;
  readonly #kernel: Pick<
    RoomKernel,
    "acknowledgeOutboxPublished" | "leaseNextOutbox" | "retryOutbox"
  >;
  readonly #target: InstanceRuntimeHintTarget;
  readonly #beforePrewarm: () => Promise<void>;
  readonly #leaseMs: number;
  readonly #pollIntervalMs: number;
  readonly #retryAfterMs: number;
  readonly #onDiagnostic: (message: string) => void;

  constructor(input: {
    dispatcherId: string;
    kernel: Pick<
      RoomKernel,
      "acknowledgeOutboxPublished" | "leaseNextOutbox" | "retryOutbox"
    >;
    target: InstanceRuntimeHintTarget;
    beforePrewarm?: () => Promise<void>;
    leaseMs: number;
    pollIntervalMs: number;
    /** Delay before a hint the Host could not take yet is offered again. */
    retryAfterMs?: number;
    onDiagnostic?: (message: string) => void;
  }) {
    this.#dispatcherId = input.dispatcherId;
    this.#kernel = input.kernel;
    this.#target = input.target;
    this.#beforePrewarm = input.beforePrewarm ?? (async () => undefined);
    this.#leaseMs = input.leaseMs;
    this.#pollIntervalMs = input.pollIntervalMs;
    this.#retryAfterMs = input.retryAfterMs ?? 1_000;
    this.#onDiagnostic =
      input.onDiagnostic ??
      ((message) =>
        process.stderr.write(`[loom instance-runtime-hint] ${message}\n`));
  }

  /** Handles one pending hint; false when there was none. */
  async dispatchOnce(): Promise<boolean> {
    const entry = this.#kernel.leaseNextOutbox({
      dispatcherId: this.#dispatcherId,
      leaseMs: this.#leaseMs,
      topics: [INSTANCE_RUNTIME_HINT_TOPIC],
    });
    if (entry === null) return false;
    const { action, participantId } = entry.payload as {
      action?: unknown;
      participantId?: unknown;
    };
    try {
      if (typeof participantId === "string" && action === "prewarm") {
        await this.#beforePrewarm();
        const outcome = (await this.#target.prewarmInstance(participantId)) as
          { reason?: unknown } | undefined;
        if (outcome?.reason === "host_not_running") {
          // The Host has not started its pool yet (daemon start): keep it.
          this.#kernel.retryOutbox({
            dispatcherId: this.#dispatcherId,
            error: "host not running yet",
            outboxId: entry.outboxId,
            retryAfterMs: this.#retryAfterMs,
          });
          return true;
        }
      } else if (typeof participantId === "string" && action === "retire")
        await this.#target.retireInstance(participantId);
    } catch (error) {
      this.#onDiagnostic(
        `${String(action)} of ${String(participantId)} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // Best effort: never retried (a retry could prewarm a busy instance
    // later for nothing); durable state already covers every outcome.
    this.#kernel.acknowledgeOutboxPublished({
      dispatcherId: this.#dispatcherId,
      outboxId: entry.outboxId,
    });
    return true;
  }

  async run(input: { signal: AbortSignal }): Promise<void> {
    while (!input.signal.aborted) {
      if (await this.dispatchOnce()) continue;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, this.#pollIntervalMs);
        input.signal.addEventListener("abort", done, { once: true });
        function done() {
          clearTimeout(timer);
          input.signal.removeEventListener("abort", done);
          resolve();
        }
      });
    }
  }
}
