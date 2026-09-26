import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import {
  DaemonApplication,
  DaemonConfigSchema,
  discoverKnownLocalClis,
  localCliRuntimeSpec,
} from "@rah-os/daemon";
import { RoomKernel } from "@rah-os/kernel";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = join(scriptDirectory, "..");
const workspaceCwd = resolve(process.env.RAH_WORKSPACE_CWD ?? process.cwd());
const webHost = process.env.RAH_WEB_HOST?.trim() || "127.0.0.1";
if (/\s/u.test(webHost)) {
  throw new Error("RAH_WEB_HOST must not contain whitespace");
}
const webPort = Number(process.env.RAH_WEB_PORT ?? "4174");
if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65_535) {
  throw new Error("RAH_WEB_PORT must be an integer between 1 and 65535");
}
const discovered = await discoverKnownLocalClis();
const installed = discovered.filter((candidate) => candidate.available);
const profileSpecs = installed.flatMap((candidate) => {
  const profile = localCliRuntimeSpec(candidate.executable, workspaceCwd);
  return profile === undefined ? [] : [profile];
});
if (profileSpecs.length === 0) {
  throw new Error(
    "No supported local Agent CLI was found. Install Codex, Kimi, OpenCode, or Claude Code and restart.",
  );
}

const directory = mkdtempSync(join(tmpdir(), "rah-os-local-cli-web-"));
chmodSync(directory, 0o700);
const stateDirectory = join(directory, "state");
mkdirSync(stateDirectory, { mode: 0o700 });
const databasePath = join(stateDirectory, "room.db");
const registryDatabasePath = join(stateDirectory, "runtime-registry.db");
const secretPath = join(stateDirectory, "host.token");
const hostId = `local-cli-web-host-${String(process.pid)}`;

let application;
let running;
let seed;
let shutdown;
let webProcess;

