import { bindRoleDefinitionFixture } from "../../kernel/test/role-definition-fixture.ts";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  readFileSync,
  realpathSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  InstanceRuntimePool,
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import { RoomKernel } from "@rah-os/kernel";
import type { RuntimeProfileManifestV2 } from "@rah-os/protocol";

import {
  DaemonApplication,
  DaemonConfigSchema,
  FileSecretProvider,
  createRegistryBackedRuntimeRecovery,
  type SecretProvider,
} from "../src/index.ts";
import {
  createDaemonRuntimeHygiene,
  warmRuntimeAdapterKinds,
} from "../src/daemon-process-hygiene.ts";

const fakeCliPath = fileURLToPath(
  new URL("../../agent-host/test/fixtures/fake-cli.mjs", import.meta.url),
);
const daemonCliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

test("daemon config is strict and file secrets must be owner-private", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-config-"));
  try {
    const secretPath = join(directory, "host.token");
    writeFileSync(secretPath, "rah_hat_test\n", { mode: 0o600 });
    const config = validConfig(directory, secretPath);

    assert.throws(() =>
      DaemonConfigSchema.parse({ ...config, unexpected: true }),
    );
    assert.deepEqual(DaemonConfigSchema.parse(config), config);
    assert.deepEqual(
      DaemonConfigSchema.parse({ ...config, fileReferenceRoots: [directory] })
        .fileReferenceRoots,
      [directory],
    );
    assert.deepEqual(
      DaemonConfigSchema.parse({ ...config, fileReferenceRoots: ["/"] })
        .fileReferenceRoots,
      ["/"],
    );
    for (const roots of [["relative"], []])
      assert.throws(() =>
        DaemonConfigSchema.parse({ ...config, fileReferenceRoots: roots }),
      );
    assert.throws(() =>
      DaemonConfigSchema.parse({ ...config, schemaVersion: 1 }),
    );
    for (const retired of [
      "malformed legacy config",
      null,
      [
        {
          bearerToken: { source: "file", path: "/not-present/retired-secret" },
        },
      ],
    ])
      assert.deepEqual(
        DaemonConfigSchema.parse({ ...config, managedMcpExecutors: retired }),
        config,
      );

    assert.throws(() =>
      DaemonConfigSchema.parse({
        ...config,
        client: { bindHost: "0.0.0.0", port: 7_777 },
      }),
    );
    assert.throws(() =>
      DaemonConfigSchema.parse({
        ...config,
        taskClaimHeartbeatIntervalMs: config.taskClaimLeaseMs,
      }),
    );

    chmodSync(secretPath, 0o644);
    await assert.rejects(
      new FileSecretProvider().load({ path: secretPath, source: "file" }),
      /owner-private/,
    );
    chmodSync(secretPath, 0o600);
    writeFileSync(secretPath, "x".repeat(65_537));
    await assert.rejects(
      new FileSecretProvider().load({ path: secretPath, source: "file" }),
      /safe byte limit/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("daemon config v3 selects one active registry profile without inline command or env", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-config-v3-"));
  try {
    const secretPath = join(directory, "host.token");
    writeFileSync(secretPath, "rah_hat_test\n", { mode: 0o600 });
    const legacy = validConfig(directory, secretPath);
    const config = {
      ...legacy,
      runtime: {
        credentialBindings: {
          "provider-token": { path: secretPath, source: "file" as const },
        },
        cwd: directory,
        kind: "runtime-profile-registry" as const,
        offer: {
          leaseMs: 120_000,
          maxConcurrent: 1 as const,
          refreshIntervalMs: 30_000,
          runtimeOfferId: "offer-config-v3",
        },
        registryDatabasePath: join(directory, "runtime-registry.db"),
        runtimeProfileId: "profile-config-v3",
      },
      schemaVersion: 3 as const,
    };
    assert.deepEqual(DaemonConfigSchema.parse(config), config);
    assert.throws(() =>
      DaemonConfigSchema.parse({
        ...config,
        runtime: { ...config.runtime, command: process.execPath },
      }),
    );
    assert.throws(() =>
      DaemonConfigSchema.parse({
        ...config,
        runtime: {
          ...config.runtime,
          offer: { ...config.runtime.offer, maxConcurrent: 2 },
        },
      }),
    );
    assert.throws(() =>
      DaemonConfigSchema.parse({
        ...config,
        runtime: {
          ...config.runtime,
          offer: {
            ...config.runtime.offer,
            refreshIntervalMs: config.runtime.offer.leaseMs,
          },
        },
      }),
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("daemon config v4 binds multiple authorized participants to unique runtime profiles", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-config-v4-"));
  try {
    const secretPath = join(directory, "host.token");
    writeFileSync(secretPath, "rah_hat_test\n", { mode: 0o600 });
    const config = validConfigV4(directory, secretPath);

    assert.deepEqual(DaemonConfigSchema.parse(config), config);
    assert.throws(
      () =>
        DaemonConfigSchema.parse({
          ...config,
          host: {
            ...config.host,
            participantIds: ["agent-a", "agent-a"],
          },
        }),
      /duplicate value/,
    );
    assert.throws(
      () =>
        DaemonConfigSchema.parse({
          ...config,
          runtimes: [
            config.runtimes[0],
            {
              ...config.runtimes[1],
              runtimeProfileId: config.runtimes[0]!.runtimeProfileId,
            },
          ],
        }),
      /duplicate runtimeProfileId/,
    );
    assert.throws(
      () =>
        DaemonConfigSchema.parse({
          ...config,
          runtimes: [
            config.runtimes[0],
            {
              ...config.runtimes[1],
              offer: {
                ...config.runtimes[1]!.offer,
                runtimeOfferId: config.runtimes[0]!.offer.runtimeOfferId,
              },
            },
          ],
        }),
      /duplicate runtimeOfferId/,
    );
    assert.throws(
      () =>
        DaemonConfigSchema.parse({
          ...config,
          host: { ...config.host, maxConcurrent: 65 },
        }),
      /must not exceed 64/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Human API drives two Workspace Agents through daemon v4 and reconnect recovery", async () => {
  if (process.platform === "win32") return;
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-p3c-e2e-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const registryDatabasePath = join(stateDirectory, "runtime-registry.db");
  const secretPath = join(stateDirectory, "host.token");
  const hostId = "daemon-v4-host";
  const seed = new RoomKernel({ databasePath });
  let activeShutdown: AbortController | undefined;
  let running: Promise<void> | undefined;
  let observer: RoomKernel | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "daemon-v4-human",
      kind: "human",
    });
    const agents = ["a", "b"].map((suffix) =>
      seed.provisionPrincipal({
        handle: `daemon-v4-agent-${suffix}`,
        kind: "agent",
      }),
    );
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const productWorkspace = seed.createWorkspace(humanActor, {
      idempotencyKey: "daemon-v4-workspace-created",
      name: "P3C Workspace",
      slug: "p3c-workspace",
    });
    const catalogRoom = productWorkspace.controlRoom;
    for (const agent of agents) {
      seed.addMember(humanActor, {
        principalId: agent.principal.principalId,
        roomId: catalogRoom.roomId,
      });
    }

    const offerIds = ["daemon-v4-offer-a", "daemon-v4-offer-b"];
    const profileIds = ["daemon-v4-profile-a", "daemon-v4-profile-b"];
    const agentDefinitionIds: string[] = [];
    for (const [index, agent] of agents.entries()) {
      const policy = seed.createExecutionPolicy(humanActor, {
        basedOnRoomSeq: latestRoomSeq(seed, humanActor, catalogRoom.roomId),
        controlRoomId: catalogRoom.roomId,
        idempotencyKey: `daemon-v4-policy-${String(index)}`,
        modelIntent: {
          fallback: "disabled",
          reasoning: "default",
          serviceTier: "default",
        },
        preferred: [],
        required: {
          allowedOfferIds: [offerIds[index]!],
          allowedProtocolFamilies: ["rah-worker-process/v1"],
          capabilities: [],
          minimumIsolation: "none",
          workspaceMode: "in_place",
        },
        retryPolicyRef: {
          artifactId: `daemon-v4-retry-${String(index)}`,
          contentDigest: `sha256:${String(index + 1).repeat(64)}`,
          versionId: `daemon-v4-retry-${String(index)}-v1`,
        },
        sessionPolicy: "fresh",
        // This fixture is an intentionally provider-neutral generic process;
        // restricted defaults fail closed because it publishes no native
        // sandbox mapping.
        toolAccessMode: "full_access",
      }).policy;
      const definition = seed.createAgentDefinition(humanActor, {
        basedOnRoomSeq: latestRoomSeq(seed, humanActor, catalogRoom.roomId),
        controlRoomId: catalogRoom.roomId,
        executionPolicyRevisionId: policy.executionPolicyRevisionId,
        idempotencyKey: `daemon-v4-agent-definition-${String(index)}`,
        instructionRefs: [],
        memoryPolicyRef: {
          artifactId: `daemon-v4-memory-${String(index)}`,
          contentDigest: `sha256:${String(index + 3).repeat(64)}`,
          versionId: `daemon-v4-memory-${String(index)}-v1`,
        },
        participantId: agent.principal.principalId,
        role: `daemon v4 worker ${String(index)}`,
        skillRefs: [],
      });
      agentDefinitionIds.push(definition.definition.agentId);
    }

    const hostCredential = seed.provisionHostCredential({
      hostId,
      participantIds: agents.map((agent) => agent.principal.principalId),
    });
    writeFileSync(secretPath, `${hostCredential.accessToken}\n`, {
      mode: 0o600,
    });

    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: registryDatabasePath,
      hostId,
    });
    profileRegistry.initialize();
    const implementations = new RuntimeImplementationRegistry();
    const cwdProofCli = join(stateDirectory, "cwd-proof-cli.mjs");
    writeFileSync(
      cwdProofCli,
      `import {writeFileSync} from "node:fs";
writeFileSync("cwd-proof.txt",process.cwd());
await import(${JSON.stringify(new URL("../../agent-host/test/fixtures/fake-cli.mjs", import.meta.url).href)});
`,
    );
    for (const [index, runtimeProfileId] of profileIds.entries()) {
      const manifest: RuntimeProfileManifestV2 = {
        adapter: {
          config: { terminationGraceMs: 1_000 },
          executable: process.execPath,
          fixedArgs: [cwdProofCli],
          kind: "generic-process/v1",
        },
        credentialSlots: [],
        declaredCapabilities: ["worker_commands"],
        displayName: `Daemon v4 fake worker ${String(index)}`,
        manifestVersion: 2,
        protocolFamily: "rah-worker-process/v1",
        recoveryDrivers: ["rah-process-supervisor-v1"],
        runtimeProfileId,
        staticEnv: {
          RAH_FAKE_MODE: "worker-task",
          RAH_FAKE_ROOM_REPLY: `Canonical daemon reply from Agent ${String(index)}`,
        },
        workspacePolicy: { allowedModes: ["in_place"] },
      };
      const revision = profileRegistry.importManifest(manifest);
      profileRegistry.recordProbeReport(
        await implementations.probeRevision(revision, {
          cwd: stateDirectory,
        }),
      );
      profileRegistry.activateRevision({
        contentDigest: revision.contentDigest,
        runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
      });
    }
    profileRegistry.close();
    seed.close();

    const base = validConfigV4(stateDirectory, secretPath);
    const config = DaemonConfigSchema.parse({
      ...base,
      host: {
        ...base.host,
        hostId,
        participantIds: agents.map((agent) => agent.principal.principalId),
      },
      runtimes: profileIds.map((runtimeProfileId, index) => ({
        credentialBindings: {},
        kind: "runtime-profile-registry",
        offer: {
          leaseMs: 1_000,
          maxConcurrent: 1,
          refreshIntervalMs: 100,
          runtimeOfferId: offerIds[index],
        },
        registryDatabasePath,
        runtimeProfileId,
      })),
      workspace: {
        ...base.workspace,
        workspaceDefinitionId: productWorkspace.workspace.workspaceId,
      },
    });
    let application = new DaemonApplication({
      config,
    });
    activeShutdown = new AbortController();
    running = application.run({ signal: activeShutdown.signal });
    observer = new RoomKernel({ databasePath });
    observer.initialize();
    const activeObserver = observer;
    await waitUntil(() => application.clientOrigin() !== undefined);
    const firstOrigin = application.clientOrigin();
    assert.ok(firstOrigin);
    const clientRequest = async (
      origin: string,
      path: string,
      body: Record<string, unknown>,
    ) =>
      await fetch(`${origin}${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${human.accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
    const requireJson = async <T>(response: Response): Promise<T> => {
      const body = (await response.json()) as T;
      assert.equal(response.status, 200, JSON.stringify(body));
      return body;
    };

    const runtimeInventory = await requireJson<{
      hostId: string;
      runtimes: Array<{
        agentBindings: Array<{ agentId: string }>;
        runtimeOfferId?: string;
        runtimeProfileId?: string;
      }>;
    }>(await clientRequest(firstOrigin, "/v1/local/runtimes/list", {}));
    assert.equal(runtimeInventory.hostId, hostId);
    const configuredInventory = runtimeInventory.runtimes.filter(
      ({ runtimeProfileId }) => runtimeProfileId !== undefined,
    );
    assert.deepEqual(
      configuredInventory.map(({ runtimeProfileId }) => runtimeProfileId),
      profileIds,
    );
    assert.deepEqual(
      configuredInventory
        .flatMap(({ agentBindings }) =>
          agentBindings.map(({ agentId }) => agentId),
        )
        .sort(),
      [...agentDefinitionIds].sort(),
    );

    const controlDelivery = await requireJson<{ latestRoomSeq: number }>(
      await clientRequest(firstOrigin, "/v3/client/rooms/sync", {
        consumerId: "p3c-browser-control",
        roomId: catalogRoom.roomId,
      }),
    );
    const roomCreated = await requireJson<{
      event: { roomSeq: number };
      room: { roomId: string };
    }>(
      await clientRequest(firstOrigin, "/v3/client/rooms/create", {
        basedOnControlRoomSeq: controlDelivery.latestRoomSeq,
        idempotencyKey: "p3c-room-created",
        kind: "channel",
        name: "P3C Multi-Agent Room",
        slug: "p3c-multi-agent-room",
        workspaceId: productWorkspace.workspace.workspaceId,
      }),
    );
    const roomId = roomCreated.room.roomId;

    const catalog = await requireJson<{
      agents: Array<{ definition: { agentId: string } }>;
    }>(
      await clientRequest(firstOrigin, "/v3/client/agents/list", {
        controlRoomId: catalogRoom.roomId,
      }),
    );
    assert.deepEqual(
      catalog.agents.map((entry) => entry.definition.agentId).sort(),
      [...agentDefinitionIds].sort(),
    );

    let roomSeq = 1;
    for (const [index, agentId] of agentDefinitionIds.entries()) {
      const onboarded = await requireJson<{ event: { roomSeq: number } }>(
        await clientRequest(firstOrigin, "/v3/client/rooms/members/add", {
          principalId: agents[index]!.principal.principalId,
          role: "member",
          basedOnRoomSeq: roomSeq,
          idempotencyKey: `p3c-agent-onboard-${String(index)}`,
          roomId,
        }),
      );
      roomSeq = onboarded.event.roomSeq;
      bindRoleDefinitionFixture(
        activeObserver,
        humanActor,
        databasePath,
        agentId,
        roomId,
        offerIds[index]!,
      );
    }

    const initialDelivery = await requireJson<{
      cursorAfter: number;
      latestRoomSeq: number;
    }>(
      await clientRequest(firstOrigin, "/v3/client/rooms/sync", {
        consumerId: "p3c-browser-main",
        roomId,
      }),
    );
    assert.equal(initialDelivery.latestRoomSeq, roomSeq);
    await requireJson(
      await clientRequest(firstOrigin, "/v3/client/rooms/acknowledge", {
        consumerId: "p3c-browser-main",
        roomId,
        throughSeq: initialDelivery.cursorAfter,
      }),
    );

    const message = await requireJson<{
      event: { aggregateId: string; roomSeq: number };
    }>(
      await clientRequest(firstOrigin, "/v3/client/messages/post", {
        basedOnRoomSeq: roomSeq,
        body: "Two Agents must understand the same canonical Room request",
        idempotencyKey: "p3c-message-posted",
        recipients: [],
        roomId,
      }),
    );
    roomSeq = message.event.roomSeq;
    await waitUntil(
      () =>
        activeObserver
          .listMessages(humanActor, { roomId })
          .messages.filter((candidate) =>
            agents.some(
              (agent) => agent.principal.principalId === candidate.actorId,
            ),
          ).length === 2 &&
        activeObserver
          .listActivations({ roomId })
          .every((activation) => activation.state === "completed"),
      5_000,
    );
    const heldObserver = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.equal(
        heldObserver
          .prepare(
            "SELECT count(*) AS n FROM held_message_drafts WHERE room_id=?",
          )
          .get(roomId)!.n,
        0,
        "parallel non-directed peer replies must not create held drafts",
      );
    } finally {
      heldObserver.close();
    }
    const postMessageDelivery = await requireJson<{ latestRoomSeq: number }>(
      await clientRequest(firstOrigin, "/v3/client/rooms/sync", {
        consumerId: "p3c-browser-main",
        roomId,
      }),
    );
    roomSeq = postMessageDelivery.latestRoomSeq;
    const thread = await requireJson<{
      event: { roomSeq: number };
      thread: { threadId: string };
    }>(
      await clientRequest(firstOrigin, "/v3/client/threads/create", {
        basedOnRoomSeq: roomSeq,
        idempotencyKey: "p3c-thread-created",
        recipientIds: [],
        roomId,
        rootMessageId: message.event.aggregateId,
      }),
    );
    roomSeq = thread.event.roomSeq;
    const reply = await requireJson<{ event: { roomSeq: number } }>(
      await clientRequest(firstOrigin, "/v3/client/threads/reply", {
        basedOnRoomSeq: roomSeq,
        body: "This reply remains independent of every provider session",
        idempotencyKey: "p3c-thread-replied",
        recipientIds: [],
        roomId,
        threadId: thread.thread.threadId,
      }),
    );
    roomSeq = reply.event.roomSeq;
    const taskCreated = await requireJson<{
      event: { roomSeq: number };
      task: { taskId: string };
    }>(
      await clientRequest(firstOrigin, "/v3/client/tasks/create", {
        basedOnRoomSeq: roomSeq,
        idempotencyKey: "p3c-open-task-created",
        roomId,
        title: "Prove one winner across two daemon lanes",
      }),
    );
    const taskId = taskCreated.task.taskId;

    try {
      await waitUntil(
        () =>
          activeObserver.listTasks(humanActor, { roomId })[0]?.state ===
            "submitted" &&
          activeObserver
            .listActivations({ roomId })
            .every((activation) => activation.state === "completed"),
        5_000,
      );
    } catch (error) {
      throw new Error(
        `daemon v4 did not converge: ${JSON.stringify(
          {
            activations: activeObserver.listActivations({
              roomId,
            }),
            health: application.health(),
            hosts: activeObserver.listHosts(),
            originalError: String(error),
            placements: activeObserver.listPlacements({ roomId }),
            runs: activeObserver.listRunAttempts({ roomId }),
            tasks: activeObserver.listTasks(humanActor, { roomId }),
          },
          null,
          2,
        )}`,
      );
    }

    assert.deepEqual(
      application.health().participantIds,
      agents.map((agent) => agent.principal.principalId).sort(),
    );
    assert.deepEqual(
      [
        ...new Set(
          activeObserver
            .listPlacements({ roomId })
            .map((placement) => placement.runtimeOfferId),
        ),
      ].sort(),
      [...offerIds].sort(),
    );
    assert.deepEqual(
      [
        ...new Set(
          activeObserver
            .listRunAttempts({ roomId })
            .map((attempt) => attempt.participantId),
        ),
      ].sort(),
      agents.map((agent) => agent.principal.principalId).sort(),
    );
    const submittedTask = activeObserver.listTasks(humanActor, { roomId })[0];
    assert.ok(submittedTask);
    assert.equal(submittedTask?.taskId, taskId);
    assert.ok(
      agents.some(
        (agent) => agent.principal.principalId === submittedTask?.assigneeId,
      ),
      "the open Task must have exactly one catalog Agent winner",
    );
    const agentReplies = activeObserver
      .listMessages(humanActor, { roomId })
      .messages.filter(
        (candidate) =>
          candidate.threadId === undefined &&
          agents.some(
            (agent) => agent.principal.principalId === candidate.actorId,
          ),
      );
    assert.equal(
      agentReplies.length,
      2,
      "both Role instances publish their independent ordinary replies exactly once",
    );
    for (const [index, agent] of agents.entries()) {
      assert.deepEqual(
        agentReplies
          .filter((reply) => reply.actorId === agent.principal.principalId)
          .map((reply) => reply.body),
        [`Canonical daemon reply from Agent ${String(index)}`],
        "reply identity and body must match the actual runtime, with no duplicate",
      );
    }
    assert.deepEqual(
      activeObserver
        .listMessages(humanActor, {
          roomId,
          threadId: submittedTask.threadId,
        })
        .messages.map(({ body }) => body),
      [
        "Fake Worker verified the daemon Task command path",
        "Fake Worker completed the durable Task protocol",
      ],
    );

    const reviewDelivery = await requireJson<{ latestRoomSeq: number }>(
      await clientRequest(firstOrigin, "/v3/client/rooms/sync", {
        consumerId: "p3c-human-review",
        roomId,
      }),
    );
    await requireJson(
      await clientRequest(firstOrigin, "/v3/client/tasks/complete", {
        basedOnRoomSeq: reviewDelivery.latestRoomSeq,
        idempotencyKey: "p3c-task-completed",
        taskId,
      }),
    );
    assert.equal(
      activeObserver.listTasks(humanActor, { roomId })[0]?.state,
      "completed",
    );

    const provisionSequence = await requireJson<{ latestRoomSeq: number }>(
      await clientRequest(firstOrigin, "/v3/client/rooms/sync", {
        consumerId: "p3c-agent-provision",
        roomId: catalogRoom.roomId,
      }),
    );
    const reviewerRole = await requireJson<{ role: { roleId: string } }>(
      await clientRequest(firstOrigin, "/v3/client/roles/create", {
        basedOnRoomSeq: provisionSequence.latestRoomSeq,
        controlRoomId: catalogRoom.roomId,
        idempotencyKey: "p3c-review-role",
        configuration: {
          displayName: "Review Agent",
          handle: "review-agent",
          instructions: "Review canonical Room work before release.",
          modelIntent: { fallback: "disabled", reasoning: "default" },
          role: "Release reviewer",
          runtimeOfferId: offerIds[0],
          executionWorkspace: { kind: "agent_private" },
        },
      }),
    );
    const provisionedAgent = await requireJson<{
      agent: {
        definition: { participantId: string };
        handle: string;
        currentRevision: { executionWorkspace?: { kind: string } };
      };
    }>(
      await clientRequest(firstOrigin, "/v3/client/roles/instantiate", {
        roleId: reviewerRole.role.roleId,
        channelId: roomId,
        basedOnRoomSeq: latestRoomSeq(activeObserver, humanActor, roomId),
        idempotencyKey: "p3c-review-instance",
      }),
    );
    assert.ok(provisionedAgent.agent.handle.startsWith("review-agent-"));
    assert.equal(
      provisionedAgent.agent.currentRevision.executionWorkspace?.kind,
      "agent_private",
    );
    const privateId = provisionedAgent.agent.definition.participantId;
    activeObserver.addMember(humanActor, { roomId, principalId: privateId });
    const privateTask = activeObserver.createTask(humanActor, {
      roomId,
      assigneeId: privateId,
      title: "Run in private cwd",
      idempotencyKey: "private-cwd-task",
    });
    await waitUntil(
      () =>
        activeObserver
          .listTasks(humanActor, { roomId })
          .some(
            (task) =>
              task.taskId === privateTask.task.taskId &&
              task.state === "submitted",
          ),
      5000,
    );
    const privatePlacement = activeObserver
      .listPlacements({ roomId })
      .find((p) => p.participantId === privateId);
    assert.ok(privatePlacement);
    const privateProcesses = activeObserver
      .listRuntimeProcesses({ roomId })
      .filter((p) => p.participantId === privateId);
    assert.ok(privateProcesses.length > 0);
    assert.equal(
      privateProcesses[0]!.recoveryDescriptor.executionWorkspace
        ?.workspaceMountRevisionId,
      privatePlacement.workspaceMountRevisionId,
    );
    const { agentExecutionWorkspacePath } =
      await import("../../agent-host/src/agent-execution-workspace.ts");
    const privateCwd = agentExecutionWorkspacePath(
      join(realpathSync(stateDirectory), "agent-workspaces"),
      privateId,
    );
    assert.equal(
      readFileSync(join(privateCwd, "cwd-proof.txt"), "utf8"),
      privateCwd,
    );
    assert.equal(
      readFileSync(join(stateDirectory, "cwd-proof.txt"), "utf8"),
      realpathSync(stateDirectory),
    );

    activeShutdown.abort("p3c-first-daemon-stop");
    await running;
    running = undefined;
    activeShutdown = undefined;
    assert.equal(application.health().state, "offline");

    application = new DaemonApplication({
      config,
    });
    activeShutdown = new AbortController();
    running = application.run({ signal: activeShutdown.signal });
    await waitUntil(() => application.clientOrigin() !== undefined);
    assert.equal(
      readFileSync(join(privateCwd, "cwd-proof.txt"), "utf8"),
      privateCwd,
    );
    const restartedOrigin = application.clientOrigin();
    assert.ok(restartedOrigin);
    assert.ok(
      application
        .health()
        .participantIds.includes(
          provisionedAgent.agent.definition.participantId,
        ),
      "a manager-provisioned Agent must survive daemon restart without editing static config",
    );
    const recovered = await requireJson<{
      cursorAfter: number;
      cursorBefore: number;
      events: Array<{ type: string; aggregateId: string }>;
    }>(
      await clientRequest(restartedOrigin, "/v3/client/rooms/sync", {
        consumerId: "p3c-browser-main",
        roomId,
      }),
    );
    assert.equal(recovered.cursorBefore, initialDelivery.cursorAfter);
    const recoveredTypes = recovered.events.map((event) => event.type);
    for (const published of agentReplies) {
      assert.equal(
        recovered.events.filter(
          (event) =>
            event.type === "message.posted" &&
            event.aggregateId === published.messageId,
        ).length,
        1,
        "reconnect recovers each committed peer reply once from the durable ledger",
      );
    }
    for (const expectedType of [
      "message.posted",
      "thread.created",
      "task.created",
      "task.submitted",
      "task.completed",
    ]) {
      assert.ok(
        recoveredTypes.includes(expectedType),
        `reconnect must recover ${expectedType}`,
      );
    }
    await requireJson(
      await clientRequest(restartedOrigin, "/v3/client/rooms/acknowledge", {
        consumerId: "p3c-browser-main",
        roomId,
        throughSeq: recovered.cursorAfter,
      }),
    );
    const completedTasks = await requireJson<{
      tasks: Array<{ state: string; taskId: string }>;
    }>(
      await clientRequest(restartedOrigin, "/v3/client/tasks/list", {
        roomId,
      }),
    );
    assert.equal(completedTasks.tasks.length, 2);
    assert.equal(
      completedTasks.tasks.find((task) => task.taskId === taskId)?.state,
      "completed",
    );
    assert.equal(
      completedTasks.tasks.find(
        (task) => task.taskId === privateTask.task.taskId,
      )?.state,
      "submitted",
    );

    activeShutdown.abort("p3c-e2e-complete");
    await running;
    running = undefined;
    activeShutdown = undefined;
    assert.equal(application.health().state, "offline");
  } finally {
    activeShutdown?.abort("daemon-v4-test-cleanup");
    await running?.catch(() => undefined);
    observer?.close();
    try {
      seed.close();
    } catch {
      // The seed connection was already closed before daemon startup.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

test("registry-backed daemon recovery resolves the frozen old revision after activation changes", async () => {
  if (process.platform === "win32") return;
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-old-recovery-"));
  try {
    chmodSync(directory, 0o700);
    const registry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "daemon-old-recovery-host",
    });
    registry.initialize();
    const implementations = new RuntimeImplementationRegistry();
    const baseManifest: RuntimeProfileManifestV2 = {
      adapter: {
        config: {},
        executable: process.execPath,
        fixedArgs: ["-e", "process.exit(0)"],
        kind: "generic-process/v1",
      },
      credentialSlots: [],
      declaredCapabilities: ["worker_commands"],
      displayName: "Old recovery revision",
      manifestVersion: 2,
      protocolFamily: "rah-worker-process/v1",
      recoveryDrivers: ["rah-process-supervisor-v1"],
      runtimeProfileId: "daemon-old-recovery-profile",
      staticEnv: {},
      workspacePolicy: { allowedModes: ["in_place"] },
    };
    const oldRevision = registry.importManifest(baseManifest);
    registry.recordProbeReport(
      await implementations.probeRevision(oldRevision, { cwd: directory }),
    );
    registry.activateRevision({
      contentDigest: oldRevision.contentDigest,
      runtimeProfileRevisionId: oldRevision.runtimeProfileRevisionId,
    });
    const currentRevision = registry.importManifest({
      ...baseManifest,
      displayName: "Current recovery revision",
    });
    registry.recordProbeReport(
      await implementations.probeRevision(currentRevision, { cwd: directory }),
    );
    registry.activateRevision({
      contentDigest: currentRevision.contentDigest,
      runtimeProfileRevisionId: currentRevision.runtimeProfileRevisionId,
    });
    assert.equal(
      registry.getRevision(oldRevision.runtimeProfileRevisionId).state,
      "inactive",
    );

    const recovery = createRegistryBackedRuntimeRecovery({
      cwd: directory,
      implementations,
      registry,
      supervisorDirectory: join(directory, "supervisors"),
    });
    const oldRuntime = recovery.resolve({
      driver: "rah-process-supervisor-v1",
      metadata: {},
      recoveryImplementationVersion: "rah-process-supervisor/v1",
      recoveryKey: "old-supervisor",
      runtimeProfileDigest: oldRevision.contentDigest,
      runtimeProfileRevisionId: oldRevision.runtimeProfileRevisionId,
    });
    assert.deepEqual(oldRuntime.recoveryDrivers, ["rah-process-supervisor-v1"]);
    assert.throws(
      () =>
        recovery.resolve({
          driver: "rah-process-supervisor-v1",
          metadata: {},
          recoveryImplementationVersion: "rah-process-supervisor/v1",
          recoveryKey: "forged-old-supervisor",
          runtimeProfileDigest: currentRevision.contentDigest,
          runtimeProfileRevisionId: oldRevision.runtimeProfileRevisionId,
        }),
      /profile digest mismatch/,
    );
    registry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the composed daemon runs a process Worker without an Agent PAT and restarts cleanly", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-e2e-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const secretPath = join(stateDirectory, "host.token");
  const seed = new RoomKernel({ databasePath });
  let roomId = "";
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "daemon-e2e-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({
      handle: "daemon-e2e-agent",
      kind: "agent",
    });
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const room = seed.createRoom(humanActor, {
      name: "Daemon E2E",
      slug: "daemon-e2e",
    });
    roomId = room.roomId;
    seed.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId,
    });
    seed.postMessage(humanActor, {
      body: "Run through the composed daemon",
      idempotencyKey: "daemon-e2e-message",
      recipients: [
        {
          participantId: agent.principal.principalId,
          reason: "mention",
        },
      ],
      roomId,
    });
    const hostCredential = seed.provisionHostCredential({
      hostId: "daemon-e2e-host",
      participantIds: [agent.principal.principalId],
    });
    writeFileSync(secretPath, `${hostCredential.accessToken}\n`, {
      mode: 0o600,
    });
    seed.close();

    const config = DaemonConfigSchema.parse({
      ...validConfig(stateDirectory, secretPath),
      managedMcpExecutors: [
        {
          bearerToken: {
            source: "file",
            path: join(directory, "missing-retired-secret"),
          },
          transport: "invalid-and-ignored",
        },
      ],
      host: {
        credential: { path: secretPath, source: "file" },
        hostId: "daemon-e2e-host",
        participantId: agent.principal.principalId,
      },
    });
    const application = new DaemonApplication({ config });
    const shutdown = new AbortController();
    const running = application.run({ signal: shutdown.signal });
    const observer = new RoomKernel({ databasePath });
    observer.initialize();
    await waitUntil(
      () => observer.listActivations({ roomId })[0]?.state === "completed",
    );
    const clientOrigin = application.clientOrigin();
    assert.ok(clientOrigin);
    const healthResponse = await fetch(`${clientOrigin}/v1/client/health`);
    assert.equal(healthResponse.status, 200);
    shutdown.abort("test-complete");
    await running;

    assert.equal(observer.listHosts()[0]?.state, "offline");
    assert.equal(application.health().state, "offline");
    assert.equal(application.clientOrigin(), undefined);
    observer.close();

    const restarted = new DaemonApplication({ config });
    const restartShutdown = new AbortController();
    const restartRun = restarted.run({ signal: restartShutdown.signal });
    await waitUntil(() => restarted.health().state === "online");
    restartShutdown.abort("restart-proven");
    await restartRun;
    assert.equal(restarted.health().state, "offline");
  } finally {
    try {
      seed.close();
    } catch {
      // The seed connection was already closed before the daemon started.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

test("daemon config v3 probes an active profile, publishes a redacted offer, and resolves secrets only at spawn", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-registry-e2e-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const registryDatabasePath = join(stateDirectory, "runtime-registry.db");
  const hostSecretPath = join(stateDirectory, "host.token");
  const providerSecretPath = join(stateDirectory, "provider.token");
  const runtimeExecutablePath = join(stateDirectory, "fake-worker");
  const providerSecret = "provider-secret-never-public";
  writeFileSync(providerSecretPath, providerSecret, { mode: 0o600 });
  writeFileSync(
    runtimeExecutablePath,
    `#!/bin/sh\nexec ${process.execPath} ${fakeCliPath}\n`,
    { mode: 0o700 },
  );
  const seed = new RoomKernel({ databasePath });
  const shutdown = new AbortController();
  let running: Promise<void> | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "daemon-registry-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({
      handle: "daemon-registry-agent",
      kind: "agent",
    });
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const room = seed.createRoom(humanActor, {
      name: "Daemon Registry E2E",
      slug: "daemon-registry-e2e",
    });
    seed.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    const hostCredential = seed.provisionHostCredential({
      hostId: "daemon-registry-host",
      participantIds: [agent.principal.principalId],
    });
    writeFileSync(hostSecretPath, `${hostCredential.accessToken}\n`, {
      mode: 0o600,
    });

    const manifest: RuntimeProfileManifestV2 = {
      adapter: {
        config: { terminationGraceMs: 1_000 },
        executable: runtimeExecutablePath,
        fixedArgs: [],
        kind: "generic-process/v1",
      },
      credentialSlots: [
        {
          slotId: "provider-token",
          target: { kind: "environment", variable: "PROVIDER_TOKEN" },
        },
      ],
      declaredCapabilities: ["worker_commands"],
      displayName: "Daemon registry fake worker",
      manifestVersion: 2,
      protocolFamily: "rah-worker-process/v1",
      recoveryDrivers:
        process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
      runtimeProfileId: "daemon-registry-profile",
      staticEnv: { RAH_FAKE_MODE: "worker-sync" },
      workspacePolicy: { allowedModes: ["in_place"] },
    };
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: registryDatabasePath,
      hostId: "daemon-registry-host",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(manifest);
    const implementations = new RuntimeImplementationRegistry();
    profileRegistry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: stateDirectory }),
    );
    profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    profileRegistry.close();

    const loadedPaths: string[] = [];
    const fileSecrets = new FileSecretProvider();
    const recordingSecrets: SecretProvider = {
      load: async (reference) => {
        loadedPaths.push(reference.path);
        return await fileSecrets.load(reference);
      },
    };
    const config = DaemonConfigSchema.parse({
      ...validConfig(stateDirectory, hostSecretPath),
      host: {
        credential: { path: hostSecretPath, source: "file" },
        hostId: "daemon-registry-host",
        participantId: agent.principal.principalId,
      },
      retryAfterMs: 1_000,
      runtime: {
        credentialBindings: {
          "provider-token": { path: providerSecretPath, source: "file" },
        },
        cwd: stateDirectory,
        kind: "runtime-profile-registry",
        offer: {
          leaseMs: 1_000,
          maxConcurrent: 1,
          refreshIntervalMs: 100,
          runtimeOfferId: "daemon-registry-offer",
        },
        registryDatabasePath,
        runtimeProfileId: manifest.runtimeProfileId,
      },
      schemaVersion: 3,
    });
    const application = new DaemonApplication({
      config,
      secretProvider: recordingSecrets,
    });
    running = application.run({ signal: shutdown.signal });
    await waitUntil(() => application.health().state === "online");
    assert.deepEqual(loadedPaths, [hostSecretPath]);

    seed.postMessage(humanActor, {
      body: "Wake the registry-backed fake worker",
      idempotencyKey: "daemon-registry-message",
      recipients: [
        {
          participantId: agent.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: room.roomId,
    });
    await waitUntil(
      () =>
        seed.listActivations({ roomId: room.roomId })[0]?.state === "completed",
    );
    assert.deepEqual(loadedPaths, [hostSecretPath, providerSecretPath]);

    const liveOfferDatabase = new DatabaseSync(databasePath);
    const lifecycleRegistry = new RuntimeProfileRegistry({
      databasePath: registryDatabasePath,
      hostId: "daemon-registry-host",
    });
    lifecycleRegistry.initialize();
    const replacement = lifecycleRegistry.importManifest({
      ...manifest,
      displayName: "Daemon registry replacement worker",
    });
    lifecycleRegistry.recordProbeReport(
      await implementations.probeRevision(replacement, { cwd: stateDirectory }),
    );
    lifecycleRegistry.activateRevision({
      contentDigest: replacement.contentDigest,
      runtimeProfileRevisionId: replacement.runtimeProfileRevisionId,
    });
    await waitUntil(() => {
      const row = liveOfferDatabase
        .prepare(
          "SELECT offer_json FROM runtime_offers WHERE runtime_offer_id = ?",
        )
        .get("daemon-registry-offer") as { offer_json: string } | undefined;
      return (
        row !== undefined &&
        (JSON.parse(row.offer_json) as { state?: string }).state ===
          "unavailable"
      );
    });

    seed.postMessage(humanActor, {
      body: "The frozen daemon must not launch after the active revision changes",
      idempotencyKey: "daemon-registry-lifecycle-fence",
      recipients: [
        {
          participantId: agent.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: room.roomId,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(seed.listRunAttempts({ roomId: room.roomId }).length, 1);
    assert.equal(
      seed
        .listActivations({ roomId: room.roomId })
        .some((activation) => activation.state === "queued"),
      true,
    );
    assert.deepEqual(loadedPaths, [hostSecretPath, providerSecretPath]);

    lifecycleRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    await waitUntil(() => {
      const row = liveOfferDatabase
        .prepare(
          "SELECT offer_json FROM runtime_offers WHERE runtime_offer_id = ?",
        )
        .get("daemon-registry-offer") as { offer_json: string } | undefined;
      return (
        row !== undefined &&
        (JSON.parse(row.offer_json) as { state?: string }).state === "available"
      );
    });
    await waitUntil(() =>
      seed
        .listActivations({ roomId: room.roomId })
        .every((activation) => activation.state === "completed"),
    );
    assert.deepEqual(loadedPaths, [
      hostSecretPath,
      providerSecretPath,
      providerSecretPath,
    ]);

    rmSync(runtimeExecutablePath);
    await waitUntil(() => {
      const row = liveOfferDatabase
        .prepare(
          "SELECT offer_json FROM runtime_offers WHERE runtime_offer_id = ?",
        )
        .get("daemon-registry-offer") as { offer_json: string } | undefined;
      return (
        row !== undefined &&
        (JSON.parse(row.offer_json) as { state?: string }).state ===
          "unavailable"
      );
    });
    lifecycleRegistry.close();
    liveOfferDatabase.close();
    const liveRegistry = new RuntimeProfileRegistry({
      databasePath: registryDatabasePath,
      hostId: "daemon-registry-host",
    });
    liveRegistry.initialize();
    assert.equal(
      liveRegistry.getLatestProbeReport(revision.runtimeProfileRevisionId)
        ?.available,
      true,
      "lease withdrawal must not rewrite the immutable catalog probe",
    );
    liveRegistry.close();

    shutdown.abort("registry-e2e-complete");
    await running;
    running = undefined;
    const raw = new DatabaseSync(databasePath);
    const offerRow = raw
      .prepare(
        "SELECT offer_json FROM runtime_offers WHERE runtime_offer_id = ?",
      )
      .get("daemon-registry-offer") as { offer_json: string } | undefined;
    assert.ok(offerRow);
    const offer = JSON.parse(offerRow.offer_json) as Record<string, unknown>;
    assert.equal(offer.state, "unavailable");
    assert.equal(
      (offer.probeReportRef as { probeReportId?: string }).probeReportId !==
        undefined,
      true,
    );
    assert.equal(offerRow.offer_json.includes(providerSecret), false);
    assert.equal(offerRow.offer_json.includes(providerSecretPath), false);
    assert.equal(offerRow.offer_json.includes(registryDatabasePath), false);
    assert.equal(offerRow.offer_json.includes(runtimeExecutablePath), false);
    raw.close();
  } finally {
    shutdown.abort("test-cleanup");
    if (running !== undefined) await running.catch(() => undefined);
    try {
      seed.close();
    } catch {
      // The seed is closed below or by a failing setup path.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the composed daemon lets an opaque process complete the Task business protocol", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-task-e2e-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const secretPath = join(stateDirectory, "host.token");
  const seed = new RoomKernel({ databasePath });
  const shutdown = new AbortController();
  let running: Promise<void> | undefined;
  let observer: RoomKernel | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "daemon-task-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({
      handle: "daemon-task-agent",
      kind: "agent",
    });
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const room = seed.createRoom(humanActor, {
      name: "Daemon Task E2E",
      slug: "daemon-task-e2e",
    });
    seed.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    const created = seed.createTask(humanActor, {
      assigneeId: agent.principal.principalId,
      idempotencyKey: "daemon-task-created",
      roomId: room.roomId,
      title: "Submit through the Worker Task API",
    });
    const hostCredential = seed.provisionHostCredential({
      hostId: "daemon-task-host",
      participantIds: [agent.principal.principalId],
    });
    writeFileSync(secretPath, `${hostCredential.accessToken}\n`, {
      mode: 0o600,
    });
    seed.close();

    const config = DaemonConfigSchema.parse({
      ...validConfig(stateDirectory, secretPath),
      host: {
        credential: { path: secretPath, source: "file" },
        hostId: "daemon-task-host",
        participantId: agent.principal.principalId,
      },
      runtime: {
        ...validConfig(stateDirectory, secretPath).runtime,
        env: { RAH_FAKE_MODE: "worker-task" },
      },
    });
    const application = new DaemonApplication({ config });
    running = application.run({ signal: shutdown.signal });
    observer = new RoomKernel({ databasePath });
    observer.initialize();
    const activeObserver = observer;
    await waitUntil(
      () =>
        activeObserver.listActivations({ roomId: room.roomId })[0]?.state ===
          "completed" &&
        activeObserver.listTasks(humanActor, { roomId: room.roomId })[0]
          ?.state === "submitted",
      2_000,
    );

    const task = activeObserver.listTasks(humanActor, {
      roomId: room.roomId,
    })[0];
    assert.equal(task?.taskId, created.task.taskId);
    assert.equal(task?.state, "submitted");
    const taskEvents = activeObserver
      .sync(humanActor, {
        consumerId: "daemon-task-verifier",
        roomId: room.roomId,
      })
      .events.filter((event) => event.aggregateId === created.task.taskId)
      .map((event) => event.type);
    assert.deepEqual(taskEvents, [
      "task.created",
      "task.claimed",
      "task.started",
      "task.progressed",
      "task.submitted",
    ]);
  } finally {
    shutdown.abort("task-test-complete");
    await running?.catch(() => undefined);
    observer?.close();
    try {
      seed.close();
    } catch {
      // The seed connection was already closed before daemon startup.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the daemon retries rather than losing a Task when a Worker only acknowledges delivery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-task-retry-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const secretPath = join(stateDirectory, "host.token");
  const seed = new RoomKernel({ databasePath });
  const shutdown = new AbortController();
  let running: Promise<void> | undefined;
  let observer: RoomKernel | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "daemon-task-retry-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({
      handle: "daemon-task-retry-agent",
      kind: "agent",
    });
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const room = seed.createRoom(humanActor, {
      name: "Daemon Task retry",
      slug: "daemon-task-retry",
    });
    seed.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    seed.createTask(humanActor, {
      assigneeId: agent.principal.principalId,
      idempotencyKey: "daemon-unfinished-task-created",
      roomId: room.roomId,
      title: "Remain durable when the Worker does not submit",
    });
    const hostCredential = seed.provisionHostCredential({
      hostId: "daemon-task-retry-host",
      participantIds: [agent.principal.principalId],
    });
    writeFileSync(secretPath, `${hostCredential.accessToken}\n`, {
      mode: 0o600,
    });
    seed.close();

    const config = DaemonConfigSchema.parse({
      ...validConfig(stateDirectory, secretPath),
      host: {
        credential: { path: secretPath, source: "file" },
        hostId: "daemon-task-retry-host",
        participantId: agent.principal.principalId,
      },
    });
    const application = new DaemonApplication({ config });
    running = application.run({ signal: shutdown.signal });
    observer = new RoomKernel({ databasePath });
    observer.initialize();
    const activeObserver = observer;
    await waitUntil(() => {
      const activation = activeObserver.listActivations({
        roomId: room.roomId,
      })[0];
      return activation?.state === "queued" && activation.attemptCount > 0;
    });
    const activation = activeObserver.listActivations({
      roomId: room.roomId,
    })[0];
    assert.match(activation?.lastError ?? "", /unfinished Task/);
    assert.equal(
      activeObserver.listTasks(humanActor, { roomId: room.roomId })[0]?.state,
      "todo",
    );
  } finally {
    shutdown.abort("task-retry-test-complete");
    await running?.catch(() => undefined);
    observer?.close();
    try {
      seed.close();
    } catch {
      // The seed connection was already closed before daemon startup.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

test("D2 end to end: an ACK-only Worker on an assigned Task is fenced after three refusals, the fence does not hold the lane, and a new message's Activation completes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-task-fence-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const secretPath = join(stateDirectory, "host.token");
  const seed = new RoomKernel({ databasePath });
  const shutdown = new AbortController();
  let running: Promise<void> | undefined;
  let observer: RoomKernel | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "daemon-task-fence-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({
      handle: "daemon-task-fence-agent",
      kind: "agent",
    });
    const agentId = agent.principal.principalId;
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const room = seed.createRoom(humanActor, {
      name: "Daemon Task fence",
      slug: "daemon-task-fence",
    });
    seed.addMember(humanActor, { principalId: agentId, roomId: room.roomId });
    seed.createTask(humanActor, {
      assigneeId: agentId,
      idempotencyKey: "daemon-fenced-task-created",
      roomId: room.roomId,
      title: "Remain durable when the Worker does not submit",
    });
    const hostCredential = seed.provisionHostCredential({
      hostId: "daemon-task-fence-host",
      participantIds: [agentId],
    });
    writeFileSync(secretPath, `${hostCredential.accessToken}\n`, {
      mode: 0o600,
    });
    seed.close();

    const config = DaemonConfigSchema.parse({
      ...validConfig(stateDirectory, secretPath),
      host: {
        credential: { path: secretPath, source: "file" },
        hostId: "daemon-task-fence-host",
        participantId: agentId,
      },
      retryAfterMs: 0,
    });
    const application = new DaemonApplication({ config });
    running = application.run({ signal: shutdown.signal });
    observer = new RoomKernel({ databasePath });
    observer.initialize();
    const activeObserver = observer;
    await waitUntil(
      () =>
        activeObserver.listActivations({ roomId: room.roomId })[0]?.state ===
        "quarantined",
      10_000,
    );
    const fenced = activeObserver.listActivations({ roomId: room.roomId })[0]!;
    assert.equal(fenced.attemptCount, 3);
    const blocked = activeObserver
      .listRoomAgentActivity(humanActor, { roomId: room.roomId })
      .find((entry) => entry.participantId === agentId)?.blocked;
    assert.equal(blocked?.activationId, fenced.activationId);
    assert.equal(blocked?.holdsLane, false);
    assert.match(blocked?.reason ?? "", /unfinished Task/u);

    activeObserver.postMessage(humanActor, {
      body: "a new question",
      idempotencyKey: "daemon-fence-new-message",
      recipients: [{ participantId: agentId, reason: "mention" }],
      roomId: room.roomId,
    });
    await waitUntil(
      () =>
        activeObserver
          .listActivations({ roomId: room.roomId })
          .some(
            (activation) =>
              activation.activationId !== fenced.activationId &&
              activation.state === "completed",
          ),
      10_000,
    );
    assert.equal(
      activeObserver
        .listActivations({ roomId: room.roomId })
        .find((activation) => activation.activationId === fenced.activationId)
        ?.state,
      "quarantined",
    );
    assert.equal(
      activeObserver.listTasks(humanActor, { roomId: room.roomId })[0]?.state,
      "todo",
    );
  } finally {
    shutdown.abort("task-fence-test-complete");
    await running?.catch(() => undefined);
    observer?.close();
    try {
      seed.close();
    } catch {
      // The seed connection was already closed before daemon startup.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

test("D1 end to end: a Worker that claims the head message as its own Task and posts one final reply completes its Activation with a single reply", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-self-claim-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const secretPath = join(stateDirectory, "host.token");
  const seed = new RoomKernel({ databasePath });
  const shutdown = new AbortController();
  let running: Promise<void> | undefined;
  let observer: RoomKernel | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "daemon-self-claim-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({
      handle: "daemon-self-claim-agent",
      kind: "agent",
    });
    const agentId = agent.principal.principalId;
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const room = seed.createRoom(humanActor, {
      name: "Daemon self claim",
      slug: "daemon-self-claim",
    });
    seed.updateWorkspaceRoom(humanActor, {
      roomId: room.roomId,
      name: room.name,
      visibility: "private",
      allowInstanceTaskCreation: true,
      basedOnRoomSeq: 1,
      idempotencyKey: "allow-task-creation",
    });
    seed.addMember(humanActor, { principalId: agentId, roomId: room.roomId });
    seed.postMessage(humanActor, {
      body: "New task: review these files read-only and summarize in the channel",
      idempotencyKey: "daemon-self-claim-request",
      recipients: [{ participantId: agentId, reason: "mention" }],
      roomId: room.roomId,
    });
    const hostCredential = seed.provisionHostCredential({
      hostId: "daemon-self-claim-host",
      participantIds: [agentId],
    });
    writeFileSync(secretPath, `${hostCredential.accessToken}\n`, {
      mode: 0o600,
    });
    seed.close();

    const base = validConfig(stateDirectory, secretPath);
    const config = DaemonConfigSchema.parse({
      ...base,
      host: {
        credential: { path: secretPath, source: "file" },
        hostId: "daemon-self-claim-host",
        participantId: agentId,
      },
      retryAfterMs: 0,
      runtime: { ...base.runtime, env: { RAH_FAKE_MODE: "worker-self-claim" } },
    });
    const application = new DaemonApplication({ config });
    running = application.run({ signal: shutdown.signal });
    observer = new RoomKernel({ databasePath });
    observer.initialize();
    const activeObserver = observer;
    await waitUntil(() => {
      const state = activeObserver.listActivations({ roomId: room.roomId })[0]
        ?.state;
      return state === "completed" || state === "quarantined";
    }, 10_000);
    const [activation] = activeObserver.listActivations({
      roomId: room.roomId,
    });
    assert.equal(activation?.state, "completed", activation?.lastError);
    assert.equal(activation?.attemptCount, 1);
    const events = activeObserver.sync(humanActor, {
      consumerId: "daemon-self-claim-verifier",
      roomId: room.roomId,
    }).events;
    assert.equal(
      events.filter(
        (event) => event.type === "message.posted" && event.actorId === agentId,
      ).length,
      1,
      "exactly one reply",
    );
    assert.equal(
      events.some((event) => event.type.startsWith("activation.retry")),
      false,
    );
    assert.equal(
      activeObserver.listTasks(humanActor, { roomId: room.roomId })[0]?.state,
      "in_progress",
      "the Agent's own Task stays open; Activation completion does not touch it",
    );
  } finally {
    shutdown.abort("self-claim-test-complete");
    await running?.catch(() => undefined);
    observer?.close();
    try {
      seed.close();
    } catch {
      // The seed connection was already closed before daemon startup.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the daemon reacquires Task execution in a replacement Run without duplicate progress or delivery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-task-resume-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const secretPath = join(stateDirectory, "host.token");
  const resumeMarkerPath = join(stateDirectory, "resume-once.marker");
  const seed = new RoomKernel({ databasePath });
  const shutdown = new AbortController();
  let running: Promise<void> | undefined;
  let observer: RoomKernel | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "daemon-task-resume-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({
      handle: "daemon-task-resume-agent",
      kind: "agent",
    });
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const room = seed.createRoom(humanActor, {
      name: "Daemon Task resume",
      slug: "daemon-task-resume",
    });
    seed.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    const created = seed.createTask(humanActor, {
      assigneeId: agent.principal.principalId,
      idempotencyKey: "daemon-task-resume-created",
      roomId: room.roomId,
      title: "Resume after a partial Worker failure",
    });
    const hostCredential = seed.provisionHostCredential({
      hostId: "daemon-task-resume-host",
      participantIds: [agent.principal.principalId],
    });
    writeFileSync(secretPath, `${hostCredential.accessToken}\n`, {
      mode: 0o600,
    });
    seed.close();

    const config = DaemonConfigSchema.parse({
      ...validConfig(stateDirectory, secretPath),
      host: {
        credential: { path: secretPath, source: "file" },
        hostId: "daemon-task-resume-host",
        participantId: agent.principal.principalId,
      },
      retryAfterMs: 0,
      runtime: {
        ...validConfig(stateDirectory, secretPath).runtime,
        env: {
          RAH_FAKE_MODE: "worker-task-resume",
          RAH_FAKE_RESUME_MARKER: resumeMarkerPath,
        },
      },
    });
    const application = new DaemonApplication({ config });
    running = application.run({ signal: shutdown.signal });
    observer = new RoomKernel({ databasePath });
    observer.initialize();
    const activeObserver = observer;
    try {
      await waitUntil(
        () =>
          activeObserver.listTasks(humanActor, { roomId: room.roomId })[0]
            ?.state === "submitted" &&
          activeObserver.listActivations({ roomId: room.roomId })[0]?.state ===
            "completed",
        3_000,
      );
    } catch (error) {
      throw new Error(
        `Task resume did not converge: ${JSON.stringify(
          {
            activations: activeObserver.listActivations({
              roomId: room.roomId,
            }),
            originalError: String(error),
            runAttempts: activeObserver.listRunAttempts({
              roomId: room.roomId,
            }),
            tasks: activeObserver.listTasks(humanActor, {
              roomId: room.roomId,
            }),
          },
          null,
          2,
        )}`,
      );
    }

    const taskEvents = activeObserver
      .sync(humanActor, {
        consumerId: "daemon-task-resume-verifier",
        roomId: room.roomId,
      })
      .events.filter((event) => event.aggregateId === created.task.taskId)
      .map((event) => event.type);
    assert.deepEqual(taskEvents, [
      "task.created",
      "task.claimed",
      "task.started",
      // Execution acquisition belongs to each Run; durable work stays singular.
      "task.claimed",
      "task.started",
      "task.progressed",
      "task.submitted",
    ]);
    const acquisitionRuns = activeObserver
      .sync(humanActor, {
        consumerId: "daemon-task-resume-identity-verifier",
        roomId: room.roomId,
      })
      .events.filter(
        (event) =>
          event.aggregateId === created.task.taskId &&
          event.type === "task.claimed",
      )
      .map((event) => event.payload.runAttemptId);
    assert.equal(
      new Set(acquisitionRuns).size,
      2,
      "each claim belongs to a different real execution attempt",
    );
    assert.equal(
      activeObserver.listRunAttempts({ roomId: room.roomId }).length,
      2,
    );
  } finally {
    shutdown.abort("task-resume-test-complete");
    await running?.catch(() => undefined);
    observer?.close();
    try {
      seed.close();
    } catch {
      // The seed connection was already closed before daemon startup.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the daemon recovers a committed InputRequest, waits without a model, and resumes from resolution", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-task-input-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const secretPath = join(stateDirectory, "host.token");
  const resumeMarkerPath = join(stateDirectory, "input-resume-once.marker");
  const seed = new RoomKernel({ databasePath });
  const shutdown = new AbortController();
  let running: Promise<void> | undefined;
  let observer: RoomKernel | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "daemon-task-input-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({
      handle: "daemon-task-input-agent",
      kind: "agent",
    });
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const room = seed.createRoom(humanActor, {
      name: "Daemon Task input",
      slug: "daemon-task-input",
    });
    seed.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    const created = seed.createTask(humanActor, {
      assigneeId: agent.principal.principalId,
      idempotencyKey: "daemon-task-input-created",
      roomId: room.roomId,
      title: "Pause for a durable human decision",
    });
    const hostCredential = seed.provisionHostCredential({
      hostId: "daemon-task-input-host",
      participantIds: [agent.principal.principalId],
    });
    writeFileSync(secretPath, `${hostCredential.accessToken}\n`, {
      mode: 0o600,
    });
    seed.close();

    const config = DaemonConfigSchema.parse({
      ...validConfig(stateDirectory, secretPath),
      host: {
        credential: { path: secretPath, source: "file" },
        hostId: "daemon-task-input-host",
        participantId: agent.principal.principalId,
      },
      retryAfterMs: 0,
      runtime: {
        ...validConfig(stateDirectory, secretPath).runtime,
        env: {
          RAH_FAKE_MODE: "worker-task-input-resume",
          RAH_FAKE_RESUME_MARKER: resumeMarkerPath,
        },
      },
    });
    const application = new DaemonApplication({ config });
    running = application.run({ signal: shutdown.signal });
    observer = new RoomKernel({ databasePath });
    observer.initialize();
    const activeObserver = observer;
    await waitUntil(
      () =>
        application.clientOrigin() !== undefined &&
        activeObserver.listTasks(humanActor, { roomId: room.roomId })[0]
          ?.state === "waiting_input" &&
        activeObserver
          .listActivations({ roomId: room.roomId })
          .some((activation) => activation.state === "completed"),
    );
    const pending = activeObserver.listInputRequests(humanActor, {
      roomId: room.roomId,
    })[0];
    assert.equal(pending?.state, "pending");
    assert.equal(
      pending?.question,
      "Should the daemon remain loopback-only for this phase?",
    );
    assert.equal(
      activeObserver.listRunAttempts({ roomId: room.roomId }).length,
      2,
      "the second RunAttempt acknowledges the original range without recreating the InputRequest",
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(
      activeObserver.listRunAttempts({ roomId: room.roomId }).length,
      2,
      "waiting for the human must not keep spawning or polling an Agent CLI",
    );

    const clientOrigin = application.clientOrigin();
    assert.ok(clientOrigin);
    const clientRequest = async (path: string, body: Record<string, unknown>) =>
      await fetch(`${clientOrigin}${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${human.accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
    const healthResponse = await fetch(`${clientOrigin}/v1/client/health`);
    assert.equal(healthResponse.status, 200);
    const health = (await healthResponse.json()) as Record<string, unknown>;
    assert.equal(health.state, "online");
    assert.equal(health.apiVersion, 1);

    const pendingResponse = await clientRequest(
      "/v1/client/input-requests/list",
      { roomId: room.roomId, state: "pending" },
    );
    assert.equal(pendingResponse.status, 200);
    const pendingProjection = (await pendingResponse.json()) as {
      inputRequests: Array<{ inputRequestId: string }>;
    };
    assert.equal(
      pendingProjection.inputRequests[0]?.inputRequestId,
      pending?.inputRequestId,
    );
    const humanSyncResponse = await clientRequest("/v1/client/rooms/sync", {
      consumerId: "daemon-task-input-human",
      roomId: room.roomId,
    });
    assert.equal(humanSyncResponse.status, 200);
    const humanSync = (await humanSyncResponse.json()) as {
      latestRoomSeq: number;
    };
    assert.ok(pending);
    const resolveResponse = await clientRequest(
      "/v1/client/input-requests/resolve",
      {
        answer: "Yes, remain loopback-only",
        basedOnRoomSeq: humanSync.latestRoomSeq,
        idempotencyKey: "daemon-task-input-resolved",
        inputRequestId: pending.inputRequestId,
      },
    );
    assert.equal(resolveResponse.status, 200);
    const resolution = (await resolveResponse.json()) as {
      inputRequest: { state: string };
      task: { state: string };
    };
    assert.equal(resolution.inputRequest.state, "resolved");
    assert.equal(resolution.task.state, "todo");
    await waitUntil(
      () =>
        activeObserver.listTasks(humanActor, { roomId: room.roomId })[0]
          ?.state === "submitted" &&
        activeObserver
          .listActivations({ roomId: room.roomId })
          .filter((activation) => activation.state === "completed").length ===
          2,
      3_000,
    );

    assert.equal(
      activeObserver.listInputRequests(humanActor, {
        roomId: room.roomId,
      })[0]?.answer,
      "Yes, remain loopback-only",
    );
    assert.equal(
      activeObserver.listRunAttempts({ roomId: room.roomId }).length,
      3,
    );
    const workflowEvents = activeObserver
      .sync(humanActor, {
        consumerId: "daemon-task-input-verifier",
        roomId: room.roomId,
      })
      .events.filter(
        (event) =>
          event.aggregateId === created.task.taskId ||
          event.aggregateId === pending.inputRequestId,
      )
      .map((event) => event.type);
    assert.deepEqual(workflowEvents, [
      "task.created",
      "task.claimed",
      "task.started",
      "input.requested",
      "input.resolved",
      "task.claimed",
      "task.started",
      "task.progressed",
      "task.submitted",
    ]);
  } finally {
    shutdown.abort("task-input-test-complete");
    await running?.catch(() => undefined);
    observer?.close();
    try {
      seed.close();
    } catch {
      // The seed connection was already closed before daemon startup.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

test("an Outbox wake interrupts a long reconciliation poll without becoming authoritative", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-wake-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const secretPath = join(stateDirectory, "host.token");
  const seed = new RoomKernel({ databasePath });
  const shutdown = new AbortController();
  let running: Promise<void> | undefined;
  let observer: RoomKernel | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "daemon-wake-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({
      handle: "daemon-wake-agent",
      kind: "agent",
    });
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const room = seed.createRoom(humanActor, {
      name: "Daemon wake",
      slug: "daemon-wake",
    });
    seed.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    const credential = seed.provisionHostCredential({
      hostId: "daemon-wake-host",
      participantIds: [agent.principal.principalId],
    });
    writeFileSync(secretPath, `${credential.accessToken}\n`, { mode: 0o600 });
    seed.close();

    const config = DaemonConfigSchema.parse({
      ...validConfig(stateDirectory, secretPath),
      host: {
        credential: { path: secretPath, source: "file" },
        hostId: "daemon-wake-host",
        participantId: agent.principal.principalId,
      },
      pollIntervalMs: 60_000,
    });
    const application = new DaemonApplication({ config });
    running = application.run({ signal: shutdown.signal });
    observer = new RoomKernel({ databasePath });
    observer.initialize();
    const activeObserver = observer;
    await waitUntil(() => activeObserver.listHosts()[0]?.state === "online");
    await new Promise((resolve) => setTimeout(resolve, 50));

    const startedAt = Date.now();
    activeObserver.postMessage(
      activeObserver.authenticateAccessToken(human.accessToken),
      {
        body: "Wake the idle daemon from durable Outbox state",
        idempotencyKey: "daemon-wake-message",
        recipients: [
          {
            participantId: agent.principal.principalId,
            reason: "mention",
          },
        ],
        roomId: room.roomId,
      },
    );
    await waitUntil(
      () =>
        activeObserver.listActivations({ roomId: room.roomId })[0]?.state ===
        "completed",
      2_000,
    );
    assert.ok(Date.now() - startedAt < 2_000);
  } finally {
    shutdown.abort("wake-test-complete");
    await running?.catch(() => undefined);
    observer?.close();
    try {
      seed.close();
    } catch {
      // The seed connection was already closed before daemon startup.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the daemon executable handles a Room Activation and SIGTERM in a separate process", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-process-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const secretPath = join(stateDirectory, "host.token");
  const configPath = join(directory, "daemon.json");
  const seed = new RoomKernel({ databasePath });
  let child: ReturnType<typeof spawn> | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "daemon-process-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({
      handle: "daemon-process-agent",
      kind: "agent",
    });
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const room = seed.createRoom(humanActor, {
      name: "Daemon process",
      slug: "daemon-process",
    });
    seed.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    seed.postMessage(humanActor, {
      body: "Prove the executable process boundary",
      idempotencyKey: "daemon-process-message",
      recipients: [
        {
          participantId: agent.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: room.roomId,
    });
    const credential = seed.provisionHostCredential({
      hostId: "daemon-process-host",
      participantIds: [agent.principal.principalId],
    });
    writeFileSync(secretPath, `${credential.accessToken}\n`, { mode: 0o600 });
    writeFileSync(
      configPath,
      JSON.stringify({
        ...validConfig(stateDirectory, secretPath),
        host: {
          credential: { path: secretPath, source: "file" },
          hostId: "daemon-process-host",
          participantId: agent.principal.principalId,
        },
      }),
    );
    seed.close();

    child = spawn(process.execPath, [daemonCliPath, "--config", configPath], {
      cwd: directory,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const observer = new RoomKernel({ databasePath });
    observer.initialize();
    await waitUntil(
      () =>
        observer.listActivations({ roomId: room.roomId })[0]?.state ===
        "completed",
    );
    child.kill("SIGTERM");
    const exit = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child?.once("error", reject);
      child?.once("close", (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(exit, { code: 0, signal: null }, stderr);
    assert.equal(observer.listHosts()[0]?.state, "offline");
    observer.close();
  } finally {
    if (child !== undefined && child.exitCode === null) child.kill("SIGKILL");
    try {
      seed.close();
    } catch {
      // The seed connection was already closed before the daemon started.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

test("S2-0 daemon config accepts leftover-process hygiene caps per instance", () => {
  const base = validConfig("/tmp/rah-os-config-state", "/tmp/rah-os-secret");
  const parsed = DaemonConfigSchema.parse({
    ...base,
    processHygiene: {
      caps: { maxListeningPorts: 4 },
      capsByParticipant: { "instance-1": { maxProcesses: 8, maxRssKb: 1024 } },
    },
  });
  assert.deepEqual(parsed.processHygiene?.capsByParticipant?.["instance-1"], {
    maxProcesses: 8,
    maxRssKb: 1024,
  });
  for (const processHygiene of [
    { caps: { maxProcesses: 0 } },
    { caps: { maxCpu: 1 } },
    { unknown: true },
  ])
    assert.throws(() => DaemonConfigSchema.parse({ ...base, processHygiene }));
});

test("S2-a warm Codex runtimes are on by default (eighth review), with an explicit opt-out and a configurable idle TTL", () => {
  const base = validConfig("/tmp/rah-os-config-state", "/tmp/rah-os-secret");
  assert.equal(DaemonConfigSchema.parse(base).warmRuntimes, undefined);
  assert.ok(
    warmRuntimeAdapterKinds(undefined).has("codex-app-server/v1"),
    "an absent warmRuntimes block runs Codex warm",
  );
  assert.equal(
    warmRuntimeAdapterKinds(
      DaemonConfigSchema.parse({
        ...base,
        warmRuntimes: { codex: { enabled: false } },
      }).warmRuntimes,
    ).has("codex-app-server/v1"),
    false,
    "codex.enabled: false opts out",
  );
  const parsed = DaemonConfigSchema.parse({
    ...base,
    warmRuntimes: { codex: { enabled: true, idleTtlMs: 600_000 } },
  });
  assert.deepEqual(parsed.warmRuntimes, {
    codex: { enabled: true, idleTtlMs: 600_000 },
  });
  for (const warmRuntimes of [
    { codex: { idleTtlMs: 0 } },
    { claude: { idleTtlMs: 600_000 } },
    { kimi: { enabled: true } },
    { codex: { enabled: true, lru: 3 } },
  ])
    assert.throws(() => DaemonConfigSchema.parse({ ...base, warmRuntimes }));
});

test("S2-c3 warm OpenCode runtimes are on by default (eighth review), with a separate explicit opt-out", () => {
  const base = validConfig("/tmp/rah-os-config-state", "/tmp/rah-os-secret");
  assert.ok(warmRuntimeAdapterKinds(undefined).has("opencode-server/v1"));
  assert.deepEqual(
    warmRuntimeAdapterKinds(
      DaemonConfigSchema.parse({
        ...base,
        warmRuntimes: { opencode: { enabled: false } },
      }).warmRuntimes,
    ),
    new Set(["codex-app-server/v1"]),
    "opencode.enabled: false opts out of OpenCode only",
  );
  assert.deepEqual(
    warmRuntimeAdapterKinds(
      DaemonConfigSchema.parse({
        ...base,
        warmRuntimes: { codex: { enabled: false } },
      }).warmRuntimes,
    ),
    new Set(["opencode-server/v1"]),
    "opting out of Codex never disables OpenCode",
  );
  const parsed = DaemonConfigSchema.parse({
    ...base,
    warmRuntimes: { opencode: { enabled: true } },
  });
  assert.deepEqual(parsed.warmRuntimes, { opencode: { enabled: true } });
  assert.deepEqual(
    warmRuntimeAdapterKinds(parsed.warmRuntimes),
    new Set(["codex-app-server/v1", "opencode-server/v1"]),
  );
  assert.throws(() =>
    DaemonConfigSchema.parse({
      ...base,
      warmRuntimes: { opencode: { idleTtlMs: 1_000 } },
    }),
  );
});

test("S2-c1 warm Claude runtimes stay a separate opt-in, off by default", () => {
  const base = validConfig("/tmp/rah-os-config-state", "/tmp/rah-os-secret");
  assert.deepEqual(
    warmRuntimeAdapterKinds(undefined),
    new Set(["codex-app-server/v1", "opencode-server/v1"]),
    "the defaults never run Claude warm",
  );
  assert.equal(
    warmRuntimeAdapterKinds(
      DaemonConfigSchema.parse({
        ...base,
        warmRuntimes: { codex: { enabled: true } },
      }).warmRuntimes,
    ).has("claude-stream-json/v1"),
    false,
    "enabling Codex never enables Claude",
  );
  const parsed = DaemonConfigSchema.parse({
    ...base,
    warmRuntimes: {
      claude: { enabled: true },
      codex: { enabled: false },
      opencode: { enabled: false },
    },
  });
  assert.deepEqual(
    warmRuntimeAdapterKinds(parsed.warmRuntimes),
    new Set(["claude-stream-json/v1"]),
  );
  assert.deepEqual(
    warmRuntimeAdapterKinds(
      DaemonConfigSchema.parse({
        ...base,
        warmRuntimes: {
          claude: { enabled: false },
          codex: { enabled: false },
          opencode: { enabled: false },
          idleTtlMs: 900_000,
        },
      }).warmRuntimes,
    ),
    new Set(),
    "every warm runtime can be switched off explicitly",
  );
});

test("the daemon composes the warm pool and leftover-process hygiene by default; switching Codex and OpenCode off keeps only the janitor pool", () => {
  if (process.platform !== "darwin" && process.platform !== "linux") return;
  const directory = mkdtempSync(join(tmpdir(), "rah-os-warm-default-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  kernel.initialize();
  try {
    const agent = kernel.provisionPrincipal({ handle: "w", kind: "agent" });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "warm-default-host",
        participantIds: [agent.principal.principalId],
      }).accessToken,
    );
    const base = DaemonConfigSchema.parse(
      validConfig(directory, join(directory, "secret")),
    );
    const composed = createDaemonRuntimeHygiene(base, host, kernel);
    assert.ok(composed.instanceRuntimePool instanceof InstanceRuntimePool);
    assert.ok(composed.processHygiene !== undefined, "leftover sweeps stay on");
    assert.deepEqual(
      composed.warmRuntimeKinds,
      new Set(["codex-app-server/v1", "opencode-server/v1"]),
    );
    const off = createDaemonRuntimeHygiene(
      DaemonConfigSchema.parse({
        ...validConfig(directory, join(directory, "secret")),
        warmRuntimes: {
          codex: { enabled: false },
          opencode: { enabled: false },
        },
      }),
      host,
      kernel,
    );
    // Review batch 1 #7: nothing runs warm, but the pool stays for the
    // janitor and start fence over live rows an earlier Host left behind.
    assert.ok(off.instanceRuntimePool instanceof InstanceRuntimePool);
    assert.deepEqual(off.warmRuntimeKinds, new Set());
    // The persisted Host run cap is the pool's busy cap from construction:
    // a later runtime reduction only reaches the Kernel placement caps.
    const capped = createDaemonRuntimeHygiene(base, host, kernel, 3);
    assert.equal(capped.instanceRuntimePool?.policy.maxBusyTurns, 3);
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("S2-b warm runtime policies are configurable; policies alone keep the warm defaults", () => {
  const base = validConfig("/tmp/rah-os-config-state", "/tmp/rah-os-secret");
  const policy = {
    admissionWaitMs: 30_000,
    emergencyRssKb: 6 * 1024 * 1024,
    expensiveResumeMs: 10_000,
    expensiveResumeTtlMultiplier: 2,
    idleTtlMs: 900_000,
    maxAgeMs: 3_600_000,
    maxBusyTurns: 4,
    maxWarm: 3,
    recycleRssKb: 1024 * 1024,
    stallRetryBudget: 0,
  };
  const parsed = DaemonConfigSchema.parse({
    ...base,
    warmRuntimes: { ...policy, codex: { enabled: false } },
  });
  assert.deepEqual(parsed.warmRuntimes, {
    ...policy,
    codex: { enabled: false },
  });
  assert.equal(
    DaemonConfigSchema.parse({ ...base, warmRuntimes: policy }).warmRuntimes
      ?.codex,
    undefined,
  );
  assert.deepEqual(
    warmRuntimeAdapterKinds(
      DaemonConfigSchema.parse({ ...base, warmRuntimes: policy }).warmRuntimes,
    ),
    new Set(["codex-app-server/v1", "opencode-server/v1"]),
    "policies alone neither disable Codex/OpenCode nor enable Claude",
  );
  assert.doesNotThrow(
    () =>
      DaemonConfigSchema.parse({
        ...base,
        warmRuntimes: { stallMs: 600_000, toolStallMs: 1_200_000 },
      }),
    "retired stall keys (evo §37: runtime settings) still parse",
  );
  for (const bad of [
    { maxWarm: 0 },
    { admissionWaitMs: -1 },
    { stallRetryBudget: 1.5 },
    { recycleRssKb: 4, emergencyRssKb: 2 },
  ])
    assert.throws(
      () => DaemonConfigSchema.parse({ ...base, warmRuntimes: bad }),
      JSON.stringify(bad),
    );
});

function validConfig(stateDirectory: string, secretPath: string) {
  return {
    client: {
      bindHost: "127.0.0.1" as const,
      port: 0,
    },
    host: {
      credential: { path: secretPath, source: "file" as const },
      hostId: "config-host",
      participantId: "config-participant",
    },
    hostStaleAfterMs: 60_000,
    drainTimeoutMs: 30_000,
    leaseMs: 30_000,
    outboxLeaseMs: 5_000,
    outboxPollIntervalMs: 20,
    outboxRetryAfterMs: 1_000,
    pollIntervalMs: 20,
    runTimeoutMs: 30_000,
    runtimeCancelTimeoutMs: 10_000,
    runtimeRecoveryTimeoutMs: 30_000,
    runtimeStartTimeoutMs: 10_000,
    taskClaimLeaseMs: 30_000,
    taskClaimHeartbeatIntervalMs: 10_000,
    runtime: {
      args: [fakeCliPath],
      command: process.execPath,
      cwd: stateDirectory,
      env: { RAH_FAKE_MODE: "worker-sync" },
      kind: "generic-process" as const,
    },
    schemaVersion: 2 as const,
    stateDirectory,
  };
}

function validConfigV4(stateDirectory: string, secretPath: string) {
  const legacy = validConfig(stateDirectory, secretPath);
  const runtime = (suffix: "a" | "b") => ({
    credentialBindings: {},
    kind: "runtime-profile-registry" as const,
    offer: {
      leaseMs: 120_000,
      maxConcurrent: 1,
      refreshIntervalMs: 30_000,
      runtimeOfferId: `offer-config-v4-${suffix}`,
    },
    registryDatabasePath: join(stateDirectory, "runtime-registry.db"),
    runtimeProfileId: `profile-config-v4-${suffix}`,
  });
  return {
    client: legacy.client,
    drainTimeoutMs: legacy.drainTimeoutMs,
    host: {
      credential: { path: secretPath, source: "file" as const },
      hostId: "config-v4-host",
      maxConcurrent: 2,
      participantIds: ["agent-a", "agent-b"],
    },
    hostStaleAfterMs: legacy.hostStaleAfterMs,
    leaseMs: legacy.leaseMs,
    outboxLeaseMs: legacy.outboxLeaseMs,
    outboxPollIntervalMs: legacy.outboxPollIntervalMs,
    outboxRetryAfterMs: legacy.outboxRetryAfterMs,
    pollIntervalMs: legacy.pollIntervalMs,
    runtimes: [runtime("a"), runtime("b")],
    runTimeoutMs: legacy.runTimeoutMs,
    runtimeCancelTimeoutMs: legacy.runtimeCancelTimeoutMs,
    runtimeRecoveryTimeoutMs: legacy.runtimeRecoveryTimeoutMs,
    runtimeStartTimeoutMs: legacy.runtimeStartTimeoutMs,
    schemaVersion: 4 as const,
    stateDirectory,
    // Channel homes stay inside the temporary state, never in ~/.loom.
    channelWorkspaceRoot: join(stateDirectory, "channel-workspaces"),
    taskClaimHeartbeatIntervalMs: legacy.taskClaimHeartbeatIntervalMs,
    taskClaimLeaseMs: legacy.taskClaimLeaseMs,
    workspace: {
      cwd: stateDirectory,
      mode: "in_place" as const,
      workspaceDefinitionId: "workspace-config-v4",
      workspaceMountDigest: `sha256:${"a".repeat(64)}`,
      workspaceMountRevisionId: "workspace-mount-config-v4-v1",
    },
  };
}

function latestRoomSeq(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  roomId: string,
): number {
  return kernel.sync(actor, { consumerId: "daemon-test-cursor", roomId })
    .latestRoomSeq;
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition was not met");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
