import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { WorkerApplicationService } from "@rah-os/application-service";
import { RoomKernel, type AuthenticatedHostContext } from "@rah-os/kernel";

import {
  AgentHost,
  CLAUDE_WARM_DRIVER,
  CodexWarmAdapter,
  createKernelAgentHostControlPort,
  createSystemProcessTable,
  InstanceRuntimePool,
  LeftoverProcessSweeper,
  renderBodiedWake,
  RUN_WATCHDOG_QUEUED_STALL,
  RuntimeImplementationRegistry,
  RuntimeProcessHygiene,
  RuntimeProfileRegistry,
  type RuntimeAdapter,
  type WarmRuntimePolicyOverrides,
} from "../src/index.ts";

/**
 * S2-c1 warm Claude end to end with a FAKE long-lived Claude stream-json CLI
 * (no model, no paid CLI): real Kernel and SQLite, real Worker HTTP API and
 * Worker CLI, the real Claude warm driver, the shared warm adapter and pool,
 * and AgentHost. The fake's frames follow what the installed Claude Code
 * 2.1.282 emitted locally without a model call (lifecycle per inbound uuid,
 * replay echo with that uuid, `result.user_message_uuid`, interrupt receipt).
 * It cannot prove the real model loop; that is the paid smoke gate.
 */
const fakePath = fileURLToPath(
  new URL("./fixtures/fake-claude-warm.mjs", import.meta.url),
);

type Harness = Awaited<ReturnType<typeof harness>>;

