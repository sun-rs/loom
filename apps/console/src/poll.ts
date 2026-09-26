/**
 * Polling owner: one in-flight request per poller, aborted when superseded so
 * an older response can never overwrite a newer one; paused while hidden.
 */
export class Poller {
  readonly #intervalMs: number;
  readonly #task: (signal: AbortSignal) => Promise<void>;
  #controller: AbortController | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = true;
  readonly #onVisibility = () => {
    if (!document.hidden) this.runNow();
  };

  constructor(
    intervalMs: number,
    task: (signal: AbortSignal) => Promise<void>,
  ) {
    this.#intervalMs = intervalMs;
    this.#task = task;
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    document.addEventListener("visibilitychange", this.#onVisibility);
    this.runNow();
  }

  stop(): void {
    this.#stopped = true;
    document.removeEventListener("visibilitychange", this.#onVisibility);
    clearTimeout(this.#timer);
    this.#controller?.abort();
    this.#controller = undefined;
  }

  runNow(): void {
    if (this.#stopped) return;
    clearTimeout(this.#timer);
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;
    void this.#task(controller.signal)
      .catch(() => undefined) // tasks render their own failures
      .finally(() => {
        if (this.#stopped || this.#controller !== controller) return;
        this.#timer = setTimeout(() => {
          if (document.hidden) return; // resumed by visibilitychange
          this.runNow();
        }, this.#intervalMs);
      });
  }
}
