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
  createSessionProtocolState,
  InstanceRuntimePool,
  LeftoverProcessSweeper,
  protocolUpdateNotice,
  ProviderSessionStore,
  renderBodiedWake,
  SessionProtocolUpgrade,
  RuntimeProcessHygiene,
  type ActivationEnvelope,
  type RuntimeAdapter,
  type WarmRuntimePolicyOverrides,
  type CodexWarmAdapterOptions,
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
    policy?: WarmRuntimePolicyOverrides;
    protocolNotice?: CodexWarmAdapterOptions["protocolNotice"];
    acceptSessionProtocol?: CodexWarmAdapterOptions["acceptSessionProtocol"];
    /**
     * Review batch 1 #6: like the production placement resolver, a new
     * adapter for every claim over the one shared pool. `perAdapter` adds
     * options built for each adapter (e.g. its own SessionProtocolUpgrade).
     */
    adapterPerClaim?: boolean;
    runtimeStartTimeoutMs?: number;
    /** Every turn takes the per-turn path (warm runtimes switched off). */
    coldOnly?: () => boolean;
    /** AgentHost receives the pool as its instance runtime lifecycle. */
    hostPool?: boolean;
    perAdapter?: (
      pool: InstanceRuntimePool,
    ) => Partial<CodexWarmAdapterOptions>;
    /** S3: a Workspace Direct Room with the same participant beside the Room. */
    privateBox?: boolean;
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
  let directRoomId: string | undefined;
  if (options.privateBox === true) {
    const workspace = kernel.createWorkspace(actor, {
      name: "Warm workspace",
      slug: "warm-workspace",
      idempotencyKey: "warm-workspace",
    });
    kernel.addMember(actor, {
      principalId: participantId,
      roomId: workspace.controlRoom.roomId,
    });
    directRoomId = kernel.openDirectRoom(actor, {
      workspaceId: workspace.workspace.workspaceId,
      peerPrincipalId: participantId,
      basedOnControlRoomSeq: kernel.sync(actor, {
        roomId: workspace.controlRoom.roomId,
        consumerId: "warm-direct-open",
      }).latestRoomSeq,
      idempotencyKey: "warm-direct",
    }).roomId;
  }
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
    const createAdapter = () =>
      new CodexWarmAdapter({
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
        isWarm: () => options.coldOnly?.() !== true,
        ...(options.protocolNotice === undefined
          ? {}
          : { protocolNotice: options.protocolNotice }),
        ...(options.acceptSessionProtocol === undefined
          ? {}
          : { acceptSessionProtocol: options.acceptSessionProtocol }),
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
        ...options.perAdapter?.(pool),
      });
    const adapter: RuntimeAdapter =
      options.adapterPerClaim === true
        ? perClaimAdapter(createAdapter)
        : createAdapter();
    const agentHost = new AgentHost({
      drainTimeoutMs: 300,
      guideEnabled: () => true,
      host,
      kernel,
      leaseMs: 30_000,
      pollIntervalMs: 20,
      ...(options.hostHygiene === true ? { processHygiene: hygiene } : {}),
      ...(options.hostPool === true ? { instanceRuntimePool: pool } : {}),
      retryAfterMs: 0,
      runtime: adapter,
      ...(options.runtimeStartTimeoutMs === undefined
        ? {}
        : { runtimeStartTimeoutMs: options.runtimeStartTimeoutMs }),
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
    post(body: string, sender = actor, roomId = room.roomId) {
      messages += 1;
      return kernel.postMessage(sender, {
        body,
        idempotencyKey: `warm-message-${messages}`,
        recipients: [{ participantId, reason: "mention" }],
        roomId,
      });
    },
    directRoomId,
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

/**
 * The production placement path's adapter lifetime: every claim resolves a
 * fresh adapter; later calls for that RunAttempt reach the one that started it.
 */
function perClaimAdapter(create: () => CodexWarmAdapter): RuntimeAdapter {
  const byRun = new Map<string, CodexWarmAdapter>();
  const byAttempt = new Map<string, CodexWarmAdapter>();
  const first = create();
  const of = (runId: string) => byRun.get(runId) ?? first;
  return {
    busyInputMode: first.busyInputMode,
    busyInputSupported: first.busyInputSupported,
    guideRuntimeId: first.guideRuntimeId,
    recoveryDrivers: first.recoveryDrivers,
    probe: async () => await first.probe(),
    async start(input, lifecycle) {
      const adapter = create();
      byAttempt.set(input.runAttemptId, adapter);
      const handle = await adapter.start(input, lifecycle);
      byRun.set(handle.runId, adapter);
      return handle;
    },
    reap: async (run) => await of(run.runId).reap(run),
    cancel: async (run) => await of(run.runId).cancel(run),
    isAlive: async (run) => await of(run.runId).isAlive(run),
    notifyBusy: async (run, notice) =>
      await of(run.runId).notifyBusy(run, notice),
    interruptAfterFinalReply: async (run) =>
      await of(run.runId).interruptAfterFinalReply(run),
    acceptSessionProtocol: async (input) =>
      await (byAttempt.get(input.runAttemptId) ?? first).acceptSessionProtocol(
        input,
      ),
    releaseTurn: async (input) =>
      await (byAttempt.get(input.runAttemptId) ?? first).releaseTurn(input),
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

test("P2-3: a warm turn carries the protocol line until a completed turn accepts it", async () => {
  let accepted: string | undefined;
  const carried: string[] = [];
  const state = await harness({
    protocolNotice: (input) => {
      if (accepted !== undefined) return undefined;
      carried.push(input.runAttemptId);
      return "Protocol updated (vtest): help protocol summarizes the current rules.";
    },
    acceptSessionProtocol: async (input) => {
      if (carried.includes(input.runAttemptId)) accepted = input.runAttemptId;
    },
  });
  try {
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
    assert.match(texts[0]!, /Protocol updated \(vtest\)/u);
    assert.doesNotMatch(texts[1]!, /Protocol updated/u);
    assert.equal(accepted, carried[0]);
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

test("S3: a private-box turn after a channel turn continues the same warm runtime and thread under its own Room scope", async () => {
  const state = await harness({ privateBox: true });
  try {
    const directRoomId = state.directRoomId!;
    state.post("[fake:ack] channel question");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    state.post("[fake:ack] private question", state.actor, directRoomId);
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    state.post("[fake:ack] channel again");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    const records = state.records();
    assert.equal(
      records.filter((record) => record.event === "start").length,
      1,
      "one app-server process serves both Rooms",
    );
    assert.equal(new Set(threadIds(state).turns).size, 1, "one native thread");
    assert.equal(threadIds(state).starts, 1);
    const activations = [
      ...state.kernel.listActivations({ roomId: state.roomId }),
      ...state.kernel.listActivations({ roomId: directRoomId }),
    ];
    const runs = sql(
      state,
      "SELECT activation_id, room_id, instance_runtime_id, execution_mode FROM run_attempts ORDER BY started_at",
    );
    assert.deepEqual(
      runs.map((run) => run.room_id),
      [state.roomId, directRoomId, state.roomId],
    );
    assert.deepEqual(
      runs.map((run) => run.execution_mode),
      ["cold", "warm", "warm"],
    );
    assert.equal(new Set(runs.map((run) => run.instance_runtime_id)).size, 1);
    // Each turn's Worker authority names its own Activation's Room and range.
    assert.deepEqual(
      records
        .filter((record) => record.event === "turn")
        .map((record) => record.scope),
      runs.map((run) => {
        const activation = activations.find(
          (candidate) => candidate.activationId === run.activation_id,
        )!;
        return {
          room: activation.roomId,
          from: String(activation.fromSeq),
          to: String(activation.toSeq),
        };
      }),
    );
    assert.ok(
      records
        .filter((record) => record.event === "worker")
        .every((record) => record.status === 0),
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
    // Review batch 1 #1: a never-rotated session only grows; full turn
    // hydration of a long thread exceeds the 16 MiB frame limit.
    assert.equal(
      (resume!.params as { excludeTurns?: unknown }).excludeTurns,
      true,
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
    assert.equal(
      (resume.params as { excludeTurns?: unknown }).excludeTurns,
      true,
      "the warm cold-start resume never hydrates the whole thread",
    );
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

// Final-reply turn end (warm). The FAKE app-server posts the reply from a tool
// item and then, like the real tool loop, would run one more full-context
// generation that only says "sent" unless the turn is interrupted first.
const followUps = (state: Harness) =>
  state.records().filter((record) => record.event === "follow-up-generation");
const interruptRequests = (state: Harness) =>
  state
    .records()
    .filter(
      (record) =>
        record.event === "request" && record.method === "turn/interrupt",
    );

function orderedRuns(state: Harness) {
  return state.kernel
    .listRunAttempts({ roomId: state.roomId })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function finalInterruptOf(state: Harness, runAttemptId: string) {
  const [row] = sql(
    state,
    "SELECT interrupt_sent, preempted_follow_up FROM run_attempt_final_replies WHERE run_attempt_id = ?",
    runAttemptId,
  );
  return row === undefined ? undefined : { ...row };
}

test("final reply (warm): the turn ends after the committed post, quiesces as success, and the next turn continues the thread", async () => {
  const state = await harness();
  try {
    for (let turn = 1; turn <= 2; turn += 1) {
      state.post(`[fake:final] question ${turn}`);
      const result = await state.current.agentHost.reconcileOnce();
      assert.equal(result.state, "completed", JSON.stringify(result));
    }
    assert.deepEqual(followUps(state), [], "no post-reply generation ran");
    const interrupts = interruptRequests(state);
    const turnIds = state
      .records()
      .filter((record) => record.event === "turn")
      .map((record) => record.turnId);
    assert.deepEqual(
      interrupts.map((record) => (record.params as { turnId: string }).turnId),
      turnIds,
      "each interrupt names its own native turn",
    );
    const runs = orderedRuns(state);
    assert.equal(runs.length, 2);
    for (const run of runs) {
      assert.equal(run.state, "exited");
      assert.deepEqual(finalInterruptOf(state, run.runAttemptId), {
        interrupt_sent: 1,
        preempted_follow_up: "true",
      });
    }
    for (const process of state.kernel.listRuntimeProcesses({
      roomId: state.roomId,
    })) {
      assert.equal(process.proofKind, "turn_quiesced");
      assert.equal(process.quiesceResult, "success");
    }
    assert.ok(
      state.kernel
        .listActivations({ roomId: state.roomId })
        .every((activation) => activation.state === "completed"),
    );
    const threads = new Set(
      state
        .records()
        .filter(
          (record) =>
            record.event === "request" && record.method === "turn/start",
        )
        .map((record) => (record.params as { threadId: string }).threadId),
    );
    assert.equal(threads.size, 1, "the session continues on the same thread");
    assert.equal(
      state.records().filter((record) => record.event === "start").length,
      1,
      "the warm process survives the interrupt",
    );
  } finally {
    await state.cleanup();
  }
});

test("final reply (warm): a post without --final is unchanged — the follow-up generation runs and nothing is interrupted", async () => {
  const state = await harness();
  try {
    state.post("[fake:post-nofinal] question");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    assert.equal(followUps(state).length, 1);
    assert.deepEqual(interruptRequests(state), []);
    const [run] = orderedRuns(state);
    assert.equal(finalInterruptOf(state, run!.runAttemptId), undefined);
  } finally {
    await state.cleanup();
  }
});

test("final reply (warm): a rejected interrupt falls back to the unchanged turn and the reply still completes", async () => {
  const state = await harness();
  try {
    state.post("[fake:final-reject] question");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    assert.equal(interruptRequests(state).length, 1);
    assert.equal(followUps(state).length, 1);
    const [run] = orderedRuns(state);
    assert.equal(run!.state, "exited");
    assert.deepEqual(finalInterruptOf(state, run!.runAttemptId), {
      interrupt_sent: 0,
      preempted_follow_up: "unknown",
    });
  } finally {
    await state.cleanup();
  }
});

test("final reply (warm): --final never acknowledges — without ACK the Activation does not complete", async () => {
  const state = await harness();
  try {
    state.post("[fake:final-noack] question");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(result.state, "failed", JSON.stringify(result));
    assert.match(
      result.state === "failed" ? result.error : "",
      /not acknowledged through sequence/u,
    );
    assert.deepEqual(followUps(state), []);
    const [process] = state.kernel.listRuntimeProcesses({
      roomId: state.roomId,
    });
    assert.equal(process?.quiesceResult, "success");
  } finally {
    await state.cleanup();
  }
});

test("final reply (warm): a signal that lands after the follow-up began still ends the turn and records it was not preempted", async () => {
  const state = await harness();
  try {
    state.post("[fake:final-late] question");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    assert.deepEqual(followUps(state), []);
    const [run] = orderedRuns(state);
    assert.deepEqual(finalInterruptOf(state, run!.runAttemptId), {
      interrupt_sent: 1,
      preempted_follow_up: "false",
    });
  } finally {
    await state.cleanup();
  }
});

test("final reply (warm): the driver ignores a final command naming another native turn or RunAttempt", async () => {
  const state = await harness();
  try {
    state.post("[fake:final-wait] question");
    const cycle = state.current.agentHost.reconcileOnce();
    await waitFor(
      () => state.records().some((record) => record.event === "final-window"),
      "the post-reply window",
    );
    const runtime = state.current.pool.runtimeFor(state.participantId)!;
    const [run] = orderedRuns(state);
    runtime.command({
      nativeTurnId: "turn-not-this-one",
      op: "turn.final",
      runAttemptId: run!.runAttemptId,
    });
    const turnId = state.records().find((record) => record.event === "turn")!
      .turnId as string;
    runtime.command({
      nativeTurnId: turnId,
      op: "turn.final",
      runAttemptId: "run-attempt-of-someone-else",
    });
    const result = await cycle;
    assert.equal(result.state, "completed", JSON.stringify(result));
    assert.deepEqual(interruptRequests(state), []);
    assert.equal(followUps(state).length, 1);
  } finally {
    await state.cleanup();
  }
});

/**
 * Advance the fake clock by one stall window at a time until the run
 * settles (a progress envelope racing a single advance would restart the
 * business clock at the advanced time).
 */
async function advanceUntilSettled<T>(
  state: Harness,
  running: Promise<T>,
): Promise<T> {
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
  return await result;
}

const STALL_POLICY: WarmRuntimePolicyOverrides = {
  stallMs: 15 * 60_000,
  supervisionIntervalMs: 20,
};

test("S2-b stall: no native progress interrupts the turn, fails it (stalled) with its process alive, and the retry completes on the same runtime", async () => {
  const state = await harness({ policy: STALL_POLICY });
  try {
    state.post("[fake:hang-once] [fake:ack] please answer");
    const running = state.current.agentHost.reconcileOnce();
    await waitFor(
      () => state.records().find((record) => record.event === "turn"),
      "the hanging turn",
    );
    const first = await advanceUntilSettled(state, running);
    assert.equal(first.state, "failed", JSON.stringify(first));
    assert.match(String(first.error), /RAH_RUNTIME_STALLED/u);
    const retried = await state.current.agentHost.reconcileOnce();
    assert.equal(retried.state, "completed", JSON.stringify(retried));
    const runs = sql(
      state,
      `SELECT run.state, run.error, run.instance_runtime_id, process.proof_kind
         FROM run_attempts AS run
         JOIN runtime_processes AS process USING (run_attempt_id)
        ORDER BY run.attempt_number`,
    );
    assert.equal(runs.length, 2);
    assert.equal(runs[0]!.state, "failed");
    assert.match(String(runs[0]!.error), /RAH_RUNTIME_STALLED/u);
    assert.equal(runs[0]!.proof_kind, "turn_quiesced", "closure proven first");
    assert.equal(runs[1]!.state, "exited");
    assert.equal(runs[0]!.instance_runtime_id, runs[1]!.instance_runtime_id);
  } finally {
    await state.cleanup();
  }
});

test("S2-b stall: past the retry budget the Activation is held for the Human instead of retried again", async () => {
  const state = await harness({ policy: STALL_POLICY });
  try {
    state.post("[fake:hang] please answer");
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const running = state.current.agentHost.reconcileOnce();
      await waitFor(
        () =>
          state.records().filter((record) => record.event === "turn").length ===
          attempt,
        `hanging turn ${String(attempt)}`,
      );
      assert.equal((await advanceUntilSettled(state, running)).state, "failed");
    }
    const [activation] = sql(
      state,
      "SELECT state, last_error FROM activations",
    );
    assert.equal(activation!.state, "quarantined");
    assert.match(String(activation!.last_error), /retry budget is exhausted/u);
  } finally {
    await state.cleanup();
  }
});

test("review batch 1 #2: a start that outlives the Host deadline during cold start leaves the lane usable; the retry runs warm", async () => {
  let slowLaunches = 1;
  const state = await harness({
    runtimeStartTimeoutMs: 300,
    perAdapter: () => ({
      runtimeEnvironment: async () => {
        if (slowLaunches > 0) {
          slowLaunches -= 1;
          await new Promise((resolve) => setTimeout(resolve, 900));
        }
        return { env: {} };
      },
    }),
  });
  try {
    state.post("[fake:ack] please answer");
    const first = await state.current.agentHost.reconcileOnce();
    assert.equal(first.state, "failed", JSON.stringify(first));
    assert.match(String(first.error), /timed out/u);
    // The abandoned cold start finishes in the background.
    await waitFor(
      () => state.records().some((record) => record.event === "start"),
      "the late cold start",
    );
    await new Promise((resolve) => setTimeout(resolve, 800));
    const retried = await state.current.agentHost.reconcileOnce();
    assert.equal(retried.state, "completed", JSON.stringify(retried));
    const records = state.records();
    assert.equal(
      records.filter((record) => record.event === "start").length,
      1,
      "the retry reused the process the abandoned start left idle",
    );
    assert.equal(
      records.filter(
        (record) =>
          record.event === "request" && record.method === "turn/start",
      ).length,
      1,
    );
  } finally {
    await state.cleanup();
  }
});

test("review batch 1 #2: a start abandoned by the Host after its turn was prepared never sends the turn input", async () => {
  let slowWakes = 1;
  const state = await harness({
    runtimeStartTimeoutMs: 1_500,
    perAdapter: () => ({
      renderWake: async (input) => {
        if (slowWakes > 0) {
          slowWakes -= 1;
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
        return await renderBodiedWake({
          env: input.env,
          participantId: input.participantId,
          turnHandle: input.turnHandle,
        });
      },
    }),
  });
  try {
    state.post("[fake:ack] please answer");
    const first = await state.current.agentHost.reconcileOnce();
    assert.notEqual(first.state, "completed", JSON.stringify(first));
    // The abandoned start resumes after its slow wake: it must not send.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    assert.equal(
      state
        .records()
        .filter(
          (record) =>
            record.event === "request" && record.method === "turn/start",
        ).length,
      0,
      "no native turn for an attempt the Host already ended",
    );
    const retried = await state.current.agentHost.reconcileOnce();
    assert.equal(retried.state, "completed", JSON.stringify(retried));
    assert.equal(
      state.records().filter((record) => record.event === "start").length,
      1,
    );
  } finally {
    await state.cleanup();
  }
});

test("review batch 1 #3: a runtime the Kernel turned suspect mid-turn is ended with proof; the next message cold starts and resumes the same thread", async () => {
  const state = await harness();
  try {
    state.post("[fake:steer-wait] please answer");
    const running = state.current.agentHost.reconcileOnce();
    const turn = await waitFor(
      () => state.records().find((record) => record.event === "turn"),
      "the running turn",
    );
    // Kernel: the turn's execution record is orphaned (lease expiry while
    // the Mac slept); its trigger turns the busy runtime row suspect.
    const database = new DatabaseSync(state.databasePath);
    try {
      database
        .prepare(
          "UPDATE runtime_processes SET state = 'orphaned', updated_at = ? WHERE state <> 'terminated'",
        )
        .run(new Date().toISOString());
    } finally {
      database.close();
    }
    assert.equal(
      sql(state, "SELECT state FROM instance_runtimes")[0]!.state,
      "suspect",
    );
    await running;
    const firstPid = turn.pid as number;
    await waitFor(() => !alive(firstPid), "the suspect runtime to be killed");
    const [ended] = sql(
      state,
      "SELECT state, terminated_reason FROM instance_runtimes ORDER BY started_at LIMIT 1",
    );
    assert.equal(ended!.state, "terminated");
    // The orphaned first attempt is resolved by the Kernel (its quarantine
    // may absorb this message); whichever Activation runs next must start a
    // new process that resumes the recorded thread.
    state.post("[fake:ack] next question");
    let next = await state.current.agentHost.reconcileOnce();
    for (let poll = 0; poll < 40 && next.state === "idle"; poll += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      next = await state.current.agentHost.reconcileOnce();
    }
    assert.equal(next.state, "completed", JSON.stringify(next));
    const records = state.records();
    const starts = records.filter((record) => record.event === "start");
    assert.equal(starts.length, 2, "a new process after the proven exit");
    const threadStart = records.find(
      (record) =>
        record.event === "request" && record.method === "thread/start",
    );
    const resume = records.find(
      (record) =>
        record.event === "request" && record.method === "thread/resume",
    );
    assert.ok(resume, "the cold start resumed the recorded thread");
    const turnStarts = records.filter(
      (record) => record.event === "request" && record.method === "turn/start",
    );
    assert.equal(
      (turnStarts.at(-1)!.params as { threadId: string }).threadId,
      (turnStarts[0]!.params as { threadId: string }).threadId,
      "never a replacement session",
    );
    assert.ok(threadStart);
  } finally {
    await state.cleanup();
  }
});

test("review batch 1 #7: with warm runtimes switched off, a per-turn start is refused while an older runtime row cannot be proven gone", async () => {
  let coldOnly = false;
  const state = await harness({ coldOnly: () => coldOnly, hostPool: true });
  try {
    state.post("[fake:ack] warm up");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    await state.current.pool.shutdown();
    // A crashed Host's live runtime row whose process cannot be told apart
    // from a reused pid (a live pid, no recorded birth time); the owner then
    // switched warm runtimes off.
    const database = new DatabaseSync(state.databasePath);
    try {
      database
        .prepare(
          `UPDATE instance_runtimes SET state = 'idle', pid = ?, pgid = ?,
             process_started_at = NULL, terminated_reason = NULL,
             terminated_at = NULL, exit_code = NULL, exit_signal = NULL`,
        )
        .run(process.pid, process.pid);
    } finally {
      database.close();
    }
    coldOnly = true;
    state.restartHost();
    state.post("[fake:ack] cold question");
    const refused = await state.current.agentHost.reconcileOnce();
    assert.equal(refused.state, "failed", JSON.stringify(refused));
    assert.match(String(refused.error), /not proven terminated/u);
    assert.doesNotMatch(
      String(refused.error),
      /per-turn path/u,
      "the per-turn runtime never started beside the unproven one",
    );
    assert.equal(
      sql(state, "SELECT state FROM instance_runtimes")[0]!.state,
      "idle",
      "an unproven row is never recorded ended",
    );
  } finally {
    await state.cleanup();
  }
});

test("review batch 1 #6: with a new adapter per claim (production resolver) the stall retry budget still holds across attempts", async () => {
  const state = await harness({ adapterPerClaim: true, policy: STALL_POLICY });
  try {
    state.post("[fake:hang] please answer");
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const running = state.current.agentHost.reconcileOnce();
      await waitFor(
        () =>
          state.records().filter((record) => record.event === "turn").length ===
          attempt,
        `hanging turn ${String(attempt)}`,
      );
      assert.equal((await advanceUntilSettled(state, running)).state, "failed");
    }
    const [activation] = sql(
      state,
      "SELECT state, last_error FROM activations",
    );
    assert.equal(activation!.state, "quarantined");
    assert.match(String(activation!.last_error), /retry budget is exhausted/u);
    assert.equal(
      state.records().filter((record) => record.event === "start").length,
      1,
      "both attempts ran on the one pooled process",
    );
  } finally {
    await state.cleanup();
  }
});

test("review batch 1 #6: with a new adapter per claim the pending protocol line is carried by the warm retry and accepted by it", async () => {
  const storeDirectory = mkdtempSync(join(tmpdir(), "rah-warm-protocol-"));
  chmodSync(storeDirectory, 0o700);
  const store = new ProviderSessionStore({ rootDirectory: storeDirectory });
  const key = {
    participantId: "instance-protocol",
    provider: "codex-app-server/v1",
    runtimeProfileRevisionId: "runtime-profile-revision",
    workspaceMountRevisionId: "workspace-mount-revision",
  };
  const binding = { instance: true, instanceGeneration: 0 };
  await store.record(key, "session-protocol", {
    ...binding,
    standingProtocolVersion: "p1",
  });
  // The registry's composition: one SessionProtocolUpgrade per adapter over
  // the state the pool shares.
  const asInstance = (input: ActivationEnvelope) =>
    ({
      ...input,
      agent: {
        ...input.agent,
        instanceChannelId: "channel-protocol",
        instanceSessionGeneration: 0,
      },
    }) as ActivationEnvelope;
  const state = await harness({
    adapterPerClaim: true,
    policy: STALL_POLICY,
    perAdapter: (pool) => {
      const upgrade = new SessionProtocolUpgrade(
        store,
        pool.shared("session-protocol:test", createSessionProtocolState),
      );
      return {
        acceptSessionProtocol: async (input) => await upgrade.accept(input),
        protocolNotice: (input) => upgrade.noticeFor(input),
        runtimeEnvironment: async (input) => {
          const lease = { env: {}, standingProtocolVersion: "p2" };
          upgrade.prepare(
            asInstance(input),
            lease,
            key,
            await store.load(key, binding),
          );
          return lease;
        },
      };
    },
  });
  try {
    state.post("[fake:hang-once] [fake:ack] please answer");
    const running = state.current.agentHost.reconcileOnce();
    await waitFor(
      () => state.records().find((record) => record.event === "turn"),
      "the hanging turn",
    );
    assert.equal((await advanceUntilSettled(state, running)).state, "failed");
    const retried = await state.current.agentHost.reconcileOnce();
    assert.equal(retried.state, "completed", JSON.stringify(retried));
    const texts = state
      .records()
      .filter(
        (record) =>
          record.event === "request" && record.method === "turn/start",
      )
      .map((record) => JSON.stringify(record.params));
    assert.equal(texts.length, 2);
    const line = JSON.stringify(protocolUpdateNotice("p2")).slice(1, -1);
    assert.ok(texts[0]!.includes(line), "the first attempt carried the line");
    assert.ok(texts[1]!.includes(line), "the warm retry still carries it");
    assert.equal(
      (await store.load(key, binding))?.standingProtocolVersion,
      "p2",
      "the completed retry accepted the update",
    );
  } finally {
    await state.cleanup();
    rmSync(storeDirectory, { force: true, recursive: true });
  }
});

test("S2-b stall after the final reply committed: the wedged runtime is killed with proof and the turn is not re-executed", async () => {
  const state = await harness({
    interruptQuiesceTimeoutMs: 300,
    policy: STALL_POLICY,
  });
  try {
    state.post("[fake:final-hang] please answer");
    const running = state.current.agentHost.reconcileOnce();
    await waitFor(
      () =>
        state
          .records()
          .find(
            (record) =>
              record.event === "request" && record.method === "turn/interrupt",
          ),
      "the final-reply interrupt the wedged CLI ignores",
    );
    const result = await advanceUntilSettled(state, running);
    assert.equal(result.state, "completed", JSON.stringify(result));
    const runs = sql(
      state,
      `SELECT run.run_attempt_id, process.proof_kind, process.exit_signal
         FROM run_attempts AS run
         JOIN runtime_processes AS process USING (run_attempt_id)`,
    );
    assert.equal(runs.length, 1, "no second RunAttempt");
    assert.equal(runs[0]!.proof_kind, "process_exit");
    assert.equal(
      state.records().filter((record) => record.event === "turn").length,
      1,
      "the obligation is never executed again",
    );
    const [runtime] = sql(
      state,
      "SELECT state, terminated_reason FROM instance_runtimes",
    );
    assert.deepEqual(
      { ...runtime },
      {
        state: "terminated",
        terminated_reason: "stall",
      },
    );
  } finally {
    await state.cleanup();
  }
});

test("S2-b boundary recycling: an aged idle runtime is stopped with proof before the next turn, which cold-starts and resumes the same thread", async () => {
  const state = await harness({ policy: { maxAgeMs: 60 * 60_000 } });
  try {
    state.post("[fake:ack] first");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    state.advance(30 * 60_000);
    state.post("[fake:ack] second");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    state.advance(30 * 60_000);
    state.post("[fake:ack] third");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    const runtimes = sql(
      state,
      "SELECT state, terminated_reason FROM instance_runtimes ORDER BY started_at",
    );
    assert.equal(runtimes.length, 2);
    assert.deepEqual(
      { ...runtimes[0] },
      { state: "terminated", terminated_reason: "recycle_age" },
    );
    assert.equal(runtimes[1]!.terminated_reason, null);
    const modes = sql(
      state,
      "SELECT execution_mode FROM run_attempts ORDER BY started_at",
    ).map((row) => row.execution_mode);
    assert.deepEqual(modes, ["cold", "warm", "cold"]);
    const records = state.records();
    const turns = records.filter(
      (record) => record.event === "request" && record.method === "turn/start",
    );
    const threads = new Set(
      turns.map((turn) => (turn.params as { threadId: string }).threadId),
    );
    assert.equal(threads.size, 1, "the binding is preserved across recycling");
    assert.ok(
      records.some(
        (record) =>
          record.event === "request" && record.method === "thread/resume",
      ),
    );
  } finally {
    await state.cleanup();
  }
});
