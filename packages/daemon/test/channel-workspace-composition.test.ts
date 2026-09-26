import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
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

import { createChannelAttachedDirectoryValidator } from "../src/channel-attached-directory-validator.ts";
import {
  channelWorkspaceCoreOptions,
  defaultChannelWorkspaceRoot,
} from "../src/daemon-execution-workspace-composition.ts";
import {
  attachedDirectoriesForPrompt,
  createConfiguredRuntime,
} from "../src/runtime-profile-composition.ts";
import { compileStandingPrompt } from "../src/standing-prompt-compiler.ts";

test("the attached-directory validator accepts only existing canonical directories outside Loom data", async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "rah-attach-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const stateDirectory = join(base, "loom", "state");
  const channelWorkspaceRoot = join(base, "loom", "channel-workspaces");
  const project = join(base, "project");
  await mkdir(stateDirectory, { recursive: true });
  await mkdir(project);
  await writeFile(join(base, "file.txt"), "x");
  await symlink(project, join(base, "link"));
  const validate = createChannelAttachedDirectoryValidator({
    stateDirectory,
    channelWorkspaceRoot,
  });
  assert.doesNotThrow(() => validate([project]));
  for (const [path, reason] of [
    [join(base, "missing"), /does not exist/u],
    [join(base, "file.txt"), /not a directory/u],
    [join(base, "link"), /canonical/u],
    [stateDirectory, /Loom data/u],
    [join(stateDirectory, "agent-workspaces"), /Loom data/u],
    [join(base, "loom"), /Loom data/u],
    [channelWorkspaceRoot, /channel home/u],
    [join(channelWorkspaceRoot, "room-1"), /channel home/u],
  ] as const) {
    if (
      path.endsWith("agent-workspaces") ||
      path.startsWith(channelWorkspaceRoot)
    )
      await mkdir(path, { recursive: true });
    assert.throws(() => validate([project, path]), reason, path);
  }
});

test("the channel home root defaults to ~/.loom/channel-workspaces and is configurable", () => {
  assert.equal(
    defaultChannelWorkspaceRoot(
      { channelWorkspaceRoot: "/custom/root" },
      "/Users/x",
    ),
    "/custom/root",
  );
  assert.equal(
    defaultChannelWorkspaceRoot({}, "/Users/x"),
    "/Users/x/.loom/channel-workspaces",
  );
});

test("option A: creating a Channel creates its primary directory on the Host; a conflict fails creation with no Channel; replay returns the same directory", async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "rah-option-a-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const stateDirectory = join(base, "state");
  const channelWorkspaceRoot = join(base, "homes");
  await mkdir(stateDirectory);
  let forcedRoomId: string | undefined;
  let nextId = 0;
  const kernel = new RoomKernel({
    databasePath: join(stateDirectory, "room.db"),
    ...channelWorkspaceCoreOptions({
      schemaVersion: 4,
      stateDirectory,
      channelWorkspaceRoot,
    } as unknown as Parameters<typeof channelWorkspaceCoreOptions>[0]),
    createId: (prefix: string) =>
      prefix === "room" && forcedRoomId !== undefined
        ? forcedRoomId
        : `${prefix}_${String((nextId += 1))}`,
  });
  t.after(() => kernel.close());
  kernel.initialize();
  const actor = kernel.authenticateAccessToken(
    kernel.provisionPrincipal({ handle: "owner", kind: "human" }).accessToken,
  );
  const workspace = kernel.createWorkspace(actor, {
    name: "Channels",
    slug: "channels",
    idempotencyKey: "workspace",
  });
  const database = new DatabaseSync(join(stateDirectory, "room.db"));
  t.after(() => database.close());
  const head = () =>
    Number(
      database
        .prepare("SELECT next_seq - 1 AS seq FROM rooms WHERE room_id=?")
        .get(workspace.controlRoom.roomId)!.seq,
    );
  const create = (slug: string) =>
    kernel.createWorkspaceRoom(actor, {
      workspaceId: workspace.workspace.workspaceId,
      basedOnControlRoomSeq: head(),
      kind: "channel",
      idempotencyKey: slug,
      name: slug,
      slug,
    });
  const created = create("build").room;
  const home = join(channelWorkspaceRoot, created.roomId);
  assert.equal(created.channelWorkspace?.primaryDirectory, home);
  assert.deepEqual(created.channelWorkspace?.primary, { state: "ready" });
  assert.ok((await lstat(home)).isDirectory());
  const replay = create("build");
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.room.channelWorkspace?.primaryDirectory, home);

  // A foreign directory already occupies the next Channel's home path.
  const before = kernel.listRooms(actor).length;
  forcedRoomId = "room_taken";
  await mkdir(join(channelWorkspaceRoot, "room_taken"));
  assert.throws(
    () => create("other"),
    (error: unknown) =>
      error instanceof Error &&
      /primary directory could not be created/u.test(error.message) &&
      /channel_home_unowned/u.test(error.message),
  );
  assert.equal(kernel.listRooms(actor).length, before, "no Channel row");
});

