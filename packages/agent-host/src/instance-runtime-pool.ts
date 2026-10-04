import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

import type { AgentHostControlPort } from "./agent-host-control.ts";
import type { RuntimeTrajectoryCollector } from "./generic-process-adapter.ts";
import {
  createSystemProcessTable,
  type ProcessTable,
} from "./leftover-process-sweeper.ts";
import type { RuntimeProcessHygiene } from "./runtime-process-hygiene.ts";
import type { RunExit } from "./runtime.ts";
import type { WorkerMcpBridge } from "./worker-mcp-bridge.ts";
import { writeWorkerCliWrapper } from "./worker-tool-transport.ts";
import {
  resolveWarmRuntimePolicy,
  warmIdleTtl,
  type WarmRuntimePolicy,
  type WarmRuntimePolicyOverrides,
} from "./warm-runtime-policy.ts";
import {
  createWorkerTurnRoot,
  removeWorkerTurnRoot,
  type WorkerTurnHandle,
} from "./worker-turn-handle.ts";

/**
 * S2-a Host owner of warm instance runtimes (S2 spec §1/§2/§6, contract §6a).
 *
 * One live warm Provider process per participant, recorded durably by the
 * Kernel's `instance_runtimes` row (which owns generation, crash, exit and
 * janitor facts; this class owns only the live process handles). A runtime
 * serves one turn at a time; every frame on its fd3 channel carries the
 * turn's RunAttempt and native turn identity and is routed to that turn's
 * collector only. Frames of an already-drained turn are late: never given to
 * the next turn, recorded as a usage gap of their own turn.
 *
 * Lifecycle: cold start on the first turn (resuming the recorded native
 * session), idle after the lane is released, evicted after an idle TTL or
 * by the global warm cap (never mid-turn, never pinned), restarted at an
 * idle boundary when its launch key, CLI binary, age or RSS calls for it
 * (S2-b, `warm-runtime-policy.ts`), and a crash while idle leaves the next
 * turn to cold start and resume. Turn admission is capped globally. A Host start first proves every live runtime row of an older
 * generation gone (identity-verified kill) before this Host may run that
 * participant again. When a runtime ends, all tagged descendants are swept.
 */
export const WARM_RUNTIME_RECOVERY_DRIVER = "loom-instance-runtime-v1";
export const DEFAULT_WARM_IDLE_TTL_MS = 30 * 60_000;
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_KILL_GRACE_MS = 1_000;
const DEFAULT_KILL_WAIT_MS = 5_000;
const FD3_BUFFER_LIMIT = 4 * 1024 * 1024;
const RECENT_TURN_LIMIT = 64;
const RELEASED_TURN_LIMIT = 256;
const SUPERVISION_FAILURE_LIMIT = 1_000;

export type WarmRuntimeLaunch = {
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  release?: () => Promise<void> | void;
};

export type WarmRuntimeLayout = {
  binDirectory: string;
  instanceRuntimeId: string;
  socketDirectory: string;
  turnRoot: string;
  workerCli: string;
};

export type WarmTurnOutcome =
  | {
      kind: "drained";
      inFlightToolCount: number;
      lastFrameSeq: number;
      nativeTurnId: string;
      status: string;
      errorMessage?: string;
      /** The driver issued the final-reply interrupt for this native turn. */
      endedAfterFinalReply?: boolean;
      finalOutputCandidate?: { text: string; nativeMessageId: string };
    }
  | { kind: "exit"; exit: RunExit }
  /** The runtime was killed but its exit is not proven: no proof exists. */
  | { kind: "unproven"; error: string };

/**
 * Review P1-1: sending SIGKILL is not an exit. Only a real `close` of the
 * process, or identity-verified absence of its group, proves termination.
 */
export type WarmKillProof =
  | { proven: true; exit: { code: number | null; signal: string | null } }
  | { proven: false; reason: string };

/** Review P1-3: what a leftover sweep proved (never assumed on failure). */
export type WarmSweepEvidence =
  | { complete: true; remaining: number; unknown: number }
  | { complete: false; error: string };

export type WarmRuntimeEndReason =
  | "crash"
  | "stall"
  | "idle_ttl"
  | "lru"
  | "recycle_rss"
  | "recycle_age"
  | "cli_changed"
  | "config_restart"
  | "host_shutdown"
  | "resource_failure"
  | "removed"
  | "start_failed";

/** Ends of an idle runtime chosen by policy (proven exit, then recorded). */
type WarmStopReason = Extract<
  WarmRuntimeEndReason,
  | "idle_ttl"
  | "lru"
  | "recycle_rss"
  | "recycle_age"
  | "cli_changed"
  | "config_restart"
  | "host_shutdown"
  | "resource_failure"
  | "removed"
>;

export type WarmTurnAdmission =
  | { kind: "accepted"; nativeTurnId: string }
  | { kind: "failed"; error: string; rejected: boolean };

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  settled: boolean;
};

export type WarmTurn = {
  /** Revoke the exact Host MCP binding before releasing the Worker credential. */
  releaseMcp?: () => void;
  admission: Deferred<WarmTurnAdmission>;
  /** The begin command was written; admission may be pending. */
  beginSent?: boolean;
  cancelRequested: boolean;
  collector?: RuntimeTrajectoryCollector;
  framesClosed: boolean;
  handle?: WorkerTurnHandle;
  /** Durable incomplete-evidence marks; awaited before the turn's proof. */
  integrityWrites: Promise<void>[];
  lastFrameSeq: number;
  nativeTurnId?: string;
  outcome: Deferred<WarmTurnOutcome>;
  runAttemptId: string;
  runtimeRunId: string;
  /**
   * S2-b business-progress clock (policy time): native turn progress only.
   * Transport liveness (`WarmRuntime.lastTransportMs`) never moves it.
   */
  lastProgressMs: number;
  /** evo §37 B: when the turn opened (policy time), for the duration cap. */
  openedMs: number;
  /** Tools the driver reports in flight (diagnostics only). */
  toolsInFlight: number;
  /** The driver reports the turn waits for an approval (never a stall). */
  awaitingApproval: boolean;
  /** The Host signalled that this turn's `final` reply committed. */
  finalReplyCommitted?: boolean;
};

export type InstanceRuntimePoolOptions = {
  control: AgentHostControlPort;
  hostGeneration: string;
  /** Owner-private directory for runtime turn roots and CLI wrappers. */
  stateDirectory: string;
  /** Short socket directory root (Unix socket paths are length-limited). */
  socketRoot?: string;
  hygiene?: RuntimeProcessHygiene;
  /** Shorthand for `policy.idleTtlMs` (S2-a option). */
  idleTtlMs?: number;
  /**
   * The Host's runtime start deadline (`AgentHost.runtimeStartTimeoutMs`).
   * A turn waits for a busy slot at most half of it, so a full pool fails
   * the turn with `RAH_WARM_ADMISSION_FULL` before the Host gives up on it.
   */
  hostStartTimeoutMs?: number;
  /** S2-b policy overrides (`warm-runtime-policy.ts` defaults). */
  policy?: WarmRuntimePolicyOverrides;
  /** Per-instance idle TTL override; `undefined` keeps the policy TTL. */
  idleTtlOverride?: (input: {
    participantId: string;
    lastColdResumeMs: number | undefined;
  }) => number | undefined;
  /** Process-group RSS in KiB; defaults to the process table. */
  measureGroupRssKb?: (pgid: number) => Promise<number>;
  now?: () => number;
  onDiagnostic?: (message: string) => void;
  processTable?: ProcessTable;
  readyTimeoutMs?: number;
  /**
   * Review of the review-2 fixes P1-1: the bound on one prewarm start (from
   * the participant lock to ready). Past it the prewarm is abandoned, so a
   * real start waiting on it proceeds.
   */
  prewarmTimeoutMs?: number;
  stopTimeoutMs?: number;
  /** SIGTERM grace, then the wait for a real close after SIGKILL. */
  killGraceMs?: number;
  killWaitMs?: number;
  /** Signal delivery (`process.kill`); replaceable to simulate failures. */
  signalProcess?: (pid: number, signal: NodeJS.Signals | 0) => void;
};

export class WarmRuntime {
  /** Runtime transport only; original execution credentials remain in its bindings. */
  workerMcp: WorkerMcpBridge | undefined;
  readonly instanceRuntimeId: string;
  readonly participantId: string;
  readonly key: string;
  /** `instance_runtimes.driver` (one CLI per driver kind). */
  readonly driver: string;
  readonly layout: WarmRuntimeLayout;
  state: "starting" | "idle" | "busy" | "stopping" | "suspect" | "dead" =
    "starting";
  /** Why the runtime was being ended when its termination went unproven. */
  suspectReason: WarmRuntimeEndReason | undefined;
  /** The native session (thread) id reported at ready. */
  nativeSessionId: string | undefined;
  /** The Host persisted this process's native session binding (P1-2). */
  sessionBound = false;
  /** Frames were lost on the fd3 channel: never reuse this process. */
  frameIntegrityLost = false;
  lastActivityMs: number;
  /** Birth in policy time (boundary recycling by age). */
  readonly startedMs: number;
  /** Last envelope of any kind (transport liveness; diagnostics only). */
  lastTransportMs: number;
  /** CLI binary fingerprint at launch (boundary recycling on change). */
  cliFingerprint: string | undefined;
  /** Measured native session resume at this process's start. */
  sessionResumeMs: number | null = null;
  /** Why no further turn may be admitted (restart at the idle boundary). */
  admissionClosed: string | undefined;
  /** The instance was removed: stop at the next idle boundary, never reuse. */
  retireReason: "removed" | undefined;
  readonly #pins = new Map<string, number>();
  /** Digest of the standing prompt this process was launched with. */
  standingPromptDigest: string | undefined;
  /** The runtime-level lease environment (memory paths, system snapshot). */
  launchEnvironment: Readonly<Record<string, string>> = {};
  /** A turn whose Kernel lane release has not been confirmed yet. */
  unreleasedRunAttemptId: string | undefined;
  current: WarmTurn | undefined;
  readonly #recent = new Map<string, true>();
  #lastClosedRunAttemptId: string | undefined;
  readonly #pool: InstanceRuntimePool;
  #child: ChildProcess | undefined;
  #pid: number | undefined;
  #processStartedAt: string | undefined;
  #release: (() => Promise<void> | void) | undefined;
  #ready = deferred<
    | { kind: "ready"; threadId: string; sessionResumeMs: number | null }
    | { kind: "failed"; error: string }
  >();
  #exit = deferred<{ code: number | null; signal: string | null }>();
  #lastSeq = 0;

