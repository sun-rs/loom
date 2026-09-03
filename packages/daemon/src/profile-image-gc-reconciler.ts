import type { ProfileImageGcReconcileResult } from "@rah-os/core";

export type ProfileImageGcReconcilerOptions = Readonly<{
  onError?: (error: unknown) => void;
  onResult?: (result: ProfileImageGcReconcileResult) => void;
  pollIntervalMs?: number;
  reconcile: () =>
    Promise<ProfileImageGcReconcileResult> | ProfileImageGcReconcileResult;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}>;

/** Daemon cadence only; the Kernel owns durable claims and retry state. */
export class ProfileImageGcReconciler {
  readonly #onError: ((error: unknown) => void) | undefined;
  readonly #onResult:
    ((result: ProfileImageGcReconcileResult) => void) | undefined;
  readonly #pollIntervalMs: number;
  readonly #reconcile: ProfileImageGcReconcilerOptions["reconcile"];
  readonly #wait: (delayMs: number, signal: AbortSignal) => Promise<void>;

  constructor(options: ProfileImageGcReconcilerOptions) {
    this.#pollIntervalMs = options.pollIntervalMs ?? 60_000;
    if (!Number.isInteger(this.#pollIntervalMs) || this.#pollIntervalMs <= 0) {
      throw new Error(
        "Profile image GC pollIntervalMs must be a positive integer",
      );
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
