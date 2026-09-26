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
  RuntimeProfileRegistry,
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
  writeFileSync(
    executable,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeServerPath)} "$@"\n`,
    { mode: 0o700 },
  );
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
            runtimeEnvironment: async () => ({ env: {} }),
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
    pool,
    prewarmer,
    records,
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
