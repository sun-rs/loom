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
 *   cancellation, orphan recovery): the runtime is first marked pending in
 *   the Kernel, so a Host crash or a failed record write never reads as
 *   "clean";
 * - at Host start and periodically, for tagged processes of runtimes this
 *   Host ran and the Kernel records as terminated, plus every unresolved
 *   runtime that is no longer live (the janitor). Tags of unknown runtimes
 *   (another daemon, a test Host) are never touched;
 * - before admitting new work for a participant with an unresolved runtime,
 *   to clear it when the old processes are finally gone.
 *
 * Fences (S2-0 review): admission is the Kernel's aggregate over every
 * runtime of the participant; a result this Host could not write is kept in
 * memory, blocks that participant and is retried on the next admission; a
 * failed process scan (ps unavailable) blocks every admission until a full
 * janitor pass succeeds. Sweeps of one runtime are serialized.
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
  | "acceptRuntimeCleanupNotice"
  | "listRuntimeCleanupResweepTargets"
  | "markRuntimeCleanupPending"
  | "readRuntimeCleanupAdmission"
  | "recordRuntimeProcessCleanup"
  | "releaseRuntimeCleanupNotice"
  | "reserveRuntimeCleanupNotice"
  | "resolveRuntimeCleanupTargets"
>;

type CleanupRecordInput = NonNullable<
  Parameters<NonNullable<CleanupControl["recordRuntimeProcessCleanup"]>>[0]
>;
type PendingInput = NonNullable<
  Parameters<NonNullable<CleanupControl["markRuntimeCleanupPending"]>>[0]
>;

