import { randomUUID } from "node:crypto";

import type {
  RuntimeProcessCleanupTrigger,
  RuntimeResourceCap,
} from "@rah-os/protocol";

import type { AgentHostControlPort } from "./agent-host-control.ts";
import type {
  LeftoverFootprint,
  LeftoverProcessSweeper,
  LeftoverSweepResult,
} from "./leftover-process-sweeper.ts";

/**
 * S2-0 Host policy for leftover processes (S2 spec §6a). The sweeper owns
 * enumeration and signalling; the Kernel owns the durable record, admission
 * and the one-time wake notice; this class decides *when* to sweep:
 *
 * - after every run whose termination proof is persisted (run end, crash,
 *   cancellation, orphan recovery);
 * - at Host start and periodically, for tagged processes of runtimes this
 *   Host ran and the Kernel records as terminated (the janitor). Tags of
 *   unknown runtimes (another daemon, a test Host) are never touched;
 * - before admitting new work for a participant whose latest cleanup is
 *   unresolved, to clear it when the old processes are finally gone.
 *
 * Resource caps are measured while a run is busy. Exceeding one records an
 * alert that refuses new admission; it never cancels the busy run.
 */
export type RuntimeResourceCaps = {
  maxListeningPorts: number;
  maxProcesses: number;
  maxRssKb: number;
};

export const DEFAULT_RUNTIME_RESOURCE_CAPS: RuntimeResourceCaps = {
  maxListeningPorts: 16,
  maxProcesses: 128,
  maxRssKb: 8 * 1024 * 1024,
};

export type RuntimeHygieneAlert = {
  message: string;
  participantId: string;
  runAttemptId?: string;
};

type Sweeper = Pick<
  LeftoverProcessSweeper,
  "measure" | "sweep" | "taggedRuntimeIds"
>;

type CleanupControl = Pick<
  AgentHostControlPort,
  | "claimRuntimeCleanupNotice"
  | "listRuntimeCleanupBlockedParticipants"
  | "readRuntimeCleanupAdmission"
  | "recordRuntimeProcessCleanup"
  | "resolveRuntimeCleanupTargets"
>;

export type RuntimeResourceCapOverrides = {
  [Key in keyof RuntimeResourceCaps]?: RuntimeResourceCaps[Key] | undefined;
};

export type RuntimeProcessHygieneOptions = {
  capCheckIntervalMs?: number;
  caps?: RuntimeResourceCapOverrides;
  /** Per-participant (instance) overrides of `caps`. */
  capsByParticipant?: Readonly<Record<string, RuntimeResourceCapOverrides>>;
  janitorIntervalMs?: number;
  now?: () => Date;
  onAlert?: (alert: RuntimeHygieneAlert) => void;
  sweeper: Sweeper;
};

export type RunCleanupInput = {
  participantId: string;
  runAttemptId: string;
  runtimeRunId: string;
  trigger: Extract<
    RuntimeProcessCleanupTrigger,
    "run_end" | "runtime_crash" | "run_cancelled"
  >;
};

export class RuntimeProcessHygiene {
  readonly #capCheckIntervalMs: number;
  readonly #caps: RuntimeResourceCaps;
  readonly #capsByParticipant: Readonly<
    Record<string, RuntimeResourceCapOverrides>
  >;
  readonly #janitorIntervalMs: number;
  readonly #now: () => Date;
  readonly #onAlert: (alert: RuntimeHygieneAlert) => void;
  readonly #sweeper: Sweeper;

  constructor(options: RuntimeProcessHygieneOptions) {
    this.#capCheckIntervalMs = options.capCheckIntervalMs ?? 30_000;
    this.#caps = mergeCaps(DEFAULT_RUNTIME_RESOURCE_CAPS, options.caps);
    this.#capsByParticipant = options.capsByParticipant ?? {};
    this.#janitorIntervalMs = options.janitorIntervalMs ?? 60_000;
    this.#now = options.now ?? (() => new Date());
    this.#onAlert =
      options.onAlert ??
      ((alert) =>
        process.stderr.write(
          `[rah-os] runtime hygiene alert for ${alert.participantId}: ${alert.message}\n`,
        ));
    this.#sweeper = options.sweeper;
  }

