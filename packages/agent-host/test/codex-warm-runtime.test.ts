import assert from "node:assert/strict";
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
  CodexWarmAdapter,
  createKernelAgentHostControlPort,
  createSystemProcessTable,
  InstanceRuntimePool,
  LeftoverProcessSweeper,
  renderBodiedWake,
  RuntimeProcessHygiene,
  type RuntimeAdapter,
} from "../src/index.ts";

/**
 * S2-a end to end with a FAKE Codex app-server (no model, no paid CLI): real
 * Kernel and SQLite, real Worker HTTP API and Worker CLI, the real warm
 * driver over a real Unix-socket WebSocket, and AgentHost. The fake chooses
 * each turn's behaviour from `[fake:*]` tokens in the Room message, which
 * reaches it through the bodied wake. It cannot prove the real Codex
 * multi-turn protocol; that is the separate, owner-authorized smoke gate.
 */
const fakeServerPath = fileURLToPath(
  new URL("./fixtures/fake-codex-warm-app-server.mjs", import.meta.url),
);

type Harness = Awaited<ReturnType<typeof harness>>;

async function harness(
  options: {
    failBinding?: boolean;
    hostHygiene?: boolean;
    interruptQuiesceTimeoutMs?: number;
    idleTtlMs?: number;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "rah-warm-codex-"));
  chmodSync(directory, 0o700);
  const socketRoot = mkdtempSync("/tmp/lw-");
  chmodSync(socketRoot, 0o700);
  const stateDirectory = join(directory, "fake-state");
  const recordPath = join(directory, "record.jsonl");
  const executable = join(directory, "codex");
  writeFileSync(
    executable,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeServerPath)} "$@"\n`,
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
    handle: "warm-codex",
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
  /** turn/start requests already sent when each binding was persisted. */
  const turnStartsAtBinding: number[] = [];
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
      cwd: directory,
      driverArgs: [
        "--executable",
        executable,
        "--tool-access-mode",
        "full_access",
        "--prompt",
        "FAKE standing prompt for the warm runtime test",
      ],
      env: {
        FAKE_CODEX_RECORD_PATH: recordPath,
        FAKE_CODEX_STATE_DIR: stateDirectory,
      },
      ...(options.interruptQuiesceTimeoutMs === undefined
        ? {}
        : { interruptQuiesceTimeoutMs: options.interruptQuiesceTimeoutMs }),
      isWarm: () => true,
      issueWorkerCredential: async (input) =>
        worker.issueActivationCredential(host, input),
      legacy,
      pool,
      recordProviderSessionEvidence: (input, evidence) => {
        if (options.failBinding === true)
          throw new Error("FAKE binding store unavailable");
        turnStartsAtBinding.push(
          readRecords().filter(
            (record) =>
              record.event === "request" && record.method === "turn/start",
          ).length,
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
      ...(options.hostHygiene === true ? { processHygiene: hygiene } : {}),
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

  let host = kernel.authenticateHostAccessToken(hostToken);
  kernel.heartbeatHost(host);
  let current = makeHost(host);

  return {
    actor,
    advance(ms: number) {
      nowMs += ms;
    },
    get current() {
      return current;
    },
    databasePath,
    diagnostics,
    directory,
    kernel,
    participantId,
    post(body: string, sender = actor) {
      messages += 1;
      return kernel.postMessage(sender, {
        body,
        idempotencyKey: `warm-message-${messages}`,
        recipients: [{ participantId, reason: "mention" }],
        roomId: room.roomId,
      });
    },
    records: readRecords,
    sessions,
    turnStartsAtBinding,
    restartHost() {
      kernel.heartbeatHost(host, { state: "offline" });
      host = kernel.authenticateHostAccessToken(hostToken);
      kernel.heartbeatHost(host);
      current = makeHost(host);
      return current;
    },
    hygiene,
    roomId: room.roomId,
    stateDirectory,
    worker,
    async cleanup() {
      await current.pool.shutdown().catch(() => undefined);
      for (const record of this.records())
        for (const key of ["leftoverPid", "toolPid"])
          if (typeof record[key] === "number")
            try {
              process.kill(record[key] as number, "SIGKILL");
            } catch {
              // Already gone.
            }
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

test("S2-0 review P2-2: a warm turn carries the cleanup notice inside the accepted digest and consumes it once", async () => {
  const state = await harness({ hostHygiene: true });
  try {
    state.kernel.runtimeProcessCleanup.record(state.current.host, {
      capExceeded: [],
      cleanupId: "warm-notice-cleanup",
      foundCount: 1,
      killedCount: 1,
      observedAt: new Date().toISOString(),
      participantId: state.participantId,
      releasedPorts: [],
      remainingCount: 0,
      remainingPorts: [],
      runtimeRunId: "process:earlier-cold-run",
      trigger: "run_end",
    });
    for (let turn = 1; turn <= 2; turn += 1) {
      state.post(`[fake:ack] question ${turn}`);
      const result = await state.current.agentHost.reconcileOnce();
      assert.equal(result.state, "completed", JSON.stringify(result));
    }
    const texts = state
      .records()
      .filter(
        (record) =>
          record.event === "request" && record.method === "turn/start",
      )
      .map((record) => JSON.stringify(record.params));
    assert.equal(texts.length, 2);
    assert.match(texts[0]!, /1 leftover background process was stopped/u);
    assert.doesNotMatch(texts[1]!, /Host cleanup/u);
    const [row] = sql(
      state,
      "SELECT notice_run_attempt_id, notice_accepted_at FROM runtime_process_cleanups WHERE cleanup_id = 'warm-notice-cleanup'",
    );
    assert.ok(row?.notice_accepted_at, "accepted through the digest match");
    const firstRun = state.kernel
      .listRunAttempts({ roomId: state.roomId })
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0]!;
    assert.equal(row?.notice_run_attempt_id, firstRun.runAttemptId);
  } finally {
    await state.cleanup();
  }
});

test("three Activations run on one warm process and one thread, each quiesced", async () => {
  const state = await harness();
  try {
    for (let turn = 1; turn <= 3; turn += 1) {
      state.post(`[fake:ack] question ${turn}`);
      const result = await state.current.agentHost.reconcileOnce();
      assert.equal(result.state, "completed", JSON.stringify(result));
    }
    const records = state.records();
    assert.equal(
      records.filter((record) => record.event === "start").length,
      1,
      "one app-server process for three Activations",
    );
    const turnStarts = records.filter(
      (record) => record.event === "request" && record.method === "turn/start",
    );
    assert.equal(turnStarts.length, 3);
    const threads = new Set(
      turnStarts.map(
        (record) => (record.params as { threadId: string }).threadId,
      ),
    );
    assert.equal(threads.size, 1, "every turn continues the same thread");
    const handles = records
      .filter((record) => record.event === "turn")
      .map((record) => record.handle);
    assert.equal(new Set(handles).size, 3, "each turn gets its own handle");
    assert.ok(
      records
        .filter((record) => record.event === "worker")
        .every((record) => record.status === 0),
      "the Worker CLI accepted each turn's own handle",
    );

    const processes = state.kernel.listRuntimeProcesses({
      roomId: state.roomId,
    });
    assert.equal(processes.length, 3);
    for (const process of processes) {
      assert.equal(process.state, "terminated");
      assert.equal(process.proofKind, "turn_quiesced");
      assert.equal(process.quiesceResult, "success");
      assert.equal(process.exitCode, undefined);
      assert.equal(process.exitSignal, undefined);
    }
    const runs = state.kernel.listRunAttempts({ roomId: state.roomId });
    assert.equal(runs.length, 3);
    assert.equal(new Set(runs.map((run) => run.instanceRuntimeId)).size, 1);
    assert.equal(new Set(runs.map((run) => run.nativeTurnId)).size, 3);
    assert.ok(runs.every((run) => run.state === "exited"));
    const modes = sql(
      state,
      "SELECT execution_mode FROM run_attempts ORDER BY started_at",
    ).map((row) => row.execution_mode);
    assert.deepEqual(modes, ["cold", "warm", "warm"]);
    const runtime = state.kernel.instanceRuntimes.get(
      state.current.host,
      runs[0]!.instanceRuntimeId!,
    );
    assert.equal(runtime.state, "idle");
    assert.equal(runtime.turnCount, 3);
    assert.ok(runtime.pid !== undefined && alive(runtime.pid));
    assert.equal(
      state.kernel
        .listActivations({ roomId: state.roomId })
        .every((activation) => activation.state === "completed"),
      true,
    );
  } finally {
    await state.cleanup();
  }
});

test("a quiesced turn without delivery ACK does not complete its Activation", async () => {
  const state = await harness();
  try {
    state.post("[fake:noop] nothing will be acknowledged");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(result.state, "failed");
    assert.match(
      result.state === "failed" ? result.error : "",
      /not acknowledged through sequence/u,
    );
    const [process] = state.kernel.listRuntimeProcesses({
      roomId: state.roomId,
    });
    assert.equal(process?.proofKind, "turn_quiesced");
    const [activation] = state.kernel.listActivations({ roomId: state.roomId });
    assert.notEqual(activation?.state, "completed");
    const [row] = sql(state, "SELECT state FROM instance_runtimes");
    assert.equal(row?.state, "idle", "the lane is released after the retry");
  } finally {
    await state.cleanup();
  }
});

test("a background tool of turn N cannot act or discover authority after N+1 starts", async () => {
  const state = await harness();
  try {
    state.post("[fake:background-tool] start a background job");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    const firstHandle = state
      .records()
      .find((record) => record.event === "turn")!.handle as string;
    state.post("[fake:hang] a long second turn");
    const second = state.current.agentHost.reconcileOnce();
    const secondTurn = await waitFor(
      () => state.records().filter((record) => record.event === "turn")[1],
      "the second turn",
    );
    assert.notEqual(secondTurn.handle, firstHandle);
    writeFileSync(join(state.stateDirectory, "release-background"), "go");
    const resultPath = join(state.stateDirectory, "background-result.json");
    await waitFor(() => existsSync(resultPath), "background tool result");
    const outcome = JSON.parse(readFileSync(resultPath, "utf8")) as {
      bareStatus: number;
      bareStderr: string;
      listing: unknown;
      status: number;
      stderr: string;
    };
    assert.notEqual(outcome.status, 0);
    assert.match(outcome.stderr, /TURN_HANDLE_INACTIVE/u);
    assert.match(outcome.stderr, /latest wake/u);
    assert.doesNotMatch(outcome.stderr, new RegExp(String(secondTurn.handle)));
    assert.equal(outcome.listing, "EACCES", "the turn root is not listable");
    assert.notEqual(outcome.bareStatus, 0);
    assert.match(outcome.bareStderr, /TURN_HANDLE_REQUIRED/u);
    // End the second turn (interrupted), then stop.
    const runs = state.kernel.listRunAttempts({ roomId: state.roomId });
    assert.equal(runs.length, 2);
    await state.current.pool.shutdown();
    await second;
  } finally {
    await state.cleanup();
  }
});

test("a frame of turn N arriving during N+1 is late for N, never attributed to N+1", async () => {
  const state = await harness();
  try {
    state.post("[fake:ack] [fake:late-usage] first");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    state.post("[fake:ack] second");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    const [first, second] = state.kernel.listRunAttempts({
      roomId: state.roomId,
    });
    const usage = (runAttemptId: string) =>
      sql(
        state,
        "SELECT response_id FROM run_attempt_usage WHERE run_attempt_id = ?",
        runAttemptId,
      ).map((row) => String(row.response_id));
    assert.ok(
      usage(second!.runAttemptId).every(
        (id) => !id.includes(first!.nativeTurnId!),
      ),
      "turn N+1 never receives turn N usage",
    );
    const read = (runAttemptId: string) =>
      sql(
        state,
        "SELECT late_frame_count FROM runtime_processes WHERE run_attempt_id = ?",
        runAttemptId,
      )[0]!.late_frame_count;
    await waitFor(() => Number(read(first!.runAttemptId)) > 0, "late frame");
    assert.equal(Number(read(second!.runAttemptId)), 0);
    assert.ok(
      state.diagnostics.some((line) => /late frame of closed turn/u.test(line)),
    );
  } finally {
    await state.cleanup();
  }
});

test("busy Human input steers exactly the running turn", async () => {
  const state = await harness();
  try {
    state.post("[fake:steer-wait] wait for more");
    const running = state.current.agentHost.reconcileOnce();
    await waitFor(
      () => state.records().some((record) => record.event === "turn"),
      "turn start",
    );
    state.post("additional human detail");
    assert.equal((await running).state, "completed");
    const completed = state
      .records()
      .find((record) => record.event === "turn-completed") as {
      steers: string[];
    };
    assert.equal(completed.steers.length, 1);
    // The Kernel's busy notice (Human, same Room) names the new message.
    assert.match(completed.steers[0]!, /latest sender @warm-human/u);
  } finally {
    await state.cleanup();
  }
});

test("after a native compaction the handle is restated inside the same turn", async () => {
  const state = await harness();
  try {
    state.post("[fake:compact] [fake:ack] long context");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    const turn = state.records().find((record) => record.event === "turn")!;
    const completed = state
      .records()
      .find((record) => record.event === "turn-completed") as {
      steers: string[];
    };
    assert.equal(completed.steers.length, 1);
    assert.match(
      completed.steers[0]!,
      new RegExp(`--turn ${String(turn.handle)}`),
    );
  } finally {
    await state.cleanup();
  }
});

test("an unloaded thread is resumed by id in the same process, never replaced", async () => {
  const state = await harness();
  try {
    state.post("[fake:ack] [fake:unload-after] first");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    state.post("[fake:ack] second");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    const records = state.records();
    assert.equal(
      records.filter((record) => record.event === "start").length,
      1,
    );
    assert.equal(
      records.filter(
        (record) =>
          record.event === "request" && record.method === "thread/start",
      ).length,
      1,
    );
    const resume = records.find(
      (record) =>
        record.event === "request" && record.method === "thread/resume",
    );
    const turns = records.filter(
      (record) => record.event === "request" && record.method === "turn/start",
    );
    assert.equal(
      (resume!.params as { threadId: string }).threadId,
      (turns[0]!.params as { threadId: string }).threadId,
    );
  } finally {
    await state.cleanup();
  }
});

test("cancel interrupts natively and quiesces; the process survives", async () => {
  const state = await harness();
  try {
    state.post("[fake:ack] warm up");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    state.post("[fake:hang] long work");
    const controller = new AbortController();
    const running = state.current.agentHost.run({ signal: controller.signal });
    await waitFor(
      () => state.records().filter((record) => record.event === "turn")[1],
      "second turn",
    );
    controller.abort();
    await running;
    const runs = state.kernel.listRunAttempts({ roomId: state.roomId });
    assert.equal(runs[1]?.state, "cancelled");
    const processes = state.kernel.listRuntimeProcesses({
      roomId: state.roomId,
    });
    assert.equal(processes[1]?.proofKind, "turn_quiesced");
    assert.equal(processes[1]?.quiesceResult, "cancelled");
    const [row] = sql(state, "SELECT state, pid FROM instance_runtimes");
    assert.equal(row?.state, "idle");
    assert.ok(
      alive(Number(row?.pid)),
      "an interrupt does not kill the runtime",
    );
    assert.equal(
      state.records().filter((record) => record.event === "start").length,
      1,
    );
  } finally {
    await state.cleanup();
  }
});

test("cancel without native quiescence kills the runtime group: a real process exit", async () => {
  const state = await harness({ interruptQuiesceTimeoutMs: 300 });
  try {
    state.post("[fake:hang-ignore-interrupt] stuck");
    const controller = new AbortController();
    const running = state.current.agentHost.run({ signal: controller.signal });
    await waitFor(
      () => state.records().some((record) => record.event === "turn"),
      "turn start",
    );
    controller.abort();
    await running;
    const [run] = state.kernel.listRunAttempts({ roomId: state.roomId });
    assert.equal(run?.state, "cancelled");
    const [process] = state.kernel.listRuntimeProcesses({
      roomId: state.roomId,
    });
    assert.equal(process?.proofKind, "process_exit");
    // The real exit of the killed group (the driver exits on SIGTERM).
    assert.ok(
      process?.exitCode !== undefined || process?.exitSignal !== undefined,
    );
    const [row] = sql(
      state,
      "SELECT state, terminated_reason, pid FROM instance_runtimes",
    );
    assert.equal(row?.state, "terminated");
    assert.equal(row?.terminated_reason, "stall");
    assert.equal(alive(Number(row?.pid)), false);
  } finally {
    await state.cleanup();
  }
});

test("a crash while idle is recorded; the next message cold-starts and resumes the same thread", async () => {
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
    const [crashed] = sql(
      state,
      "SELECT terminated_reason FROM instance_runtimes",
    );
    assert.equal(crashed?.terminated_reason, "crash");
    state.post("[fake:ack] second");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    const records = state.records();
    assert.equal(
      records.filter((record) => record.event === "start").length,
      2,
    );
    const threadStart = records.find(
      (record) =>
        record.event === "request" && record.method === "thread/start",
    );
    const resume = records.find(
      (record) =>
        record.event === "request" && record.method === "thread/resume",
    );
    assert.ok(resume, "the cold start resumed the recorded thread");
    const turns = records.filter(
      (record) => record.event === "request" && record.method === "turn/start",
    );
    assert.equal(
      (turns[1]!.params as { threadId: string }).threadId,
      (turns[0]!.params as { threadId: string }).threadId,
    );
    assert.ok(threadStart);
    const modes = sql(
      state,
      "SELECT execution_mode, session_resume_ms FROM run_attempts ORDER BY started_at",
    );
    assert.equal(modes[1]?.execution_mode, "cold");
    assert.ok(Number(modes[1]?.session_resume_ms) >= 0);
    assert.notEqual(modes[1]?.session_resume_ms, null);
  } finally {
    await state.cleanup();
  }
});

test("after a daemon restart the old runtime is killed and proven gone before new work", async () => {
  const state = await harness();
  try {
    state.post("[fake:ack] first");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    const [old] = sql(
      state,
      "SELECT instance_runtime_id, pid FROM instance_runtimes",
    );
    const oldPid = Number(old?.pid);
    assert.ok(alive(oldPid));
    state.restartHost();
    state.post("[fake:ack] after restart");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    assert.equal(alive(oldPid), false, "the old generation's runtime is dead");
    const rows = sql(
      state,
      "SELECT instance_runtime_id, state, terminated_reason FROM instance_runtimes ORDER BY started_at",
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.state, "terminated");
    assert.equal(rows[0]?.terminated_reason, "host_shutdown");
    assert.equal(rows[1]?.state, "idle");
    const starts = state.records().filter((record) => record.event === "start");
    const stops = state
      .records()
      .filter(
        (record) => record.event === "stop" && record.pid !== starts[1]?.pid,
      );
    assert.ok(stops.length >= 1 || !alive(oldPid));
    assert.ok(
      state
        .records()
        .some(
          (record) =>
            record.event === "request" && record.method === "thread/resume",
        ),
    );
  } finally {
    await state.cleanup();
  }
});

test("a leftover grandchild survives turns but is swept when the runtime ends", async () => {
  const state = await harness();
  try {
    state.post("[fake:ack] [fake:leftover] start a server");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    const leftoverPid = Number(
      state.records().find((record) => record.event === "leftover")!
        .leftoverPid,
    );
    assert.ok(alive(leftoverPid), "a warm runtime keeps turn N's processes");
    await state.current.pool.shutdown();
    await waitFor(() => !alive(leftoverPid), "leftover sweep", 8_000);
    const cleanups = sql(
      state,
      "SELECT killed_count, trigger FROM runtime_process_cleanups",
    );
    assert.ok(cleanups.some((row) => Number(row.killed_count) >= 1));
  } finally {
    await state.cleanup();
  }
});

test("a quiesced turn never sweeps the warm runtime's tree; the S2-0 and warm janitors leave it alive", async () => {
  const state = await harness();
  try {
    state.post("[fake:ack] [fake:leftover] start a server");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    const [process] = state.kernel.listRuntimeProcesses({
      roomId: state.roomId,
    });
    assert.equal(process?.proofKind, "turn_quiesced");
    assert.equal(process?.state, "terminated");
    const leftoverPid = Number(
      state.records().find((record) => record.event === "leftover")!
        .leftoverPid,
    );
    const [row] = sql(state, "SELECT pid, state FROM instance_runtimes");
    // Both janitors run after the per-turn record is terminated.
    await state.hygiene.janitor(state.current.control, "janitor");
    await state.current.pool.janitor();
    assert.ok(alive(leftoverPid), "turn N's live descendant is kept");
    assert.ok(alive(Number(row?.pid)), "the warm process is kept");
    assert.equal(
      sql(state, "SELECT state FROM instance_runtimes")[0]?.state,
      "idle",
    );
    assert.equal(
      sql(
        state,
        "SELECT COUNT(*) AS n FROM runtime_process_cleanups WHERE killed_count > 0",
      )[0]?.n,
      0,
      "no sweep killed anything at the turn boundary",
    );
  } finally {
    await state.cleanup();
  }
});

test("idle TTL evicts only an idle runtime, never mid-turn", async () => {
  const state = await harness({ idleTtlMs: 1_000 });
  try {
    state.post("[fake:steer-wait] busy for a while");
    const running = state.current.agentHost.reconcileOnce();
    await waitFor(
      () => state.records().some((record) => record.event === "turn"),
      "turn start",
    );
    state.advance(10_000);
    await state.current.pool.sweepIdle();
    assert.equal(
      sql(state, "SELECT state FROM instance_runtimes")[0]?.state,
      "busy",
      "no eviction mid-turn",
    );
    await running;
    assert.equal(
      sql(state, "SELECT state FROM instance_runtimes")[0]?.state,
      "idle",
    );
    state.advance(500);
    await state.current.pool.sweepIdle();
    assert.equal(
      sql(state, "SELECT state FROM instance_runtimes")[0]?.state,
      "idle",
      "not evicted before the TTL",
    );
    state.advance(1_000);
    await state.current.pool.sweepIdle();
    const [row] = sql(
      state,
      "SELECT state, terminated_reason, pid FROM instance_runtimes",
    );
    assert.equal(row?.state, "terminated");
    assert.equal(row?.terminated_reason, "idle_ttl");
    assert.equal(alive(Number(row?.pid)), false);
  } finally {
    await state.cleanup();
  }
});

function threadIds(state: Harness) {
  const records = state.records();
  const of = (method: string) =>
    records
      .filter(
        (record) => record.event === "request" && record.method === method,
      )
      .map((record) => (record.params as { threadId?: string }).threadId);
  return {
    resumes: of("thread/resume"),
    starts: records.filter(
      (record) =>
        record.event === "request" && record.method === "thread/start",
    ).length,
    turns: of("turn/start"),
  };
}

test("S2-a review P1-2: a first turn accepted then cancelled resumes the same thread after TTL eviction", async () => {
  const state = await harness({ idleTtlMs: 1_000 });
  try {
    state.post("[fake:hang-once] [fake:ack] first turn, then cancelled");
    const controller = new AbortController();
    const running = state.current.agentHost.run({ signal: controller.signal });
    await waitFor(
      () => state.records().some((record) => record.event === "turn"),
      "first turn start",
    );
    assert.deepEqual(
      state.turnStartsAtBinding,
      [0],
      "the binding was durable before the first turn input",
    );
    controller.abort();
    await running;
    const [first] = state.kernel.listRunAttempts({ roomId: state.roomId });
    assert.equal(first?.state, "cancelled");
    // run() took the Host offline on abort; this generation serves again.
    state.kernel.heartbeatHost(state.current.host);
    state.advance(5_000);
    await state.current.pool.sweepIdle();
    assert.equal(
      sql(state, "SELECT state FROM instance_runtimes")[0]?.state,
      "terminated",
    );
    state.post("[fake:ack] second");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await state.current.agentHost.reconcileOnce();
      if (result.state === "idle") break;
    }
    const ids = threadIds(state);
    assert.equal(ids.starts, 1, "never a silent new thread");
    assert.ok(ids.resumes.length >= 1);
    assert.ok(ids.turns.length >= 2);
    assert.ok(
      ids.turns.every((threadId) => threadId === ids.turns[0]),
      "every turn continues the first turn's thread",
    );
    assert.equal(ids.resumes[0], ids.turns[0]);
  } finally {
    await state.cleanup();
  }
});

test("S2-a review P1-2: a first turn that crashes mid-turn resumes the same thread", async () => {
  const state = await harness();
  try {
    state.post("[fake:crash-during] [fake:ack] crash in the first turn");
    const first = await state.current.agentHost.reconcileOnce();
    assert.equal(first.state, "failed", JSON.stringify(first));
    await waitFor(
      () =>
        sql(state, "SELECT state FROM instance_runtimes")[0]?.state ===
        "terminated",
      "crash record",
    );
    let completed = false;
    for (let attempt = 0; attempt < 4 && !completed; attempt += 1)
      completed =
        (await state.current.agentHost.reconcileOnce()).state === "completed";
    assert.ok(completed, "the retry completed on a cold start");
    const ids = threadIds(state);
    assert.equal(ids.starts, 1, "never a silent new thread");
    assert.equal(ids.resumes[0], ids.turns[0]);
    assert.ok(ids.turns.every((threadId) => threadId === ids.turns[0]));
  } finally {
    await state.cleanup();
  }
});

test("S2-a review P1-2: a binding failure stops the turn before its input is sent", async () => {
  const state = await harness({ failBinding: true });
  try {
    state.post("[fake:ack] must not reach Codex");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(result.state, "failed");
    assert.match(
      result.state === "failed" ? result.error : "",
      /RAH_SESSION_CONTINUITY_REQUIRED/u,
    );
    assert.equal(threadIds(state).turns.length, 0, "no turn input was sent");
  } finally {
    await state.cleanup();
  }
});

test("S2-a review P2-1: a steer answered after the native turn end stays inside its turn", async () => {
  const state = await harness();
  try {
    state.post("[fake:steer-race] steer while closing");
    const running = state.current.agentHost.reconcileOnce();
    await waitFor(
      () => state.records().some((record) => record.event === "worker"),
      "the turn's own ACK",
    );
    state.post("late human detail");
    assert.equal((await running).state, "completed");
    const completed = state
      .records()
      .find((record) => record.event === "turn-completed") as {
      steers: string[];
    };
    assert.equal(completed.steers.length, 1, "Codex accepted the steer");
    const [run] = state.kernel.listRunAttempts({ roomId: state.roomId });
    const [row] = sql(
      state,
      "SELECT late_frame_count FROM runtime_processes WHERE run_attempt_id = ?",
      run!.runAttemptId,
    );
    assert.equal(
      Number(row?.late_frame_count),
      0,
      "the steer receipt precedes the drain; nothing of the turn is late",
    );
    assert.ok(
      !state.diagnostics.some((line) =>
        /late frame of closed turn/u.test(line),
      ),
    );
  } finally {
    await state.cleanup();
  }
});
