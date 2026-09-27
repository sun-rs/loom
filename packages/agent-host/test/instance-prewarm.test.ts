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
import { RoomKernel } from "@rah-os/kernel";
import type { RuntimeProfileManifestV3 } from "@rah-os/protocol";

import {
  AgentHost,
  AgentStartGate,
  createKernelAgentHostControlPort,
  InstancePrewarmer,
  InstanceRuntimePool,
  ProviderSessionStore,
  RuntimeImplementationRegistry,
  RuntimeProcessHygiene,
  RuntimeProfileRegistry,
  type LeftoverSweepResult,
  type RuntimeAdapter,
} from "../src/index.ts";

/**
 * Owner 2026-09-27: a Role instance's warm runtime is started when the
 * instance is created (and, after a daemon start, for recently active
 * instances), not at its first message. A FAKE Codex app-server (no model, no
 * paid CLI) behind the production warm adapter; a real Role instance; the
 * Kernel's read-only prewarm plan. Prewarming starts the process and its
 * readiness handshake only: no turn reaches the CLI until a Room message
 * does, and the first turn then reuses the prewarmed process (`warm`).
 */
const fakeServerPath = fileURLToPath(
  new URL("./fixtures/fake-codex-warm-app-server.mjs", import.meta.url),
);

type HarnessOptions = {
  /** Start admission the prewarmer shares with real execution. */
  admit?: (
    participantId: string,
  ) => Promise<{ blocked: false } | { blocked: true; reason: string }>;
  hostCap?: number;
  profileCap?: number;
  maxWarm?: number;
  perTurn?: boolean;
};

