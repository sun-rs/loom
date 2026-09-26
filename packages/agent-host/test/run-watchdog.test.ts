import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";

import {
  AgentHost,
  decideRunWatchdog,
  RUN_WATCHDOG_MAX_DURATION,
  RUN_WATCHDOG_QUEUED_STALL,
  type RunExit,
  type RunHandle,
  type RuntimeAdapter,
  type RuntimeStartLifecycle,
} from "../src/index.ts";

/**
 * evo §37 B on the per-turn (cold) path: AgentHost supervises every run no
 * adapter supervises itself. Fake runtime and a fake clock; no real CLI.
 */

const MINUTE = 60_000;
const CONTEXT = {
  maxRunMs: 240 * MINUTE,
  noProgressWarnMs: 15 * MINUTE,
  queuedStallTerminateMs: 15 * MINUTE,
  queuedWorkWaiting: false,
};

test("watchdog rule: warn on no progress, terminate only with queued work or at the duration cap", () => {
  assert.deepEqual(
    decideRunWatchdog({ context: CONTEXT, elapsedMs: MINUTE, idleMs: MINUTE }),
    { kind: "none" },
  );
  assert.deepEqual(
    decideRunWatchdog({
      context: CONTEXT,
      elapsedMs: 60 * MINUTE,
      idleMs: 50 * MINUTE,
    }),
    { kind: "warn", thresholdMs: 15 * MINUTE },
    "no kill while nobody waits, however long the stall",
  );
  assert.deepEqual(
    decideRunWatchdog({
      context: { ...CONTEXT, queuedWorkWaiting: true },
      elapsedMs: 16 * MINUTE,
      idleMs: 15 * MINUTE,
    }),
    { kind: "terminate", reason: "queued_stall" },
  );
  assert.deepEqual(
    decideRunWatchdog({
      context: CONTEXT,
      elapsedMs: 240 * MINUTE,
      idleMs: 0,
    }),
    { kind: "terminate", reason: "max_duration" },
  );
  assert.deepEqual(
    decideRunWatchdog({
      context: { ...CONTEXT, queuedWorkWaiting: true },
      elapsedMs: 30 * MINUTE,
      idleMs: undefined,
    }),
    { kind: "none" },
    "a run that cannot stall (awaiting approval) is never stall-terminated",
  );
  assert.equal(
    decideRunWatchdog({
      context: CONTEXT,
      elapsedMs: 2 * MINUTE,
      idleMs: 2 * MINUTE,
    }).kind,
    "none",
    "no first-event start kill",
  );
});

test("a stalled cold run with nothing queued is only warned about and completes normally", async () => {
  const state = fixture();
  try {
    state.mention("first");
    const runtime = new ScriptedRuntime(state, {
      exitAtMs: 40 * MINUTE,
    });
    const result = await state.host(runtime).reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    assert.equal(runtime.cancellations, 0, "never terminated");
    const warnings = state.events("run.watchdog_warning");
    assert.equal(warnings.length, 1, "one warning for the stall episode");
    assert.equal(warnings[0]!.thresholdMs, 15 * MINUTE);
    assert.equal(state.runs()[0]!.state, "exited");
  } finally {
    state.close();
  }
});

test("a stalled cold run is terminated with proof once work for the same instance is queued, and its Activation retries", async () => {
  const state = fixture();
  try {
    state.mention("first");
    const runtime = new ScriptedRuntime(state, {
      onTick: (clockMs) => {
        if (clockMs === 5 * MINUTE) state.mention("second");
      },
    });
    const result = await state.host(runtime).reconcileOnce();
    assert.equal(result.state, "failed", JSON.stringify(result));
    assert.equal(runtime.cancellations, 1);
    assert.ok(
      runtime.cancelledAtMs! >= 15 * MINUTE &&
        runtime.cancelledAtMs! < 17 * MINUTE,
      `terminated at the stall threshold (${String(runtime.cancelledAtMs)})`,
    );
    const [run] = state.runs();
    assert.equal(run!.state, "timed_out");
    assert.equal(run!.error, RUN_WATCHDOG_QUEUED_STALL);
    const process = state.sql(
      "SELECT state FROM runtime_processes WHERE run_attempt_id = ?",
      String(run!.run_attempt_id),
    )[0];
    assert.equal(process!.state, "terminated", "termination proven");
    const activations = state.sql(
      "SELECT state FROM activations WHERE state IN ('queued', 'leased', 'quarantined')",
    );
    assert.deepEqual(
      activations.map((row) => row.state),
      ["queued"],
      "the killed Activation retries with the queued follow-up merged in",
    );
    assert.equal(state.events("activation.retry_scheduled").length, 1);
  } finally {
    state.close();
  }
});

