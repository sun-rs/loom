import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

import {
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import {
  DaemonApplication,
  DaemonConfigSchema,
  discoverKnownLocalClis,
} from "@rah-os/daemon";
import { RoomKernel } from "@rah-os/kernel";

const workspaceCwd = resolve(process.env.RAH_WORKSPACE_CWD ?? process.cwd());
const discovered = await discoverKnownLocalClis();
const installed = discovered.filter((candidate) => candidate.available);
const profileSpecs = installed.flatMap((candidate) => {
  const profile = localCliProfile(candidate.executable, workspaceCwd);
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
const hostId = "local-cli-web-host";

let application;
let running;
let seed;
let shutdown;

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
  const catalogWorkspace = seed.createWorkspace(humanActor, {
    idempotencyKey: "local-cli-web-catalog",
    name: "Agent Catalog",
    slug: "agent-catalog",
  });
  const catalogRoom = catalogWorkspace.controlRoom;

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
      agentDefinitionId: definition.definition.agentDefinitionId,
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
    const revision = registry.importManifest({
      adapter: {
        config: {
          diagnosticByteLimit: 262_144,
          terminationGraceMs: 5_000,
        },
        executable: spec.executable,
        fixedArgs: spec.args,
        kind: "generic-process/v1",
      },
      credentialSlots: [],
      declaredCapabilities: ["worker_commands"],
      displayName: spec.displayName,
      manifestVersion: 2,
      protocolFamily: "rah-worker-process/v1",
      recoveryDrivers:
        process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
      runtimeProfileId: spec.runtimeProfileId,
      staticEnv: {},
      workspacePolicy: { allowedModes: ["in_place"] },
    });
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
    taskClaimHeartbeatIntervalMs: 5 * 60_000,
    taskClaimLeaseMs: 15 * 60_000,
    workspace: {
      cwd: workspaceCwd,
      mode: "in_place",
      workspaceDefinitionId: "local-cli-workspace-definition",
      workspaceMountDigest: `sha256:${"a".repeat(64)}`,
      workspaceMountRevisionId: "local-cli-workspace-mount-v1",
    },
  });
  application = new DaemonApplication({ config });
  shutdown = new AbortController();
  running = application.run({ signal: shutdown.signal });
  await waitUntil(() => application.clientOrigin() !== undefined, 10_000);
  process.stdout.write(
    `RAH_LOCAL_CLI_FIXTURE ${JSON.stringify({
      daemonOrigin: application.clientOrigin(),
      humanAccessToken: human.accessToken,
      roomId: productRoom.room.roomId,
      runtimes: profileSpecs.map(({ cliId, displayName }) => ({
        cliId,
        displayName,
      })),
      workspaceCwd,
      workspaceId: productWorkspace.workspace.workspaceId,
    })}\n`,
  );
  await waitForShutdownSignal();
} finally {
  shutdown?.abort("local-cli-web-fixture-shutdown");
  await running?.catch(() => undefined);
  try {
    seed?.close();
  } catch {
    // Seed may already be closed after daemon composition starts.
  }
  rmSync(directory, { force: true, recursive: true });
}

function localCliProfile(executable, currentWorkspaceCwd) {
  if (executable === "claude") {
    return {
      agentHandle: "Claude",
      args: [
        "--print",
        "--safe-mode",
        "--no-session-persistence",
        "--dangerously-skip-permissions",
        "--model",
        "claude-sonnet-5",
        "--effort",
        "low",
        workerPrompt(),
      ],
      cliId: "claude",
      displayName: "Claude Code · Sonnet 5 / low",
      executable,
      reasoning: "low",
      role: "Claude Code Agent using the local account",
      runtimeProfileId: "local-cli-profile-claude",
    };
  }
  if (executable === "codex") {
    return {
      agentHandle: "Codex",
      args: [
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "danger-full-access",
        "--cd",
        currentWorkspaceCwd,
        workerPrompt(),
      ],
      cliId: "codex",
      displayName: "Codex · local account default",
      executable,
      reasoning: "default",
      role: "Codex Agent using the local account and model settings",
      runtimeProfileId: "local-cli-profile-codex",
    };
  }
  if (executable === "kimi") {
    return {
      agentHandle: "Kimi",
      args: ["--output-format", "text", "--prompt", workerPrompt()],
      cliId: "kimi",
      displayName: "Kimi CLI · local account default",
      executable,
      reasoning: "default",
      role: "Kimi CLI Agent using the local Coding Plan settings",
      runtimeProfileId: "local-cli-profile-kimi",
    };
  }
  if (executable === "opencode") {
    return {
      agentHandle: "OpenCode",
      args: [
        "run",
        "--auto",
        "--pure",
        "--dir",
        currentWorkspaceCwd,
        workerPrompt(),
      ],
      cliId: "opencode",
      displayName: "OpenCode · configured provider/model",
      executable,
      reasoning: "default",
      role: "OpenCode Agent using the configured provider and model",
      runtimeProfileId: "local-cli-profile-opencode",
    };
  }
  return undefined;
}

function workerPrompt() {
  return `You are a RAH OS Room worker launched for one durable Activation.
Treat only the RAH Worker API as collaboration truth. Never expose its bearer token.
First use a local shell command with Node.js built-in fetch to POST {} to process.env.RAH_WORKER_API_URL + "/v1/worker/sync" with Authorization "Bearer " + process.env.RAH_WORKER_TOKEN and Content-Type application/json. Parse and inspect every delivered canonical Room event through process.env.RAH_TO_SEQ.

For a human message, understand it in the delivered Room context, do the requested coding or analysis work in the current workspace when appropriate, then POST one concise useful response to "/v1/worker/messages/post" using {body,idempotencyKey:"reply:"+process.env.RAH_ACTIVATION_ID,basedOnRoomSeq}. The server owns your Agent identity, Room, Activation, and recipients.

For a task.created event, query "/v1/worker/tasks/get" with {taskId}. If it is open, atomically call claim then start with unique stable idempotency keys based on taskId. If claim loses with a conflict, do not duplicate the work. If claim succeeds, perform the requested work, then call progress and submit with honest evidence. Use each returned event.roomSeq as the next basedOnRoomSeq.

Finally POST {throughSeq: the original sync cursorAfter} to "/v1/worker/acknowledge". CLI prose, transcript, exit code, and provider session are diagnostics only; never infer or mutate Room state from them.`;
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

async function waitForShutdownSignal() {
  await new Promise((resolvePromise) => {
    const finish = () => resolvePromise();
    process.on("SIGINT", finish);
    process.on("SIGTERM", finish);
  });
}