async function prewarmHarness(options: HarnessOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), "rah-prewarm-"));
  chmodSync(directory, 0o700);
  const socketRoot = mkdtempSync("/tmp/lp-");
  chmodSync(socketRoot, 0o700);
  const recordPath = join(directory, "record.jsonl");
  const executable = join(directory, "codex");
  // While this file exists a spawned FAKE app-server waits before its
  // readiness handshake (the "spawned, not ready" barrier).
  const readyGate = join(directory, "ready-gate");
  writeFileSync(
    executable,
    `#!/bin/sh\nwhile [ -e ${JSON.stringify(readyGate)} ]; do sleep 0.02; done\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeServerPath)} "$@"\n`,
    { mode: 0o700 },
  );
  /** Test barriers: launch preparation (registered, not spawned). */
  const hooks: { beforeLaunch?: (participantId: string) => Promise<void> } = {};
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({
    databasePath,
    placementCapacityPolicy: {
      defaultMaxConcurrent: 4,
      hostLimits: [
        { hostId: "prewarm-host", maxConcurrent: options.hostCap ?? 4 },
      ],
      runtimeProfileLimits: [
        {
          hostId: "prewarm-host",
          maxConcurrent: options.profileCap ?? 4,
          runtimeProfileId: "fake-codex-warm",
        },
      ],
    },
  });
  kernel.initialize();
  const worker = new WorkerApplicationService({ kernel });
  await worker.start();
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const head = (roomId: string) =>
    Number(
      db
        .prepare("SELECT next_seq - 1 AS seq FROM rooms WHERE room_id=?")
        .get(roomId)!.seq,
    );
  const profiles = new RuntimeProfileRegistry({
    databasePath: join(directory, "runtime-registry.db"),
    hostId: "prewarm-host",
  });
  profiles.initialize();
  const implementations = new RuntimeImplementationRegistry();
  const manifest: RuntimeProfileManifestV3 = {
    adapter: {
      config: { diagnosticByteLimit: 262_144, terminationGraceMs: 1_000 },
      executable,
      fixedArgs: ["FAKE standing prompt for the prewarm test"],
      kind: "codex-app-server/v1",
    },
    credentialSlots: [],
    declaredCapabilities: ["worker_commands"],
    displayName: "FAKE Codex warm app-server",
    manifestVersion: 3,
    modelCatalogProbe: { kind: "codex-cli/v1" },
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers: ["rah-process-supervisor-v1"],
    runtimeProfileId: "fake-codex-warm",
    staticEnv: {
      FAKE_CODEX_RECORD_PATH: recordPath,
      FAKE_CODEX_STATE_DIR: join(directory, "fake-state"),
    },
    workspacePolicy: { allowedModes: ["in_place"] },
  };
  const revision = profiles.importManifest(manifest);
  const report = profiles.recordProbeReport(
    await implementations.probeRevision(revision, { cwd: directory }),
  );
  const active = profiles.activateRevision({
    contentDigest: revision.contentDigest,
    runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
  });

  const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const actor = kernel.authenticateAccessToken(owner.accessToken);
  const workspace = kernel.createWorkspace(actor, {
    name: "Roles",
    slug: "roles",
    idempotencyKey: "workspace",
  });
  const controlRoomId = workspace.controlRoom.roomId;
  const role = kernel.roles.create(actor, {
    controlRoomId,
    basedOnRoomSeq: head(controlRoomId),
    idempotencyKey: "role",
    configuration: {
      displayName: "Reviewer",
      handle: "reviewer",
      instructions: "Review only.",
      role: "Review",
      runtimeOfferId: "offer",
      modelIntent: { fallback: "disabled" as const },
    },
  }).role;
  const home = kernel.createWorkspaceRoom(actor, {
    workspaceId: workspace.workspace.workspaceId,
    basedOnControlRoomSeq: head(controlRoomId),
    kind: "channel",
    idempotencyKey: "home",
    name: "home",
    slug: "home",
  }).room;
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "prewarm-host",
      participantIds: [
        kernel.provisionPrincipal({ handle: "bootstrap", kind: "agent" })
          .principal.principalId,
      ],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const now = new Date();
  kernel.publishRuntimeOffer(host, {
    hostId: host.hostId,
    hostInstanceId: host.instanceId,
    runtimeOfferId: "offer",
    runtimeProfileId: manifest.runtimeProfileId,
    runtimeProfileRevisionId: active.runtimeProfileRevisionId,
    revisionDigest: active.contentDigest,
    protocolFamily: "rah-worker-process/v1",
    state: "available",
    observedAt: now.toISOString(),
    leaseUntil: new Date(now.getTime() + 600_000).toISOString(),
    isolation: { evidence: "declared", level: "none" },
    maxConcurrent: 8,
    capacityPoolIds: [],
    capabilityEvidence: [],
    certificationRefs: [],
    modelBindingDescriptors: [],
    supportedToolAccessModes: ["full_access"],
    workspaceMountDescriptors: [
      {
        workspaceDefinitionId: workspace.workspace.workspaceId,
        workspaceMountRevisionId: "mount",
        workspaceMountDigest: `sha256:${"a".repeat(64)}`,
        modes: ["in_place"],
      },
    ],
  });
  let instances = 0;
  const instantiate = () => {
    instances += 1;
    return kernel.roles.instantiate(actor, {
      roleId: role.roleId,
      channelId: home.roomId,
      basedOnRoomSeq: head(home.roomId),
      idempotencyKey: `instance-${String(instances)}`,
    }).instance.instanceId;
  };
  const instanceId = instantiate();

  const diagnostics: string[] = [];
  const pool = new InstanceRuntimePool({
    control: createKernelAgentHostControlPort(kernel, host),
    hostGeneration: host.instanceId,
    idleTtlMs: 60_000,
    onDiagnostic: (message) => diagnostics.push(message),
    ...(options.maxWarm === undefined
      ? {}
      : { policy: { maxWarm: options.maxWarm } }),
    socketRoot,
    stateDirectory: join(directory, "warm-runtimes"),
  });
  const providerSessionStore = new ProviderSessionStore({
    rootDirectory: join(directory, "provider-sessions"),
  });
  const creation = {
    cwd: directory,
    providerSessionStore,
    recordDeliveryAcceptance: async () => undefined,
    supervisorDirectory: join(directory, "supervisors"),
  };
  // The production resolver builds a fresh adapter per placement over the one
  // shared pool; `perTurn` is the per-turn adapter every non-warm CLI (Kimi,
  // default Claude) gets.
  const createAdapter = (): RuntimeAdapter =>
    options.perTurn === true
      ? implementations.createRuntime(
          active,
          report,
          creation,
          undefined,
          "full_access",
        )
      : implementations.createWarmRuntime(
          active,
          report,
          creation,
          {
            issueWorkerCredential: async (input) =>
              worker.issueActivationCredential(host, input),
            pool,
            runtimeEnvironment: async (input) => {
              await hooks.beforeLaunch?.(input.participantId);
              return { env: {} };
            },
            workerApiOrigin: worker.origin,
          },
          undefined,
          "full_access",
        );
  const agentHost = new AgentHost({
    drainTimeoutMs: 300,
    guideEnabled: () => true,
    host,
    instanceRuntimePool: pool,
    kernel,
    leaseMs: 30_000,
    placementRuntimeResolver: () => createAdapter(),
    pollIntervalMs: 20,
    retryAfterMs: 0,
    runtime: createAdapter(),
  });
  const startGate = new AgentStartGate({
    maxConcurrentStarts: 1,
    minStartIntervalMs: 0,
  });
  const prewarmer = new InstancePrewarmer({
    ...(options.admit === undefined ? {} : { admit: options.admit }),
    host,
    kernel,
    onDiagnostic: (message) => diagnostics.push(message),
    pool,
    resolveRuntime: () => createAdapter(),
    startGate,
  });

  let messages = 0;
  const records = (): Record<string, unknown>[] =>
    existsSync(recordPath)
      ? readFileSync(recordPath, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>)
      : [];
  const requests = (method: string) =>
    records().filter(
      (record) => record.event === "request" && record.method === method,
    );
  return {
    actor,
    agentHost,
    db,
    diagnostics,
    head,
    home: home.roomId,
    host,
    instanceId,
    instantiate,
    kernel,
    hooks,
    pool,
    prewarmer,
    readyGate,
    records,
    startGate,
    requests,
    starts: () => records().filter((record) => record.event === "start"),
    runtimeRow: (participantId: string) =>
      db
        .prepare(
          "SELECT * FROM instance_runtimes WHERE participant_id=? ORDER BY started_at DESC LIMIT 1",
        )
        .get(participantId),
    post(participantId: string, body: string) {
      messages += 1;
      return kernel.postMessage(actor, {
        body,
        idempotencyKey: `prewarm-message-${String(messages)}`,
        recipients: [{ participantId, reason: "mention" }],
        roomId: home.roomId,
      });
    },
    async cleanup() {
      await pool.shutdown().catch(() => undefined);
      db.close();
      profiles.close();
      await worker.close();
      kernel.close();
      rmSync(socketRoot, { force: true, recursive: true });
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

test("instance creation prewarms the warm runtime without a model turn; the first turn reuses it warm on the same session", async () => {
  const state = await prewarmHarness();
  try {
    const outcome = await state.prewarmer.prewarm(state.instanceId);
    assert.equal(outcome.kind, "started", JSON.stringify(outcome));
    assert.equal(state.starts().length, 1, "one app-server process");
    assert.equal(state.requests("thread/start").length, 1);
    assert.equal(
      state.requests("turn/start").length,
      0,
      "prewarming never starts a model turn",
    );
    const row = state.runtimeRow(state.instanceId)!;
    assert.equal(row.state, "idle");
    assert.equal(Number(row.turn_count), 0);
    assert.equal(
      Number(
        state.db.prepare("SELECT COUNT(*) AS n FROM run_attempts").get()!.n,
      ),
      0,
      "no RunAttempt, Activation or placement for a prewarm",
    );
    assert.deepEqual(
      await state.prewarmer.prewarm(state.instanceId),
      {
        kind: "skipped",
        participantId: state.instanceId,
        reason: "already_live",
      },
      "a second hint never starts a second process",
    );

    state.post(state.instanceId, "[fake:ack] first message");
    const first = await state.agentHost.reconcileOnce();
    assert.equal(
      first.state,
      "completed",
      JSON.stringify(first) + state.diagnostics.join("\n"),
    );
    const run = state.db
      .prepare(
        "SELECT execution_mode, instance_runtime_id FROM run_attempts WHERE participant_id=?",
      )
      .get(state.instanceId)!;
    assert.equal(run.execution_mode, "warm", "the runtime key matched");
    assert.equal(run.instance_runtime_id, row.instance_runtime_id);
    assert.equal(state.starts().length, 1, "no second process");
    assert.equal(state.requests("thread/start").length, 1, "one session");
    const [turn] = state.requests("turn/start");
    assert.equal(
      (turn!.params as { threadId: string }).threadId,
      String(row.native_session_id),
      "the first turn runs on the prewarmed session",
    );
  } finally {
    await state.cleanup();
  }
});

test("prewarming stops at the warm cap, the Host cap and the per-CLI cap without evicting a live runtime", async () => {
  const warmCap = await prewarmHarness({ maxWarm: 1 });
  try {
    const second = warmCap.instantiate();
    assert.equal(
      (await warmCap.prewarmer.prewarm(warmCap.instanceId)).kind,
      "started",
    );
    assert.deepEqual(await warmCap.prewarmer.prewarm(second), {
      kind: "skipped",
      participantId: second,
      reason: "warm_cap",
    });
    assert.equal(warmCap.starts().length, 1);
    assert.equal(
      warmCap.runtimeRow(warmCap.instanceId)!.state,
      "idle",
      "the live runtime is not evicted for a prewarm",
    );
  } finally {
    await warmCap.cleanup();
  }
  for (const [options, reason] of [
    [{ hostCap: 1 }, "host_cap"],
    [{ profileCap: 1 }, "cli_cap"],
  ] as const) {
    const state = await prewarmHarness(options);
    try {
      const second = state.instantiate();
      assert.equal(
        (await state.prewarmer.prewarm(state.instanceId)).kind,
        "started",
      );
      assert.deepEqual(await state.prewarmer.prewarm(second), {
        kind: "skipped",
        participantId: second,
        reason,
      });
      assert.equal(state.starts().length, 1, reason);
      assert.ok(
        state.diagnostics.some((line) => line.includes(reason)),
        "the skip reason is recorded",
      );
    } finally {
      await state.cleanup();
    }
  }
});

test("a busy instance is never prewarmed and the Kernel's run caps hold prewarming", async () => {
  const state = await prewarmHarness({ hostCap: 1 });
  try {
    const second = state.instantiate();
    state.post(state.instanceId, "[fake:steer-wait] long work");
    const running = state.agentHost.reconcileOnce();
    await waitFor(
      () => state.requests("turn/start").length === 1,
      "the first instance's turn",
    );
    assert.deepEqual(await state.prewarmer.prewarm(state.instanceId), {
      kind: "skipped",
      participantId: state.instanceId,
      reason: "placement_hold:lane_busy",
    });
    assert.deepEqual(await state.prewarmer.prewarm(second), {
      kind: "skipped",
      participantId: second,
      reason: "placement_hold:capacity_exhausted",
    });
    assert.equal(state.starts().length, 1);
    await running;
  } finally {
    await state.cleanup();
  }
});

test("switching prewarm off at runtime starts nothing", async () => {
  const state = await prewarmHarness();
  try {
    state.prewarmer.updateSettings({ enabled: false });
    assert.deepEqual(await state.prewarmer.prewarm(state.instanceId), {
      kind: "skipped",
      participantId: state.instanceId,
      reason: "disabled",
    });
    assert.deepEqual(await state.prewarmer.prewarmRecentlyActive(), []);
    assert.equal(state.starts().length, 0);
    state.prewarmer.updateSettings({ enabled: true });
    assert.equal(
      (await state.prewarmer.prewarm(state.instanceId)).kind,
      "started",
    );
  } finally {
    await state.cleanup();
  }
});

test("removing the instance retires its prewarmed runtime with proof", async () => {
  const state = await prewarmHarness();
  try {
    assert.equal(
      (await state.prewarmer.prewarm(state.instanceId)).kind,
      "started",
    );
    state.kernel.removeRoomMember(state.actor, {
      basedOnRoomSeq: state.head(state.home),
      idempotencyKey: "remove",
      principalId: state.instanceId,
      roomId: state.home,
    });
    await state.prewarmer.retire(state.instanceId);
    const row = state.runtimeRow(state.instanceId)!;
    assert.equal(row.state, "terminated");
    assert.equal(row.terminated_reason, "removed");
    assert.equal(state.pool.runtimeFor(state.instanceId), undefined);
    assert.deepEqual(await state.prewarmer.prewarm(state.instanceId), {
      kind: "skipped",
      participantId: state.instanceId,
      reason: "instance_inactive",
    });
    assert.equal(state.starts().length, 1);
  } finally {
    await state.cleanup();
  }
});

test("after a daemon start the recently active instances are prewarmed and resume their bound session", async () => {
  const state = await prewarmHarness();
  try {
    const idle = state.instantiate();
    state.post(state.instanceId, "[fake:ack] earlier work");
    const earlier = await state.agentHost.reconcileOnce();
    assert.equal(earlier.state, "completed", JSON.stringify(earlier));
    const [started] = state.requests("thread/start");
    assert.ok(started);
    // The daemon stopped: every runtime ended.
    await state.pool.shutdown();
    assert.equal(state.runtimeRow(state.instanceId)!.state, "terminated");

    const outcomes = await state.prewarmer.prewarmRecentlyActive();
    assert.deepEqual(
      outcomes.map((outcome) => [outcome.participantId, outcome.kind]),
      [[state.instanceId, "started"]],
      "only the instance with a recent RunAttempt; never the idle one",
    );
    assert.equal(state.runtimeRow(idle), undefined);
    const resumes = state.requests("thread/resume");
    assert.equal(resumes.length, 1, "the bound session is resumed");
    assert.equal(state.requests("thread/start").length, 1, "no new session");
    assert.equal(state.requests("turn/start").length, 1, "no model turn");
    assert.equal(
      state.runtimeRow(state.instanceId)!.native_session_id,
      (resumes[0]!.params as { threadId: string }).threadId,
    );

    state.prewarmer.updateSettings({ recentActiveWindowMs: 1 });
    await state.pool.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(
      await state.prewarmer.prewarmRecentlyActive(),
      [],
      "outside the configured window",
    );
  } finally {
    await state.cleanup();
  }
});

test("per-turn runtimes (Kimi, default Claude) are never prewarmed", async () => {
  const state = await prewarmHarness({ perTurn: true });
  try {
    assert.deepEqual(await state.prewarmer.prewarm(state.instanceId), {
      kind: "skipped",
      participantId: state.instanceId,
      reason: "per_turn_runtime",
    });
    assert.equal(state.starts().length, 0);
  } finally {
    await state.cleanup();
  }
});

function gate() {
  let open!: () => void;
  let fail!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { fail, open, promise };
}

const runtimeRows = (
  state: Awaited<ReturnType<typeof prewarmHarness>>,
  participantId: string,
) =>
  state.db
    .prepare(
      "SELECT instance_runtime_id, state, terminated_reason, pid FROM instance_runtimes WHERE participant_id=? ORDER BY started_at",
    )
    .all(participantId);

/**
 * Full review 2 batch 1 #3 (Codex P1-2, lifecycle P2-1): the first message
 * of an instance whose prewarm is still starting — registered but not
 * spawned, or spawned but not ready — shares the pool's start ownership: the
 * start fence neither kills nor terminates the in-flight runtime, no second
 * session starts, and the first turn takes the prewarmed runtime over warm.
 */
for (const barrier of ["registered", "spawned"] as const)
  test(`a first message while the prewarm is ${barrier} but not ready takes the prewarmed runtime over`, async () => {
    const state = await prewarmHarness();
    try {
      const launch = gate();
      if (barrier === "registered")
        state.hooks.beforeLaunch = async () => await launch.promise;
      else writeFileSync(state.readyGate, "");
      const prewarming = state.prewarmer.prewarm(state.instanceId);
      await waitFor(() => {
        const row = state.runtimeRow(state.instanceId);
        return (
          row?.state === "starting" &&
          (barrier === "registered" || row.pid !== null)
        );
      }, `the prewarm ${barrier}`);
      state.post(state.instanceId, "[fake:ack] first message");
      const first = state.agentHost.reconcileOnce();
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.deepEqual(
        runtimeRows(state, state.instanceId).map((row) => [
          row.state,
          row.terminated_reason,
        ]),
        [["starting", null]],
        "the start fence leaves the pool's in-flight runtime alone",
      );
      if (barrier === "registered") launch.open();
      else rmSync(state.readyGate);
      const outcome = await prewarming;
      assert.equal(outcome.kind, "started", JSON.stringify(outcome));
      const result = await first;
      assert.equal(
        result.state,
        "completed",
        JSON.stringify(result) + state.diagnostics.join("\n"),
      );
      const run = state.db
        .prepare(
          "SELECT execution_mode, instance_runtime_id FROM run_attempts WHERE participant_id=?",
        )
        .get(state.instanceId)!;
      assert.equal(run.execution_mode, "warm");
      assert.equal(
        run.instance_runtime_id,
        outcome.kind === "started" ? outcome.instanceRuntimeId : "",
      );
      assert.equal(state.starts().length, 1, "one process");
      assert.equal(state.requests("thread/start").length, 1, "one session");
      assert.deepEqual(
        runtimeRows(state, state.instanceId).map((row) => row.state),
        ["idle"],
        "no crash or start_failed row",
      );
    } finally {
      await state.cleanup();
    }
  });

test("a prewarm that fails while the first message waits leaves the real start to run normally", async () => {
  const state = await prewarmHarness();
  try {
    const launch = gate();
    let failOnce = true;
    state.hooks.beforeLaunch = async () => {
      if (!failOnce) return;
      failOnce = false;
      await launch.promise;
    };
    const prewarming = state.prewarmer.prewarm(state.instanceId);
    await waitFor(
      () => state.runtimeRow(state.instanceId)?.state === "starting",
      "the prewarm registered",
    );
    state.post(state.instanceId, "[fake:ack] first message");
    const first = state.agentHost.reconcileOnce();
    await new Promise((resolve) => setTimeout(resolve, 100));
    launch.fail(new Error("FAKE launch preparation failure"));
    const outcome = await prewarming;
    assert.equal(outcome.kind, "skipped");
    assert.match(
      outcome.kind === "skipped" ? outcome.reason : "",
      /FAKE launch preparation failure/u,
    );
    const result = await first;
    assert.equal(
      result.state,
      "completed",
      JSON.stringify(result) + state.diagnostics.join("\n"),
    );
    const run = state.db
      .prepare("SELECT execution_mode FROM run_attempts WHERE participant_id=?")
      .get(state.instanceId)!;
    assert.equal(run.execution_mode, "cold");
    assert.equal(state.starts().length, 1, "only the real start spawned");
  } finally {
    await state.cleanup();
  }
});

/**
 * Full review 2 batch 1 #2 (Codex P1-1): a prewarm passes the same leftover
 * cleanup admission as real execution, after the start gate and before any
 * spawn. A pending cleanup, an unavailable process scan and an unwritten
 * cleanup result each skip it with the reason; once cleanup recovers the
 * instance prewarms again.
 */
test("a prewarm is refused by an unresolved cleanup, an unavailable scan or an unwritten cleanup result, and runs after recovery", async () => {
  const EMPTY = {
    listeningPorts: [],
    portsObserved: true,
    processCount: 0,
    rssKb: 0,
  };
  const sweepResult = (
    overrides: Partial<LeftoverSweepResult> = {},
  ): LeftoverSweepResult => ({
    footprint: EMPTY,
    found: 0,
    killed: 0,
    portsObserved: true,
    releasedPorts: [],
    remaining: 0,
    remainingPorts: [],
    unknown: 0,
    ...overrides,
  });
  for (const scenario of ["pending", "scan", "unrecorded"] as const) {
    let broken = true;
    const sweeper = {
      async measure() {
        return EMPTY;
      },
      async sweep() {
        return broken && scenario === "pending"
          ? sweepResult({ found: 1, remaining: 1 })
          : sweepResult();
      },
      async taggedRuntimeIds() {
        if (broken && scenario === "scan") throw new Error("FAKE ps: exited 2");
        return new Set<string>();
      },
    };
    const hygiene = new RuntimeProcessHygiene({
      onAlert: () => undefined,
      sweeper,
    });
    let control!: Parameters<RuntimeProcessHygiene["admit"]>[0];
    const state = await prewarmHarness({
      admit: async (participantId) =>
        await hygiene.admit(control, participantId),
    });
    try {
      const real = createKernelAgentHostControlPort(state.kernel, state.host);
      control = {
        ...real,
        recordRuntimeProcessCleanup: async (input) => {
          if (broken && scenario === "unrecorded")
            throw new Error("FAKE kernel unavailable");
          return await real.recordRuntimeProcessCleanup!(input);
        },
      };
      if (scenario === "pending")
        await control.markRuntimeCleanupPending!({
          observedAt: new Date().toISOString(),
          participantId: state.instanceId,
          runtimeRunId: "old-unresolved-runtime",
        });
      if (scenario === "scan")
        await hygiene.janitor(control, "host_start").catch(() => undefined);
      if (scenario === "unrecorded")
        await hygiene.afterRuntime(control, {
          participantId: state.instanceId,
          runtimeId: "old-runtime",
          trigger: "run_end",
        });
      const refused = await state.prewarmer.prewarm(state.instanceId);
      assert.equal(refused.kind, "skipped", scenario);
      assert.match(
        refused.kind === "skipped" ? refused.reason : "",
        /RAH_RUNTIME_CLEANUP_BLOCKED/u,
        scenario,
      );
      assert.equal(state.starts().length, 0, `${scenario}: nothing spawned`);
      assert.equal(
        state.runtimeRow(state.instanceId),
        undefined,
        `${scenario}: no runtime row`,
      );
      broken = false;
      assert.equal(
        (await state.prewarmer.prewarm(state.instanceId)).kind,
        "started",
        `${scenario}: prewarms again after recovery`,
      );
    } finally {
      await state.cleanup();
    }
  }
});

/**
 * Full review 2 batch 1 #4 (lifecycle P2-2): a prewarm re-checks after the
 * start gate. An instance removed (and retired) while its prewarm waited in
 * the gate is never spawned; one removed without a retire hint is refused by
 * the re-plan; closing the prewarmer takes queued prewarms out of the gate.
 */
test("a prewarm queued in the start gate never spawns for a removed or retired instance, nor after close", async () => {
  for (const variant of ["retired", "removed", "closed"] as const) {
    const state = await prewarmHarness();
    try {
      const slot = gate();
      const held = state.startGate.runStart(
        "other-agent",
        async () => await slot.promise,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      const prewarming = state.prewarmer.prewarm(state.instanceId);
      await new Promise((resolve) => setTimeout(resolve, 50));
      let closing: Promise<void> | undefined;
      if (variant === "closed") closing = state.prewarmer.close();
      else
        state.kernel.removeRoomMember(state.actor, {
          basedOnRoomSeq: state.head(state.home),
          idempotencyKey: "remove",
          principalId: state.instanceId,
          roomId: state.home,
        });
      if (variant === "retired") await state.prewarmer.retire(state.instanceId);
      if (variant === "closed") {
        const outcome = await prewarming;
        await closing;
        assert.equal(outcome.kind, "skipped", variant);
      }
      slot.open();
      await held;
      const outcome = await prewarming;
      assert.equal(
        outcome.kind,
        "skipped",
        `${variant}: ${JSON.stringify(outcome)}`,
      );
      assert.equal(state.starts().length, 0, `${variant}: nothing spawned`);
      assert.equal(
        state.runtimeRow(state.instanceId),
        undefined,
        `${variant}: no runtime row`,
      );
    } finally {
      await state.cleanup();
    }
  }
});

/**
 * Full review 2 batch 1 #5 (Codex P2-1): prewarms and real starts share one
 * count of the Host's live CLI processes — warm runtimes (idle, busy and
 * still starting) plus the Kernel's placements no warm runtime holds (the
 * per-turn cold CLI processes). Real execution goes first: a prewarm that has
 * not spawned yet yields to a real start that took the last slot.
 */
test("a prewarm not yet spawned yields to a real start that takes the last Host slot", async () => {
  const state = await prewarmHarness({ hostCap: 1 });
  try {
    const second = state.instantiate();
    const launch = gate();
    state.hooks.beforeLaunch = async (participantId) => {
      if (participantId === state.instanceId) await launch.promise;
    };
    const prewarming = state.prewarmer.prewarm(state.instanceId);
    await waitFor(
      () => state.runtimeRow(state.instanceId)?.state === "starting",
      "the prewarm registered",
    );
    state.post(second, "[fake:ack] real work");
    const real = state.agentHost.reconcileOnce();
    await waitFor(
      () => state.runtimeRow(second) !== undefined,
      "the real start registered",
    );
    launch.open();
    const outcome = await prewarming;
    assert.deepEqual(outcome, {
      kind: "skipped",
      participantId: state.instanceId,
      reason: "host_cap",
    });
    const result = await real;
    assert.equal(result.state, "completed", JSON.stringify(result));
    assert.equal(state.starts().length, 1, "only the real start spawned");
  } finally {
    await state.cleanup();
  }
});

test("a placement no warm runtime holds (a per-turn CLI process) counts against prewarming", async () => {
  const state = await prewarmHarness({ hostCap: 2 });
  try {
    const cold = state.instantiate();
    const third = state.instantiate();
    assert.equal(
      (await state.prewarmer.prewarm(state.instanceId)).kind,
      "started",
    );
    // A claimed placement with no warm runtime: a per-turn run in flight.
    state.post(cold, "[fake:ack] per-turn work");
    assert.ok(state.kernel.scheduleNextPlacement({ leaseMs: 60_000 }));
    const claimed = state.kernel.claimNextPlacement(state.host, {
      leaseMs: 60_000,
    });
    assert.ok(claimed, "the per-turn run holds a placement");
    assert.deepEqual(await state.prewarmer.prewarm(third), {
      kind: "skipped",
      participantId: third,
      reason: "host_cap",
    });
    assert.equal(state.starts().length, 1);
  } finally {
    await state.cleanup();
  }
});

test("a prewarm queued in the gate is admitted against the caps current when it leaves the gate; a failed start frees its slot", async () => {
  const state = await prewarmHarness({ hostCap: 4 });
  try {
    const second = state.instantiate();
    const third = state.instantiate();
    assert.equal(
      (await state.prewarmer.prewarm(state.instanceId)).kind,
      "started",
    );
    const slot = gate();
    const held = state.startGate.runStart(
      "other-agent",
      async () => await slot.promise,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const prewarming = state.prewarmer.prewarm(second);
    await new Promise((resolve) => setTimeout(resolve, 50));
    state.kernel.placementCapacity.update({
      hostLimits: [{ hostId: "prewarm-host", maxConcurrent: 1 }],
    });
    slot.open();
    await held;
    assert.deepEqual(await prewarming, {
      kind: "skipped",
      participantId: second,
      reason: "host_cap",
    });

    state.kernel.placementCapacity.update({
      hostLimits: [{ hostId: "prewarm-host", maxConcurrent: 2 }],
    });
    state.hooks.beforeLaunch = async (participantId) => {
      if (participantId === second)
        throw new Error("FAKE launch preparation failure");
    };
    assert.equal((await state.prewarmer.prewarm(second)).kind, "skipped");
    assert.equal(
      (await state.prewarmer.prewarm(third)).kind,
      "started",
      "the failed start released its reservation",
    );
    assert.equal(state.starts().length, 2);
  } finally {
    await state.cleanup();
  }
});

async function waitFor(
  probe: () => boolean,
  label: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!probe()) {
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
