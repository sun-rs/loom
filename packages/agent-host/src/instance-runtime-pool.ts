import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
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
import { writeWorkerCliWrapper } from "./worker-tool-transport.ts";
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
 * session), idle after the lane is released, evicted after an idle TTL
 * (never mid-turn), restarted at an idle boundary when its launch key
 * changes, and a crash while idle leaves the next turn to cold start and
 * resume. A Host start first proves every live runtime row of an older
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
  | "config_restart"
  | "host_shutdown"
  | "resource_failure"
  | "start_failed";

export type WarmTurnAdmission =
  | { kind: "accepted"; nativeTurnId: string }
  | { kind: "failed"; error: string; rejected: boolean };

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  settled: boolean;
};

export type WarmTurn = {
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
};

export type InstanceRuntimePoolOptions = {
  control: AgentHostControlPort;
  hostGeneration: string;
  /** Owner-private directory for runtime turn roots and CLI wrappers. */
  stateDirectory: string;
  /** Short socket directory root (Unix socket paths are length-limited). */
  socketRoot?: string;
  hygiene?: RuntimeProcessHygiene;
  idleTtlMs?: number;
  now?: () => number;
  onDiagnostic?: (message: string) => void;
  processTable?: ProcessTable;
  readyTimeoutMs?: number;
  stopTimeoutMs?: number;
  /** SIGTERM grace, then the wait for a real close after SIGKILL. */
  killGraceMs?: number;
  killWaitMs?: number;
  /** Signal delivery (`process.kill`); replaceable to simulate failures. */
  signalProcess?: (pid: number, signal: NodeJS.Signals | 0) => void;
};