async function harness(
  options: {
    idleTtlMs?: number;
    policy?: WarmRuntimePolicyOverrides;
    env?: Record<string, string>;
    interruptQuiesceTimeoutMs?: number;
    resolvedModel?: ConstructorParameters<
      typeof CodexWarmAdapter
    >[0]["resolvedModel"];
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "rah-warm-claude-"));
  chmodSync(directory, 0o700);
  const socketRoot = mkdtempSync("/tmp/lwc-");
  chmodSync(socketRoot, 0o700);
  const stateDirectory = join(directory, "fake-state");
  const recordPath = join(directory, "record.jsonl");
  const executable = join(directory, "claude");
  writeFileSync(
    executable,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakePath)} "$@"\n`,
    { mode: 0o700 },
  );
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const worker = new WorkerApplicationService({ kernel });
  await worker.start();
  const human = kernel.provisionPrincipal({
    handle: "warm-human",
    kind: "human",
  });
  const agent = kernel.provisionPrincipal({
    handle: "warm-claude",
    kind: "agent",
  });
  const participantId = agent.principal.principalId;
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Warm", slug: "warm" });
  kernel.addMember(actor, { principalId: participantId, roomId: room.roomId });
  const hostToken = kernel.provisionHostCredential({
    hostId: "warm-host",
    participantIds: [participantId],
  }).accessToken;
  const sessions = new Map<string, string>();
  /** Turn inputs the fake had received when each binding was persisted. */
  const inputsAtBinding: number[] = [];
  const acceptances: { inputSha256?: string; turnId: string }[] = [];
  const diagnostics: string[] = [];
  let nowMs = Date.now();
  const hygiene = new RuntimeProcessHygiene({
    sweeper: new LeftoverProcessSweeper({
      graceMs: 300,
      table: createSystemProcessTable(),
    }),
  });
  let messages = 0;

  const makeHost = (host: AuthenticatedHostContext) => {
    const control = createKernelAgentHostControlPort(kernel, host);
    const pool = new InstanceRuntimePool({
      control,
      hostGeneration: host.instanceId,
      hygiene,
      idleTtlMs: options.idleTtlMs ?? 60_000,
      ...(options.policy === undefined ? {} : { policy: options.policy }),
      now: () => nowMs,
      onDiagnostic: (message) => diagnostics.push(message),
      socketRoot,
      stateDirectory: join(directory, "warm-runtimes"),
    });
    const legacy: RuntimeAdapter = {
      async probe() {
        return { available: true };
      },
      async start() {
        throw new Error("the per-turn path is not used in this test");
      },
      async cancel() {
        throw new Error("unused");
      },
      async reap() {
        throw new Error("unused");
      },
    };
    const adapter = new CodexWarmAdapter({
      driver: CLAUDE_WARM_DRIVER,
      cwd: directory,
      driverArgs: [
        "--executable",
        executable,
        "--tool-access-mode",
        "full_access",
        "--prompt",
        "FAKE standing prompt for the warm Claude test",
      ],
      env: {
        FAKE_CLAUDE_RECORD_PATH: recordPath,
        FAKE_CLAUDE_STATE_DIR: stateDirectory,
        ...options.env,
      },
      ...(options.interruptQuiesceTimeoutMs === undefined
        ? {}
        : { interruptQuiesceTimeoutMs: options.interruptQuiesceTimeoutMs }),
      ...(options.resolvedModel === undefined
        ? {}
        : { resolvedModel: options.resolvedModel }),
      isWarm: () => true,
      issueWorkerCredential: async (input) =>
        worker.issueActivationCredential(host, input),
      legacy,
      pool,
      recordDeliveryAcceptance: (_input, acceptance) => {
        acceptances.push({
          turnId: acceptance.turnId,
          ...(acceptance.inputSha256 === undefined
            ? {}
            : { inputSha256: acceptance.inputSha256 }),
        });
      },
      recordProviderSessionEvidence: (input, evidence) => {
        inputsAtBinding.push(
          readRecords().filter((record) => record.event === "input").length,
        );
        sessions.set(input.participantId, evidence.providerSessionId);
      },
      renderWake: async (input) =>
        await renderBodiedWake({
          env: input.env,
          participantId: input.participantId,
          turnHandle: input.turnHandle,
        }),
      runtimeEnvironment: async (input) => {
        const previous = sessions.get(input.participantId);
        return {
          args: previous === undefined ? [] : ["--resume-session", previous],
          env: {},
        };
      },
      runtimeKey: () => "fake-key",
      workerApiOrigin: worker.origin,
    });
    const agentHost = new AgentHost({
      drainTimeoutMs: 300,
      guideEnabled: () => true,
      host,
      kernel,
      leaseMs: 30_000,
      pollIntervalMs: 20,
      retryAfterMs: 0,
      runtime: adapter,
    });
    return { adapter, agentHost, control, host, pool };
  };

  function readRecords(): Record<string, unknown>[] {
    if (!existsSync(recordPath)) return [];
    return readFileSync(recordPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  const host = kernel.authenticateHostAccessToken(hostToken);
  kernel.heartbeatHost(host);
  const current = makeHost(host);

  return {
    acceptances,
    actor,
    advance(ms: number) {
      nowMs += ms;
    },
    current,
    databasePath,
    diagnostics,
    inputsAtBinding,
    kernel,
    participantId,
    post(body: string) {
      messages += 1;
      return kernel.postMessage(actor, {
        body,
        idempotencyKey: `warm-message-${messages}`,
        recipients: [{ participantId, reason: "mention" }],
        roomId: room.roomId,
      });
    },
    records: readRecords,
    roomId: room.roomId,
    sessions,
    stateDirectory,
    async cleanup() {
      await current.pool.shutdown().catch(() => undefined);
      await worker.close();
      kernel.close();
      rmSync(socketRoot, { force: true, recursive: true });
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

function sql(state: Harness, query: string, ...args: string[]) {
  const database = new DatabaseSync(state.databasePath, { readOnly: true });
  try {
    return database.prepare(query).all(...args) as Record<string, unknown>[];
  } finally {
    database.close();
  }
}

async function waitFor<T>(
  probe: () => T | undefined | false,
  label: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const events = (state: Harness, event: string) =>
  state.records().filter((record) => record.event === event);
const starts = (state: Harness) => events(state, "start");
const inputs = (state: Harness) => events(state, "input");
const turns = (state: Harness) => events(state, "turn");
const interrupts = (state: Harness) =>
  events(state, "control").filter(
    (record) => (record.request as { subtype: string }).subtype === "interrupt",
  );
const orderedRuns = (state: Harness) =>
  state.kernel
    .listRunAttempts({ roomId: state.roomId })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

test("warm Claude: three Activations run on one process and one session, each quiesced with its own handle", async () => {
  const state = await harness();
  try {
    for (let turn = 1; turn <= 3; turn += 1) {
      state.post(`[fake:ack] question ${turn}`);
      const result = await state.current.agentHost.reconcileOnce();
      assert.equal(result.state, "completed", JSON.stringify(result));
    }
    assert.equal(starts(state).length, 1, "one Claude process");
    const argv = starts(state)[0]!.argv as string[];
    assert.ok(argv.includes("--replay-user-messages"));
    assert.ok(argv.includes("--input-format"));
    assert.ok(argv.includes("--session-id"), "a fresh session id is chosen");
    assert.equal(argv.includes("--resume"), false);
    // evo §40 B: the warm process carries the same tool fence as per-turn.
    assert.equal(
      argv[argv.indexOf("--permission-mode") + 1],
      "bypassPermissions",
    );
    const disallowed = argv[argv.indexOf("--disallowed-tools") + 1]!.split(",");
    for (const tool of ["AskUserQuestion", "RemoteTrigger", "ScheduleWakeup"])
      assert.ok(disallowed.includes(tool), `${tool} disallowed`);
    const turnRecords = turns(state);
    assert.equal(turnRecords.length, 3);
    assert.equal(
      new Set(turnRecords.map((record) => record.handle)).size,
      3,
      "each turn gets its own handle",
    );
    assert.ok(
      events(state, "worker").every((record) => record.status === 0),
      "the Worker CLI accepted each turn's own handle",
    );
    for (const process of state.kernel.listRuntimeProcesses({
      roomId: state.roomId,
    })) {
      assert.equal(process.proofKind, "turn_quiesced");
      assert.equal(process.quiesceResult, "success");
      assert.equal(process.exitCode, undefined);
    }
    const runs = orderedRuns(state);
    assert.equal(new Set(runs.map((run) => run.instanceRuntimeId)).size, 1);
    // The native turn id is the wake input's own uuid.
    assert.deepEqual(
      runs.map((run) => run.nativeTurnId),
      turnRecords.map((record) => record.uuid),
    );
    assert.deepEqual(
      sql(
        state,
        "SELECT execution_mode FROM run_attempts ORDER BY started_at",
      ).map((row) => row.execution_mode),
      ["cold", "warm", "warm"],
    );
    // The replay echo of each wake is its acceptance, digest of its text.
    assert.deepEqual(
      state.acceptances.map((acceptance) => acceptance.turnId),
      turnRecords.map((record) => record.uuid),
    );
    for (const [index, acceptance] of state.acceptances.entries())
      assert.equal(
        acceptance.inputSha256,
        createHash("sha256")
          .update(String(turnRecords[index]!.text), "utf8")
          .digest("hex"),
      );
    // Claude writes the session when it takes the first input: the binding
    // is recorded once, after that input was accepted.
    assert.deepEqual(state.inputsAtBinding, [1]);
    const [row] = sql(state, "SELECT state, pid FROM instance_runtimes");
    assert.equal(row?.state, "idle");
    assert.ok(alive(Number(row?.pid)));
  } finally {
    await state.cleanup();
  }
});

test("warm Claude: a binding without effort levels (Haiku) runs with --model and no --effort on one process", async () => {
  const state = await harness({
    resolvedModel: {
      source: "explicit_binding",
      modelBindingId: "local:claude-cli/v1:haiku",
      modelId: "haiku",
      provider: "anthropic",
    },
  });
  try {
    for (let turn = 1; turn <= 2; turn += 1) {
      state.post(`[fake:ack] effortless ${turn}`);
      const result = await state.current.agentHost.reconcileOnce();
      assert.equal(result.state, "completed", JSON.stringify(result));
    }
    assert.equal(starts(state).length, 1, "one Claude process");
    const argv = starts(state)[0]!.argv as string[];
    assert.deepEqual(
      argv.filter((a) => a === "--model"),
      ["--model"],
    );
    assert.equal(argv[argv.indexOf("--model") + 1], "haiku");
    assert.equal(
      argv.some((a) => a.startsWith("--effort")),
      false,
    );
    assert.equal(turns(state).length, 2);
  } finally {
    await state.cleanup();
  }
});

test("warm Claude: accepted busy input is folded into the Activation's native turn (real 2.1.282), never the next one", async () => {
  const state = await harness();
  try {
    state.post("[fake:busy-wait] wait for more");
    const running = state.current.agentHost.reconcileOnce();
    await waitFor(() => turns(state).length === 1, "turn start");
    state.post("[fake:ack] additional human detail");
    assert.equal((await running).state, "completed");
    const [wake, notice] = inputs(state);
    assert.ok(notice, "the busy notice was written with its own uuid");
    assert.notEqual(notice.uuid, wake!.uuid);
    assert.match(String(notice.text), /latest sender @warm-human/u);
    // Batch 3 P1-5: the real CLI folds it into the running turn at the next
    // tool boundary; that turn's one result names both inputs.
    assert.ok(
      events(state, "folded").some(
        (record) => record.uuid === notice.uuid && record.into === wake!.uuid,
      ),
      "the notice was folded into the wake's native turn",
    );
    const noticeDone = events(state, "turn-completed").find(
      (record) => record.uuid === wake!.uuid,
    );
    assert.ok(noticeDone, "the native turn carrying the notice completed");
    const [first] = orderedRuns(state);
    const [closed] = sql(
      state,
      "SELECT closed_at FROM runtime_processes WHERE run_attempt_id = ?",
      first!.runAttemptId,
    );
    assert.ok(
      Date.parse(String(closed?.closed_at)) >= Number(noticeDone.at),
      "the boundary waited for the accepted busy input's native turn",
    );
    // The follow-up Activation for the new message starts clean.
    const follow = await state.current.agentHost.reconcileOnce();
    assert.equal(follow.state, "completed", JSON.stringify(follow));
    assert.equal(inputs(state).length, 3);
  } finally {
    await state.cleanup();
  }
});

test("warm Claude: cancel interrupts with cancel_queued, the queued input never reaches the next Activation, the process survives", async () => {
  const state = await harness();
  try {
    state.post("[fake:ack] warm up");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    state.post("[fake:hang-once] [fake:ack] long work");
    const controller = new AbortController();
    const running = state.current.agentHost.run({ signal: controller.signal });
    await waitFor(() => turns(state).length === 2, "second turn");
    state.post("[fake:ack] more detail while busy");
    const queued = await waitFor(() => inputs(state)[2], "the busy input");
    controller.abort();
    await running;
    const [interrupt] = interrupts(state);
    assert.deepEqual(interrupt!.request, {
      subtype: "interrupt",
      cancel_queued: true,
    });
    assert.ok(
      events(state, "cancelled").some((record) => record.uuid === queued.uuid),
    );
    const runs = orderedRuns(state);
    assert.equal(runs[1]?.state, "cancelled");
    const processes = state.kernel
      .listRuntimeProcesses({ roomId: state.roomId })
      .sort((a, b) =>
        String(a.runAttemptId).localeCompare(String(b.runAttemptId)),
      );
    const cancelled = processes.find(
      (process) => process.runAttemptId === runs[1]!.runAttemptId,
    );
    assert.equal(cancelled?.proofKind, "turn_quiesced");
    assert.equal(cancelled?.quiesceResult, "cancelled");
    const [row] = sql(state, "SELECT state, pid FROM instance_runtimes");
    assert.equal(row?.state, "idle");
    assert.ok(alive(Number(row?.pid)));
    // The retry and the follow-up run on the same process.
    for (let i = 0; i < 4; i += 1) {
      const next = await state.current.agentHost.reconcileOnce();
      if (next.state === "idle") break;
    }
    assert.ok(orderedRuns(state).length >= 3, "later turns ran after it");
    assert.equal(
      turns(state).some((record) => record.uuid === queued.uuid),
      false,
      "the cancelled input never ran",
    );
    assert.equal(starts(state).length, 1);
  } finally {
    await state.cleanup();
  }
});

test("warm Claude: a CLI that keeps queued input after the interrupt is interrupted again; the Activation closes only after it ended", async () => {
  const state = await harness({ env: { FAKE_IGNORE_CANCEL_QUEUED: "1" } });
  try {
    state.post("[fake:hang] long work");
    const controller = new AbortController();
    const running = state.current.agentHost.run({ signal: controller.signal });
    await waitFor(() => turns(state).length === 1, "first turn");
    state.post("more detail while busy");
    const queued = await waitFor(() => inputs(state)[1], "the busy input");
    controller.abort();
    await running;
    const done = events(state, "turn-completed").find(
      (record) => record.uuid === queued.uuid,
    );
    assert.ok(done, "the surviving input started and was ended");
    assert.equal(done.interrupted, true);
    assert.ok(interrupts(state).length >= 2);
    const [run] = orderedRuns(state);
    assert.equal(run?.state, "cancelled");
    const [closed] = sql(
      state,
      "SELECT closed_at, proof_kind FROM runtime_processes WHERE run_attempt_id = ?",
      run!.runAttemptId,
    );
    assert.equal(closed?.proof_kind, "turn_quiesced");
    assert.ok(Date.parse(String(closed?.closed_at)) >= Number(done.at));
  } finally {
    await state.cleanup();
  }
});

test("warm Claude final reply: the committed --final post ends the turn natively, quiesces as success, and the session continues", async () => {
  const state = await harness();
  try {
    for (let turn = 1; turn <= 2; turn += 1) {
      state.post(`[fake:final] question ${turn}`);
      const result = await state.current.agentHost.reconcileOnce();
      assert.equal(result.state, "completed", JSON.stringify(result));
    }
    assert.deepEqual(events(state, "follow-up-generation"), []);
    assert.equal(interrupts(state).length, 2);
    for (const run of orderedRuns(state)) {
      assert.equal(run.state, "exited");
      const [row] = sql(
        state,
        "SELECT interrupt_sent, preempted_follow_up FROM run_attempt_final_replies WHERE run_attempt_id = ?",
        run.runAttemptId,
      );
      assert.deepEqual(
        { ...row },
        { interrupt_sent: 1, preempted_follow_up: "true" },
      );
    }
    for (const process of state.kernel.listRuntimeProcesses({
      roomId: state.roomId,
    })) {
      assert.equal(process.proofKind, "turn_quiesced");
      assert.equal(process.quiesceResult, "success");
    }
    assert.equal(starts(state).length, 1, "the process survives");
  } finally {
    await state.cleanup();
  }
});

test("warm Claude final reply: a refused interrupt keeps the follow-up generation and the reply still completes", async () => {
  const state = await harness();
  try {
    state.post("[fake:final-reject] question");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    assert.equal(events(state, "follow-up-generation").length, 1);
    const [process] = state.kernel.listRuntimeProcesses({
      roomId: state.roomId,
    });
    assert.equal(process?.quiesceResult, "success");
  } finally {
    await state.cleanup();
  }
});

for (const [order, directive] of [
  ["receipt before result", ""],
  ["result before receipt", "[fake:receipt-after-result]"],
] as const) {
  test(`warm Claude final reply (older CLI, ${order}): a reason-less error_during_execution with the interrupt's success receipt is the final end`, async () => {
    const state = await harness();
    try {
      state.post(`[fake:final] [fake:no-reason] ${directive} question`);
      const result = await state.current.agentHost.reconcileOnce();
      assert.equal(result.state, "completed", JSON.stringify(result));
      const [process] = state.kernel.listRuntimeProcesses({
        roomId: state.roomId,
      });
      assert.equal(process?.quiesceResult, "success");
    } finally {
      await state.cleanup();
    }
  });
}

