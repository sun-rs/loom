import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import {
  inspectAgentMemoryIndex,
  RAFT_MEMORY_INDEX_THRESHOLD_BYTES,
} from "./agent-memory-workspace.ts";

export const RAFT_MEMORY_CLEANER_APP_ID = "system.cleaner";
export const RAFT_MEMORY_CLEANER_NOTIFICATION_CLASS = "memory_size_hint";
export const RAFT_MEMORY_CLEANER_DEFAULT_INTERVAL_MS = 60 * 60 * 1_000;
export const RAFT_MEMORY_CLEANER_MINIMUM_INTERVAL_MS = 15 * 60 * 1_000;
export const RAFT_MEMORY_CLEANER_MAXIMUM_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;
export const RAFT_MEMORY_CLEANER_MINIMUM_THRESHOLD_BYTES = 4_096;
export const RAFT_MEMORY_CLEANER_MAXIMUM_THRESHOLD_BYTES = 1_073_741_824;

export type AgentMemoryCleanerConfig = Readonly<{
  enabled: boolean;
  intervalMs: number;
  memoryIndexPath: string;
  ownerParticipantId: string;
  revision: number;
  thresholdBytes: number;
}>;

export type AgentMemorySizeHint = Readonly<{
  appId: typeof RAFT_MEMORY_CLEANER_APP_ID;
  createdAtMs: number;
  itemId: string;
  notificationClass: typeof RAFT_MEMORY_CLEANER_NOTIFICATION_CLASS;
  retention: "transient";
  source: "app";
  sourceRef: Readonly<{
    id: string;
    kind: "memory_hint";
  }>;
  suggestedThresholdBytes: number;
  summary: string;
  title: string;
}>;

export type AgentMemoryCleanerApplyResult =
  | Readonly<{ activeSchedules: number; kind: "applied" }>
  | Readonly<{ currentRevision: number; kind: "stale" }>;

export type AgentMemoryCleanerRunResult =
  | Readonly<{ kind: "disabled" | "not_established" | "under_threshold" }>
  | Readonly<{ hint: AgentMemorySizeHint; kind: "over_threshold" }>;

type CleanerTimer = ReturnType<typeof setTimeout>;

export type AgentMemoryCleanerClock = Readonly<{
  cancel(timer: CleanerTimer): void;
  now(): number;
  schedule(callback: () => void, delayMs: number): CleanerTimer;
}>;

type CleanerState = {
  config: AgentMemoryCleanerConfig;
  measurementToken?: symbol;
  timer: CleanerTimer | null;
  timerToken: symbol | null;
};

const systemClock: AgentMemoryCleanerClock = {
  cancel: (timer) => clearTimeout(timer),
  now: () => Date.now(),
  schedule: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    timer.unref?.();
    return timer;
  },
};

/**
 * Per-Agent typed App Inbox for Raft's transient memory-size notification.
 * It deliberately cannot carry Room message/sender/cursor fields.
 *
 * Structured port of Raft Computer 1.0.18 `createAgentAppInboxStore` and
 * `createSystemCleanerNotificationClassDefinition`, frozen in the authorized
 * memory cleaner slices documented by the source extraction ledger.
 */
