import assert from "node:assert/strict";
import {
  chmodSync,
  realpathSync,
  existsSync,
  mkdirSync,
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
  RUN_WATCHDOG_MAX_DURATION,
  RUN_WATCHDOG_QUEUED_STALL,
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
    explicitFinalOutput?: boolean;
    nativeFinalText?: boolean;
    skipDeliveryRegistration?: boolean;
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
    /** Appended to the warm driver arguments (e.g. attached directories). */
    extraDriverArgs?: string[];
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
        ...(options.explicitFinalOutput ? { explicitFinalOutput: true } : {}),
        ...(options.nativeFinalText ? { nativeFinalText: true } : {}),
        recordDeliveryAcceptance: (input) => {
          if (options.nativeFinalText && options.skipDeliveryRegistration)
            throw new Error("FAKE delivery registration failed");
          if (
            (options.explicitFinalOutput || options.nativeFinalText) &&
            !options.skipDeliveryRegistration
          )
            kernel.markPresentedDeliverySent(host, {
              activationId: input.activationId,
              consumerId: input.consumerId,
              runAttemptId: input.runAttemptId,
            });
        },
        driverArgs: [
          "--executable",
          executable,
          "--tool-access-mode",
          "full_access",
          "--prompt",
          "FAKE standing prompt for the warm runtime test",
          ...(options.extraDriverArgs ?? []),
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
            ...(input.onPresented ? { onPresented: input.onPresented } : {}),
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
    now: () => nowMs,
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

test("channel workspace: the warm thread/start carries runtimeWorkspaceRoots = [cwd, ...attached directories]", async () => {
  const state = await harness({
    extraDriverArgs: [
      "--additional-dir",
      "/work/app",
      "--additional-dir",
      "/work/lib",
    ],
  });
  try {
    state.post("[fake:ack] attached");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    const start = state
      .records()
      .find(
        (record) =>
          record.event === "request" && record.method === "thread/start",
      );
    assert.deepEqual(
      (start?.params as { runtimeWorkspaceRoots?: string[] })
        .runtimeWorkspaceRoots,
      [realpathSync(state.directory), "/work/app", "/work/lib"],
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

/**
 * Full review 2 batch 1 #7 (drivers P2-2): the warm driver's isolation
 * preflight (the user's MCP servers, resolved by `codex mcp list`) refusing
 * a launch reports its reason through the fd3 `fatal` envelope, so the pool
 * and the run carry it instead of only "exited before ready".
 */
test("a refused user MCP preflight reaches the pool as a fatal with its reason", async () => {
  const state = await harness();
  try {
    mkdirSync(state.stateDirectory, { recursive: true });
    writeFileSync(join(state.stateDirectory, "mcp-fail"), "");
    state.post("[fake:ack] first");
    const result = await state.current.agentHost.reconcileOnce();
    assert.notEqual(result.state, "completed");
    assert.ok(
      state.diagnostics.some((line) =>
        /\] fatal: Codex user MCP servers could not be resolved/u.test(line),
      ),
      state.diagnostics.join("\n"),
    );
    assert.equal(
      state.records().filter((record) => record.event === "start").length,
      0,
      "no app-server is started",
    );
  } finally {
    await state.cleanup();
  }
});

/**
 * Full review 2 batch 1 #7 (drivers P2-3): Codex reloads config.toml when a
 * thread is (re)loaded, so before resuming an unloaded thread the driver
 * lists the user's MCP servers again; a server added while it ran restarts
 * the runtime (the turn is refused, nothing started) and the next cold start
 * disables it by name and resumes the same thread.
 */
test("a user MCP server added while the runtime ran restarts it before the thread is reloaded", async () => {
  const state = await harness();
  try {
    state.post("[fake:ack] [fake:unload-after] first");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    writeFileSync(join(state.stateDirectory, "mcp.json"), '["added"]');
    state.post("[fake:ack] second");
    const refused = await state.current.agentHost.reconcileOnce();
    assert.notEqual(refused.state, "completed");
    // The refused turn closes before config_restart's process exit is reaped.
    // Retry only after the original runtime's durable termination; an immediate
    // poll may still see its idle row and race that asynchronous teardown.
    await waitFor(
      () =>
        sql(state, "SELECT state FROM instance_runtimes")[0]?.state ===
          "terminated" &&
        state.current.pool.runtimeFor(state.participantId) === undefined,
      "the config-restart runtime's proven termination",
    );
    const retried = await state.current.agentHost.reconcileOnce();
    assert.equal(
      retried.state,
      "completed",
      JSON.stringify(retried) + state.diagnostics.join("\n"),
    );
    const records = state.records();
    const starts = records.filter((record) => record.event === "start");
    assert.equal(starts.length, 2, "the runtime restarted once");
    assert.equal(
      (starts[0]!.argv as string[]).includes("mcp_servers.added.enabled=false"),
      false,
    );
    assert.equal(
      (starts[1]!.argv as string[]).includes("mcp_servers.added.enabled=false"),
      true,
      "the new process disables the added server by name",
    );
    const firstPid = starts[0]!.pid;
    const ofFirst = records.filter((record) => record.pid === firstPid);
    assert.equal(
      ofFirst.filter(
        (record) =>
          record.event === "request" && record.method === "thread/resume",
      ).length,
      0,
      "the old process never reloads the thread with the added server",
    );
    assert.equal(
      ofFirst.filter((record) => record.event === "turn").length,
      1,
      "the old process never runs the second turn",
    );
    assert.equal(
      records.filter(
        (record) =>
          record.event === "request" && record.method === "thread/start",
      ).length,
      1,
      "the same thread is resumed, never replaced",
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

test("final reply (warm): explicit progress keeps the follow-up generation and is not interrupted", async () => {
  const state = await harness();
  try {
    state.post("[fake:post-progress] question");
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

test("final reply (warm): omitting --final publishes without interrupting remaining work", async () => {
  const state = await harness();
  try {
    state.post("[fake:post-nofinal] question");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    assert.equal(followUps(state).length, 1);
    assert.equal(interruptRequests(state).length, 0);
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

test("final reply (warm): unconfirmed --final publishes nothing, does not interrupt, and cannot complete", async () => {
  const state = await harness();
  try {
    state.post("[fake:final-noack] question");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(result.state, "failed", JSON.stringify(result));
    assert.match(
      result.state === "failed" ? result.error : "",
      /not acknowledged through sequence/u,
    );
    assert.equal(
      followUps(state).length,
      1,
      "a rejected final cannot preempt remaining work",
    );
    assert.deepEqual(interruptRequests(state), []);
    const posts = state
      .records()
      .filter(
        (record) =>
          record.event === "worker" &&
          (record.command as string[] | undefined)?.includes("message-post"),
      );
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.status, 1);
    assert.match(String(posts[0]!.stderr), /final_delivery_unconfirmed/u);
    assert.equal(
      sql(state, "SELECT * FROM messages WHERE actor_id=?", state.participantId)
        .length,
      0,
    );
    assert.equal(
      sql(state, "SELECT * FROM run_attempt_final_replies").length,
      0,
    );
    assert.equal(
      sql(
        state,
        "SELECT * FROM subscription_cursors WHERE participant_id=? AND last_seq>0",
        state.participantId,
      ).length,
      0,
    );
    assert.equal(orderedRuns(state).length, 1);
    assert.equal(
      sql(state, "SELECT * FROM activations WHERE state='completed'").length,
      0,
    );
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
 * Advance the fake clock by 15 minutes at a time (up to 5 h) until the run
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

/** Watchdog ticks every 20 ms of real time; thresholds are the defaults. */
const STALL_POLICY: WarmRuntimePolicyOverrides = {
  supervisionIntervalMs: 20,
};

test("evo §37 B warm stall: with work queued for the instance, no native progress interrupts the turn with its process alive, and the retry completes on the same runtime", async () => {
  const state = await harness({ policy: STALL_POLICY });
  try {
    state.post("[fake:hang-once] [fake:ack] please answer");
    const running = state.current.agentHost.reconcileOnce();
    await waitFor(
      () => state.records().find((record) => record.event === "turn"),
      "the hanging turn",
    );
    state.post("[fake:ack] a queued follow-up");
    const first = await advanceUntilSettled(state, running);
    assert.equal(first.state, "failed", JSON.stringify(first));
    assert.equal(String(first.error), RUN_WATCHDOG_QUEUED_STALL);
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
    assert.equal(String(runs[0]!.error), RUN_WATCHDOG_QUEUED_STALL);
    assert.equal(runs[0]!.proof_kind, "turn_quiesced", "closure proven first");
    assert.equal(runs[1]!.state, "exited");
    assert.equal(runs[0]!.instance_runtime_id, runs[1]!.instance_runtime_id);
  } finally {
    await state.cleanup();
  }
});

test("evo §37 B warm stall alone never ends a turn; the duration cap does, and three identical watchdog failures stop the instance through the retry fence", async () => {
  const state = await harness({ policy: STALL_POLICY });
  try {
    state.post("[fake:hang] please answer");
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const running = state.current.agentHost.reconcileOnce();
      await waitFor(
        () =>
          state.records().filter((record) => record.event === "turn").length ===
          attempt,
        `hanging turn ${String(attempt)}`,
      );
      const started = state.now();
      assert.equal((await advanceUntilSettled(state, running)).state, "failed");
      assert.ok(
        state.now() - started >= 4 * 60 * 60_000,
        "no stall kill before the 4 h cap while nothing is queued",
      );
    }
    const [activation] = sql(
      state,
      "SELECT state, last_error FROM activations",
    );
    assert.equal(activation!.state, "quarantined");
    assert.equal(String(activation!.last_error), RUN_WATCHDOG_MAX_DURATION);
    assert.ok(
      sql(
        state,
        "SELECT type FROM room_events WHERE type = 'run.watchdog_warning'",
      ).length >= 1,
      "the stall was reported",
    );
  } finally {
    await state.cleanup();
  }
});

test("evo §37 B warm duration cap: a turn that ignores the native interrupt is killed with process-exit proof, and the retry cold-starts on the same thread", async () => {
  const state = await harness({
    interruptQuiesceTimeoutMs: 300,
    policy: STALL_POLICY,
  });
  try {
    state.post("[fake:hang-ignore-interrupt] stuck");
    const running = state.current.agentHost.reconcileOnce();
    await waitFor(
      () => state.records().find((record) => record.event === "turn"),
      "the stuck turn",
    );
    const first = await advanceUntilSettled(state, running);
    assert.equal(first.state, "failed", JSON.stringify(first));
    assert.equal(String(first.error), RUN_WATCHDOG_MAX_DURATION);
    const [process] = state.kernel.listRuntimeProcesses({
      roomId: state.roomId,
    });
    assert.equal(process?.proofKind, "process_exit", "termination proven");
    const retry = state.current.agentHost.reconcileOnce();
    await waitFor(
      () =>
        state
          .records()
          .filter(
            (record) =>
              record.event === "request" && record.method === "turn/start",
          ).length === 2,
      "the retried turn",
    );
    const records = state.records();
    const threads = new Set(
      records
        .filter(
          (record) =>
            record.event === "request" && record.method === "turn/start",
        )
        .map((turn) => (turn.params as { threadId: string }).threadId),
    );
    assert.equal(threads.size, 1, "the same native session continues");
    assert.ok(
      records.some(
        (record) =>
          record.event === "request" && record.method === "thread/resume",
      ),
      "the new process resumed the thread instead of starting a new one",
    );
    await advanceUntilSettled(state, retry);
  } finally {
    await state.cleanup();
  }
});

test("review batch 1 #2: a start that outlives the Host deadline during cold start leaves the lane usable; the retry runs warm", async () => {
  let slowLaunches = 1;
  const lateEnvironment = Promise.withResolvers<void>();
  const state = await harness({
    runtimeStartTimeoutMs: 300,
    perAdapter: () => ({
      runtimeEnvironment: async () => {
        if (slowLaunches > 0) {
          slowLaunches -= 1;
          await lateEnvironment.promise;
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
    assert.equal(
      state.records().filter((record) => record.event === "start").length,
      0,
    );
    // Release only after timeout, then wait for actual readiness, not a sleep.
    lateEnvironment.resolve();
    // The abandoned cold start finishes in the background.
    await waitFor(
      () => state.records().some((record) => record.event === "start"),
      "the late cold start",
    );
    await waitFor(
      () =>
        sql(state, "SELECT state FROM instance_runtimes")[0]?.state === "idle",
      "the abandoned runtime becoming reusable",
    );
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
    lateEnvironment.resolve();
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

test("review batch 1 #6: with a new adapter per claim (production resolver) the watchdog failure count still holds across attempts", async () => {
  const state = await harness({ adapterPerClaim: true, policy: STALL_POLICY });
  try {
    state.post("[fake:hang] please answer");
    for (let attempt = 1; attempt <= 3; attempt += 1) {
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
    assert.equal(String(activation!.last_error), RUN_WATCHDOG_MAX_DURATION);
    assert.equal(
      state.records().filter((record) => record.event === "start").length,
      1,
      "every attempt ran on the one pooled process (same session)",
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

test("automatic internal MCP wiring keeps two warm turns bound to original credentials through stdio", async () => {
  const { spawn } = await import("node:child_process");
  const { createInterface } = await import("node:readline");
  const state = await harness();
  let child: ReturnType<typeof spawn> | undefined;
  let lines: ReturnType<typeof createInterface> | undefined;
  try {
    let oldTurn: string | undefined;
    let runtimeId: string | undefined;
    let requestId = 0;
    let responses: AsyncIterableIterator<string> | undefined;
    const rpc = async (method: string, params: unknown) => {
      const id = ++requestId;
      child!.stdin!.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const line = await Promise.race([
        responses!.next(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("MCP fixture response timeout")),
            5_000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      assert.equal(line.done, false, "MCP stdio remains open");
      const value = JSON.parse(line.value!);
      assert.equal(value.id, id);
      assert.equal(value.error, undefined);
      return value.result;
    };
    for (let round = 1; round <= 2; round++) {
      state.post(`[fake:steer-wait] FAKE MCP warm wiring question ${round}`);
      const running = state.current.agentHost.reconcileOnce();
      const runtime = await waitFor(() => {
        const candidate = state.current.pool.runtimeFor(state.participantId);
        return candidate?.current?.nativeTurnId ? candidate : undefined;
      }, `MCP native admission ${round}`);
      assert.ok(
        runtime.workerMcp,
        "adapter automatically provisions an internal MCP bridge",
      );
      assert.ok(runtime.nativeSessionId);
      const nativeTurn = runtime.current!.nativeTurnId!;
      if (round === 1) {
        runtimeId = runtime.instanceRuntimeId;
        child = spawn(
          process.execPath,
          [
            fileURLToPath(
              new URL("../src/worker-mcp-entry.ts", import.meta.url),
            ),
          ],
          {
            env: { ...process.env, ...runtime.workerMcp.env },
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        lines = createInterface({ input: child.stdout! });
        responses = lines[Symbol.asyncIterator]();
        const initialized = await rpc("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "FAKE warm integration", version: "1" },
        });
        assert.equal(initialized.serverInfo.name, "loom-worker");
        assert.equal((await rpc("tools/list", {})).tools[0].name, "loom_reply");
      } else
        assert.equal(
          runtime.instanceRuntimeId,
          runtimeId,
          "second turn reuses the warm process and bridge",
        );
      const reply = (turn: string, suffix: string) =>
        rpc("tools/call", {
          name: "loom_reply",
          arguments: { body: `FAKE MCP warm ${suffix}`, final: false },
          _meta: {
            "x-codex-turn-metadata": {
              turn_id: turn,
              thread_id: runtime.nativeSessionId,
              session_id: runtime.nativeSessionId,
            },
            threadId: runtime.nativeSessionId,
            sessionId: runtime.nativeSessionId,
            callId: `call-${suffix}`,
          },
        });
      if (oldTurn) {
        const stale = await reply(oldTurn, "revoked");
        assert.equal(
          stale.isError,
          true,
          "old native turn cannot select the new Worker credential",
        );
      }
      const result = await reply(nativeTurn, String(round));
      assert.equal(result.isError, false, JSON.stringify(result));
      const receipt = JSON.parse(result.content[0].text);
      const published = sql(
        state,
        "SELECT m.actor_id, m.room_id, e.room_seq FROM messages m JOIN room_events e ON e.aggregate_id=m.message_id AND e.type='message.posted' WHERE m.message_id=?",
        receipt.messageId,
      );
      assert.deepEqual(
        published.map((row) => ({ ...row })),
        [
          {
            actor_id: state.participantId,
            room_id: state.roomId,
            room_seq: receipt.roomSeq,
          },
        ],
      );
      assert.equal((await running).state, "completed");
      oldTurn = nativeTurn;
    }
    assert.equal(
      sql(
        state,
        "SELECT message_id FROM messages WHERE body LIKE 'FAKE MCP warm %'",
      ).length,
      2,
    );
    assert.equal(
      state.records().filter((record) => record.event === "start").length,
      1,
    );
  } finally {
    lines?.close();
    child?.kill();
    await state.cleanup();
  }
});

test("warm Codex explicit final output: opt-in two turns publish once each in one native session", async () => {
  const state = await harness({ explicitFinalOutput: true });
  try {
    for (let turn = 1; turn <= 2; turn++) {
      state.post(`[fake:envelope] question ${turn}`);
      const result = await state.current.agentHost.reconcileOnce();
      assert.equal(result.state, "completed", JSON.stringify(result));
      const replies = sql(
        state,
        "SELECT actor_id, body FROM messages WHERE actor_id=? ORDER BY rowid",
        state.participantId,
      );
      assert.equal(replies.length, turn);
      assert.deepEqual(
        { ...replies.at(-1) },
        { actor_id: state.participantId, body: `FAKE CODEX FINAL ${turn}` },
      );
    }
    const turns = state.records().filter((r) => r.event === "turn");
    assert.equal(turns.length, 2);
    for (const turn of turns) {
      assert.match(
        String(turn.text),
        /Reply transport: explicit final-output/u,
      );
      assert.doesNotMatch(String(turn.text), /Use loom_reply for replies/u);
    }
    assert.equal(
      state
        .records()
        .filter((r) => r.event === "request" && r.method === "thread/start")
        .length,
      1,
    );
    assert.equal(state.records().filter((r) => r.event === "worker").length, 0);
    const runs = state.kernel.listRunAttempts({ roomId: state.roomId });
    assert.equal(new Set(runs.map((r) => r.nativeTurnId)).size, 2);
    assert.equal(new Set(runs.map((r) => r.instanceRuntimeId)).size, 1);
  } finally {
    await state.cleanup();
  }
});

for (const [label, options, token] of [
  ["default off", {}, ""],
  [
    "commentary is diagnostic",
    { explicitFinalOutput: true },
    "[fake:commentary-envelope]",
  ],
  [
    "native interrupted rejects complete text",
    { explicitFinalOutput: true },
    "[fake:envelope-interrupted]",
  ],
  [
    "unregistered delivery cannot complete",
    { explicitFinalOutput: true, skipDeliveryRegistration: true },
    "",
  ],
] as const)
  test(`warm Codex explicit final output: ${label}`, async () => {
    const state = await harness(options);
    try {
      state.post(`[fake:envelope] ${token} question`);
      const result = await state.current.agentHost.reconcileOnce();
      assert.notEqual(result.state, "completed", JSON.stringify(result));
      if (label === "default off") {
        const request = state
          .records()
          .find((r) => r.event === "request" && r.method === "turn/start");
        assert.equal(
          (request?.params as Record<string, unknown>)?.outputSchema,
          undefined,
        );
      }
      assert.equal(
        sql(state, "SELECT * FROM activations WHERE state='completed'").length,
        0,
      );
      if (label !== "unregistered delivery cannot complete")
        assert.equal(
          sql(
            state,
            "SELECT * FROM messages WHERE actor_id=?",
            state.participantId,
          ).length,
          0,
        );
      assert.equal(state.records().filter((r) => r.event === "turn").length, 1);
      assert.equal(
        state.records().filter((r) => r.event === "worker").length,
        0,
      );
    } finally {
      await state.cleanup();
    }
  });

test("warm Codex explicit final output: cancellation after final item but before terminal success never publishes", async () => {
  const state = await harness({ explicitFinalOutput: true });
  const controller = new AbortController();
  let running: Promise<void> | undefined;
  try {
    state.post("[fake:envelope] [fake:envelope-cancel] cancel this turn");
    running = state.current.agentHost.run({ signal: controller.signal });
    await waitFor(
      () => state.records().some((r) => r.event === "envelope-emitted"),
      "final item emitted",
    );
    controller.abort();
    await running;
    assert.equal(
      sql(state, "SELECT * FROM messages WHERE actor_id=?", state.participantId)
        .length,
      0,
    );
    assert.equal(state.records().filter((r) => r.event === "turn").length, 1);
  } finally {
    controller.abort();
    await running;
    await state.cleanup();
  }
});

test("warm Codex explicit final output: ambiguous HTTP result blocks automatic retry", async () => {
  const state = await harness({ explicitFinalOutput: true });
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/v1/worker/messages/final-output")) {
      attempts++;
      throw Error("FAKE unknown write result");
    }
    return originalFetch(input, init);
  };
  try {
    state.post("[fake:envelope] unknown submission");
    const result = await state.current.agentHost.reconcileOnce();
    assert.equal(attempts, 1);
    assert.equal(result.state, "failed");
    assert.equal(
      sql(state, "SELECT retry_disposition FROM activation_retry_fences")[0]
        ?.retry_disposition,
      "action_required",
    );
    assert.equal((await state.current.agentHost.reconcileOnce()).state, "idle");
    assert.equal(state.records().filter((r) => r.event === "turn").length, 1);
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await state.cleanup();
  }
});

for (const serviceTier of ["default", "fast"] as const) {
  test(`Codex warm requests keep ${serviceTier} across consecutive turns`, async () => {
    const state = await harness({
      perAdapter: () => ({
        resolvedModel: {
          source: "explicit_binding",
          modelBindingId: "fixture",
          modelId: "fixture",
          provider: "openai",
          serviceTier,
        },
      }),
    });
    try {
      for (let n = 0; n < 2; n++) {
        state.post("[fake:ack] tier test");
        const result = await state.current.agentHost.reconcileOnce();
        assert.equal(result.state, "completed", JSON.stringify(result));
      }
      const requests = state
        .records()
        .filter(
          (r) =>
            r.event === "request" &&
            ["thread/start", "turn/start"].includes(String(r.method)),
        );
      assert.equal(requests.length, 3);
      for (const request of requests)
        assert.equal(
          (request.params as { serviceTier: string }).serviceTier,
          serviceTier,
        );
    } finally {
      await state.cleanup();
    }
  });
}

test("warm Codex native text: one continuous session publishes plain final without reply tools or output schema", async () => {
  const state = await harness({ nativeFinalText: true });
  try {
    for (let turn = 1; turn <= 2; turn++) {
      state.post(`[fake:envelope] [fake:plain-final] question ${turn}`);
      const result = await state.current.agentHost.reconcileOnce();
      assert.equal(result.state, "completed", JSON.stringify(result));
      const replies = sql(
        state,
        "SELECT body FROM messages WHERE actor_id=? ORDER BY rowid",
        state.participantId,
      );
      assert.equal(replies.length, turn);
      assert.equal(replies.at(-1)!.body, `FAKE CODEX FINAL ${turn}`);
    }
    const requests = state
      .records()
      .filter((r) => r.event === "request" && r.method === "turn/start");
    assert.equal(requests.length, 2);
    for (const r of requests)
      assert.equal(
        (r.params as Record<string, unknown>).outputSchema,
        undefined,
      );
    for (const r of state.records().filter((r) => r.event === "turn")) {
      assert.match(String(r.text), /Reply transport: native-final-text/);
      assert.doesNotMatch(String(r.text), /Use loom_reply for replies/);
    }
    assert.equal(state.records().filter((r) => r.event === "worker").length, 0);
    for (const start of state.records().filter((r) => r.event === "start"))
      assert.doesNotMatch(
        JSON.stringify(start.argv),
        /mcp_servers\.loom_worker/,
        "native final must not also advertise a competing reply MCP tool",
      );
    assert.equal(
      new Set(orderedRuns(state).map((r) => r.instanceRuntimeId)).size,
      1,
    );
  } finally {
    await state.cleanup();
  }
});
for (const [label, options, token] of [
  ["commentary", { nativeFinalText: true }, "[fake:commentary-envelope]"],
  ["interrupted", { nativeFinalText: true }, "[fake:envelope-interrupted]"],
  [
    "registration failure",
    { nativeFinalText: true, skipDeliveryRegistration: true },
    "",
  ],
] as const)
  test(`warm Codex native text rejects ${label}`, async () => {
    const s = await harness(options);
    try {
      s.post(`[fake:envelope] [fake:plain-final] ${token}`);
      const r = await s.current.agentHost.reconcileOnce();
      assert.notEqual(r.state, "completed");
      assert.equal(
        sql(s, "SELECT * FROM messages WHERE actor_id=?", s.participantId)
          .length,
        0,
      );
    } finally {
      await s.cleanup();
    }
  });

test("warm Codex switches reply transport without replacing the native session", async () => {
  const options = { nativeFinalText: false, adapterPerClaim: true };
  const s = await harness(options);
  try {
    s.post("[fake:final] old reply path");
    assert.equal(
      (await s.current.agentHost.reconcileOnce()).state,
      "completed",
    );
    const original = s.sessions.get(s.participantId);
    assert.ok(original);
    options.nativeFinalText = true;
    s.post("[fake:envelope] [fake:plain-final] new reply path");
    const result = await s.current.agentHost.reconcileOnce();
    assert.equal(result.state, "completed", JSON.stringify(result));
    assert.equal(s.sessions.get(s.participantId), original);
    const resumes = s
      .records()
      .filter((r) => r.event === "request" && r.method === "thread/resume");
    assert.equal(resumes.length, 1);
    assert.equal(
      (resumes[0]!.params as Record<string, unknown>).threadId,
      original,
    );
  } finally {
    await s.cleanup();
  }
});
