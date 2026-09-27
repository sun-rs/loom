import type { AuthenticatedHostContext, RoomKernel } from "@rah-os/kernel";
import type { PlacementDecision } from "@rah-os/protocol";

import type { AgentStartGate } from "./agent-start-coordinator.ts";
import type { InstanceRuntimePool } from "./instance-runtime-pool.ts";
import type { ActivationEnvelope, RuntimeAdapter } from "./runtime.ts";

/**
 * Owner 2026-09-27 (contract §6a): the Host starts a Role instance's warm
 * runtime when the instance is created (Kernel `instance.runtime` hint) and,
 * after a daemon start, for recently active instances — instead of at the
 * instance's first message. Prewarming is the first turn's own cold start
 * (Kernel read-only prewarm plan → the placement's runtime adapter → the
 * shared warm pool) stopped at the driver's readiness handshake: no turn, no
 * model call, no RunAttempt. It passes the shared start gate, never evicts a
 * live runtime and never counts as a run; everything after readiness (idle
 * TTL, LRU, recycling, janitor, reset restart) is the pool's existing rules.
 * Per-turn runtimes (Kimi, default Claude) have no warm process to prewarm.
 */
export type InstancePrewarmSettings = {
  enabled: boolean;
  /** Daemon start: instances with a RunAttempt this recently are prewarmed. */
  recentActiveWindowMs: number;
};

export const DEFAULT_INSTANCE_PREWARM_SETTINGS: Readonly<InstancePrewarmSettings> =
  Object.freeze({ enabled: true, recentActiveWindowMs: 24 * 3_600_000 });

export type InstancePrewarmOutcome =
  | { kind: "started"; participantId: string; instanceRuntimeId: string }
  | { kind: "skipped"; participantId: string; reason: string };

export type InstancePrewarmerOptions = {
  /**
   * Full review 2 batch 1 #2: the Host's start admission (leftover cleanup
   * hygiene) that real execution passes; checked after the start gate and
   * before any spawn. Blocked or failing: the prewarm is skipped.
   */
  admit?: (
    participantId: string,
  ) => Promise<{ blocked: false } | { blocked: true; reason: string }>;
  host: AuthenticatedHostContext;
  kernel: Pick<RoomKernel, "instancePrewarm">;
  /** The warm pool (retire); starts go through the resolved adapter. */
  pool: Pick<InstanceRuntimePool, "retire">;
  /** The Host's placement resolver (the same adapter a claimed turn gets). */
  resolveRuntime: (placement: PlacementDecision) => RuntimeAdapter;
  /** The Host's shared start-rate gate; prewarms take their own slots. */
  startGate?: AgentStartGate;
  settings?: Partial<InstancePrewarmSettings>;
  /** Accept prewarms at once (default); a Host opens it after its janitor. */
  open?: boolean;
  now?: () => number;
  onDiagnostic?: (message: string) => void;
};

export class InstancePrewarmer {
  readonly #options: InstancePrewarmerOptions;
  readonly #now: () => number;
  #settings: InstancePrewarmSettings;
  /** One prewarm at a time: the caps are checked and taken atomically. */
  #queue: Promise<unknown> = Promise.resolve();
  /** Closed until the Host's pool is started, and again from its stop. */
  #open: boolean;
  /** Takes prewarms still queued in the start gate out when closing. */
  #closing = new AbortController();
  /** Removed instances (ids are never reused): never prewarmed again. */
  readonly #retired = new Set<string>();

  constructor(options: InstancePrewarmerOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#settings = { ...DEFAULT_INSTANCE_PREWARM_SETTINGS };
    this.updateSettings(options.settings ?? {});
    this.#open = options.open ?? true;
  }

