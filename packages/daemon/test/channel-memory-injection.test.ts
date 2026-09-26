import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CHANNEL_MEMORY_POINTER,
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
import type {
  InstanceMemoryIndex,
  RuntimeProfileManifestV2,
} from "@rah-os/protocol";

import { createConfiguredRuntime } from "../src/runtime-profile-composition.ts";
import { compileStandingPrompt } from "../src/standing-prompt-compiler.ts";

// evo S6 batch B: an S6 session (a Role instance: the only principal with
// channel memory) starts with the channel index instead of the legacy
// per-instance MEMORY.md; a legacy persona Agent is unchanged. Fake runtime,
// temporary database and directories; no provider process.

const agentLayer = {
  displayName: "A",
  handle: "a",
  participantId: "p",
  role: "R",
};

test("an S6 standing prompt carries one memory pointer line and the index last; the index is outside the continuity digest", () => {
  const first = compileStandingPrompt({
    agent: agentLayer,
    channelMemory: { section: "## Channel memory index\n- a [project] — one" },
  });
  const second = compileStandingPrompt({
    agent: agentLayer,
    channelMemory: { section: "## Channel memory index\n- b [user] — two" },
  });
  assert.ok(first.prompt.endsWith("- a [project] — one"));
  assert.equal(
    first.prompt.split("\n").filter((line) => line === CHANNEL_MEMORY_POINTER)
      .length,
    1,
  );
  assert.doesNotMatch(first.prompt, /MEMORY\.md/u);
  assert.doesNotMatch(first.prompt, /RAH_AGENT_MEMORY_DIR/u);
  assert.equal(first.deterministicDigest, second.deterministicDigest);
  const legacy = compileStandingPrompt({ agent: agentLayer });
  assert.match(legacy.prompt, /MEMORY\.md/u);
  assert.doesNotMatch(legacy.prompt, /Channel memory index/u);
  assert.notEqual(legacy.deterministicDigest, first.deterministicDigest);
});

