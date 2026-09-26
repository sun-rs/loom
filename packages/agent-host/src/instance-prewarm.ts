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
  }

  /**
   * The Host is stopping: no new prewarm starts, and one in flight finishes
   * (registered in the pool) before the pool stops every runtime.
   */
  async close(): Promise<void> {
    this.#open = false;
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
    await this.#options.pool.retire(participantId);
  }

  async #prewarmOne(participantId: string): Promise<InstancePrewarmOutcome> {
    const skipped = (reason: string): InstancePrewarmOutcome => ({
      kind: "skipped",
      participantId,
      reason,
    });
    if (!this.#open) return skipped("host_not_running");
    if (!this.#settings.enabled) return skipped("disabled");
    const { host, kernel } = this.#options;
    let plan;
    try {
      plan = kernel.instancePrewarm.plan(host, { participantId });
    } catch (error) {
      return skipped(`plan_failed: ${message(error)}`);
    }
    if (plan.kind === "skipped") return skipped(plan.reason);
    let runtime: RuntimeAdapter;
    try {
      runtime = this.#options.resolveRuntime(plan.placement);
    } catch (error) {
      return skipped(`runtime_unavailable: ${message(error)}`);
    }
    if (runtime.prewarm === undefined) return skipped("per_turn_runtime");
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
    };
    const start = async () => await runtime.prewarm!(envelope, limits);
    try {
      // A distinct gate key: a real start of this instance never collides
      // with its prewarm in the gate; the pool serializes the two.
      const outcome =
        this.#options.startGate === undefined
          ? await start()
          : await this.#options.startGate.runStart(
              `prewarm:${participantId}`,
              start,
            );
      return outcome.kind === "started"
        ? {
            instanceRuntimeId: outcome.instanceRuntimeId,
            kind: "started",
            participantId,
          }
        : skipped(outcome.reason);
    } catch (error) {
      return skipped(`start_failed: ${message(error)}`);
    }
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
