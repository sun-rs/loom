import type { RoomWakeHint } from "@rah/runtime-protocol";
import { validateRoomWakeHint } from "@rah/runtime-protocol";

export type RoomWakeListener = (hint: RoomWakeHint) => void;

export class RoomWakeHub {
  readonly #listeners = new Set<RoomWakeListener>();
  readonly #onListenerError: (error: unknown) => void;
  #closed = false;

  constructor(options: { onListenerError?: (error: unknown) => void } = {}) {
    this.#onListenerError = options.onListenerError ?? (() => undefined);
  }

  subscribe(listener: RoomWakeListener): () => void {
    if (this.#closed) throw new Error("Room wake hub is closed");
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  publish(rawHint: RoomWakeHint): number {
    if (this.#closed) throw new Error("Room wake hub is closed");
    const hint = validateRoomWakeHint(rawHint);
    let delivered = 0;
    for (const listener of this.#listeners) {
      try {
        listener(hint);
        delivered += 1;
      } catch (error) {
        try { this.#onListenerError(error); } catch { /* observability is isolated */ }
      }
    }
    return delivered;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#listeners.clear();
  }
}
