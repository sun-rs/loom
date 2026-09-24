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
  | { kind: "exit"; exit: RunExit };

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
};

export class WarmRuntime {
  readonly instanceRuntimeId: string;
  readonly participantId: string;
  readonly key: string;
  readonly layout: WarmRuntimeLayout;
  state: "starting" | "idle" | "busy" | "stopping" | "dead" = "starting";
  lastActivityMs: number;
  /** Digest of the standing prompt this process was launched with. */
  standingPromptDigest: string | undefined;
  /** The runtime-level lease environment (memory paths, system snapshot). */
  launchEnvironment: Readonly<Record<string, string>> = {};
  /** A turn whose Kernel lane release has not been confirmed yet. */
  unreleasedRunAttemptId: string | undefined;
  current: WarmTurn | undefined;
  readonly #recent = new Map<string, true>();
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
    (child.stdio[3] as NodeJS.ReadableStream | null)?.on(
      "data",
      (chunk: Buffer) => {
        buffer += decoder.write(chunk);
        if (buffer.length > 4 * 1024 * 1024) {
          this.#pool.diagnostic(
            `[${this.instanceRuntimeId}] fd3 frame buffer overflow`,
          );
          buffer = "";
          return;
        }
        for (;;) {
          const newline = buffer.indexOf("\n");
          if (newline < 0) break;
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line.trim() !== "") this.#route(line);
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
    this.#recent.set(turn.runAttemptId, true);
    while (this.#recent.size > RECENT_TURN_LIMIT)
      this.#recent.delete(this.#recent.keys().next().value!);
  }

  /** Physical process group liveness with identity (pid + start time). */
  async processGroupAlive(table: ProcessTable): Promise<boolean> {
    const pid = this.#pid;
    if (pid === undefined || this.state === "dead") return false;
    try {
      process.kill(-pid, 0);
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

  signalGroup(signal: NodeJS.Signals): void {
    const pid = this.#pid;
    if (pid === undefined) return;
    try {
      process.kill(-pid, signal);
    } catch {
      // Already gone.
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
      envelope.seq <= this.#lastSeq
    ) {
      this.#pool.diagnostic(
        `[${this.instanceRuntimeId}] rejected fd3 frame outside this runtime's identity or order`,
      );
      return;
    }
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
      if (runtime !== undefined) {
        await this.#confirmRelease(runtime);
        if (runtime.state !== "idle")
          throw new Error(
            `warm runtime ${runtime.instanceRuntimeId} is ${runtime.state}; the lane is still held`,
          );
        if (runtime.key === input.key) {
          runtime.state = "busy";
          return { mode: "warm" as const, runtime };
        }
        await this.#stop(runtime, "config_restart");
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
    reason: "crash" | "stall",
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
          await this.#stop(runtime, "idle_ttl");
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
          await this.#stop(runtime, "host_shutdown");
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
    this.diagnostic(
      `[${runtime.instanceRuntimeId}] late frame of closed turn ${runAttemptId}; its usage is incomplete`,
    );
    void this.#control
      .instanceRuntimes!.recordLateTurnFrame({ runAttemptId })
      .catch((error: unknown) =>
        this.diagnostic(`late frame record failed: ${errorMessage(error)}`),
      );
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
      const ready = await runtime.waitReady(this.#readyTimeoutMs);
      if (ready.kind === "failed") throw new Error(ready.error);
      const pid = runtime.pid;
      if (pid === undefined) throw new Error("warm runtime has no pid");
      const identity = (await this.processTable.identities([pid])).get(pid);
      if (identity === undefined)
        throw new Error("warm runtime identity could not be read");
      runtime.setProcessStartedAt(identity.startedAt);
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
      void runtime.exited.then((exit) => this.#onExit(runtime!, exit));
      return runtime;
    } catch (error) {
      if (runtime !== undefined) runtime.state = "stopping";
      const exit =
        runtime === undefined || runtime.pid === undefined
          ? undefined
          : await this.#kill(runtime);
      try {
        await control.recordExit({
          exit:
            exit === undefined
              ? { code: null, signal: "RAH_NOT_STARTED" }
              : normalizedExit(exit),
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
    if (runtime.state === "stopping" || runtime.state === "dead") return;
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
    reason: "crash" | "stall" | "idle_ttl" | "config_restart" | "host_shutdown",
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
      reason === "crash" || reason === "stall" ? "runtime_crash" : "run_end",
    );
  }

  async #stop(
    runtime: WarmRuntime,
    reason: "idle_ttl" | "config_restart" | "host_shutdown",
  ): Promise<void> {
    if (runtime.state === "dead") return;
    runtime.state = "stopping";
    try {
      runtime.command({ op: "shutdown" });
    } catch {
      // Control channel already closed; the group kill below still applies.
    }
    const exit = await this.#waitExit(runtime, this.#stopTimeoutMs);
    const final = exit ?? (await this.#kill(runtime));
    runtime.state = "stopping";
    await this.#recordEnd(runtime, final, reason);
  }

  /** SIGTERM, grace, SIGKILL to the runtime's whole process group. */
  async #kill(
    runtime: WarmRuntime,
  ): Promise<{ code: number | null; signal: string | null }> {
    runtime.signalGroup("SIGTERM");
    const graceful = await this.#waitExit(runtime, 1_000);
    if (graceful !== undefined) {
      runtime.signalGroup("SIGKILL");
      return graceful;
    }
    runtime.signalGroup("SIGKILL");
    return (
      (await this.#waitExit(runtime, 5_000)) ?? {
        code: null,
        signal: "SIGKILL",
      }
    );
  }

  async killRuntime(
    runtime: WarmRuntime,
  ): Promise<{ code: number | null; signal: string | null }> {
    runtime.state = "stopping";
    return await this.#kill(runtime);
  }

  /**
   * Kill a runtime whose turn cannot be quiesced (cancel timeout, binding
   * failure): the open turn's outcome becomes the real process exit.
   */
  async abortRuntime(
    runtime: WarmRuntime,
    reason: "crash" | "stall",
  ): Promise<{ code: number | null; signal: string | null }> {
    const exit = await this.killRuntime(runtime);
    const turn = runtime.current;
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
    await this.#sweep(row.participantId, row.instanceRuntimeId, "janitor");
    if (row.pid === undefined) return "gone";
    const table = this.processTable;
    const identity = (await table.identities([row.pid])).get(row.pid);
    if (identity === undefined) return "gone";
    if (
      row.processStartedAt === undefined ||
      identity.startedAt !== row.processStartedAt ||
      identity.uid !== process.getuid?.()
    )
      return "gone"; // A different process now owns the pid.
    const group = row.pgid ?? row.pid;
    for (const signal of ["SIGTERM", "SIGKILL"] as const) {
      try {
        process.kill(-group, signal);
      } catch {
        // Gone in between.
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
  ): Promise<void> {
    if (this.#hygiene === undefined) return;
    try {
      await this.#hygiene.afterRuntime(this.#control, {
        participantId,
        runtimeId,
        trigger,
      });
    } catch (error) {
      this.diagnostic(
        `leftover sweep of runtime ${runtimeId} failed: ${errorMessage(error)}`,
      );
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
