import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import { RoomKernel } from "@rah-os/kernel";
import type { RuntimeProfileManifestV2 } from "@rah-os/protocol";

import { DaemonApplication, DaemonConfigSchema } from "../src/index.ts";

const fakeCliPath = fileURLToPath(
  new URL("../../agent-host/test/fixtures/fake-cli.mjs", import.meta.url),
);

const handles = ["lead", "helper-a", "helper-b", "auditor"] as const;

test("one lead Agent splits a Human message into subtasks that two helper Agents claim, rework and finish", async () => {
  if (process.platform === "win32") return;
  const directory = mkdtempSync(join(tmpdir(), "rah-agent-task-split-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const registryDatabasePath = join(stateDirectory, "runtime-registry.db");
  const secretPath = join(stateDirectory, "host.token");
  const hostId = "agent-task-split-host";
  const seed = new RoomKernel({ databasePath });
  const shutdown = new AbortController();
  let running: Promise<void> | undefined;
  let observer: RoomKernel | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "split-human",
      kind: "human",
    });
    const agents = handles.map((handle) =>
      seed.provisionPrincipal({ handle, kind: "agent" }),
    );
    const [lead, helperA, helperB, auditor] = agents.map(
      (agent) => agent.principal.principalId,
    ) as [string, string, string, string];
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const workspace = seed.createWorkspace(humanActor, {
      idempotencyKey: "split-workspace-created",
      name: "Split Workspace",
      slug: "split-workspace",
    });
    const controlRoom = workspace.controlRoom;
    for (const agent of agents) {
      seed.addMember(humanActor, {
        principalId: agent.principal.principalId,
        roomId: controlRoom.roomId,
      });
    }

    const offerIds = handles.map((handle) => `split-offer-${handle}`);
    const profileIds = handles.map((handle) => `split-profile-${handle}`);
    const agentDefinitionIds: string[] = [];
    for (const [index, agent] of agents.entries()) {
      const policy = seed.createExecutionPolicy(humanActor, {
        basedOnRoomSeq: latestRoomSeq(seed, humanActor, controlRoom.roomId),
        controlRoomId: controlRoom.roomId,
        idempotencyKey: `split-policy-${String(index)}`,
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
          artifactId: `split-retry-${String(index)}`,
          contentDigest: `sha256:${String(index + 1).repeat(64)}`,
          versionId: `split-retry-${String(index)}-v1`,
        },
        sessionPolicy: "fresh",
        // The fixture is a provider-neutral generic process without a native
        // sandbox mapping, so restricted defaults would fail closed.
        toolAccessMode: "full_access",
      }).policy;
      const definition = seed.createAgentDefinition(humanActor, {
        basedOnRoomSeq: latestRoomSeq(seed, humanActor, controlRoom.roomId),
        controlRoomId: controlRoom.roomId,
        executionPolicyRevisionId: policy.executionPolicyRevisionId,
        idempotencyKey: `split-agent-definition-${String(index)}`,
        instructionRefs: [],
        memoryPolicyRef: {
          artifactId: `split-memory-${String(index)}`,
          contentDigest: `sha256:${String(index + 3).repeat(64)}`,
          versionId: `split-memory-${String(index)}-v1`,
        },
        participantId: agent.principal.principalId,
        role: `split worker ${handles[index]!}`,
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
    for (const [index, runtimeProfileId] of profileIds.entries()) {
      const manifest: RuntimeProfileManifestV2 = {
        adapter: {
          config: { terminationGraceMs: 1_000 },
          executable: process.execPath,
          fixedArgs: [fakeCliPath],
          kind: "generic-process/v1",
        },
        credentialSlots: [],
        declaredCapabilities: ["worker_commands"],
        displayName: `Split fake worker ${handles[index]!}`,
        manifestVersion: 2,
        protocolFamily: "rah-worker-process/v1",
        recoveryDrivers: ["rah-process-supervisor-v1"],
        runtimeProfileId,
        staticEnv:
          index === 0
            ? {
                RAH_FAKE_AUTO_TASK_MARKER: "[SPLIT]",
                RAH_FAKE_MODE: "worker-task",
                RAH_FAKE_SPLIT_HELPERS: "helper-a,helper-b",
                RAH_FAKE_PARENT_RESUME: "1",
                RAH_FAKE_READ_TOOLS: "1",
                RAH_FAKE_SPLIT_TITLES: "schema change,docs update",
              }
            : handles[index] === "auditor"
              ? {
                  RAH_FAKE_AUDIT_ON_MENTION: "1",
                  RAH_FAKE_READ_TOOLS: "1",
                  RAH_FAKE_MODE: "worker-task",
                }
              : {
                  RAH_FAKE_MODE: "worker-task",
                  RAH_FAKE_TASK_ATTRIBUTION: "1",
                  RAH_FAKE_TASK_TOOL_TRAJECTORY: "1",
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
        maxConcurrent: 4,
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
        workspaceDefinitionId: workspace.workspace.workspaceId,
      },
    });
    const application = new DaemonApplication({ config });
    running = application.run({ signal: shutdown.signal });
    observer = new RoomKernel({ databasePath });
    observer.initialize();
    const activeObserver = observer;
    await waitUntil(() => application.clientOrigin() !== undefined);
    const origin = application.clientOrigin();
    assert.ok(origin);

    const clientRequest = async <T>(
      path: string,
      body: Record<string, unknown>,
    ): Promise<T> => {
      const response = await fetch(`${origin}${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${human.accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
      const parsed = (await response.json()) as T;
      assert.equal(response.status, 200, JSON.stringify(parsed));
      return parsed;
    };

    const controlDelivery = await clientRequest<{ latestRoomSeq: number }>(
      "/v3/client/rooms/sync",
      { consumerId: "split-control", roomId: controlRoom.roomId },
    );
    const roomCreated = await clientRequest<{ room: { roomId: string } }>(
      "/v3/client/rooms/create",
      {
        basedOnControlRoomSeq: controlDelivery.latestRoomSeq,
        idempotencyKey: "split-room-created",
        kind: "channel",
        name: "Agent Split Room",
        slug: "agent-split-room",
        workspaceId: workspace.workspace.workspaceId,
      },
    );
    const roomId = roomCreated.room.roomId;

    // Background Activation bookkeeping keeps advancing the Room sequence, so a
    // Human command is issued at the latest head exactly as the client does.
    const humanMutation = async (
      path: string,
      body: Record<string, unknown>,
    ): Promise<void> => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const delivery = await clientRequest<{ latestRoomSeq: number }>(
          "/v3/client/rooms/sync",
          { consumerId: "split-human-console", roomId },
        );
        const response = await fetch(`${origin}${path}`, {
          body: JSON.stringify({
            ...body,
            basedOnRoomSeq: delivery.latestRoomSeq,
          }),
          headers: {
            authorization: `Bearer ${human.accessToken}`,
            "content-type": "application/json",
          },
          method: "POST",
        });
        const parsed = (await response.json()) as {
          error?: { code?: string };
        };
        if (response.status === 200) return;
        assert.equal(
          parsed.error?.code,
          "stale_context",
          `${path}: ${JSON.stringify(parsed)}`,
        );
      }
      throw new Error(`${path} never committed at the latest Room sequence`);
    };

    let roomSeq = 1;
    for (const [index, agentId] of agentDefinitionIds.entries()) {
      const onboarded = await clientRequest<{ event: { roomSeq: number } }>(
        "/v3/client/agents/onboard",
        {
          agentId,
          basedOnRoomSeq: roomSeq,
          idempotencyKey: `split-agent-onboard-${String(index)}`,
          roomId,
        },
      );
      roomSeq = onboarded.event.roomSeq;
    }

    // 1. The Human posts one top-level message that the lead must split.
    const humanMessage = await clientRequest<{
      event: { aggregateId: string; roomSeq: number };
    }>("/v3/client/messages/post", {
      basedOnRoomSeq: roomSeq,
      body: "[SPLIT] Ship the migration: write the schema change and update the docs",
      idempotencyKey: "split-message-posted",
      recipients: [],
      roomId,
    });

    // 2 + 3. The lead claims the message, creates two attributed subtasks and
    // mentions both helpers; each helper claims exactly one and submits it.
    const tasksOf = () => activeObserver.listTasks(humanActor, { roomId });
    // Human review is a separate turn: the Agents must have finished their
    // Activations before the Human acts, or the review lands inside an open
    // Activation window and is answered by a retry instead of a fresh wake.
    const agentsIdle = () =>
      activeObserver
        .listActivations({ roomId })
        .every(
          (activation) =>
            !agents.some(
              (agent) =>
                agent.principal.principalId === activation.participantId,
            ) ||
            (activation.state !== "queued" && activation.state !== "leased"),
        );
    await waitUntil(
      () =>
        tasksOf().length === 3 &&
        tasksOf().filter((task) => task.state === "submitted").length === 2 &&
        agentsIdle(),
      30_000,
    );
    const parentTask = tasksOf().find(
      (task) => task.sourceMessageId === humanMessage.event.aggregateId,
    );
    assert.ok(parentTask);
    const subtaskA = tasksOf().find((task) =>
      task.title.startsWith("Subtask A"),
    );
    const subtaskB = tasksOf().find((task) =>
      task.title.startsWith("Subtask B"),
    );
    assert.ok(subtaskA);
    assert.ok(subtaskB);
    assert.equal(subtaskA.title, "Subtask A (@helper-a): schema change");
    assert.equal(subtaskB.title, "Subtask B (@helper-b): docs update");
    assert.equal(subtaskA.assigneeId, helperA);
    assert.equal(subtaskB.assigneeId, helperB);

    // 5. The mechanisms behind the chain.
    const events = () => roomEvents(activeObserver, humanActor, roomId);
    const parentCreated = events().find(
      (event) =>
        event.type === "task.created" &&
        event.aggregateId === parentTask.taskId,
    );
    assert.equal(parentCreated?.actorId, lead);
    assert.equal(parentCreated?.payload.autoClaimed, true);
    assert.equal(
      parentCreated?.payload.sourceMessageId,
      humanMessage.event.aggregateId,
    );
    assert.equal(parentTask.assigneeId, lead);

    for (const subtask of [subtaskA, subtaskB]) {
      const created = events().find(
        (event) =>
          event.type === "task.created" && event.aggregateId === subtask.taskId,
      );
      assert.equal(created?.actorId, lead);
      assert.equal(created?.payload.creatorId, lead);
      assert.equal(created?.payload.assigneeId, undefined);
    }

    const note = events().find(
      (event) =>
        event.type === "message.posted" &&
        event.actorId === lead &&
        typeof event.payload.body === "string" &&
        event.payload.body.includes("@helper-a"),
    );
    assert.ok(note);
    assert.deepEqual(
      [
        ...(note.payload.recipients as {
          participantId: string;
          reason: string;
        }[]),
      ]
        .map(({ participantId, reason }) => ({ participantId, reason }))
        .sort((left, right) =>
          left.participantId.localeCompare(right.participantId),
        ),
      [
        { participantId: helperA, reason: "mention" },
        { participantId: helperB, reason: "mention" },
        // evo §37 A: an instance's note wakes only the instances it @s; the
        // unmentioned auditor is reached below by the Human's own @.
      ].sort((left, right) =>
        left.participantId.localeCompare(right.participantId),
      ),
    );

    // An Activation may coalesce several wakes, so the canonical per-event
    // delivery reason is the inbox item behind it.
    const raw = new DatabaseSync(databasePath, { readOnly: true });
    try {
      for (const [helper, subtask] of [
        [helperA, subtaskA],
        [helperB, subtaskB],
      ] as const) {
        const created = events().find(
          (event) =>
            event.type === "task.created" &&
            event.aggregateId === subtask.taskId,
        );
        assert.ok(created);
        const delivered = raw
          .prepare(
            "SELECT reason FROM inbox_items WHERE event_id = ? AND participant_id = ?",
          )
          .all(created.eventId, helper)
          .map((row) => row.reason);
        assert.deepEqual(delivered, ["task_available"]);
      }
    } finally {
      raw.close();
    }

    // 3b. No preset auditor role: the Human asks an ordinary Room Agent, by
    // @mention, to audit Subtask A. It reads the owner's recorded trajectory
    // through the Worker API and answers with concrete tool evidence.
    await humanMutation("/v3/client/messages/post", {
      body: `@auditor please audit Subtask A [AUDIT ${subtaskA.taskId}]`,
      idempotencyKey: "split-audit-requested",
      recipients: [{ participantId: auditor, reason: "mention" }],
      roomId,
    });
    const auditReply = () =>
      events().find(
        (event) =>
          event.type === "message.posted" &&
          event.actorId === auditor &&
          typeof event.payload.body === "string" &&
          event.payload.body.startsWith(`Audit of ${subtaskA.taskId}:`),
      );
    await waitUntil(() => auditReply() !== undefined && agentsIdle(), 30_000);
    const auditBody = auditReply()!.payload.body as string;
    assert.match(
      auditBody,
      /trajectory entries; tools: .*bash/u,
      `the audit reply must cite a tool the owner actually recorded: ${auditBody}`,
    );
    assert.equal(auditReply()!.payload.threadId, subtaskA.threadId);
    assert.match(
      auditBody,
      /read-tools: canonical history, task board, member handles, exact source/u,
    );
    assert.equal(
      tasksOf().some((task) => task.assigneeId === auditor),
      false,
      "an Agent asked to audit never claims a Task",
    );
    assert.equal(
      events().some(
        (event) => event.type === "task.claimed" && event.actorId === auditor,
      ),
      false,
    );

    // 4. The Human rejects Subtask A through the canonical status path
    // (closed, then reopened to todo) and the owner reworks it.
    await humanMutation("/v3/client/tasks/workflow", {
      idempotencyKey: "split-subtask-a-rejected",
      taskId: subtaskA.taskId,
      workflowStatus: "closed",
    });
    await humanMutation("/v3/client/tasks/workflow", {
      idempotencyKey: "split-subtask-a-reopened",
      taskId: subtaskA.taskId,
      workflowStatus: "todo",
    });
    await waitUntil(
      () =>
        events().filter(
          (event) =>
            event.type === "task.submitted" &&
            event.aggregateId === subtaskA.taskId,
        ).length === 2 && agentsIdle(),
      30_000,
    );

    // The Human accepts both subtasks.
    for (const [index, subtask] of [subtaskA, subtaskB].entries()) {
      await humanMutation("/v3/client/tasks/complete", {
        idempotencyKey: `split-subtask-completed-${String(index)}`,
        taskId: subtask.taskId,
      });
    }

    const finalTasks = () =>
      new Map(tasksOf().map((task) => [task.taskId, task]));
    assert.equal(finalTasks().get(subtaskA.taskId)?.state, "completed");
    assert.equal(finalTasks().get(subtaskB.taskId)?.state, "completed");
    const parentFinal = finalTasks().get(parentTask.taskId);
    assert.equal(parentFinal?.assigneeId, lead);
    assert.equal(parentFinal?.state, "blocked");

    const typesOf = (taskId: string) =>
      events()
        .filter((event) => event.aggregateId === taskId)
        .map((event) => event.type);
    assert.deepEqual(typesOf(parentTask.taskId), [
      "task.created",
      "task.started",
      "task.blocked",
    ]);
    assert.deepEqual(typesOf(subtaskA.taskId), [
      "task.created",
      "task.claimed",
      "task.started",
      "task.progressed",
      "task.submitted",
      "task.cancelled",
      "task.reopened",
      "task.claimed",
      "task.started",
      "task.progressed",
      "task.submitted",
      "task.completed",
    ]);
    assert.deepEqual(typesOf(subtaskB.taskId), [
      "task.created",
      "task.claimed",
      "task.started",
      "task.progressed",
      "task.submitted",
      "task.completed",
    ]);

    // Raft addresses a Task the way a Human reads it: `--target "#channel"
    // --number N`. Every helper started its subtask in exactly that form — the
    // fixture resolves the Room's channel, sends `tasks/start` with
    // `{ channel, taskNumber }`, and throws if that address resolves to any
    // other canonical Task — so a regression fails this chain instead of
    // silently falling back to `--task-id`.
    assert.match(
      readFileSync(fakeCliPath, "utf8"),
      /"\/v1\/worker\/tasks\/start",\s*\{\s*channel: taskChannel,\s*taskNumber: canonical\.task\.taskNumber,/u,
    );
    for (const subtask of [subtaskA, subtaskB])
      assert.ok(
        events().some(
          (event) =>
            event.aggregateId === subtask.taskId &&
            event.type === "task.started",
        ),
        subtask.taskId,
      );

    // Raft carries neither `--based-on-room-seq` nor `--idempotency-key` on a
    // Task command. Every Agent Task command in this chain — including the
    // rework round after task.reopened — was sent in that minimal form, so the
    // server keyed it, and the second round is not a deduplicated replay.
    const agentTaskEvents = events().filter(
      (event) =>
        event.aggregateType === "task" &&
        [lead, helperA, helperB].includes(event.actorId),
    );
    assert.ok(agentTaskEvents.length >= 12);
    for (const event of agentTaskEvents)
      assert.match(
        event.idempotencyKey,
        /^derived-task-/u,
        `${event.type} ${event.idempotencyKey}`,
      );

    // 6. Human asks the original blocker to resume. Its unblock Run exits;
    // durable task.unblocked attention grants a separate Run normal execution.
    await humanMutation("/v3/client/messages/post", {
      body: `@lead please resume [RESUME PARENT ${parentTask.taskId}]`,
      idempotencyKey: "parent-resume-requested",
      roomId,
      recipients: [{ participantId: lead, reason: "mention" }],
    });
    await waitUntil(
      () =>
        finalTasks().get(parentTask.taskId)?.state === "submitted" &&
        agentsIdle(),
      30_000,
    );
    await humanMutation("/v3/client/tasks/complete", {
      taskId: parentTask.taskId,
      idempotencyKey: "parent-completed",
    });
    assert.equal(finalTasks().get(parentTask.taskId)?.state, "completed");
    assert.deepEqual(typesOf(parentTask.taskId), [
      "task.created",
      "task.started",
      "task.blocked",
      "task.unblocked",
      "task.claimed",
      "task.started",
      "task.progressed",
      "task.submitted",
      "task.completed",
    ]);
    const parentEvents = events().filter(
      (event) => event.aggregateId === parentTask.taskId,
    );
    const resumed = parentEvents.find(
      (event) => event.type === "task.unblocked",
    )!;
    const reclaimed = parentEvents.find(
      (event) => event.type === "task.claimed",
    )!;
    assert.ok(resumed.payload.runAttemptId);
    assert.ok(reclaimed.payload.runAttemptId);
    assert.notEqual(
      resumed.payload.runAttemptId,
      reclaimed.payload.runAttemptId,
    );

    // 6. The same evidence survives a fresh connection to the same database.
    shutdown.abort("split-chain-complete");
    await running.catch(() => undefined);
    running = undefined;
    observer.close();
    observer = undefined;
    const reopened = new RoomKernel({ databasePath });
    try {
      reopened.initialize();
      const reopenedActor = reopened.authenticateAccessToken(human.accessToken);
      const persisted = new Map(
        reopened
          .listTasks(reopenedActor, { roomId })
          .map((task) => [task.taskId, task]),
      );
      assert.equal(persisted.size, 3);
      assert.equal(persisted.get(subtaskA.taskId)?.state, "completed");
      assert.equal(persisted.get(subtaskB.taskId)?.state, "completed");
      assert.equal(persisted.get(parentTask.taskId)?.state, "completed");
      assert.equal(persisted.get(parentTask.taskId)?.assigneeId, lead);
      const persistedEvents = roomEvents(reopened, reopenedActor, roomId);
      assert.equal(
        persistedEvents.filter(
          (event) =>
            event.type === "task.submitted" &&
            event.aggregateId === subtaskA.taskId,
        ).length,
        2,
      );
      assert.equal(
        persistedEvents.filter(
          (event) =>
            event.type === "task.submitted" &&
            event.aggregateId === subtaskB.taskId,
        ).length,
        1,
      );
    } finally {
      reopened.close();
    }
  } finally {
    shutdown.abort("split-chain-cleanup");
    await running?.catch(() => undefined);
    observer?.close();
    try {
      seed.close();
    } catch {
      // The seed connection is closed before the daemon starts.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

function roomEvents(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  roomId: string,
) {
  const collected: ReturnType<RoomKernel["sync"]>["events"] = [];
  let afterSeq: number | undefined;
  for (let page = 0; page < 50; page += 1) {
    const delivery = kernel.sync(actor, {
      consumerId: "split-verifier",
      limit: 500,
      roomId,
      ...(afterSeq === undefined ? {} : { afterSeq }),
    });
    collected.push(...delivery.events);
    if (delivery.cursorAfter >= delivery.latestRoomSeq) break;
    if (delivery.cursorAfter === afterSeq) break;
    afterSeq = delivery.cursorAfter;
  }
  return collected;
}

function validConfigV4(stateDirectory: string, secretPath: string) {
  return {
    client: { bindHost: "127.0.0.1" as const, port: 0 },
    drainTimeoutMs: 30_000,
    host: {
      credential: { path: secretPath, source: "file" as const },
      hostId: "config-v4-host",
      maxConcurrent: 2,
      participantIds: ["agent-a", "agent-b"],
    },
    hostStaleAfterMs: 60_000,
    leaseMs: 30_000,
    outboxLeaseMs: 5_000,
    outboxPollIntervalMs: 20,
    outboxRetryAfterMs: 1_000,
    pollIntervalMs: 20,
    runtimes: [],
    runTimeoutMs: 30_000,
    runtimeCancelTimeoutMs: 10_000,
    runtimeRecoveryTimeoutMs: 30_000,
    runtimeStartTimeoutMs: 10_000,
    schemaVersion: 4 as const,
    stateDirectory,
    taskClaimHeartbeatIntervalMs: 10_000,
    taskClaimLeaseMs: 30_000,
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
  return kernel.sync(actor, { consumerId: "split-test-cursor", roomId })
    .latestRoomSeq;
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition was not met");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