  constructor(input: {
    driver: string;
    instanceRuntimeId: string;
    key: string;
    layout: WarmRuntimeLayout;
    participantId: string;
    pool: InstanceRuntimePool;
    nowMs: number;
  }) {
    this.instanceRuntimeId = input.instanceRuntimeId;
    this.driver = input.driver;
    this.key = input.key;
    this.layout = input.layout;
    this.participantId = input.participantId;
    this.#pool = input.pool;
    this.lastActivityMs = input.nowMs;
    this.startedMs = input.nowMs;
    this.lastTransportMs = input.nowMs;
  }

  /**
   * Keep this runtime from idle eviction, the warm cap and policy recycling
   * (an attached TUI). The release restarts the idle TTL at detach.
   */
  pin(reason: string): () => void {
    this.#pins.set(reason, (this.#pins.get(reason) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.#pins.get(reason) ?? 1) - 1;
      if (count <= 0) this.#pins.delete(reason);
      else this.#pins.set(reason, count);
      this.lastActivityMs = this.#pool.now();
    };
  }

  get pinned(): boolean {
    return this.#pins.size > 0;
  }

  get pid(): number | undefined {
    return this.#pid;
  }

  get exited(): Promise<{ code: number | null; signal: string | null }> {
    return this.#exit.promise;
  }

  spawn(launch: WarmRuntimeLaunch): void {
    this.#release = launch.release;
    const child = spawn(process.execPath, [...launch.args], {
      cwd: launch.cwd,
      detached: true,
      env: launch.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    });
    this.#child = child;
    this.#pid = child.pid;
    child.stdin?.on("error", () => undefined);
    child.stdout?.on("data", (chunk: Buffer) =>
      this.#pool.diagnostic(
        `[${this.instanceRuntimeId}] ${chunk.toString().trimEnd()}`,
      ),
    );
    child.stderr?.on("data", (chunk: Buffer) =>
      this.#pool.diagnostic(
        `[${this.instanceRuntimeId}] ${chunk.toString().trimEnd()}`,
      ),
    );
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    let skipping = false;
    (child.stdio[3] as NodeJS.ReadableStream | null)?.on(
      "data",
      (chunk: Buffer) => {
        buffer += decoder.write(chunk);
        for (;;) {
          const newline = buffer.indexOf("\n");
          if (newline < 0) break;
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (skipping) {
            // The rest of the oversized line: dropped, already marked.
            skipping = false;
            continue;
          }
          if (line.length > FD3_BUFFER_LIMIT) {
            this.#frameOverflow();
            continue;
          }
          if (line.trim() !== "") this.#route(line);
        }
        if (buffer.length > FD3_BUFFER_LIMIT) {
          // Review P2-1: an oversized frame is lost evidence, never a silent
          // drop — mark the attributable turn incomplete, retire the process.
          buffer = "";
          if (!skipping) this.#frameOverflow();
          skipping = true;
        }
      },
    );
    child.once("error", (error) => {
      settle(this.#ready, { kind: "failed", error: error.message });
    });
    child.once("close", (code, signal) => {
      settle(this.#ready, {
        kind: "failed",
        error: `warm runtime exited before ready (code=${String(code)}, signal=${String(signal)})`,
      });
      settle(this.#exit, { code, signal });
    });
  }

  async waitReady(timeoutMs: number) {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.#ready.promise,
        new Promise<{ kind: "failed"; error: string }>((resolve) => {
          timer = setTimeout(
            () =>
              resolve({
                kind: "failed",
                error: `warm runtime not ready after ${timeoutMs}ms`,
              }),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  setProcessStartedAt(value: string): void {
    this.#processStartedAt = value;
  }

  get processStartedAt(): string | undefined {
    return this.#processStartedAt;
  }

  command(command: Record<string, unknown>): void {
    const stdin = this.#child?.stdin;
    if (stdin === undefined || stdin === null || !stdin.writable)
      throw new Error("warm runtime control channel is closed");
    stdin.write(`${JSON.stringify(command)}\n`);
  }

  openTurn(runAttemptId: string, runtimeRunId: string): WarmTurn {
    if (this.current !== undefined)
      throw new Error("warm runtime already has an open turn");
    const turn: WarmTurn = {
      admission: deferred(),
      cancelRequested: false,
      framesClosed: false,
      integrityWrites: [],
      lastFrameSeq: 0,
      outcome: deferred(),
      runAttemptId,
      runtimeRunId,
      awaitingApproval: false,
      lastProgressMs: this.#pool.now(),
      openedMs: this.#pool.now(),
      toolsInFlight: 0,
    };
    this.current = turn;
    return turn;
  }

  /** The turn's frames are closed; later frames of it are late. */
  closeTurnFrames(turn: WarmTurn): void {
    turn.framesClosed = true;
    this.#lastClosedRunAttemptId = turn.runAttemptId;
    this.#recent.set(turn.runAttemptId, true);
    while (this.#recent.size > RECENT_TURN_LIMIT)
      this.#recent.delete(this.#recent.keys().next().value!);
  }

  /** Physical process group liveness with identity (pid + start time). */
  async processGroupAlive(table: ProcessTable): Promise<boolean> {
    const pid = this.#pid;
    if (pid === undefined || this.state === "dead") return false;
    try {
      this.#pool.signalProcess(-pid, 0);
    } catch {
      return false;
    }
    const identity = (await table.identities([pid])).get(pid);
    return (
      identity !== undefined &&
      (this.#processStartedAt === undefined ||
        identity.startedAt === this.#processStartedAt)
    );
  }

  /**
   * Signal the whole group. `gone` only for ESRCH; a refused or failed send
   * (EPERM, anything else) is not evidence that the process ended.
   */
  signalGroup(signal: NodeJS.Signals): "sent" | "gone" | `failed:${string}` {
    const pid = this.#pid;
    if (pid === undefined) return "gone";
    try {
      this.#pool.signalProcess(-pid, signal);
      return "sent";
    } catch (error) {
      const code = errorCode(error);
      return code === "ESRCH" ? "gone" : `failed:${code ?? "unknown"}`;
    }
  }

  /**
   * Identity-verified absence: no process is left in the group (ESRCH) and
   * the leader pid is gone or now belongs to a different process.
   */
  async verifiedAbsent(table: ProcessTable): Promise<boolean> {
    const pid = this.#pid;
    if (pid === undefined) return true;
    try {
      this.#pool.signalProcess(-pid, 0);
      return false;
    } catch (error) {
      if (errorCode(error) !== "ESRCH") return false;
    }
    try {
      const identity = (await table.identities([pid])).get(pid);
      return (
        identity === undefined ||
        (this.#processStartedAt !== undefined &&
          identity.startedAt !== this.#processStartedAt)
      );
    } catch {
      return false;
    }
  }

  async releaseLaunch(): Promise<void> {
    const release = this.#release;
    this.#release = undefined;
    try {
      await release?.();
    } catch (error) {
      this.#pool.diagnostic(
        `[${this.instanceRuntimeId}] runtime environment release failed: ${errorMessage(error)}`,
      );
    }
  }

  #route(line: string): void {
    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.#pool.diagnostic(`[${this.instanceRuntimeId}] non-JSON fd3 frame`);
      return;
    }
    if (
      envelope.loom !== "warm-runtime/v1" ||
      envelope.runtimeId !== this.instanceRuntimeId ||
      envelope.hostGeneration !== this.#pool.hostGeneration ||
      typeof envelope.seq !== "number" ||
      !Number.isInteger(envelope.seq) ||
      envelope.seq <= this.#lastSeq
    ) {
      this.#pool.diagnostic(
        `[${this.instanceRuntimeId}] rejected fd3 frame outside this runtime's identity or order`,
      );
      return;
    }
    // Review P2-1: the driver numbers every envelope; a gap is lost evidence.
    if (envelope.seq !== this.#lastSeq + 1)
      this.#evidenceGap(
        `envelope sequence gap ${String(this.#lastSeq + 1)}..${String(envelope.seq - 1)}`,
      );
    this.#lastSeq = envelope.seq;
    this.lastTransportMs = this.#pool.now();
    const runAttemptId =
      typeof envelope.runAttemptId === "string"
        ? envelope.runAttemptId
        : undefined;
    const turn =
      runAttemptId !== undefined && this.current?.runAttemptId === runAttemptId
        ? this.current
        : undefined;
    switch (envelope.type) {
      case "ready":
        settle(this.#ready, {
          kind: "ready",
          sessionResumeMs:
            typeof envelope.sessionResumeMs === "number"
              ? envelope.sessionResumeMs
              : null,
          threadId: String(envelope.threadId),
        });
        return;
      case "fatal":
        this.#pool.diagnostic(
          `[${this.instanceRuntimeId}] fatal: ${String(envelope.error)}`,
        );
        settle(this.#ready, { kind: "failed", error: String(envelope.error) });
        return;
      case "turn.accepted":
        if (turn === undefined || typeof envelope.nativeTurnId !== "string")
          return this.#unattributable(envelope);
        turn.nativeTurnId = envelope.nativeTurnId;
        turn.lastProgressMs = this.#pool.now();
        settle(turn.admission, {
          kind: "accepted",
          nativeTurnId: envelope.nativeTurnId,
        });
        return;
      case "turn.failed":
        if (turn === undefined) return this.#unattributable(envelope);
        settle(turn.admission, {
          error: String(envelope.error ?? "turn start failed"),
          kind: "failed",
          rejected: envelope.rejected === true,
        });
        return;
      case "frame":
        if (turn !== undefined && !turn.framesClosed) {
          if (envelope.nativeTurnId !== turn.nativeTurnId) {
            // Routed by RunAttempt AND native turn: a mismatch is evidence
            // this turn cannot attribute, never evidence of the turn.
            this.#pool.markIncomplete(
              this,
              turn,
              `frame names native turn ${String(envelope.nativeTurnId)}`,
            );
            return;
          }
          turn.lastFrameSeq = envelope.seq;
          turn.lastProgressMs = this.#pool.now();
          turn.collector?.append(`${JSON.stringify(envelope.frame)}\n`);
          return;
        }
        if (runAttemptId !== undefined && this.#isKnownTurn(runAttemptId)) {
          this.#pool.lateFrame(this, runAttemptId);
          return;
        }
        return this.#unattributable(envelope);
      case "turn.drained":
        if (
          turn === undefined ||
          envelope.nativeTurnId !== turn.nativeTurnId ||
          typeof envelope.lastFrameSeq !== "number"
        )
          return this.#unattributable(envelope);
        if (envelope.lastFrameSeq !== turn.lastFrameSeq)
          this.#pool.markIncomplete(
            this,
            turn,
            `drain names frame ${String(envelope.lastFrameSeq)} but the Host received this turn through ${String(turn.lastFrameSeq)}`,
          );
        // Frames of this turn after its drain point are late, never current.
        this.closeTurnFrames(turn);
        settle(turn.outcome, {
          inFlightToolCount: Number(envelope.inFlightToolCount ?? 0),
          kind: "drained",
          lastFrameSeq: envelope.lastFrameSeq,
          nativeTurnId: turn.nativeTurnId!,
          status: String(envelope.status),
          ...(typeof envelope.errorMessage === "string"
            ? { errorMessage: envelope.errorMessage }
            : {}),
          ...(envelope.endedAfterFinalReply === true
            ? { endedAfterFinalReply: true }
            : {}),
          ...(typeof envelope.finalOutputCandidate === "object" &&
          envelope.finalOutputCandidate !== null &&
          typeof (envelope.finalOutputCandidate as Record<string, unknown>)
            .text === "string" &&
          typeof (envelope.finalOutputCandidate as Record<string, unknown>)
            .nativeMessageId === "string"
            ? {
                finalOutputCandidate: envelope.finalOutputCandidate as {
                  text: string;
                  nativeMessageId: string;
                },
              }
            : {}),
        });
        return;
      case "progress":
        // S2-b: native progress that produced no frame (deltas, tool state).
        // Never evidence of a turn it does not name; never a usage gap.
        if (
          turn === undefined ||
          turn.framesClosed ||
          envelope.nativeTurnId !== turn.nativeTurnId
        )
          return;
        turn.lastProgressMs = this.#pool.now();
        if (
          typeof envelope.toolsInFlight === "number" &&
          Number.isInteger(envelope.toolsInFlight) &&
          envelope.toolsInFlight >= 0
        )
          turn.toolsInFlight = envelope.toolsInFlight;
        if (typeof envelope.awaitingApproval === "boolean")
          turn.awaitingApproval = envelope.awaitingApproval;
        return;
      case "keepalive":
        // Transport liveness only: never business progress.
        return;
      case "unattributed":
        this.#pool.diagnostic(
          `[${this.instanceRuntimeId}] unattributed native frame ${String(envelope.method)} (${String(envelope.reason)})`,
        );
        // Required evidence (usage) the driver could not attribute: the open
        // turn's usage can no longer be proven complete.
        if (
          /usage/iu.test(String(envelope.method)) &&
          this.current !== undefined &&
          !this.current.framesClosed
        )
          this.#pool.markIncomplete(
            this,
            this.current,
            `unattributed ${String(envelope.method)}`,
          );
        return;
      default:
        return this.#unattributable(envelope);
    }
  }

  #isKnownTurn(runAttemptId: string): boolean {
    return (
      this.#recent.has(runAttemptId) ||
      (this.current?.runAttemptId === runAttemptId && this.current.framesClosed)
    );
  }

  #unattributable(envelope: Record<string, unknown>): void {
    this.#pool.diagnostic(
      `[${this.instanceRuntimeId}] unattributable ${String(envelope.type)} frame for ${String(envelope.runAttemptId ?? "no turn")}`,
    );
    const open = this.current;
    if (open !== undefined && !open.framesClosed)
      this.#pool.markIncomplete(
        this,
        open,
        `unattributable ${String(envelope.type)} envelope`,
      );
  }

  #frameOverflow(): void {
    this.frameIntegrityLost = true;
    this.#evidenceGap("fd3 frame exceeded the buffer limit and was dropped");
  }

  /** Lost envelopes: the attributable turn is the open one, else the last. */
  #evidenceGap(reason: string): void {
    const target = this.current ?? undefined;
    if (target !== undefined) {
      this.#pool.markIncomplete(this, target, reason);
      return;
    }
    if (this.#lastClosedRunAttemptId !== undefined) {
      this.#pool.markIncomplete(this, this.#lastClosedRunAttemptId, reason);
      return;
    }
    this.#pool.diagnostic(`[${this.instanceRuntimeId}] ${reason} (no turn)`);
  }
}