test("a progressing cold run reaching the total duration cap is terminated with proof and retried", async () => {
  const state = fixture();
  try {
    state.mention("first");
    const runtime = new ScriptedRuntime(state, { progressEveryTick: true });
    const result = await state.host(runtime).reconcileOnce();
    assert.equal(result.state, "failed", JSON.stringify(result));
    assert.equal(runtime.cancellations, 1);
    assert.ok(runtime.cancelledAtMs! >= 240 * MINUTE);
    assert.equal(state.runs()[0]!.error, RUN_WATCHDOG_MAX_DURATION);
    assert.equal(
      state.events("run.watchdog_warning").length,
      0,
      "progress means no stall warning",
    );
  } finally {
    state.close();
  }
});

test("a watchdog-terminated run whose final reply already committed completes without re-execution", async () => {
  const state = fixture();
  try {
    state.kernel.runGuards.update({ watchdog: { maxRunMs: 2 * MINUTE } });
    state.mention("first");
    const runtime = new ScriptedRuntime(state, { finalReply: true });
    const result = await state.host(runtime).reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    assert.equal(runtime.cancellations, 1, "the wedged run was terminated");
    assert.equal(state.runs()[0]!.state, "timed_out", "the real end is kept");
    assert.deepEqual(
      state.sql("SELECT state FROM activations").map((row) => row.state),
      ["completed"],
    );
  } finally {
    state.close();
  }
});

test("watchdog thresholds are read live: a lowered cap applies to the running run without restart", async () => {
  const state = fixture();
  try {
    state.mention("first");
    const runtime = new ScriptedRuntime(state, {
      progressEveryTick: true,
      onTick: (clockMs) => {
        if (clockMs === 2 * MINUTE)
          state.kernel.runGuards.update({
            watchdog: { maxRunMs: 10 * MINUTE },
          });
      },
    });
    await state.host(runtime).reconcileOnce();
    assert.ok(
      runtime.cancelledAtMs! >= 10 * MINUTE &&
        runtime.cancelledAtMs! < 12 * MINUTE,
      `terminated at the new cap (${String(runtime.cancelledAtMs)})`,
    );
  } finally {
    state.close();
  }
});

test("the same watchdog failure three times in a row stops the instance through the existing retry fence", async () => {
  const state = fixture();
  try {
    state.kernel.runGuards.update({ watchdog: { maxRunMs: 2 * MINUTE } });
    state.mention("first");
    const results = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const runtime = new ScriptedRuntime(state, { progressEveryTick: true });
      results.push((await state.host(runtime).reconcileOnce()).state);
    }
    assert.deepEqual(results, ["failed", "failed", "failed"]);
    const [activation] = state.sql(
      "SELECT state, last_error FROM activations WHERE state <> 'completed'",
    );
    assert.equal(activation!.state, "quarantined");
    assert.equal(activation!.last_error, RUN_WATCHDOG_MAX_DURATION);
    const blocked = state.events("activation.retry_blocked");
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0]!.sameErrorCount, 3);
  } finally {
    state.close();
  }
});