export class WarmRuntime {
  readonly instanceRuntimeId: string;
  readonly participantId: string;
  readonly key: string;
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
    instanceRuntimeId: string;
    key: string;
    layout: WarmRuntimeLayout;
    participantId: string;
    pool: InstanceRuntimePool;
    nowMs: number;
  }) {
    this.instanceRuntimeId = input.instanceRuntimeId;
    this.key = input.key;
    this.layout = input.layout;
    this.participantId = input.participantId;
    this.#pool = input.pool;
    this.lastActivityMs = input.nowMs;
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
        });
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
  readonly #locks = new Map<string, Promise<unknown>>();
  readonly #stateDirectory: string;
  readonly #socketRoot: string;
  readonly #hygiene: RuntimeProcessHygiene | undefined;
  readonly #idleTtlMs: number;
  readonly #now: () => number;
  readonly #onDiagnostic: (message: string) => void;
  readonly #readyTimeoutMs: number;
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
    this.#idleTtlMs = options.idleTtlMs ?? DEFAULT_WARM_IDLE_TTL_MS;
    this.#now = options.now ?? Date.now;
    this.#onDiagnostic =
      options.onDiagnostic ??
      ((message) => process.stderr.write(`[loom warm-runtime] ${message}\n`));
    this.#processTable = options.processTable;
    this.#readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
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
    return this.#idleTtlMs;
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

  /** Periodic idle eviction; resolves nothing and never blocks shutdown. */
  start(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(
      () => void this.sweepIdle().catch(() => undefined),
      Math.max(1_000, Math.min(this.#idleTtlMs, 60_000)),
    );
    this.#timer.unref();
  }

  /**
   * One warm runtime for this participant and launch key: reuse the idle
   * one, restart it at this idle boundary when the key changed, or cold
   * start (resuming the recorded native session through `launch`).
   */
  async acquire(input: {
    driver: string;
    key: string;
    launch: (layout: WarmRuntimeLayout) => Promise<WarmRuntimeLaunch>;
    participantId: string;
  }): Promise<{ mode: "warm" | "cold"; runtime: WarmRuntime }> {
    return await this.#serialize(input.participantId, async () => {
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
        if (runtime.state !== "idle")
          throw new Error(
            `warm runtime ${runtime.instanceRuntimeId} is ${runtime.state}; the lane is still held`,
          );
        if (runtime.key === input.key && !runtime.frameIntegrityLost) {
          runtime.state = "busy";
          return { mode: "warm" as const, runtime };
        }
        await this.#stop(
          runtime,
          runtime.frameIntegrityLost ? "resource_failure" : "config_restart",
        );
      }
      return {
        mode: "cold" as const,
        runtime: await this.#coldStart(input),
      };
    });
  }

  /** After the Activation left `leased`: the Kernel releases the lane. */
  async releaseTurn(participantId: string, runAttemptId: string) {
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

  /** Evict idle runtimes whose last activity is older than the idle TTL. */
  async sweepIdle(): Promise<void> {
    for (const runtime of [...this.#runtimes.values()]) {
      await this.#serialize(runtime.participantId, async () => {
        if (
          runtime.state === "idle" &&
          runtime.unreleasedRunAttemptId === undefined &&
          this.#now() - runtime.lastActivityMs >= this.#idleTtlMs
        )
          await this.#stop(runtime, "idle_ttl").catch((error: unknown) =>
            this.diagnostic(errorMessage(error)),
          );
      });
    }
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
        this.#runtimes.get(row.participantId)?.instanceRuntimeId !==
          row.instanceRuntimeId,
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
    }
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

  async #coldStart(input: {
    driver: string;
    key: string;
    launch: (layout: WarmRuntimeLayout) => Promise<WarmRuntimeLaunch>;
    participantId: string;
  }): Promise<WarmRuntime> {
    const control = this.#control.instanceRuntimes!;
    const instanceRuntimeId = `instrt_${randomUUID()}`;
    try {
      await control.register({
        driver: input.driver,
        instanceRuntimeId,
        participantId: input.participantId,
      });
    } catch (error) {
      // An older runtime row (another generation, or a crash) blocks: prove
      // it gone first, then try once more.
      await this.janitor(input.participantId);
      await control.register({
        driver: input.driver,
        instanceRuntimeId,
        participantId: input.participantId,
      });
      this.diagnostic(
        `cold start for ${input.participantId} waited for an older runtime: ${errorMessage(error)}`,
      );
    }
    const directory = join(this.#stateDirectory, instanceRuntimeId);
    const socketDirectory = join(
      this.#socketRoot,
      instanceRuntimeId.slice("instrt_".length, "instrt_".length + 12),
    );
    let runtime: WarmRuntime | undefined;
    try {
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
        instanceRuntimeId,
        key: input.key,
        layout,
        nowMs: this.#now(),
        participantId: input.participantId,
        pool: this,
      });
      const launch = await input.launch(layout);
      runtime.spawn(launch);
      const spawned = runtime;
      void spawned.exited.then((exit) => this.#onExit(spawned, exit));
      const pid = runtime.pid;
      if (pid === undefined) throw new Error("warm runtime has no pid");
      // Review P1-3: the physical identity is durable before native ready,
      // so a crash in the startup window never looks like "never started".
      const identity = (await this.processTable.identities([pid])).get(pid);
      if (identity === undefined)
        throw new Error("warm runtime identity could not be read");
      runtime.setProcessStartedAt(identity.startedAt);
      await control.recordSpawned({
        instanceRuntimeId,
        pgid: pid,
        pid,
        processStartedAt: identity.startedAt,
      });
      const ready = await runtime.waitReady(this.#readyTimeoutMs);
      if (ready.kind === "failed") throw new Error(ready.error);
      runtime.nativeSessionId = ready.threadId;
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
      runtime.state = "busy";
      this.#runtimes.set(input.participantId, runtime);
      return runtime;
    } catch (error) {
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
    await this.#control.instanceRuntimes!.releaseTurn({
      instanceRuntimeId: runtime.instanceRuntimeId,
      runAttemptId,
    });
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
      reason === "crash" || reason === "stall" || reason === "start_failed"
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

  async #stop(
    runtime: WarmRuntime,
    reason:
      "idle_ttl" | "config_restart" | "host_shutdown" | "resource_failure",
  ): Promise<void> {
    if (runtime.state === "dead") return;
    runtime.state = "stopping";
    try {
      runtime.command({ op: "shutdown" });
    } catch {
      // Control channel already closed; the group kill below still applies.
    }
    const exit = await this.#waitExit(runtime, this.#stopTimeoutMs);
    const proof: WarmKillProof =
      exit === undefined ? await this.#kill(runtime) : { exit, proven: true };
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
    if (graceful !== undefined) {
      runtime.signalGroup("SIGKILL");
      return { exit: graceful, proven: true };
    }
    const kill = runtime.signalGroup("SIGKILL");
    const killed = await this.#waitExit(runtime, this.#killWaitMs);
    if (killed !== undefined) return { exit: killed, proven: true };
    if (await runtime.verifiedAbsent(this.processTable))
      return { exit: { code: null, signal: "RAH_RUNTIME_GONE" }, proven: true };
    return {
      proven: false,
      reason: `no close after SIGKILL (SIGTERM ${term}, SIGKILL ${kill})`,
    };
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
    reason: "crash" | "stall",
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
        `runtime directory cleanup failed (janitor retries): ${errorMessage(error)}`,
      );
    }
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
