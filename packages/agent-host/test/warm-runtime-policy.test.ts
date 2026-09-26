import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  DEFAULT_WARM_RUNTIME_POLICY,
  InstanceRuntimePool,
  superviseWarmTurn,
  type AgentHostControlPort,
  type WarmRuntime,
  type WarmRuntimePolicy,
} from "../src/index.ts";

/**
 * S2-b warm runtime policies at the Host pool boundary: idle eviction, idle
 * boundary recycling, the global warm cap (LRU) and busy-turn admission, and
 * turn supervision (stall signals, busy RSS). SCRIPTED driver processes (no
 * Codex, no model), an in-memory control port, a FAKE clock for every policy
 * time and a FAKE process-group RSS probe.
 */
const driverPath = fileURLToPath(
  new URL("./fixtures/scripted-warm-driver.mjs", import.meta.url),
);

type Call = { method: string; input: Record<string, unknown> };

function fakeControl() {
  const calls: Call[] = [];
  const rows = new Map<string, Record<string, unknown>>();
  const log =
    <T>(method: string, apply: (input: any) => T) =>
    async (input: any) => {
      calls.push({ input, method });
      return apply(input);
    };
  const update = (id: string, fields: Record<string, unknown>) => {
    const row = { ...rows.get(id)!, ...fields };
    rows.set(id, row);
    return row;
  };
  const instanceRuntimes = {
    beginTurn: log("beginTurn", (input) => rows.get(input.instanceRuntimeId)),
    list: async () =>
      [...rows.values()].filter((row) => row.state !== "terminated"),
    markReady: log("markReady", (input) =>
      update(input.instanceRuntimeId, { ...input, state: "idle" }),
    ),
    markSuspect: log("markSuspect", (input) =>
      update(input.instanceRuntimeId, { state: "suspect" }),
    ),
    recordExit: log("recordExit", (input) =>
      update(input.instanceRuntimeId, { state: "terminated" }),
    ),
    recordLateTurnFrame: log("recordLateTurnFrame", () => undefined),
    recordSpawned: log("recordSpawned", (input) =>
      update(input.instanceRuntimeId, input),
    ),
    register: log("register", (input) => {
      const row = { ...input, hostGenerationCurrent: true, state: "starting" };
      rows.set(input.instanceRuntimeId, row);
      return row;
    }),
    releaseTurn: log("releaseTurn", (input) =>
      update(input.instanceRuntimeId, { state: "idle" }),
    ),
    terminatedAmong: async () => [],
  };
  // evo §37 B: the live watchdog context the Kernel would return.
  const watchdog = {
    maxRunMs: 240 * 60_000,
    noProgressWarnMs: 15 * 60_000,
    queuedStallTerminateMs: 15 * 60_000,
    queuedWorkWaiting: false,
  };
  return {
    calls,
    control: {
      instanceRuntimes,
      readRunWatchdog: async () => ({ ...watchdog }),
      recordRunWatchdogWarning: log(
        "recordRunWatchdogWarning",
        () => undefined,
      ),
    } as unknown as AgentHostControlPort,
    watchdog,
    warnings: () =>
      calls.filter((call) => call.method === "recordRunWatchdogWarning"),
    exits: () =>
      calls
        .filter((call) => call.method === "recordExit")
        .map((call) => ({
          id: call.input.instanceRuntimeId,
          reason: call.input.reason,
        })),
  };
}