try {
  seed = new RoomKernel({ databasePath });
  seed.initialize();
  const human = seed.provisionPrincipal({ handle: "sun", kind: "human" });
  const humanActor = seed.authenticateAccessToken(human.accessToken);
  const productWorkspace = seed.createWorkspace(humanActor, {
    idempotencyKey: "local-cli-web-workspace",
    name: "RAH Local Workstation",
    slug: "rah-local-workstation",
  });
  const productRoom = seed.createWorkspaceRoom(humanActor, {
    basedOnControlRoomSeq: productWorkspace.event.roomSeq,
    idempotencyKey: "local-cli-web-room",
    kind: "channel",
    name: "Agent Council",
    slug: "agent-council",
    workspaceId: productWorkspace.workspace.workspaceId,
  });
  const catalogRoom = productWorkspace.controlRoom;

  const participants = [];
  const runtimeDefinitions = [];
  for (const [index, spec] of profileSpecs.entries()) {
    const agent = seed.provisionPrincipal({
      handle: spec.agentHandle,
      kind: "agent",
    });
    participants.push(agent.principal.principalId);
    seed.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: catalogRoom.roomId,
    });
    const runtimeOfferId = `local-cli-offer-${spec.cliId}`;
    const policy = seed.createExecutionPolicy(humanActor, {
      basedOnRoomSeq: latestRoomSeq(seed, humanActor, catalogRoom.roomId),
      controlRoomId: catalogRoom.roomId,
      idempotencyKey: `local-cli-policy-${spec.cliId}`,
      modelIntent: {
        fallback: "disabled",
        reasoning: spec.reasoning,
        serviceTier: "default",
      },
      preferred: [],
      required: {
        allowedOfferIds: [runtimeOfferId],
        allowedProtocolFamilies: ["rah-worker-process/v1"],
        capabilities: [],
        minimumIsolation: "none",
        workspaceMode: "in_place",
      },
      retryPolicyRef: {
        artifactId: `local-cli-retry-${spec.cliId}`,
        contentDigest: `sha256:${String(index + 1).repeat(64)}`,
        versionId: `local-cli-retry-${spec.cliId}-v1`,
      },
      sessionPolicy: "fresh",
    }).policy;
    const definition = seed.createAgentDefinition(humanActor, {
      basedOnRoomSeq: latestRoomSeq(seed, humanActor, catalogRoom.roomId),
      controlRoomId: catalogRoom.roomId,
      executionPolicyRevisionId: policy.executionPolicyRevisionId,
      idempotencyKey: `local-cli-definition-${spec.cliId}`,
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: `local-cli-memory-${spec.cliId}`,
        contentDigest: `sha256:${String(index + 5).repeat(64)}`,
        versionId: `local-cli-memory-${spec.cliId}-v1`,
      },
      participantId: agent.principal.principalId,
      role: spec.role,
      skillRefs: [],
    });
    runtimeDefinitions.push({
      agentId: definition.definition.agentId,
      runtimeOfferId,
      spec,
    });
  }

  const credential = seed.provisionHostCredential({
    hostId,
    participantIds: participants,
  });
  writeFileSync(secretPath, `${credential.accessToken}\n`, { mode: 0o600 });

  const registry = new RuntimeProfileRegistry({
    databasePath: registryDatabasePath,
    hostId,
  });
  registry.initialize();
  const implementations = new RuntimeImplementationRegistry();
  for (const { spec } of runtimeDefinitions) {
    const sharedManifest = {
      adapter: {
        config: {
          diagnosticByteLimit: 262_144,
          terminationGraceMs: 5_000,
        },
        executable: spec.executable,
        fixedArgs: [],
        kind: spec.adapterKind,
      },
      credentialSlots: [],
      declaredCapabilities: ["worker_commands"],
      displayName: spec.displayName,
      protocolFamily: "rah-worker-process/v1",
      recoveryDrivers:
        process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
      runtimeProfileId: spec.runtimeProfileId,
      staticEnv: {},
      workspacePolicy: { allowedModes: ["in_place"] },
    };
    const revision = registry.importManifest(
      spec.modelCatalogProbe === undefined
        ? { ...sharedManifest, manifestVersion: 2 }
        : {
            ...sharedManifest,
            manifestVersion: 3,
            modelCatalogProbe: spec.modelCatalogProbe,
          },
    );
    const probe = registry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: workspaceCwd }),
    );
    if (!probe.available) {
      throw new Error(
        `${spec.displayName} failed executable probe: ${probe.failureCode ?? "unavailable"}`,
      );
    }
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
      maxConcurrent: profileSpecs.length,
      participantIds: participants,
    },
    hostStaleAfterMs: 60_000,
    leaseMs: 60_000,
    leaseRenewIntervalMs: 20_000,
    outboxLeaseMs: 5_000,
    outboxPollIntervalMs: 100,
    outboxRetryAfterMs: 1_000,
    pollIntervalMs: 250,
    retryAfterMs: 5_000,
    runTimeoutMs: 30 * 60_000,
    runtimeCancelTimeoutMs: 20_000,
    runtimeRecoveryTimeoutMs: 60_000,
    runtimeStartTimeoutMs: 30_000,
    runtimes: runtimeDefinitions.map(({ runtimeOfferId, spec }) => ({
      credentialBindings: {},
      kind: "runtime-profile-registry",
      offer: {
        leaseMs: 120_000,
        maxConcurrent: 1,
        refreshIntervalMs: 30_000,
        runtimeOfferId,
      },
      registryDatabasePath,
      runtimeProfileId: spec.runtimeProfileId,
    })),
    schemaVersion: 4,
    stateDirectory,
    // Channel homes stay inside the temporary state, never in ~/.loom.
    channelWorkspaceRoot: join(stateDirectory, "channel-workspaces"),
    taskClaimHeartbeatIntervalMs: 5 * 60_000,
    taskClaimLeaseMs: 15 * 60_000,
    workspace: {
      cwd: workspaceCwd,
      mode: "in_place",
      workspaceDefinitionId: productWorkspace.workspace.workspaceId,
      workspaceMountDigest: `sha256:${"a".repeat(64)}`,
      workspaceMountRevisionId: "local-cli-workspace-mount-v1",
    },
  });
  application = new DaemonApplication({ config });
  shutdown = new AbortController();
  running = application.run({ signal: shutdown.signal });
  await waitUntil(() => application.clientOrigin() !== undefined, 10_000);
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
    `RAH_LOCAL_CLI_FIXTURE ${JSON.stringify({
      daemonOrigin: application.clientOrigin(),
      lanOrigins,
      listenHost: webHost,
      roomId: productRoom.room.roomId,
      runtimes: profileSpecs.map(({ cliId, displayName }) => ({
        cliId,
        displayName,
      })),
      webOrigin: `http://127.0.0.1:${String(webPort)}`,
      workspaceCwd,
      workspaceId: productWorkspace.workspace.workspaceId,
    })}\n`,
  );
  await waitForShutdownSignal();
} finally {
  if (webProcess?.exitCode === null) {
    webProcess.kill("SIGTERM");
    await Promise.race([
      new Promise((resolvePromise) => webProcess.once("exit", resolvePromise)),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000)),
    ]);
  }
  shutdown?.abort("local-cli-web-fixture-shutdown");
  await running?.catch(() => undefined);
  try {
    seed?.close();
  } catch {
    // Seed may already be closed after daemon composition starts.
  }
  rmSync(directory, { force: true, recursive: true });
}

function latestRoomSeq(kernel, actor, roomId) {
  return kernel.sync(actor, {
    consumerId: `local-cli-fixture-cursor-${roomId}`,
    roomId,
  }).latestRoomSeq;
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("fixture startup timed out");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
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
    if (Date.now() >= deadline) {
      throw new Error("Web fixture startup timed out");
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
}

async function waitForShutdownSignal() {
  await new Promise((resolvePromise) => {
    const finish = () => resolvePromise();
    process.on("SIGINT", finish);
    process.on("SIGTERM", finish);
  });
}