test("warm Claude: a crash while idle is recorded; the next message cold-starts and resumes the same session", async () => {
  const state = await harness();
  try {
    state.post("[fake:ack] [fake:crash-after] first");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    await waitFor(
      () =>
        sql(state, "SELECT state FROM instance_runtimes")[0]?.state ===
        "terminated",
      "idle crash record",
    );
    state.post("[fake:ack] second");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    const [first, second] = starts(state);
    assert.ok(second, "a second process");
    const argv = second.argv as string[];
    assert.equal(argv[argv.indexOf("--resume") + 1], first!.sessionId);
    assert.equal(second.sessionId, first!.sessionId);
  } finally {
    await state.cleanup();
  }
});

test("warm Claude: idle TTL evicts the idle process; the next turn resumes the recorded session", async () => {
  const state = await harness({ idleTtlMs: 1_000 });
  try {
    state.post("[fake:ack] first");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    state.advance(2_000);
    await state.current.pool.sweepIdle();
    const [row] = sql(
      state,
      "SELECT state, terminated_reason, pid FROM instance_runtimes",
    );
    assert.equal(row?.terminated_reason, "idle_ttl");
    assert.equal(alive(Number(row?.pid)), false);
    state.post("[fake:ack] second");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    const second = starts(state)[1]!.argv as string[];
    assert.equal(
      second[second.indexOf("--resume") + 1],
      starts(state)[0]!.sessionId,
    );
  } finally {
    await state.cleanup();
  }
});