export class InstanceRuntimePool {
  readonly hostGeneration: string;
  readonly #control: AgentHostControlPort;
  readonly #runtimes = new Map<string, WarmRuntime>();
  /**
   * Full review 2 batch 1 #3/#5: cold starts in flight (Kernel row
   * registered, not ready yet), by participant. Owned by this pool: the start
   * fence and janitor never treat them as leftovers, and prewarm admission
   * counts them with the live runtimes.
   */
  readonly #starting = new Map<string, ColdStart>();
  readonly #locks = new Map<string, Promise<unknown>>();
  readonly #stateDirectory: string;
  readonly #socketRoot: string;
  readonly #hygiene: RuntimeProcessHygiene | undefined;
  readonly policy: WarmRuntimePolicy;
  readonly #idleTtlOverride: InstanceRuntimePoolOptions["idleTtlOverride"];
  readonly #measureGroupRssKb: ((pgid: number) => Promise<number>) | undefined;
  /** Last measured cold resume per instance (TTL extension evidence). */
  readonly #lastColdResumeMs = new Map<string, number>();
  /** Admitted busy turns (hard cap) and the turns waiting for a slot. */
  readonly #busySlots = new Set<string>();
  readonly #admissionWaiters: (() => void)[] = [];
  readonly #admissionWaitMs: number;
  /**
   * Review batch 1 #2: RunAttempts whose lane the Host already released. A
   * start that outlived the Host's start deadline sees this and gives back
   * what it took (busy slot, busy state) instead of holding them forever.
   */
  readonly #releasedTurns = new Set<string>();
  /**
   * Review batch 1 #6 (Codex P2-1): stalls and resource failures per
   * Activation. The production resolver builds a new adapter for every
   * claim, so the bounded retry budget lives with the pool it shares.
   */
  readonly #supervisionFailures = new Map<string, number>();
  /**
   * Review batch 1 #6: Host transport state that must outlive one claim's
   * adapter while the same pool keeps the runtime (e.g. the pending
   * session-protocol line). Created once per key; never business state.
   */
  readonly #shared = new Map<string, unknown>();
  readonly #now: () => number;
  readonly #onDiagnostic: (message: string) => void;
  readonly #readyTimeoutMs: number;
  readonly #prewarmTimeoutMs: number;
  readonly #stopTimeoutMs: number;
  readonly #killGraceMs: number;
  readonly #killWaitMs: number;
  readonly signalProcess: (pid: number, signal: NodeJS.Signals | 0) => void;
  #processTable: ProcessTable | undefined;
  #timer: NodeJS.Timeout | undefined;

  constructor(options: InstanceRuntimePoolOptions) {
    if (options.control.instanceRuntimes === undefined)
      throw new Error("warm runtimes require Kernel instance runtime control");
    this.#control = options.control;
    this.hostGeneration = options.hostGeneration;
    this.#stateDirectory = options.stateDirectory;
    this.#socketRoot =
      options.socketRoot ??
      `/tmp/loom-warm-${String(process.getuid?.() ?? "user")}`;
    this.#hygiene = options.hygiene;
    this.policy = resolveWarmRuntimePolicy({
      idleTtlMs: options.idleTtlMs ?? DEFAULT_WARM_IDLE_TTL_MS,
      ...options.policy,
    });
    this.#idleTtlOverride = options.idleTtlOverride;
    this.#admissionWaitMs =
      options.hostStartTimeoutMs === undefined
        ? this.policy.admissionWaitMs
        : Math.max(
            1,
            Math.min(
              this.policy.admissionWaitMs,
              Math.floor(options.hostStartTimeoutMs / 2),
            ),
          );
    this.#measureGroupRssKb = options.measureGroupRssKb;
    this.#now = options.now ?? Date.now;
    this.#onDiagnostic =
      options.onDiagnostic ??
      ((message) => process.stderr.write(`[loom warm-runtime] ${message}\n`));
    this.#processTable = options.processTable;
    this.#readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    this.#prewarmTimeoutMs =
      options.prewarmTimeoutMs ??
      this.#readyTimeoutMs + DEFAULT_PREWARM_PREPARATION_MS;
    this.#stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
    this.#killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.#killWaitMs = options.killWaitMs ?? DEFAULT_KILL_WAIT_MS;
    this.signalProcess =
      options.signalProcess ??
      ((pid, signal) => {
        process.kill(pid, signal);
      });
  }

  get idleTtlMs(): number {
    return this.policy.idleTtlMs;
  }

  /** Policy time (injectable clock). */
  now(): number {
    return this.#now();
  }

