import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { isSea } from "node:sea";
import { fileURLToPath } from "node:url";

import type { ResolvedModel } from "@rah-os/protocol";

import {
  BoundedOutput,
  RuntimeTrajectoryCollector,
  type ActivationEnvironmentLease,
  type GenericProcessAdapterOptions,
} from "./generic-process-adapter.ts";
import {
  InstanceRuntimePool,
  WARM_RUNTIME_RECOVERY_DRIVER,
  type WarmRuntime,
  type WarmTurn,
  type WarmTurnOutcome,
} from "./instance-runtime-pool.ts";
import { resolveActivationEnvironment } from "./launch-environment-policy.ts";
import {
  LOOM_RUN_ID_ENV,
  LOOM_RUNTIME_ID_ENV,
} from "./leftover-process-sweeper.ts";
import {
  ACTIVATION_ENVIRONMENT_LINE,
  providerActivationInput,
} from "./provider-activation-input.js";
import { classifyRuntimeFailure } from "./runtime-error-policy.ts";
import type {
  ActivationEnvelope,
  RunExit,
  RunHandle,
  RuntimeAdapter,
  RuntimeAvailability,
  RuntimeBusyNotice,
  RuntimeStartLifecycle,
} from "./runtime.ts";
import { validBusyNotice } from "./runtime-busy-input.ts";
import {
  issueWorkerTurnHandle,
  RAH_WORKER_TURN_ROOT_ENV,
} from "./worker-turn-handle.ts";
import {
  RAH_AGENT_TOOL_BIN_ENV,
  RAH_WORKER_API_URL_ENV,
  RAH_WORKER_CLI_ENV,
  RAH_WORKER_SESSION_FILE_ENV,
} from "./worker-credential-file.ts";

/**
 * S2-a Codex warm process per Role instance (S2 spec §2–§5).
 *
 * Per Activation (one RunAttempt, one native turn on the instance's warm
 * `codex app-server`):
 *   1. acquire the instance runtime (warm reuse, or cold start + resume);
 *   2. Kernel `beginTurn` takes the lane for this RunAttempt;
 *   3. a random per-turn handle is issued under the non-listable turn root;
 *      it appears only in this turn's wake text;
 *   4. the per-turn execution record is prepared, the bodied wake rendered;
 *   5. `turn/start` carries the wake, model and effort (frozen per turn);
 *      the native acceptance id is recorded;
 *   6. Human busy input may `turn/steer` this exact turn (Kernel selects only
 *      Human messages of the same Room; private-box work waits in the Inbox);
 *   7. on the matching `turn/completed` the driver drains, the handle is
 *      revoked and removed, the process group identity is re-verified, and
 *      the Host records `turn_quiesced` (or `process_exit` if the process died
 *      or cannot be proven quiet);
 *   8. the lane is released only after the Activation left `leased`.
 * Cancel: native interrupt, quiesce on the interrupted completion within
 * `interruptQuiesceTimeoutMs`, else kill the runtime group (process_exit).
 * Legacy Agents (no instance channel) keep the per-turn adapter unchanged.
 */
export const CODEX_WARM_DRIVER_KIND = "codex-app-server-warm/v1";
const CODEX_WARM_DRIVER_PATH = fileURLToPath(
  new URL("./codex-warm-driver.mjs", import.meta.url),
);
const DEFAULT_INTERRUPT_QUIESCE_TIMEOUT_MS = 10_000;
const DEFAULT_ACCEPT_TIMEOUT_MS = 30_000;
const RUNTIME_NOTICE_LIMIT = 300;

export type WarmWorkerCredential = {
  accessToken: string;
  revoke: () => Promise<void> | void;
};

export type CodexWarmAdapterOptions = {
  pool: InstanceRuntimePool;
  /** The per-turn adapter used for everything that is not a warm turn. */
  legacy: RuntimeAdapter & {
    readonly busyInputMode?: "direct" | "gated" | undefined;
  };
  cwd: string;
  /** Driver argv after the entry: executable, tool access, legacy prompt. */
  driverArgs: readonly string[];
  env?: Readonly<Record<string, string>>;
  resolvedModel?: ResolvedModel;
  /** Runtime-level lease (prompt, memory, provider config, resume args). */
  runtimeEnvironment: (
    input: ActivationEnvelope,
  ) => Promise<ActivationEnvironmentLease>;
  issueWorkerCredential: (
    input: ActivationEnvelope,
  ) => Promise<WarmWorkerCredential>;
  workerApiOrigin: string;
  /** Launch identity: a different key restarts the runtime at idle. */
  runtimeKey: (input: ActivationEnvelope) => string;
  isWarm?: (input: ActivationEnvelope) => boolean;
  renderWake?: (input: {
    env: Readonly<Record<string, string | undefined>>;
    participantId: string;
  }) => Promise<string | undefined>;
  recordProviderSessionEvidence?: (
    input: ActivationEnvelope,
    evidence: Parameters<
      NonNullable<GenericProcessAdapterOptions["recordProviderSessionEvidence"]>
    >[1],
    standingPromptDigest: string | undefined,
  ) => Promise<void> | void;
  recordDeliveryAcceptance?: GenericProcessAdapterOptions["recordDeliveryAcceptance"];
  acceptTimeoutMs?: number;
  interruptQuiesceTimeoutMs?: number;
};

