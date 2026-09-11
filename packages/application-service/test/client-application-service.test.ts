import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  type AuthenticatedHostContext,
  createHumanApplicationPort,
  RoomKernel,
} from "@rah-os/kernel";
import type { RuntimeOffer } from "@rah-os/protocol";

import { ClientApplicationService } from "../src/index.ts";
import { AgentMemoryConfigStore } from "../../agent-host/src/agent-memory-config-store.ts";

test("Client API authenticates humans and exposes canonical Room work without owning it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-client-api-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  let workspaceSummaryCalls = 0;
  let skillsCalls = 0;
  let memoryResetCalls = 0;
  let executionResetCalls = 0;
  let computerProfileUpdates = 0;
  let taskReassignmentCalls = 0;
  const pushEndpoints = new Set<string>();
  let executionResetOwnerParticipantId = "fixture-agent";
  const memoryConfigs = new AgentMemoryConfigStore(join(directory, "memory"));
  const service = new ClientApplicationService({
    runtimeGuideSettings: {
      read: () => ({ revision: 0, runtimes: [] }),
      update: (input) => ({
        revision: input.expectedRevision + 1,
        runtimes: [],
      }),
    },
    computerProfileAdministration: {
      update: async (_actor, input) => {
        computerProfileUpdates += 1;
        return {
          computer: {
            description: input.description,
            displayName: input.displayName,
            hostId: input.hostId,
            revision: input.expectedRevision + 1,
            updatedAt: "2026-09-02T08:00:00.000Z",
          },
          deduplicated: false,
        };
      },
    },
    agentExecutionAdministration: {
      reset: async (_actor, input) => {
        executionResetCalls += 1;
        return {
          agentDefinitionId: input.agentDefinitionId,
          completedAt: "2026-09-01T02:00:00.000Z",
          computerHostId: "client-host",
          deduplicated: executionResetCalls > 1,
          mode: input.mode,
          operationId: `execution-reset-${input.idempotencyKey}`,
          ownerParticipantId: executionResetOwnerParticipantId,
          providerContinuityRecords: input.mode === "restart" ? 0 : 1,
        };
      },
    },
    agentMemoryAdministration: {
      computerHostId: "client-host",
      workspace: {
        skills: async (_owner, policy) => {
          skillsCalls++;
          const scope = {
            state: "ready" as const,
            skills: [],
            truncated: false,
            issues: [],
          };
          return {
            executionPolicyRevisionId: policy.executionPolicyRevisionId,
            global: scope,
            workspace: scope,
          };
        },
        summary: async (owner) => {
          workspaceSummaryCalls++;
          return {
            rootPath: `/fixture/${owner}`,
            state: "ready",
            fileCount: 2,
            totalSizeBytes: 9,
            lastModified: null,
            truncated: false,
          };
        },
        roots: async (owner) => ({
          defaultRootId: "agent-workspace",
          roots: [
            {
              rootId: "agent-workspace",
              rootKind: "agent-workspace",
              label: "Agent 工作区",
              rootPath: `/fixture/${owner}`,
              state: "ready",
            },
          ],
        }),
        list: async (owner, rootId, path) => ({
          rootId,
          rootLabel: "Agent 工作区",
          rootKind: rootId,
          rootPath: `/fixture/${owner}`,
          state: "ready",
          path,
          entries: [],
          truncated: false,
        }),
        read: async (_owner, rootId, path) => ({
          rootId,
          rootLabel: "Agent 工作区",
          rootKind: rootId,
          path,
          content: "fixture file",
          encoding: "utf-8",
          mimeType: "text/plain",
          size: 12,
        }),
      },
      getCleanerConfig: (owner) => memoryConfigs.get(owner),
      patchCleanerConfig: (owner, patch) => memoryConfigs.patch(owner, patch),
      inspectWorkspace: async (ownerParticipantId) => ({
        files: [
          {
            bytes: 24,
            contentDigest: `sha256:${"e".repeat(64)}`,
            modifiedAt: "2026-08-30T12:00:00.000Z",
            relativePath: "MEMORY.md",
          },
        ],
        indexOverThreshold: false,
        noteCount: 0,
        ownerParticipantId,
        schemaVersion: 1,
        state: "ready",
        thresholdBytes: 65_536,
      }),
      readWorkspaceFile: async (ownerParticipantId, relativePath) => ({
        content: "# Client Agent\n- durable\n",
        file: {
          bytes: 24,
          contentDigest: `sha256:${"e".repeat(64)}`,
          modifiedAt: "2026-08-30T12:00:00.000Z",
          relativePath,
        },
        ownerParticipantId,
      }),
      resetWorkspace: async (ownerParticipantId, idempotencyKey) => {
        memoryResetCalls += 1;
        return {
          deduplicated: memoryResetCalls > 1,
          operationId: `memory-reset-${idempotencyKey}`,
          ownerParticipantId,
          providerContinuityRecords: 1,
          resetAtMs: Date.parse("2026-08-30T12:00:00.000Z"),
        };
      },
    },
    taskReassignmentAdministration: {
      reassign: async (_actor, input) => {
        taskReassignmentCalls += 1;
        const timestamp = "2026-09-01T03:00:00.000Z";
        return {
          activationIds: ["client-reassignment-activation"],
          deduplicated: taskReassignmentCalls > 1,
          event: {
            actorId: "client-human",
            aggregateId: input.taskId,
            aggregateType: "task",
            createdAt: timestamp,
            eventId: "client-reassignment-event",
            idempotencyKey: `${input.idempotencyKey}:assigned`,
            payload: {},
            roomId: "client-reassignment-room",
            roomSeq: input.basedOnRoomSeq + 2,
            schemaVersion: 1,
            type: "task.reassigned",
          },
          operation: {
            completedAt: timestamp,
            createdAt: timestamp,
            nextAssigneeId: input.assigneeId,
            operationId: "client-reassignment-operation",
            previousAssigneeId: "client-previous-agent",
            reason: input.reason,
            requestedBy: "client-human",
            roomId: "client-reassignment-room",
            state: "assigned" as const,
            taskId: input.taskId,
            updatedAt: timestamp,
          },
          task: {
            assigneeId: input.assigneeId,
            collaboratorIds: [],
            createdAt: timestamp,
            creatorId: "client-human",
            dependencyTaskIds: [],
            reviewerIds: [],
            roomId: "client-reassignment-room",
            sourceMessageId: "client-reassignment-message",
            state: "todo" as const,
            taskId: input.taskId,
            taskNumber: 1,
            threadId: "client-reassignment-thread",
            title: "Continue the task safely",
            updatedAt: timestamp,
          },
        };
      },
    },
    webPushAdministration: {
      configuration: async () => ({
        applicationServerKey: "AQIDBA",
        subscriptionCount: pushEndpoints.size,
        supported: true,
      }),
      subscribe: async (_actor, input) => {
        pushEndpoints.add(input.subscription.endpoint);
        return { subscribed: true, subscriptionCount: pushEndpoints.size };
      },
      unsubscribe: async (_actor, input) => {
        pushEndpoints.delete(input.endpoint);
        return { subscribed: false, subscriptionCount: pushEndpoints.size };
      },
      test: async () => ({ delivered: pushEndpoints.size }),
    },
    health: () => ({
      apiVersion: 3,
      buildVersion: "test-build",
      capabilities: {
        agentOnboard: true,
        agentRead: true,
        agentExecutionReset: true,
        agentExecutionFullReset: true,
        agentWrite: true,
        cursorAcknowledge: true,
        hints: false,
        inputRequestRead: true,
        inputRequestResolve: true,
        memberRead: true,
        memberWrite: true,
        messageRead: true,
        messageForward: true,
        messageWrite: true,
        roomRead: true,
        roomWrite: true,
        roomSync: true,
        taskRead: true,
        taskReassignment: true,
        taskWrite: true,
        threadRead: true,
        threadWrite: true,
        workspaceRead: true,
        workspaceWrite: true,
      },
      kernelSchemaVersion: 3,
      protocolVersion: 1,
      state: "online",
    }),
    human: createHumanApplicationPort(kernel),
    localRuntimeInventory: () => ({
      hostId: "client-host",
      computer: {
        displayName: "Client Mac",
        hostname: "client-mac.local",
        instanceId: "client-instance",
        lastSeenAt: "2026-09-01T00:00:00.000Z",
        observedAt: "2026-09-01T00:01:00.000Z",
        os: "darwin arm64",
        staleAfterMs: 30_000,
        status: "offline",
      },
      restartRequiredToRescan: true,
      runtimes: [
        {
          agentBindings: [],
          available: true,
          configured: true,
          displayName: "Codex",
          executable: "codex",
          modelBindingDescriptors: [],
          resolvedExecutablePath: "/opt/homebrew/bin/codex",
          runtimeOfferId: "offer-codex",
          runtimeProfileId: "profile-codex",
          runtimeProfileRevisionId: "revision-codex",
          source: "configured",
        },
      ],
    }),
  });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "client-human",
      kind: "human",
    });
    const otherHuman = kernel.provisionPrincipal({
      handle: "client-other-human",
      kind: "human",
    });
    const memberHuman = kernel.provisionPrincipal({
      handle: "client-member-human",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "client-agent",
      kind: "agent",
    });
    executionResetOwnerParticipantId = agent.principal.principalId;
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const workspace = kernel.createWorkspace(humanActor, {
      idempotencyKey: "client-workspace-created",
      name: "Client API Workspace",
      slug: "client-api-workspace",
    });
    const controlRoom = workspace.controlRoom;
    const room = kernel.createWorkspaceRoom(humanActor, {
      basedOnControlRoomSeq: workspace.event.roomSeq,
      idempotencyKey: "client-room-created",
      kind: "channel",
      name: "Client API",
      slug: "client-api",
      workspaceId: workspace.workspace.workspaceId,
    }).room;
    for (const roomId of [controlRoom.roomId, room.roomId]) {
      kernel.addMember(humanActor, {
        principalId: agent.principal.principalId,
        roomId,
      });
    }
    kernel.addMember(humanActor, {
      principalId: memberHuman.principal.principalId,
      roomId: room.roomId,
    });
    const controlRoomSeq = kernel.sync(humanActor, {
      afterSeq: 0,
      consumerId: "client-agent-catalog-setup",
      roomId: controlRoom.roomId,
    }).latestRoomSeq;
    const policy = kernel.createExecutionPolicy(humanActor, {
      basedOnRoomSeq: controlRoomSeq,
      controlRoomId: controlRoom.roomId,
      idempotencyKey: "client-agent-policy-created",
      modelIntent: {
        fallback: "disabled",
        reasoning: "default",
        serviceTier: "default",
      },
      preferred: [],
      required: {
        allowedProtocolFamilies: ["rah-worker-process/v1"],
        capabilities: [
          { capability: "worker_commands", minimumEvidence: "probed" },
        ],
        minimumIsolation: "process",
        workspaceMode: "in_place",
      },
      retryPolicyRef: {
        artifactId: "client-retry-policy",
        contentDigest: `sha256:${"a".repeat(64)}`,
        versionId: "client-retry-policy-v1",
      },
      sessionPolicy: "fresh",
    });
    const agentDefinition = kernel.createAgentDefinition(humanActor, {
      basedOnRoomSeq: policy.event.roomSeq,
      controlRoomId: controlRoom.roomId,
      executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
      idempotencyKey: "client-agent-definition-created",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "client-memory-policy",
        contentDigest: `sha256:${"b".repeat(64)}`,
        versionId: "client-memory-policy-v1",
      },
      participantId: agent.principal.principalId,
      role: "Client integration Agent",
      skillRefs: [],
    });
    const agentOnboardRoom = kernel.createWorkspaceRoom(humanActor, {
      basedOnControlRoomSeq: kernel.sync(humanActor, {
        afterSeq: 0,
        consumerId: "client-agent-onboard-room-setup",
        roomId: controlRoom.roomId,
      }).latestRoomSeq,
      idempotencyKey: "client-agent-onboard-room-created",
      kind: "channel",
      name: "Client Agent Onboard",
      slug: "client-agent-onboard",
      workspaceId: workspace.workspace.workspaceId,
    }).room;
    const created = kernel.createTask(humanActor, {
      assigneeId: agent.principal.principalId,
      idempotencyKey: "client-task-created",
      roomId: room.roomId,
      title: "Prove the Human client boundary",
    });
    const host = authenticateHost(
      kernel,
      "client-host",
      agent.principal.principalId,
    );
    kernel.publishRuntimeOffer(host, {
      capacityPoolIds: [],
      capabilityEvidence: [],
      certificationRefs: [],
      hostId: host.hostId,
      hostInstanceId: host.instanceId,
      isolation: { evidence: "declared", level: "none" },
      leaseUntil: new Date(Date.now() + 5 * 60_000).toISOString(),
      maxConcurrent: 2,
      modelBindingDescriptors: [],
      observedAt: new Date().toISOString(),
      protocolFamily: "rah-worker-process/v1",
      revisionDigest: `sha256:${"c".repeat(64)}`,
      runtimeOfferId: "offer-codex",
      runtimeProfileId: "profile-codex",
      runtimeProfileRevisionId: "revision-codex",
      state: "available",
      workspaceMountDescriptors: [
        {
          modes: ["in_place"],
          workspaceDefinitionId: workspace.workspace.workspaceId,
          workspaceMountDigest: `sha256:${"d".repeat(64)}`,
          workspaceMountRevisionId: "mount-client-v1",
        },
      ],
    } satisfies RuntimeOffer);
    const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
    assert.ok(activation);
    const runAttempt = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    prepareAndMarkRunAttemptRunning(kernel, host, {
      recoveryDescriptor: fakeRecovery("client-runtime"),
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId: "client-runtime",
    });
    const execution = kernel.authorizeWorkerExecution(host, {
      activationId: activation.activationId,
      consumerId: "client-worker",
      hostId: host.hostId,
      participantId: agent.principal.principalId,
      roomId: room.roomId,
      runAttemptId: runAttempt.runAttemptId,
      toSeq: activation.toSeq,
    });
    const workerDelivery = kernel.syncWorker(execution, {});
    kernel.acknowledgeWorkerCursor(execution, {
      throughSeq: workerDelivery.cursorAfter,
    });
    const claimed = kernel.claimTask(execution, {
      basedOnRoomSeq: workerDelivery.cursorAfter,
      idempotencyKey: "client-task-claimed",
      leaseMs: 30_000,
      taskId: created.task.taskId,
    });
    const started = kernel.startTask(execution, {
      basedOnRoomSeq: claimed.event.roomSeq,
      idempotencyKey: "client-task-started",
      leaseMs: 30_000,
      taskId: created.task.taskId,
    });
    const requested = kernel.requestTaskInput(execution, {
      basedOnRoomSeq: started.event.roomSeq,
      idempotencyKey: "client-input-requested",
      question: "Should the service keep the browser identity server-owned?",
      taskId: created.task.taskId,
    });

    await service.start();

    const healthResponse = await fetch(`${service.origin}/v1/client/health`);
    assert.equal(healthResponse.status, 200);
    const health = await jsonObject(healthResponse);
    assert.equal(health.apiVersion, 1);
    assert.equal(health.state, "online");
    assert.equal("hostToken" in health, false);
    assert.equal("memberWrite" in health.capabilities, false);

    const healthV2Response = await fetch(`${service.origin}/v2/client/health`);
    assert.equal(healthV2Response.status, 200);
    const healthV2 = await jsonObject(healthV2Response);
    assert.equal(healthV2.apiVersion, 2);
    assert.equal(healthV2.capabilities.memberWrite, true);
    assert.equal("agentRead" in healthV2.capabilities, false);
    assert.equal("workspaceWrite" in healthV2.capabilities, false);

    const healthV3Response = await fetch(`${service.origin}/v3/client/health`);
    assert.equal(healthV3Response.status, 200);
    const healthV3 = await jsonObject(healthV3Response);
    assert.equal(healthV3.apiVersion, 3);
    assert.equal(healthV3.capabilities.agentOnboard, true);
    assert.equal(healthV3.capabilities.agentRead, true);
    assert.equal(healthV3.capabilities.agentExecutionReset, true);
    assert.equal(healthV3.capabilities.agentExecutionFullReset, true);
    assert.equal(healthV3.capabilities.agentWrite, true);
    assert.equal("managedMcpWrite" in healthV3.capabilities, false);
    assert.equal(healthV3.capabilities.messageForward, true);
    assert.equal(healthV3.capabilities.workspaceWrite, true);

    const request = async (
      path: string,
      body: Record<string, unknown>,
      accessToken?: string,
    ) =>
      await fetch(`${service.origin}${path}`, {
        body: JSON.stringify(body),
        headers: {
          ...(accessToken === undefined
            ? {}
            : { authorization: `Bearer ${accessToken}` }),
          "content-type": "application/json",
        },
        method: "POST",
      });

    const principalResponse = await request(
      "/v3/client/principals/me",
      {},
      human.accessToken,
    );
    assert.equal(principalResponse.status, 200);
    assert.deepEqual((await jsonObject(principalResponse)).principal, {
      handle: human.principal.handle,
      kind: "human",
      principalId: human.principal.principalId,
    });
    const principalUpdateResponse = await request(
      "/v3/client/principals/update",
      { avatarKey: "avatar-03", displayName: "Hakase" },
      human.accessToken,
    );
    assert.equal(principalUpdateResponse.status, 200);
    assert.deepEqual((await jsonObject(principalUpdateResponse)).principal, {
      avatarKey: "avatar-03",
      displayName: "Hakase",
      handle: human.principal.handle,
      kind: "human",
      principalId: human.principal.principalId,
    });

    const globalInput = { workspaceId: workspace.workspace.workspaceId };
    for (const [path, body] of [
      ["/runtime-guide/read", {}],
      [
        "/runtime-guide/update",
        { runtimeId: "codex", enabled: true, expectedRevision: 0 },
      ],
      ["/tasks/global", globalInput],
      ["/search", { ...globalInput, query: "" }],
      ["/activity/list", globalInput],
    ] as const) {
      assert.equal((await request(`/v3/client${path}`, body)).status, 401);
      assert.equal(
        (await request(`/v3/client${path}`, body, agent.accessToken)).status,
        401,
      );
      assert.equal(
        (
          await request(
            `/v3/client${path}`,
            { ...body, actorId: human.principal.principalId },
            human.accessToken,
          )
        ).status,
        400,
      );
      assert.equal(
        (await request(`/v3/client${path}`, body, human.accessToken)).status,
        200,
      );
      assert.equal(
        (await request(`/v2/client${path}`, body, human.accessToken)).status,
        404,
      );
    }
    const navigation = await request(
      "/v3/client/navigation/resolve",
      { target: { kind: "room", roomId: room.roomId } },
      human.accessToken,
    );
    assert.equal(navigation.status, 200);
    assert.deepEqual((await jsonObject(navigation)).target, {
      kind: "room",
      roomId: room.roomId,
    });
    const notifications = await request(
      "/v3/client/notifications/list",
      globalInput,
      human.accessToken,
    );
    assert.equal(notifications.status, 200);
    const notification = (await jsonObject(notifications)).notifications[0];
    assert.equal(notification.kind, "computer_offline");
    assert.deepEqual(notification.target, {
      kind: "computer",
      hostId: "client-host",
    });
    const pushConfiguration = await request(
      "/v3/client/push/configuration",
      {},
      human.accessToken,
    );
    assert.equal(pushConfiguration.status, 200);
    assert.equal((await jsonObject(pushConfiguration)).subscriptionCount, 0);
    const pushSubscribe = await request(
      "/v3/client/push/subscribe",
      {
        subscription: {
          endpoint: "https://push.example/client-device",
          keys: { auth: "auth_key", p256dh: "public_key" },
        },
      },
      human.accessToken,
    );
    assert.equal(pushSubscribe.status, 200);
    assert.equal((await jsonObject(pushSubscribe)).subscriptionCount, 1);
    const pushTest = await request(
      "/v3/client/push/test",
      {},
      human.accessToken,
    );
    assert.deepEqual(await jsonObject(pushTest), { delivered: 1 });
    const pushUnsubscribe = await request(
      "/v3/client/push/unsubscribe",
      { endpoint: "https://push.example/client-device" },
      human.accessToken,
    );
    assert.equal((await jsonObject(pushUnsubscribe)).subscriptionCount, 0);
    const dismissed = await request(
      "/v3/client/notifications/dismiss",
      {
        ...globalInput,
        idempotencyKey: "dismiss-client-offline",
        notificationId: notification.notificationId,
      },
      human.accessToken,
    );
    assert.equal(dismissed.status, 200);
    assert.deepEqual(
      (
        await jsonObject(
          await request(
            "/v3/client/notifications/list",
            globalInput,
            human.accessToken,
          ),
        )
      ).notifications,
      [],
      "opening/listing did not dismiss; the explicit command did",
    );
    const globalTasks = await jsonObject(
      await request("/v3/client/tasks/global", globalInput, human.accessToken),
    );
    assert.ok(globalTasks.tasks.length > 0);
    const taskAnchor = globalTasks.tasks[0].task;
    const context = await request(
      "/v3/client/messages/context",
      { messageId: taskAnchor.sourceMessageId },
      human.accessToken,
    );
    assert.equal(context.status, 200);
    assert.equal(
      (await jsonObject(context)).message.messageId,
      taskAnchor.sourceMessageId,
    );
    assert.equal(
      (
        await request(
          "/v3/client/messages/context",
          { messageId: taskAnchor.sourceMessageId },
          otherHuman.accessToken,
        )
      ).status,
      403,
    );
    const follow = await request(
      "/v3/client/activity/follow",
      {
        roomId: taskAnchor.roomId,
        threadId: taskAnchor.threadId,
        following: true,
      },
      human.accessToken,
    );
    assert.equal(follow.status, 200);
    const followers = await jsonObject(
      await request(
        "/v3/client/activity/thread-followers",
        { roomId: taskAnchor.roomId, threadId: taskAnchor.threadId },
        human.accessToken,
      ),
    );
    assert.equal(followers.following, true);
    assert.equal(followers.canManage, true);
    assert.ok(Array.isArray(followers.agentParticipantIds));
    const globalActivity = await jsonObject(
      await request("/v3/client/activity/list", globalInput, human.accessToken),
    );
    const card = globalActivity.items[0];
    assert.ok(card);
    const mark = await request(
      "/v3/client/activity/mark",
      {
        roomId: card.roomId,
        ...(card.threadId ? { threadId: card.threadId } : {}),
        throughSeq: card.latestSeq,
        action: "read",
      },
      human.accessToken,
    );
    assert.equal(mark.status, 200);

    const memoryResponse = await request(
      "/v3/client/agents/memory/get",
      { agentDefinitionId: agentDefinition.definition.agentDefinitionId },
      human.accessToken,
    );
    assert.equal(memoryResponse.status, 200);
    const memory = await jsonObject(memoryResponse);
    assert.equal(memory.computerHostId, "client-host");
    const summaryInput = {
      agentDefinitionId: agentDefinition.definition.agentDefinitionId,
    };
    const summaryResponse = await request(
      "/v3/client/agents/workspace/summary",
      summaryInput,
      human.accessToken,
    );
    assert.equal(summaryResponse.status, 200);
    assert.equal(
      (await jsonObject(summaryResponse)).rootPath,
      `/fixture/${agent.principal.principalId}`,
    );
    assert.equal(
      (
        await request(
          "/v3/client/agents/workspace/summary",
          summaryInput,
          otherHuman.accessToken,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          "/v3/client/agents/workspace/summary",
          { ...summaryInput, rootPath: "/" },
          human.accessToken,
        )
      ).status,
      400,
    );
    assert.equal(
      workspaceSummaryCalls,
      1,
      "unauthorized or arbitrary-root input must not reach Host I/O",
    );
    const skillsInput = {
      agentDefinitionId: agentDefinition.definition.agentDefinitionId,
    };
    const skillsResponse = await request(
      "/v3/client/agents/skills/list",
      skillsInput,
      human.accessToken,
    );
    assert.equal(skillsResponse.status, 200);
    assert.equal(
      (await jsonObject(skillsResponse)).executionPolicyRevisionId,
      policy.policy.executionPolicyRevisionId,
    );
    assert.equal(
      (
        await request(
          "/v3/client/agents/skills/list",
          skillsInput,
          otherHuman.accessToken,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          "/v3/client/agents/skills/list",
          { ...skillsInput, rootPath: "/" },
          human.accessToken,
        )
      ).status,
      400,
    );
    assert.equal(skillsCalls, 1);
    const workspaceInput = {
      agentDefinitionId: agentDefinition.definition.agentDefinitionId,
      path: "",
      includeHidden: false,
    };
    const workspaceRootsResponse = await request(
      "/v3/client/agents/workspace/roots",
      { agentDefinitionId: agentDefinition.definition.agentDefinitionId },
      human.accessToken,
    );
    assert.equal(workspaceRootsResponse.status, 200);
    assert.equal(
      (await jsonObject(workspaceRootsResponse)).defaultRootId,
      "agent-workspace",
    );
    const workspaceResponse = await request(
      "/v3/client/agents/workspace/list",
      workspaceInput,
      human.accessToken,
    );
    assert.equal(workspaceResponse.status, 200);
    assert.equal(
      (await jsonObject(workspaceResponse)).rootPath,
      `/fixture/${agent.principal.principalId}`,
    );
    assert.equal(
      (
        await request(
          "/v3/client/agents/workspace/list",
          workspaceInput,
          otherHuman.accessToken,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          "/v3/client/agents/workspace/read",
          { ...workspaceInput, includeHidden: undefined, path: "../outside" },
          human.accessToken,
        )
      ).status,
      400,
    );
    const management = await jsonObject(
      await request(
        "/v3/client/agents/get",
        { agentDefinitionId: agentDefinition.definition.agentDefinitionId },
        human.accessToken,
      ),
    );
    assert.equal(management.membershipRole, "member");
    assert.equal(memory.memory.ownerParticipantId, agent.principal.principalId);
    assert.equal(memory.memory.files[0]?.relativePath, "MEMORY.md");
    const configGet = "/v3/client/agents/memory/config/get";
    const sequenceBeforeConfig = kernel.sync(humanActor, {
      roomId: controlRoom.roomId,
      consumerId: "config-sequence-proof",
    }).latestRoomSeq;
    const configPatch = "/v3/client/agents/memory/config/patch";
    const configIdentity = {
      agentDefinitionId: agentDefinition.definition.agentDefinitionId,
    };
    assert.equal((await request(configGet, configIdentity)).status, 401);
    assert.equal(
      (await request(configGet, configIdentity, otherHuman.accessToken)).status,
      403,
    );
    assert.equal(
      (
        await request(
          configPatch,
          {
            ...configIdentity,
            patch: { expectedRevision: 0, set: { enabled: false } },
          },
          otherHuman.accessToken,
        )
      ).status,
      403,
    );
    // Human API rejects Agent credentials at authentication, before owner lookup.
    assert.equal(
      (await request(configGet, configIdentity, agent.accessToken)).status,
      401,
    );
    assert.equal(
      (
        await jsonObject(
          await request(configGet, configIdentity, human.accessToken),
        )
      ).config.revision,
      0,
    );
    const savedConfig = await request(
      configPatch,
      {
        ...configIdentity,
        patch: { expectedRevision: 0, set: { threshold_bytes: 8192 } },
      },
      human.accessToken,
    );
    assert.equal(savedConfig.status, 200);
    assert.equal(
      (await jsonObject(savedConfig)).config.effective.threshold_bytes,
      8192,
    );
    const staleConfig = await request(
      configPatch,
      {
        ...configIdentity,
        patch: { expectedRevision: 0, set: { enabled: false } },
      },
      human.accessToken,
    );
    assert.equal(staleConfig.status, 409);
    assert.equal(
      await responseErrorCode(staleConfig),
      "agent_memory_config_conflict",
    );
    assert.equal(
      (
        await request(
          configPatch,
          {
            ...configIdentity,
            patch: { expectedRevision: 1, set: { interval_ms: 1 } },
          },
          human.accessToken,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await jsonObject(
          await request(configGet, configIdentity, human.accessToken),
        )
      ).config.revision,
      1,
    );

    const memoryFileResponse = await request(
      "/v3/client/agents/memory/read",
      {
        agentDefinitionId: agentDefinition.definition.agentDefinitionId,
        relativePath: "MEMORY.md",
      },
      human.accessToken,
    );
    assert.equal(
      kernel.sync(humanActor, {
        roomId: controlRoom.roomId,
        consumerId: "config-sequence-proof",
      }).latestRoomSeq,
      sequenceBeforeConfig,
    );
    assert.equal(memoryFileResponse.status, 200);
    assert.match((await jsonObject(memoryFileResponse)).content, /durable/u);

    const memoryResetResponse = await request(
      "/v3/client/agents/memory/reset",
      {
        agentDefinitionId: agentDefinition.definition.agentDefinitionId,
        confirmation: "RESET_AGENT_MEMORY",
        idempotencyKey: "client-memory-reset-1",
      },
      human.accessToken,
    );
    assert.equal(memoryResetResponse.status, 200);
    assert.equal((await jsonObject(memoryResetResponse)).deduplicated, false);
    assert.equal(memoryResetCalls, 1);

    const executionResetResponse = await request(
      "/v3/client/agents/execution/reset",
      {
        agentDefinitionId: agentDefinition.definition.agentDefinitionId,
        basedOnRoomSeq: kernel.sync(humanActor, {
          afterSeq: 0,
          consumerId: "execution-reset-sequence",
          roomId: controlRoom.roomId,
        }).latestRoomSeq,
        idempotencyKey: "client-execution-reset-1",
        mode: "full",
      },
      human.accessToken,
    );
    assert.equal(
      executionResetResponse.status,
      200,
      await executionResetResponse.clone().text(),
    );
    const executionReset = await jsonObject(executionResetResponse);
    assert.equal(executionReset.mode, "full");
    assert.equal(executionReset.providerContinuityRecords, 1);
    assert.equal(executionResetCalls, 1);

    const taskReassignmentResponse = await request(
      "/v3/client/tasks/reassign",
      {
        assigneeId: agent.principal.principalId,
        basedOnRoomSeq: 12,
        idempotencyKey: "client-task-reassignment-1",
        reason: "Move the work after stopping the previous Agent",
        taskId: "client-running-task",
      },
      human.accessToken,
    );
    assert.equal(
      taskReassignmentResponse.status,
      200,
      await taskReassignmentResponse.clone().text(),
    );
    const taskReassignment = await jsonObject(taskReassignmentResponse);
    assert.equal(taskReassignment.operation.state, "assigned");
    assert.equal(taskReassignment.task.assigneeId, agent.principal.principalId);
    assert.equal(taskReassignmentCalls, 1);

    const computerProfileResponse = await request(
      "/v3/client/computers/profile/update",
      {
        description: "Local development Computer",
        displayName: "RAH Studio",
        expectedRevision: 0,
        hostId: "client-host",
        idempotencyKey: "client-computer-profile-1",
      },
      human.accessToken,
    );
    assert.equal(
      computerProfileResponse.status,
      200,
      await computerProfileResponse.clone().text(),
    );
    assert.equal(
      (await jsonObject(computerProfileResponse)).computer.displayName,
      "RAH Studio",
    );
    assert.equal(computerProfileUpdates, 1);

    const unauthenticatedInventory = await request(
      "/v1/local/runtimes/list",
      {},
    );
    assert.equal(unauthenticatedInventory.status, 401);
    const inventoryResponse = await request(
      "/v1/local/runtimes/list",
      {},
      human.accessToken,
    );
    assert.equal(inventoryResponse.status, 200);
    const inventory = await jsonObject(inventoryResponse);
    assert.equal(inventory.hostId, "client-host");
    assert.equal(inventory.runtimes[0]?.runtimeProfileId, "profile-codex");

    const legacyP2Route = await request(
      "/v1/client/workspaces/list",
      {},
      human.accessToken,
    );
    assert.equal(legacyP2Route.status, 404);
    assert.equal(await responseErrorCode(legacyP2Route), "not_found");

    const legacyCreateRoute = await request(
      "/v2/client/workspaces/create",
      {
        idempotencyKey: "client-workspace-create-v2",
        name: "Rejected on v2",
        slug: "rejected-v2",
      },
      human.accessToken,
    );
    assert.equal(legacyCreateRoute.status, 404);

    const workspaceCreateResponse = await request(
      "/v3/client/workspaces/create",
      {
        idempotencyKey: "client-workspace-create-v3",
        name: "Managed Workspace",
        slug: "managed-workspace",
      },
      human.accessToken,
    );
    assert.equal(workspaceCreateResponse.status, 200);
    const workspaceCreated = await jsonObject(workspaceCreateResponse);
    assert.equal(workspaceCreated.deduplicated, false);
    assert.equal(
      workspaceCreated.workspace.controlRoomId,
      workspaceCreated.controlRoom.roomId,
    );

    const roomCreateResponse = await request(
      "/v3/client/rooms/create",
      {
        basedOnControlRoomSeq: workspaceCreated.event.roomSeq,
        idempotencyKey: "client-room-create-v3",
        kind: "channel",
        name: "Managed Room",
        slug: "managed-room",
        workspaceId: workspaceCreated.workspace.workspaceId,
      },
      human.accessToken,
    );
    assert.equal(roomCreateResponse.status, 200);
    const managedRoom = await jsonObject(roomCreateResponse);
    assert.equal(
      managedRoom.room.workspaceId,
      workspaceCreated.workspace.workspaceId,
    );
    const memberGraphResponse = await request(
      "/v3/client/workspaces/member-graph",
      { workspaceId: workspaceCreated.workspace.workspaceId },
      human.accessToken,
    );
    assert.equal(memberGraphResponse.status, 200);
    const memberGraph = await jsonObject(memberGraphResponse);
    assert.equal(
      memberGraph.workspaceId,
      workspaceCreated.workspace.workspaceId,
    );
    assert.deepEqual(
      memberGraph.channels.map(({ name }: { name: string }) => name),
      ["Managed Room"],
    );
    assert.equal(memberGraph.humans.length, 1);
    assert.equal(memberGraph.agents.length, 0);
    const roomUpdateResponse = await request(
      "/v3/client/rooms/update",
      {
        basedOnRoomSeq: 1,
        description: "Updated through the Human client API.",
        idempotencyKey: "client-room-update-v3",
        name: "Managed Room Updated",
        roomId: managedRoom.room.roomId,
        visibility: "private",
      },
      human.accessToken,
    );
    assert.equal(roomUpdateResponse.status, 200);
    const updatedManagedRoom = await jsonObject(roomUpdateResponse);
    assert.equal(updatedManagedRoom.room.name, "Managed Room Updated");
    assert.equal(
      updatedManagedRoom.room.description,
      "Updated through the Human client API.",
    );
    const roomSosStopResponse = await request(
      "/v3/client/rooms/sos/stop",
      {
        basedOnRoomSeq: updatedManagedRoom.event.roomSeq,
        idempotencyKey: "client-room-sos-stop-v3",
        roomId: managedRoom.room.roomId,
      },
      human.accessToken,
    );
    assert.equal(roomSosStopResponse.status, 200);
    const stoppedManagedRoom = await jsonObject(roomSosStopResponse);
    assert.equal(stoppedManagedRoom.operation.state, "stopped");
    assert.equal(stoppedManagedRoom.event.type, "room.agent_sos_stopped");
    const roomSosResumeResponse = await request(
      "/v3/client/rooms/sos/resume",
      {
        basedOnRoomSeq: stoppedManagedRoom.event.roomSeq,
        guidance: "先同步最新 Room 事实，再按修正后的计划继续。",
        idempotencyKey: "client-room-sos-resume-v3",
        roomId: managedRoom.room.roomId,
      },
      human.accessToken,
    );
    assert.equal(roomSosResumeResponse.status, 200);
    const resumedManagedRoom = await jsonObject(roomSosResumeResponse);
    assert.equal(resumedManagedRoom.operation.state, "resumed");
    assert.equal(resumedManagedRoom.event.type, "room.agent_sos_resumed");
    const roomArchiveResponse = await request(
      "/v3/client/rooms/archive",
      {
        basedOnRoomSeq: resumedManagedRoom.event.roomSeq,
        idempotencyKey: "client-room-archive-v3",
        roomId: managedRoom.room.roomId,
      },
      human.accessToken,
    );
    assert.equal(roomArchiveResponse.status, 200);
    const archivedManagedRoom = await jsonObject(roomArchiveResponse);
    assert.equal(archivedManagedRoom.event.type, "room.archived");
    assert.equal(typeof archivedManagedRoom.room.archivedAt, "string");
    const roomUnarchiveResponse = await request(
      "/v3/client/rooms/unarchive",
      {
        basedOnRoomSeq: archivedManagedRoom.event.roomSeq,
        idempotencyKey: "client-room-unarchive-v3",
        roomId: managedRoom.room.roomId,
      },
      human.accessToken,
    );
    assert.equal(roomUnarchiveResponse.status, 200);
    const unarchivedManagedRoom = await jsonObject(roomUnarchiveResponse);
    assert.equal(unarchivedManagedRoom.event.type, "room.unarchived");
    assert.equal(unarchivedManagedRoom.room.archivedAt, undefined);

    const roomForDeletionResponse = await request(
      "/v3/client/rooms/create",
      {
        basedOnControlRoomSeq: kernel.sync(humanActor, {
          consumerId: "client-room-delete-control-head",
          roomId: workspaceCreated.controlRoom.roomId,
        }).latestRoomSeq,
        idempotencyKey: "client-room-delete-create-v3",
        kind: "channel",
        name: "Delete through transport",
        slug: "delete-through-transport",
        workspaceId: workspaceCreated.workspace.workspaceId,
      },
      human.accessToken,
    );
    assert.equal(roomForDeletionResponse.status, 200);
    const roomForDeletion = await jsonObject(roomForDeletionResponse);
    const roomDeleteInput = {
      basedOnRoomSeq: kernel.sync(humanActor, {
        consumerId: "client-room-delete-head",
        roomId: roomForDeletion.room.roomId,
      }).latestRoomSeq,
      idempotencyKey: "client-room-delete-v3",
      roomId: roomForDeletion.room.roomId,
    };
    const roomDeleteResponse = await request(
      "/v3/client/rooms/delete",
      roomDeleteInput,
      human.accessToken,
    );
    assert.equal(roomDeleteResponse.status, 200);
    const deletedRoom = await jsonObject(roomDeleteResponse);
    assert.equal(deletedRoom.roomId, roomForDeletion.room.roomId);
    assert.equal(deletedRoom.deduplicated, false);
    assert.deepEqual(deletedRoom.fileGc, {
      failed: 0,
      pending: 0,
      reclaimed: 0,
      total: 0,
    });
    const roomDeleteReplayResponse = await request(
      "/v3/client/rooms/delete",
      roomDeleteInput,
      human.accessToken,
    );
    assert.equal(roomDeleteReplayResponse.status, 200);
    assert.equal(
      (await jsonObject(roomDeleteReplayResponse)).deduplicated,
      true,
    );

    kernel.addMember(humanActor, {
      principalId: memberHuman.principal.principalId,
      roomId: managedRoom.room.roomId,
    });
    const memberActor = kernel.authenticateAccessToken(memberHuman.accessToken);
    const leaveResponse = await request(
      "/v3/client/rooms/leave",
      {
        basedOnRoomSeq: kernel.sync(memberActor, {
          afterSeq: 0,
          consumerId: "client-room-leave-head",
          roomId: managedRoom.room.roomId,
        }).latestRoomSeq,
        idempotencyKey: "client-room-leave-v3",
        roomId: managedRoom.room.roomId,
      },
      memberHuman.accessToken,
    );
    assert.equal(leaveResponse.status, 200);
    const leftManagedRoom = await jsonObject(leaveResponse);
    assert.equal(
      leftManagedRoom.removedPrincipalId,
      memberHuman.principal.principalId,
    );
    assert.equal(leftManagedRoom.event.type, "membership.removed");
    assert.equal(
      kernel
        .listRooms(memberActor)
        .some(({ roomId }) => roomId === managedRoom.room.roomId),
      false,
    );

    const directRoomResponse = await request(
      "/v3/client/rooms/direct/open",
      {
        basedOnControlRoomSeq: kernel.sync(humanActor, {
          afterSeq: 0,
          consumerId: "client-direct-room-head",
          roomId: controlRoom.roomId,
        }).latestRoomSeq,
        idempotencyKey: "client-direct-room-opened",
        peerPrincipalId: agent.principal.principalId,
        workspaceId: workspace.workspace.workspaceId,
      },
      human.accessToken,
    );
    assert.equal(directRoomResponse.status, 200);
    const directRoom = await jsonObject(directRoomResponse);
    assert.equal(directRoom.room.kind, "direct");
    assert.equal(directRoom.room.name, agent.principal.handle);
    const directLeaveResponse = await request(
      "/v3/client/rooms/leave",
      {
        basedOnRoomSeq: kernel.sync(humanActor, {
          afterSeq: 0,
          consumerId: "client-direct-leave-head",
          roomId: directRoom.room.roomId,
        }).latestRoomSeq,
        idempotencyKey: "client-direct-leave-rejected",
        roomId: directRoom.room.roomId,
      },
      human.accessToken,
    );
    assert.equal(directLeaveResponse.status, 409);
    assert.equal(await responseErrorCode(directLeaveResponse), "conflict");
    assert.equal(
      (
        await request(
          "/v3/client/rooms/direct/open",
          {
            basedOnControlRoomSeq: 0,
            idempotencyKey: "client-direct-room-opened-again",
            peerPrincipalId: agent.principal.principalId,
            workspaceId: workspace.workspace.workspaceId,
          },
          human.accessToken,
        ).then(jsonObject)
      ).room.roomId,
      directRoom.room.roomId,
      "open-or-create does not require a fresh write cursor for an existing pair",
    );

    const agentsResponse = await request(
      "/v3/client/agents/list",
      { controlRoomId: controlRoom.roomId },
      human.accessToken,
    );
    assert.equal(agentsResponse.status, 200);
    const agents = await jsonObject(agentsResponse);
    assert.equal(agents.agents.length, 1);
    assert.equal(
      agents.agents[0]?.definition.agentDefinitionId,
      agentDefinition.definition.agentDefinitionId,
    );
    assert.equal(agents.agents[0]?.handle, "client-agent");

    for (const path of [
      "assignments/create",
      "assignments/list",
      "assignments/revise",
      "assignments/state",
      "executors/discover",
      "executors/list",
      "servers/create",
      "servers/list",
      "servers/revise",
      "servers/state",
      "usage/list",
    ]) {
      const retired = await request(
        `/v3/client/managed-mcp/${path}`,
        {},
        human.accessToken,
      );
      assert.equal(retired.status, 404, `retired MCP route ${path}`);
    }

    const provisionResponse = await request(
      "/v3/client/agents/provision",
      {
        avatarKey: "robot",
        basedOnRoomSeq: kernel.sync(humanActor, {
          afterSeq: 0,
          consumerId: "client-agent-provision-seq",
          roomId: controlRoom.roomId,
        }).latestRoomSeq,
        controlRoomId: controlRoom.roomId,
        description: "Production-backed Agent",
        displayName: "Alice",
        handle: "client-alice",
        idempotencyKey: "client-agent-provisioned",
        instructions: "Read canonical Room state before acting.",
        modelIntent: { fallback: "disabled" },
        role: "Engineering Agent",
        runtimeOfferId: "offer-codex",
      },
      human.accessToken,
    );
    assert.equal(provisionResponse.status, 200);
    const provisioned = await jsonObject(provisionResponse);
    assert.equal(provisioned.agent.handle, "client-alice");
    assert.equal(provisioned.agent.currentRevision.displayName, "Alice");
    assert.equal(provisioned.hostBinding.hostId, host.hostId);

    const manageResponse = await request(
      "/v3/client/agents/manage",
      {
        action: "configure",
        agentDefinitionId: provisioned.agent.definition.agentDefinitionId,
        basedOnRoomSeq: provisioned.event.roomSeq,
        displayName: "Alice Reviewer",
        handle: "client-alice-reviewer",
        idempotencyKey: "client-agent-managed",
        instructions: "Review canonical Room state before approval.",
        modelIntent: { fallback: "disabled", reasoning: "high" },
        role: "Review Agent",
        runtimeOfferId: "offer-codex",
        sessionPolicy: "prefer_resume",
      },
      human.accessToken,
    );
    assert.equal(manageResponse.status, 200);
    const managed = await jsonObject(manageResponse);
    assert.equal(managed.agent.handle, "client-alice-reviewer");
    assert.equal(managed.agent.currentRevision.revision, 2);
    assert.equal(managed.policy.revision, 2);
    const agentGetResponse = await request(
      "/v3/client/agents/get",
      { agentDefinitionId: provisioned.agent.definition.agentDefinitionId },
      human.accessToken,
    );
    assert.equal(agentGetResponse.status, 200);
    const agentDetail = await jsonObject(agentGetResponse);
    assert.equal(agentDetail.agent.currentRevision.revision, 2);
    assert.equal(agentDetail.policy.modelIntent.reasoning, "high");

    const hiddenAgentsResponse = await request(
      "/v3/client/agents/list",
      { controlRoomId: controlRoom.roomId },
      otherHuman.accessToken,
    );
    assert.equal(hiddenAgentsResponse.status, 200);
    assert.deepEqual((await jsonObject(hiddenAgentsResponse)).agents, []);

    const presenceResponse = await request(
      "/v3/client/agents/presence/list",
      { controlRoomId: controlRoom.roomId },
      human.accessToken,
    );
    assert.equal(presenceResponse.status, 200);
    const presenceBody = await jsonObject(presenceResponse);
    assert.ok(presenceBody.agents.length > 0);
    for (const presence of presenceBody.agents) {
      assert.deepEqual(
        Object.keys(presence)
          .filter((key) => key !== "activityAt")
          .sort(),
        ["activity", "agentDefinitionId", "reason", "trajectoryVersion"],
      );
      assert.ok(Number.isSafeInteger(presence.trajectoryVersion));
      assert.ok(presence.trajectoryVersion >= 0);
      if (presence.activityAt !== undefined) {
        assert.equal(typeof presence.activityAt, "string");
      }
    }
    const hiddenPresenceResponse = await request(
      "/v3/client/agents/presence/list",
      { controlRoomId: controlRoom.roomId },
      otherHuman.accessToken,
    );
    assert.equal(hiddenPresenceResponse.status, 200);
    assert.deepEqual((await jsonObject(hiddenPresenceResponse)).agents, []);
    assert.equal(
      (
        await request(
          "/v3/client/agents/presence/list",
          { controlRoomId: controlRoom.roomId },
          "invalid-token",
        )
      ).status,
      401,
    );

    const legacyAgentsResponse = await request(
      "/v2/client/agents/list",
      {},
      human.accessToken,
    );
    assert.equal(legacyAgentsResponse.status, 404);

    const onboardResponse = await request(
      "/v3/client/agents/onboard",
      {
        agentDefinitionId: agentDefinition.definition.agentDefinitionId,
        basedOnRoomSeq: 1,
        idempotencyKey: "client-agent-onboarded",
        roomId: agentOnboardRoom.roomId,
      },
      human.accessToken,
    );
    assert.equal(onboardResponse.status, 200);
    const onboarded = await jsonObject(onboardResponse);
    assert.equal(onboarded.membership.principalId, agent.principal.principalId);
    assert.equal(onboarded.membership.role, "member");
    const agentRoomsResponse = await request(
      "/v3/client/agents/rooms/list",
      { agentDefinitionId: agentDefinition.definition.agentDefinitionId },
      human.accessToken,
    );
    assert.equal(agentRoomsResponse.status, 200);
    assert.deepEqual(
      (await jsonObject(agentRoomsResponse)).rooms.map(
        (room: { roomId: string }) => room.roomId,
      ),
      [agentOnboardRoom.roomId, room.roomId, directRoom.room.roomId],
    );
    const hiddenAgentRoomsResponse = await request(
      "/v3/client/agents/rooms/list",
      { agentDefinitionId: agentDefinition.definition.agentDefinitionId },
      otherHuman.accessToken,
    );
    assert.equal(hiddenAgentRoomsResponse.status, 404);
    const agentActivityResponse = await request(
      "/v3/client/agents/activity/list",
      {
        agentDefinitionId: agentDefinition.definition.agentDefinitionId,
        limit: 1,
      },
      human.accessToken,
    );
    assert.equal(agentActivityResponse.status, 200);
    const agentActivity = await jsonObject(agentActivityResponse);
    assert.equal(agentActivity.activities.length, 1);
    assert.equal(
      agentActivity.activities[0].participantId,
      agent.principal.principalId,
    );
    assert.equal("payload" in agentActivity.activities[0], false);
    const agentRemindersResponse = await request(
      "/v3/client/agents/reminders/list",
      { agentDefinitionId: agentDefinition.definition.agentDefinitionId },
      human.accessToken,
    );
    assert.equal(agentRemindersResponse.status, 200);
    assert.deepEqual((await jsonObject(agentRemindersResponse)).reminders, []);
    const hiddenAgentActivityResponse = await request(
      "/v3/client/agents/activity/list",
      { agentDefinitionId: agentDefinition.definition.agentDefinitionId },
      otherHuman.accessToken,
    );
    assert.equal(hiddenAgentActivityResponse.status, 404);
    const agentTrajectoryResponse = await request(
      "/v3/client/agents/trajectory/list",
      {
        agentDefinitionId: agentDefinition.definition.agentDefinitionId,
        limit: 50,
      },
      human.accessToken,
    );
    assert.equal(agentTrajectoryResponse.status, 200);
    assert.deepEqual(
      (await jsonObject(agentTrajectoryResponse)).activities,
      [],
    );
    const hiddenAgentTrajectoryResponse = await request(
      "/v3/client/agents/trajectory/list",
      { agentDefinitionId: agentDefinition.definition.agentDefinitionId },
      otherHuman.accessToken,
    );
    assert.equal(hiddenAgentTrajectoryResponse.status, 404);
    assert.equal(
      (
        await request(
          "/v3/client/agents/onboard",
          {
            agentDefinitionId: agentDefinition.definition.agentDefinitionId,
            basedOnRoomSeq: 1,
            idempotencyKey: "client-agent-onboarded",
            roomId: agentOnboardRoom.roomId,
          },
          human.accessToken,
        ).then(jsonObject)
      ).deduplicated,
      true,
    );
    assert.equal(
      (
        await request(
          "/v3/client/rooms/create",
          {
            basedOnControlRoomSeq: workspaceCreated.event.roomSeq,
            idempotencyKey: "client-room-create-v3",
            kind: "channel",
            name: "Managed Room",
            slug: "managed-room",
            workspaceId: workspaceCreated.workspace.workspaceId,
          },
          human.accessToken,
        ).then(jsonObject)
      ).deduplicated,
      true,
    );

    const unauthenticated = await request("/v1/client/rooms/sync", {
      consumerId: "browser-main",
      roomId: room.roomId,
    });
    assert.equal(unauthenticated.status, 401);
    assert.equal(await responseErrorCode(unauthenticated), "unauthenticated");

    const nonMember = await request(
      "/v1/client/rooms/sync",
      { consumerId: "browser-main", roomId: room.roomId },
      otherHuman.accessToken,
    );
    assert.equal(nonMember.status, 403);
    assert.equal(await responseErrorCode(nonMember), "forbidden");

    const workspacesResponse = await request(
      "/v2/client/workspaces/list",
      {},
      human.accessToken,
    );
    assert.equal(workspacesResponse.status, 200);
    const workspaces = await jsonObject(workspacesResponse);
    assert.equal(workspaces.workspaces[0]?.workspaceId, room.workspaceId);

    const roomsResponse = await request(
      "/v2/client/rooms/list",
      { workspaceId: room.workspaceId },
      human.accessToken,
    );
    assert.equal(roomsResponse.status, 200);
    const rooms = await jsonObject(roomsResponse);
    assert.ok(
      rooms.rooms.some(
        (candidate: { roomId?: string }) => candidate.roomId === room.roomId,
      ),
    );

    const membersResponse = await request(
      "/v2/client/rooms/members/list",
      { roomId: room.roomId },
      human.accessToken,
    );
    assert.equal(membersResponse.status, 200);
    const members = await jsonObject(membersResponse);
    assert.equal(members.memberships.length, 3);

    const activityResponse = await request(
      "/v3/client/rooms/agents/activity/list",
      { roomId: room.roomId },
      human.accessToken,
    );
    const activity = await jsonObject(activityResponse);
    assert.equal(activityResponse.status, 200, JSON.stringify(activity));
    assert.equal(activity.agents.length, 1);
    assert.equal(
      activity.agents[0]?.participantId,
      agent.principal.principalId,
    );
    assert.equal(activity.agents[0]?.roomId, room.roomId);
    assert.equal(activity.agents[0]?.state, "working");
    assert.equal(activity.agents[0]?.activationId, activation.activationId);
    assert.equal(activity.agents[0]?.runAttemptId, runAttempt.runAttemptId);

    const postedResponse = await request(
      "/v2/client/messages/post",
      {
        basedOnRoomSeq: requested.event.roomSeq,
        body: "Open a canonical Thread from the Human client",
        idempotencyKey: "client-message-posted",
        recipients: [
          {
            participantId: agent.principal.principalId,
            reason: "mention",
          },
        ],
        roomId: room.roomId,
      },
      human.accessToken,
    );
    assert.equal(postedResponse.status, 200);
    const posted = await jsonObject(postedResponse);
    assert.equal(posted.event.type, "message.posted");
    assert.equal(posted.activationIds.length, 1);
    const referenceReadStatesResponse = await request(
      "/v3/client/messages/reference-read-states",
      {
        messageIds: [posted.event.aggregateId],
        roomId: room.roomId,
      },
      human.accessToken,
    );
    assert.equal(referenceReadStatesResponse.status, 200);
    assert.deepEqual(
      (await jsonObject(referenceReadStatesResponse)).readStates,
      [
        {
          messageId: posted.event.aggregateId,
          principalId: agent.principal.principalId,
          readState: "unread",
        },
      ],
    );
    assert.equal(
      (
        await request(
          "/v3/client/messages/reference-read-states",
          {
            messageIds: [posted.event.aggregateId],
            roomId: room.roomId,
          },
          otherHuman.accessToken,
        )
      ).status,
      403,
    );

    const threadResponse = await request(
      "/v2/client/threads/create",
      {
        basedOnRoomSeq: posted.event.roomSeq,
        idempotencyKey: "client-thread-created",
        recipientIds: [agent.principal.principalId],
        roomId: room.roomId,
        rootMessageId: posted.event.aggregateId,
      },
      human.accessToken,
    );
    assert.equal(threadResponse.status, 200);
    const thread = await jsonObject(threadResponse);
    assert.equal(thread.thread.rootMessageId, posted.event.aggregateId);

    const replyResponse = await request(
      "/v2/client/threads/reply",
      {
        basedOnRoomSeq: thread.event.roomSeq,
        body: "The reply is still a Room Message.",
        idempotencyKey: "client-thread-replied",
        recipientIds: [agent.principal.principalId],
        roomId: room.roomId,
        threadId: thread.thread.threadId,
      },
      memberHuman.accessToken,
    );
    assert.equal(replyResponse.status, 200);
    const reply = await jsonObject(replyResponse);
    assert.equal(reply.event.payload.threadId, thread.thread.threadId);

    const messagesResponse = await request(
      "/v2/client/messages/list",
      { roomId: room.roomId, threadId: thread.thread.threadId },
      human.accessToken,
    );
    assert.equal(messagesResponse.status, 200);
    const messages = await jsonObject(messagesResponse);
    assert.equal(messages.messages[0]?.messageId, reply.event.aggregateId);

    const forwardTargetsResponse = await request(
      "/v3/client/messages/forward/targets",
      { query: "onboard", sourceRoomId: room.roomId },
      human.accessToken,
    );
    assert.equal(forwardTargetsResponse.status, 200);
    const forwardTargets = await jsonObject(forwardTargetsResponse);
    assert.deepEqual(
      forwardTargets.rooms.map(
        (candidate: { roomId: string }) => candidate.roomId,
      ),
      [agentOnboardRoom.roomId],
    );
    const forwardResponse = await request(
      "/v3/client/messages/forward",
      {
        destinationRoomIds: [agentOnboardRoom.roomId],
        note: "Canonical bundle",
        requestId: "client-forwarded",
        sourceMessageIds: [reply.event.aggregateId, posted.event.aggregateId],
        sourceRoomId: room.roomId,
      },
      human.accessToken,
    );
    assert.equal(forwardResponse.status, 200);
    const forwarded = await jsonObject(forwardResponse);
    assert.equal(forwarded.results[0]?.status, "delivered");
    const forwardedMessages = await request(
      "/v3/client/messages/list",
      { roomId: agentOnboardRoom.roomId },
      human.accessToken,
    ).then(jsonObject);
    assert.equal(forwardedMessages.messages[0]?.body, "Canonical bundle");
    assert.deepEqual(
      forwardedMessages.messages[0]?.forwardedBundle?.items.map(
        (candidate: { body: string }) => candidate.body,
      ),
      [
        "Open a canonical Thread from the Human client",
        "The reply is still a Room Message.",
      ],
    );
    const nestedForwardResponse = await request(
      "/v3/client/messages/forward",
      {
        destinationRoomIds: [room.roomId],
        requestId: "client-nested-forward",
        sourceMessageIds: [forwarded.results[0].messageId],
        sourceRoomId: agentOnboardRoom.roomId,
      },
      human.accessToken,
    );
    assert.equal(nestedForwardResponse.status, 409);
    assert.deepEqual(await jsonObject(nestedForwardResponse), {
      error: {
        code: "forwarded_source_not_supported",
        message: "forwarded source is not supported",
      },
    });

    const threadsResponse = await request(
      "/v2/client/threads/list",
      { roomId: room.roomId },
      human.accessToken,
    );
    assert.equal(threadsResponse.status, 200);
    const threads = await jsonObject(threadsResponse);
    assert.equal(
      threads.threads.find(
        (candidate: { threadId?: unknown }) =>
          candidate.threadId === thread.thread.threadId,
      )?.replyCount,
      1,
    );

    const convertedResponse = await request(
      "/v3/client/tasks/convert",
      {
        basedOnRoomSeq: reply.event.roomSeq,
        idempotencyKey: "client-message-converted-to-task",
        messageId: posted.event.aggregateId,
        roomId: room.roomId,
      },
      human.accessToken,
    );
    assert.equal(convertedResponse.status, 200);
    const converted = await jsonObject(convertedResponse);
    assert.equal(converted.task.sourceMessageId, posted.event.aggregateId);
    assert.equal(converted.task.threadId, thread.thread.threadId);
    assert.equal(converted.task.taskNumber, 2);
    const channelMessages = await request(
      "/v3/client/messages/list",
      { roomId: room.roomId },
      human.accessToken,
    ).then(jsonObject);
    assert.equal(
      channelMessages.messages.filter(
        (candidate: { messageId?: unknown }) =>
          candidate.messageId === posted.event.aggregateId,
      ).length,
      1,
    );

    const replyConversionRejected = await request(
      "/v3/client/tasks/convert",
      {
        basedOnRoomSeq: converted.event.roomSeq,
        idempotencyKey: "client-reply-converted-to-task",
        messageId: reply.event.aggregateId,
        roomId: room.roomId,
      },
      human.accessToken,
    );
    assert.equal(replyConversionRejected.status, 409);
    assert.equal(await responseErrorCode(replyConversionRejected), "conflict");

    const roleResponse = await request(
      "/v2/client/rooms/members/role",
      {
        basedOnRoomSeq: converted.event.roomSeq,
        idempotencyKey: "client-member-promoted",
        principalId: memberHuman.principal.principalId,
        role: "admin",
        roomId: room.roomId,
      },
      human.accessToken,
    );
    assert.equal(roleResponse.status, 200);
    const role = await jsonObject(roleResponse);
    assert.equal(role.membership.role, "admin");

    const addedResponse = await request(
      "/v2/client/rooms/members/add",
      {
        basedOnRoomSeq: role.event.roomSeq,
        idempotencyKey: "client-other-member-added",
        principalId: otherHuman.principal.principalId,
        role: "member",
        roomId: room.roomId,
      },
      memberHuman.accessToken,
    );
    assert.equal(addedResponse.status, 200);
    const added = await jsonObject(addedResponse);
    assert.equal(
      added.membership.principalId,
      otherHuman.principal.principalId,
    );

    const removedResponse = await request(
      "/v2/client/rooms/members/remove",
      {
        basedOnRoomSeq: added.event.roomSeq,
        idempotencyKey: "client-other-member-removed",
        principalId: otherHuman.principal.principalId,
        roomId: room.roomId,
      },
      memberHuman.accessToken,
    );
    assert.equal(removedResponse.status, 200);
    const removed = await jsonObject(removedResponse);
    assert.equal(removed.removedPrincipalId, otherHuman.principal.principalId);

    const agentPatRejected = await request(
      "/v1/client/tasks/list",
      { roomId: room.roomId },
      agent.accessToken,
    );
    assert.equal(agentPatRejected.status, 401);
    assert.equal(await responseErrorCode(agentPatRejected), "unauthenticated");

    const injectedActor = await request(
      "/v1/client/rooms/sync",
      {
        actorId: otherHuman.principal.principalId,
        consumerId: "browser-main",
        roomId: room.roomId,
      },
      human.accessToken,
    );
    assert.equal(injectedActor.status, 400);
    assert.equal(await responseErrorCode(injectedActor), "unexpected_field");

    const inventedAcknowledgement = await request(
      "/v1/client/rooms/acknowledge",
      {
        consumerId: "browser-main",
        roomId: room.roomId,
        throughSeq: requested.event.roomSeq,
      },
      human.accessToken,
    );
    assert.equal(inventedAcknowledgement.status, 409);
    assert.equal(
      await responseErrorCode(inventedAcknowledgement),
      "cursor_not_delivered",
    );

    const inventedContinuation = await request(
      "/v1/client/rooms/sync",
      {
        afterSeq: requested.event.roomSeq,
        consumerId: "browser-main",
        roomId: room.roomId,
      },
      human.accessToken,
    );
    assert.equal(inventedContinuation.status, 409);
    assert.equal(
      await responseErrorCode(inventedContinuation),
      "invalid_continuation",
    );

    const firstSyncResponse = await request(
      "/v1/client/rooms/sync",
      { consumerId: "browser-main", limit: 2, roomId: room.roomId },
      human.accessToken,
    );
    assert.equal(firstSyncResponse.status, 200);
    const firstSync = await jsonObject(firstSyncResponse);
    assert.ok(Array.isArray(firstSync.events));
    assert.equal(firstSync.events.length, 2);
    assert.equal(typeof firstSync.cursorAfter, "number");
    assert.ok(typeof firstSync.latestRoomSeq === "number");
    assert.ok(firstSync.cursorAfter < firstSync.latestRoomSeq);

    const latestBootstrapResponse = await request(
      "/v1/client/rooms/sync",
      {
        bootstrap: "latest",
        consumerId: "browser-latest-window",
        limit: 2,
        roomId: room.roomId,
      },
      human.accessToken,
    );
    assert.equal(latestBootstrapResponse.status, 200);
    const latestBootstrap = await jsonObject(latestBootstrapResponse);
    assert.equal(latestBootstrap.cursorAfter, latestBootstrap.latestRoomSeq);
    assert.equal(latestBootstrap.snapshotSeq, latestBootstrap.latestRoomSeq);
    assert.equal(
      latestBootstrap.eventFloorSeq,
      latestBootstrap.latestRoomSeq - latestBootstrap.events.length,
    );
    assert.ok(latestBootstrap.snapshot !== null);
    assert.ok(latestBootstrap.events.length <= 2);

    const acknowledgement = await request(
      "/v1/client/rooms/acknowledge",
      {
        consumerId: "browser-main",
        roomId: room.roomId,
        throughSeq: firstSync.cursorAfter,
      },
      human.accessToken,
    );
    assert.equal(acknowledgement.status, 200);
    assert.deepEqual(await jsonObject(acknowledgement), {
      acknowledgedThrough: firstSync.cursorAfter,
    });
    const replayedAcknowledgement = await request(
      "/v1/client/rooms/acknowledge",
      {
        consumerId: "browser-main",
        roomId: room.roomId,
        throughSeq: firstSync.cursorAfter,
      },
      human.accessToken,
    );
    assert.equal(replayedAcknowledgement.status, 200);

    const coldReloadPageResponse = await request(
      "/v1/client/rooms/sync",
      {
        afterSeq: 0,
        consumerId: "browser-main",
        limit: 1,
        roomId: room.roomId,
      },
      human.accessToken,
    );
    assert.equal(coldReloadPageResponse.status, 200);
    const coldReloadPage = await jsonObject(coldReloadPageResponse);
    assert.equal(coldReloadPage.cursorBefore, firstSync.cursorAfter);
    assert.equal(coldReloadPage.cursorAfter, 1);
    assert.ok(coldReloadPage.snapshot !== null);
    assert.equal(coldReloadPage.events.length, 1);

    const resumedSyncResponse = await request(
      "/v1/client/rooms/sync",
      { consumerId: "browser-main", roomId: room.roomId },
      human.accessToken,
    );
    assert.equal(resumedSyncResponse.status, 200);
    const resumedSync = await jsonObject(resumedSyncResponse);
    assert.equal(resumedSync.cursorBefore, firstSync.cursorAfter);
    assert.equal(resumedSync.cursorAfter, resumedSync.latestRoomSeq);

    const tasksResponse = await request(
      "/v1/client/tasks/list",
      { roomId: room.roomId },
      human.accessToken,
    );
    assert.equal(tasksResponse.status, 200);
    const tasks = await jsonObject(tasksResponse);
    assert.ok(Array.isArray(tasks.tasks));
    assert.equal(tasks.tasks[0]?.state, "waiting_input");

    const reviewEvidenceResponse = await request(
      "/v3/client/tasks/reviews/list",
      { roomId: room.roomId },
      human.accessToken,
    );
    assert.equal(reviewEvidenceResponse.status, 200);
    assert.deepEqual(await jsonObject(reviewEvidenceResponse), {
      reviews: [],
      submissions: [],
    });

    const pendingResponse = await request(
      "/v1/client/input-requests/list",
      { roomId: room.roomId, state: "pending" },
      human.accessToken,
    );
    assert.equal(pendingResponse.status, 200);
    const pending = await jsonObject(pendingResponse);
    assert.ok(Array.isArray(pending.inputRequests));
    assert.equal(
      pending.inputRequests[0]?.inputRequestId,
      requested.inputRequest.inputRequestId,
    );

    const wrongResponder = await request(
      "/v1/client/input-requests/resolve",
      {
        answer: "Injected answer",
        basedOnRoomSeq: resumedSync.latestRoomSeq,
        idempotencyKey: "client-wrong-responder",
        inputRequestId: requested.inputRequest.inputRequestId,
      },
      memberHuman.accessToken,
    );
    assert.equal(wrongResponder.status, 403);
    assert.equal(await responseErrorCode(wrongResponder), "forbidden");

    kernel.postMessage(humanActor, {
      body: "Make the browser's causal view stale",
      idempotencyKey: "client-stale-context-event",
      recipients: [],
      roomId: room.roomId,
    });
    const staleResolve = await request(
      "/v1/client/input-requests/resolve",
      {
        answer: "Yes, identity remains server-owned",
        basedOnRoomSeq: resumedSync.latestRoomSeq,
        idempotencyKey: "client-input-resolved",
        inputRequestId: requested.inputRequest.inputRequestId,
      },
      human.accessToken,
    );
    assert.equal(staleResolve.status, 409);
    assert.equal(await responseErrorCode(staleResolve), "stale_context");

    const freshSyncResponse = await request(
      "/v1/client/rooms/sync",
      {
        afterSeq: resumedSync.cursorAfter,
        consumerId: "browser-main",
        roomId: room.roomId,
      },
      human.accessToken,
    );
    const freshSync = await jsonObject(freshSyncResponse);
    const resolvedResponse = await request(
      "/v1/client/input-requests/resolve",
      {
        answer: "Yes, identity remains server-owned",
        basedOnRoomSeq: freshSync.latestRoomSeq,
        idempotencyKey: "client-input-resolved",
        inputRequestId: requested.inputRequest.inputRequestId,
      },
      human.accessToken,
    );
    assert.equal(resolvedResponse.status, 200);
    const resolved = await jsonObject(resolvedResponse);
    assert.equal(resolved.inputRequest.state, "resolved");
    assert.equal(resolved.task.state, "todo");
    assert.ok(Array.isArray(resolved.activationIds));
    assert.equal(resolved.activationIds.length, 1);

    const openTaskResponse = await request(
      "/v1/client/tasks/create",
      {
        idempotencyKey: "client-open-task-created",
        roomId: room.roomId,
        title: "Coordinate this through the Client API",
      },
      human.accessToken,
    );
    assert.equal(openTaskResponse.status, 200);
    const openTask = await jsonObject(openTaskResponse);
    assert.equal(openTask.task.state, "todo");
    assert.equal(openTask.task.assigneeId, undefined);
    assert.equal(openTask.activationIds.length, 1);

    const assignedResponse = await request(
      "/v1/client/tasks/assign",
      {
        assigneeId: agent.principal.principalId,
        basedOnRoomSeq: openTask.event.roomSeq,
        idempotencyKey: "client-open-task-assigned",
        taskId: openTask.task.taskId,
      },
      human.accessToken,
    );
    assert.equal(assignedResponse.status, 200);
    const assigned = await jsonObject(assignedResponse);
    assert.equal(assigned.task.assigneeId, agent.principal.principalId);

    const unassignedResponse = await request(
      "/v3/client/tasks/unassign",
      {
        basedOnRoomSeq: assigned.event.roomSeq,
        idempotencyKey: "client-open-task-unassigned",
        taskId: openTask.task.taskId,
      },
      human.accessToken,
    );
    assert.equal(unassignedResponse.status, 200);
    const unassigned = await jsonObject(unassignedResponse);
    assert.equal(unassigned.task.assigneeId, undefined);
    assert.equal(unassigned.event.type, "task.unassigned");

    const cancelledResponse = await request(
      "/v1/client/tasks/cancel",
      {
        basedOnRoomSeq: unassigned.event.roomSeq,
        idempotencyKey: "client-open-task-cancelled",
        reason: "The experiment is complete",
        taskId: openTask.task.taskId,
      },
      human.accessToken,
    );
    assert.equal(cancelledResponse.status, 200);
    const cancelled = await jsonObject(cancelledResponse);
    assert.equal(cancelled.task.state, "cancelled");
    assert.equal(
      cancelled.task.cancellationReason,
      "The experiment is complete",
    );
    const reopenedResponse = await request(
      "/v1/client/tasks/reopen",
      {
        basedOnRoomSeq: cancelled.event.roomSeq,
        idempotencyKey: "client-open-task-reopened",
        taskId: openTask.task.taskId,
      },
      human.accessToken,
    );
    assert.equal(reopenedResponse.status, 200);
    const reopened = await jsonObject(reopenedResponse);
    assert.equal(reopened.event.type, "task.reopened");
    assert.equal(reopened.task.state, "todo");
    assert.equal(reopened.task.cancellationReason, undefined);

    const workflowResponse = await request(
      "/v3/client/tasks/workflow",
      {
        basedOnRoomSeq: reopened.event.roomSeq,
        idempotencyKey: "client-open-task-workflow-review",
        taskId: openTask.task.taskId,
        workflowStatus: "in_review",
      },
      human.accessToken,
    );
    assert.equal(workflowResponse.status, 409);
    assert.equal(await responseErrorCode(workflowResponse), "conflict");
    const workflowListResponse = await request(
      "/v3/client/tasks/list",
      { roomId: room.roomId },
      human.accessToken,
    );
    assert.equal(workflowListResponse.status, 200);
    const workflowList = await jsonObject(workflowListResponse);
    const unchangedTask = workflowList.tasks.find(
      (task: { taskId: string }) => task.taskId === openTask.task.taskId,
    );
    assert.equal(unchangedTask.state, "todo");
    assert.equal(unchangedTask.workflowStatus, "todo");
    const exactTaskResponse = await request(
      "/v3/client/tasks/get",
      { roomId: room.roomId, taskId: openTask.task.taskId },
      human.accessToken,
    );
    assert.equal(exactTaskResponse.status, 200);
    assert.equal(
      (await jsonObject(exactTaskResponse)).task.taskId,
      openTask.task.taskId,
    );
    const taskHistoryInput = {
      roomId: room.roomId,
      taskId: openTask.task.taskId,
      limit: 1,
    };
    const taskHistoryResponse = await request(
      "/v3/client/tasks/history",
      taskHistoryInput,
      human.accessToken,
    );
    assert.equal(taskHistoryResponse.status, 200);
    const taskHistory = await jsonObject(taskHistoryResponse);
    assert.equal(taskHistory.taskId, openTask.task.taskId);
    assert.equal(taskHistory.events.length, 1);
    assert.equal(taskHistory.events[0].type, "task.reopened");
    assert.ok(taskHistory.nextCursor);
    const historyNext = await request(
      "/v3/client/tasks/history",
      { ...taskHistoryInput, cursor: taskHistory.nextCursor },
      human.accessToken,
    );
    assert.equal(historyNext.status, 200);
    assert.equal(
      (await jsonObject(historyNext)).frozenThroughRoomSeq,
      taskHistory.frozenThroughRoomSeq,
    );
    assert.equal(
      (await request("/v3/client/tasks/history", taskHistoryInput)).status,
      401,
    );

    const noPendingResponse = await request(
      "/v1/client/input-requests/list",
      { roomId: room.roomId, state: "pending" },
      human.accessToken,
    );
    const noPending = await jsonObject(noPendingResponse);
    assert.deepEqual(noPending.inputRequests, []);
  } finally {
    await service.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

async function jsonObject(response: Response): Promise<Record<string, any>> {
  const value: unknown = await response.json();
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
  );
  return value as Record<string, any>;
}

async function responseErrorCode(response: Response): Promise<unknown> {
  const body = await jsonObject(response);
  assert.ok(
    typeof body.error === "object" &&
      body.error !== null &&
      !Array.isArray(body.error),
  );
  return body.error.code;
}

function authenticateHost(
  kernel: RoomKernel,
  hostId: string,
  participantId: string,
): AuthenticatedHostContext {
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId,
      participantIds: [participantId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  return host;
}

function fakeRecovery(recoveryKey: string) {
  return {
    driver: "fake-runtime",
    metadata: {},
    recoveryKey,
  };
}

function prepareAndMarkRunAttemptRunning(
  kernel: RoomKernel,
  host: AuthenticatedHostContext,
  input: Parameters<RoomKernel["markRunAttemptRunning"]>[1],
): void {
  kernel.prepareRunAttemptRuntime(host, input);
  kernel.markRunAttemptRunning(host, input);
}