  /** The idle TTL of this runtime's instance (S2-b, see the policy note). */
  idleTtlFor(runtime: WarmRuntime): number {
    const lastColdResumeMs = this.#lastColdResumeMs.get(runtime.participantId);
    let override: number | undefined;
    try {
      override = this.#idleTtlOverride?.({
        lastColdResumeMs,
        participantId: runtime.participantId,
      });
    } catch (error) {
      this.diagnostic(`idle TTL override failed: ${errorMessage(error)}`);
    }
    return warmIdleTtl(this.policy, lastColdResumeMs, override);
  }

  /** Total RSS (KiB) of the processes in one process group. */
  async measureGroupRssKb(pgid: number): Promise<number> {
    if (this.#measureGroupRssKb !== undefined)
      return await this.#measureGroupRssKb(pgid);
    const processes = await this.processTable.list();
    return processes
      .filter((entry) => entry.pgid === pgid)
      .reduce((total, entry) => total + entry.rssKb, 0);
  }

  get processTable(): ProcessTable {
    this.#processTable ??= createSystemProcessTable();
    return this.#processTable;
  }

  get control(): AgentHostControlPort {
    return this.#control;
  }

  diagnostic(message: string): void {
    try {
      this.#onDiagnostic(message);
    } catch {
      // Diagnostics never own lifecycle.
    }
  }

  runtimeFor(participantId: string): WarmRuntime | undefined {
    return this.#runtimes.get(participantId);
  }

  /** Host transport state shared by every adapter of this pool (per key). */
  shared<T>(key: string, create: () => T): T {
    if (!this.#shared.has(key)) this.#shared.set(key, create());
    return this.#shared.get(key) as T;
  }

  /** Counts one supervised failure of an Activation; returns the total. */
  recordSupervisionFailure(activationId: string): number {
    const count = (this.#supervisionFailures.get(activationId) ?? 0) + 1;
    this.#supervisionFailures.delete(activationId);
    this.#supervisionFailures.set(activationId, count);
    while (this.#supervisionFailures.size > SUPERVISION_FAILURE_LIMIT)
      this.#supervisionFailures.delete(
        this.#supervisionFailures.keys().next().value!,
      );
    return count;
  }

  /** The Host released this RunAttempt's lane (its turn is over). */
  turnReleased(runAttemptId: string): boolean {
    return this.#releasedTurns.has(runAttemptId);
  }

  /**
   * Review batch 1 #7 (lifecycle P2-1): before a run of this participant
   * starts on any path (warm or per-turn), no live runtime row this pool
   * does not hold may remain — an older generation, a crash, or a suspect
   * row. They are proven gone first; one that cannot be blocks the start.
   */
  async fenceStart(participantId: string): Promise<void> {
    // Full review 2 batch 1 #3 (Codex P1-2): the fence shares the
    // participant's start ownership. It waits for this pool's own start in
    // flight (a prewarm) to finish — ready and held, or failed and recorded —
    // instead of taking its starting row for a leftover. The janitor it
    // calls takes no participant lock (the cold start calls it inside one).
    await this.#serialize(participantId, async () => {
      const foreign = async () =>
        (await this.#control.instanceRuntimes!.list()).filter(
          (row) => row.participantId === participantId && !this.#ownsRow(row),
        );
      if ((await foreign()).length === 0) return;
      await this.janitor(participantId);
      const remaining = await foreign();
      if (remaining.length > 0)
        throw new Error(
          `instance runtime ${remaining.map((row) => row.instanceRuntimeId).join(", ")} of ${participantId} is not proven terminated; new execution stays blocked`,
        );
    });
  }

  /** A live row this pool holds or is starting itself (never a leftover). */
  #ownsRow(row: { participantId: string; instanceRuntimeId: string }): boolean {
    return (
      this.#runtimes.get(row.participantId)?.instanceRuntimeId ===
        row.instanceRuntimeId ||
      this.#starting.get(row.participantId)?.instanceRuntimeId ===
        row.instanceRuntimeId
    );
  }

  /** Periodic idle eviction; resolves nothing and never blocks shutdown. */
  start(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(
      () => void this.sweepIdle().catch(() => undefined),
      Math.max(1_000, Math.min(this.policy.idleTtlMs, 60_000)),
    );
    this.#timer.unref();
  }

  /**
   * One warm runtime for this participant and launch key: reuse the idle
   * one, restart it at this idle boundary when its launch key, CLI binary,
   * age or RSS calls for it, or cold start (resuming the recorded native
   * session through `launch`). The turn first takes one of the global busy
   * slots (S2-b hard cap), waiting at most `admissionWaitMs`.
   */
  async acquire(input: {
    driver: string;
    key: string;
    launch: (layout: WarmRuntimeLayout) => Promise<WarmRuntimeLaunch>;
    participantId: string;
    /** Busy-slot identity; released by `releaseTurn` of this RunAttempt. */
    runAttemptId?: string;
    /** Current CLI binary fingerprint (boundary recycling on change). */
    cliFingerprint?: () => Promise<string | undefined>;
  }): Promise<{ mode: "warm" | "cold"; runtime: WarmRuntime }> {
    const slot = input.runAttemptId ?? input.participantId;
    const runAttemptId = input.runAttemptId;
    const abandoned = () =>
      runAttemptId !== undefined && this.#releasedTurns.has(runAttemptId);
    const abandonedError = () =>
      new Error(
        `warm turn ${String(runAttemptId)} was released by the Host before its runtime was acquired; nothing was started for it`,
      );
    if (abandoned()) throw abandonedError();
    await this.#admit(slot, abandoned);
    let acquired: { mode: "warm" | "cold"; runtime: WarmRuntime };
    try {
      acquired = await this.#serialize(input.participantId, async () => {
        if (abandoned()) throw abandonedError();
        let runtime = this.#runtimes.get(input.participantId);
        if (runtime !== undefined && runtime.state === "dead") {
          this.#runtimes.delete(input.participantId);
          runtime = undefined;
        }
        if (runtime !== undefined && runtime.state === "suspect") {
          // Review P1-1: retry the proof; without it nothing new may start.
          const proof = await this.#kill(runtime);
          if (!proof.proven)
            throw new Error(
              `warm runtime ${runtime.instanceRuntimeId} is suspect: its termination is not proven (${proof.reason}); new execution stays blocked`,
            );
          await this.#recordEnd(
            runtime,
            proof.exit,
            runtime.suspectReason ?? "crash",
          );
          runtime = undefined;
        }
        if (runtime !== undefined) {
          await this.#confirmRelease(runtime);
          // A release the Kernel fenced ended the runtime (proven kill).
          if (runtime.state === "dead") runtime = undefined;
        }
        if (runtime !== undefined) {
          if (runtime.state !== "idle")
            throw new Error(
              `warm runtime ${runtime.instanceRuntimeId} is ${runtime.state}; the lane is still held`,
            );
          const restart =
            runtime.retireReason !== undefined
              ? runtime.retireReason
              : runtime.key !== input.key
                ? "config_restart"
                : runtime.frameIntegrityLost
                  ? "resource_failure"
                  : runtime.pinned
                    ? undefined
                    : await this.#recycleReason(runtime, input.cliFingerprint);
          if (restart === undefined) {
            runtime.state = "busy";
            return { mode: "warm" as const, runtime };
          }
          await this.#stop(runtime, restart);
        }
        const cold = await this.#coldStart(
          input,
          this.#beginColdStart(input, false),
        );
        if (abandoned()) {
          // Ready and registered: kept idle for the next turn.
          this.#abandonAcquired(cold);
          throw abandonedError();
        }
        return { mode: "cold" as const, runtime: cold };
      });
    } catch (error) {
      this.#releaseSlot(slot);
      throw error;
    }
    // Outside the participant lock: evicting another instance takes its lock.
    await this.enforceWarmCap();
    // Review batch 1 #2: the Host may have given up on this start meanwhile;
    // its release already ran and will not run again.
    if (abandoned()) {
      this.#abandonAcquired(acquired.runtime);
      this.#releaseSlot(slot);
      throw abandonedError();
    }
    return acquired;
  }

  /** An acquired runtime whose turn was abandoned before it was opened. */
  #abandonAcquired(runtime: WarmRuntime): void {
    if (runtime.state !== "busy" || runtime.current !== undefined) return;
    runtime.state = "idle";
    runtime.lastActivityMs = this.#now();
  }

  /** After the Activation left `leased`: the Kernel releases the lane. */
  async releaseTurn(participantId: string, runAttemptId: string) {
    // Review batch 1 #2: a start still in flight for this RunAttempt (past
    // the Host's start deadline) gives back what it takes when it sees this.
    this.#releasedTurns.add(runAttemptId);
    while (this.#releasedTurns.size > RELEASED_TURN_LIMIT)
      this.#releasedTurns.delete(this.#releasedTurns.keys().next().value!);
    this.#releaseSlot(runAttemptId);
    this.#releaseSlot(participantId);
    // A waiter for a busy slot may be the abandoned turn: let it notice.
    for (const waiter of [...this.#admissionWaiters]) waiter();
    // Review of the review-2 fixes P1-1: a turn that never reached a
    // runtime (stopped while its start waited on this participant's
    // in-flight start) has nothing to release under the participant lock
    // and does not wait for that start; one still acquiring sees the
    // released mark above and gives back what it takes.
    const holder = this.#runtimes.get(participantId);
    if (
      holder?.current?.runAttemptId !== runAttemptId &&
      holder?.unreleasedRunAttemptId !== runAttemptId
    )
      return;
    await this.#serialize(participantId, async () => {
      const runtime = this.#runtimes.get(participantId);
      if (runtime === undefined) return;
      if (
        runtime.current?.runAttemptId !== runAttemptId &&
        runtime.unreleasedRunAttemptId !== runAttemptId
      )
        return;
      if (runtime.current?.runAttemptId === runAttemptId) {
        runtime.unreleasedRunAttemptId = runAttemptId;
        runtime.current = undefined;
      }
      if (runtime.state === "dead") return;
      await this.#confirmRelease(runtime);
      if (runtime.retireReason !== undefined && this.#evictable(runtime))
        await this.#stop(runtime, runtime.retireReason);
    });
    await this.enforceWarmCap();
  }

  /**
   * Owner 2026-09-27: start the instance's warm runtime before its first
   * turn — the same cold start (launch, spawn, readiness handshake, Kernel
   * row) a turn would do, then idle. No turn, busy slot or model call. A
   * prewarm never evicts or crowds out a live runtime: at the warm cap, the
   * Host run cap or this driver's run cap it is skipped with the reason.
   */
  async prewarm(input: {
    driver: string;
    key: string;
    launch: (layout: WarmRuntimeLayout) => Promise<WarmRuntimeLaunch>;
    limits: PrewarmLimits;
    participantId: string;
    cliFingerprint?: () => Promise<string | undefined>;
    /** Cancels the prewarm (the Host stops prewarming). */
    signal?: AbortSignal;
  }): Promise<
    | { kind: "started"; runtime: WarmRuntime }
    | { kind: "skipped"; reason: string }
  > {
    return await this.#serialize(input.participantId, async () => {
      if (input.signal?.aborted)
        return { kind: "skipped" as const, reason: "prewarm_cancelled" };
      const existing = this.#runtimes.get(input.participantId);
      if (existing !== undefined && existing.state !== "dead")
        return { kind: "skipped" as const, reason: "already_live" };
      const reason = this.#prewarmCapReason(input);
      if (reason !== undefined) return { kind: "skipped" as const, reason };
      // No await between the check and the reservation: `#coldStart`
      // records this start in `#starting` synchronously.
      const start = this.#beginColdStart(input, true);
      const job = this.#coldStart(input, start, input.limits);
      // Review of the review-2 fixes P1-1: bounded and cancellable. The
      // participant lock (which a real start's fence waits on) is held at
      // most until the deadline or the cancellation, plus a proven kill.
      const stop = await boundedStart(
        job,
        this.#prewarmTimeoutMs,
        input.signal,
      );
      if (stop.kind === "settled") {
        if (stop.error === undefined)
          return { kind: "started" as const, runtime: stop.runtime! };
        if (stop.error instanceof PrewarmYield)
          return { kind: "skipped" as const, reason: stop.error.reason };
        throw stop.error;
      }
      await this.#abandonPrewarm(input.participantId, start, stop.reason);
      return { kind: "skipped" as const, reason: stop.reason };
    });
  }

  /**
   * Review of the review-2 fixes P1-1: a prewarm past its bound or
   * cancelled. From here its continuation can no longer spawn, register a
   * ready runtime or be reused (it checks `abandoned` synchronously before
   * each), and the participant is released to the real start. What it
   * already spawned is killed with proof now; unproven, it stays suspect and
   * blocks the participant. A registered row that never spawned is recorded
   * as not started — this pool owns the only spawn and has forbidden it.
   */
  async #abandonPrewarm(
    participantId: string,
    start: ColdStart,
    reason: string,
  ): Promise<void> {
    start.abandoned = true;
    if (this.#starting.get(participantId) === start)
      this.#starting.delete(participantId);
    this.diagnostic(
      `[${start.instanceRuntimeId}] prewarm of ${participantId} abandoned: ${reason}`,
    );
    const runtime = start.runtime;
    if (runtime !== undefined && runtime.pid !== undefined) {
      start.recorded = true;
      runtime.state = "stopping";
      const proof = await this.#kill(runtime);
      if (!proof.proven) {
        this.#runtimes.set(participantId, runtime);
        await this.#markSuspect(runtime, "start_failed", proof.reason);
        return;
      }
      await this.#recordEnd(runtime, proof.exit, "start_failed");
      return;
    }
    if (start.registered && !start.recorded) {
      start.recorded = true;
      await this.#recordNotStarted(start.instanceRuntimeId);
    }
  }

  async #recordNotStarted(instanceRuntimeId: string): Promise<void> {
    try {
      await this.#control.instanceRuntimes!.recordExit({
        exit: { code: null, signal: "RAH_NOT_STARTED" },
        instanceRuntimeId,
        reason: "start_failed",
      });
    } catch (error) {
      this.diagnostic(
        `start failure of ${instanceRuntimeId} was not recorded: ${errorMessage(error)}`,
      );
    }
  }

  /**
   * Full review 2 batch 1 #5 (Codex P2-1, contract §6a): one count of this
   * Host's live CLI processes for prewarm admission — every warm runtime of
   * another participant (idle, busy, or still starting, by a prewarm or a
   * real turn) plus the Kernel placements no warm runtime holds (per-turn
   * cold CLI processes). Real starts are never refused here; the Kernel
   * placement caps admit them.
   */
  #prewarmCapReason(input: {
    driver: string;
    limits: PrewarmLimits;
    participantId: string;
  }): string | undefined {
    const others = new Map<string, { attached: boolean; driver: string }>();
    for (const runtime of this.#runtimes.values())
      if (
        runtime.state !== "dead" &&
        runtime.participantId !== input.participantId
      )
        others.set(runtime.participantId, {
          // Holding a placement: counted by the Kernel's reserved total too.
          attached:
            runtime.state === "busy" ||
            runtime.current !== undefined ||
            runtime.unreleasedRunAttemptId !== undefined,
          driver: runtime.driver,
        });
    for (const [participantId, start] of this.#starting)
      if (participantId !== input.participantId)
        others.set(participantId, {
          attached:
            (others.get(participantId)?.attached ?? false) || !start.prewarm,
          driver: start.driver,
        });
    const count = (driver?: string) => {
      const warm = [...others.values()].filter(
        (entry) => driver === undefined || entry.driver === driver,
      );
      const reserved =
        (driver === undefined
          ? input.limits.reserved
          : input.limits.reservedForDriver) ?? 0;
      const attached = warm.filter((entry) => entry.attached).length;
      return warm.length + Math.max(0, reserved - attached);
    };
    if (others.size >= this.policy.maxWarm) return "warm_cap";
    if (count() >= input.limits.maxLive) return "host_cap";
    if (count(input.driver) >= input.limits.maxLiveForDriver) return "cli_cap";
    return undefined;
  }

  /**
   * The instance was removed from its Channel: its runtime ends with proof
   * now when idle, else at the end of its current turn (never mid-turn).
   */
  async retire(participantId: string): Promise<void> {
    await this.#serialize(participantId, async () => {
      const runtime = this.#runtimes.get(participantId);
      if (runtime === undefined || runtime.state === "dead") return;
      runtime.retireReason = "removed";
      if (this.#evictable(runtime)) await this.#stop(runtime, "removed");
    });
  }

  /** Called by the adapter when a turn's process died. */
  async runtimeEnded(
    runtime: WarmRuntime,
    exit: { code: number | null; signal: string | null },
    reason: WarmRuntimeEndReason,
  ): Promise<void> {
    await this.#serialize(runtime.participantId, async () => {
      await this.#recordEnd(runtime, exit, reason);
    });
  }

  /** Evict idle runtimes whose last activity is older than their TTL. */
  async sweepIdle(): Promise<void> {
    for (const runtime of [...this.#runtimes.values()]) {
      await this.#serialize(runtime.participantId, async () => {
        if (this.#evictable(runtime) && runtime.retireReason !== undefined)
          await this.#stop(runtime, runtime.retireReason).catch(
            (error: unknown) => this.diagnostic(errorMessage(error)),
          );
        else if (
          this.#evictable(runtime) &&
          this.#now() - runtime.lastActivityMs >= this.idleTtlFor(runtime)
        )
          await this.#stop(runtime, "idle_ttl").catch((error: unknown) =>
            this.diagnostic(errorMessage(error)),
          );
      });
    }
    await this.enforceWarmCap();
  }

  /**
   * S2-b soft cap: above `maxWarm` live runtimes, stop the least recently
   * used evictable (idle, released, unpinned) ones. Busy runtimes are never
   * evicted, so the cap can be exceeded while they are busy.
   */
  async enforceWarmCap(): Promise<void> {
    const live = () =>
      [...this.#runtimes.values()].filter(
        (runtime) => runtime.state !== "dead",
      );
    const victims = live()
      .filter((runtime) => this.#evictable(runtime))
      .sort((left, right) => left.lastActivityMs - right.lastActivityMs);
    for (const victim of victims) {
      if (live().length <= this.policy.maxWarm) return;
      await this.#serialize(victim.participantId, async () => {
        if (this.#evictable(victim))
          await this.#stop(victim, "lru").catch((error: unknown) =>
            this.diagnostic(errorMessage(error)),
          );
      });
    }
  }

  #evictable(runtime: WarmRuntime): boolean {
    return (
      runtime.state === "idle" &&
      runtime.current === undefined &&
      runtime.unreleasedRunAttemptId === undefined &&
      !runtime.pinned
    );
  }

  /**
   * S2-b boundary recycling of an idle runtime before its next turn. A
   * measurement that cannot be read is not a change (diagnostic only).
   */
  async #recycleReason(
    runtime: WarmRuntime,
    cliFingerprint: (() => Promise<string | undefined>) | undefined,
  ): Promise<WarmStopReason | undefined> {
    if (cliFingerprint !== undefined && runtime.cliFingerprint !== undefined) {
      try {
        const current = await cliFingerprint();
        if (current !== undefined && current !== runtime.cliFingerprint)
          return "cli_changed";
      } catch (error) {
        this.diagnostic(
          `[${runtime.instanceRuntimeId}] CLI fingerprint unavailable: ${errorMessage(error)}`,
        );
      }
    }
    if (this.#now() - runtime.startedMs >= this.policy.maxAgeMs)
      return "recycle_age";
    if (runtime.admissionClosed !== undefined) return "recycle_rss";
    if (runtime.pid === undefined) return undefined;
    try {
      const rssKb = await this.measureGroupRssKb(runtime.pid);
      if (rssKb > this.policy.recycleRssKb) return "recycle_rss";
    } catch (error) {
      this.diagnostic(
        `[${runtime.instanceRuntimeId}] RSS measurement unavailable: ${errorMessage(error)}`,
      );
    }
    return undefined;
  }

  /**
   * Take a busy slot (hard cap), waiting at most `admissionWaitMs` (bounded
   * below the Host's start deadline); an abandoned turn stops waiting.
   */
  async #admit(slot: string, abandoned: () => boolean): Promise<void> {
    if (this.#busySlots.has(slot)) return;
    const deadline = Date.now() + this.#admissionWaitMs;
    while (this.#busySlots.size >= this.policy.maxBusyTurns) {
      if (abandoned())
        throw new Error(
          `warm turn ${slot} was released by the Host while it waited for a busy slot`,
        );
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new Error(
          `RAH_WARM_ADMISSION_FULL: ${String(this.#busySlots.size)} warm turns are busy (cap ${String(this.policy.maxBusyTurns)}); the Activation is retried later instead of holding its lease`,
        );
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, remaining);
        const waiters = this.#admissionWaiters;
        function done() {
          clearTimeout(timer);
          const index = waiters.indexOf(done);
          if (index >= 0) waiters.splice(index, 1);
          resolve();
        }
        waiters.push(done);
      });
    }
    this.#busySlots.add(slot);
  }

  /**
   * Runtime concurrency setting: the busy-turn hard cap follows raises of the
   * daemon's Host run cap and wakes turns waiting for a slot. A reduction is
   * enforced where work is admitted — the Kernel placement planner, the single
   * linearization point — which never revokes placements it already made. The
   * pool keeps its current cap for such a reduction: a turn the Kernel placed
   * under the old cap but that has not reached the pool yet (for example still
   * in the start gate) starts and drains naturally instead of failing
   * `RAH_WARM_ADMISSION_FULL` into a provider retry, while new placements are
   * held by the Kernel. The reduced value reaches the pool at its next
   * construction (the daemon passes the persisted cap in). Busy turns are never
   * interrupted.
   */
  setMaxBusyTurns(value: number): void {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error("maxBusyTurns must be a positive integer");
    if (value <= this.policy.maxBusyTurns) return;
    this.policy.maxBusyTurns = value;
    for (const waiter of [...this.#admissionWaiters]) waiter();
  }

  #releaseSlot(slot: string): void {
    if (!this.#busySlots.delete(slot)) return;
    this.#admissionWaiters[0]?.();
  }

  /** Host shutdown: stop every warm runtime (never takes over later). */
  async shutdown(): Promise<void> {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
    for (const runtime of [...this.#runtimes.values()])
      await this.#serialize(runtime.participantId, async () => {
        if (runtime.state !== "dead")
          await this.#stop(runtime, "host_shutdown").catch((error: unknown) =>
            this.diagnostic(errorMessage(error)),
          );
      });
  }

  /**
   * Host start / periodic janitor (S2 spec §2 crash table, §6 daemon
   * restart): every live runtime row this Host id owns that this process
   * does not hold — an older generation, or a crashed record of this one —
   * is killed after identity verification and proven terminated before the
   * participant may run again. Tagged leftovers of terminated runtimes are
   * swept. Uncertain identity is left blocking and reported.
   */
  async janitor(onlyParticipantId?: string): Promise<void> {
    const control = this.#control.instanceRuntimes!;
    const rows = (await control.list()).filter(
      (row) =>
        (onlyParticipantId === undefined ||
          row.participantId === onlyParticipantId) &&
        !this.#ownsRow(row),
    );
    for (const row of rows) {
      const killed = await this.#killForeign(row);
      if (killed === "uncertain") {
        this.diagnostic(
          `runtime ${row.instanceRuntimeId} of ${row.participantId} could not be proven stopped; new execution stays blocked`,
        );
        continue;
      }
      try {
        await control.recordExit({
          exit: {
            code: null,
            signal: killed === "killed" ? "SIGKILL" : "RAH_RUNTIME_GONE",
          },
          instanceRuntimeId: row.instanceRuntimeId,
          reason: row.hostGenerationCurrent
            ? row.pid === undefined
              ? "start_failed"
              : "crash"
            : "host_shutdown",
        });
      } catch (error) {
        this.diagnostic(
          `runtime ${row.instanceRuntimeId} exit record failed: ${errorMessage(error)}`,
        );
        continue;
      }
      await this.#sweep(row.participantId, row.instanceRuntimeId, "janitor");
      // Review batch 1 #7 (lifecycle P2-3): a crashed Host left its turn
      // root and socket directory behind; the recorded exit releases them.
      await this.#removeRuntimeDirectories(row.instanceRuntimeId);
    }
    if (onlyParticipantId === undefined)
      await this.#removeTerminatedLeftovers();
    if (this.#hygiene === undefined) return;
    const tagged = [...(await this.#hygiene.taggedRuntimeIds())].filter((id) =>
      id.startsWith("instrt_"),
    );
    if (tagged.length === 0) return;
    for (const target of await control.terminatedAmong(tagged)) {
      if (
        onlyParticipantId !== undefined &&
        target.participantId !== onlyParticipantId
      )
        continue;
      await this.#sweep(
        target.participantId,
        target.instanceRuntimeId,
        "janitor",
      );
    }
  }

  lateFrame(runtime: WarmRuntime, runAttemptId: string): void {
    this.markIncomplete(
      runtime,
      runAttemptId,
      `late frame of closed turn ${runAttemptId}`,
    );
  }

  /**
   * Review P2-1: a turn whose frame evidence cannot be proven complete
   * (late, lost, unattributable) gets a durable mark, which makes its usage
   * `partial`; an open turn awaits the write before its proof.
   */
  markIncomplete(
    runtime: WarmRuntime,
    turn: WarmTurn | string,
    reason: string,
  ): void {
    const runAttemptId = typeof turn === "string" ? turn : turn.runAttemptId;
    this.diagnostic(
      `[${runtime.instanceRuntimeId}] ${reason}; usage of ${runAttemptId} is incomplete`,
    );
    const write = this.#control
      .instanceRuntimes!.recordLateTurnFrame({ runAttemptId })
      .catch((error: unknown) =>
        this.diagnostic(
          `incomplete-evidence record failed: ${errorMessage(error)}`,
        ),
      );
    if (typeof turn !== "string") turn.integrityWrites.push(write);
  }

  /**
   * Synchronously, before any await: the reservation prewarm admission
   * counts and the ownership the start fence and janitor respect.
   */
  #beginColdStart(
    input: { driver: string; participantId: string },
    prewarm: boolean,
  ): ColdStart {
    const start: ColdStart = {
      abandoned: false,
      driver: input.driver,
      instanceRuntimeId: `instrt_${randomUUID()}`,
      prewarm,
      recorded: false,
      registered: false,
    };
    this.#starting.set(input.participantId, start);
    return start;
  }

  async #coldStart(
    input: {
      driver: string;
      key: string;
      launch: (layout: WarmRuntimeLayout) => Promise<WarmRuntimeLaunch>;
      participantId: string;
      cliFingerprint?: () => Promise<string | undefined>;
    },
    start: ColdStart,
    /** A prewarm: checked again before spawn, and left idle when ready. */
    prewarm?: PrewarmLimits,
  ): Promise<WarmRuntime> {
    try {
      return await this.#coldStartOwned(input, start, prewarm);
    } finally {
      if (this.#starting.get(input.participantId) === start)
        this.#starting.delete(input.participantId);
    }
  }

  async #coldStartOwned(
    input: {
      driver: string;
      key: string;
      launch: (layout: WarmRuntimeLayout) => Promise<WarmRuntimeLaunch>;
      participantId: string;
      cliFingerprint?: () => Promise<string | undefined>;
    },
    start: ColdStart,
    prewarm: PrewarmLimits | undefined,
  ): Promise<WarmRuntime> {
    const control = this.#control.instanceRuntimes!;
    const { instanceRuntimeId } = start;
    // Review of the review-2 fixes P1-1: an abandoned prewarm stops at its
    // next step; checked synchronously before every side effect.
    const live = () => {
      if (start.abandoned) throw new PrewarmAbandoned(instanceRuntimeId);
    };
    let cliFingerprint: string | undefined;
    try {
      cliFingerprint = await input.cliFingerprint?.();
    } catch (error) {
      this.diagnostic(
        `CLI fingerprint unavailable at cold start: ${errorMessage(error)}`,
      );
    }
    live();
    const registration = {
      ...(cliFingerprint === undefined ? {} : { cliFingerprint }),
      driver: input.driver,
      instanceRuntimeId,
      participantId: input.participantId,
    };
    try {
      await control.register(registration);
    } catch (error) {
      live();
      // An older runtime row (another generation, or a crash) blocks: prove
      // it gone first, then try once more.
      await this.janitor(input.participantId);
      live();
      await control.register(registration);
      this.diagnostic(
        `cold start for ${input.participantId} waited for an older runtime: ${errorMessage(error)}`,
      );
    }
    start.registered = true;
    const directory = join(this.#stateDirectory, instanceRuntimeId);
    const socketDirectory = this.#socketDirectoryFor(instanceRuntimeId);
    let runtime: WarmRuntime | undefined;
    try {
      live();
      await mkdir(this.#socketRoot, { mode: 0o700, recursive: true });
      await mkdir(socketDirectory, { mode: 0o700 });
      const turnRoot = await createWorkerTurnRoot(directory);
      const binDirectory = join(directory, "bin");
      await mkdir(binDirectory, { mode: 0o700 });
      const workerCli = await writeWorkerCliWrapper(binDirectory);
      const layout: WarmRuntimeLayout = {
        binDirectory,
        instanceRuntimeId,
        socketDirectory,
        turnRoot,
        workerCli,
      };
      runtime = new WarmRuntime({
        driver: input.driver,
        instanceRuntimeId,
        key: input.key,
        layout,
        nowMs: this.#now(),
        participantId: input.participantId,
        pool: this,
      });
      runtime.cliFingerprint = cliFingerprint;
      start.runtime = runtime;
      live();
      const launch = await input.launch(layout);
      // Full review 2 batch 1 #5: real execution first — a prewarm that has
      // not spawned yet yields to starts that took the capacity meanwhile.
      // Review of the review-2 fixes P2-1: against the Kernel's caps and
      // reservations read now, not the plan's copy; synchronous from this
      // read to the spawn, with this pool's in-flight starts counted.
      let yieldReason: string | undefined;
      if (start.abandoned) yieldReason = "prewarm_abandoned";
      else if (prewarm !== undefined)
        try {
          yieldReason = this.#prewarmCapReason({
            driver: input.driver,
            limits: currentPrewarmLimits(prewarm),
            participantId: input.participantId,
          });
        } catch (error) {
          yieldReason =
            error instanceof PrewarmYield
              ? error.reason
              : `limits_unavailable: ${errorMessage(error)}`;
        }
      if (yieldReason !== undefined) {
        try {
          await launch.release?.();
        } catch (error) {
          this.diagnostic(
            `[${instanceRuntimeId}] runtime environment release failed: ${errorMessage(error)}`,
          );
        }
        live();
        throw new PrewarmYield(yieldReason);
      }
      runtime.spawn(launch);
      const spawned = runtime;
      void spawned.exited.then((exit) => this.#onExit(spawned, exit));
      const pid = runtime.pid;
      if (pid === undefined) throw new Error("warm runtime has no pid");
      // Review P1-3: the physical identity is durable before native ready,
      // so a crash in the startup window never looks like "never started".
      const identity = (await this.processTable.identities([pid])).get(pid);
      live();
      if (identity === undefined)
        throw new Error("warm runtime identity could not be read");
      runtime.setProcessStartedAt(identity.startedAt);
      await control.recordSpawned({
        instanceRuntimeId,
        pgid: pid,
        pid,
        processStartedAt: identity.startedAt,
      });
      live();
      const ready = await runtime.waitReady(this.#readyTimeoutMs);
      live();
      if (ready.kind === "failed") throw new Error(ready.error);
      runtime.nativeSessionId = ready.threadId;
      runtime.sessionResumeMs = ready.sessionResumeMs;
      if (ready.sessionResumeMs !== null)
        this.#lastColdResumeMs.set(input.participantId, ready.sessionResumeMs);
      await control.markReady({
        instanceRuntimeId,
        nativeSessionId: ready.threadId,
        pgid: pid,
        pid,
        processStartedAt: identity.startedAt,
        ...(ready.sessionResumeMs === null
          ? {}
          : { sessionResumeMs: ready.sessionResumeMs }),
      });
      // Never reused once abandoned: ready is not proof it may serve.
      live();
      runtime.state = prewarm === undefined ? "busy" : "idle";
      runtime.lastActivityMs = this.#now();
      this.#runtimes.set(input.participantId, runtime);
      return runtime;
    } catch (error) {
      if (start.abandoned) {
        // The abandonment owns the spawned process and its record; the
        // participant may already run a newer start. Only local leftovers.
        if (!start.recorded) {
          start.recorded = true;
          await this.#recordNotStarted(instanceRuntimeId);
        }
        if (runtime === undefined || runtime.pid === undefined) {
          await runtime?.releaseLaunch();
          await this.#removeDirectories(directory, socketDirectory);
        }
        throw error;
      }
      if (runtime !== undefined) runtime.state = "stopping";
      const proof =
        runtime === undefined || runtime.pid === undefined
          ? undefined
          : await this.#kill(runtime);
      if (runtime !== undefined && proof !== undefined && !proof.proven) {
        // Review P1-1: the started process may live on. It stays recorded
        // (with its spawn identity) and blocks the participant as suspect.
        this.#runtimes.set(input.participantId, runtime);
        await this.#markSuspect(runtime, "start_failed", proof.reason);
        throw error;
      }
      try {
        await control.recordExit({
          exit:
            proof === undefined || !proof.proven
              ? { code: null, signal: "RAH_NOT_STARTED" }
              : normalizedExit(proof.exit),
          instanceRuntimeId,
          reason: "start_failed",
        });
      } catch (recordError) {
        this.diagnostic(
          `start failure of ${instanceRuntimeId} was not recorded: ${errorMessage(recordError)}`,
        );
      }
      await runtime?.releaseLaunch();
      await this.#removeDirectories(directory, socketDirectory);
      await this.#sweep(
        input.participantId,
        instanceRuntimeId,
        "runtime_crash",
      );
      throw error;
    }
  }

  async #confirmRelease(runtime: WarmRuntime): Promise<void> {
    const runAttemptId = runtime.unreleasedRunAttemptId;
    if (runAttemptId === undefined) return;
    try {
      await this.#control.instanceRuntimes!.releaseTurn({
        instanceRuntimeId: runtime.instanceRuntimeId,
        runAttemptId,
      });
    } catch (error) {
      if (!isExecutionFenced(error)) throw error;
      // Review batch 1 #3 (lifecycle P1-2): the Kernel no longer lets this
      // runtime hold the lane (its row turned suspect when the turn was
      // orphaned by lease expiry or quarantine). The Kernel row is the only
      // state source: end the process with proof, record its exit, sweep;
      // the next turn cold starts and resumes the recorded native session.
      this.diagnostic(
        `[${runtime.instanceRuntimeId}] the Kernel fenced the lane release of ${runAttemptId} (${errorMessage(error)}); stopping the runtime with proof`,
      );
      const proof = await this.killRuntime(runtime, "crash");
      if (!proof.proven)
        throw new Error(
          `warm runtime ${runtime.instanceRuntimeId} is suspect: its termination is not proven (${proof.reason}); new execution stays blocked`,
        );
      runtime.unreleasedRunAttemptId = undefined;
      await this.#recordEnd(runtime, proof.exit, "crash");
      return;
    }
    runtime.unreleasedRunAttemptId = undefined;
    if (runtime.state === "busy") runtime.state = "idle";
    runtime.lastActivityMs = this.#now();
  }

  #onExit(
    runtime: WarmRuntime,
    exit: { code: number | null; signal: string | null },
  ): void {
    // The start and stop paths own their own exit; a suspect runtime's late
    // real close is the proof it was missing.
    if (
      runtime.state === "starting" ||
      runtime.state === "stopping" ||
      runtime.state === "dead"
    )
      return;
    if (runtime.state === "suspect") {
      void this.runtimeEnded(
        runtime,
        exit,
        runtime.suspectReason ?? "crash",
      ).catch((error: unknown) =>
        this.diagnostic(`runtime end record failed: ${errorMessage(error)}`),
      );
      return;
    }
    const turn = runtime.current;
    if (turn !== undefined && !turn.outcome.settled) {
      // The turn owner (adapter + AgentHost) records its process_exit proof;
      // the runtime row follows once the turn is settled.
      settle(turn.outcome, { exit: normalizedExit(exit), kind: "exit" });
      settle(turn.admission, {
        error: "warm runtime exited",
        kind: "failed",
        rejected: false,
      });
    }
    void this.runtimeEnded(runtime, exit, "crash").catch((error: unknown) =>
      this.diagnostic(`runtime end record failed: ${errorMessage(error)}`),
    );
  }

  async #recordEnd(
    runtime: WarmRuntime,
    exit: { code: number | null; signal: string | null },
    reason: WarmRuntimeEndReason,
  ): Promise<void> {
    if (runtime.state === "dead") return;
    runtime.state = "dead";
    if (this.#runtimes.get(runtime.participantId) === runtime)
      this.#runtimes.delete(runtime.participantId);
    try {
      await this.#control.instanceRuntimes!.recordExit({
        exit: normalizedExit(exit),
        instanceRuntimeId: runtime.instanceRuntimeId,
        reason,
      });
    } catch (error) {
      this.diagnostic(
        `runtime ${runtime.instanceRuntimeId} exit was not recorded: ${errorMessage(error)}`,
      );
    }
    await runtime.releaseLaunch();
    await this.#removeDirectories(
      join(this.#stateDirectory, runtime.instanceRuntimeId),
      runtime.layout.socketDirectory,
    );
    await this.#sweep(
      runtime.participantId,
      runtime.instanceRuntimeId,
      reason === "crash" ||
        reason === "stall" ||
        reason === "resource_failure" ||
        reason === "start_failed"
        ? "runtime_crash"
        : "run_end",
    );
  }

  async #markSuspect(
    runtime: WarmRuntime,
    reason: WarmRuntimeEndReason,
    why: string,
  ): Promise<void> {
    runtime.state = "suspect";
    runtime.suspectReason = reason;
    this.diagnostic(
      `runtime ${runtime.instanceRuntimeId} of ${runtime.participantId} could not be proven terminated (${why}); it stays suspect and new execution is blocked`,
    );
    try {
      await this.#control.instanceRuntimes!.markSuspect({
        instanceRuntimeId: runtime.instanceRuntimeId,
      });
    } catch (error) {
      this.diagnostic(
        `runtime ${runtime.instanceRuntimeId} suspect state was not recorded: ${errorMessage(error)}`,
      );
    }
  }

  async #stop(runtime: WarmRuntime, reason: WarmStopReason): Promise<void> {
    if (runtime.state === "dead") return;
    runtime.state = "stopping";
    try {
      runtime.command({ op: "shutdown" });
    } catch {
      // Control channel already closed; the group kill below still applies.
    }
    const exit = await this.#waitExit(runtime, this.#stopTimeoutMs);
    // Review batch 1 #7 (lifecycle P2-2): the driver's own exit is not the
    // group's; the same proof standard as a kill applies.
    const proof: WarmKillProof =
      exit === undefined
        ? await this.#kill(runtime)
        : await this.#reapGroup(runtime, exit);
    if (!proof.proven) {
      await this.#markSuspect(runtime, reason, proof.reason);
      throw new Error(
        `warm runtime ${runtime.instanceRuntimeId} termination was not proven (${proof.reason}); it stays suspect`,
      );
    }
    runtime.state = "stopping";
    await this.#recordEnd(runtime, proof.exit, reason);
  }

  /**
   * SIGTERM, grace, SIGKILL to the runtime's whole process group. Proven
   * only by a real close or identity-verified absence (review P1-1).
   */
  async #kill(runtime: WarmRuntime): Promise<WarmKillProof> {
    const term = runtime.signalGroup("SIGTERM");
    const graceful = await this.#waitExit(runtime, this.#killGraceMs);
    if (graceful !== undefined) return await this.#reapGroup(runtime, graceful);
    const kill = runtime.signalGroup("SIGKILL");
    const killed = await this.#waitExit(runtime, this.#killWaitMs);
    if (killed !== undefined) return await this.#reapGroup(runtime, killed);
    if (await runtime.verifiedAbsent(this.processTable))
      return { exit: { code: null, signal: "RAH_RUNTIME_GONE" }, proven: true };
    return {
      proven: false,
      reason: `no close after SIGKILL (SIGTERM ${term}, SIGKILL ${kill})`,
    };
  }

  /**
   * The group leader closed: SIGKILL whatever is left in its group and
   * require identity-verified absence of the whole group as the proof.
   */
  async #reapGroup(
    runtime: WarmRuntime,
    exit: { code: number | null; signal: string | null },
  ): Promise<WarmKillProof> {
    const kill = runtime.signalGroup("SIGKILL");
    const deadline = Date.now() + this.#killWaitMs;
    for (;;) {
      if (await runtime.verifiedAbsent(this.processTable))
        return { exit, proven: true };
      if (Date.now() >= deadline)
        return {
          proven: false,
          reason: `the runtime's leader exited but its process group is still present after SIGKILL (${kill})`,
        };
      await delay(25);
    }
  }

  /** Kill with proof; an unproven kill leaves the runtime suspect. */
  async killRuntime(
    runtime: WarmRuntime,
    reason: WarmRuntimeEndReason,
  ): Promise<WarmKillProof> {
    runtime.state = "stopping";
    const proof = await this.#kill(runtime);
    if (!proof.proven) await this.#markSuspect(runtime, reason, proof.reason);
    return proof;
  }

  /**
   * Kill a runtime whose turn cannot be quiesced (cancel timeout, binding
   * failure): the open turn's outcome becomes the real process exit. An
   * unproven kill gives the turn no exit and throws: its execution record
   * stays open (quarantine) and the lane stays held.
   */
  async abortRuntime(
    runtime: WarmRuntime,
    reason: "crash" | "stall" | "resource_failure",
  ): Promise<{ code: number | null; signal: string | null }> {
    const proof = await this.killRuntime(runtime, reason);
    const turn = runtime.current;
    if (!proof.proven) {
      const error = `warm runtime termination was not proven: ${proof.reason}`;
      if (turn !== undefined) {
        turn.outcome.resolve({ error, kind: "unproven" });
        turn.admission.resolve({
          error: "warm runtime stopped",
          kind: "failed",
          rejected: false,
        });
      }
      throw new Error(error);
    }
    const exit = proof.exit;
    if (turn !== undefined) {
      turn.outcome.resolve({ exit: normalizedExit(exit), kind: "exit" });
      turn.admission.resolve({
        error: "warm runtime stopped",
        kind: "failed",
        rejected: false,
      });
    }
    await this.runtimeEnded(runtime, exit, reason);
    return exit;
  }

  async #waitExit(runtime: WarmRuntime, timeoutMs: number) {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        runtime.exited,
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async #killForeign(row: {
    instanceRuntimeId: string;
    participantId: string;
    pgid?: number;
    pid?: number;
    processStartedAt?: string;
  }): Promise<"killed" | "gone" | "uncertain"> {
    // Tagged descendants first (identity-verified by the sweeper).
    const sweep = await this.#sweep(
      row.participantId,
      row.instanceRuntimeId,
      "janitor",
    );
    if (row.pid === undefined) {
      // Review P1-3: no recorded identity is not "never started". Only a
      // complete tagged sweep that left nothing proves the start window.
      if (sweep.complete && sweep.remaining === 0 && sweep.unknown === 0)
        return "gone";
      this.diagnostic(
        `runtime ${row.instanceRuntimeId} has no recorded process identity and its tagged sweep ${sweep.complete ? `left ${String(sweep.remaining)} remaining and ${String(sweep.unknown)} unknown` : `is unavailable: ${sweep.error}`}`,
      );
      return "uncertain";
    }
    const table = this.processTable;
    let identity;
    try {
      identity = (await table.identities([row.pid])).get(row.pid);
    } catch (error) {
      this.diagnostic(
        `runtime ${row.instanceRuntimeId} identity could not be read: ${errorMessage(error)}`,
      );
      return "uncertain";
    }
    if (identity === undefined) return "gone";
    // Without a recorded birth time a live pid cannot be told apart.
    if (row.processStartedAt === undefined) return "uncertain";
    if (
      identity.startedAt !== row.processStartedAt ||
      identity.uid !== process.getuid?.()
    )
      return "gone"; // A different process now owns the pid.
    const group = row.pgid ?? row.pid;
    for (const signal of ["SIGTERM", "SIGKILL"] as const) {
      try {
        this.signalProcess(-group, signal);
      } catch {
        // Gone in between, or refused: only the identity poll below decides.
      }
      const deadline = Date.now() + (signal === "SIGTERM" ? 1_000 : 5_000);
      while (Date.now() < deadline) {
        const current = (await table.identities([row.pid])).get(row.pid);
        if (current === undefined || current.startedAt !== row.processStartedAt)
          return "killed";
        await delay(25);
      }
    }
    return "uncertain";
  }

  async #sweep(
    participantId: string,
    runtimeId: string,
    trigger: "run_end" | "runtime_crash" | "janitor",
  ): Promise<WarmSweepEvidence> {
    if (this.#hygiene === undefined)
      return { complete: false, error: "no leftover-process sweeper" };
    try {
      const result = await this.#hygiene.afterRuntime(this.#control, {
        participantId,
        runtimeId,
        trigger,
      });
      if (result !== undefined && !result.complete)
        this.diagnostic(
          `leftover sweep of runtime ${runtimeId} failed: ${result.error}`,
        );
      return result ?? { complete: false, error: "sweep gave no result" };
    } catch (error) {
      this.diagnostic(
        `leftover sweep of runtime ${runtimeId} failed: ${errorMessage(error)}`,
      );
      return { complete: false, error: errorMessage(error) };
    }
  }

  async #removeDirectories(directory: string, socketDirectory: string) {
    try {
      await removeWorkerTurnRoot(join(directory, "turns"));
      await rm(directory, { force: true, recursive: true });
      await rm(socketDirectory, { force: true, recursive: true });
    } catch (error) {
      this.diagnostic(
        `runtime directory cleanup failed (the next Host-start janitor retries it once the runtime is recorded terminated): ${errorMessage(error)}`,
      );
    }
  }

  async #removeRuntimeDirectories(instanceRuntimeId: string): Promise<void> {
    await this.#removeDirectories(
      join(this.#stateDirectory, instanceRuntimeId),
      this.#socketDirectoryFor(instanceRuntimeId),
    );
  }

  /** Directories of runtimes the Kernel records terminated (earlier Hosts). */
  async #removeTerminatedLeftovers(): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.#stateDirectory);
    } catch {
      return; // No runtime was ever started here.
    }
    const held = new Set(
      [...this.#runtimes.values()].map((runtime) => runtime.instanceRuntimeId),
    );
    const candidates = entries.filter(
      (entry) => entry.startsWith("instrt_") && !held.has(entry),
    );
    for (let index = 0; index < candidates.length; index += 500) {
      let terminated;
      try {
        terminated = await this.#control.instanceRuntimes!.terminatedAmong(
          candidates.slice(index, index + 500),
        );
      } catch (error) {
        this.diagnostic(
          `terminated runtime lookup failed: ${errorMessage(error)}`,
        );
        return;
      }
      for (const target of terminated)
        await this.#removeRuntimeDirectories(target.instanceRuntimeId);
    }
  }

  #socketDirectoryFor(instanceRuntimeId: string): string {
    return join(
      this.#socketRoot,
      instanceRuntimeId.slice("instrt_".length, "instrt_".length + 12),
    );
  }

  async #serialize<T>(participantId: string, operation: () => Promise<T>) {
    const previous = this.#locks.get(participantId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    const tail = next.catch(() => undefined);
    this.#locks.set(participantId, tail);
    try {
      return await next;
    } finally {
      if (this.#locks.get(participantId) === tail)
        this.#locks.delete(participantId);
    }
  }
}