test("warm Claude: without msg_lifecycle_v1 busy input is refused and the wake's own result is the boundary", async () => {
  const state = await harness({ env: { FAKE_NO_LIFECYCLE: "1" } });
  try {
    state.post("[fake:slow] wait");
    const running = state.current.agentHost.reconcileOnce();
    await waitFor(() => turns(state).length === 1, "turn start");
    state.post("more detail while busy");
    assert.equal((await running).state, "completed");
    assert.equal(inputs(state).length, 1, "no busy input was written");
    const follow = await state.current.agentHost.reconcileOnce();
    assert.equal(follow.state, "failed", "the plain follow-up is not acked");
    assert.equal(inputs(state).length, 2);
  } finally {
    await state.cleanup();
  }
});

test("warm Claude: an unprompted native turn while idle is interrupted and never attributed to the next Activation", async () => {
  const state = await harness();
  try {
    state.post("[fake:ack] [fake:autonomous-after] first");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    const ended = await waitFor(
      () => events(state, "autonomous-ended")[0],
      "autonomous turn ended",
    );
    assert.equal(ended.interrupted, true);
    assert.ok(
      state.diagnostics.some((line) => /autonomous_turn/u.test(line)),
      state.diagnostics.join("\n"),
    );
    state.post("[fake:ack] second");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    const processes = state.kernel.listRuntimeProcesses({
      roomId: state.roomId,
    });
    assert.ok(
      processes.every((process) => process.quiesceResult === "success"),
    );
  } finally {
    await state.cleanup();
  }
});

