import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import { DaemonApplication, DaemonConfigSchema } from "@rah-os/daemon";
import { RoomKernel } from "@rah-os/kernel";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = join(scriptDirectory, "..");
const fakeCliPath = join(
  scriptDirectory,
  "../packages/agent-host/test/fixtures/fake-cli.mjs",
);
const directory = mkdtempSync(join(tmpdir(), "rah-os-multi-agent-web-"));
chmodSync(directory, 0o700);
const stateDirectory = join(directory, "state");
mkdirSync(stateDirectory, { mode: 0o700 });
const databasePath = join(stateDirectory, "room.db");
const registryDatabasePath = join(stateDirectory, "runtime-registry.db");
const secretPath = join(stateDirectory, "host.token");
const hostId = "web-multi-agent-host";
const offerIds = ["web-multi-agent-offer-a", "web-multi-agent-offer-b"];
const profileIds = ["web-multi-agent-profile-a", "web-multi-agent-profile-b"];
const webHost = process.env.RAH_WEB_HOST?.trim() || "127.0.0.1";
if (/\s/u.test(webHost)) {
  throw new Error("RAH_WEB_HOST must not contain whitespace");
}
const webPort = Number(process.env.RAH_WEB_PORT ?? "4174");
if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65_535) {
  throw new Error("RAH_WEB_PORT must be an integer between 1 and 65535");
}

let application;
let running;
let seed;
let shutdown;
let webProcess;

