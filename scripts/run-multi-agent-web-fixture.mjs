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
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import { DaemonApplication, DaemonConfigSchema } from "@rah-os/daemon";
import { RoomKernel } from "@rah-os/kernel";
import { agentMemoryWorkspacePath } from "../packages/agent-host/src/agent-memory-workspace.ts";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = join(scriptDirectory, "..");
const fakeCliPath = join(
  scriptDirectory,
  "../packages/agent-host/test/fixtures/fake-cli.mjs",
);
const directory = mkdtempSync(join(tmpdir(), "rah-os-multi-agent-web-"));
chmodSync(directory, 0o700);
const stateDirectory = join(directory, "state");
const keepState = process.env.RAH_FIXTURE_KEEP_STATE === "1";
mkdirSync(stateDirectory, { mode: 0o700 });
const fakeCatalogCliPath = join(stateDirectory, "fake-cli-with-catalog.mjs");
const databasePath = join(stateDirectory, "room.db");
const registryDatabasePath = join(stateDirectory, "runtime-registry.db");
const secretPath = join(stateDirectory, "host.token");
const hostId =
  process.env.RAH_FIXTURE_HOST_ID?.trim() || "web-multi-agent-host";
if (/\s/u.test(hostId)) {
  throw new Error("RAH_FIXTURE_HOST_ID must not contain whitespace");
}
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
const historyMessageCount = Number(
  process.env.RAH_FIXTURE_HISTORY_MESSAGES ?? "0",
);
if (
  !Number.isInteger(historyMessageCount) ||
  historyMessageCount < 0 ||
  historyMessageCount > 10_000
) {
  throw new Error(
    "RAH_FIXTURE_HISTORY_MESSAGES must be an integer between 0 and 10000",
  );
}
const savedMessageCount = Number(process.env.RAH_FIXTURE_SAVED_MESSAGES ?? "0");
if (
  !Number.isInteger(savedMessageCount) ||
  savedMessageCount < 0 ||
  savedMessageCount > 25
) {
  throw new Error("RAH_FIXTURE_SAVED_MESSAGES must be between 0 and 25");
}
const onboardAgentCount = Number(
  process.env.RAH_FIXTURE_ONBOARD_AGENT_COUNT ?? "1",
);
if (
  !Number.isInteger(onboardAgentCount) ||
  onboardAgentCount < 1 ||
  onboardAgentCount > 2
) {
  throw new Error("RAH_FIXTURE_ONBOARD_AGENT_COUNT must be 1 or 2");
}
const seedTaskMatrix = process.env.RAH_FIXTURE_TASK_MATRIX === "1";

let application;
let running;
let seed;
let shutdown;
let webProcess;