/** Watchdog ticks every 20 ms of real time; thresholds are the defaults. */
const STALL_POLICY: WarmRuntimePolicyOverrides = {
  supervisionIntervalMs: 20,
};

test("warm Claude evo §37 B stall: with work queued, no progress interrupts the turn with the process alive, and the retry completes on the same runtime", async () => {
  const state = await harness({ policy: STALL_POLICY });
  try {
    state.post("[fake:hang-once] [fake:ack] please answer");
    const running = state.current.agentHost.reconcileOnce();
    await waitFor(() => turns(state)[0], "the hanging turn");
    state.post("[fake:ack] a queued follow-up");
    let settled = false;
    const result = running.finally(() => {
      settled = true;
    });
    for (let step = 0; step < 20 && !settled; step += 1) {
      state.advance(15 * 60_000);
      await Promise.race([
        result,
        new Promise((resolve) => setTimeout(resolve, 250)),
      ]);
    }
    const first = await result;
    assert.equal(first.state, "failed", JSON.stringify(first));
    assert.equal(String(first.error), RUN_WATCHDOG_QUEUED_STALL);
    const retried = await state.current.agentHost.reconcileOnce();
    assert.equal(retried.state, "completed", JSON.stringify(retried));
    const runs = sql(
      state,
      `SELECT run.state, run.instance_runtime_id, process.proof_kind
         FROM run_attempts AS run
         JOIN runtime_processes AS process USING (run_attempt_id)
        ORDER BY run.attempt_number`,
    );
    assert.equal(runs[0]!.proof_kind, "turn_quiesced");
    assert.equal(runs[0]!.instance_runtime_id, runs[1]!.instance_runtime_id);
    assert.equal(starts(state).length, 1);
  } finally {
    await state.cleanup();
  }
});