export class AgentMemoryHintInbox {
  readonly #items = new Map<string, AgentMemorySizeHint>();
  readonly #versions = new Map<string, number>();
  #nextVersion = 0;
  readonly #now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? (() => Date.now());
  }

  acknowledge(
    ownerParticipantId: string,
    itemId: string,
    version?: number,
  ): boolean {
    const owner = requireOwnerParticipantId(ownerParticipantId);
    const item = this.#items.get(owner);
    if (
      item?.itemId !== itemId ||
      (version !== undefined && this.#versions.get(owner) !== version)
    )
      return false;
    this.#items.delete(owner);
    this.#versions.delete(owner);
    return true;
  }

  drop(ownerParticipantId: string): boolean {
    const owner = requireOwnerParticipantId(ownerParticipantId);
    this.#versions.delete(owner);
    return this.#items.delete(owner);
  }

  snapshot(
    ownerParticipantId: string,
  ): Array<AgentMemorySizeHint & { version: number }> {
    const owner = requireOwnerParticipantId(ownerParticipantId);
    return this.list(owner).map((item) => ({
      ...item,
      version: this.#versions.get(owner)!,
    }));
  }

  list(ownerParticipantId: string): AgentMemorySizeHint[] {
    const item = this.#items.get(requireOwnerParticipantId(ownerParticipantId));
    return item === undefined ? [] : [structuredClone(item)];
  }

  upsert(input: {
    ownerParticipantId: string;
    suggestedThresholdBytes: number;
    summary: string;
    title: string;
  }): AgentMemorySizeHint {
    const owner = requireOwnerParticipantId(input.ownerParticipantId);
    const title = requireSingleLinePreview(input.title, "title");
    const summary = requireSingleLinePreview(input.summary, "summary");
    const suggestedThresholdBytes = requireThreshold(
      input.suggestedThresholdBytes,
    );
    const existing = this.#items.get(owner);
    const sourceRef = Object.freeze({
      id: owner,
      kind: "memory_hint" as const,
    });
    const item = Object.freeze({
      appId: RAFT_MEMORY_CLEANER_APP_ID,
      createdAtMs: existing?.createdAtMs ?? this.#now(),
      itemId: existing?.itemId ?? deriveStableMemoryHintId(owner),
      notificationClass: RAFT_MEMORY_CLEANER_NOTIFICATION_CLASS,
      retention: "transient" as const,
      source: "app" as const,
      sourceRef,
      suggestedThresholdBytes,
      summary,
      title,
    });
    if (JSON.stringify(existing) !== JSON.stringify(item)) {
      this.#versions.set(owner, ++this.#nextVersion);
    }
    this.#items.set(owner, item);
    return structuredClone(item);
  }
}

/**
 * Raft-compatible periodic MEMORY.md size cleaner. It measures and presents a
 * typed transient hint; it never summarizes, rewrites, truncates or vectorizes
 * Agent memory on the Agent's behalf.
 *
 * The wake callback is intentionally capability-injected. Local and remote
 * Computer hosts must decide how an App Inbox notice reaches an existing or
 * restarted Runtime without fabricating a Room Message.
 */