async function composition(
  t: test.TestContext,
  options: { withKernel?: boolean; kernelThrows?: boolean } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "rah-memory-injection-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const registry = new RuntimeProfileRegistry({
    databasePath: join(directory, "profiles.db"),
    hostId: "host-memory",
  });
  t.after(async () => {
    registry.close();
    kernel.close();
    await rm(directory, { recursive: true, force: true });
  });
  kernel.initialize();
  registry.initialize();
  const agent = kernel.provisionPrincipal({
    kind: "agent",
    handle: "alice",
  }).principal;
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "host-memory",
      participantIds: [agent.principalId],
    }).accessToken,
  );
  const manifest: RuntimeProfileManifestV2 = {
    manifestVersion: 2,
    runtimeProfileId: "memory-fixture",
    displayName: "Memory injection fixture",
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
  const seen: { prompt: string; env: Record<string, string> }[] = [];
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
      const lease = await this.options.activationEnvironment!(scope);
      try {
        const args = lease.args ?? [];
        seen.push({
          prompt: args[args.lastIndexOf("--prompt") + 1] ?? "",
          env: { ...lease.env },
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
        return run;
      } finally {
        await lease.release?.();
      }
    }
  }
  t.mock.method(
    implementations,
    "createRuntime",
    (_revision: unknown, _probe: unknown, options: RuntimeCreationOptions) =>
      new ObservedRuntime(options),
  );
  const cwd = join(directory, "home");
  await mkdir(cwd);
  const reads: string[] = [];
  const index: InstanceMemoryIndex = {
    channelId: "channel-1",
    readEnabled: true,
    entries: [
      {
        entryId: "memory-1",
        channelId: "channel-1",
        name: "deploy",
        type: "project",
        description: "how releases ship",
        pinned: true,
        state: "active",
        revision: 2,
        createdAt: "2026-09-27T00:00:00.000Z",
        updatedAt: "2026-09-27T00:00:00.000Z",
      },
    ],
    total: 1,
    throughSeq: 41,
  };
  const runtime = createConfiguredRuntime({
    cwd,
    host,
    implementations,
    probeReport,
    runtimeProfileRegistry: registry,
    runtimeProfileRevision: revision,
    supervisorDirectory: directory,
    credentialEnvironment: new RuntimeCredentialEnvironmentBinding({
      manifest,
      resolvers: {},
    }),
    ...(options.withKernel === false
      ? {}
      : {
          memoryIndexKernel: {
            readInstanceMemoryIndex: (
              _host: unknown,
              input: { participantId: string },
            ) => {
              reads.push(input.participantId);
              if (options.kernelThrows === true)
                throw new Error("host is not authorized");
              return index;
            },
          },
        }),
    workerService: {
      origin: "http://127.0.0.1:1",
      issueActivationCredential: () => ({
        accessToken: "rah_wat_memory_fixture_0123456789",
        expiresAt: "2099-01-01T00:00:00.000Z",
        revoke: () => {},
      }),
    },
  });
  const scope = (
    run: string,
    instance: { channelId?: string; sessionRequired?: boolean },
  ) =>
    ({
      activationId: `activation-${run}`,
      consumerId: "consumer-1",
      hostId: host.hostId,
      participantId: agent.principalId,
      roomId: "channel-1",
      reason: "manual",
      fromSeq: 1,
      toSeq: 1,
      runAttemptId: `run-${run}`,
      agent: {
        schemaVersion: 1,
        participantId: agent.principalId,
        handle: agent.handle,
        ...(instance.channelId === undefined
          ? {}
          : {
              instanceChannelId: instance.channelId,
              instanceSessionRequired: instance.sessionRequired === true,
            }),
        agentDefinitionRevision: {
          agentId: "definition-1",
          agentDefinitionRevisionId: "revision-1",
          contentDigest: `sha256:${"1".repeat(64)}`,
          createdAt: "2026-09-26T00:00:00.000Z",
          createdBy: "human-owner",
          executionPolicyRevisionId: "policy-1",
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
    }) satisfies ActivationEnvelope;
  const start = async (envelope: ActivationEnvelope) =>
    await runtime.start(envelope, { registerPrepared: async () => undefined });
  return { agent, directory, reads, scope, seen, start };
}

test("a new S6 session gets the index and the launch seq, and no legacy MEMORY.md is prepared", async (t) => {
  const c = await composition(t);
  await c.start(c.scope("new", { channelId: "channel-1" }));
  const [launch] = c.seen;
  assert.deepEqual(c.reads, [c.agent.principalId]);
  assert.match(
    launch!.prompt,
    /\n## Channel memory index\n.*\n- deploy \[project, pinned\] — how releases ship$/u,
  );
  assert.doesNotMatch(launch!.prompt, /MEMORY\.md/u);
  assert.equal(launch!.env.RAH_MEMORY_INDEX_SEQ, "41");
  assert.equal(launch!.env.RAH_AGENT_MEMORY_DIR, undefined);
  assert.equal(launch!.env.RAH_AGENT_MEMORY_BOOTSTRAP_JSON, undefined);
  await assert.rejects(lstat(join(c.directory, "agent-memory")), {
    code: "ENOENT",
  });
});

test("a resumed S6 session keeps the index it already holds: no launch seq", async (t) => {
  const c = await composition(t);
  await c.start(
    c.scope("resume", { channelId: "channel-1", sessionRequired: true }),
  );
  assert.equal(c.seen[0]!.env.RAH_MEMORY_INDEX_SEQ, undefined);
});

test("a legacy persona Agent keeps its per-instance MEMORY.md unchanged", async (t) => {
  const c = await composition(t);
  await c.start(c.scope("legacy", {}));
  const [launch] = c.seen;
  assert.deepEqual(c.reads, []);
  assert.match(launch!.prompt, /MEMORY\.md/u);
  assert.doesNotMatch(launch!.prompt, /Channel memory index/u);
  assert.ok(launch!.env.RAH_AGENT_MEMORY_DIR);
  assert.equal(launch!.env.RAH_MEMORY_INDEX_SEQ, undefined);
});

test("without a Kernel index read an S6 session still gets no legacy MEMORY.md", async (t) => {
  const c = await composition(t, { withKernel: false });
  await c.start(c.scope("no-kernel", { channelId: "channel-1" }));
  const [launch] = c.seen;
  assert.match(
    launch!.prompt,
    /Not available at launch: use `memory list`\.$/u,
  );
  assert.doesNotMatch(launch!.prompt, /MEMORY\.md/u);
  assert.equal(launch!.env.RAH_MEMORY_INDEX_SEQ, undefined);
  assert.equal(launch!.env.RAH_AGENT_MEMORY_DIR, undefined);
});

test("a failed Kernel index read starts the S6 session without an index instead of blocking it", async (t) => {
  const c = await composition(t, { kernelThrows: true });
  await c.start(c.scope("throws", { channelId: "channel-1" }));
  assert.match(c.seen[0]!.prompt, /Not available at launch/u);
  assert.doesNotMatch(c.seen[0]!.prompt, /MEMORY\.md/u);
});
