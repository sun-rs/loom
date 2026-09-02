import type { ReminderReconcileResult } from "@rah-os/kernel";

export type ReminderReconcilerOptions = Readonly<{
  onError?: (error: unknown) => void;
  onResult?: (result: ReminderReconcileResult) => void;
  pollIntervalMs?: number;
  reconcile: () => Promise<ReminderReconcileResult> | ReminderReconcileResult;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}>;

/** Computer-side timer/retry loop; Kernel remains the schedule authority. */
export class ReminderReconciler {
  readonly #onError: ((error: unknown) => void) | undefined;
  readonly #onResult: ((result: ReminderReconcileResult) => void) | undefined;
  readonly #pollIntervalMs: number;
  readonly #reconcile: ReminderReconcilerOptions["reconcile"];
  readonly #wait: (delayMs: number, signal: AbortSignal) => Promise<void>;

  constructor(options: ReminderReconcilerOptions) {
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000;
    if (!Number.isInteger(this.#pollIntervalMs) || this.#pollIntervalMs <= 0) {
      throw new Error("Reminder pollIntervalMs must be a positive integer");
    }
    this.#onError = options.onError;
    this.#onResult = options.onResult;
    this.#reconcile = options.reconcile;
    this.#wait = options.wait ?? waitForDelay;
  }

  async run(input: { signal: AbortSignal }): Promise<void> {
    while (!input.signal.aborted) {
      try {
        this.#onResult?.(await this.#reconcile());
      } catch (error) {
        this.#onError?.(error);
      }
      if (input.signal.aborted) return;
      await this.#wait(this.#pollIntervalMs, input.signal);
    }
  }
}

async function waitForDelay(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, delayMs);
    function finish() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}
