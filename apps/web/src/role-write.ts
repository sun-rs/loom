import { RahClientError } from "@rah-os/client-sdk";

/** Form-local write intent, not domain state. Unknown results only replay the
 * exact request; a refused verification cannot prove the first send failed. */
export class RoleWrite {
  #request: unknown;
  #busy = false;
  #unknown = false;
  readonly #listeners = new Set<() => void>();
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  get state(): "idle" | "pending" | "unknown" {
    return this.#busy ? "pending" : this.#unknown ? "unknown" : "idle";
  }
  get payload(): Record<string, unknown> | undefined {
    if (!this.#request) return;
    const {
      basedOnRoomSeq: _basis,
      idempotencyKey: _key,
      ...payload
    } = this.#request as Record<string, unknown>;
    return structuredClone(payload);
  }
  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
  get unknown(): boolean {
    return this.#unknown;
  }
  discard(): void {
    if (this.#busy) throw new Error("请求正在进行");
    this.#request = undefined;
    this.#unknown = false;
    this.#notify();
  }
  async run<P extends object, R>(
    payload: P,
    head: () => Promise<number>,
    send: (
      request: P & { basedOnRoomSeq: number; idempotencyKey: string },
    ) => Promise<R>,
  ): Promise<R> {
    if (this.#busy) throw new Error("请求正在进行");
    this.#busy = true;
    this.#notify();
    let sent = false;
    try {
      if (!this.#request) {
        this.#request = {
          ...structuredClone(payload),
          basedOnRoomSeq: await head(),
          idempotencyKey: `web-role-${crypto.randomUUID()}`,
        };
      }
      sent = true;
      const result = await send(
        this.#request as P & { basedOnRoomSeq: number; idempotencyKey: string },
      );
      this.#request = undefined;
      this.#unknown = false;
      return result;
    } catch (error) {
      const refused =
        error instanceof RahClientError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408;
      if (!this.#unknown && (!sent || refused)) this.#request = undefined;
      else this.#unknown = true;
      throw error;
    } finally {
      this.#busy = false;
      this.#notify();
    }
  }
}
