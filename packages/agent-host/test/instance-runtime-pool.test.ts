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
  InstanceRuntimePool,
  type AgentHostControlPort,
  type RuntimeProcessHygiene,
  type WarmRuntime,
} from "../src/index.ts";

/**
 * S2-a review P1-1 / P1-3 / P2-1 at the Host pool boundary, with a SCRIPTED
 * driver process (no Codex, no model) and an in-memory control port that
 * records every Kernel call. Signal delivery can be replaced to simulate a
 * process that ignores signals or cannot be signalled.
 */
const driverPath = fileURLToPath(
  new URL("./fixtures/scripted-warm-driver.mjs", import.meta.url),
);

type Call = { method: string; input: unknown };
type Row = Record<string, unknown> & {
  instanceRuntimeId: string;
  participantId: string;
  state: string;
};

function fakeControl(foreign: Row[] = []) {
  const calls: Call[] = [];
  const rows = new Map<string, Row>(
    foreign.map((row) => [row.instanceRuntimeId, row]),
  );
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
    recordTurnAccepted: log("recordTurnAccepted", () => undefined),
    register: log("register", (input) => {
      const row: Row = {
        ...input,
        hostGenerationCurrent: true,
        state: "starting",
      };
      rows.set(input.instanceRuntimeId, row);
      return row;
    }),
    releaseTurn: log("releaseTurn", (input) =>
      update(input.instanceRuntimeId, { state: "idle" }),
    ),
    terminatedAmong: async () => [],
  };
  return {
    calls,
    control: { instanceRuntimes } as unknown as AgentHostControlPort,
    methods: () => calls.map((call) => call.method),
    rows,
  };
}