  capsFor(participantId: string): RuntimeResourceCaps {
    return mergeCaps(this.#caps, this.#capsByParticipant[participantId]);
  }

  /** After the run's termination proof is durable: sweep and record. */
  async afterRun(control: CleanupControl, input: RunCleanupInput) {
    await this.#sweepAndRecord(control, {
      participantId: input.participantId,
      runAttemptId: input.runAttemptId,
      runtimeRunIds: [input.runtimeRunId],
      trigger: input.trigger,
    });
  }

  /**
   * Admission for new work. When blocked, first re-sweep the participant's
   * dead runtimes; a clean result unblocks immediately.
   */
  async admit(
    control: CleanupControl,
    participantId: string,
  ): Promise<{ blocked: false } | { blocked: true; reason: string }> {
    if (control.readRuntimeCleanupAdmission === undefined)
      return { blocked: false };
    const first = await control.readRuntimeCleanupAdmission({ participantId });
    if (!first.blocked) return first;
    await this.janitor(control, "janitor", participantId);
    return await control.readRuntimeCleanupAdmission({ participantId });
  }

  async claimNotice(
    control: CleanupControl,
    input: { participantId: string; runAttemptId: string },
  ): Promise<string | undefined> {
    return (await control.claimRuntimeCleanupNotice?.(input)) ?? undefined;
  }

  /**
   * Sweep tagged processes of runtimes this Host ran that are terminated.
   * Blocked participants with nothing left get a clean record (unblock).
   */
  async janitor(
    control: CleanupControl,
    trigger: "host_start" | "janitor",
    onlyParticipantId?: string,
  ): Promise<void> {
    if (
      control.resolveRuntimeCleanupTargets === undefined ||
      control.recordRuntimeProcessCleanup === undefined
    )
      return;
    const tagged = [...(await this.#sweeper.taggedRuntimeIds())];
    const targets = (
      tagged.length === 0
        ? []
        : await control.resolveRuntimeCleanupTargets({ runtimeRunIds: tagged })
    ).filter(
      (target) =>
        target.terminated &&
        (onlyParticipantId === undefined ||
          target.participantId === onlyParticipantId),
    );
    const swept = new Set<string>();
    for (const target of targets) {
      swept.add(target.participantId);
      await this.#sweepAndRecord(control, {
        participantId: target.participantId,
        runAttemptId: target.runAttemptId,
        runtimeRunIds: [target.runtimeRunId],
        trigger,
      });
    }
    const blocked =
      onlyParticipantId !== undefined
        ? [onlyParticipantId]
        : ((await control.listRuntimeCleanupBlockedParticipants?.()) ?? []);
    for (const participantId of blocked) {
      if (swept.has(participantId)) continue;
      await this.#record(control, {
        participantId,
        result: emptyResult(),
        trigger,
      });
    }
  }

  /** Host-lifetime janitor loop; resolves when `signal` aborts. */
  async runPeriodic(
    control: CleanupControl,
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted) {
      await abortableDelay(this.#janitorIntervalMs, signal);
      if (signal.aborted) return;
      try {
        await this.janitor(control, "janitor");
      } catch (error) {
        process.stderr.write(
          `[rah-os] leftover-process janitor failed: ${errorMessage(error)}\n`,
        );
      }
    }
  }

  /**
   * While a run is busy: measure its tagged tree; on the first cap excess,
   * record a blocking alert and stop measuring. Never signals the run.
   */
  async monitorCaps(
    control: CleanupControl,
    input: {
      participantId: string;
      runAttemptId: string;
      runtimeRunId: string;
      signal: AbortSignal;
    },
  ): Promise<void> {
    const caps = this.capsFor(input.participantId);
    while (!input.signal.aborted) {
      await abortableDelay(this.#capCheckIntervalMs, input.signal);
      if (input.signal.aborted) return;
      let footprint: LeftoverFootprint;
      try {
        footprint = await this.#sweeper.measure(new Set([input.runtimeRunId]));
      } catch {
        continue;
      }
      const exceeded = exceededCaps(footprint, caps);
      if (exceeded.length === 0) continue;
      if (input.signal.aborted) return;
      await this.#record(control, {
        participantId: input.participantId,
        result: { ...emptyResult(), footprint },
        runAttemptId: input.runAttemptId,
        runtimeRunIds: [input.runtimeRunId],
        trigger: "resource_cap",
        capExceeded: exceeded,
      });
      this.#onAlert({
        message: `resource cap exceeded (${exceeded.join(", ")}): ${describeFootprint(footprint)}; new work is paused until the run ends and its processes are cleaned`,
        participantId: input.participantId,
        runAttemptId: input.runAttemptId,
      });
      return;
    }
  }

  async #sweepAndRecord(
    control: CleanupControl,
    input: {
      participantId: string;
      runAttemptId?: string;
      runtimeRunIds: string[];
      trigger: RuntimeProcessCleanupTrigger;
    },
  ): Promise<void> {
    let result: LeftoverSweepResult;
    let error: string | undefined;
    try {
      result = await this.#sweeper.sweep(new Set(input.runtimeRunIds));
    } catch (caught) {
      result = emptyResult();
      error = errorMessage(caught).slice(0, 1_000);
    }
    const capExceeded = exceededCaps(
      result.footprint,
      this.capsFor(input.participantId),
    );
    await this.#record(control, {
      ...input,
      capExceeded,
      ...(error === undefined ? {} : { error }),
      result,
    });
    if (error !== undefined || result.remaining > 0)
      this.#onAlert({
        message:
          error !== undefined
            ? `leftover-process sweep failed: ${error}; new work is paused`
            : `${result.remaining} leftover process${result.remaining === 1 ? "" : "es"} could not be stopped${result.remainingPorts.length > 0 ? ` (ports ${result.remainingPorts.join(", ")})` : ""}; new work is paused`,
        participantId: input.participantId,
        ...(input.runAttemptId === undefined
          ? {}
          : { runAttemptId: input.runAttemptId }),
      });
  }

  async #record(
    control: CleanupControl,
    input: {
      capExceeded?: RuntimeResourceCap[];
      error?: string;
      participantId: string;
      result: LeftoverSweepResult;
      runAttemptId?: string;
      runtimeRunIds?: string[];
      trigger: RuntimeProcessCleanupTrigger;
    },
  ): Promise<void> {
    await control.recordRuntimeProcessCleanup?.({
      capExceeded: input.capExceeded ?? [],
      cleanupId: `cleanup_${randomUUID()}`,
      foundCount: input.result.found,
      killedCount: input.result.killed,
      observedAt: this.#now().toISOString(),
      participantId: input.participantId,
      releasedPorts: input.result.releasedPorts.slice(0, 256),
      remainingCount: input.result.remaining,
      remainingPorts: input.result.remainingPorts.slice(0, 256),
      trigger: input.trigger,
      ...(input.error === undefined ? {} : { error: input.error }),
      ...(input.runAttemptId === undefined
        ? {}
        : { runAttemptId: input.runAttemptId }),
      ...(input.runtimeRunIds?.length === 1
        ? { runtimeRunId: input.runtimeRunIds[0]! }
        : {}),
    });
  }
}