export class AgentMemoryCleanerRuntime {
  readonly #clock: AgentMemoryCleanerClock;
  readonly #inbox: AgentMemoryHintInbox;
  readonly #inspectIndex: typeof inspectAgentMemoryIndex;
  readonly #pendingRuns = new Set<Promise<unknown>>();
  readonly #pendingWakes = new Map<string, AbortController>();
  readonly #states = new Map<string, CleanerState>();
  readonly #wake: (
    ownerParticipantId: string,
    item: AgentMemorySizeHint,
    signal: AbortSignal,
  ) => Promise<boolean> | boolean;
  #closed = false;

  constructor(options: {
    clock?: AgentMemoryCleanerClock;
    inbox?: AgentMemoryHintInbox;
    inspectIndex?: typeof inspectAgentMemoryIndex;
    wake: (
      ownerParticipantId: string,
      item: AgentMemorySizeHint,
      signal: AbortSignal,
    ) => Promise<boolean> | boolean;
  }) {
    this.#clock = options.clock ?? systemClock;
    this.#inspectIndex = options.inspectIndex ?? inspectAgentMemoryIndex;
    this.#inbox =
      options.inbox ??
      new AgentMemoryHintInbox({ now: () => this.#clock.now() });
    this.#wake = options.wake;
  }

  applyConfig(raw: AgentMemoryCleanerConfig): AgentMemoryCleanerApplyResult {
    this.#assertOpen();
    const config = validateConfig(raw);
    const existing = this.#states.get(config.ownerParticipantId);
    if (existing !== undefined && existing.config.revision > config.revision) {
      return Object.freeze({
        currentRevision: existing.config.revision,
        kind: "stale",
      });
    }
    if (
      existing !== undefined &&
      existing.config.revision === config.revision
    ) {
      if (!sameConfig(existing.config, config)) {
        throw new Error("Agent memory cleaner revision conflicts with content");
      }
      return Object.freeze({
        currentRevision: existing.config.revision,
        kind: "stale",
      });
    }

    this.#cancelTimer(existing);
    this.#pendingWakes.get(config.ownerParticipantId)?.abort();
    this.#inbox.drop(config.ownerParticipantId);
    const state: CleanerState = { config, timer: null, timerToken: null };
    this.#states.set(config.ownerParticipantId, state);
    if (config.enabled) this.#arm(state);
    return Object.freeze({
      activeSchedules: state.timer === null ? 0 : 1,
      kind: "applied",
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const state of this.#states.values()) {
      this.#cancelTimer(state);
      this.#inbox.drop(state.config.ownerParticipantId);
    }
    for (const controller of this.#pendingWakes.values()) controller.abort();
    this.#states.clear();
    await this.waitForIdle();
  }

  getAppliedConfig(
    ownerParticipantId: string,
  ): AgentMemoryCleanerConfig | null {
    const config = this.#states.get(
      requireOwnerParticipantId(ownerParticipantId),
    )?.config;
    return config === undefined ? null : structuredClone(config);
  }

  listHints(ownerParticipantId: string): AgentMemorySizeHint[] {
    return this.#inbox.list(ownerParticipantId);
  }

  /** Raft check semantics: a non-draining snapshot, without source mutation. */
  async checkInbox(ownerParticipantId: string) {
    this.#assertOpen();
    return { items: this.#inbox.snapshot(ownerParticipantId) };
  }

  /** Explicit RAH source verification, separate from upstream's read-only check. */
  async recheckInbox(ownerParticipantId: string) {
    const result = await this.runNow(ownerParticipantId, { wake: false });
    return {
      measurement: result.kind,
      items: this.#inbox.snapshot(ownerParticipantId),
    };
  }

  /** Explicit notification acknowledgement is not proof of model work. The
   * version is RAH safety glue: an old ack cannot erase a re-created stable ID.
   */
  acknowledgeHint(ownerParticipantId: string, itemId: string, version: number) {
    this.#assertOpen();
    const owner = requireOwnerParticipantId(ownerParticipantId);
    const acknowledged =
      Number.isSafeInteger(version) &&
      version > 0 &&
      this.#inbox.acknowledge(owner, itemId, version);
    if (acknowledged) {
      const state = this.#states.get(owner);
      if (state !== undefined) state.measurementToken = Symbol("acknowledged");
      this.#pendingWakes.get(owner)?.abort();
    }
    return {
      acknowledged,
      proofScope: "notification_acknowledged_not_memory_cleaned" as const,
    };
  }

  removeConfig(ownerParticipantId: string): boolean {
    this.#assertOpen();
    const owner = requireOwnerParticipantId(ownerParticipantId);
    const state = this.#states.get(owner);
    if (state === undefined) return false;
    this.#cancelTimer(state);
    this.#states.delete(owner);
    this.#pendingWakes.get(owner)?.abort();
    this.#inbox.drop(owner);
    return true;
  }

  async runNow(
    ownerParticipantId: string,
    options: { wake?: boolean } = {},
  ): Promise<AgentMemoryCleanerRunResult> {
    this.#assertOpen();
    const owner = requireOwnerParticipantId(ownerParticipantId);
    const state = this.#states.get(owner);
    if (state === undefined) {
      throw new Error(`Agent memory cleaner has no config for ${owner}`);
    }
    const run = this.#inspectAndPresent(state, options.wake ?? true);
    this.#pendingRuns.add(run);
    try {
      return await run;
    } finally {
      this.#pendingRuns.delete(run);
    }
  }

  async waitForIdle(): Promise<void> {
    while (this.#pendingRuns.size > 0) {
      await Promise.all([...this.#pendingRuns]);
    }
  }

  #arm(state: CleanerState): void {
    const token = Symbol("memory-cleaner-period");
    state.timerToken = token;
    state.timer = this.#clock.schedule(() => {
      const run = this.#runPeriod(state.config.ownerParticipantId, token).then(
        () => undefined,
        () => undefined,
      );
      this.#pendingRuns.add(run);
      void run.finally(() => this.#pendingRuns.delete(run));
    }, state.config.intervalMs);
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Agent memory cleaner is closed");
  }

  #cancelTimer(state: CleanerState | undefined): void {
    if (state?.timer !== null && state?.timer !== undefined) {
      this.#clock.cancel(state.timer);
    }
    if (state !== undefined) {
      state.timer = null;
      state.timerToken = null;
    }
  }

  async #inspectAndPresent(
    state: CleanerState,
    wake = true,
  ): Promise<AgentMemoryCleanerRunResult> {
    const config = state.config;
    const measurementToken = Symbol("memory-measurement");
    state.measurementToken = measurementToken;
    const isCurrent = () =>
      !this.#closed &&
      this.#states.get(config.ownerParticipantId) === state &&
      state.measurementToken === measurementToken;
    if (!config.enabled) {
      this.#inbox.drop(config.ownerParticipantId);
      return Object.freeze({ kind: "disabled" });
    }
    let inspection;
    try {
      inspection = await this.#measureWithTimeout(config);
    } catch {
      if (isCurrent()) {
        this.#inbox.drop(config.ownerParticipantId);
      }
      return Object.freeze({ kind: "not_established" });
    }
    if (!isCurrent()) {
      return Object.freeze({ kind: "not_established" });
    }
    if (inspection.kind === "within_threshold") {
      this.#pendingWakes.get(config.ownerParticipantId)?.abort();
      this.#inbox.drop(config.ownerParticipantId);
      return Object.freeze({ kind: "under_threshold" });
    }

    const suggestedThresholdBytes = deriveNextThreshold(config.thresholdBytes);
    const actionCopy =
      suggestedThresholdBytes === config.thresholdBytes
        ? "Already at maximum; you can set it lower"
        : suggestedThresholdBytes === config.thresholdBytes * 2
          ? "Action doubles threshold (or set lower)"
          : "Action raises to maximum (or set lower)";
    const configCommand = `"$RAH_AGENT_INBOX_CLI" app config --app system.cleaner${suggestedThresholdBytes === config.thresholdBytes ? "" : ` --set threshold_bytes=${String(suggestedThresholdBytes)}`}`;
    const hint = this.#inbox.upsert({
      ownerParticipantId: config.ownerParticipantId,
      suggestedThresholdBytes,
      summary: `${inspection.summary} ${actionCopy}: ${configCommand}; recheck in ${formatInterval(config.intervalMs)}.`,
      title: inspection.title,
    });
    if (wake) this.#dispatchWake(state, hint);
    return Object.freeze({ hint, kind: "over_threshold" });
  }

  async #runPeriod(ownerParticipantId: string, token: symbol): Promise<void> {
    const state = this.#states.get(ownerParticipantId);
    if (this.#closed || state === undefined || state.timerToken !== token) {
      return;
    }
    state.timer = null;
    state.timerToken = null;
    if (state.config.enabled) this.#arm(state);
    await this.#inspectAndPresent(state);
  }

  #dispatchWake(state: CleanerState, hint: AgentMemorySizeHint): void {
    const owner = state.config.ownerParticipantId;
    if (this.#pendingWakes.has(owner)) return;
    const controller = new AbortController();
    this.#pendingWakes.set(owner, controller);
    // Wake is admission of a content-free notice, never completion of model
    // maintenance. A slow/unavailable receiver must not block Room work or
    // shutdown. Keep the owner occupied until it settles, even after timeout,
    // so an uncooperative receiver cannot cause parallel maintenance calls.
    const timer = setTimeout(() => controller.abort(), 5_000);
    timer.unref?.();
    void Promise.resolve()
      .then(async () => {
        if (
          controller.signal.aborted ||
          this.#closed ||
          this.#states.get(owner) !== state
        )
          return;
        await this.#wake(owner, hint, controller.signal);
      })
      .catch(() => {
        // The source-derived hint remains pending for the next check/Activation.
      })
      .finally(() => {
        clearTimeout(timer);
        this.#pendingWakes.delete(owner);
      });
  }

  /** Structured port of Raft 1.0.18 measureWithTimeout (10s default).
   * Timeout means unknown, never that an oversized index has been cleaned.
   */
  #measureWithTimeout(
    config: AgentMemoryCleanerConfig,
  ): ReturnType<typeof inspectAgentMemoryIndex> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = this.#clock.schedule(() => {
        if (settled) return;
        settled = true;
        reject(new Error("Agent memory measurement timed out"));
      }, 10_000);
      const finish = (
        result: Awaited<ReturnType<typeof inspectAgentMemoryIndex>> | Error,
      ) => {
        if (settled) return;
        settled = true;
        this.#clock.cancel(timer);
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      void Promise.resolve()
        .then(() =>
          this.#inspectIndex(config.memoryIndexPath, config.thresholdBytes),
        )
        .then(finish, () =>
          finish(new Error("Agent memory measurement failed")),
        );
    });
  }
}

