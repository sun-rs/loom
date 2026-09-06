function createCommandId(prefix: string): string {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${id}`;
}

/**
 * Retains one idempotency key for one semantic user intent until the caller
 * observes a successful canonical receipt. A lost HTTP response can therefore
 * be retried without creating a second Room command.
 */
export class RoomIntentKeys {
  readonly #keys = new Map<string, string>();
  readonly #requests = new Map<string, unknown>();

  key(prefix: string, semanticIntent: string): string {
    const scope = `${prefix}\u0000${semanticIntent}`;
    const existing = this.#keys.get(scope);
    if (existing) return existing;
    const created = createCommandId(prefix);
    this.#keys.set(scope, created);
    return created;
  }

  /**
   * Freezes the complete first request, including its causal basedOnRoomSeq.
   * A background sync after a lost response must not silently turn a retry
   * into a different command with a newer precondition.
   */
  request<T>(
    prefix: string,
    semanticIntent: string,
    create: (idempotencyKey: string) => T,
  ): T {
    const scope = `${prefix}\u0000${semanticIntent}`;
    const existing = this.#requests.get(scope);
    if (existing !== undefined) return existing as T;
    const request = create(this.key(prefix, semanticIntent));
    this.#requests.set(scope, request);
    return request;
  }

  complete(prefix: string, semanticIntent: string): void {
    const scope = `${prefix}\u0000${semanticIntent}`;
    this.#keys.delete(scope);
    this.#requests.delete(scope);
  }
}