function mergeCaps(
  base: RuntimeResourceCaps,
  overrides: RuntimeResourceCapOverrides | undefined,
): RuntimeResourceCaps {
  const merged = { ...base };
  for (const key of Object.keys(base) as (keyof RuntimeResourceCaps)[]) {
    const value = overrides?.[key];
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

export function exceededCaps(
  footprint: LeftoverFootprint,
  caps: RuntimeResourceCaps,
): RuntimeResourceCap[] {
  const exceeded: RuntimeResourceCap[] = [];
  if (footprint.processCount > caps.maxProcesses)
    exceeded.push("process_count");
  if (footprint.rssKb > caps.maxRssKb) exceeded.push("rss");
  if (footprint.listeningPorts.length > caps.maxListeningPorts)
    exceeded.push("listening_ports");
  return exceeded;
}

function describeFootprint(footprint: LeftoverFootprint): string {
  return `${footprint.processCount} processes, ${Math.round(footprint.rssKb / 1024)} MiB RSS, ${footprint.listeningPorts.length} listening ports`;
}

function emptyResult(): LeftoverSweepResult {
  return {
    footprint: { listeningPorts: [], processCount: 0, rssKb: 0 },
    found: 0,
    killed: 0,
    releasedPorts: [],
    remaining: 0,
    remainingPorts: [],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
