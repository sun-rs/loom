import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AgentMemoryCoordinator,
  GenericProcessAdapter,
  ManagedMcpRuntimeProxyRegistry,
  RuntimeCredentialEnvironmentBinding,
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
  readAgentMemoryMaterializationReceipt,
} from "@rah-os/agent-host";
import type { WorkerApplicationService } from "@rah-os/application-service";
import { RoomKernel } from "@rah-os/kernel";
import type {
  AgentRuntimeContext,
  RuntimeProfileManifestV2,
} from "@rah-os/protocol";

import { createConfiguredRuntime } from "../src/runtime-profile-composition.ts";
import { localWorkbenchWorkerPrompt } from "../src/local-cli-runtime-spec.ts";

const memoryMarker = "continuity-marker-from-room-alpha";
const noteMarker = "private-note-from-first-runtime";
const childScript = `
const { readFile, writeFile } = await import("node:fs/promises");
const { join } = await import("node:path");
const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const { createHash } = await import("node:crypto");

const memoryDirectory = process.env.RAH_AGENT_MEMORY_DIR;
const memoryIndexPath = process.env.RAH_AGENT_MEMORY_INDEX;
if (!memoryDirectory || !memoryIndexPath) {
  throw new Error("Agent memory environment is missing");
}
const notePath = join(memoryDirectory, "notes", "continuity.md");
const readIfPresent = async (path) => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
};

if (process.env.TEST_MEMORY_OPERATION === "write") {
  await writeFile(
    memoryIndexPath,
    "# Persistent Agent\\n\\n## Key Knowledge\\n- ${memoryMarker}\\n\\n## Active Context\\n- Room alpha complete.\\n\\n" + "x".repeat(65_536),
    { mode: 0o600 },
  );
  await writeFile(notePath, "${noteMarker}\\n", { mode: 0o600 });
}

process.stdout.write(JSON.stringify({
  appInboxLive: process.env.RAH_AGENT_INBOX_CLI ? JSON.parse((await promisify(execFile)(process.env.RAH_AGENT_INBOX_CLI, ["agent", "inbox", "recheck"], {env: process.env})).stdout) : null,
  appInbox: process.env.RAH_AGENT_APP_INBOX_JSON,
  bootstrap: process.env.RAH_AGENT_MEMORY_BOOTSTRAP_JSON,
  memory: await readFile(memoryIndexPath, "utf8"),
  memoryDirectory,
  memoryIndexPath,
  modelMarker: process.env.TEST_MODEL_MARKER,
  note: await readIfPresent(notePath),
  operation: process.env.TEST_MEMORY_OPERATION,
  promptDigest: createHash("sha256").update(process.argv[1]).digest("hex"),
  roomId: process.env.RAH_ROOM_ID,
  source: process.env.RAH_AGENT_MEMORY_SOURCE_FILE ? JSON.parse(await readFile(process.env.RAH_AGENT_MEMORY_SOURCE_FILE, "utf8")).source : null,
}));
`;

function manifest(input: {
  modelMarker: string;
  operation: "read" | "write";
  runtimeProfileId: string;
}): RuntimeProfileManifestV2 {
  return {
    adapter: {
      config: { diagnosticByteLimit: 262_144, terminationGraceMs: 1_000 },
      executable: process.execPath,
      fixedArgs: [
        "--input-type=module",
        "-e",
        childScript,
        localWorkbenchWorkerPrompt(),
      ],
      kind: "generic-process/v1",
    },
    credentialSlots: [],
    declaredCapabilities: ["worker_commands"],
    displayName: `${input.runtimeProfileId} fixture`,
    manifestVersion: 2,
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers:
      process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
    runtimeProfileId: input.runtimeProfileId,
    staticEnv: {
      TEST_MEMORY_OPERATION: input.operation,
      TEST_MODEL_MARKER: input.modelMarker,
    },
    workspacePolicy: { allowedModes: ["in_place"] },
  };
}