/** Prewarm admission: the Kernel plan's run caps and reserved placements. */
type PrewarmLimits = {
  maxLive: number;
  maxLiveForDriver: number;
  reserved?: number;
  reservedForDriver?: number;
  /** Review of the review-2 fixes P2-1: the capacity owner's caps now. */
  current?: () => Omit<PrewarmLimits, "current"> | undefined;
};

/** One cold start in flight (Kernel row registered, not ready yet). */
type ColdStart = {
  driver: string;
  instanceRuntimeId: string;
  prewarm: boolean;
  /** Review of the review-2 fixes P1-1: past its bound or cancelled. */
  abandoned: boolean;
  /** Its Kernel row exists. */
  registered: boolean;
  /** Its end is recorded (or owned by the abandonment). */
  recorded: boolean;
  runtime?: WarmRuntime;
};

/** Longer than a normal launch preparation; added to the ready timeout. */
const DEFAULT_PREWARM_PREPARATION_MS = 15_000;

/** The Kernel's current caps for the final admission; the plan's if unread. */
function currentPrewarmLimits(limits: PrewarmLimits): PrewarmLimits {
  if (limits.current === undefined) return limits;
  let current: Omit<PrewarmLimits, "current"> | undefined;
  try {
    current = limits.current();
  } catch (error) {
    throw new PrewarmYield(`limits_unavailable: ${errorMessage(error)}`);
  }
  if (current === undefined) throw new PrewarmYield("limits_unavailable");
  return current;
}