type State = ReturnType<typeof fixture>;

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "loom-run-watchdog-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const agent = kernel.provisionPrincipal({ handle: "worker", kind: "agent" });
  const humanActor = kernel.authenticateAccessToken(human.accessToken);
  const agentActor = kernel.authenticateAccessToken(agent.accessToken);
  const room = kernel.createRoom(humanActor, {
    name: "Watchdog",
    slug: "watchdog",
  });
  kernel.addMember(humanActor, {
    principalId: agent.principal.principalId,
    roomId: room.roomId,
  });
  const credential = kernel.provisionHostCredential({
    hostId: "watchdog-host",
    participantIds: [agent.principal.principalId],
  });
  const hostContext = kernel.authenticateHostAccessToken(
    credential.accessToken,
  );
  kernel.heartbeatHost(hostContext);
  const clock = { ms: 0 };
  const sql = (query: string, ...parameters: string[]) => {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      return database.prepare(query).all(...parameters);
    } finally {
      database.close();
    }
  };
  let mentions = 0;
  return {
    acknowledge(consumerId: string) {
      const delivery = kernel.sync(agentActor, {
        consumerId,
        roomId: room.roomId,
      });
      kernel.acknowledgeCursor(agentActor, {
        consumerId,
        roomId: room.roomId,
        throughSeq: delivery.cursorAfter,
      });
      return delivery.cursorAfter;
    },
    clock,
    commitFinalReply(
      input: Parameters<RuntimeAdapter["start"]>[0],
      basedOnRoomSeq: number,
    ) {
      const reply = kernel.postMessage(agentActor, {
        basedOnRoomSeq,
        body: "FAKE final reply",
        idempotencyKey: `reply-${input.runAttemptId}`,
        recipients: [],
        roomId: input.roomId,
      });
      kernel.finalReplies.recordInTransaction(
        {
          activationId: input.activationId,
          consumerId: input.consumerId,
          hostId: input.hostId,
          participantId: input.participantId,
          roomId: input.roomId,
          runAttemptId: input.runAttemptId,
          toSeq: input.toSeq,
        },
        reply.event,
      );
    },
    close: () => {
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
    events: (type: string) =>
      sql(
        "SELECT payload_json FROM room_events WHERE type = ? ORDER BY room_seq",
        type,
      ).map(
        (row) =>
          JSON.parse(String(row.payload_json)) as Record<string, unknown>,
      ),
    host: (runtime: RuntimeAdapter) =>
      new AgentHost({
        host: hostContext,
        kernel,
        leaseMs: 30_000,
        now: () => clock.ms,
        retryAfterMs: 0,
        runtime,
        timeoutWait: waitUntilAborted,
        watchdogIntervalMs: MINUTE,
        watchdogWait: async (delayMs, signal) => {
          if (signal.aborted) return;
          await new Promise((resolve) => setTimeout(resolve, 1));
          clock.ms += delayMs;
          await runtimeTick?.(clock.ms);
        },
      }),
    humanActor,
    kernel,
    mention: (label: string) => {
      mentions += 1;
      kernel.postMessage(humanActor, {
        body: `@worker ${label}`,
        idempotencyKey: `mention-${String(mentions)}`,
        recipients: [
          { participantId: agent.principal.principalId, reason: "mention" },
        ],
        roomId: room.roomId,
      });
    },
    runs: () =>
      sql(
        "SELECT run_attempt_id, state, error FROM run_attempts ORDER BY started_at, attempt_number",
      ),
    setTick(tick: ((clockMs: number) => Promise<void>) | undefined) {
      runtimeTick = tick;
    },
    sql,
  };
}

let runtimeTick: ((clockMs: number) => Promise<void>) | undefined;

/** A per-turn runtime that hangs until the script ends it or it is cancelled. */
class ScriptedRuntime implements RuntimeAdapter {
  cancellations = 0;
  cancelledAtMs: number | undefined;
  #finish: ((exit: RunExit) => void) | undefined;
  #lifecycle: RuntimeStartLifecycle | undefined;
  readonly #finalReply: boolean;
  #producerSequence = 0;
  #run: RunHandle | undefined;
  readonly #state: State;

  constructor(
    state: State,
    options: {
      exitAtMs?: number;
      finalReply?: boolean;
      onTick?: (clockMs: number) => void;
      progressEveryTick?: boolean;
    },
  ) {
    this.#state = state;
    this.#finalReply = options.finalReply === true;
    state.clock.ms = 0;
    state.setTick(async (clockMs) => {
      options.onTick?.(clockMs);
      if (options.progressEveryTick) await this.#progress();
      if (options.exitAtMs !== undefined && clockMs >= options.exitAtMs)
        this.#finish?.({ code: 0 });
    });
  }

  async probe() {
    return { available: true };
  }

  async start(
    input: Parameters<RuntimeAdapter["start"]>[0],
    lifecycle: RuntimeStartLifecycle,
  ): Promise<RunHandle> {
    const runId = `scripted-${input.runAttemptId}`;
    const run = {
      recoveryDescriptor: {
        driver: "scripted",
        metadata: {},
        recoveryKey: runId,
      },
      runId,
    };
    await lifecycle.registerPrepared(run);
    const seen = this.#state.acknowledge(input.consumerId);
    if (this.#finalReply) this.#state.commitFinalReply(input, seen);
    this.#lifecycle = lifecycle;
    this.#run = run;
    return run;
  }

  async #progress() {
    if (this.#lifecycle === undefined || this.#run === undefined) return;
    this.#producerSequence += 1;
    await this.#lifecycle.recordTrajectory?.({
      entry: { activity: "working", kind: "status" },
      observedAt: new Date().toISOString(),
      producerSequence: this.#producerSequence,
      runAttemptId: this.#run.runId.replace(/^scripted-/u, ""),
      runtimeRunId: this.#run.runId,
    });
  }

  reap(): Promise<RunExit> {
    return new Promise((resolve) => {
      this.#finish = resolve;
    });
  }

  async cancel(): Promise<RunExit> {
    this.cancellations += 1;
    this.cancelledAtMs = this.#state.clock.ms;
    const exit = { code: null, signal: "SIGTERM" };
    this.#finish?.(exit);
    return exit;
  }
}

async function waitUntilAborted(_delay: number, signal: AbortSignal) {
  if (signal.aborted) return;
  await new Promise<void>((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}