test("warm Claude: a first turn that crashes after its input was accepted resumes the same session", async () => {
  const state = await harness();
  try {
    state.post("[fake:crash-during] [fake:ack] first");
    const first = await state.current.agentHost.reconcileOnce();
    assert.notEqual(first.state, "completed");
    assert.deepEqual(state.inputsAtBinding, [1], "bound after acceptance");
    for (let i = 0; i < 3; i += 1) {
      const next = await state.current.agentHost.reconcileOnce();
      if (next.state === "completed" || next.state === "idle") break;
    }
    const [crashed, resumedStart] = starts(state);
    assert.ok(resumedStart, "a second process");
    const argv = resumedStart.argv as string[];
    assert.equal(argv[argv.indexOf("--resume") + 1], crashed!.sessionId);
  } finally {
    await state.cleanup();
  }
});

test("the registry builds the warm Claude adapter for claude-stream-json/v1 and still refuses other drivers", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-warm-claude-registry-"));
  chmodSync(directory, 0o700);
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  kernel.initialize();
  try {
    const executable = join(directory, "claude");
    writeFileSync(
      executable,
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakePath)} "$@"\n`,
      { mode: 0o700 },
    );
    const agent = kernel.provisionPrincipal({ handle: "reg", kind: "agent" });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "reg-host",
        participantIds: [agent.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(host);
    const profiles = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "reg-host",
    });
    profiles.initialize();
    const implementations = new RuntimeImplementationRegistry();
    const manifest = (kind: "claude-stream-json/v1" | "kimi-acp/v1") => ({
      adapter: {
        config: { diagnosticByteLimit: 262_144, terminationGraceMs: 1_000 },
        executable,
        fixedArgs: [],
        kind,
      },
      credentialSlots: [],
      declaredCapabilities: ["worker_commands" as const],
      displayName: `FAKE ${kind}`,
      manifestVersion: 3 as const,
      modelCatalogProbe: {
        kind:
          kind === "claude-stream-json/v1"
            ? ("claude-cli/v1" as const)
            : ("kimi-cli/v1" as const),
      },
      protocolFamily: "rah-worker-process/v1" as const,
      recoveryDrivers: ["rah-process-supervisor-v1"],
      runtimeProfileId: `fake-${kind.split("/")[0]}`,
      staticEnv: {},
      workspacePolicy: { allowedModes: ["in_place" as const] },
    });
    const revision = profiles.importManifest(manifest("claude-stream-json/v1"));
    const report = profiles.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    const active = profiles.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    const pool = new InstanceRuntimePool({
      control: createKernelAgentHostControlPort(kernel, host),
      hostGeneration: host.instanceId,
      stateDirectory: join(directory, "warm"),
    });
    const warm = {
      issueWorkerCredential: async () => ({
        accessToken: "unused",
        revoke: () => undefined,
      }),
      pool,
      runtimeEnvironment: async () => ({ env: {} }),
      workerApiOrigin: "http://127.0.0.1:9",
    };
    const adapter = implementations.createWarmRuntime(
      active,
      report,
      { cwd: directory },
      warm,
      undefined,
      "full_access",
    );
    assert.equal(adapter.guideRuntimeId, "claude");
    assert.equal(adapter.busyInputMode, "direct");
    // Review batch 1 #6: a second claim's adapter over the same pool reuses
    // the launch state the pool keeps (one object per driver, not per claim).
    const shared: unknown[] = [];
    const share = pool.shared.bind(pool);
    pool.shared = <T>(key: string, create: () => T): T => {
      const value = share(key, create);
      shared.push(value);
      return value;
    };
    for (let claim = 0; claim < 2; claim += 1)
      implementations.createWarmRuntime(
        active,
        report,
        { cwd: directory },
        warm,
        undefined,
        "full_access",
      );
    assert.equal(shared.length, 2);
    assert.equal(shared[0], shared[1]);
    const kimi = profiles.importManifest(manifest("kimi-acp/v1"));
    assert.throws(
      () =>
        implementations.createWarmRuntime(
          kimi,
          report,
          { cwd: directory },
          warm,
          undefined,
          "full_access",
        ),
      /warm runtimes support codex-app-server\/v1, claude-stream-json\/v1 and opencode-server\/v1 only/u,
    );
    profiles.close();
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