try {
  writeFileSync(
    fakeCatalogCliPath,
    `#!/usr/bin/env node
const command = process.argv.slice(2).join(" ");
if (command === "debug models" || command === "debug models --bundled") {
  process.stdout.write(JSON.stringify({
    models: [
      {
        default_reasoning_level: "low",
        display_name: "Fixture Alpha",
        service_tiers: [],
        slug: "fixture-alpha",
        supported_in_api: true,
        supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
        visibility: "list",
      },
      {
        default_reasoning_level: "high",
        display_name: "Fixture Beta",
        service_tiers: [],
        slug: "fixture-beta",
        supported_in_api: true,
        supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
        visibility: "list",
      },
    ],
  }));
} else {
  if (process.env.RAH_FIXTURE_EXECUTION_PROBE_DIRECTORY) {
    const {writeFile, access, readFile, rename} = await import("node:fs/promises");
    const {join} = await import("node:path");
    const root = process.env.RAH_FIXTURE_EXECUTION_PROBE_DIRECTORY;
    const agent = JSON.parse(process.env.RAH_AGENT_CONTEXT_JSON);
    await writeFile(join(root, process.env.RAH_RUN_ATTEMPT_ID + ".pending"), JSON.stringify({
      agent, argv: process.argv.slice(2), cwd: process.cwd(),
      memoryDirectory: process.env.RAH_AGENT_MEMORY_DIR,
      probeNote: await readFile(join(process.env.RAH_AGENT_MEMORY_DIR, "notes", "runtime-continuity-probe.txt"), "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; }),
      profile: process.env.RAH_FIXTURE_PROFILE_MARKER,
      runAttemptId: process.env.RAH_RUN_ATTEMPT_ID,
    }));
    await rename(join(root, process.env.RAH_RUN_ATTEMPT_ID + ".pending"), join(root, process.env.RAH_RUN_ATTEMPT_ID + ".json"));
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try { await access(join(root, "release")); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await access(join(root, "release")); // timeout must fail, never silently release
    await writeFile(join(root, process.env.RAH_RUN_ATTEMPT_ID + ".continued"), "original process continued");
  }
  await import(${JSON.stringify(pathToFileURL(fakeCliPath).href)});
}
`,
    { mode: 0o700 },
  );
  chmodSync(fakeCatalogCliPath, 0o700);
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
  const taskMatrixRoom = seedTaskMatrix
    ? seed.createWorkspaceRoom(humanActor, {
        basedOnControlRoomSeq: latestRoomSeq(
          seed,
          humanActor,
          productWorkspace.controlRoom.roomId,
        ),
        idempotencyKey: "web-task-page-room",
        kind: "channel",
        name: "Task Matrix",
        slug: "task-matrix",
        workspaceId: productWorkspace.workspace.workspaceId,
      })
    : undefined;

  for (let index = 1; index <= historyMessageCount; index += 1) {
    seed.postMessage(humanActor, {
      basedOnRoomSeq: latestRoomSeq(seed, humanActor, productRoom.room.roomId),
      body: `History fixture ${String(index).padStart(3, "0")}`,
      idempotencyKey: `web-history-fixture-${String(index)}`,
      recipients: [],
      roomId: productRoom.room.roomId,
    });
  }
  if (savedMessageCount > 0) {
    seed.updateAuthenticatedPrincipal(humanActor, {
      avatarKey: "portrait_01",
      displayName: "Sun Fixture",
    });
    for (let index = 1; index <= savedMessageCount; index += 1) {
      const message = seed.postRoomMessage(humanActor, {
        basedOnRoomSeq: latestRoomSeq(
          seed,
          humanActor,
          productRoom.room.roomId,
        ),
        body: `Saved fixture ${String(index)} with **Markdown**`,
        idempotencyKey: `web-saved-fixture-message-${String(index)}`,
        roomId: productRoom.room.roomId,
      });
      seed.messageSocial.save(humanActor, {
        idempotencyKey: `web-saved-fixture-save-${String(index)}`,
        messageId: message.event.aggregateId,
        roomId: productRoom.room.roomId,
        saved: true,
      });
    }
  }

  const agents = ["Alice", "Kimi"].map((handle) =>
    seed.provisionPrincipal({ handle, kind: "agent" }),
  );
  const catalogRoom = productWorkspace.controlRoom;
  if (process.env.RAH_FIXTURE_WORKSPACE_FILES === "1") {
    for (const agent of agents) {
      const home = agentMemoryWorkspacePath(
        join(stateDirectory, "supervisors", "agent-memory"),
        agent.principal.principalId,
      );
      mkdirSync(join(home, "notes"), { recursive: true, mode: 0o700 });
      writeFileSync(
        join(home, "MEMORY.md"),
        `# ${agent.principal.handle}\n- [Guide](notes/guide.md)\n`,
        { mode: 0o600 },
      );
      writeFileSync(
        join(home, "notes", "guide.md"),
        `${agent.principal.handle} private fixture note. Not a real Agent memory acceptance.\n`,
        { mode: 0o600 },
      );
      writeFileSync(join(home, ".settings"), "hidden fixture, no credentials", {
        mode: 0o600,
      });
      writeFileSync(
        join(home, "preview.html"),
        "<script>window.__workspaceUnsafe = true</script>",
        { mode: 0o600 },
      );
    }
  }
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
    agentDefinitionIds.push(definition.definition.agentId);
  }

  let roomSeq = latestRoomSeq(seed, humanActor, productRoom.room.roomId);
  for (const [index, agentId] of agentDefinitionIds
    .slice(0, onboardAgentCount)
    .entries()) {
    const onboarded = seed.onboardAgentToRoom(humanActor, {
      agentId,
      basedOnRoomSeq: roomSeq,
      idempotencyKey: `web-multi-agent-onboard-${String(index)}`,
      roomId: productRoom.room.roomId,
    });
    roomSeq = onboarded.event.roomSeq;
  }

  if (seedTaskMatrix) {
    seedTaskPageFixture(seed, humanActor, taskMatrixRoom.room.roomId);
    if (process.env.RAH_FIXTURE_TASK_ASSIGNMENT === "1") {
      for (const agent of agents)
        seed.addMember(humanActor, {
          principalId: agent.principal.principalId,
          roomId: taskMatrixRoom.room.roomId,
        });
    }
  }

  if (process.env.RAH_FIXTURE_UNREAD_MATRIX === "1")
    (await import("./unread-matrix-fixture.mjs")).seedUnreadMatrix(
      seed,
      humanActor,
      productWorkspace,
      agents,
    );
  if (process.env.RAH_FIXTURE_TASK_IDENTITY === "1") {
    const roomId = taskMatrixRoom.room.roomId;
    seed.addMember(humanActor, {
      principalId: agents[0].principal.principalId,
      roomId,
    });
    const task = seed.createTask(humanActor, {
      roomId,
      title: "FAKE historical identity task",
      idempotencyKey: "identity-task",
      assigneeId: agents[0].principal.principalId,
    }).task;
    seed.postMessage(seed.authenticateAccessToken(agents[0].accessToken), {
      roomId,
      threadId: task.threadId,
      body: "FAKE historical Agent reply",
      recipients: [],
      basedOnRoomSeq: latestRoomSeq(seed, humanActor, roomId),
      idempotencyKey: "identity-reply",
    });
  }
  seed.postMessage(humanActor, {
    basedOnRoomSeq: roomSeq,
    body: [
      "**Markdown gate**",
      "",
      "- canonical list item",
      "- inline `Room → Agent` flow",
      "",
      "| Surface | Owner |",
      "| --- | --- |",
      "| Message | Kernel |",
      "",
      "Formula: $E = mc^2$",
      "",
      "```ts",
      "const canonical = true;",
      "```",
      "",
      "[Raft reference](https://app.raft.build)",
      "[Local file](file:///tmp/rah-markdown-gate.ts)",
      "![RAH icon](/rah-app-icon.svg)",
      "",
      "```mermaid",
      "graph LR",
      "  Room --> Agent",
      "```",
      "",
      '<script data-markdown-attack="true">globalThis.__rahMarkdownAttack = true</script>',
    ].join("\n"),
    idempotencyKey: "web-multi-agent-markdown-message",
    recipients: [],
    roomId: productRoom.room.roomId,
  });

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
        executable: fakeCatalogCliPath,
        fixedArgs: [],
        kind: "generic-process/v1",
      },
      credentialSlots: [],
      declaredCapabilities: ["worker_commands"],
      displayName: `Web multi-Agent fixture ${String(index)}`,
      manifestVersion: 3,
      modelCatalogProbe: { kind: "codex-cli/v1" },
      protocolFamily: "rah-worker-process/v1",
      recoveryDrivers: ["rah-process-supervisor-v1"],
      runtimeProfileId,
      staticEnv: {
        ...(process.env.RAH_FIXTURE_EXECUTION_PROBE_DIRECTORY
          ? {
              RAH_FIXTURE_EXECUTION_PROBE_DIRECTORY:
                process.env.RAH_FIXTURE_EXECUTION_PROBE_DIRECTORY,
              RAH_FIXTURE_PROFILE_MARKER: runtimeProfileId,
            }
          : {}),
        ...(process.env.RAH_FIXTURE_PRESENCE_PROBE === "1"
          ? { RAH_FAKE_PRESENCE_PROBE: "1" }
          : {}),
        RAH_FAKE_MESSAGE_TOOLS: process.env.RAH_FIXTURE_MESSAGE_TOOLS ?? "0",
        RAH_FAKE_AUTO_TASK_MARKER: "[TASK]",
        RAH_FAKE_TASK_ARTIFACT: "1",
        ...(index === 0
          ? {
              RAH_FAKE_REVIEW_FIRST_SUBMISSION: "changes_requested",
              RAH_FAKE_TASK_HOLD_MARKER: "[REASSIGN]",
              RAH_FAKE_TASK_HOLD_MS: "20000",
            }
          : {}),
        RAH_FAKE_MODE:
          process.env.RAH_FIXTURE_FIRST_AGENT_INPUT === "1" && index === 0
            ? "worker-task-input"
            : "worker-task",
        RAH_FAKE_ROOM_REPLY_MODE:
          process.env.RAH_FIXTURE_ROOM_REPLY_MODE ?? "contextual-demo",
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
  if (process.env.RAH_FIXTURE_HUMAN_MATRIX === "1") {
    const { seedHumanMembershipFixture } =
      await import("./human-membership-fixture.mjs");
    seedHumanMembershipFixture(
      seed,
      humanActor,
      productWorkspace,
      productRoom.room.roomId,
    );
  }
  seed.close();
  seed = undefined;

  if (process.env.RAH_FIXTURE_COMPOSER_FILES === "1") {
    mkdirSync(join(directory, "reference-files", "Folder with spaces"), {
      recursive: true,
    });
    writeFileSync(
      join(directory, "reference-files", "Folder with spaces", "note.txt"),
      "FAKE reference: this text must not be uploaded",
    );
    writeFileSync(
      join(
        directory,
        "reference-files",
        "Folder with spaces",
        "second note.txt",
      ),
      "FAKE second reference: this text must not be uploaded",
    );
  }
  const config = DaemonConfigSchema.parse({
    ...(process.env.RAH_FIXTURE_COMPOSER_FILES === "1"
      ? { fileReferenceRoots: [join(directory, "reference-files")] }
      : {}),
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
    runTimeoutMs:
      process.env.RAH_FIXTURE_PRESENCE_PROBE === "1" ? 120_000 : 30_000,
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
    // Channel homes stay inside the temporary state, never in ~/.loom.
    channelWorkspaceRoot: join(stateDirectory, "channel-workspaces"),
    taskClaimHeartbeatIntervalMs: 10_000,
    taskClaimLeaseMs: 30_000,
    workspace: {
      cwd: stateDirectory,
      mode: "in_place",
      workspaceDefinitionId: productWorkspace.workspace.workspaceId,
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
      ...(keepState ? { stateDirectory } : {}),
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
  if (keepState) {
    process.stderr.write(`RAH_FIXTURE_STATE_PRESERVED ${stateDirectory}\n`);
  } else {
    rmSync(directory, { force: true, recursive: true });
  }
}

function latestRoomSeq(kernel, actor, roomId) {
  return kernel.sync(actor, {
    consumerId: `fixture-cursor-${roomId}`,
    roomId,
  }).latestRoomSeq;
}

// Browser fixtures must exercise the real Task projection and lifecycle. Keep
// the sample deterministic and use only public Kernel commands: editing the
// SQLite projection here would let a broken canonical transition pass the UI
// gate.
function seedTaskPageFixture(kernel, actor, roomId) {
  // Opt-in assignment UI fixture: an unfinished dependency keeps the assignee
  // idle so the test never races a Fake CLI claim. Existing gates keep the old seed.
  const dependency =
    process.env.RAH_FIXTURE_TASK_ASSIGNMENT === "1"
      ? kernel.createTask(actor, {
          idempotencyKey: "web-task-assignment-dependency",
          roomId,
          title: "Assignment fixture prerequisite",
        }).task.taskId
      : undefined;
  const open = kernel.createTask(actor, {
    ...(dependency === undefined ? {} : { dependencyTaskIds: [dependency] }),
    idempotencyKey: "web-task-page-open",
    roomId,
    title:
      "Keep the Room-first delivery contract stable across a deliberately long Task title",
  });
  const closed = kernel.createTask(actor, {
    idempotencyKey: "web-task-page-closed",
    roomId,
    title: "Closed fixture preserved by canonical Task truth",
  });
  kernel.updateTaskWorkflowStatus(actor, {
    basedOnRoomSeq: latestRoomSeq(kernel, actor, roomId),
    idempotencyKey: "web-task-page-close",
    taskId: closed.task.taskId,
    workflowStatus: "closed",
  });
  return { closed, open };
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