function agentContext(input: {
  displayName: string;
  participantId: string;
  revision: number;
  role: string;
}): AgentRuntimeContext {
  return {
    agentDefinitionRevision: {
      agentDefinitionId: `agent-definition-${input.participantId}`,
      agentDefinitionRevisionId: `agent-revision-${input.participantId}-v${String(input.revision)}`,
      contentDigest: `sha256:${String(input.revision).repeat(64)}`,
      createdAt: "2026-08-30T09:00:00.000+08:00",
      createdBy: "human-owner",
      displayName: input.displayName,
      executionPolicyRevisionId: "execution-full-access-v1",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: `memory-policy-${input.participantId}`,
        contentDigest: `sha256:${String(input.revision + 4).repeat(64)}`,
        versionId: "memory-policy-v1",
      },
      revision: input.revision,
      role: input.role,
      skillRefs: [],
    },
    handle: input.displayName.toLowerCase().replaceAll(" ", "-"),
    participantId: input.participantId,
    schemaVersion: 1,
  };
}

test("Agent memory survives Room, Runtime/Profile and daemon-side registry changes while remaining Agent-scoped", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-memory-continuity-"));
  const databasePath = join(directory, "room.db");
  const registryPath = join(directory, "runtime-registry.db");
  const supervisorDirectory = join(directory, "supervisors");
  const secondCwd = join(directory, "another-checkout");
  const hostId = "memory-continuity-host";
  const kernel = new RoomKernel({ databasePath });
  const proxyRegistry = new ManagedMcpRuntimeProxyRegistry();
  const memoryCoordinator = new AgentMemoryCoordinator({
    rootDirectory: join(supervisorDirectory, "agent-memory"),
    wake: () => false,
  });
  let profileRegistry: RuntimeProfileRegistry | undefined;
  let issuedCredentials = 0;

  try {
    const memoryRoot = join(supervisorDirectory, "agent-memory");
    await mkdir(memoryRoot, { recursive: true, mode: 0o700 });
    await mkdir(secondCwd);
    await writeFile(
      join(memoryRoot, ".project-bindings.json"),
      JSON.stringify({
        schemaVersion: 1,
        projects: [
          {
            key: "product",
            label: "Product",
            roots: [directory, secondCwd],
            relatedKeys: [],
          },
        ],
      }),
      { mode: 0o600 },
    );
    kernel.initialize();
    const agentA = kernel.provisionPrincipal({
      handle: "persistent-agent",
      kind: "agent",
    });
    const agentB = kernel.provisionPrincipal({
      handle: "isolated-agent",
      kind: "agent",
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId,
        participantIds: [
          agentA.principal.principalId,
          agentB.principal.principalId,
        ],
      }).accessToken,
    );
    const workerService = {
      issueActivationCredential: () => {
        issuedCredentials += 1;
        return {
          accessToken: `rah_wat_memory_continuity_${String(issuedCredentials).padStart(4, "0")}_0123456789`,
          expiresAt: "2099-01-01T00:00:00.000Z",
          revoke: () => undefined,
        };
      },
      origin: "http://127.0.0.1:1",
    } as unknown as WorkerApplicationService;

    const openRegistry = (): RuntimeProfileRegistry => {
      const registry = new RuntimeProfileRegistry({
        databasePath: registryPath,
        hostId,
      });
      registry.initialize();
      return registry;
    };

    profileRegistry = openRegistry();
    const firstImplementations = new RuntimeImplementationRegistry();
    const writerRevision = profileRegistry.importManifest(
      manifest({
        modelMarker: "provider-a/model-small",
        operation: "write",
        runtimeProfileId: "memory-writer-runtime",
      }),
    );
    const writerProbe = profileRegistry.recordProbeReport(
      await firstImplementations.probeRevision(writerRevision, {
        cwd: directory,
      }),
    );
    const activeWriter = profileRegistry.activateRevision({
      contentDigest: writerRevision.contentDigest,
      runtimeProfileRevisionId: writerRevision.runtimeProfileRevisionId,
    });

    const runRuntime = async (input: {
      agent: AgentRuntimeContext;
      implementations: RuntimeImplementationRegistry;
      ordinal: number;
      probeReport: typeof writerProbe;
      registry: RuntimeProfileRegistry;
      revision: typeof activeWriter;
      roomId: string;
      withoutCoordinator?: boolean;
      executionCwd?: string;
    }) => {
      const runtime = createConfiguredRuntime({
        ...(input.withoutCoordinator
          ? {}
          : { agentMemoryCoordinator: memoryCoordinator }),
        credentialEnvironment: new RuntimeCredentialEnvironmentBinding({
          manifest: input.revision.manifest,
          resolvers: {},
        }),
        cwd: input.executionCwd ?? directory,
        host,
        implementations: input.implementations,
        managedMcpProxyRegistry: proxyRegistry,
        probeReport: input.probeReport,
        runtimeProfileRegistry: input.registry,
        runtimeProfileRevision: input.revision,
        supervisorDirectory,
        workerService,
      });
      const run = await runtime.start(
        {
          activationId: `activation-memory-${String(input.ordinal)}`,
          agent: input.agent,
          consumerId: `consumer-memory-${String(input.ordinal)}`,
          fromSeq: input.ordinal,
          hostId,
          participantId: input.agent.participantId,
          reason: "manual",
          roomId: input.roomId,
          runAttemptId: `run-memory-${String(input.ordinal)}`,
          toSeq: input.ordinal,
        },
        { registerPrepared: async () => undefined },
      );
      const exit = await runtime.reap(run);
      assert.ok(runtime instanceof GenericProcessAdapter);
      const diagnostics = runtime.diagnostics(run);
      assert.equal(exit.code, 0, diagnostics.stderr);
      return JSON.parse(diagnostics.stdout) as {
        appInboxLive: { measurement: string; items: unknown[] } | null;
        appInbox?: string;
        bootstrap: string;
        memory: string;
        memoryDirectory: string;
        memoryIndexPath: string;
        modelMarker: string;
        note: string | null;
        operation: string;
        promptDigest: string;
        roomId: string;
        source: {
          cwd: string;
          resolution: string;
          project?: { key: string; label: string };
        } | null;
      };
    };

    const first = await runRuntime({
      agent: agentContext({
        displayName: "Persistent Agent",
        participantId: agentA.principal.principalId,
        revision: 1,
        role: "First runtime role",
      }),
      implementations: firstImplementations,
      ordinal: 1,
      probeReport: writerProbe,
      registry: profileRegistry,
      revision: activeWriter,
      roomId: "room-alpha",
    });
    assert.equal(first.roomId, "room-alpha");
    const expectedPromptDigest = createHash("sha256")
      .update(localWorkbenchWorkerPrompt())
      .digest("hex");
    assert.equal(
      first.promptDigest,
      expectedPromptDigest,
      "the configured OS child receives the current Worker prompt, not just a source declaration",
    );
    assert.equal(first.modelMarker, "provider-a/model-small");
    assert.match(first.memory, new RegExp(memoryMarker, "u"));
    assert.equal(first.note, `${noteMarker}\n`);
    assert.equal(first.appInbox, undefined);
    assert.equal(first.appInboxLive?.measurement, "over_threshold");
    assert.equal(
      first.appInboxLive?.items.length,
      1,
      "configured child can inspect changes made after its startup snapshot",
    );
    assert.equal(first.source?.cwd, directory);
    assert.deepEqual(JSON.parse(first.bootstrap).project, {
      key: "product",
      label: "Product",
    });
    assert.equal(first.bootstrap.includes(directory), false);
    assert.ok(Buffer.byteLength(first.bootstrap, "utf8") <= 4096);
    assert.doesNotMatch(
      JSON.parse(first.bootstrap).text,
      new RegExp(memoryMarker, "u"),
      "startup snapshot precedes the child's new writes",
    );

    // Simulate the daemon-side process boundary: close all Runtime Registry
    // state, then reconstruct the registry, implementation registry and
    // Runtime adapter from persistent configuration.
    profileRegistry.close();
    profileRegistry = openRegistry();
    const restartedImplementations = new RuntimeImplementationRegistry();
    const readerRevision = profileRegistry.importManifest(
      manifest({
        modelMarker: "provider-b/model-large-high-effort",
        operation: "read",
        runtimeProfileId: "memory-reader-runtime",
      }),
    );
    const readerProbe = profileRegistry.recordProbeReport(
      await restartedImplementations.probeRevision(readerRevision, {
        cwd: directory,
      }),
    );
    const activeReader = profileRegistry.activateRevision({
      contentDigest: readerRevision.contentDigest,
      runtimeProfileRevisionId: readerRevision.runtimeProfileRevisionId,
    });

    const second = await runRuntime({
      agent: agentContext({
        displayName: "Persistent Agent Renamed",
        participantId: agentA.principal.principalId,
        revision: 2,
        role: "Changed role after Runtime switch",
      }),
      implementations: restartedImplementations,
      ordinal: 2,
      probeReport: readerProbe,
      registry: profileRegistry,
      revision: activeReader,
      roomId: "room-beta",
      executionCwd: secondCwd,
    });
    assert.equal(second.roomId, "room-beta");
    assert.equal(second.promptDigest, expectedPromptDigest);
    assert.equal(second.appInboxLive?.measurement, "over_threshold");
    assert.equal(second.source?.cwd, secondCwd);
    assert.deepEqual(second.source?.project, first.source?.project);
    assert.equal(second.modelMarker, "provider-b/model-large-high-effort");
    assert.equal(second.memoryDirectory, first.memoryDirectory);
    assert.equal(second.memoryIndexPath, first.memoryIndexPath);
    assert.equal(second.memory, first.memory);
    assert.equal(second.note, first.note);
    const secondBootstrap = JSON.parse(second.bootstrap);
    assert.ok(Buffer.byteLength(second.bootstrap, "utf8") <= 4096);
    assert.equal(secondBootstrap.mode, "raft_original");
    assert.equal(secondBootstrap.status, "read_original");
    assert.equal(secondBootstrap.text, "");
    assert.match(second.memory, new RegExp(memoryMarker, "u"));
    assert.match(
      second.memory,
      /x{600}/u,
      "the worker still reads the complete original, not a selection",
    );
    const firstMaterialization = await readAgentMemoryMaterializationReceipt({
      rootDirectory: join(supervisorDirectory, "agent-memory"),
      runAttemptId: "run-memory-1",
    });
    const secondMaterialization = await readAgentMemoryMaterializationReceipt({
      rootDirectory: join(supervisorDirectory, "agent-memory"),
      runAttemptId: "run-memory-2",
    });
    assert.ok(firstMaterialization);
    assert.ok(secondMaterialization);
    assert.equal(firstMaterialization.files.length, 1);
    assert.deepEqual(
      secondMaterialization.files.map((file) => file.relativePath),
      ["MEMORY.md"],
    );
    assert.notEqual(
      firstMaterialization.files[0]!.contentDigest,
      secondMaterialization.files[0]!.contentDigest,
    );
    assert.equal(firstMaterialization.schemaVersion, 2);
    assert.equal(secondMaterialization.schemaVersion, 2);
    const secondAppInbox = JSON.parse(second.appInbox ?? "[]") as Array<{
      appId: string;
      notificationClass: string;
      retention: string;
    }>;
    assert.deepEqual(
      secondAppInbox.map(({ appId, notificationClass, retention }) => ({
        appId,
        notificationClass,
        retention,
      })),
      [
        {
          appId: "system.cleaner",
          notificationClass: "memory_size_hint",
          retention: "transient",
        },
      ],
    );
    assert.doesNotMatch(second.memory, /Persistent Agent Renamed/u);

    const isolated = await runRuntime({
      agent: agentContext({
        displayName: "Isolated Agent",
        participantId: agentB.principal.principalId,
        revision: 3,
        role: "Independent memory owner",
      }),
      implementations: restartedImplementations,
      ordinal: 3,
      probeReport: readerProbe,
      registry: profileRegistry,
      revision: activeReader,
      roomId: "room-beta",
    });
    assert.notEqual(isolated.memoryDirectory, first.memoryDirectory);
    assert.match(isolated.memory, /^# Isolated Agent$/mu);
    assert.doesNotMatch(isolated.memory, new RegExp(memoryMarker, "u"));
    assert.equal(isolated.note, null);
    assert.doesNotMatch(
      JSON.parse(isolated.bootstrap).text,
      new RegExp(memoryMarker, "u"),
    );

    const fallback = await runRuntime({
      agent: agentContext({
        displayName: "Persistent Agent Renamed",
        participantId: agentA.principal.principalId,
        revision: 2,
        role: "Changed role after Runtime switch",
      }),
      implementations: restartedImplementations,
      ordinal: 4,
      probeReport: readerProbe,
      registry: profileRegistry,
      revision: activeReader,
      roomId: "room-gamma",
      withoutCoordinator: true,
    });
    assert.equal(fallback.bootstrap, second.bootstrap);
    assert.equal(fallback.promptDigest, expectedPromptDigest);
    assert.equal(fallback.memory, first.memory);
    assert.equal(fallback.memoryDirectory, first.memoryDirectory);
    assert.equal(fallback.source?.resolution, "matched");
    assert.equal(issuedCredentials, 4);
  } finally {
    await memoryCoordinator.close();
    profileRegistry?.close();
    await proxyRegistry.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