function setup(
  options: {
    foreign?: Row[];
    hygiene?: Partial<RuntimeProcessHygiene>;
    readyTimeoutMs?: number;
    signalProcess?: (pid: number, signal: NodeJS.Signals | 0) => void;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "rah-warm-pool-"));
  chmodSync(directory, 0o700);
  const socketRoot = mkdtempSync("/tmp/lwp-");
  const fake = fakeControl(options.foreign);
  const diagnostics: string[] = [];
  let nowMs = Date.now();
  const pool = new InstanceRuntimePool({
    control: fake.control,
    hostGeneration: "gen-1",
    ...(options.hygiene === undefined
      ? {}
      : { hygiene: options.hygiene as RuntimeProcessHygiene }),
    idleTtlMs: 1_000,
    killGraceMs: 100,
    killWaitMs: 400,
    now: () => nowMs,
    onDiagnostic: (message) => diagnostics.push(message),
    readyTimeoutMs: options.readyTimeoutMs ?? 5_000,
    ...(options.signalProcess === undefined
      ? {}
      : { signalProcess: options.signalProcess }),
    socketRoot,
    stateDirectory: join(directory, "state"),
    stopTimeoutMs: 200,
  });
  const pids: number[] = [];
  const acquire = async (mode = "") => {
    const acquired = await pool.acquire({
      driver: "scripted-warm/v1",
      key: "key",
      launch: async (layout) => ({
        args: [
          driverPath,
          "--runtime-id",
          layout.instanceRuntimeId,
          "--host-generation",
          "gen-1",
          "--mode",
          mode,
        ],
        cwd: directory,
        env: { ...process.env },
      }),
      participantId: "participant-1",
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
    pids,
    pool,
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

async function runTurn(runtime: WarmRuntime, runAttemptId = "run-1") {
  const turn = runtime.openTurn(runAttemptId, `rr-${runAttemptId}`);
  runtime.command({ op: "turn.begin", runAttemptId, text: "go" });
  const admission = await turn.admission.promise;
  assert.equal(admission.kind, "accepted");
  const outcome = await turn.outcome.promise;
  return { outcome, turn };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const ignoreSignals = () => undefined;
const eperm = (_pid: number, signal: NodeJS.Signals | 0) => {
  if (signal === 0) return;
  throw Object.assign(new Error("operation not permitted"), {
    code: "EPERM",
  });
};

for (const [label, signalProcess] of [
  ["a process that never exits after SIGKILL", ignoreSignals],
  ["a signal refused with EPERM", eperm],
] as const) {
  test(`S2-a review P1-1: ${label} is never recorded as exited; the runtime stays suspect`, async () => {
    const state = setup({ signalProcess });
    try {
      const { runtime } = await state.acquire("ignore-term");
      const { outcome, turn } = await runTurn(runtime);
      assert.equal(outcome.kind, "drained");
      runtime.closeTurnFrames(turn);
      await state.pool.releaseTurn("participant-1", "run-1");
      state.advance(5_000);
      await state.pool.sweepIdle();
      assert.ok(alive(runtime.pid!), "the process really is still alive");
      assert.ok(
        !state.fake.methods().includes("recordExit"),
        "no exit is recorded for a kill that was only attempted",
      );
      assert.ok(state.fake.methods().includes("markSuspect"));
      assert.equal(runtime.state, "suspect");
      await assert.rejects(
        state.acquire(),
        /suspect|not proven/u,
        "no cold start while the old process may live",
      );
    } finally {
      await state.cleanup();
    }
  });
}

test("S2-a review P1-1: an aborted turn whose kill is unproven gets no process-exit outcome", async () => {
  const state = setup({ signalProcess: ignoreSignals });
  try {
    const { runtime } = await state.acquire("ignore-term");
    const turn = runtime.openTurn("run-1", "rr-1");
    await assert.rejects(
      state.pool.abortRuntime(runtime, "stall"),
      /not proven/u,
    );
    assert.equal(turn.outcome.settled, true);
    const outcome = await turn.outcome.promise;
    assert.notEqual(outcome.kind, "exit", "no exit is invented for the turn");
    assert.ok(!state.fake.methods().includes("recordExit"));
    assert.equal(runtime.state, "suspect");
  } finally {
    await state.cleanup();
  }
});

test("S2-a review P1-1: a real close after SIGKILL is the exit proof", async () => {
  const state = setup();
  try {
    const { runtime } = await state.acquire("ignore-term");
    const { turn } = await runTurn(runtime);
    runtime.closeTurnFrames(turn);
    await state.pool.releaseTurn("participant-1", "run-1");
    state.advance(5_000);
    await state.pool.sweepIdle();
    const exit = state.fake.calls.find((call) => call.method === "recordExit");
    assert.deepEqual((exit?.input as { exit: unknown }).exit, {
      code: null,
      signal: "SIGKILL",
    });
    assert.equal(alive(runtime.pid!), false);
  } finally {
    await state.cleanup();
  }
});

test("S2-a review P1-3: the physical identity is recorded right after spawn, before ready", async () => {
  const state = setup({ readyTimeoutMs: 1_500 });
  try {
    const acquiring = state.acquire("never-ready");
    const spawned = await waitFor(
      () => state.fake.calls.find((call) => call.method === "recordSpawned"),
      "the spawn identity record",
    );
    const identity = spawned.input as {
      pid: number;
      pgid: number;
      processStartedAt: string;
    };
    assert.ok(identity.pid > 1);
    assert.equal(identity.pgid, identity.pid);
    assert.ok(identity.processStartedAt.length > 0);
    assert.ok(!state.fake.methods().includes("markReady"));
    state.pids.push(identity.pid);
    await assert.rejects(acquiring, /not ready/u);
    assert.deepEqual(
      state.fake.methods().filter((method) => method !== "register"),
      ["recordSpawned", "recordExit"],
    );
  } finally {
    await state.cleanup();
  }
});

const foreignStarting = (fields: Record<string, unknown> = {}): Row => ({
  hostGenerationCurrent: false,
  instanceRuntimeId: "instrt_foreign",
  participantId: "participant-1",
  state: "starting",
  ...fields,
});

test("S2-a review P1-3: a starting row without identity stays uncertain when the sweep fails", async () => {
  const state = setup({
    foreign: [foreignStarting()],
    hygiene: {
      afterRuntime: async () => {
        throw new Error("ps unavailable");
      },
      taggedRuntimeIds: async () => new Set<string>(),
    },
  });
  try {
    await state.pool.janitor();
    assert.ok(!state.fake.methods().includes("recordExit"));
    assert.equal(state.fake.rows.get("instrt_foreign")?.state, "starting");
    assert.ok(
      state.diagnostics.some((line) => /ps unavailable/u.test(line)),
      "the sweep failure is reported, not swallowed",
    );
    assert.ok(
      state.diagnostics.some((line) =>
        /could not be proven stopped/u.test(line),
      ),
    );
  } finally {
    await state.cleanup();
  }
});

test("S2-a review P1-3: without any sweep evidence a starting row without identity is uncertain", async () => {
  const state = setup({ foreign: [foreignStarting()] });
  try {
    await state.pool.janitor();
    assert.ok(!state.fake.methods().includes("recordExit"));
  } finally {
    await state.cleanup();
  }
});

test("S2-a review P1-3: a complete sweep with nothing remaining proves a starting row without identity gone", async () => {
  const state = setup({
    foreign: [foreignStarting()],
    hygiene: {
      afterRuntime: async () => ({ complete: true, remaining: 0, unknown: 0 }),
      taggedRuntimeIds: async () => new Set<string>(),
    },
  });
  try {
    await state.pool.janitor();
    assert.ok(state.fake.methods().includes("recordExit"));
  } finally {
    await state.cleanup();
  }
});

test("S2-a review P1-3: a live pid without a recorded birth time is uncertain, never gone", async () => {
  const state = setup({
    foreign: [foreignStarting({ pgid: process.pid, pid: process.pid })],
    hygiene: {
      afterRuntime: async () => ({ complete: true, remaining: 0, unknown: 0 }),
      taggedRuntimeIds: async () => new Set<string>(),
    },
  });
  try {
    await state.pool.janitor();
    assert.ok(!state.fake.methods().includes("recordExit"));
  } finally {
    await state.cleanup();
  }
});

for (const mode of [
  "seq-gap",
  "foreign-turn",
  "watermark",
  "overflow",
  "unattributed-usage",
]) {
  test(`S2-a review P2-1: ${mode} marks the turn's evidence incomplete`, async () => {
    const state = setup();
    try {
      const { runtime } = await state.acquire(mode);
      const { outcome } = await runTurn(runtime);
      assert.equal(outcome.kind, "drained");
      await waitFor(
        () =>
          state.fake.calls.find(
            (call) =>
              call.method === "recordLateTurnFrame" &&
              (call.input as { runAttemptId: string }).runAttemptId === "run-1",
          ),
        `the incomplete-evidence mark for ${mode}`,
        3_000,
      );
    } finally {
      await state.cleanup();
    }
  });
}

test("S2-a review P2-1: a complete turn is not marked incomplete", async () => {
  const state = setup();
  try {
    const { runtime } = await state.acquire();
    await runTurn(runtime);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(!state.fake.methods().includes("recordLateTurnFrame"));
  } finally {
    await state.cleanup();
  }
});

test("S2-a review P2-1: after an fd3 overflow the runtime is not reused", async () => {
  const state = setup();
  try {
    const { runtime } = await state.acquire("overflow");
    const { turn } = await runTurn(runtime);
    runtime.closeTurnFrames(turn);
    await state.pool.releaseTurn("participant-1", "run-1");
    const next = await state.acquire();
    assert.equal(next.mode, "cold");
    assert.notEqual(next.runtime.instanceRuntimeId, runtime.instanceRuntimeId);
    assert.equal(alive(runtime.pid!), false);
  } finally {
    await state.pool.shutdown();
    await state.cleanup();
  }
});

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
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