try {
  seed = new RoomKernel({ databasePath });
  seed.initialize();
  const human = seed.provisionPrincipal({
    handle: "sun",
    kind: "human",
  });
  const humanActor = seed.authenticateAccessToken(human.accessToken);

  const productWorkspace = seed.createWorkspace(humanActor, {
    idempotencyKey: "web-multi-agent-workspace",
    name: "RAH Multi-Agent",
    slug: "rah-multi-agent",
  });
  const productRoom = seed.createWorkspaceRoom(humanActor, {
    basedOnControlRoomSeq: productWorkspace.event.roomSeq,
    idempotencyKey: "web-multi-agent-room",
    kind: "channel",
    name: "Agent Council",
    slug: "agent-council",
    workspaceId: productWorkspace.workspace.workspaceId,
  });

  const agents = ["Alice", "Kimi"].map((handle) =>
    seed.provisionPrincipal({ handle, kind: "agent" }),
  );
  const catalogRoom = productWorkspace.controlRoom;
  for (const agent of agents) {
    seed.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: catalogRoom.roomId,
    });
  }

  const agentDefinitionIds = [];
  for (const [index, agent] of agents.entries()) {
    const policy = seed.createExecutionPolicy(humanActor, {
      basedOnRoomSeq: latestRoomSeq(seed, humanActor, catalogRoom.roomId),
      controlRoomId: catalogRoom.roomId,
      idempotencyKey: `web-multi-agent-policy-${String(index)}`,
      modelIntent: {
        fallback: "disabled",
        reasoning: "default",
        serviceTier: "default",
      },
      preferred: [],
      required: {
        allowedOfferIds: [offerIds[index]],
        allowedProtocolFamilies: ["rah-worker-process/v1"],
        capabilities: [],
        minimumIsolation: "none",
        workspaceMode: "in_place",
      },
      retryPolicyRef: {
        artifactId: `web-multi-agent-retry-${String(index)}`,
        contentDigest: `sha256:${String(index + 1).repeat(64)}`,
        versionId: `web-multi-agent-retry-${String(index)}-v1`,
      },
      sessionPolicy: "fresh",
    }).policy;
    const definition = seed.createAgentDefinition(humanActor, {
      basedOnRoomSeq: latestRoomSeq(seed, humanActor, catalogRoom.roomId),
      controlRoomId: catalogRoom.roomId,
      executionPolicyRevisionId: policy.executionPolicyRevisionId,
      idempotencyKey: `web-multi-agent-definition-${String(index)}`,
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: `web-multi-agent-memory-${String(index)}`,
        contentDigest: `sha256:${String(index + 3).repeat(64)}`,
        versionId: `web-multi-agent-memory-${String(index)}-v1`,
      },
      participantId: agent.principal.principalId,
      role: `${agent.principal.handle} deterministic fixture worker`,
      skillRefs: [],
    });
    agentDefinitionIds.push(definition.definition.agentDefinitionId);
  }

  let roomSeq = latestRoomSeq(seed, humanActor, productRoom.room.roomId);
  for (const [index, agentDefinitionId] of agentDefinitionIds
    .slice(0, 1)
    .entries()) {
    const onboarded = seed.onboardAgentToRoom(humanActor, {
      agentDefinitionId,
      basedOnRoomSeq: roomSeq,
      idempotencyKey: `web-multi-agent-onboard-${String(index)}`,
      roomId: productRoom.room.roomId,
    });
    roomSeq = onboarded.event.roomSeq;
  }

  const hostCredential = seed.provisionHostCredential({
    hostId,
    participantIds: agents.map((agent) => agent.principal.principalId),
  });
  writeFileSync(secretPath, `${hostCredential.accessToken}\n`, { mode: 0o600 });

  const registry = new RuntimeProfileRegistry({
    databasePath: registryDatabasePath,
    hostId,
  });
  registry.initialize();
  const implementations = new RuntimeImplementationRegistry();
  for (const [index, runtimeProfileId] of profileIds.entries()) {
    const revision = registry.importManifest({
      adapter: {
        config: { terminationGraceMs: 1_000 },
        executable: process.execPath,
        fixedArgs: [fakeCliPath],
        kind: "generic-process/v1",
      },
      credentialSlots: [],
      declaredCapabilities: ["worker_commands"],
      displayName: `Web multi-Agent fixture ${String(index)}`,
      manifestVersion: 2,
      protocolFamily: "rah-worker-process/v1",
      recoveryDrivers: ["rah-process-supervisor-v1"],
      runtimeProfileId,
      staticEnv: {
        RAH_FAKE_MODE: "worker-task",
        RAH_FAKE_ROOM_REPLY: `我已读取同一个 Room 上下文。— ${agents[index].principal.handle}`,
      },
      workspacePolicy: { allowedModes: ["in_place"] },
    });
    registry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: stateDirectory }),
    );
    registry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
  }
  registry.close();
  seed.close();
  seed = undefined;

  const config = DaemonConfigSchema.parse({
    client: { bindHost: "127.0.0.1", port: 0 },
    drainTimeoutMs: 30_000,
    host: {
      credential: { path: secretPath, source: "file" },
      hostId,
      maxConcurrent: 2,
      participantIds: agents.map((agent) => agent.principal.principalId),
    },
    hostStaleAfterMs: 60_000,
    leaseMs: 30_000,
    outboxLeaseMs: 5_000,
    outboxPollIntervalMs: 20,
    outboxRetryAfterMs: 1_000,
    pollIntervalMs: 20,
    runTimeoutMs: 30_000,
    runtimeCancelTimeoutMs: 10_000,
    runtimeRecoveryTimeoutMs: 30_000,
    runtimes: profileIds.map((runtimeProfileId, index) => ({
      credentialBindings: {},
      kind: "runtime-profile-registry",
      offer: {
        leaseMs: 120_000,
        maxConcurrent: 1,
        refreshIntervalMs: 30_000,
        runtimeOfferId: offerIds[index],
      },
      registryDatabasePath,
      runtimeProfileId,
    })),
    runtimeStartTimeoutMs: 10_000,
    schemaVersion: 4,
    stateDirectory,
    taskClaimHeartbeatIntervalMs: 10_000,
    taskClaimLeaseMs: 30_000,
    workspace: {
      cwd: stateDirectory,
      mode: "in_place",
      workspaceDefinitionId: "web-multi-agent-workspace-definition",
      workspaceMountDigest: `sha256:${"a".repeat(64)}`,
      workspaceMountRevisionId: "web-multi-agent-workspace-mount-v1",
    },
  });

  application = new DaemonApplication({ config });
  shutdown = new AbortController();
  running = application.run({ signal: shutdown.signal });
  await waitUntil(() => application.clientOrigin() !== undefined);
  webProcess = spawn(
    process.execPath,
    [
      join(repositoryDirectory, "node_modules/vite/bin/vite.js"),
      "--host",
      webHost,
      "--port",
      String(webPort),
      "--strictPort",
    ],
    {
      cwd: join(repositoryDirectory, "apps/web"),
      env: {
        ...process.env,
        RAH_DAEMON_URL: application.clientOrigin(),
        RAH_DEV_ACCESS_TOKEN: human.accessToken,
        RAH_WEB_PORT: String(webPort),
      },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  await waitForHttp(`http://127.0.0.1:${String(webPort)}/`);
  const lanOrigins =
    webHost === "0.0.0.0"
      ? Object.values(networkInterfaces())
          .flatMap((entries) => entries ?? [])
          .filter(
            (entry) =>
              entry.family === "IPv4" &&
              !entry.internal &&
              entry.address !== "0.0.0.0",
          )
          .map(({ address }) => `http://${address}:${String(webPort)}`)
      : [];
  process.stdout.write(
    `RAH_MULTI_AGENT_FIXTURE ${JSON.stringify({
      daemonOrigin: application.clientOrigin(),
      lanOrigins,
      listenHost: webHost,
      roomId: productRoom.room.roomId,
      webOrigin: `http://127.0.0.1:${String(webPort)}`,
      workspaceId: productWorkspace.workspace.workspaceId,
    })}\n`,
  );
  await waitForShutdownSignal();
} finally {
  if (webProcess?.exitCode === null) {
    webProcess.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => webProcess.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
  shutdown?.abort("multi-agent-web-fixture-shutdown");
  await running?.catch(() => undefined);
  try {
    seed?.close();
  } catch {
    // The seed connection may already be closed before daemon startup.
  }
  rmSync(directory, { force: true, recursive: true });
}

function latestRoomSeq(kernel, actor, roomId) {
  return kernel.sync(actor, {
    consumerId: `fixture-cursor-${roomId}`,
    roomId,
  }).latestRoomSeq;
}

async function waitUntil(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("fixture startup timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForHttp(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (webProcess?.exitCode !== null) {
      throw new Error("Web fixture exited before becoming ready");
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The loopback listener may not have bound yet.
    }
    if (Date.now() >= deadline)
      throw new Error("Web fixture startup timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function waitForShutdownSignal() {
  await new Promise((resolve) => {
    const finish = () => resolve();
    // Keep both handlers installed through async daemon drain/cleanup. npm and
    // the PTY can deliver the same signal to the process group more than once;
    // a one-shot handler would let the second signal terminate cleanup early.
    process.on("SIGINT", finish);
    process.on("SIGTERM", finish);
  });
}