function validateConfig(
  raw: AgentMemoryCleanerConfig,
): AgentMemoryCleanerConfig {
  const ownerParticipantId = requireOwnerParticipantId(raw.ownerParticipantId);
  if (!isAbsolute(raw.memoryIndexPath)) {
    throw new Error("Agent memory cleaner index path must be absolute");
  }
  if (
    !Number.isSafeInteger(raw.intervalMs) ||
    raw.intervalMs < RAFT_MEMORY_CLEANER_MINIMUM_INTERVAL_MS ||
    raw.intervalMs > RAFT_MEMORY_CLEANER_MAXIMUM_INTERVAL_MS
  ) {
    throw new Error("Agent memory cleaner interval is outside Raft bounds");
  }
  if (!Number.isSafeInteger(raw.revision) || raw.revision < 0) {
    throw new Error("Agent memory cleaner revision is invalid");
  }
  return Object.freeze({
    enabled: raw.enabled,
    intervalMs: raw.intervalMs,
    memoryIndexPath: resolve(raw.memoryIndexPath),
    ownerParticipantId,
    revision: raw.revision,
    thresholdBytes: requireThreshold(raw.thresholdBytes),
  });
}

function requireThreshold(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < RAFT_MEMORY_CLEANER_MINIMUM_THRESHOLD_BYTES ||
    value > RAFT_MEMORY_CLEANER_MAXIMUM_THRESHOLD_BYTES
  ) {
    throw new Error("Agent memory cleaner threshold is outside Raft bounds");
  }
  return value;
}

