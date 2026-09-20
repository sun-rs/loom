import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AgentMemoryCoordinator,
  GenericProcessAdapter,
  RuntimeCredentialEnvironmentBinding,
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
  type ActivationEnvelope,
  type RuntimeCreationOptions,
  type RuntimeStartLifecycle,
  type RunHandle,
} from "@rah-os/agent-host";
import { RoomKernel } from "@rah-os/kernel";
import type { RuntimeProfileManifestV2 } from "@rah-os/protocol";
import { createConfiguredRuntime } from "../src/runtime-profile-composition.ts";

test("private runtime composition keeps actual cwd, Worker root, prompt and recovery bound to each Agent", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rah-private-composition-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const registry = new RuntimeProfileRegistry({
    databasePath: join(directory, "profiles.db"),
    hostId: "host-private",
  });
  const memory = new AgentMemoryCoordinator({
    rootDirectory: join(directory, "memory"),
    wake: () => false,
  });
  t.after(async () => {
    await memory.close();
    registry.close();
    kernel.close();
    await rm(directory, { recursive: true, force: true });
  });
  kernel.initialize();
  registry.initialize();
  const agents = ["alice", "bob"].map(
    (handle) => kernel.provisionPrincipal({ kind: "agent", handle }).principal,
  );
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "host-private",
      participantIds: agents.map((agent) => agent.principalId),
    }).accessToken,
  );
  const manifest: RuntimeProfileManifestV2 = {
    manifestVersion: 2,
    runtimeProfileId: "private-fixture",
    displayName: "Private workspace fixture",
    adapter: {
      kind: "generic-process/v1",
      executable: process.execPath,
      fixedArgs: [],
      config: {},
    },
    credentialSlots: [],
    declaredCapabilities: ["worker_commands"],
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers: ["rah-process-supervisor-v1"],
    staticEnv: {},
    workspacePolicy: { allowedModes: ["in_place"] },
  };
  const imported = registry.importManifest(manifest);
  const implementations = new RuntimeImplementationRegistry();
  const probeReport = registry.recordProbeReport(
    await implementations.probeRevision(imported, { cwd: directory }),
  );
  const revision = registry.activateRevision({
    runtimeProfileRevisionId: imported.runtimeProfileRevisionId,
    contentDigest: imported.contentDigest,
  });
  const credentials = new RuntimeCredentialEnvironmentBinding({
    manifest,
    resolvers: {},
  });
  const captured: { participantId: string; cwd: string; prompt: string }[] = [];
  const workerRoots: { participantId: string; root: string }[] = [];
  const memoryRoots: string[] = [];
  t.mock.method(
    memory,
    "prepareRuntimeActivation",
    async (
      _agent: Parameters<AgentMemoryCoordinator["prepareRuntimeActivation"]>[0],
      _activation: Parameters<
        AgentMemoryCoordinator["prepareRuntimeActivation"]
      >[1],
      execution: Parameters<
        AgentMemoryCoordinator["prepareRuntimeActivation"]
      >[2],
    ) => {
      assert.ok(execution);
      memoryRoots.push(execution.cwd);
      return { env: {} };
    },
  );
  class ObservedRuntime extends GenericProcessAdapter {
    readonly options: RuntimeCreationOptions;
    constructor(options: RuntimeCreationOptions) {
      super({ command: process.execPath, args: [], cwd: options.cwd });
      this.options = options;
    }
    override async start(
      scope: ActivationEnvelope,
      lifecycle: RuntimeStartLifecycle,
    ): Promise<RunHandle> {
      await this.options.beforeStart?.();
      const lease = await this.options.activationEnvironment!(scope);
      try {
        const args = lease.args ?? [];
        const prompt = args[args.lastIndexOf("--prompt") + 1];
        assert.ok(prompt, "actual runtime receives compiled prompt");
        captured.push({
          participantId: scope.participantId,
          cwd: this.options.cwd,
          prompt,
        });
        const run = {
          runId: scope.runAttemptId,
          recoveryDescriptor: {
            driver: "fixture",
            metadata: {},
            recoveryKey: scope.runAttemptId,
          },
        };
        await lifecycle.registerPrepared(run);
        await writeFile(
          join(this.options.cwd, "same-name.txt"),
          scope.participantId,
        );
        return run;
      } finally {
        await lease.release?.();
      }
    }
  }
  t.mock.method(
    implementations,
    "createRuntime",
    (
      _revision: Parameters<RuntimeImplementationRegistry["createRuntime"]>[0],
      _probe: Parameters<RuntimeImplementationRegistry["createRuntime"]>[1],
      options: RuntimeCreationOptions,
    ) => new ObservedRuntime(options),
  );
  const workerService = {
    origin: "http://127.0.0.1:1",
    issueActivationCredential: () => {
      throw new Error("legacy credential fallback must not be used");
    },
    issueActivationCredentialForWorkspace: async (
      _host: unknown,
      scope: ActivationEnvelope,
      options: { workspaceRoot: string },
    ) => {
      workerRoots.push({
        participantId: scope.participantId,
        root: options.workspaceRoot,
      });
      return {
        accessToken: "rah_wat_private_fixture_0123456789",
        expiresAt: "2099-01-01T00:00:00.000Z",
        revoke: () => {},
      };
    },
  };
  for (const agent of agents) {
    const cwd = join(directory, agent.principalId);
    await mkdir(cwd);
    const executionWorkspace = {
      participantId: agent.principalId,
      workspaceDefinitionId: `workspace-${agent.principalId}`,
      workspaceMountRevisionId: `mount-${agent.principalId}`,
      workspaceMountDigest: `sha256:${"a".repeat(64)}`,
    };
    const runtime = createConfiguredRuntime({
      cwd,
      executionWorkspace,
      host,
      implementations,
      probeReport,
      runtimeProfileRegistry: registry,
      runtimeProfileRevision: revision,
      supervisorDirectory: directory,
      credentialEnvironment: credentials,
      agentMemoryCoordinator: memory,
      workerService,
    });
    let prepared: RunHandle | undefined;
    const scope: ActivationEnvelope = {
      activationId: `activation-${agent.principalId}`,
      consumerId: "consumer-private",
      hostId: host.hostId,
      participantId: agent.principalId,
      roomId: "room-private",
      reason: "manual",
      fromSeq: 1,
      toSeq: 1,
      runAttemptId: `run-${agent.principalId}`,
      agent: {
        schemaVersion: 1,
        participantId: agent.principalId,
        handle: agent.handle,
        agentDefinitionRevision: {
          agentId: `definition-${agent.principalId}`,
          agentDefinitionRevisionId: `revision-${agent.principalId}`,
          contentDigest: `sha256:${"1".repeat(64)}`,
          createdAt: "2026-09-11T00:00:00.000Z",
          createdBy: "human-owner",
          executionPolicyRevisionId: "policy-private",
          instructionRefs: [],
          skillRefs: [],
          revision: 1,
          role: "Assistant",
          memoryPolicyRef: {
            artifactId: "memory-policy",
            versionId: "memory-v1",
            contentDigest: `sha256:${"2".repeat(64)}`,
          },
        },
      },
    };
    const run = await runtime.start(scope, {
      registerPrepared: async (candidate) => {
        prepared = candidate;
      },
    });
    assert.deepEqual(
      prepared?.recoveryDescriptor?.executionWorkspace,
      executionWorkspace,
    );
    assert.deepEqual(
      run.recoveryDescriptor?.executionWorkspace,
      executionWorkspace,
    );
    assert.ok(Object.isFrozen(run.recoveryDescriptor?.executionWorkspace));
  }
  for (const [index, agent] of agents.entries()) {
    const cwd = join(directory, agent.principalId);
    assert.equal(
      await readFile(join(cwd, "same-name.txt"), "utf8"),
      agent.principalId,
    );
    assert.deepEqual(workerRoots[index], {
      participantId: agent.principalId,
      root: cwd,
    });
    assert.equal(memoryRoots[index], cwd);
    assert.equal(captured[index]?.cwd, cwd);
    assert.ok(captured[index]?.prompt.includes(cwd));
    const other = agents.find((candidate) => candidate !== agent)!;
    assert.ok(
      !captured[index]?.prompt.includes(join(directory, other.principalId)),
    );
  }
  const probeRuntime = createConfiguredRuntime({
    cwd: directory,
    host,
    implementations,
    probeReport,
    runtimeProfileRegistry: registry,
    runtimeProfileRevision: revision,
    supervisorDirectory: directory,
    credentialEnvironment: credentials,
    agentMemoryCoordinator: memory,
    workerService,
  });
  assert.equal((await probeRuntime.probe()).available, true);
  assert.equal(
    captured.length,
    2,
    "probing does not activate an Agent or issue Worker credentials",
  );
  assert.equal(workerRoots.length, 2);
});
