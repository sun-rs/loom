import assert from "node:assert/strict";
import {
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

import {
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import { RoomKernel } from "@rah-os/kernel";
import type { RuntimeProfileManifestV3 } from "@rah-os/protocol";

import { DaemonApplication, DaemonConfigSchema } from "../src/index.ts";

const fakeServerPath = fileURLToPath(
  new URL(
    "../../agent-host/test/fixtures/fake-codex-warm-app-server.mjs",
    import.meta.url,
  ),
);

/**
 * Owner 2026-09-27 through the composed daemon: prewarming is off by default;
 * once the Human switches it on, creating a Role instance with
 * the Human API makes the Host start its warm Codex runtime (FAKE app-server:
 * no model, no paid CLI) before any message — the process and its readiness
 * handshake, no turn. The first message then runs on that same process
 * (`warm`: the prewarm used the first turn's placement, channel home and
 * runtime key). A daemon restart prewarms the recently active instance again
 * and resumes its bound session; removing the instance retires the runtime;
 * switching prewarm off in the runtime settings starts nothing for a new
 * instance. Evidence is room.db plus the FAKE server's own record.
 */
test("the composed daemon prewarms nothing by default; switched on, it prewarms a created instance, reuses it on the first turn, prewarms after a restart and retires on removal", async () => {
  if (process.platform !== "darwin" && process.platform !== "linux") return;
  const state = await startPrewarmDaemon();
  try {
    // Owner 2026-09-27: without a runtime-settings file prewarming is off, so
    // a created instance starts nothing until the Human switches it on.
    const unwarmed = await state.createInstance("default-off");
    // The Host took the creation hint (it is published only once the pool
    // accepts prewarms), then decided against starting anything.
    await state.waitFor(
      () => state.pendingRuntimeHints() === 0,
      "the creation hint taken by the Host",
    );
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    assert.equal(state.liveRuntime(unwarmed), undefined);
    assert.equal(state.processStarts(), 0, "default settings never prewarm");
    // Leaves the Channel so later Human messages do not wake it.
    await state.humanMutation(state.roomId, "/v3/client/rooms/members/remove", {
      idempotencyKey: "remove-default-off",
      principalId: unwarmed,
      roomId: state.roomId,
    });
    const initial = await state.request<{ revision: number }>(
      "/v3/client/runtime-settings/read",
      {},
    );
    await state.request("/v3/client/runtime-settings/update", {
      expectedRevision: initial.revision,
      prewarm: { enabled: true },
    });
    const instanceId = await state.createInstance("first");
    const runtime = await state.waitFor(
      () => state.liveRuntime(instanceId),
      "the prewarmed runtime",
    );
    assert.equal(runtime.state, "idle");
    assert.equal(Number(runtime.turn_count), 0);
    assert.equal(state.requests("turn/start").length, 0, "no model turn");
    assert.equal(state.runs(instanceId).length, 0, "no RunAttempt");

    await state.post(instanceId, "[fake:ack] first message");
    const [first] = await state.waitFor(
      () =>
        state.runs(instanceId).filter((run) => run.state === "exited")
          .length === 1 && state.runs(instanceId),
      "the first turn",
      30_000,
    );
    assert.equal(first!.execution_mode, "warm");
    assert.equal(first!.instance_runtime_id, runtime.instance_runtime_id);
    assert.equal(state.processStarts(), 1, "the prewarmed process served it");

    // Daemon restart: the recently active instance is prewarmed again and
    // resumes its bound session (no new thread, no turn).
    await state.restart();
    const again = await state.waitFor(
      () => state.liveRuntime(instanceId),
      "the restart prewarm",
      30_000,
    );
    assert.notEqual(again.instance_runtime_id, runtime.instance_runtime_id);
    assert.equal(state.requests("thread/resume").length, 1);
    assert.equal(state.requests("thread/start").length, 1);
    assert.equal(state.requests("turn/start").length, 1);
    assert.equal(again.native_session_id, runtime.native_session_id);

    // Removal retires it with proof.
    await state.humanMutation(state.roomId, "/v3/client/rooms/members/remove", {
      idempotencyKey: "remove-first",
      principalId: instanceId,
      roomId: state.roomId,
    });
    const retired = await state.waitFor(() => {
      const row = state.runtimeRow(String(again.instance_runtime_id));
      return row?.state === "terminated" && row;
    }, "the retired runtime");
    assert.equal(retired.terminated_reason, "removed");

    // Prewarm switched off at runtime: a new instance starts nothing.
    const settings = await state.request<{ revision: number }>(
      "/v3/client/runtime-settings/read",
      {},
    );
    await state.request("/v3/client/runtime-settings/update", {
      expectedRevision: settings.revision,
      prewarm: { enabled: false },
    });
    const second = await state.createInstance("second");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.equal(state.liveRuntime(second), undefined);
    assert.equal(state.processStarts(), 2);
  } finally {
    await state.stop();
  }
});

async function startPrewarmDaemon() {
  const directory = mkdtempSync(join(tmpdir(), "loom-prewarm-daemon-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const registryDatabasePath = join(stateDirectory, "runtime-registry.db");
  const secretPath = join(stateDirectory, "host.token");
  const recordPath = join(directory, "fake-codex.jsonl");
  const lockDirectory = mkdtempSync("/tmp/lpl-");
  const executable = join(directory, "codex");
  writeFileSync(
    executable,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeServerPath)} "$@"\n`,
    { mode: 0o700 },
  );
  const hostId = "prewarm-daemon-host";
  const offerId = "prewarm-daemon-offer";
  const runtimeProfileId = "prewarm-daemon-codex";
  const seed = new RoomKernel({ databasePath });
  seed.initialize();
  const human = seed.provisionPrincipal({ handle: "human", kind: "human" });
  const humanActor = seed.authenticateAccessToken(human.accessToken);
  const workspace = seed.createWorkspace(humanActor, {
    idempotencyKey: "workspace",
    name: "Prewarm",
    slug: "prewarm",
  });
  const bootstrap = seed.provisionPrincipal({
    handle: "bootstrap",
    kind: "agent",
  }).principal.principalId;
  const hostCredential = seed.provisionHostCredential({
    hostId,
    participantIds: [bootstrap],
  });
  writeFileSync(secretPath, `${hostCredential.accessToken}\n`, { mode: 0o600 });
  seed.close();
  const profiles = new RuntimeProfileRegistry({
    databasePath: registryDatabasePath,
    hostId,
  });
  profiles.initialize();
  const implementations = new RuntimeImplementationRegistry();
  const manifest: RuntimeProfileManifestV3 = {
    adapter: {
      config: { diagnosticByteLimit: 262_144, terminationGraceMs: 1_000 },
      executable,
      fixedArgs: ["FAKE standing prompt for the prewarm daemon test"],
      kind: "codex-app-server/v1",
    },
    credentialSlots: [],
    declaredCapabilities: ["worker_commands"],
    displayName: "FAKE Codex warm app-server",
    manifestVersion: 3,
    modelCatalogProbe: { kind: "codex-cli/v1" },
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers: ["rah-process-supervisor-v1"],
    runtimeProfileId,
    staticEnv: {
      FAKE_CODEX_RECORD_PATH: recordPath,
      FAKE_CODEX_STATE_DIR: join(directory, "fake-state"),
    },
    workspacePolicy: { allowedModes: ["in_place"] },
  };
  const revision = profiles.importManifest(manifest);
  profiles.recordProbeReport(
    await implementations.probeRevision(revision, { cwd: stateDirectory }),
  );
  profiles.activateRevision({
    contentDigest: revision.contentDigest,
    runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
  });
  profiles.close();
  const config = DaemonConfigSchema.parse({
    channelWorkspaceRoot: join(stateDirectory, "channel-workspaces"),
    client: { bindHost: "127.0.0.1", port: 0 },
    drainTimeoutMs: 10_000,
    host: {
      credential: { path: secretPath, source: "file" },
      hostId,
      maxConcurrent: 4,
      participantIds: [bootstrap],
    },
    hostStaleAfterMs: 60_000,
    leaseMs: 30_000,
    lockDirectory,
    outboxLeaseMs: 5_000,
    outboxPollIntervalMs: 20,
    outboxRetryAfterMs: 200,
    pollIntervalMs: 20,
    runtimes: [
      {
        credentialBindings: {},
        kind: "runtime-profile-registry",
        offer: {
          leaseMs: 60_000,
          maxConcurrent: 4,
          refreshIntervalMs: 1_000,
          runtimeOfferId: offerId,
        },
        registryDatabasePath,
        runtimeProfileId,
      },
    ],
    runTimeoutMs: 60_000,
    runtimeCancelTimeoutMs: 10_000,
    runtimeRecoveryTimeoutMs: 30_000,
    runtimeStartTimeoutMs: 20_000,
    schemaVersion: 4,
    stateDirectory,
    taskClaimHeartbeatIntervalMs: 10_000,
    taskClaimLeaseMs: 30_000,
    workspace: {
      cwd: stateDirectory,
      mode: "in_place",
      workspaceDefinitionId: workspace.workspace.workspaceId,
      workspaceMountDigest: `sha256:${"a".repeat(64)}`,
      workspaceMountRevisionId: "workspace-mount-prewarm-v1",
    },
  });

  let shutdown = new AbortController();
  let running: Promise<void> | undefined;
  let application: DaemonApplication | undefined;
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const launch = async () => {
    shutdown = new AbortController();
    application = new DaemonApplication({ config });
    running = application.run({ signal: shutdown.signal });
    await waitUntil(() => application!.clientOrigin() !== undefined, 20_000);
  };
  const halt = async () => {
    shutdown.abort("prewarm-daemon-test");
    await running?.catch(() => undefined);
  };
  await launch();

  const request = async <T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> => {
    const response = await fetch(`${application!.clientOrigin()!}${path}`, {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${human.accessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    const parsed = (await response.json()) as T;
    assert.equal(response.status, 200, `${path}: ${JSON.stringify(parsed)}`);
    return parsed;
  };
  const head = async (roomId: string) =>
    (
      await request<{ latestRoomSeq: number }>("/v3/client/rooms/sync", {
        consumerId: "prewarm-test",
        roomId,
      })
    ).latestRoomSeq;
  const humanMutation = async (
    roomId: string,
    path: string,
    body: Record<string, unknown>,
  ) => await request(path, { ...body, basedOnRoomSeq: await head(roomId) });
  const controlRoomId = workspace.controlRoom.roomId;
  await waitUntil(
    () =>
      db
        .prepare(
          "SELECT 1 FROM runtime_offers WHERE runtime_offer_id=? AND state='available'",
        )
        .get(offerId) !== undefined,
    20_000,
  );
  const roomId = (
    await request<{ room: { roomId: string } }>("/v3/client/rooms/create", {
      basedOnControlRoomSeq: await head(controlRoomId),
      idempotencyKey: "room",
      kind: "channel",
      name: "Prewarm",
      slug: "prewarm-room",
      workspaceId: workspace.workspace.workspaceId,
    })
  ).room.roomId;
  const role = (
    (await humanMutation(controlRoomId, "/v3/client/roles/create", {
      configuration: {
        displayName: "Writer",
        handle: "writer",
        instructions: "Write briefly.",
        modelIntent: { fallback: "disabled" },
        role: "Writer",
        runtimeOfferId: offerId,
      },
      controlRoomId,
      idempotencyKey: "role",
    })) as { role: { roleId: string } }
  ).role;

  const records = (): Record<string, unknown>[] =>
    existsSync(recordPath)
      ? readFileSync(recordPath, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>)
      : [];
  return {
    roomId,
    request,
    humanMutation,
    async createInstance(key: string): Promise<string> {
      const created = (await humanMutation(
        roomId,
        "/v3/client/roles/instantiate",
        { channelId: roomId, idempotencyKey: key, roleId: role.roleId },
      )) as { instance: { instanceId: string } };
      return created.instance.instanceId;
    },
    async post(participantId: string, body: string) {
      await humanMutation(roomId, "/v3/client/messages/post", {
        body,
        idempotencyKey: `post-${body}`,
        recipients: [{ participantId, reason: "mention" }],
        roomId,
      });
    },
    liveRuntime: (participantId: string) =>
      db
        .prepare(
          "SELECT * FROM instance_runtimes WHERE participant_id=? AND state IN ('idle','busy')",
        )
        .get(participantId),
    runtimeRow: (instanceRuntimeId: string) =>
      db
        .prepare("SELECT * FROM instance_runtimes WHERE instance_runtime_id=?")
        .get(instanceRuntimeId),
    runs: (participantId: string) =>
      db
        .prepare(
          "SELECT * FROM run_attempts WHERE participant_id=? ORDER BY started_at",
        )
        .all(participantId),
    requests: (method: string) =>
      records().filter(
        (record) => record.event === "request" && record.method === method,
      ),
    pendingRuntimeHints: () =>
      Number(
        db
          .prepare(
            "SELECT count(*) AS n FROM outbox WHERE topic='instance.runtime' AND published_at IS NULL",
          )
          .get()!.n,
      ),
    processStarts: () =>
      records().filter((record) => record.event === "start").length,
    async waitFor<T>(
      probe: () => T | undefined | false,
      label: string,
      timeoutMs = 20_000,
    ): Promise<NonNullable<T>> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const value = probe();
        if (value !== undefined && value !== false && value !== null)
          return value as NonNullable<T>;
        if (Date.now() > deadline)
          throw new Error(`timed out waiting for ${label}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
    async restart() {
      await halt();
      await launch();
    },
    async stop() {
      await halt();
      db.close();
      rmSync(lockDirectory, { force: true, recursive: true });
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition was not met");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
