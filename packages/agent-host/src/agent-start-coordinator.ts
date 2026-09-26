/**
 * Agent start scheduling, ported from upstream Raft's `AgentStartCoordinator`
 * and its `pumpAgentStartQueue` loop.
 *
 * Upstream bounds how many Agents may be *starting* at once — not how many may
 * be *running* — with two knobs: `maxConcurrentStarts` (default 5) and
 * `minStartIntervalMs` (default 500). Agents that arrive while the gate is full
 * queue, and a timer pumps the queue. Per-Agent single flight is an invariant:
 * one Agent may never be queued twice, nor queued while starting.
 *
 * `AgentStartCoordinator` below is the state machine, kept in upstream's shape
 * (same fields, same method names, same invariant assertions). `AgentStartGate`
 * is the pump — upstream keeps it on the daemon object; RAH keeps it beside the
 * state machine because RAH's call site awaits a promise instead of firing a
 * callback.
 */

export const DEFAULT_MAX_CONCURRENT_AGENT_STARTS = 5;
export const DEFAULT_AGENT_START_INTERVAL_MS = 500;

export type QueuedAgentStart = {
  agentId: string;
  enqueuedAtMs: number;
  reject: (error: unknown) => void;
  resolve: () => void;
};

export type AgentStartPumpState =
  | {
      kind: "blocked";
      reason: "capacity_full" | "queue_empty" | "timer_active";
    }
  | { item: QueuedAgentStart; kind: "rate_limited"; waitMs: number }
  | { item: QueuedAgentStart; kind: "ready" };

export type AgentStartDequeueResult =
  | { kind: "empty" }
  | { item: QueuedAgentStart; kind: "item" }
  | { item: QueuedAgentStart; kind: "stale" };

export type AgentStartSnapshot = {
  activeStarts: number;
  maxConcurrentStarts: number;
  minStartIntervalMs: number;
  pumpTimerActive: boolean;
  queueDepth: number;
  queuedAgentIds: string[];
  startingAgentIds: string[];
};

export class AgentStartCoordinator {
  readonly starting = new Set<string>();
  readonly queuedByAgent = new Map<string, QueuedAgentStart>();
  queue: QueuedAgentStart[] = [];
  activeStarts = 0;
  pumpTimer: ReturnType<typeof setTimeout> | null = null;
  lastStartAt = 0;
  lastStartAgentId: string | null = null;
  maxConcurrentStarts: number;
  minStartIntervalMs: number;

  constructor(options: {
    maxConcurrentStarts: number;
    minStartIntervalMs: number;
  }) {
    this.maxConcurrentStarts = Math.max(
      1,
      Math.floor(options.maxConcurrentStarts),
    );
    this.minStartIntervalMs = Math.max(
      0,
      Math.floor(options.minStartIntervalMs),
    );
    this.assertInvariants("constructor");
  }

  snapshot(): AgentStartSnapshot {
    return {
      activeStarts: this.activeStarts,
      maxConcurrentStarts: this.maxConcurrentStarts,
      minStartIntervalMs: this.minStartIntervalMs,
      pumpTimerActive: this.pumpTimer !== null,
      queueDepth: this.queue.length,
      queuedAgentIds: [...this.queuedByAgent.keys()],
      startingAgentIds: [...this.starting],
    };
  }

  hasStarting(agentId: string): boolean {
    return this.starting.has(agentId);
  }

  hasQueued(agentId: string): boolean {
    return this.queuedByAgent.has(agentId);
  }

  getQueued(agentId: string): QueuedAgentStart | undefined {
    return this.queuedByAgent.get(agentId);
  }

  queueAgeMs(agentId: string, now: number): number {
    const item = this.queuedByAgent.get(agentId);
    return item ? Math.max(0, now - item.enqueuedAtMs) : 0;
  }

  enqueue(item: QueuedAgentStart): void {
    if (this.starting.has(item.agentId)) {
      throw new Error(
        `Agent start invariant violation after enqueue: ${item.agentId} is already starting`,
      );
    }
    if (this.queuedByAgent.has(item.agentId)) {
      throw new Error(
        `Agent start invariant violation after enqueue: ${item.agentId} is already queued`,
      );
    }
    this.queue.push(item);
    this.queuedByAgent.set(item.agentId, item);
    this.assertInvariants("enqueue");
  }

  markStarting(agentId: string): void {
    if (this.queuedByAgent.has(agentId)) {
      throw new Error(
        `Agent start invariant violation after markStarting: ${agentId} is still queued`,
      );
    }
    this.starting.add(agentId);
    this.assertInvariants("markStarting");
  }

  clearStarting(agentId: string): void {
    this.starting.delete(agentId);
    this.assertInvariants("clearStarting");
  }