test("only a CLI without a native mechanism gets the attached-directory prompt line", () => {
  const dirs = ["/work/app", "/work/lib"];
  for (const kind of [
    "claude-stream-json/v1",
    "codex-app-server/v1",
    "kimi-acp/v1",
  ])
    assert.deepEqual(attachedDirectoriesForPrompt(kind, dirs), [], kind);
  assert.deepEqual(
    attachedDirectoriesForPrompt("opencode-server/v1", dirs),
    dirs,
  );
  assert.deepEqual(
    attachedDirectoriesForPrompt("generic-process/v1", dirs),
    dirs,
  );
  const withLine = compileStandingPrompt({
    runtimeContext: {
      workspacePath: "/homes/room-1",
      attachedDirectories: dirs,
    },
  });
  assert.match(withLine.prompt, /^- Workspace: \/homes\/room-1$/mu);
  assert.match(withLine.prompt, /^- Attached directory: \/work\/app$/mu);
  assert.match(withLine.prompt, /^- Attached directory: \/work\/lib$/mu);
  const without = compileStandingPrompt({
    runtimeContext: { workspacePath: "/homes/room-1" },
  });
  assert.equal(without.prompt.includes("Attached directory"), false);
  assert.equal(
    withLine.deterministicDigest,
    without.deterministicDigest,
    "runtime context never counts as standing-prompt drift",
  );
});

test("a channel-home runtime passes attached directories to the adapter, the prompt (non-native CLI) and the Worker evidence roots", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rah-channel-composition-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const registry = new RuntimeProfileRegistry({
    databasePath: join(directory, "profiles.db"),
    hostId: "host-channel",
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
      hostId: "host-channel",
      participantIds: [agent.principalId],
    }).accessToken,
  );
  const manifest: RuntimeProfileManifestV2 = {
    manifestVersion: 2,
    runtimeProfileId: "channel-fixture",
    displayName: "Channel workspace fixture",
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
  let created: RuntimeCreationOptions | undefined;
  let prompt = "";
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
        prompt = args[args.lastIndexOf("--prompt") + 1] ?? "";
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
    (_revision: unknown, _probe: unknown, options: RuntimeCreationOptions) => {
      created = options;
      return new ObservedRuntime(options);
    },
  );
  const evidence: unknown[] = [];
  const cwd = join(directory, "home");
  await mkdir(cwd);
  let verified = 0;
  let refuse = false;
  const configure = () =>
    createConfiguredRuntime({
      additionalDirectories: ["/work/app", "/work/lib"],
      // Review P1-1: the Host re-checks the channel workspace before each
      // activation's environment and evidence capture.
      verifyWorkspace: () => {
        verified += 1;
        if (refuse)
          throw new Error(
            "attached_directory_replaced: /work/app is no longer the directory approved for this Channel",
          );
      },
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
      workerService: {
        origin: "http://127.0.0.1:1",
        issueActivationCredential: () => {
          throw new Error("legacy credential fallback must not be used");
        },
        issueActivationCredentialForWorkspace: async (
          _host: unknown,
          _scope: ActivationEnvelope,
          options: {
            workspaceRoot: string;
            attachedDirectories?: readonly string[];
          },
        ) => {
          evidence.push(options);
          return {
            accessToken: "rah_wat_channel_fixture_0123456789",
            expiresAt: "2099-01-01T00:00:00.000Z",
            revoke: () => {},
          };
        },
      },
    });
  const runtime = configure();
  assert.deepEqual(created?.additionalDirectories, ["/work/app", "/work/lib"]);
  const scope = {
    activationId: "activation-1",
    consumerId: "consumer-1",
    hostId: host.hostId,
    participantId: agent.principalId,
    roomId: "room-1",
    reason: "manual",
    fromSeq: 1,
    toSeq: 1,
    runAttemptId: "run-1",
    agent: {
      schemaVersion: 1,
      participantId: agent.principalId,
      handle: agent.handle,
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
  } satisfies ActivationEnvelope;
  await runtime.start(scope, { registerPrepared: async () => undefined });
  assert.ok(verified >= 1, "verified before the activation");
  refuse = true;
  await assert.rejects(
    configure().start(scope, { registerPrepared: async () => undefined }),
    /attached_directory_replaced/u,
  );
  assert.equal(evidence.length, 1, "no evidence captured from a replaced root");
  assert.match(prompt, /^- Attached directory: \/work\/app$/mu);
  assert.deepEqual(evidence, [
    { workspaceRoot: cwd, attachedDirectories: ["/work/app", "/work/lib"] },
  ]);
});
