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

test("Client API authenticates humans and exposes canonical Room work without owning it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-client-api-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const service = new ClientApplicationService({
    health: () => ({
      apiVersion: 3,
      buildVersion: "test-build",
      capabilities: {
        agentOnboard: true,
        agentRead: true,
        agentWrite: true,
        cursorAcknowledge: true,
        hints: false,
        inputRequestRead: true,
        inputRequestResolve: true,
        memberRead: true,
        memberWrite: true,
        messageRead: true,
        messageWrite: true,
        roomRead: true,
        roomWrite: true,
        roomSync: true,
        taskRead: true,
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
    assert.equal(healthV3.capabilities.agentWrite, true);
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
        sessionPolicy: "fresh",
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

    const threadsResponse = await request(
      "/v2/client/threads/list",
      { roomId: room.roomId },
      human.accessToken,
    );
    assert.equal(threadsResponse.status, 200);
    const threads = await jsonObject(threadsResponse);
    assert.equal(threads.threads[0]?.replyCount, 1);

    const roleResponse = await request(
      "/v2/client/rooms/members/role",
      {
        basedOnRoomSeq: reply.event.roomSeq,
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

    const cancelledResponse = await request(
      "/v1/client/tasks/cancel",
      {
        basedOnRoomSeq: assigned.event.roomSeq,
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