  getPumpState(now: number = Date.now()): AgentStartPumpState {
    if (this.pumpTimer) return { kind: "blocked", reason: "timer_active" };
    if (this.queue.length === 0)
      return { kind: "blocked", reason: "queue_empty" };
    if (this.activeStarts >= this.maxConcurrentStarts) {
      return { kind: "blocked", reason: "capacity_full" };
    }
    const item = this.queue[0];
    if (!item) return { kind: "blocked", reason: "queue_empty" };
    const shouldRateLimit = item.agentId !== this.lastStartAgentId;
    const elapsed = now - this.lastStartAt;
    const waitMs = shouldRateLimit
      ? Math.max(0, this.minStartIntervalMs - elapsed)
      : 0;
    if (waitMs > 0) return { item, kind: "rate_limited", waitMs };
    return { item, kind: "ready" };
  }

  schedulePump(waitMs: number, callback: () => void): void {
    if (this.pumpTimer) return;
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = null;
      callback();
    }, waitMs);
    this.assertInvariants("schedulePump");
  }

  dequeue(): AgentStartDequeueResult {
    const item = this.queue.shift();
    if (!item) {
      this.assertInvariants("dequeue empty");
      return { kind: "empty" };
    }
    if (this.queuedByAgent.get(item.agentId) !== item) {
      this.assertInvariants("dequeue stale");
      return { item, kind: "stale" };
    }
    this.queuedByAgent.delete(item.agentId);
    this.assertInvariants("dequeue");
    return { item, kind: "item" };
  }

  claimStartSlot(agentId: string, now: number = Date.now()): void {
    this.activeStarts += 1;
    this.lastStartAt = now;
    this.lastStartAgentId = agentId;
    this.assertInvariants("claimStartSlot");
  }

  releaseStartSlot(): boolean {
    if (this.activeStarts <= 0) return false;
    this.activeStarts = Math.max(0, this.activeStarts - 1);
    this.assertInvariants("releaseStartSlot");
    return true;
  }

  cancelQueued(agentId: string): QueuedAgentStart | undefined {
    const item = this.queuedByAgent.get(agentId);
    if (!item) return undefined;
    this.queuedByAgent.delete(agentId);
    this.queue = this.queue.filter((candidate) => candidate !== item);
    this.clearPumpTimerIfIdle();
    this.assertInvariants("cancelQueued");
    return item;
  }

  cancelAllQueued(
    onCancel?: (item: QueuedAgentStart) => void,
  ): QueuedAgentStart[] {
    const items: QueuedAgentStart[] = [];
    for (const item of this.queue) {
      if (this.queuedByAgent.get(item.agentId) === item) {
        items.push(item);
        onCancel?.(item);
      }
    }
    this.queue = [];
    this.queuedByAgent.clear();
    this.clearPumpTimer();
    this.assertInvariants("cancelAllQueued");
    return items;
  }

  assertInvariants(context: string): void {
    if (this.activeStarts < 0) {
      throw new Error(
        `Agent start invariant violation after ${context}: activeStarts is negative`,
      );
    }
    // Only a claim can break the cap: a runtime reduction may leave already
    // admitted starts above the new value until they finish (see
    // `AgentStartGate.updateSettings`), while `getPumpState` admits nothing new.
    if (
      context === "claimStartSlot" &&
      this.activeStarts > this.maxConcurrentStarts
    ) {
      throw new Error(
        `Agent start invariant violation after ${context}: activeStarts exceeds maxConcurrentStarts`,
      );
    }
    const queuedIds = new Set<string>();
    for (const item of this.queue) {
      if (queuedIds.has(item.agentId)) {
        throw new Error(
          `Agent start invariant violation after ${context}: duplicate queued agent ${item.agentId}`,
        );
      }
      queuedIds.add(item.agentId);
      if (this.queuedByAgent.get(item.agentId) !== item) {
        throw new Error(
          `Agent start invariant violation after ${context}: queue/map mismatch for ${item.agentId}`,
        );
      }
      if (this.starting.has(item.agentId)) {
        throw new Error(
          `Agent start invariant violation after ${context}: ${item.agentId} is queued and starting`,
        );
      }
    }
    if (queuedIds.size !== this.queuedByAgent.size) {
      throw new Error(
        `Agent start invariant violation after ${context}: queue/map size mismatch`,
      );
    }
    for (const [agentId, item] of this.queuedByAgent) {
      if (!queuedIds.has(agentId)) {
        throw new Error(
          `Agent start invariant violation after ${context}: map-only queued agent ${agentId}`,
        );
      }
      if (item.agentId !== agentId) {
        throw new Error(
          `Agent start invariant violation after ${context}: map key/item agent mismatch for ${agentId}`,
        );
      }
    }
  }

  clearPumpTimerIfIdle(): void {
    if (this.queue.length === 0) this.clearPumpTimer();
  }

  clearPumpTimer(): void {
    if (this.pumpTimer) {
      clearTimeout(this.pumpTimer);
      this.pumpTimer = null;
    }
  }
}

export type AgentStartSchedulerSettings = {
  maxConcurrentStarts: number;
  minStartIntervalMs: number;
};

function readIntegerEnv(
  environment: Record<string, string | undefined>,
  name: string,
  fallback: number,
  minimum: number,
): number {
  const raw = environment[name];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) return fallback;
  return parsed;
}

/**
 * Upstream reads `SLOCK_DAEMON_MAX_CONCURRENT_AGENT_STARTS` and
 * `SLOCK_DAEMON_AGENT_START_INTERVAL_MS` when the runtime start scheduler is
 * not configured explicitly; RAH keeps the same precedence under its own
 * prefix.
 */
