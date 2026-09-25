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
  createKernelAgentHostControlPort,
  InstanceRuntimePool,
  ProviderSessionStore,
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
} from "../src/index.ts";

/**
 * S3 review P2-1: the Role hot path as one free composition. A FAKE Codex
 * app-server (no model, no paid CLI) behind the production registry's warm
 * adapter, ProviderSessionStore and runtime key; a real Role instance from
 * `roles.instantiate`; the real Kernel placement claim through AgentHost and
 * the real Worker HTTP API. It proves the Host/Kernel wiring, not the real
 * Codex protocol or the other three CLIs.
 */
const fakeServerPath = fileURLToPath(
  new URL("./fixtures/fake-codex-warm-app-server.mjs", import.meta.url),
);

async function roleHarness() {
  const directory = mkdtempSync(join(tmpdir(), "rah-role-warm-"));
  chmodSync(directory, 0o700);
  const socketRoot = mkdtempSync("/tmp/lr-");
  chmodSync(socketRoot, 0o700);
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
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const head = (roomId: string) =>
    Number(
      db
        .prepare("SELECT next_seq - 1 AS seq FROM rooms WHERE room_id=?")
        .get(roomId)!.seq,
    );

  const profiles = new RuntimeProfileRegistry({
    databasePath: join(directory, "runtime-registry.db"),
    hostId: "role-host",
  });
  profiles.initialize();
  const implementations = new RuntimeImplementationRegistry();
  const manifest: RuntimeProfileManifestV3 = {
    adapter: {
      config: { diagnosticByteLimit: 262_144, terminationGraceMs: 1_000 },
      executable,
      fixedArgs: ["FAKE standing prompt for the Role hot path test"],
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
      hostId: "role-host",
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
    maxConcurrent: 2,
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
  const instance = kernel.roles.instantiate(actor, {
    roleId: role.roleId,
    channelId: home.roomId,
    basedOnRoomSeq: head(home.roomId),
    idempotencyKey: "instance",
  }).instance;
  const privateBoxId = kernel.openDirectRoom(actor, {
    workspaceId: workspace.workspace.workspaceId,
    peerPrincipalId: instance.instanceId,
    basedOnControlRoomSeq: head(controlRoomId),
    idempotencyKey: "instance-dm",
  }).roomId;

  const diagnostics: string[] = [];
  const pool = new InstanceRuntimePool({
    control: createKernelAgentHostControlPort(kernel, host),
    hostGeneration: host.instanceId,
    idleTtlMs: 60_000,
    onDiagnostic: (message) => diagnostics.push(message),
    socketRoot,
    stateDirectory: join(directory, "warm-runtimes"),
  });
  const providerSessionStore = new ProviderSessionStore({
    rootDirectory: join(directory, "provider-sessions"),
  });
  let claims = 0;
  // The production resolver builds a fresh adapter for every claim over the
  // one shared pool.
  const createAdapter = () => {
    claims += 1;
    return implementations.createWarmRuntime(
      active,
      report,
      {
        cwd: directory,
        providerSessionStore,
        // Present so the adapter renders the bodied wake, which carries the
        // `[fake:*]` directives to the fake server.
        recordDeliveryAcceptance: async () => undefined,
        supervisorDirectory: join(directory, "supervisors"),
      },
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
  };
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

  let messages = 0;
  const readRecords = (): Record<string, unknown>[] =>
    existsSync(recordPath)
      ? readFileSync(recordPath, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>)
      : [];
  return {
    actor,
    agentHost,
    claims: () => claims,
    db,
    diagnostics,
    head,
    home: home.roomId,
    host,
    instanceId: instance.instanceId,
    kernel,
    privateBoxId,
    post(roomId: string, body: string) {
      messages += 1;
      return kernel.postMessage(actor, {
        body,
        idempotencyKey: `role-message-${messages}`,
        recipients: [{ participantId: instance.instanceId, reason: "mention" }],
        roomId,
      });
    },
    records: readRecords,
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

test("Role hot path: a private message queues behind a channel turn, runs on the same lane, session and runtime under its own scope, and a reset retires the pooled runtime", async () => {
  const state = await roleHarness();
  try {
    const count = (sql: string, ...values: string[]) =>
      Number(state.db.prepare(sql).get(...values)!.n);
    const liveRuns = () =>
      count(
        "SELECT count(*) n FROM run_attempts WHERE participant_id=? AND state IN ('starting','running')",
        state.instanceId,
      );

    // 1. A channel turn is running when the Human writes to the private box.
    state.post(state.home, "[fake:steer-wait] channel work");
    const channel = state.agentHost.reconcileOnce();
    await waitFor(
      () => state.records().some((record) => record.event === "turn"),
      "channel turn start",
    );
    state.post(state.privateBoxId, "[fake:ack] private question");
    // The private work queues: one live run, and the Kernel hands out no
    // second placement for this instance while its lane is busy.
    assert.equal(liveRuns(), 1);
    state.kernel.scheduleNextPlacement({ leaseMs: 30_000 });
    assert.equal(
      state.kernel.claimNextPlacement(state.host, { leaseMs: 30_000 }),
      null,
      "no second lane while the channel turn runs",
    );
    const channelResult = await channel;
    assert.equal(
      channelResult.state,
      "completed",
      JSON.stringify(channelResult) + state.diagnostics.join("\n"),
    );
    const channelEnd = state
      .records()
      .find((record) => record.event === "turn-completed") as {
      steers: string[];
    };
    assert.deepEqual(channelEnd.steers, [], "the private box never steers");

    // 2. The queued private turn, then the channel again.
    const privateResult = await state.agentHost.reconcileOnce();
    assert.equal(
      privateResult.state,
      "completed",
      JSON.stringify(privateResult),
    );
    state.post(state.home, "[fake:ack] channel again");
    const backResult = await state.agentHost.reconcileOnce();
    assert.equal(backResult.state, "completed", JSON.stringify(backResult));

    const records = state.records();
    assert.equal(
      records.filter((record) => record.event === "start").length,
      1,
      "one app-server process for both rooms",
    );
    const threadStarts = () =>
      state
        .records()
        .filter(
          (record) =>
            record.event === "request" && record.method === "thread/start",
        ).length;
    assert.equal(threadStarts(), 1, "one native session");
    const turnThreads = records
      .filter(
        (record) =>
          record.event === "request" && record.method === "turn/start",
      )
      .map((record) => (record.params as { threadId: string }).threadId);
    assert.equal(new Set(turnThreads).size, 1);
    const runs = state.db
      .prepare(
        `SELECT r.room_id, r.instance_runtime_id, r.execution_mode, a.from_seq, a.to_seq
         FROM run_attempts r JOIN activations a ON a.activation_id=r.activation_id
         WHERE r.participant_id=? ORDER BY r.started_at`,
      )
      .all(state.instanceId);
    assert.deepEqual(
      runs.map((run) => run.room_id),
      [state.home, state.privateBoxId, state.home],
    );
    assert.deepEqual(
      runs.map((run) => run.execution_mode),
      ["cold", "warm", "warm"],
    );
    assert.equal(new Set(runs.map((run) => run.instance_runtime_id)).size, 1);
    // Each turn's Worker authority names its own Activation's room and range,
    // under its own turn handle.
    const turns = records.filter((record) => record.event === "turn");
    assert.deepEqual(
      turns.map((record) => record.scope),
      runs.map((run) => ({
        room: run.room_id,
        from: String(run.from_seq),
        to: String(run.to_seq),
      })),
    );
    assert.equal(new Set(turns.map((record) => record.handle)).size, 3);
    assert.ok(
      records
        .filter((record) => record.event === "worker")
        .every((record) => record.status === 0),
      "each turn's Worker CLI calls were accepted with that turn's handle",
    );
    assert.ok(state.claims() >= 3, "a fresh adapter per claim");
    const oldRuntimeId = String(runs[0]!.instance_runtime_id);

    // 3. A Human reset: the pooled runtime of the old session generation is
    // never reused; the next turn starts a new process and a new session.
    state.kernel.roles.resetInstanceSession(state.actor, {
      instanceId: state.instanceId,
      basedOnRoomSeq: state.head(state.home),
      idempotencyKey: "reset",
    });
    state.post(state.home, "[fake:ack] after reset");
    const afterReset = await state.agentHost.reconcileOnce();
    assert.equal(afterReset.state, "completed", JSON.stringify(afterReset));
    const [last] = state.db
      .prepare(
        "SELECT instance_runtime_id, execution_mode FROM run_attempts WHERE participant_id=? ORDER BY started_at DESC LIMIT 1",
      )
      .all(state.instanceId);
    assert.notEqual(last!.instance_runtime_id, oldRuntimeId);
    assert.equal(last!.execution_mode, "cold");
    assert.equal(
      state.records().filter((record) => record.event === "start").length,
      2,
    );
    assert.equal(threadStarts(), 2, "a new native session, no resume");
    assert.equal(
      state
        .records()
        .filter(
          (record) =>
            record.event === "request" && record.method === "thread/resume",
        ).length,
      0,
    );
    assert.equal(
      state.db
        .prepare(
          "SELECT state FROM instance_runtimes WHERE instance_runtime_id=?",
        )
        .get(oldRuntimeId)!.state,
      "terminated",
    );
  } finally {
    await state.cleanup();
  }
});