  /** The Host started its pool (after the start janitor). */
  open(): void {
    this.#open = true;
    if (this.#closing.signal.aborted) this.#closing = new AbortController();
  }

  /** The Host takes prewarms now (its pool started and it is not stopping). */
  get accepting(): boolean {
    return this.#open;
  }

  /**
   * The Host is stopping: no new prewarm starts, and one in flight finishes
   * (registered in the pool) before the pool stops every runtime.
   */
  async close(): Promise<void> {
    this.#open = false;
    this.#closing.abort(new Error("instance prewarming stopped"));
    await this.#queue;
  }

  get settings(): Readonly<InstancePrewarmSettings> {
    return { ...this.#settings };
  }

  /** Runtime settings change; applies to the next prewarm. */
  updateSettings(settings: Partial<InstancePrewarmSettings>): void {
    const next = { ...this.#settings, ...settings };
    if (typeof next.enabled !== "boolean")
      throw new Error("prewarm enabled must be a boolean");
    if (
      !Number.isSafeInteger(next.recentActiveWindowMs) ||
      next.recentActiveWindowMs < 0
    )
      throw new Error("recentActiveWindowMs must be a non-negative integer");
    this.#settings = next;
  }

  async prewarm(participantId: string): Promise<InstancePrewarmOutcome> {
    const run = this.#queue.then(
      async () => await this.#prewarmOne(participantId),
    );
    this.#queue = run.catch(() => undefined);
    const outcome = await run;
    this.#diagnostic(
      outcome.kind === "started"
        ? `prewarmed ${participantId} (${outcome.instanceRuntimeId})`
        : `prewarm of ${participantId} skipped: ${outcome.reason}`,
    );
    return outcome;
  }

  /** Daemon start: the Host's instances active inside the window. */
  async prewarmRecentlyActive(): Promise<InstancePrewarmOutcome[]> {
    if (!this.#settings.enabled) return [];
    let participantIds: string[];
    try {
      participantIds = this.#options.kernel.instancePrewarm.recentlyActive(
        this.#options.host,
        {
          since: new Date(
            this.#now() - this.#settings.recentActiveWindowMs,
          ).toISOString(),
        },
      );
    } catch (error) {
      this.#diagnostic(`recent instance lookup failed: ${message(error)}`);
      return [];
    }
    const outcomes: InstancePrewarmOutcome[] = [];
    for (const participantId of participantIds)
      outcomes.push(await this.prewarm(participantId));
    return outcomes;
  }

  /** The instance left its Channel: end its runtime (never mid-turn). */
  async retire(participantId: string): Promise<void> {
    // Full review 2 batch 1 #4: a prewarm of it still queued never spawns.
    this.#retired.add(participantId);
    await this.#options.pool.retire(participantId);
  }

  async #prewarmOne(participantId: string): Promise<InstancePrewarmOutcome> {
    const skipped = (reason: string): InstancePrewarmOutcome => ({
      kind: "skipped",
      participantId,
      reason,
    });
    // Cheap early skips; every check is repeated once the gate admits it.
    const early = this.#prepare(participantId);
    if (early.kind === "skipped") return skipped(early.reason);
    // Full review 2 batch 1 #2/#4/#5: after the gate the instance, the
    // Host, the cleanup admission and the caps are read again — a queued
    // prewarm may have waited behind other starts.
    const start = async (): Promise<
      | { kind: "started"; instanceRuntimeId: string }
      | { kind: "skipped"; reason: string }
    > => {
      if (this.#stopped(participantId) !== undefined)
        return { kind: "skipped", reason: this.#stopped(participantId)! };
      if (this.#options.admit !== undefined) {
        let admission: Awaited<
          ReturnType<NonNullable<InstancePrewarmerOptions["admit"]>>
        >;
        try {
          admission = await this.#options.admit(participantId);
        } catch (error) {
          admission = {
            blocked: true,
            reason: `RAH_RUNTIME_CLEANUP_BLOCKED: admission check failed: ${message(error)}`,
          };
        }
        if (admission.blocked)
          return { kind: "skipped", reason: admission.reason };
      }
      const prepared = this.#prepare(participantId);
      if (prepared.kind === "skipped") return prepared;
      // Synchronous from here to the pool's participant lock: a retire
      // arriving now finds the runtime (or this start) and ends it.
      return await prepared.start();
    };
    try {
      // A distinct gate key: a real start of this instance never collides
      // with its prewarm in the gate; the pool serializes the two.
      const outcome =
        this.#options.startGate === undefined
          ? await start()
          : await this.#options.startGate.runStart(
              `prewarm:${participantId}`,
              start,
              this.#closing.signal,
            );
      return outcome.kind === "started"
        ? {
            instanceRuntimeId: outcome.instanceRuntimeId,
            kind: "started",
            participantId,
          }
        : skipped(outcome.reason);
    } catch (error) {
      if (this.#stopped(participantId) !== undefined)
        return skipped(this.#stopped(participantId)!);
      return skipped(`start_failed: ${message(error)}`);
    }
  }

  /** Why this instance may not be prewarmed now, if it may not. */
  #stopped(participantId: string): string | undefined {
    if (!this.#open) return "host_not_running";
    if (!this.#settings.enabled) return "disabled";
    return undefined;
  }

  /** The Kernel's current plan and its adapter; nothing is started. */
  #prepare(participantId: string):
    | { kind: "skipped"; reason: string }
    | {
        kind: "ready";
        start: () => Promise<
          | { kind: "started"; instanceRuntimeId: string }
          | { kind: "skipped"; reason: string }
        >;
      } {
    const stopped = this.#stopped(participantId);
    if (stopped !== undefined) return { kind: "skipped", reason: stopped };
    const { host, kernel } = this.#options;
    let plan;
    try {
      plan = kernel.instancePrewarm.plan(host, { participantId });
    } catch (error) {
      return { kind: "skipped", reason: `plan_failed: ${message(error)}` };
    }
    if (plan.kind === "skipped") return plan;
    if (this.#retired.has(participantId))
      return { kind: "skipped", reason: "instance_retired" };
    let runtime: RuntimeAdapter;
    try {
      runtime = this.#options.resolveRuntime(plan.placement);
    } catch (error) {
      return {
        kind: "skipped",
        reason: `runtime_unavailable: ${message(error)}`,
      };
    }
    const prewarm = runtime.prewarm?.bind(runtime);
    if (prewarm === undefined)
      return { kind: "skipped", reason: "per_turn_runtime" };
    const envelope: ActivationEnvelope = {
      activationId: plan.activationId,
      agent: plan.agent,
      consumerId: `${host.hostId}:runtime`,
      contextManifest: plan.contextManifest,
      fromSeq: plan.fromSeq,
      hostId: host.hostId,
      participantId,
      reason: "manual",
      roomId: plan.roomId,
      runAttemptId: plan.runAttemptId,
      toSeq: plan.toSeq,
    };
    const limits = {
      maxLive: plan.limits.hostMaxConcurrent,
      maxLiveForDriver: plan.limits.runtimeProfileMaxConcurrent,
      reserved: plan.limits.hostReserved,
      reservedForDriver: plan.limits.runtimeProfileReserved,
    };
    return {
      kind: "ready",
      start: async () => await prewarm(envelope, limits),
    };
  }

  #diagnostic(text: string): void {
    try {
      (
        this.#options.onDiagnostic ??
        ((line: string) =>
          process.stderr.write(`[loom instance-prewarm] ${line}\n`))
      )(text);
    } catch {
      // Diagnostics never own lifecycle.
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