function setup(
  options: {
    policy?: Partial<WarmRuntimePolicy>;
    idleTtlOverride?: (input: {
      participantId: string;
      lastColdResumeMs: number | undefined;
    }) => number | undefined;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "rah-warm-policy-"));
  chmodSync(directory, 0o700);
  const socketRoot = mkdtempSync("/tmp/lwq-");
  const fake = fakeControl();
  const diagnostics: string[] = [];
  let nowMs = Date.parse("2026-09-25T00:00:00.000Z");
  const rss = new Map<number, number | Error>();
  const pool = new InstanceRuntimePool({
    control: fake.control,
    hostGeneration: "gen-1",
    killGraceMs: 100,
    killWaitMs: 400,
    measureGroupRssKb: async (pgid) => {
      const value = rss.get(pgid) ?? 100 * 1024;
      if (value instanceof Error) throw value;
      return value;
    },
    now: () => nowMs,
    onDiagnostic: (message) => diagnostics.push(message),
    policy: {
      idleTtlMs: 1_000,
      supervisionIntervalMs: 20,
      resourceCheckIntervalMs: 20,
      ...options.policy,
    },
    ...(options.idleTtlOverride === undefined
      ? {}
      : { idleTtlOverride: options.idleTtlOverride }),
    readyTimeoutMs: 5_000,
    socketRoot,
    stateDirectory: join(directory, "state"),
    stopTimeoutMs: 300,
  });
  const pids: number[] = [];
  const acquire = async (
    participantId = "participant-1",
    input: {
      mode?: string;
      resumeMs?: number;
      cliFingerprint?: () => Promise<string | undefined>;
      runAttemptId?: string;
    } = {},
  ) => {
    const acquired = await pool.acquire({
      driver: "scripted-warm/v1",
      key: "key",
      ...(input.cliFingerprint === undefined
        ? {}
        : { cliFingerprint: input.cliFingerprint }),
      ...(input.runAttemptId === undefined
        ? {}
        : { runAttemptId: input.runAttemptId }),
      launch: async (layout) => ({
        args: [
          driverPath,
          "--runtime-id",
          layout.instanceRuntimeId,
          "--host-generation",
          "gen-1",
          "--mode",
          input.mode ?? "",
          ...(input.resumeMs === undefined
            ? []
            : ["--resume-ms", String(input.resumeMs)]),
        ],
        cwd: directory,
        env: { ...process.env },
      }),
      participantId,
    });
    if (acquired.runtime.pid !== undefined) pids.push(acquired.runtime.pid);
    return acquired;
  };
  return {
    acquire,
    advance(ms: number) {
      nowMs += ms;
    },
    diagnostics,
    fake,
    now: () => nowMs,
    pool,
    rss,
    async cleanup() {
      for (const pid of pids)
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      await pool.shutdown().catch(() => undefined);
      const stateDirectory = join(directory, "state");
      if (existsSync(stateDirectory))
        for (const entry of readdirSync(stateDirectory))
          try {
            chmodSync(join(stateDirectory, entry, "turns"), 0o700);
          } catch {
            // No turn root.
          }
      rmSync(socketRoot, { force: true, recursive: true });
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

type State = ReturnType<typeof setup>;

/** One complete turn (the scripted default drains at once), lane released. */
async function turnAndRelease(
  state: State,
  runtime: WarmRuntime,
  runAttemptId: string,
) {
  const turn = runtime.openTurn(runAttemptId, `rr-${runAttemptId}`);
  runtime.command({ op: "turn.begin", runAttemptId, text: "go" });
  assert.equal((await turn.admission.promise).kind, "accepted");
  assert.equal((await turn.outcome.promise).kind, "drained");
  runtime.closeTurnFrames(turn);
  await state.pool.releaseTurn(runtime.participantId, runAttemptId);
}

/** A turn the scripted driver accepts and holds open. */
async function heldTurn(runtime: WarmRuntime, runAttemptId = "run-held") {
  const turn = runtime.openTurn(runAttemptId, `rr-${runAttemptId}`);
  runtime.command({ op: "turn.begin", runAttemptId, text: "go" });
  assert.equal((await turn.admission.promise).kind, "accepted");
  // The scripted turn's first frame follows its acceptance.
  await waitFor(() => turn.lastFrameSeq > 0, "the first turn frame");
  return turn;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor<T>(
  probe: () => T | undefined | false,
  label: string,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const settleSoon = () => new Promise((resolve) => setTimeout(resolve, 120));

test("S2-b policy defaults are the owner's initial values", () => {
  assert.deepEqual(
    {
      admissionWaitMs: DEFAULT_WARM_RUNTIME_POLICY.admissionWaitMs,
      emergencyRssKb: DEFAULT_WARM_RUNTIME_POLICY.emergencyRssKb,
      expensiveResumeMs: DEFAULT_WARM_RUNTIME_POLICY.expensiveResumeMs,
      expensiveResumeTtlMultiplier:
        DEFAULT_WARM_RUNTIME_POLICY.expensiveResumeTtlMultiplier,
      idleTtlMs: DEFAULT_WARM_RUNTIME_POLICY.idleTtlMs,
      maxAgeMs: DEFAULT_WARM_RUNTIME_POLICY.maxAgeMs,
      maxBusyTurns: DEFAULT_WARM_RUNTIME_POLICY.maxBusyTurns,
      maxWarm: DEFAULT_WARM_RUNTIME_POLICY.maxWarm,
      recycleRssKb: DEFAULT_WARM_RUNTIME_POLICY.recycleRssKb,
      stallRetryBudget: DEFAULT_WARM_RUNTIME_POLICY.stallRetryBudget,
    },
    {
      admissionWaitMs: 60_000,
      emergencyRssKb: 8 * 1024 * 1024,
      expensiveResumeMs: 20_000,
      expensiveResumeTtlMultiplier: 4,
      idleTtlMs: 30 * 60_000,
      maxAgeMs: 12 * 60 * 60_000,
      maxBusyTurns: 20,
      maxWarm: 12,
      recycleRssKb: 2 * 1024 * 1024,
      stallRetryBudget: 1,
    },
  );
});

test("idle TTL: a busy turn, a pending lane release and a TUI pin are never evicted; the TTL counts from the last turn end or detach", async () => {
  const state = setup();
  try {
    const { runtime } = await state.acquire();
    const turn = runtime.openTurn("run-1", "rr-run-1");
    runtime.command({ op: "turn.begin", runAttemptId: "run-1", text: "go" });
    await turn.admission.promise;
    await turn.outcome.promise;
    // Quiesced but the Activation has not left `leased`: still busy.
    state.advance(10 * 60_000);
    await state.pool.sweepIdle();
    assert.deepEqual(state.fake.exits(), [], "never while the lane is held");
    assert.ok(alive(runtime.pid!));
    runtime.closeTurnFrames(turn);
    await state.pool.releaseTurn("participant-1", "run-1");
    const unpin = runtime.pin("tui");
    state.advance(10 * 60_000);
    await state.pool.sweepIdle();
    assert.deepEqual(state.fake.exits(), [], "never while a TUI is attached");
    unpin();
    state.advance(999);
    await state.pool.sweepIdle();
    assert.deepEqual(state.fake.exits(), [], "TTL restarts at detach");
    state.advance(1);
    await state.pool.sweepIdle();
    assert.deepEqual(state.fake.exits(), [
      { id: runtime.instanceRuntimeId, reason: "idle_ttl" },
    ]);
    assert.equal(alive(runtime.pid!), false);
  } finally {
    await state.cleanup();
  }
});

test("idle TTL: an expensive measured resume multiplies the TTL; the per-instance hook overrides it", async () => {
  const state = setup({
    idleTtlOverride: ({ participantId }) =>
      participantId === "participant-3" ? 7_777 : undefined,
    policy: { expensiveResumeMs: 20_000, expensiveResumeTtlMultiplier: 4 },
  });
  try {
    const cheap = (await state.acquire("participant-1", { resumeMs: 5_000 }))
      .runtime;
    const expensive = (
      await state.acquire("participant-2", { resumeMs: 25_000 })
    ).runtime;
    const hooked = (await state.acquire("participant-3", { resumeMs: 25_000 }))
      .runtime;
    assert.equal(state.pool.idleTtlFor(cheap), 1_000);
    assert.equal(state.pool.idleTtlFor(expensive), 4_000);
    assert.equal(state.pool.idleTtlFor(hooked), 7_777);
    await turnAndRelease(state, cheap, "run-1");
    await turnAndRelease(state, expensive, "run-2");
    await turnAndRelease(state, hooked, "run-3");
    state.advance(1_500);
    await state.pool.sweepIdle();
    assert.deepEqual(state.fake.exits(), [
      { id: cheap.instanceRuntimeId, reason: "idle_ttl" },
    ]);
    state.advance(2_500);
    await state.pool.sweepIdle();
    assert.deepEqual(
      state.fake.exits().map((exit) => exit.id),
      [cheap.instanceRuntimeId, expensive.instanceRuntimeId],
    );
  } finally {
    await state.cleanup();
  }
});

for (const [reason, arrange] of [
  [
    "cli_changed",
    (state: State, fingerprint: { value: string }) => {
      fingerprint.value = "codex@2";
      void state;
    },
  ],
  [
    "recycle_age",
    (state: State) => state.advance(DEFAULT_WARM_RUNTIME_POLICY.maxAgeMs),
  ],
  [
    "recycle_rss",
    (state: State, _fingerprint: unknown, pid: number) =>
      state.rss.set(pid, 3 * 1024 * 1024),
  ],
] as const) {
  test(`boundary recycling (${reason}) happens only at the next turn of an idle runtime, never mid-turn`, async () => {
    const state = setup({ policy: { idleTtlMs: 24 * 60 * 60_000 } });
    try {
      const fingerprint = { value: "codex@1" };
      const cliFingerprint = async () => fingerprint.value;
      const { runtime } = await state.acquire("participant-1", {
        cliFingerprint,
        mode: "hold",
      });
      const turn = await heldTurn(runtime, "run-1");
      arrange(state, fingerprint, runtime.pid!);
      await state.pool.sweepIdle();
      await settleSoon();
      assert.deepEqual(state.fake.exits(), [], "never while busy");
      assert.ok(alive(runtime.pid!));
      turn.outcome.resolve({
        inFlightToolCount: 0,
        kind: "drained",
        lastFrameSeq: turn.lastFrameSeq,
        nativeTurnId: "nt-1",
        status: "completed",
      });
      runtime.closeTurnFrames(turn);
      await state.pool.releaseTurn("participant-1", "run-1");
      await state.pool.sweepIdle();
      assert.deepEqual(state.fake.exits(), [], "idle alone does not recycle");
      const next = await state.acquire("participant-1", { cliFingerprint });
      assert.equal(next.mode, "cold");
      assert.notEqual(
        next.runtime.instanceRuntimeId,
        runtime.instanceRuntimeId,
      );
      assert.deepEqual(state.fake.exits(), [
        { id: runtime.instanceRuntimeId, reason },
      ]);
      assert.equal(alive(runtime.pid!), false, "exit proven before the start");
    } finally {
      await state.cleanup();
    }
  });
}

test("boundary recycling: an unreadable RSS or CLI fingerprint is not a change; the runtime stays warm", async () => {
  const state = setup();
  try {
    let unreadable = false;
    const cliFingerprint = async () => {
      if (unreadable) throw new Error("stat failed");
      return "codex@1";
    };
    const { runtime } = await state.acquire("participant-1", {
      cliFingerprint,
    });
    await turnAndRelease(state, runtime, "run-1");
    unreadable = true;
    state.rss.set(runtime.pid!, new Error("ps unavailable"));
    const next = await state.acquire("participant-1", { cliFingerprint });
    assert.equal(next.mode, "warm");
    assert.equal(next.runtime, runtime);
    assert.ok(
      state.diagnostics.some((line) =>
        /ps unavailable|stat failed/u.test(line),
      ),
    );
  } finally {
    await state.cleanup();
  }
});

test("global warm cap: the least recently used idle runtime is evicted first; busy and pinned ones never", async () => {
  const state = setup({
    policy: { idleTtlMs: 24 * 60 * 60_000, maxWarm: 2 },
  });
  try {
    const first = (await state.acquire("participant-1")).runtime;
    await turnAndRelease(state, first, "run-1");
    state.advance(1_000);
    const second = (await state.acquire("participant-2")).runtime;
    await turnAndRelease(state, second, "run-2");
    state.advance(1_000);
    const unpin = first.pin("tui");
    const third = (await state.acquire("participant-3")).runtime;
    await waitFor(() => state.fake.exits().length === 1, "one LRU eviction");
    assert.deepEqual(state.fake.exits(), [
      { id: second.instanceRuntimeId, reason: "lru" },
    ]);
    unpin();
    state.advance(500);
    await turnAndRelease(state, third, "run-3");
    state.advance(1_000);
    const fourth = (await state.acquire("participant-4")).runtime;
    await waitFor(() => state.fake.exits().length === 2, "the next eviction");
    assert.deepEqual(state.fake.exits()[1], {
      id: first.instanceRuntimeId,
      reason: "lru",
    });
    assert.equal(fourth.state, "busy", "the admitted turn is never evicted");
    assert.ok(alive(third.pid!));
  } finally {
    await state.cleanup();
  }
});

test("busy-turn cap: a turn over the cap waits for a released lane instead of starting", async () => {
  const state = setup({ policy: { admissionWaitMs: 5_000, maxBusyTurns: 1 } });
  try {
    const first = (await state.acquire("participant-1", { runAttemptId: "a" }))
      .runtime;
    let admitted = false;
    const waiting = state
      .acquire("participant-2", { runAttemptId: "b" })
      .then((acquired) => {
        admitted = true;
        return acquired;
      });
    await settleSoon();
    assert.equal(admitted, false, "queued at the cap");
    assert.equal(
      state.fake.calls.filter((call) => call.method === "register").length,
      1,
      "nothing starts for the queued turn",
    );
    const turn = first.openTurn("a", "rr-a");
    first.command({ op: "turn.begin", runAttemptId: "a", text: "go" });
    await turn.outcome.promise;
    first.closeTurnFrames(turn);
    await state.pool.releaseTurn("participant-1", "a");
    const second = await waiting;
    assert.equal(second.mode, "cold");
  } finally {
    await state.cleanup();
  }
});

test("busy-turn cap: admission gives up after its bound, so no Activation lease is held indefinitely", async () => {
  const state = setup({ policy: { admissionWaitMs: 200, maxBusyTurns: 1 } });
  try {
    await state.acquire("participant-1", { runAttemptId: "a" });
    const started = Date.now();
    await assert.rejects(
      state.acquire("participant-2", { runAttemptId: "b" }),
      /RAH_WARM_ADMISSION_FULL/u,
    );
    assert.ok(Date.now() - started < 3_000);
    assert.equal(
      state.fake.calls.filter((call) => call.method === "register").length,
      1,
    );
    await state.pool.releaseTurn("participant-2", "b");
    await state.pool.releaseTurn("participant-1", "a");
    assert.equal(
      (await state.acquire("participant-2", { runAttemptId: "c" })).mode,
      "cold",
      "a released slot admits again",
    );
  } finally {
    await state.cleanup();
  }
});

async function supervise(state: State, mode: string) {
  const { runtime } = await state.acquire("participant-1", { mode });
  const turn = await heldTurn(runtime);
  const stop = new AbortController();
  let verdict: unknown;
  const watched = superviseWarmTurn({
    activationId: "activation-1",
    pool: state.pool,
    runtime,
    signal: stop.signal,
    turn,
  }).then((value) => {
    verdict = value;
    return value;
  });
  return { runtime, stop, turn, verdict: () => verdict, watched };
}

test("evo §37 B warm stall: transport keepalives never reset the progress clock; a stall only warns until work is queued", async () => {
  const state = setup();
  try {
    const watch = await supervise(state, "keepalive");
    await waitFor(
      () => watch.runtime.lastTransportMs > watch.turn.lastProgressMs - 1,
      "a keepalive",
    );
    state.advance(10 * 60_000);
    const seen = watch.runtime.lastTransportMs;
    await waitFor(
      () => watch.runtime.lastTransportMs > seen,
      "keepalives after the advance",
    );
    await settleSoon();
    assert.equal(state.fake.warnings().length, 0, "10 minutes is no stall");
    state.advance(20 * 60_000);
    await waitFor(() => state.fake.warnings().length === 1, "the warning");
    assert.deepEqual(state.fake.warnings()[0]!.input, {
      runAttemptId: watch.turn.runAttemptId,
      thresholdMs: 15 * 60_000,
    });
    assert.equal(watch.verdict(), undefined, "nothing waits: never ended");
    state.fake.watchdog.queuedWorkWaiting = true;
    assert.deepEqual(await watch.watched, {
      kind: "watchdog",
      reason: "queued_stall",
    });
    assert.equal(state.fake.warnings().length, 1, "one warning per episode");
    watch.stop.abort();
  } finally {
    await state.cleanup();
  }
});

test("evo §37 B warm stall: native turn progress resets the clock even with work queued", async () => {
  const state = setup();
  try {
    state.fake.watchdog.queuedWorkWaiting = true;
    const watch = await supervise(state, "progress");
    for (let step = 0; step < 6; step += 1) {
      state.advance(5 * 60_000);
      await waitFor(
        () => watch.turn.lastProgressMs === state.now(),
        "progress after the advance",
      );
    }
    await settleSoon();
    assert.equal(watch.verdict(), undefined, "30 minutes of progress");
    assert.equal(state.fake.warnings().length, 0);
    watch.stop.abort();
    assert.equal(await watch.watched, undefined);
  } finally {
    await state.cleanup();
  }
});

test("evo §37 B warm stall: a silent tool only warns; awaiting approval never stalls, but the duration cap still ends the turn", async () => {
  const state = setup();
  try {
    const tool = await supervise(state, "tool-silent");
    await waitFor(() => tool.turn.toolsInFlight === 1, "the tool report");
    state.advance(60 * 60_000);
    await waitFor(() => state.fake.warnings().length === 1, "the warning");
    assert.equal(tool.verdict(), undefined, "a slow tool is not killed");
    tool.stop.abort();
  } finally {
    await state.cleanup();
  }
  const waiting = setup();
  try {
    waiting.fake.watchdog.queuedWorkWaiting = true;
    const approval = await supervise(waiting, "approval-wait");
    await waitFor(() => approval.turn.awaitingApproval, "the approval report");
    waiting.advance(3 * 60 * 60_000);
    await settleSoon();
    assert.equal(approval.verdict(), undefined, "shown to the Human instead");
    assert.equal(waiting.fake.warnings().length, 0);
    waiting.advance(60 * 60_000);
    assert.deepEqual(await approval.watched, {
      kind: "watchdog",
      reason: "max_duration",
    });
  } finally {
    await waiting.cleanup();
  }
});

test("busy RSS: over the recycle threshold alerts and closes admission without killing; over the emergency ceiling is a resource failure", async () => {
  const state = setup();
  try {
    const watch = await supervise(state, "hold");
    state.rss.set(watch.runtime.pid!, 3 * 1024 * 1024);
    await waitFor(
      () => watch.runtime.admissionClosed !== undefined,
      "admission closed",
    );
    assert.ok(
      state.diagnostics.some(
        (line) => /RSS/u.test(line) && /alert/iu.test(line),
      ),
    );
    await settleSoon();
    assert.equal(watch.verdict(), undefined, "the busy turn runs on");
    assert.ok(alive(watch.runtime.pid!));
    assert.deepEqual(state.fake.exits(), []);
    state.rss.set(watch.runtime.pid!, 9 * 1024 * 1024);
    assert.deepEqual(await watch.watched, {
      kind: "resource_failure",
      rssKb: 9 * 1024 * 1024,
    });
  } finally {
    await state.cleanup();
  }
});