/** A write this Host owes the Kernel; it fences its participant. */
type UnrecordedWrite = {
  error: string;
  participantId: string;
  pending?: PendingInput;
  record?: CleanupRecordInput;
};

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
  /** runtime id -> tail of its serialized sweeps. */
  readonly #locks = new Map<string, Promise<void>>();
  /** runtime id -> a Kernel write that failed and must be retried. */
  readonly #unrecorded = new Map<string, UnrecordedWrite>();
  /** Set while the last process scan failed: state is unknown, not empty. */
  #scanUnknown: string | undefined;

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
    await this.#cleanupEndedRuntime(control, {
      participantId: input.participantId,
      runAttemptId: input.runAttemptId,
      runtimeId: input.runtimeRunId,
      trigger: input.trigger,
    });
  }

  /**
   * S2-a: after a warm instance runtime's process ended (eviction, crash,
   * janitor), sweep every process still carrying its tag and record it.
   */
  async afterRuntime(
    control: CleanupControl,
    input: {
      participantId: string;
      runAttemptId?: string;
      runtimeId: string;
      trigger: RuntimeProcessCleanupTrigger;
    },
  ) {
    await this.#cleanupEndedRuntime(control, input);
  }

  /** Runtime ids carried by live processes of this user (janitor input). */
  async taggedRuntimeIds(): Promise<Set<string>> {
    return await this.#sweeper.taggedRuntimeIds();
  }

  /** Live footprint of one warm runtime's tree; never signals. */
  async measureRuntime(runtimeId: string): Promise<LeftoverFootprint> {
    return await this.#sweeper.measure(new Set([runtimeId]));
  }

  /**
   * Admission for new work: first this Host's own unwritten results and a
   * failed process scan, then the Kernel's aggregate; when blocked there,
   * re-sweep the participant's dead unresolved runtimes once.
   */
  async admit(
    control: CleanupControl,
    participantId: string,
  ): Promise<{ blocked: false } | { blocked: true; reason: string }> {
    await this.#retryUnrecorded(control, participantId);
    const owed = [...this.#unrecorded].filter(
      ([, write]) => write.participantId === participantId,
    );
    if (owed.length > 0)
      return {
        blocked: true,
        reason: `RAH_RUNTIME_CLEANUP_BLOCKED: ${owed
          .map(
            ([runtimeId, write]) =>
              `cleanup of runtime ${runtimeId} not recorded: ${write.error}`,
          )
          .join(" | ")}`,
      };
    if (this.#scanUnknown !== undefined) {
      try {
        await this.janitor(control, "janitor");
      } catch (error) {
        return {
          blocked: true,
          reason: `RAH_RUNTIME_CLEANUP_BLOCKED: process scan unavailable: ${errorMessage(error)}`,
        };
      }
    }
    if (control.readRuntimeCleanupAdmission === undefined)
      return { blocked: false };
    const first = await control.readRuntimeCleanupAdmission({ participantId });
    if (!first.blocked) return first;
    await this.janitor(control, "janitor", participantId);
    return await control.readRuntimeCleanupAdmission({ participantId });
  }

  /**
   * Reserve the one-line notice for this RunAttempt (a same-run retry gets
   * the same line). The caller accepts or releases it.
   */
  async reserveNotice(
    control: CleanupControl,
    input: { participantId: string; runAttemptId: string },
  ): Promise<string | undefined> {
    return (await control.reserveRuntimeCleanupNotice?.(input)) ?? undefined;
  }

  async acceptNotice(
    control: CleanupControl,
    input: { participantId: string; runAttemptId: string },
  ): Promise<void> {
    await control.acceptRuntimeCleanupNotice?.(input);
  }

  async releaseNotice(
    control: CleanupControl,
    input: { participantId: string; runAttemptId: string },
  ): Promise<void> {
    await control.releaseRuntimeCleanupNotice?.(input);
  }

  /**
   * Sweep tagged processes of runtimes this Host ran that are terminated,
   * and every unresolved runtime of this Host that is no longer live. Never
   * writes a participant-wide "all clear": only a recorded sweep of a
   * runtime resolves that runtime. A failure leaves the scan unknown.
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
    try {
      const tagged = [...(await this.#sweeper.taggedRuntimeIds())];
      const targets = new Map<
        string,
        { participantId: string; runAttemptId?: string }
      >();
      for (const target of tagged.length === 0
        ? []
        : await control.resolveRuntimeCleanupTargets({
            runtimeRunIds: tagged,
          }))
        if (
          target.terminated &&
          (onlyParticipantId === undefined ||
            target.participantId === onlyParticipantId)
        )
          targets.set(target.runtimeRunId, {
            participantId: target.participantId,
            runAttemptId: target.runAttemptId,
          });
      for (const target of (await control.listRuntimeCleanupResweepTargets?.(
        onlyParticipantId === undefined
          ? {}
          : { participantId: onlyParticipantId },
      )) ?? [])
        if (!targets.has(target.runtimeRunId))
          targets.set(target.runtimeRunId, {
            participantId: target.participantId,
            ...(target.runAttemptId === undefined
              ? {}
              : { runAttemptId: target.runAttemptId }),
          });
      for (const [runtimeId, target] of targets)
        await this.#withRuntimeLock(runtimeId, async () => {
          await this.#sweepAndRecord(control, {
            ...target,
            runtimeId,
            trigger,
          });
        });
      if (onlyParticipantId === undefined) {
        await this.#retryUnrecorded(control);
        this.#scanUnknown = undefined;
      }
    } catch (error) {
      this.#scanUnknown = errorMessage(error).slice(0, 1_000);
      throw error;
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
          `[rah-os] leftover-process janitor failed (admission paused until a scan succeeds): ${errorMessage(error)}\n`,
        );
      }
    }
  }

  /**
   * While a run is busy: measure its tagged tree; on the first cap excess,
   * record a blocking alert and stop measuring. Never signals the run. An
   * unavailable measurement or port query is alerted once, never read as 0.
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
    let measurementAlerted = false;
    let portsAlerted = false;
    const aborted = new Promise<undefined>((resolve) => {
      if (input.signal.aborted) resolve(undefined);
      input.signal.addEventListener("abort", () => resolve(undefined), {
        once: true,
      });
    });
    while (!input.signal.aborted) {
      await abortableDelay(this.#capCheckIntervalMs, input.signal);
      if (input.signal.aborted) return;
      let footprint: LeftoverFootprint | undefined;
      try {
        // Never hold the run's teardown on a slow system query.
        footprint = await Promise.race([
          this.#sweeper.measure(new Set([input.runtimeRunId])),
          aborted,
        ]);
      } catch (error) {
        if (!measurementAlerted)
          this.#onAlert({
            message: `resource measurement unavailable (${errorMessage(error)}); caps are not being enforced for this run`,
            participantId: input.participantId,
            runAttemptId: input.runAttemptId,
          });
        measurementAlerted = true;
        continue;
      }
      if (footprint === undefined || input.signal.aborted) return;
      if (!footprint.portsObserved && !portsAlerted) {
        portsAlerted = true;
        this.#onAlert({
          message:
            "listening ports could not be observed; the port cap is unknown for this run",
          participantId: input.participantId,
          runAttemptId: input.runAttemptId,
        });
      }
      const exceeded = exceededCaps(footprint, caps);
      if (exceeded.length === 0) continue;
      await this.#writeRecord(control, {
        ...this.#recordInput({
          participantId: input.participantId,
          result: { ...emptyResult(), footprint },
          runAttemptId: input.runAttemptId,
          runtimeId: input.runtimeRunId,
          trigger: "resource_cap",
        }),
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

  async #cleanupEndedRuntime(
    control: CleanupControl,
    input: {
      participantId: string;
      runAttemptId?: string;
      runtimeId: string;
      trigger: RuntimeProcessCleanupTrigger;
    },
  ): Promise<void> {
    await this.#withRuntimeLock(input.runtimeId, async () => {
      const pending: PendingInput = {
        observedAt: this.#now().toISOString(),
        participantId: input.participantId,
        ...(input.runAttemptId === undefined
          ? {}
          : { runAttemptId: input.runAttemptId }),
        runtimeRunId: input.runtimeId,
      };
      try {
        await control.markRuntimeCleanupPending?.(pending);
      } catch (error) {
        this.#unrecorded.set(input.runtimeId, {
          error: errorMessage(error).slice(0, 500),
          participantId: input.participantId,
          pending,
        });
      }
      await this.#sweepAndRecord(control, input);
    });
  }

  async #sweepAndRecord(
    control: CleanupControl,
    input: {
      participantId: string;
      runAttemptId?: string;
      runtimeId: string;
      trigger: RuntimeProcessCleanupTrigger;
    },
  ): Promise<void> {
    let result: LeftoverSweepResult;
    let error: string | undefined;
    try {
      result = await this.#sweeper.sweep(new Set([input.runtimeId]));
    } catch (caught) {
      result = { ...emptyResult(), portsObserved: false };
      error = errorMessage(caught).slice(0, 1_000);
    }
    await this.#writeRecord(control, {
      ...this.#recordInput({ ...input, result }),
      ...(error === undefined ? {} : { error }),
    });
    if (error !== undefined || result.remaining > 0 || result.unknown > 0)
      this.#onAlert({
        message:
          error !== undefined
            ? `leftover-process sweep failed: ${error}; new work is paused`
            : `${result.remaining} leftover process${result.remaining === 1 ? "" : "es"} could not be stopped${result.unknown > 0 ? ` and ${result.unknown} tagged process${result.unknown === 1 ? "" : "es"} could not be verified` : ""}${result.remainingPorts.length > 0 ? ` (ports ${result.remainingPorts.join(", ")})` : ""}; new work is paused`,
        participantId: input.participantId,
        ...(input.runAttemptId === undefined
          ? {}
          : { runAttemptId: input.runAttemptId }),
      });
  }

  #recordInput(input: {
    participantId: string;
    result: LeftoverSweepResult;
    runAttemptId?: string;
    runtimeId: string;
    trigger: RuntimeProcessCleanupTrigger;
  }): CleanupRecordInput {
    return {
      capExceeded: exceededCaps(
        input.result.footprint,
        this.capsFor(input.participantId),
      ),
      cleanupId: `cleanup_${randomUUID()}`,
      foundCount: input.result.found,
      killedCount: input.result.killed,
      observedAt: this.#now().toISOString(),
      participantId: input.participantId,
      portsObserved: input.result.portsObserved,
      releasedPorts: input.result.releasedPorts.slice(0, 256),
      remainingCount: input.result.remaining,
      remainingPorts: input.result.remainingPorts.slice(0, 256),
      runtimeRunId: input.runtimeId,
      trigger: input.trigger,
      unknownCount: input.result.unknown,
      ...(input.runAttemptId === undefined
        ? {}
        : { runAttemptId: input.runAttemptId }),
    };
  }

  /** Writes one result; on failure it is owed (fences its participant). */
  async #writeRecord(
    control: CleanupControl,
    record: CleanupRecordInput,
  ): Promise<void> {
    if (control.recordRuntimeProcessCleanup === undefined) return;
    try {
      await control.recordRuntimeProcessCleanup(record);
      const owed = this.#unrecorded.get(record.runtimeRunId);
      if (
        owed !== undefined &&
        (owed.record === undefined || owed.record === record)
      )
        this.#unrecorded.delete(record.runtimeRunId);
    } catch (error) {
      const message = errorMessage(error).slice(0, 500);
      this.#unrecorded.set(record.runtimeRunId, {
        error: message,
        participantId: record.participantId,
        record,
      });
      this.#onAlert({
        message: `leftover-process cleanup result could not be recorded (${message}); new work is paused until it is`,
        participantId: record.participantId,
        ...(record.runAttemptId === undefined
          ? {}
          : { runAttemptId: record.runAttemptId }),
      });
    }
  }

  /** Retries owed writes (same cleanup id: idempotent in the Kernel). */
  async #retryUnrecorded(
    control: CleanupControl,
    participantId?: string,
  ): Promise<void> {
    for (const [runtimeId, write] of [...this.#unrecorded]) {
      if (participantId !== undefined && write.participantId !== participantId)
        continue;
      await this.#withRuntimeLock(runtimeId, async () => {
        const current = this.#unrecorded.get(runtimeId);
        if (current === undefined) return;
        try {
          if (current.record !== undefined)
            await control.recordRuntimeProcessCleanup?.(current.record);
          else if (current.pending !== undefined)
            await control.markRuntimeCleanupPending?.(current.pending);
          this.#unrecorded.delete(runtimeId);
        } catch (error) {
          current.error = errorMessage(error).slice(0, 500);
        }
      });
    }
  }

  async #withRuntimeLock(
    runtimeId: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    const previous = this.#locks.get(runtimeId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    const tail = next.catch(() => undefined);
    this.#locks.set(runtimeId, tail);
    try {
      await next;
    } finally {
      if (this.#locks.get(runtimeId) === tail) this.#locks.delete(runtimeId);
    }
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
    footprint: {
      listeningPorts: [],
      portsObserved: true,
      processCount: 0,
      rssKb: 0,
    },
    found: 0,
    killed: 0,
    portsObserved: true,
    releasedPorts: [],
    remaining: 0,
    remainingPorts: [],
    unknown: 0,
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