export function resolveAgentStartSchedulerSettings(
  configured: Partial<AgentStartSchedulerSettings> | undefined,
  environment: Record<string, string | undefined> = process.env,
): AgentStartSchedulerSettings {
  return {
    maxConcurrentStarts:
      configured?.maxConcurrentStarts ??
      readIntegerEnv(
        environment,
        "RAH_DAEMON_MAX_CONCURRENT_AGENT_STARTS",
        DEFAULT_MAX_CONCURRENT_AGENT_STARTS,
        1,
      ),
    minStartIntervalMs:
      configured?.minStartIntervalMs ??
      readIntegerEnv(
        environment,
        "RAH_DAEMON_AGENT_START_INTERVAL_MS",
        DEFAULT_AGENT_START_INTERVAL_MS,
        0,
      ),
  };
}

export class AgentStartGate {
  readonly coordinator: AgentStartCoordinator;
  readonly #now: () => number;

  constructor(
    options: Partial<AgentStartSchedulerSettings> & { now?: () => number } = {},
  ) {
    const settings = resolveAgentStartSchedulerSettings(options);
    this.coordinator = new AgentStartCoordinator(settings);
    this.#now = options.now ?? (() => Date.now());
  }

  snapshot(): AgentStartSnapshot {
    return this.coordinator.snapshot();
  }

  /**
   * Runtime settings change (daemon concurrency settings). Applies to the next
   * admission: raising the cap admits queued starts now; lowering it never
   * interrupts starts already admitted.
   */
  updateSettings(settings: Partial<AgentStartSchedulerSettings>): void {
    const { maxConcurrentStarts, minStartIntervalMs } = settings;
    if (
      maxConcurrentStarts !== undefined &&
      (!Number.isSafeInteger(maxConcurrentStarts) || maxConcurrentStarts < 1)
    )
      throw new Error("maxConcurrentStarts must be a positive integer");
    if (
      minStartIntervalMs !== undefined &&
      (!Number.isSafeInteger(minStartIntervalMs) || minStartIntervalMs < 0)
    )
      throw new Error("minStartIntervalMs must be a non-negative integer");
    if (maxConcurrentStarts !== undefined)
      this.coordinator.maxConcurrentStarts = maxConcurrentStarts;
    if (minStartIntervalMs !== undefined)
      this.coordinator.minStartIntervalMs = minStartIntervalMs;
    // One pump admits one start; a raised cap may free several slots at once.
    for (let guard = this.coordinator.queue.length; guard >= 0; guard -= 1) {
      const kind = this.coordinator.getPumpState(this.#now()).kind;
      if (kind !== "blocked") this.pump();
      if (kind !== "ready") break;
    }
  }

  /**
   * Hold `start` behind the gate: queue this Agent, wait for a start slot, run
   * the start, then release the slot. The slot is released once the start has
   * been attempted — upstream releases it on "spawn attempted" too, because the
   * knob bounds concurrent *starts*, never concurrent *runs*.
   *
   * Aborting `signal` while the Agent is still queued removes exactly that
   * queued item and rejects with the abort reason; `start` never runs. Once a
   * slot was granted the signal has no effect.
   */
  async runStart<T>(
    agentId: string,
    start: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    await this.#waitForStartSlot(agentId, signal);
    this.coordinator.markStarting(agentId);
    try {
      return await start();
    } finally {
      this.coordinator.clearStarting(agentId);
      if (this.coordinator.releaseStartSlot()) this.pump();
    }
  }

  cancelAll(reason: string): void {
    this.coordinator.cancelAllQueued((item) => {
      item.reject(new Error(reason));
    });
  }

  pump(): void {
    const pumpState = this.coordinator.getPumpState(this.#now());
    if (pumpState.kind === "blocked") return;
    if (pumpState.kind === "rate_limited") {
      this.coordinator.schedulePump(pumpState.waitMs, () => {
        this.pump();
      });
      return;
    }
    const dequeued = this.coordinator.dequeue();
    if (dequeued.kind === "empty") return;
    if (dequeued.kind === "stale") {
      this.pump();
      return;
    }
    const { item } = dequeued;
    if (this.coordinator.hasStarting(item.agentId)) {
      item.reject(
        new Error(
          `Agent start invariant violation after dequeue: ${item.agentId} is already starting`,
        ),
      );
      this.pump();
      return;
    }
    this.coordinator.claimStartSlot(item.agentId, this.#now());
    item.resolve();
  }

  #waitForStartSlot(agentId: string, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortReason(signal));
        return;
      }
      const onAbort = () => {
        if (this.coordinator.getQueued(agentId) !== item) return;
        this.coordinator.cancelQueued(agentId);
        reject(abortReason(signal!));
      };
      const item: QueuedAgentStart = {
        agentId,
        enqueuedAtMs: this.#now(),
        reject: (error) => {
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
        resolve: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
      };
      this.coordinator.enqueue(item);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pump();
    });
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("queued Agent start was aborted");
}
