import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
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
  type WarmRuntimePolicyOverrides,
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
    // Like the Kernel's #requireTurn: a row the Kernel turned suspect (its
    // turn orphaned by lease expiry or quarantine) refuses the release.
    releaseTurn: log("releaseTurn", (input) => {
      if (rows.get(input.instanceRuntimeId)?.state === "suspect")
        throw Object.assign(
          new Error(
            `instance runtime ${String(input.instanceRuntimeId)} is not running run attempt ${String(input.runAttemptId)}`,
          ),
          { code: "execution_fenced", name: "ExecutionFencedError" },
        );
      return update(input.instanceRuntimeId, { state: "idle" });
    }),
    terminatedAmong: async (ids: string[]) =>
      [...rows.values()]
        .filter(
          (row) =>
            row.state === "terminated" && ids.includes(row.instanceRuntimeId),
        )
        .map((row) => ({
          instanceRuntimeId: row.instanceRuntimeId,
          participantId: row.participantId,
        })),
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
    hostStartTimeoutMs?: number;
    policy?: WarmRuntimePolicyOverrides;
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
    ...(options.hostStartTimeoutMs === undefined
      ? {}
      : { hostStartTimeoutMs: options.hostStartTimeoutMs }),
    idleTtlMs: 1_000,
    ...(options.policy === undefined ? {} : { policy: options.policy }),
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
  const launches: string[] = [];
  const acquire = async (
    mode = "",
    input: {
      extraArgs?: string[];
      launchDelayMs?: number;
      participantId?: string;
      runAttemptId?: string;
    } = {},
  ) => {
    const acquired = await pool.acquire({
      driver: "scripted-warm/v1",
      key: "key",
      launch: async (layout) => {
        launches.push(layout.instanceRuntimeId);
        if (input.launchDelayMs !== undefined)
          await new Promise((resolve) =>
            setTimeout(resolve, input.launchDelayMs),
          );
        return {
          args: [
            driverPath,
            "--runtime-id",
            layout.instanceRuntimeId,
            "--host-generation",
            "gen-1",
            "--mode",
            mode,
            ...(input.extraArgs ?? []),
          ],
          cwd: directory,
          env: { ...process.env },
        };
      },
      participantId: input.participantId ?? "participant-1",
      ...(input.runAttemptId === undefined
        ? {}
        : { runAttemptId: input.runAttemptId }),
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
    directory,
    fake,
    launches,
    pids,
    socketRoot,
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

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("review batch 1 #2: a turn the Host released while its runtime cold-started leaves the runtime idle and its busy slot free", async () => {
  const state = setup({ policy: { maxBusyTurns: 1 } });
  try {
    // AgentHost: the start deadline fires while acquire still cold-starts;
    // its finally releases the turn before the adapter ever opened it.
    const late = state.acquire("", {
      launchDelayMs: 400,
      runAttemptId: "run-1",
    });
    late.catch(() => undefined);
    await pause(100);
    await state.pool.releaseTurn("participant-1", "run-1");
    await assert.rejects(late, /released by the Host/u);
    const runtime = state.pool.runtimeFor("participant-1");
    if (runtime?.pid !== undefined) state.pids.push(runtime.pid);
    assert.equal(
      runtime?.state,
      "idle",
      "the cold-started runtime is not stranded busy",
    );
    assert.equal(runtime?.current, undefined);
    // Cap 1: the next turn takes the only slot and reuses the runtime.
    const next = await state.acquire("", { runAttemptId: "run-2" });
    assert.equal(next.mode, "warm");
    assert.equal(next.runtime, runtime);
  } finally {
    await state.cleanup();
  }
});

test("review batch 1 #2: a turn released while it waited for a busy slot never takes the slot", async () => {
  const state = setup({ policy: { admissionWaitMs: 5_000, maxBusyTurns: 1 } });
  try {
    await state.acquire("", {
      participantId: "participant-2",
      runAttemptId: "run-a",
    });
    const waiting = state.acquire("", { runAttemptId: "run-1" });
    waiting.catch(() => undefined);
    await pause(50);
    await state.pool.releaseTurn("participant-1", "run-1");
    await assert.rejects(waiting, /released by the Host/u);
    await state.pool.releaseTurn("participant-2", "run-a");
    // The slot of the abandoned turn was never taken: a third turn is admitted.
    const third = await state.acquire("", {
      participantId: "participant-3",
      runAttemptId: "run-3",
    });
    assert.equal(third.mode, "cold");
    assert.equal(
      state.pool.runtimeFor("participant-1"),
      undefined,
      "nothing was started for the abandoned turn",
    );
  } finally {
    await state.cleanup();
  }
});

test("review batch 1 #2: a full pool fails the turn before the Host start deadline", async () => {
  const state = setup({
    hostStartTimeoutMs: 400,
    policy: { admissionWaitMs: 60_000, maxBusyTurns: 1 },
  });
  try {
    await state.acquire("", {
      participantId: "participant-2",
      runAttemptId: "run-a",
    });
    const started = Date.now();
    await assert.rejects(
      state.acquire("", { runAttemptId: "run-1" }),
      /RAH_WARM_ADMISSION_FULL/u,
    );
    assert.ok(
      Date.now() - started < 400,
      "the admission wait stays below the Host start deadline",
    );
  } finally {
    await state.cleanup();
  }
});

test("review batch 1 #3: a lane release the Kernel fences (suspect row) ends the runtime with proof; the next turn cold starts", async () => {
  const state = setup();
  try {
    const { runtime } = await state.acquire("", { runAttemptId: "run-1" });
    const { turn } = await runTurn(runtime);
    runtime.closeTurnFrames(turn);
    // Kernel: the turn was orphaned (lease expiry / quarantine) -> suspect.
    const row = state.fake.rows.get(runtime.instanceRuntimeId)!;
    state.fake.rows.set(runtime.instanceRuntimeId, {
      ...row,
      state: "suspect",
    });
    await state.pool.releaseTurn("participant-1", "run-1");
    assert.equal(alive(runtime.pid!), false, "the process was killed");
    assert.equal(runtime.state, "dead");
    const methods = state.fake.methods();
    const exitIndex = state.fake.calls.findIndex(
      (call) =>
        call.method === "recordExit" &&
        (call.input as { instanceRuntimeId: string }).instanceRuntimeId ===
          runtime.instanceRuntimeId,
    );
    assert.ok(
      exitIndex >= 0,
      `the proven exit is recorded: ${methods.join(",")}`,
    );
    const next = await state.acquire("", { runAttemptId: "run-2" });
    assert.equal(next.mode, "cold");
    assert.notEqual(next.runtime.instanceRuntimeId, runtime.instanceRuntimeId);
    const registers = state.fake.calls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.method === "register");
    assert.equal(registers.length, 2);
    assert.ok(
      registers[1]!.index > exitIndex,
      "no new process before the old one's exit proof",
    );
  } finally {
    await state.cleanup();
  }
});

test("review batch 1 #3: an unproven kill after a fenced release keeps the participant blocked as suspect", async () => {
  const state = setup({ signalProcess: ignoreSignals });
  try {
    const { runtime } = await state.acquire("ignore-term", {
      runAttemptId: "run-1",
    });
    const { turn } = await runTurn(runtime);
    runtime.closeTurnFrames(turn);
    const row = state.fake.rows.get(runtime.instanceRuntimeId)!;
    state.fake.rows.set(runtime.instanceRuntimeId, {
      ...row,
      state: "suspect",
    });
    await assert.rejects(
      state.pool.releaseTurn("participant-1", "run-1"),
      /suspect/u,
    );
    assert.equal(runtime.state, "suspect");
    assert.ok(!state.fake.methods().includes("recordExit"));
    await assert.rejects(
      state.acquire("", { runAttemptId: "run-2" }),
      /suspect/u,
    );
  } finally {
    await state.cleanup();
  }
});

test("review batch 1 #7: a normal stop kills what is left in the runtime's process group and requires its absence", async () => {
  const state = setup();
  let childPid: number | undefined;
  try {
    const childPidFile = join(state.directory, "child.pid");
    await state.acquire("group-child", {
      extraArgs: ["--child-pid-file", childPidFile],
    });
    childPid = Number(
      await waitFor(
        () => existsSync(childPidFile) && readFileSync(childPidFile, "utf8"),
        "the group child",
      ),
    );
    assert.ok(alive(childPid));
    await state.pool.shutdown();
    await waitFor(
      () => !alive(childPid!),
      "the group child to be killed",
      2_000,
    );
    assert.ok(state.fake.methods().includes("recordExit"));
  } finally {
    if (childPid !== undefined)
      try {
        process.kill(childPid, "SIGKILL");
      } catch {
        // Already gone.
      }
    await state.cleanup();
  }
});

test("review batch 1 #7: a stop whose process group cannot be proven gone leaves the runtime suspect", async () => {
  // Signals to the group are refused; liveness probes still work.
  const refuseKill = (pid: number, signal: NodeJS.Signals | 0) => {
    if (signal === 0) {
      process.kill(pid, 0);
      return;
    }
    throw Object.assign(new Error("operation not permitted"), {
      code: "EPERM",
    });
  };
  const state = setup({ signalProcess: refuseKill });
  let childPid: number | undefined;
  try {
    const childPidFile = join(state.directory, "child.pid");
    const { runtime } = await state.acquire("group-child", {
      extraArgs: ["--child-pid-file", childPidFile],
    });
    childPid = Number(
      await waitFor(
        () => existsSync(childPidFile) && readFileSync(childPidFile, "utf8"),
        "the group child",
      ),
    );
    await state.pool.shutdown();
    assert.ok(alive(childPid), "the group really is still present");
    assert.equal(runtime.state, "suspect");
    assert.ok(!state.fake.methods().includes("recordExit"));
    assert.ok(state.fake.methods().includes("markSuspect"));
  } finally {
    if (childPid !== undefined)
      try {
        process.kill(childPid, "SIGKILL");
      } catch {
        // Already gone.
      }
    await state.cleanup();
  }
});

test("review batch 1 #7: the janitor removes the runtime and socket directories of runtimes it records ended", async () => {
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  const crashed = "instrt_crashed00000aaaa";
  const earlier = "instrt_earlier00000bbbb";
  const state = setup({
    foreign: [
      foreignStarting({
        instanceRuntimeId: crashed,
        pgid: dead,
        pid: dead,
        processStartedAt: "Thu Sep 24 10:00:00 2026",
        state: "idle",
      }),
      foreignStarting({ instanceRuntimeId: earlier, state: "terminated" }),
    ],
  });
  try {
    const stateDirectory = join(state.directory, "state");
    for (const id of [crashed, earlier]) {
      mkdirSync(join(stateDirectory, id, "turns"), { recursive: true });
      mkdirSync(join(state.socketRoot, id.slice(7, 19)), { recursive: true });
    }
    await state.pool.janitor();
    assert.ok(state.fake.methods().includes("recordExit"));
    for (const id of [crashed, earlier]) {
      assert.equal(
        existsSync(join(stateDirectory, id)),
        false,
        `${id} runtime directory`,
      );
      assert.equal(
        existsSync(join(state.socketRoot, id.slice(7, 19))),
        false,
        `${id} socket directory`,
      );
    }
  } finally {
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

test("lowering the busy-turn cap while turns are busy lets a turn the Kernel already placed under the old cap start instead of failing admission", async () => {
  const state = setup({ policy: { admissionWaitMs: 300, maxBusyTurns: 3 } });
  try {
    await state.acquire("", {
      participantId: "participant-2",
      runAttemptId: "run-a",
    });
    await state.acquire("", {
      participantId: "participant-3",
      runAttemptId: "run-b",
    });
    // Claimed under cap 3 but not yet started; the Human lowers the cap to 1.
    state.pool.setMaxBusyTurns(1);
    const placed = await state.acquire("", { runAttemptId: "run-c" });
    assert.ok(placed.runtime, "the already placed turn starts");
  } finally {
    await state.cleanup();
  }
});

test("raising the busy-turn cap at runtime admits a turn waiting for a slot", async () => {
  const state = setup({ policy: { admissionWaitMs: 5_000, maxBusyTurns: 1 } });
  try {
    await state.acquire("", {
      participantId: "participant-2",
      runAttemptId: "run-a",
    });
    let admitted = false;
    const waiting = state
      .acquire("", { runAttemptId: "run-1" })
      .then((value) => {
        admitted = true;
        return value;
      });
    await pause(50);
    assert.equal(admitted, false, "cap 1 holds the second turn");
    state.pool.setMaxBusyTurns(2);
    await waiting;
    assert.equal(admitted, true);
    assert.equal(state.pool.policy.maxBusyTurns, 2);
    assert.throws(() => state.pool.setMaxBusyTurns(0), /maxBusyTurns/u);
  } finally {
    await state.cleanup();
  }
});