type TurnBinding = {
  runtime: WarmRuntime;
  turn: WarmTurn;
  instanceRuntimeId: string;
  settled?: Promise<RunExit>;
};

export class CodexWarmAdapter implements RuntimeAdapter {
  readonly guideRuntimeId = "codex";
  readonly busyInputMode = "direct" as const;
  readonly busyInputSupported = true;
  readonly #options: CodexWarmAdapterOptions;
  readonly #turns = new Map<string, TurnBinding>();

  constructor(options: CodexWarmAdapterOptions) {
    this.#options = options;
  }

  get recoveryDrivers(): readonly string[] {
    return this.#options.legacy.recoveryDrivers ?? [];
  }

  async probe(): Promise<RuntimeAvailability> {
    return await this.#options.legacy.probe();
  }

  #warm(input: ActivationEnvelope): boolean {
    if (isSea()) return false; // the packaged product has no warm entry yet
    return (
      this.#options.isWarm?.(input) ??
      input.agent?.instanceChannelId !== undefined
    );
  }

  async start(
    input: ActivationEnvelope,
    lifecycle: RuntimeStartLifecycle,
  ): Promise<RunHandle> {
    if (!this.#warm(input))
      return await this.#options.legacy.start(input, lifecycle);
    const pool = this.#options.pool;
    const control = pool.control.instanceRuntimes!;
    let standingPromptDigest: string | undefined;
    let launchEnvironment: Readonly<Record<string, string>> = {};
    const acquired = await pool.acquire({
      driver: CODEX_WARM_DRIVER_KIND,
      key: this.#options.runtimeKey(input),
      launch: async (layout) => {
        const lease = await this.#options.runtimeEnvironment(input);
        standingPromptDigest = lease.standingPromptDigest;
        launchEnvironment = lease.env;
        const model = this.#options.resolvedModel;
        return {
          args: [
            isSea() ? "__codex-warm-driver" : CODEX_WARM_DRIVER_PATH,
            ...this.#options.driverArgs,
            ...(model?.source === "custom_model" ||
            model?.source === "explicit_binding"
              ? ["--model", model.modelId]
              : []),
            ...(model?.source === "explicit_binding" &&
            model.reasoning !== undefined &&
            model.reasoning !== "default"
              ? ["--reasoning", model.reasoning]
              : []),
            ...(lease.args ?? []),
            "--runtime-id",
            layout.instanceRuntimeId,
            "--host-generation",
            pool.hostGeneration,
            "--socket-dir",
            layout.socketDirectory,
          ],
          cwd: this.#options.cwd,
          env: resolveActivationEnvironment({
            configured: this.#options.env ?? {},
            // Stable identity only: per-turn values live in the handle scope.
            fences: {
              [LOOM_RUNTIME_ID_ENV]: layout.instanceRuntimeId,
              [LOOM_RUN_ID_ENV]: layout.instanceRuntimeId,
              RAH_CONSUMER_ID: input.consumerId,
              RAH_HOST_ID: input.hostId,
              RAH_PARTICIPANT_ID: input.participantId,
            },
            inherited: process.env,
            leased: {
              ...lease.env,
              [RAH_AGENT_TOOL_BIN_ENV]: layout.binDirectory,
              [RAH_WORKER_API_URL_ENV]: this.#options.workerApiOrigin,
              [RAH_WORKER_CLI_ENV]: layout.workerCli,
              [RAH_WORKER_TURN_ROOT_ENV]: layout.turnRoot,
            },
          }),
          ...(lease.release === undefined ? {} : { release: lease.release }),
        };
      },
      participantId: input.participantId,
    });
    const runtime = acquired.runtime;
    if (acquired.mode === "cold") {
      runtime.standingPromptDigest = standingPromptDigest;
      runtime.launchEnvironment = launchEnvironment;
    }
    const runtimeRunId = `turn:${randomUUID()}`;
    const turn = runtime.openTurn(input.runAttemptId, runtimeRunId);
    const binding: TurnBinding = {
      instanceRuntimeId: runtime.instanceRuntimeId,
      runtime,
      turn,
    };
    this.#turns.set(runtimeRunId, binding);
    const handle: RunHandle = {
      leftoverSweep: "adapter",
      processTag: runtime.instanceRuntimeId,
      recoveryDescriptor: {
        driver: WARM_RUNTIME_RECOVERY_DRIVER,
        metadata: {},
        recoveryKey: runtime.instanceRuntimeId,
      },
      runId: runtimeRunId,
    };
    await control.beginTurn({
      executionMode: acquired.mode,
      instanceRuntimeId: runtime.instanceRuntimeId,
      runAttemptId: input.runAttemptId,
    });
    const credential = await this.#options.issueWorkerCredential(input);
    turn.handle = await issueWorkerTurnHandle(runtime.layout.turnRoot, {
      revoke: credential.revoke,
      scope: turnScope(input),
      token: credential.accessToken,
    });
    const diagnostics = new BoundedOutput(65_536, [credential.accessToken]);
    let preparedDigest: string | undefined;
    turn.collector = new RuntimeTrajectoryCollector({
      activation: input,
      diagnostics,
      lifecycle,
      onBindingFailure: () => {
        pool.diagnostic(
          `[${runtime.instanceRuntimeId}] session binding failed; stopping the runtime`,
        );
        void pool.abortRuntime(runtime, "crash");
      },
      ...(this.#options.recordProviderSessionEvidence === undefined
        ? {}
        : {
            // Keyed by the digest this process was launched with, so a
            // later cold start resumes the same record.
            recordProviderSessionEvidence: async (activation, evidence) =>
              await this.#options.recordProviderSessionEvidence!(
                activation,
                evidence,
                runtime.standingPromptDigest,
              ),
          }),
      recordDeliveryAcceptance: async (activation, acceptance) => {
        if (preparedDigest === undefined) return;
        if (acceptance.inputSha256 !== preparedDigest)
          throw new Error(
            "runtime delivery acceptance does not match the prepared wake input",
          );
        await this.#options.recordDeliveryAcceptance?.(activation, acceptance);
      },
      redactions: [credential.accessToken],
      runAttemptId: input.runAttemptId,
      runtimeRunId,
    });
    await lifecycle.registerPrepared(handle);
    const wake = await this.#wakeText(input, runtime, turn);
    preparedDigest = wake.bodied
      ? createHash("sha256").update(wake.text, "utf8").digest("hex")
      : undefined;
    turn.beginSent = true;
    runtime.command({
      op: "turn.begin",
      // Restated only inside this native turn after a native compaction.
      restate: workerTurnHandleLine(turn.handle.handle),
      runAttemptId: input.runAttemptId,
      runtimeRunId,
      text: wake.text,
      ...turnModel(this.#options.resolvedModel),
    });
    const admission = await withTimeout(
      turn.admission.promise,
      this.#options.acceptTimeoutMs ?? DEFAULT_ACCEPT_TIMEOUT_MS,
      {
        error: "turn/start acceptance timed out",
        kind: "failed" as const,
        rejected: false,
      },
    );
    if (admission.kind === "failed")
      throw new Error(
        `warm turn was not admitted${admission.rejected ? " (rejected by Codex)" : " (ambiguous)"}: ${admission.error}`,
      );
    await control.recordTurnAccepted({
      instanceRuntimeId: runtime.instanceRuntimeId,
      nativeTurnId: admission.nativeTurnId,
      runAttemptId: input.runAttemptId,
    });
    return handle;
  }

  async reap(run: RunHandle): Promise<RunExit> {
    const binding = this.#turns.get(run.runId);
    if (binding === undefined) return await this.#options.legacy.reap(run);
    return await this.#settle(binding, await binding.turn.outcome.promise);
  }

  async cancel(run: RunHandle): Promise<RunExit> {
    const binding = this.#turns.get(run.runId);
    if (binding === undefined) return await this.#options.legacy.cancel(run);
    const { runtime, turn } = binding;
    if (turn.outcome.settled)
      return await this.#settle(binding, await turn.outcome.promise);
    turn.cancelRequested = true;
    const admission = turn.admission.settled
      ? await turn.admission.promise
      : undefined;
    if (
      turn.beginSent !== true ||
      (admission?.kind === "failed" && admission.rejected)
    ) {
      // Codex rejected turn/start: no native turn exists, nothing ran.
      return await this.#settle(binding, {
        inFlightToolCount: 0,
        kind: "drained",
        lastFrameSeq: turn.lastFrameSeq,
        nativeTurnId: "",
        status: "rejected",
      });
    }
    if (admission?.kind === "accepted") {
      try {
        runtime.command({
          op: "turn.interrupt",
          runAttemptId: turn.runAttemptId,
        });
      } catch {
        // Channel closed: the kill below proves termination.
      }
      const outcome = await withTimeout(
        turn.outcome.promise,
        this.#options.interruptQuiesceTimeoutMs ??
          DEFAULT_INTERRUPT_QUIESCE_TIMEOUT_MS,
        undefined,
      );
      if (outcome !== undefined) return await this.#settle(binding, outcome);
    }
    // No quiescence within the bound (or an ambiguous admission): kill the
    // runtime's group; the proof becomes a real process exit.
    const exit = await this.#options.pool.abortRuntime(runtime, "stall");
    return await this.#settle(binding, {
      exit: runExitFrom(exit),
      kind: "exit",
    });
  }

  async isAlive(run: RunHandle): Promise<boolean> {
    const binding = this.#turns.get(run.runId);
    if (binding === undefined)
      return (await this.#options.legacy.isAlive?.(run)) ?? true;
    return binding.runtime.state !== "dead";
  }

  async notifyBusy(
    run: RunHandle,
    notice: RuntimeBusyNotice,
  ): Promise<boolean> {
    const binding = this.#turns.get(run.runId);
    if (binding === undefined)
      return (await this.#options.legacy.notifyBusy?.(run, notice)) ?? false;
    const { runtime, turn } = binding;
    if (
      turn.collector === undefined ||
      turn.framesClosed ||
      turn.outcome.settled ||
      turn.nativeTurnId === undefined ||
      !validBusyNotice(notice)
    )
      return false;
    return await turn.collector.busyInput.send(
      { fingerprint: notice.fingerprint, text: notice.text },
      async (line) => {
        runtime.command({
          line,
          op: "turn.notice",
          runAttemptId: turn.runAttemptId,
        });
      },
    );
  }

  async recover(
    input: Parameters<NonNullable<RuntimeAdapter["recover"]>>[0],
  ): Promise<RunExit> {
    const recover = this.#options.legacy.recover;
    if (recover === undefined) throw new Error("recovery is unavailable");
    return await recover.call(this.#options.legacy, input);
  }

  async releaseTurn(input: {
    participantId: string;
    runAttemptId: string;
  }): Promise<void> {
    for (const [runId, binding] of this.#turns)
      if (binding.turn.runAttemptId === input.runAttemptId) {
        this.#turns.delete(runId);
        // A start that failed after taking the lane still releases it here.
        await binding.turn.handle?.release();
      }
    await this.#options.pool.releaseTurn(
      input.participantId,
      input.runAttemptId,
    );
  }

  async #wakeText(
    input: ActivationEnvelope,
    runtime: WarmRuntime,
    turn: WarmTurn,
  ): Promise<{ bodied: boolean; text: string }> {
    const handle = turn.handle!.handle;
    let bodied: string | undefined;
    if (this.#options.renderWake !== undefined) {
      try {
        bodied = await this.#options.renderWake({
          // Memory is compared with this process's launch snapshot.
          env: {
            ...runtime.launchEnvironment,
            [RAH_WORKER_API_URL_ENV]: this.#options.workerApiOrigin,
            [RAH_WORKER_SESSION_FILE_ENV]: turn.handle!.tokenPath,
          },
          participantId: input.participantId,
        });
      } catch (error) {
        this.#options.pool.diagnostic(
          `[${runtime.instanceRuntimeId}] bodied wake unavailable, using the startup wake: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const base = bodied ?? providerActivationInput();
    const notice = (input.runtimeNotice ?? "")
      .split("\n")[0]!
      .trim()
      .slice(0, RUNTIME_NOTICE_LIMIT);
    return {
      bodied: bodied !== undefined,
      text:
        withWorkerTurnHandle(base, handle) +
        (notice === "" ? "" : `\n${notice}`),
    };
  }

  async #settle(
    binding: TurnBinding,
    outcome: WarmTurnOutcome,
  ): Promise<RunExit> {
    binding.settled ??= this.#settleOnce(binding, outcome);
    return await binding.settled;
  }

  async #settleOnce(
    binding: TurnBinding,
    outcome: WarmTurnOutcome,
  ): Promise<RunExit> {
    const { runtime, turn } = binding;
    const pool = this.#options.pool;
    runtime.closeTurnFrames(turn);
    // Evidence of frames through lastFrameSeq is queued; drain it before
    // the handle goes away and the proof is written.
    await turn.collector?.finish();
    const release = await turn.handle?.release();
    if (release !== undefined && !release.revoked)
      pool.diagnostic(
        `[${runtime.instanceRuntimeId}] turn credential revocation failed (execution is fenced by quiescence): ${release.revokeError}`,
      );
    if (release !== undefined && !release.removed)
      pool.diagnostic(
        `[${runtime.instanceRuntimeId}] turn handle directory removal failed; the janitor removes it: ${release.removeError}`,
      );
    if (outcome.kind === "exit") return outcome.exit;
    const failure =
      turn.collector?.terminalFailure ??
      (outcome.status === "failed" || outcome.status === "rejected"
        ? classifyRuntimeFailure(
            outcome.errorMessage ??
              `Codex turn ended with status ${outcome.status}`,
          )
        : undefined);
    const alive = await runtime.processGroupAlive(pool.processTable);
    if (!alive || outcome.inFlightToolCount > 0) {
      // Not provably quiet: end the runtime and prove a real exit instead.
      const exit = alive
        ? await pool.killRuntime(runtime)
        : await runtime.exited;
      await pool.runtimeEnded(runtime, exit, "crash");
      return {
        ...runExitFrom(exit),
        failure:
          failure ??
          classifyRuntimeFailure(
            alive
              ? "warm turn left tools in flight; runtime stopped"
              : "warm runtime process group vanished at turn end",
          ),
      };
    }
    const result =
      outcome.status === "completed" && failure === undefined
        ? "success"
        : outcome.status === "interrupted" && turn.cancelRequested
          ? "cancelled"
          : "error";
    return {
      code: null,
      ...(failure === undefined ? {} : { failure }),
      quiesced: {
        closeSeq: outcome.lastFrameSeq,
        inFlightToolCount: outcome.inFlightToolCount,
        instanceRuntimeId: binding.instanceRuntimeId,
        nativeTurnId: outcome.nativeTurnId === "" ? null : outcome.nativeTurnId,
        processGroupAlive: true,
        result,
      },
    };
  }
}

/** The warm wake line: this turn's handle, used on every Worker command. */
export function withWorkerTurnHandle(text: string, handle: string): string {
  const line = `Start this RAH OS Activation now. ${workerTurnHandleLine(handle)}`;
  return text.includes(ACTIVATION_ENVIRONMENT_LINE)
    ? text.replace(ACTIVATION_ENVIRONMENT_LINE, line)
    : `${line}\n${text}`;
}

function workerTurnHandleLine(handle: string): string {
  return `Worker turn handle: ${handle}. Pass \`--turn ${handle}\` to every "$RAH_WORKER_CLI" command for this Activation; handles from earlier turns are revoked.`;
}

function turnScope(input: ActivationEnvelope): Record<string, string> {
  return {
    RAH_ACTIVATION_ID: input.activationId,
    RAH_ACTIVATION_REASON: input.reason,
    ...(input.agent === undefined
      ? {}
      : { RAH_AGENT_CONTEXT_JSON: JSON.stringify(input.agent) }),
    RAH_CONSUMER_ID: input.consumerId,
    ...(input.contextManifest === undefined
      ? {}
      : { RAH_CONTEXT_MANIFEST_JSON: JSON.stringify(input.contextManifest) }),
    RAH_FROM_SEQ: String(input.fromSeq),
    RAH_ROOM_ID: input.roomId,
    RAH_RUN_ATTEMPT_ID: input.runAttemptId,
    RAH_TO_SEQ: String(input.toSeq),
  };
}

function turnModel(model: ResolvedModel | undefined) {
  if (model?.source !== "custom_model" && model?.source !== "explicit_binding")
    return {};
  return {
    model: model.modelId,
    ...(model.source === "explicit_binding" &&
    model.reasoning !== undefined &&
    model.reasoning !== "default"
      ? { effort: model.reasoning }
      : {}),
  };
}

function runExitFrom(exit: {
  code: number | null;
  signal: string | null;
}): RunExit {
  return exit.code === null
    ? { code: null, signal: exit.signal ?? "RAH_RUNTIME_GONE" }
    : {
        code: exit.code,
        ...(exit.signal === null ? {} : { signal: exit.signal }),
      };
}

async function withTimeout<T, F>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: F,
): Promise<T | F> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<F>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