function requireOwnerParticipantId(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    /[\\/\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error("Agent memory cleaner owner participant is invalid");
  }
  return value;
}

function requireSingleLinePreview(value: string, name: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`Agent memory cleaner ${name} is invalid`);
  }
  return value;
}

function deriveStableMemoryHintId(ownerParticipantId: string): string {
  const digest = createHash("sha256")
    .update("agent-app-inbox-v1\0")
    .update(RAFT_MEMORY_CLEANER_APP_ID)
    .update("\0")
    .update(RAFT_MEMORY_CLEANER_NOTIFICATION_CLASS)
    .update("\0memory_hint\0")
    .update(ownerParticipantId)
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function deriveNextThreshold(thresholdBytes: number): number {
  return Math.min(
    thresholdBytes * 2,
    RAFT_MEMORY_CLEANER_MAXIMUM_THRESHOLD_BYTES,
  );
}

function formatInterval(intervalMs: number): string {
  if (intervalMs % (7 * 24 * 60 * 60 * 1_000) === 0) {
    return `${String(intervalMs / (7 * 24 * 60 * 60 * 1_000))}w`;
  }
  if (intervalMs % (24 * 60 * 60 * 1_000) === 0) {
    return `${String(intervalMs / (24 * 60 * 60 * 1_000))}d`;
  }
  if (intervalMs % (60 * 60 * 1_000) === 0) {
    return `${String(intervalMs / (60 * 60 * 1_000))}h`;
  }
  if (intervalMs % (60 * 1_000) === 0) {
    return `${String(intervalMs / (60 * 1_000))}m`;
  }
  return `${String(Math.ceil(intervalMs / 1_000))}s`;
}

function sameConfig(
  left: AgentMemoryCleanerConfig,
  right: AgentMemoryCleanerConfig,
): boolean {
  return (
    left.enabled === right.enabled &&
    left.intervalMs === right.intervalMs &&
    left.memoryIndexPath === right.memoryIndexPath &&
    left.ownerParticipantId === right.ownerParticipantId &&
    left.revision === right.revision &&
    left.thresholdBytes === right.thresholdBytes
  );
}

export const RAFT_MEMORY_CLEANER_DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  intervalMs: RAFT_MEMORY_CLEANER_DEFAULT_INTERVAL_MS,
  thresholdBytes: RAFT_MEMORY_INDEX_THRESHOLD_BYTES,
});
