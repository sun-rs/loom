import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
 * Contract §2 through the composed product: the frozen frontend can still
 * provision a legacy persona Agent (`POST /v3/client/agents/provision`,
 * retiring), but the daemon's Kernel never gives it an Inbox item or an
 * Activation, while a Role instance mentioned in the same message is
 * scheduled. FAKE app-server only: no model, no paid CLI; evidence is room.db.
 */
test("the composed daemon schedules a Role instance but never a legacy persona Agent", async () => {
  if (process.platform !== "darwin" && process.platform !== "linux") return;
  const directory = mkdtempSync(join(tmpdir(), "loom-persona-fence-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const registryDatabasePath = join(stateDirectory, "runtime-registry.db");
  const secretPath = join(stateDirectory, "host.token");
  const lockDirectory = mkdtempSync("/tmp/lpf-");
  const executable = join(directory, "codex");
  writeFileSync(
    executable,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeServerPath)} "$@"\n`,
    { mode: 0o700 },
  );
  const hostId = "persona-fence-host";
  const offerId = "persona-fence-offer";
  const runtimeProfileId = "persona-fence-codex";
  const seed = new RoomKernel({ databasePath });
  seed.initialize();
  const human = seed.provisionPrincipal({ handle: "human", kind: "human" });
  const workspace = seed.createWorkspace(
    seed.authenticateAccessToken(human.accessToken),
    { idempotencyKey: "workspace", name: "Fence", slug: "fence" },
  );
  const bootstrap = seed.provisionPrincipal({
    handle: "bootstrap",
    kind: "agent",
  }).principal.principalId;
  const credential = seed.provisionHostCredential({
    hostId,
    participantIds: [bootstrap],
  });
  writeFileSync(secretPath, `${credential.accessToken}\n`, { mode: 0o600 });
  seed.close();
  const profiles = new RuntimeProfileRegistry({
    databasePath: registryDatabasePath,
    hostId,
  });
  profiles.initialize();
  const manifest: RuntimeProfileManifestV3 = {
    adapter: {
      config: { diagnosticByteLimit: 262_144, terminationGraceMs: 1_000 },
      executable,
      fixedArgs: ["FAKE standing prompt for the persona fence test"],
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
      FAKE_CODEX_RECORD_PATH: join(directory, "fake-codex.jsonl"),
      FAKE_CODEX_STATE_DIR: join(directory, "fake-state"),
    },
    workspacePolicy: { allowedModes: ["in_place"] },
  };
  const revision = profiles.importManifest(manifest);
  profiles.recordProbeReport(
    await new RuntimeImplementationRegistry().probeRevision(revision, {
      cwd: stateDirectory,
    }),
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
      workspaceMountRevisionId: "workspace-mount-fence-v1",
    },
  });
  const shutdown = new AbortController();
  const application = new DaemonApplication({ config });
  const running = application.run({ signal: shutdown.signal });
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    await waitUntil(() => application.clientOrigin() !== undefined);
    await waitUntil(
      () =>
        db
          .prepare(
            "SELECT 1 FROM runtime_offers WHERE runtime_offer_id=? AND state='available'",
          )
          .get(offerId) !== undefined,
    );
    const request = async <T>(path: string, body: object): Promise<T> => {
      const response = await fetch(`${application.clientOrigin()!}${path}`, {
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
          consumerId: "persona-fence",
          roomId,
        })
      ).latestRoomSeq;
    const controlRoomId = workspace.controlRoom.roomId;
    const roomId = (
      await request<{ room: { roomId: string } }>("/v3/client/rooms/create", {
        basedOnControlRoomSeq: await head(controlRoomId),
        idempotencyKey: "room",
        kind: "channel",
        name: "Fence",
        slug: "fence-room",
        workspaceId: workspace.workspace.workspaceId,
      })
    ).room.roomId;
    const persona = (
      await request<{ agent: { definition: { participantId: string } } }>(
        "/v3/client/agents/provision",
        {
          basedOnRoomSeq: await head(controlRoomId),
          controlRoomId,
          displayName: "Persona",
          handle: "persona",
          idempotencyKey: "persona",
          instructions: "FIXTURE persona; never runs.",
          modelIntent: { fallback: "disabled" },
          role: "Assistant",
          runtimeOfferId: offerId,
          sessionPolicy: "prefer_resume",
        },
      )
    ).agent.definition.participantId;
    await request("/v3/client/rooms/members/add", {
      basedOnRoomSeq: await head(roomId),
      idempotencyKey: "persona-member",
      principalId: persona,
      role: "member",
      roomId,
    });
    const role = (
      await request<{ role: { roleId: string } }>("/v3/client/roles/create", {
        basedOnRoomSeq: await head(controlRoomId),
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
      })
    ).role;
    const instance = (
      await request<{ instance: { instanceId: string } }>(
        "/v3/client/roles/instantiate",
        {
          basedOnRoomSeq: await head(roomId),
          channelId: roomId,
          idempotencyKey: "instance",
          roleId: role.roleId,
        },
      )
    ).instance.instanceId;
    await request("/v3/client/messages/post", {
      basedOnRoomSeq: await head(roomId),
      body: "[fake:ack] both of you",
      idempotencyKey: "mention-both",
      recipients: [
        { participantId: persona, reason: "mention" },
        { participantId: instance, reason: "mention" },
      ],
      roomId,
    });
    const count = (table: string, participantId: string) =>
      Number(
        db
          .prepare(`SELECT count(*) AS n FROM ${table} WHERE participant_id=?`)
          .get(participantId)!.n,
      );
    assert.equal(count("activations", instance), 1);
    assert.equal(count("inbox_items", persona), 0);
    assert.equal(count("activations", persona), 0);
  } finally {
    shutdown.abort("persona-fence-test");
    await running.catch(() => undefined);
    db.close();
    rmSync(lockDirectory, { force: true, recursive: true });
    rmSync(directory, { force: true, recursive: true });
  }
});

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition was not met");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