/**
 * A prewarm start raced against its bound and its cancellation. The start
 * itself keeps running when it loses; the caller abandons it.
 */
async function boundedStart(
  job: Promise<WarmRuntime>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<
  | { kind: "settled"; runtime?: WarmRuntime; error?: unknown }
  | { kind: "stopped"; reason: string }
> {
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      job.then(
        (runtime) => ({ kind: "settled" as const, runtime }),
        (error: unknown) => ({ error, kind: "settled" as const }),
      ),
      new Promise<{ kind: "stopped"; reason: string }>((resolve) => {
        timer = setTimeout(
          () => resolve({ kind: "stopped", reason: "prewarm_timeout" }),
          timeoutMs,
        );
        timer.unref?.();
        onAbort = () =>
          resolve({ kind: "stopped", reason: "prewarm_cancelled" });
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort);
  }
}

/** The continuation of a prewarm that was abandoned. */
class PrewarmAbandoned extends Error {
  constructor(instanceRuntimeId: string) {
    super(`prewarm ${instanceRuntimeId} was abandoned`);
  }
}

/** A prewarm that gave its capacity to real execution before spawning. */
class PrewarmYield extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`prewarm yielded before spawn: ${reason}`);
    this.reason = reason;
  }
}

function normalizedExit(exit: { code: number | null; signal: string | null }) {
  return exit.code === null
    ? { code: null, signal: exit.signal ?? "RAH_RUNTIME_GONE" }
    : {
        code: exit.code,
        ...(exit.signal === null ? {} : { signal: exit.signal }),
      };
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const state: Deferred<T> = {
    promise: new Promise<T>((settle) => {
      resolve = settle;
    }),
    resolve: (value) => {
      if (state.settled) return;
      state.settled = true;
      resolve(value);
    },
    settled: false,
  };
  return state;
}

function settle<T>(state: Deferred<T>, value: T): void {
  state.resolve(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The Kernel's execution fence (`ExecutionFencedError`, any transport). */
function isExecutionFenced(error: unknown): boolean {
  return (
    errorCode(error) === "execution_fenced" ||
    (error instanceof Error && error.name === "ExecutionFencedError")
  );
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
