import assert from "node:assert/strict";
import test from "node:test";

import {
  ClientAgentActivityListRequestSchema,
  ClientAgentActivityListResponseSchema,
  ClientAgentManageRequestSchema,
  ClientAgentProvisionRequestSchema,
  ClientAgentTrajectoryListRequestSchema,
  ClientAgentTrajectoryListResponseSchema,
  ClientAgentOnboardRequestSchema,
  ClientAgentRoomsListRequestSchema,
  ClientAgentRoomsListResponseSchema,
  ClientAgentsListRequestSchema,
  ClientRoomCreateRequestSchema,
  ClientDirectRoomOpenRequestSchema,
  ClientDirectRoomOpenResponseSchema,
  ClientWorkspaceCreateRequestSchema,
  ActivationCredentialScopeSchema,
  ActivationSchema,
  CLIENT_API_VERSION,
  ClientAcknowledgeRequestSchema,
  ClientAcknowledgeResponseSchema,
  ClientHealthResponseSchema,
  ClientHealthV1ResponseSchema,
  ClientInputRequestsListRequestSchema,
  ClientInputRequestsListResponseSchema,
  ClientMessagePostRequestSchema,
  ClientMessagesListRequestSchema,
  ClientRoomMemberAddRequestSchema,
  ClientRoomMemberRemoveRequestSchema,
  ClientRoomAgentActivityListRequestSchema,
  ClientRoomAgentActivityListResponseSchema,
  ClientRoomsListRequestSchema,
  ClientThreadCreateRequestSchema,
  ClientThreadReplyRequestSchema,
  ClientWorkspacesListRequestSchema,
  ClientRoomSyncRequestSchema,
  ClientRoomSyncResponseSchema,
  ClientTasksListRequestSchema,
  ClientTasksListResponseSchema,
  ClientTaskGetRequestSchema,
  ClientTaskGetResponseSchema,
  ClientTaskAssignRequestSchema,
  ClientTaskCancelRequestSchema,
  ClientTaskCompleteRequestSchema,
  ClientTaskConvertRequestSchema,
  ClientTaskCreateRequestSchema,
  ClientTaskReopenRequestSchema,
  ClientTaskUnblockRequestSchema,
  InputRequestSchema,
  InputRequestResolveRequestSchema,
  InputRequestResolveResponseSchema,
  LocalRuntimeInventoryRequestSchema,
  LocalRuntimeInventoryResponseSchema,
  RoomEventSchema,
  RuntimeRecoveryDescriptorSchema,
  TaskSchema,
  WakeHintSchema,
  WorkerAcknowledgeRequestSchema,
  WorkerArtifactPrepareRequestSchema,
  WORKER_MESSAGE_RESOLVE_NOT_FOUND_NEXT_ACTION,
  WorkerErrorResponseSchema,
  WorkerMessageMutationResponseSchema,
  WorkerMessagePostResponseSchema,
  WorkerMessagePostRequestSchema,
  WorkerSyncRequestSchema,
  WorkerTaskClaimRequestSchema,
  WorkerTaskClaimMessageRequestSchema,
  WorkerTaskCreateRequestSchema,
  WorkerTaskBlockRequestSchema,
  WorkerTaskGetRequestSchema,
  WorkerTaskGetResponseSchema,
  WorkerTaskInputStatusRequestSchema,
  WorkerTaskInputStatusResponseSchema,
  WorkerTaskMutationResponseSchema,
  WorkerTaskAttentionMutationResponseSchema,
  WorkerTaskProgressRequestSchema,
  WorkerTaskRequestInputRequestSchema,
  WorkerTaskRequestInputResponseSchema,
  WorkerTaskReviewRequestSchema,
  WorkerTaskReviewResponseSchema,
  WorkerTaskReleaseRequestSchema,
  WorkerTaskStartRequestSchema,
  WorkerTaskSubmitRequestSchema,
  WorkerTaskSubmissionRequestSchema,
  TaskSubmissionSchema,
} from "../src/index.ts";

test("new Agent mutations expose only Raft unattended and automatic session policies", () => {
  const provision = {
    basedOnRoomSeq: 1,
    controlRoomId: "room-control",
    displayName: "Alice",
    handle: "alice",
    idempotencyKey: "agent-alice-create",
    instructions: "Work from canonical Room state.",
    modelIntent: { fallback: "disabled" as const },
    role: "Engineering Agent",
    runtimeOfferId: "offer-codex",
  };
  assert.equal(
    ClientAgentProvisionRequestSchema.parse(provision).toolAccessMode,
    undefined,
  );
  assert.equal(
    ClientAgentProvisionRequestSchema.parse({
      ...provision,
      toolAccessMode: "full_access",
    }).toolAccessMode,
    "full_access",
  );
  assert.equal(
    ClientAgentProvisionRequestSchema.parse(provision).sessionPolicy,
    undefined,
  );
  assert.equal(
    ClientAgentProvisionRequestSchema.parse({
      ...provision,
      sessionPolicy: "prefer_resume",
    }).sessionPolicy,
    "prefer_resume",
  );
  for (const sessionPolicy of ["fresh", "require_resume"]) {
    assert.throws(() =>
      ClientAgentProvisionRequestSchema.parse({
        ...provision,
        sessionPolicy,
      }),
    );
    assert.throws(() =>
      ClientAgentManageRequestSchema.parse({
        ...provision,
        action: "configure",
        agentId: "agent-alice",
        sessionPolicy,
      }),
    );
  }
  for (const toolAccessMode of ["read_only", "workspace_write"]) {
    assert.throws(() =>
      ClientAgentProvisionRequestSchema.parse({
        ...provision,
        toolAccessMode,
      }),
    );
    assert.throws(() =>
      ClientAgentManageRequestSchema.parse({
        ...provision,
        action: "configure",
        agentId: "agent-alice",
        toolAccessMode,
      }),
    );
  }
});

test("local Runtime inventory is strict and distinguishes discovery from configuration", () => {
  assert.deepEqual(LocalRuntimeInventoryRequestSchema.parse({}), {});
  assert.throws(() =>
    LocalRuntimeInventoryRequestSchema.parse({ hostId: "injected" }),
  );
  const inventory = LocalRuntimeInventoryResponseSchema.parse({
    hostId: "macbook-host",
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
        version: "codex-cli 0.149.1",
      },
      {
        agentBindings: [],
        available: false,
        configured: false,
        displayName: "Claude Code",
        executable: "claude",
        modelBindingDescriptors: [],
        source: "discovered",
      },
    ],
  });
  assert.equal(inventory.runtimes[0]?.runtimeProfileId, "profile-codex");
  assert.throws(() =>
    LocalRuntimeInventoryResponseSchema.parse({
      hostId: "macbook-host",
      restartRequiredToRescan: true,
      runtimes: [
        {
          agentBindings: [],
          available: true,
          configured: false,
          displayName: "Codex",
          executable: "codex",
          source: "discovered",
        },
      ],
    }),
  );
});

test("Client API v1/v2/v3 contracts are strict, actor-free, and transport-neutral", () => {
  assert.equal(CLIENT_API_VERSION, 3);
  assert.deepEqual(
    ClientRoomSyncRequestSchema.parse({
      afterSeq: 3,
      consumerId: "browser-main",
      limit: 100,
      roomId: "room-1",
    }),
    {
      afterSeq: 3,
      consumerId: "browser-main",
      limit: 100,
      roomId: "room-1",
    },
  );
  assert.throws(() =>
    ClientRoomSyncRequestSchema.parse({
      actorId: "injected-human",
      consumerId: "browser-main",
      roomId: "room-1",
    }),
  );

  assert.deepEqual(ClientWorkspacesListRequestSchema.parse({}), {});
  assert.deepEqual(
    ClientRoomAgentActivityListRequestSchema.parse({ roomId: "room-1" }),
    { roomId: "room-1" },
  );
  assert.deepEqual(
    ClientRoomAgentActivityListResponseSchema.parse({
      agents: [
        {
          activationId: "activation-1",
          participantId: "agent-1",
          roomId: "room-1",
          state: "waking",
          updatedAt: "2026-08-27T00:00:00.000Z",
        },
      ],
    }).agents[0]?.state,
    "waking",
  );
  assert.deepEqual(
    ClientRoomsListRequestSchema.parse({ workspaceId: "workspace-1" }),
    { workspaceId: "workspace-1" },
  );
  assert.deepEqual(
    ClientRoomMemberAddRequestSchema.parse({
      basedOnRoomSeq: 9,
      idempotencyKey: "member-add-1",
      principalId: "principal-bob",
      role: "member",
      roomId: "room-1",
    }),
    {
      basedOnRoomSeq: 9,
      idempotencyKey: "member-add-1",
      principalId: "principal-bob",
      role: "member",
      roomId: "room-1",
    },
  );
  assert.deepEqual(
    ClientMessagePostRequestSchema.parse({
      basedOnRoomSeq: 9,
      body: "Room-owned message",
      idempotencyKey: "message-post-1",
      roomId: "room-1",
    }),
    {
      basedOnRoomSeq: 9,
      body: "Room-owned message",
      idempotencyKey: "message-post-1",
      recipients: [],
      roomId: "room-1",
    },
  );
  assert.deepEqual(
    WorkerMessagePostRequestSchema.parse({
      basedOnRoomSeq: 9,
      heldDraftId: "held-draft-1",
      idempotencyKey: "message-send-draft-1",
      sendDraft: true,
    }),
    {
      basedOnRoomSeq: 9,
      heldDraftId: "held-draft-1",
      idempotencyKey: "message-send-draft-1",
      sendDraft: true,
    },
  );
  assert.deepEqual(
    WorkerMessagePostRequestSchema.parse({
      anyway: true,
      basedOnRoomSeq: 10,
      heldDraftId: "held-draft-2",
      idempotencyKey: "message-send-anyway-1",
      sendDraft: true,
    }),
    {
      anyway: true,
      basedOnRoomSeq: 10,
      heldDraftId: "held-draft-2",
      idempotencyKey: "message-send-anyway-1",
      sendDraft: true,
    },
  );
  assert.throws(() =>
    WorkerMessagePostRequestSchema.parse({
      anyway: true,
      basedOnRoomSeq: 10,
      body: "An ordinary composed reply cannot bypass freshness",
      idempotencyKey: "message-invalid-anyway",
    }),
  );
  assert.throws(() =>
    WorkerMessagePostRequestSchema.parse({
      basedOnRoomSeq: 10,
      body: "A saved draft supplies its own body",
      heldDraftId: "held-draft-3",
      idempotencyKey: "message-invalid-draft-body",
      sendDraft: true,
    }),
  );
  assert.deepEqual(
    ClientRoomMemberRemoveRequestSchema.parse({
      basedOnRoomSeq: 10,
      idempotencyKey: "member-remove-1",
      principalId: "principal-bob",
      roomId: "room-1",
    }),
    {
      basedOnRoomSeq: 10,
      idempotencyKey: "member-remove-1",
      principalId: "principal-bob",
      roomId: "room-1",
    },
  );
  assert.deepEqual(
    ClientMessagesListRequestSchema.parse({
      roomId: "room-1",
      threadId: "thread-1",
    }),
    {
      limit: 100,
      roomId: "room-1",
      threadId: "thread-1",
    },
  );
  assert.deepEqual(
    ClientMessagesListRequestSchema.parse({
      beforeSeq: 90,
      limit: 50,
      roomId: "room-1",
    }),
    { beforeSeq: 90, limit: 50, roomId: "room-1" },
  );
  assert.throws(() =>
    ClientMessagesListRequestSchema.parse({
      afterSeq: 20,
      beforeSeq: 90,
      roomId: "room-1",
    }),
  );
  assert.deepEqual(
    ClientThreadCreateRequestSchema.parse({
      basedOnRoomSeq: 10,
      idempotencyKey: "thread-create-1",
      roomId: "room-1",
      rootMessageId: "message-root",
    }),
    {
      basedOnRoomSeq: 10,
      idempotencyKey: "thread-create-1",
      recipientIds: [],
      roomId: "room-1",
      rootMessageId: "message-root",
    },
  );
  assert.throws(() =>
    ClientThreadReplyRequestSchema.parse({
      actorId: "injected-human",
      basedOnRoomSeq: 11,
      body: "reply",
      idempotencyKey: "thread-reply-1",
      roomId: "room-1",
      threadId: "thread-1",
    }),
  );
  assert.deepEqual(
    ClientThreadReplyRequestSchema.parse({
      attachmentIds: ["attachment-1"],
      basedOnRoomSeq: 11,
      body: "",
      idempotencyKey: "thread-file-reply-1",
      roomId: "room-1",
      threadId: "thread-1",
    }),
    {
      attachmentIds: ["attachment-1"],
      basedOnRoomSeq: 11,
      body: "",
      idempotencyKey: "thread-file-reply-1",
      recipientIds: [],
      roomId: "room-1",
      threadId: "thread-1",
    },
  );
  assert.throws(() =>
    ClientThreadReplyRequestSchema.parse({
      basedOnRoomSeq: 11,
      body: "",
      idempotencyKey: "empty-thread-reply",
      roomId: "room-1",
      threadId: "thread-1",
    }),
  );
  assert.throws(() =>
    ClientRoomSyncRequestSchema.parse({
      consumerId: "browser-main",
      limit: 501,
      roomId: "room-1",
    }),
  );

  assert.deepEqual(
    ClientAcknowledgeRequestSchema.parse({
      consumerId: "browser-main",
      roomId: "room-1",
      throughSeq: 9,
    }),
    {
      consumerId: "browser-main",
      roomId: "room-1",
      throughSeq: 9,
    },
  );
  assert.deepEqual(
    ClientAcknowledgeResponseSchema.parse({ acknowledgedThrough: 9 }),
    { acknowledgedThrough: 9 },
  );

  assert.deepEqual(
    ClientTasksListRequestSchema.parse({
      roomId: "room-1",
      states: ["todo", "submitted"],
    }),
    { roomId: "room-1", states: ["todo", "submitted"] },
  );
  assert.throws(() =>
    ClientTasksListRequestSchema.parse({
      roomId: "room-1",
      states: ["todo", "todo"],
    }),
  );
  assert.deepEqual(
    ClientInputRequestsListRequestSchema.parse({
      roomId: "room-1",
      state: "pending",
    }),
    { roomId: "room-1", state: "pending" },
  );
  assert.throws(() =>
    ClientInputRequestsListRequestSchema.parse({
      responderId: "injected-human",
      roomId: "room-1",
    }),
  );

  const health = ClientHealthResponseSchema.parse({
    apiVersion: 3,
    buildVersion: "0.1.0",
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
  });
  assert.equal(health.apiVersion, CLIENT_API_VERSION);
  assert.equal(health.capabilities.hints, false);
  assert.throws(() =>
    ClientHealthResponseSchema.parse({ ...health, hostToken: "secret" }),
  );
  assert.equal(
    ClientHealthV1ResponseSchema.parse({
      apiVersion: 1,
      buildVersion: "0.1.0",
      capabilities: {
        cursorAcknowledge: true,
        hints: false,
        inputRequestRead: true,
        inputRequestResolve: true,
        roomSync: true,
        taskRead: true,
        taskWrite: true,
      },
      kernelSchemaVersion: 7,
      protocolVersion: 1,
      state: "online",
    }).apiVersion,
    1,
  );

  const syncResponse = ClientRoomSyncResponseSchema.parse({
    cursorAfter: 0,
    cursorBefore: 0,
    events: [],
    latestRoomSeq: 0,
    snapshot: null,
  });
  assert.equal(syncResponse.cursorAfter, 0);
  assert.deepEqual(
    ClientRoomSyncRequestSchema.parse({
      bootstrap: "latest",
      consumerId: "browser-long-room",
      limit: 500,
      roomId: "room-1",
    }),
    {
      bootstrap: "latest",
      consumerId: "browser-long-room",
      limit: 500,
      roomId: "room-1",
    },
  );
  const latestBootstrap = ClientRoomSyncResponseSchema.parse({
    cursorAfter: 100_000,
    cursorBefore: 0,
    eventFloorSeq: 99_500,
    events: [],
    latestRoomSeq: 100_000,
    snapshot: {
      members: [{ handle: "human", kind: "human", principalId: "human-main" }],
      room: {
        createdAt: "2026-08-26T00:00:00.000Z",
        kind: "channel",
        name: "Main Room",
        roomId: "room-1",
        slug: "main-room",
        workspaceId: "workspace-main",
      },
    },
    snapshotSeq: 100_000,
  });
  assert.equal(latestBootstrap.eventFloorSeq, 99_500);
  assert.equal(latestBootstrap.snapshotSeq, 100_000);
  assert.throws(() =>
    ClientRoomSyncResponseSchema.parse({
      cursorAfter: 100_000,
      cursorBefore: 0,
      eventFloorSeq: 99_500,
      events: [],
      latestRoomSeq: 100_000,
      snapshot: null,
      snapshotSeq: 100_000,
    }),
  );
  const backwardReplayPage = ClientRoomSyncResponseSchema.parse({
    cursorAfter: 2,
    cursorBefore: 3,
    events: [1, 2].map((roomSeq) => ({
      actorId: "human-main",
      aggregateId: `message-${String(roomSeq)}`,
      aggregateType: "message",
      createdAt: "2026-08-26T00:00:00.000Z",
      eventId: `event-${String(roomSeq)}`,
      idempotencyKey: `event-key-${String(roomSeq)}`,
      payload: { body: `message ${String(roomSeq)}` },
      roomId: "room-1",
      roomSeq,
      schemaVersion: 1,
      type: "message.posted",
    })),
    latestRoomSeq: 3,
    snapshot: {
      members: [{ handle: "human", kind: "human", principalId: "human-main" }],
      room: {
        createdAt: "2026-08-26T00:00:00.000Z",
        kind: "channel",
        name: "Main Room",
        roomId: "room-1",
        slug: "main-room",
        workspaceId: "workspace-main",
      },
    },
  });
  assert.equal(backwardReplayPage.cursorBefore, 3);
  assert.equal(backwardReplayPage.cursorAfter, 2);
  assert.deepEqual(ClientTasksListResponseSchema.parse({ tasks: [] }), {
    tasks: [],
  });
  assert.deepEqual(
    ClientTasksListResponseSchema.parse({
      nextBeforeTaskNumber: 41,
      tasks: [],
    }),
    { nextBeforeTaskNumber: 41, tasks: [] },
  );
  assert.deepEqual(
    ClientTaskGetRequestSchema.parse({ roomId: "room-1", taskId: "task-1" }),
    { roomId: "room-1", taskId: "task-1" },
  );
  const exactTask = TaskSchema.parse({
    collaboratorIds: [],
    createdAt: "2026-08-26T00:00:00.000Z",
    creatorId: "human-main",
    dependencyTaskIds: [],
    reviewerIds: [],
    roomId: "room-1",
    sourceMessageId: "message-1",
    state: "todo",
    taskId: "task-1",
    taskNumber: 1,
    threadId: "thread-1",
    title: "Exact task",
    updatedAt: "2026-08-26T00:00:00.000Z",
  });
  assert.equal(
    ClientTaskGetResponseSchema.parse({ task: exactTask }).task.taskId,
    exactTask.taskId,
  );
  assert.deepEqual(
    ClientInputRequestsListResponseSchema.parse({ inputRequests: [] }),
    { inputRequests: [] },
  );
});

test("Client API v3 creates managed Workspaces and Rooms without caller-selected actors", () => {
  assert.deepEqual(
    ClientWorkspaceCreateRequestSchema.parse({
      idempotencyKey: "workspace-create-main",
      name: "RAH OS",
      slug: "rah-os",
    }),
    {
      idempotencyKey: "workspace-create-main",
      name: "RAH OS",
      slug: "rah-os",
    },
  );
  assert.deepEqual(
    ClientRoomCreateRequestSchema.parse({
      basedOnControlRoomSeq: 1,
      idempotencyKey: "room-create-engineering",
      kind: "channel",
      name: "Engineering",
      slug: "engineering",
      workspaceId: "workspace-main",
    }),
    {
      basedOnControlRoomSeq: 1,
      idempotencyKey: "room-create-engineering",
      kind: "channel",
      name: "Engineering",
      slug: "engineering",
      workspaceId: "workspace-main",
    },
  );
  assert.throws(() =>
    ClientWorkspaceCreateRequestSchema.parse({
      actorId: "principal-forged",
      idempotencyKey: "workspace-create-main",
      name: "RAH OS",
      slug: "rah-os",
    }),
  );
  assert.throws(() =>
    ClientRoomCreateRequestSchema.parse({
      basedOnControlRoomSeq: 1,
      idempotencyKey: "room-create-control",
      kind: "control",
      name: "Second Control",
      slug: "second-control",
      workspaceId: "workspace-main",
    }),
  );
});

test("Client API v3 opens a Raft-shaped Direct Room without caller-selected membership", () => {
  assert.deepEqual(
    ClientDirectRoomOpenRequestSchema.parse({
      basedOnControlRoomSeq: 4,
      idempotencyKey: "direct-open-cindy",
      peerPrincipalId: "principal-cindy",
      workspaceId: "workspace-main",
    }),
    {
      basedOnControlRoomSeq: 4,
      idempotencyKey: "direct-open-cindy",
      peerPrincipalId: "principal-cindy",
      workspaceId: "workspace-main",
    },
  );
  assert.deepEqual(
    ClientDirectRoomOpenResponseSchema.parse({
      room: {
        createdAt: "2026-08-29T00:00:00.000Z",
        kind: "direct",
        name: "cindy",
        roomId: "room-direct-cindy",
        slug: "dm-1234",
        workspaceId: "workspace-main",
      },
    }).room.kind,
    "direct",
  );
  assert.throws(() =>
    ClientDirectRoomOpenRequestSchema.parse({
      actorId: "principal-forged",
      basedOnControlRoomSeq: 4,
      idempotencyKey: "direct-open-cindy",
      memberIds: ["principal-cindy", "principal-alice"],
      peerPrincipalId: "principal-cindy",
      workspaceId: "workspace-main",
    }),
  );
});

test("Client API v3 Agent catalog onboarding resolves definitions instead of accepting participant injection", () => {
  assert.throws(() => ClientAgentsListRequestSchema.parse({}));
  assert.deepEqual(
    ClientAgentsListRequestSchema.parse({ controlRoomId: "room-control" }),
    { controlRoomId: "room-control" },
  );
  assert.deepEqual(
    ClientAgentOnboardRequestSchema.parse({
      agentId: "agent-definition-1",
      basedOnRoomSeq: 1,
      idempotencyKey: "agent-onboard-1",
      roomId: "room-work",
    }),
    {
      agentId: "agent-definition-1",
      basedOnRoomSeq: 1,
      idempotencyKey: "agent-onboard-1",
      roomId: "room-work",
    },
  );
  assert.throws(() =>
    ClientAgentOnboardRequestSchema.parse({
      agentId: "agent-definition-1",
      basedOnRoomSeq: 1,
      idempotencyKey: "agent-onboard-1",
      participantId: "injected-agent",
      roomId: "room-work",
    }),
  );
  assert.deepEqual(
    ClientAgentRoomsListRequestSchema.parse({
      agentId: "agent-definition-1",
    }),
    { agentId: "agent-definition-1" },
  );
  assert.deepEqual(
    ClientAgentRoomsListResponseSchema.parse({
      rooms: [
        {
          createdAt: "2026-08-28T00:00:00.000Z",
          kind: "channel",
          name: "Engineering",
          roomId: "room-engineering",
          slug: "engineering",
          workspaceId: "workspace-main",
        },
      ],
    }).rooms[0]?.roomId,
    "room-engineering",
  );
  assert.throws(() =>
    ClientAgentRoomsListResponseSchema.parse({
      rooms: [{ kind: "channel", roomId: "room-incomplete" }],
    }),
  );
});

test("Agent activity is a bounded canonical timeline with an opaque continuation", () => {
  assert.deepEqual(
    ClientAgentActivityListRequestSchema.parse({
      agentId: "agent-definition-1",
    }),
    { agentId: "agent-definition-1", limit: 50 },
  );
  assert.deepEqual(
    ClientAgentActivityListRequestSchema.parse({
      agentId: "agent-definition-1",
      beforeActivityId: "event-7",
      limit: 25,
    }),
    {
      agentId: "agent-definition-1",
      beforeActivityId: "event-7",
      limit: 25,
    },
  );
  assert.throws(() =>
    ClientAgentActivityListRequestSchema.parse({
      agentId: "agent-definition-1",
      limit: 101,
    }),
  );
  assert.throws(() =>
    ClientAgentActivityListRequestSchema.parse({
      agentId: "agent-definition-1",
      participantId: "injected-agent",
    }),
  );

  const response = ClientAgentActivityListResponseSchema.parse({
    activities: [
      {
        activityId: "event-7",
        aggregateId: "run-1",
        aggregateType: "run_attempt",
        createdAt: "2026-08-28T00:00:07.000Z",
        eventType: "run.started",
        participantId: "agent-1",
        relation: "runtime",
        roomId: "room-engineering",
        roomKind: "channel",
        roomName: "Engineering",
        roomSeq: 7,
        roomSlug: "engineering",
        source: "room_event",
        tone: "active",
      },
    ],
    nextCursor: "event-7",
  });
  assert.equal(response.activities[0]?.eventType, "run.started");
  assert.throws(() =>
    ClientAgentActivityListResponseSchema.parse({
      activities: [
        {
          ...response.activities[0],
          payload: { output: "provider transcript must not cross this API" },
        },
      ],
    }),
  );
  const toolActivity = ClientAgentActivityListResponseSchema.parse({
    activities: [
      {
        activityId: "managed-mcp-call-1",
        completedAt: "2026-08-28T00:00:08.000Z",
        createdAt: "2026-08-28T00:00:07.000Z",
        isError: false,
        managedMcpCallId: "managed-mcp-call-1",
        mcpServerId: "mcp-room-tools",
        participantId: "agent-1",
        relation: "tool",
        roomId: "room-engineering",
        roomKind: "channel",
        roomName: "Engineering",
        roomSlug: "engineering",
        runAttemptId: "run-1",
        serverName: "RAH Room tools",
        source: "managed_mcp_call",
        state: "completed",
        tone: "success",
        toolName: "room.snapshot",
      },
    ],
  }).activities[0];
  assert.equal(toolActivity?.source, "managed_mcp_call");
  assert.throws(() =>
    ClientAgentActivityListResponseSchema.parse({
      activities: [
        {
          ...toolActivity,
          arguments: { roomId: "secret-room" },
        },
      ],
    }),
  );
});

test("Agent runtime trajectory is typed, bounded, and independently pageable", () => {
  assert.deepEqual(
    ClientAgentTrajectoryListRequestSchema.parse({
      agentId: "agent-definition-1",
    }),
    { agentId: "agent-definition-1", limit: 50 },
  );
  const response = ClientAgentTrajectoryListResponseSchema.parse({
    activities: [
      {
        activityId: "runtime-activity-1",
        entry: {
          kind: "tool_start",
          producerFactId: "codex-item-1",
          toolInput: "rg -n TODO src",
          toolName: "shell",
        },
        observedAt: "2026-08-29T01:00:00.000Z",
        participantId: "agent-1",
        producerSequence: 1,
        recordedAt: "2026-08-29T01:00:00.100Z",
        roomId: "room-1",
        runAttemptId: "run-1",
        runtimeRunId: "runtime-1",
        serverSequence: 7,
      },
    ],
    nextCursor: "runtime-activity-1",
  });
  assert.equal(response.activities[0]?.entry.kind, "tool_start");
  assert.throws(() =>
    ClientAgentTrajectoryListResponseSchema.parse({
      activities: [
        {
          ...response.activities[0],
          entry: {
            kind: "tool_start",
            toolInput: "x".repeat(4_097),
            toolName: "shell",
          },
        },
      ],
    }),
  );
  assert.throws(() =>
    ClientAgentTrajectoryListRequestSchema.parse({
      agentId: "agent-definition-1",
      participantId: "injected-agent",
    }),
  );
});

test("RoomEvent requires stable room sequence and schema version", () => {
  const event = RoomEventSchema.parse({
    eventId: "evt-1",
    roomId: "room-1",
    roomSeq: 3,
    type: "message.posted",
    actorId: "principal-1",
    aggregateType: "message",
    aggregateId: "message-1",
    payload: { body: "hello" },
    idempotencyKey: "message-1",
    schemaVersion: 1,
    createdAt: "2026-08-25T00:00:00.000Z",
  });

  assert.equal(event.roomSeq, 3);
  assert.throws(() => RoomEventSchema.parse({ ...event, roomSeq: 0 }));
  assert.throws(() => RoomEventSchema.parse({ ...event, schemaVersion: 0 }));
});

test("WakeHint is content-free and references durable activation state", () => {
  const wake = WakeHintSchema.parse({
    activationId: "activation-1",
    participantId: "agent-1",
    roomId: "room-1",
    headCursor: 9,
    reason: "mention",
  });

  assert.deepEqual(Object.keys(wake).sort(), [
    "activationId",
    "headCursor",
    "participantId",
    "reason",
    "roomId",
  ]);
  assert.throws(() =>
    WakeHintSchema.parse({ ...wake, body: "secret message" }),
  );
});

test("Activation has a durable range and explicit lease state", () => {
  const activation = ActivationSchema.parse({
    activationId: "activation-1",
    roomId: "room-1",
    participantId: "agent-1",
    fromSeq: 4,
    toSeq: 8,
    reason: "task_assigned",
    state: "queued",
    attemptCount: 0,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
  });

  assert.equal(activation.state, "queued");
  assert.throws(() =>
    ActivationSchema.parse({ ...activation, fromSeq: 10, toSeq: 8 }),
  );
});

test("Worker API contracts are strict protocol-owned schemas", () => {
  assert.deepEqual(WorkerSyncRequestSchema.parse({ afterSeq: 3 }), {
    afterSeq: 3,
  });
  assert.throws(() =>
    WorkerSyncRequestSchema.parse({ roomId: "worker-selected-room" }),
  );
  assert.deepEqual(WorkerAcknowledgeRequestSchema.parse({ throughSeq: 3 }), {
    throughSeq: 3,
  });
  assert.throws(() => WorkerAcknowledgeRequestSchema.parse({ throughSeq: -1 }));
  const reply = {
    basedOnRoomSeq: 3,
    body: "Activation-scoped Room reply",
    idempotencyKey: "worker-message-1",
  };
  assert.deepEqual(WorkerMessagePostRequestSchema.parse(reply), reply);
  assert.throws(() =>
    WorkerMessagePostRequestSchema.parse({
      ...reply,
      actorId: "injected-agent",
      roomId: "injected-room",
    }),
  );
  assert.throws(() =>
    WorkerMessagePostRequestSchema.parse({ ...reply, body: "   " }),
  );
  const messageMutation = WorkerMessageMutationResponseSchema.parse({
    activationIds: [],
    deduplicated: false,
    event: {
      actorId: "agent-1",
      aggregateId: "message-1",
      aggregateType: "message",
      createdAt: "2026-08-26T00:00:00.000Z",
      eventId: "event-1",
      idempotencyKey: "worker-message-1",
      payload: {
        activationId: "activation-1",
        basedOnRoomSeq: 3,
        body: "Activation-scoped Room reply",
        messageId: "message-1",
        recipientIds: [],
        recipients: [],
      },
      roomId: "room-1",
      roomSeq: 4,
      schemaVersion: 1,
      type: "message.posted",
    },
  });
  assert.deepEqual(messageMutation.activationIds, []);
  const heldMessage = WorkerMessagePostResponseSchema.parse({
    activationIds: [],
    basedOnRoomSeq: 3,
    heldDraftId: "held-draft-1",
    newMessageCount: 1,
    newerMessages: [messageMutation.event],
    omittedMessageCount: 0,
    reason: "newer_messages_available",
    reholdCount: 1,
    shownMessageCount: 1,
    continueAnywaySuggested: false,
    seenUpToSeq: 4,
    state: "held",
  });
  assert.equal("state" in heldMessage ? heldMessage.state : undefined, "held");

  const scope = ActivationCredentialScopeSchema.parse({
    activationId: "activation-1",
    consumerId: "host-1:runtime",
    hostId: "host-1",
    participantId: "agent-1",
    roomId: "room-1",
    runAttemptId: "run-1",
    toSeq: 3,
  });
  assert.equal(scope.toSeq, 3);
  assert.throws(() =>
    ActivationCredentialScopeSchema.parse({ ...scope, toSeq: 0 }),
  );
  const { runAttemptId: _runAttemptId, ...scopeWithoutRun } = scope;
  assert.throws(() => ActivationCredentialScopeSchema.parse(scopeWithoutRun));

  assert.deepEqual(
    WorkerErrorResponseSchema.parse({
      error: { code: "invalid_field", message: "invalid afterSeq" },
    }),
    {
      error: { code: "invalid_field", message: "invalid afterSeq" },
    },
  );
});

test("Runtime recovery descriptors are opaque protocol data", () => {
  const descriptor = RuntimeRecoveryDescriptorSchema.parse({
    driver: "fake-runtime",
    metadata: { processGroupId: 42 },
    recoveryImplementationVersion: "fake-runtime/v1",
    recoveryKey: "fake-run-1",
    runtimeProfileDigest:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    runtimeProfileRevisionId: "runtime-profile-revision-1",
  });
  assert.equal(descriptor.driver, "fake-runtime");
  assert.equal(descriptor.metadata.processGroupId, 42);
  assert.equal(descriptor.recoveryImplementationVersion, "fake-runtime/v1");
  assert.throws(() =>
    RuntimeRecoveryDescriptorSchema.parse({
      ...descriptor,
      transcript: "must not enter process recovery metadata",
    }),
  );
  assert.throws(() =>
    RuntimeRecoveryDescriptorSchema.parse({
      driver: "fake-runtime",
      metadata: {},
      recoveryKey: "fake-run-with-partial-provenance",
      runtimeProfileRevisionId: "runtime-profile-revision-1",
    }),
  );
});

test("Task is a strict business projection with an independent claim lease", () => {
  const task = TaskSchema.parse({
    assigneeId: "agent-1",
    collaboratorIds: ["agent-2"],
    claimedBy: "agent-1",
    claimUntil: "2026-08-25T00:05:00.000Z",
    createdAt: "2026-08-25T00:00:00.000Z",
    creatorId: "human-1",
    description: "Implement the narrow protocol",
    roomId: "room-1",
    sourceMessageId: "message-task-1",
    state: "claimed",
    taskId: "task-1",
    taskNumber: 1,
    threadId: "thread-task-1",
    title: "Build Task workflow",
    updatedAt: "2026-08-25T00:00:01.000Z",
    reviewerIds: ["agent-2"],
  });

  assert.equal(task.state, "claimed");
  assert.equal(task.taskNumber, 1);
  assert.deepEqual(task.collaboratorIds, ["agent-2"]);
  assert.deepEqual(task.reviewerIds, ["agent-2"]);
  assert.throws(() =>
    TaskSchema.parse({ ...task, collaboratorIds: ["agent-2", "agent-2"] }),
  );
  assert.throws(() =>
    TaskSchema.parse({ ...task, collaboratorIds: ["agent-1"] }),
  );
  assert.throws(() =>
    TaskSchema.parse({ ...task, sourceMessageId: undefined }),
  );
  assert.throws(() => TaskSchema.parse({ ...task, taskNumber: undefined }));
  assert.throws(() => TaskSchema.parse({ ...task, threadId: undefined }));
  assert.throws(() =>
    TaskSchema.parse({ ...task, claimUntil: undefined, claimedBy: undefined }),
  );
  assert.throws(() => TaskSchema.parse({ ...task, runtimeRunId: "run-1" }));
  const waiting = TaskSchema.parse({
    ...task,
    claimedBy: undefined,
    claimUntil: undefined,
    state: "waiting_input",
  });
  assert.equal(waiting.state, "waiting_input");
  const manualReview = TaskSchema.parse({
    ...task,
    claimUntil: undefined,
    claimedBy: undefined,
    state: "submitted",
  });
  assert.equal(manualReview.submissionSummary, undefined);
});

test("Task Coordination v1 represents open, blocked, and cancelled work explicitly", () => {
  const open = TaskSchema.parse({
    createdAt: "2026-08-25T00:00:00.000Z",
    creatorId: "human-1",
    dependencyTaskIds: [],
    roomId: "room-1",
    sourceMessageId: "message-task-open",
    state: "todo",
    taskId: "task-open",
    taskNumber: 1,
    threadId: "thread-task-open",
    title: "Available to every Room Agent",
    updatedAt: "2026-08-25T00:00:00.000Z",
  });
  assert.equal(open.assigneeId, undefined);
  assert.deepEqual(open.collaboratorIds, []);
  assert.deepEqual(open.reviewerIds, []);
  assert.throws(() =>
    TaskSchema.parse({ ...open, collaboratorIds: ["agent-1"] }),
  );
  assert.throws(() =>
    TaskSchema.parse({
      ...open,
      dependencyTaskIds: ["task-older", "task-older"],
    }),
  );

  const blocked = TaskSchema.parse({
    ...open,
    assigneeId: "agent-1",
    blockedAt: "2026-08-25T00:01:00.000Z",
    blockedReason: "Waiting for an external fact",
    state: "blocked",
  });
  assert.equal(blocked.state, "blocked");
  assert.throws(() =>
    TaskSchema.parse({ ...blocked, blockedReason: undefined }),
  );

  const cancelled = TaskSchema.parse({
    ...open,
    cancellationReason: "No longer needed",
    cancelledAt: "2026-08-25T00:02:00.000Z",
    state: "cancelled",
  });
  assert.equal(cancelled.state, "cancelled");
  assert.throws(() =>
    TaskSchema.parse({ ...cancelled, cancellationReason: undefined }),
  );

  assert.deepEqual(
    ClientTaskReopenRequestSchema.parse({
      basedOnRoomSeq: 14,
      idempotencyKey: "reopen-task-1",
      taskId: "task-open",
    }),
    {
      basedOnRoomSeq: 14,
      idempotencyKey: "reopen-task-1",
      taskId: "task-open",
    },
  );
  assert.throws(() =>
    ClientTaskReopenRequestSchema.parse({
      actorId: "human-injected",
      basedOnRoomSeq: 14,
      idempotencyKey: "reopen-task-1",
      taskId: "task-open",
    }),
  );
});

test("Task Coordination worker commands are causal and actor-free", () => {
  assert.deepEqual(
    WorkerTaskClaimMessageRequestSchema.parse({
      basedOnRoomSeq: 11,
      idempotencyKey: "claim-message-1",
      messageId: "message-1",
      rationale:
        "Requires persistent code changes, multiple steps, and final review",
    }),
    {
      basedOnRoomSeq: 11,
      idempotencyKey: "claim-message-1",
      messageId: "message-1",
      rationale:
        "Requires persistent code changes, multiple steps, and final review",
    },
  );
  assert.throws(() =>
    WorkerTaskClaimMessageRequestSchema.parse({
      basedOnRoomSeq: 11,
      idempotencyKey: "claim-message-1",
      messageId: "message-1",
      rationale: "tool use",
      taskId: "injected-task",
    }),
  );
  assert.deepEqual(
    WorkerTaskCreateRequestSchema.parse({
      basedOnRoomSeq: 11,
      idempotencyKey: "create-task-1",
      title: "Split: migration",
    }),
    {
      basedOnRoomSeq: 11,
      idempotencyKey: "create-task-1",
      title: "Split: migration",
    },
  );
  assert.throws(() =>
    WorkerTaskCreateRequestSchema.parse({
      basedOnRoomSeq: 11,
      idempotencyKey: "create-task-1",
      title: "   ",
    }),
  );
  assert.throws(() =>
    WorkerTaskCreateRequestSchema.parse({
      basedOnRoomSeq: 11,
      creatorId: "agent-injected",
      idempotencyKey: "create-task-1",
      title: "Split: migration",
    }),
  );
  assert.deepEqual(
    WorkerTaskReleaseRequestSchema.parse({
      basedOnRoomSeq: 12,
      idempotencyKey: "release-task-1",
      taskId: "task-1",
    }),
    {
      basedOnRoomSeq: 12,
      idempotencyKey: "release-task-1",
      taskId: "task-1",
    },
  );
  assert.deepEqual(
    WorkerTaskBlockRequestSchema.parse({
      basedOnRoomSeq: 13,
      idempotencyKey: "block-task-1",
      reason: "Need a maintainer decision",
      taskId: "task-1",
    }),
    {
      basedOnRoomSeq: 13,
      idempotencyKey: "block-task-1",
      reason: "Need a maintainer decision",
      taskId: "task-1",
    },
  );
  assert.throws(() =>
    WorkerTaskBlockRequestSchema.parse({
      actorId: "agent-1",
      basedOnRoomSeq: 13,
      idempotencyKey: "block-task-1",
      reason: "Need a maintainer decision",
      taskId: "task-1",
    }),
  );
});

test("Task Coordination client commands keep actor identity server-owned", () => {
  assert.deepEqual(
    ClientTaskCreateRequestSchema.parse({
      assigneeId: "agent-owner",
      collaboratorIds: ["agent-collaborator"],
      dependencyTaskIds: ["task-older"],
      idempotencyKey: "create-task-new",
      reviewerIds: ["agent-reviewer"],
      roomId: "room-1",
      title: "Coordinate the next step",
    }),
    {
      assigneeId: "agent-owner",
      collaboratorIds: ["agent-collaborator"],
      dependencyTaskIds: ["task-older"],
      idempotencyKey: "create-task-new",
      reviewerIds: ["agent-reviewer"],
      roomId: "room-1",
      title: "Coordinate the next step",
    },
  );
  assert.throws(() =>
    ClientTaskCreateRequestSchema.parse({
      collaboratorIds: ["agent-collaborator"],
      dependencyTaskIds: [],
      idempotencyKey: "open-task-cannot-name-collaborators",
      roomId: "room-1",
      title: "Ambiguous ownership",
    }),
  );
  assert.throws(() =>
    ClientTaskCreateRequestSchema.parse({
      assigneeId: "agent-owner",
      collaboratorIds: ["agent-owner"],
      dependencyTaskIds: [],
      idempotencyKey: "owner-cannot-be-collaborator",
      roomId: "room-1",
      title: "Duplicate role",
    }),
  );
  const causal = {
    basedOnRoomSeq: 12,
    idempotencyKey: "task-command",
    taskId: "task-1",
  };
  assert.deepEqual(
    ClientTaskConvertRequestSchema.parse({
      basedOnRoomSeq: 12,
      dependencyTaskIds: [],
      idempotencyKey: "convert-message-to-task",
      messageId: "message-1",
      roomId: "room-1",
    }),
    {
      basedOnRoomSeq: 12,
      dependencyTaskIds: [],
      idempotencyKey: "convert-message-to-task",
      messageId: "message-1",
      roomId: "room-1",
    },
  );
  assert.throws(() =>
    ClientTaskConvertRequestSchema.parse({
      actorId: "human-injected",
      basedOnRoomSeq: 12,
      idempotencyKey: "convert-message-to-task",
      messageId: "message-1",
      roomId: "room-1",
    }),
  );
  assert.throws(() =>
    ClientTaskConvertRequestSchema.parse({
      basedOnRoomSeq: 12,
      idempotencyKey: "convert-message-to-task",
      messageId: "message-1",
      roomId: "room-1",
      title: "The title must come from the canonical Message",
    }),
  );
  assert.deepEqual(
    ClientTaskAssignRequestSchema.parse({
      ...causal,
      assigneeId: "agent-1",
    }),
    { ...causal, assigneeId: "agent-1" },
  );
  assert.deepEqual(ClientTaskUnblockRequestSchema.parse(causal), causal);
  assert.deepEqual(ClientTaskCompleteRequestSchema.parse(causal), causal);
  assert.deepEqual(
    ClientTaskCancelRequestSchema.parse({
      ...causal,
      reason: "Requirement withdrawn",
    }),
    { ...causal, reason: "Requirement withdrawn" },
  );
  assert.throws(() =>
    ClientTaskCancelRequestSchema.parse({
      ...causal,
      actorId: "human-injected",
      reason: "Requirement withdrawn",
    }),
  );
  assert.ok(WorkerTaskAttentionMutationResponseSchema);
});

test("InputRequest is canonical, targeted, and requires resolution evidence", () => {
  const pending = InputRequestSchema.parse({
    createdAt: "2026-08-25T00:00:00.000Z",
    inputRequestId: "input-1",
    question: "Which deployment target should I use?",
    requesterId: "agent-1",
    responderId: "human-1",
    roomId: "room-1",
    state: "pending",
    taskId: "task-1",
    updatedAt: "2026-08-25T00:00:00.000Z",
  });
  assert.equal(pending.state, "pending");
  assert.throws(() =>
    InputRequestSchema.parse({ ...pending, answer: "Production" }),
  );

  const cancelled = InputRequestSchema.parse({
    ...pending,
    cancelledAt: "2026-08-25T00:30:00.000Z",
    cancelledBy: "human-1",
    cancellationReason: "The Task is no longer required",
    state: "cancelled",
    updatedAt: "2026-08-25T00:30:00.000Z",
  });
  assert.equal(cancelled.state, "cancelled");
  assert.throws(() =>
    InputRequestSchema.parse({
      ...cancelled,
      cancelledAt: undefined,
    }),
  );
  assert.throws(() =>
    InputRequestSchema.parse({
      ...cancelled,
      answer: "This must not look resolved",
      resolvedAt: "2026-08-25T00:31:00.000Z",
      resolvedBy: "human-1",
    }),
  );

  const resolved = InputRequestSchema.parse({
    ...pending,
    answer: "Use staging first",
    resolvedAt: "2026-08-25T01:00:00.000Z",
    resolvedBy: "human-1",
    state: "resolved",
    updatedAt: "2026-08-25T01:00:00.000Z",
  });
  assert.equal(resolved.answer, "Use staging first");
  assert.throws(() =>
    InputRequestSchema.parse({
      ...resolved,
      answer: undefined,
      resolvedAt: undefined,
    }),
  );
  assert.throws(() =>
    InputRequestSchema.parse({ ...pending, providerSessionId: "opaque" }),
  );

  const resolveCommand = {
    answer: "Use staging first",
    basedOnRoomSeq: 9,
    idempotencyKey: "resolve-input-1",
    inputRequestId: "input-1",
  };
  assert.deepEqual(
    InputRequestResolveRequestSchema.parse(resolveCommand),
    resolveCommand,
  );
  assert.throws(() =>
    InputRequestResolveRequestSchema.parse({
      ...resolveCommand,
      responderId: "injected-responder",
    }),
  );

  const response = InputRequestResolveResponseSchema.parse({
    activationIds: ["activation-2"],
    deduplicated: false,
    event: {
      actorId: "human-1",
      aggregateId: "input-1",
      aggregateType: "input_request",
      createdAt: "2026-08-25T01:00:00.000Z",
      eventId: "event-resolved",
      idempotencyKey: "resolve-input-1",
      payload: {
        answer: "Use staging first",
        basedOnRoomSeq: 9,
        inputRequestId: "input-1",
        taskId: "task-1",
      },
      roomId: "room-1",
      roomSeq: 10,
      schemaVersion: 1,
      type: "input.resolved",
    },
    inputRequest: resolved,
    task: {
      assigneeId: "agent-1",
      createdAt: "2026-08-25T00:00:00.000Z",
      creatorId: "human-1",
      roomId: "room-1",
      sourceMessageId: "message-task-1",
      state: "todo",
      taskId: "task-1",
      taskNumber: 1,
      threadId: "thread-task-1",
      title: "Build Task workflow",
      updatedAt: "2026-08-25T01:00:00.000Z",
    },
  });
  assert.deepEqual(response.activationIds, ["activation-2"]);
});

test("Worker Task commands are strict and carry a causal Room sequence", () => {
  const causal = {
    basedOnRoomSeq: 7,
    idempotencyKey: "task-command-1",
    taskId: "task-1",
  };
  assert.deepEqual(WorkerTaskClaimRequestSchema.parse(causal), causal);
  assert.deepEqual(WorkerTaskStartRequestSchema.parse(causal), causal);
  assert.deepEqual(
    WorkerTaskProgressRequestSchema.parse({
      ...causal,
      progress: "Tests are green",
    }),
    { ...causal, progress: "Tests are green" },
  );
  assert.deepEqual(
    WorkerTaskSubmitRequestSchema.parse({
      ...causal,
      summary: "Implemented and verified",
    }),
    { ...causal, summary: "Implemented and verified" },
  );
  assert.deepEqual(
    WorkerTaskRequestInputRequestSchema.parse({
      ...causal,
      question: "Should this remain local-only?",
    }),
    { ...causal, question: "Should this remain local-only?" },
  );
  assert.throws(() =>
    WorkerTaskClaimRequestSchema.parse({ ...causal, roomId: "injected" }),
  );
  assert.throws(() =>
    WorkerTaskProgressRequestSchema.parse({ ...causal, progress: "   " }),
  );
  assert.throws(() =>
    WorkerTaskRequestInputRequestSchema.parse({
      ...causal,
      question: "   ",
    }),
  );

  const response = WorkerTaskMutationResponseSchema.parse({
    deduplicated: false,
    event: {
      actorId: "agent-1",
      aggregateId: "task-1",
      aggregateType: "task",
      createdAt: "2026-08-25T00:00:01.000Z",
      eventId: "event-1",
      idempotencyKey: "task-command-1",
      payload: { basedOnRoomSeq: 7, taskId: "task-1" },
      roomId: "room-1",
      roomSeq: 8,
      schemaVersion: 1,
      type: "task.claimed",
    },
    task: {
      assigneeId: "agent-1",
      claimedBy: "agent-1",
      claimUntil: "2026-08-25T00:05:00.000Z",
      createdAt: "2026-08-25T00:00:00.000Z",
      creatorId: "human-1",
      roomId: "room-1",
      sourceMessageId: "message-task-1",
      state: "claimed",
      taskId: "task-1",
      taskNumber: 1,
      threadId: "thread-task-1",
      title: "Build Task workflow",
      updatedAt: "2026-08-25T00:00:01.000Z",
    },
  });
  assert.equal(response.event.type, "task.claimed");

  const inputResponse = WorkerTaskRequestInputResponseSchema.parse({
    deduplicated: false,
    event: {
      actorId: "agent-1",
      aggregateId: "input-1",
      aggregateType: "input_request",
      createdAt: "2026-08-25T00:00:02.000Z",
      eventId: "event-2",
      idempotencyKey: "task-command-2",
      payload: {
        basedOnRoomSeq: 8,
        inputRequestId: "input-1",
        taskId: "task-1",
      },
      roomId: "room-1",
      roomSeq: 9,
      schemaVersion: 1,
      type: "input.requested",
    },
    inputRequest: {
      createdAt: "2026-08-25T00:00:02.000Z",
      inputRequestId: "input-1",
      question: "Should this remain local-only?",
      requesterId: "agent-1",
      responderId: "human-1",
      roomId: "room-1",
      state: "pending",
      taskId: "task-1",
      updatedAt: "2026-08-25T00:00:02.000Z",
    },
    task: {
      assigneeId: "agent-1",
      createdAt: "2026-08-25T00:00:00.000Z",
      creatorId: "human-1",
      roomId: "room-1",
      sourceMessageId: "message-task-1",
      state: "waiting_input",
      taskId: "task-1",
      taskNumber: 1,
      threadId: "thread-task-1",
      title: "Build Task workflow",
      updatedAt: "2026-08-25T00:00:02.000Z",
    },
  });
  assert.equal(inputResponse.inputRequest.state, "pending");
});

test("Worker Artifact publication freezes Task-scoped evidence without accepting owner scope", () => {
  const prepared = WorkerArtifactPrepareRequestSchema.parse({
    filename: "report.md",
    idempotencyKey: "artifact:task-1:report",
    mimeType: "text/markdown",
    size: 12,
    taskId: "task-1",
  });
  assert.deepEqual(prepared, {
    filename: "report.md",
    idempotencyKey: "artifact:task-1:report",
    mimeType: "text/markdown",
    size: 12,
    taskId: "task-1",
  });
  assert.throws(() =>
    WorkerArtifactPrepareRequestSchema.parse({
      ...prepared,
      producerId: "injected-agent",
      roomId: "injected-room",
      runAttemptId: "injected-run",
    }),
  );

  const submission = TaskSubmissionSchema.parse({
    artifacts: [
      {
        attachmentId: "attachment-1",
        filename: "report.md",
        mimeType: "text/markdown",
        ordinal: 1,
        producerId: "agent-1",
        runAttemptId: "run-1",
        sha256: "a".repeat(64),
        size: 12,
        taskId: "task-1",
      },
    ],
    createdAt: "2026-09-01T00:00:00.000Z",
    evidence: {
      artifactManifestDigest: `sha256:${"c".repeat(64)}`,
      repository: {
        baseCommit: "1".repeat(40),
        headCommit: "2".repeat(40),
        patchAttachmentId: "attachment-1",
        patchDigest: `sha256:${"a".repeat(64)}`,
        patchSize: 12,
        repositoryId: `sha256:${"d".repeat(64)}`,
        source: "host_observed",
        vcs: "git",
      },
      schemaVersion: 1,
      verification: {
        artifactIds: ["attachment-1"],
        source: "producer_declared",
        status: "passed",
        summary: "node --test passed",
      },
      workspace: {
        hostId: "host-1",
        placementId: "placement-1",
        runAttemptId: "run-1",
        source: "placement",
        workspaceDefinitionId: "workspace-definition-1",
        workspaceMode: "in_place",
        workspaceMountDigest: `sha256:${"e".repeat(64)}`,
        workspaceMountRevisionId: "workspace-mount-1",
      },
    },
    messageId: "message-1",
    producerId: "agent-1",
    roomId: "room-1",
    submissionDigest: `sha256:${"b".repeat(64)}`,
    submissionId: "submission-1",
    submissionNumber: 1,
    summary: "Published the report",
    taskId: "task-1",
  });
  assert.equal(submission.artifacts[0]?.runAttemptId, "run-1");
  assert.equal(submission.evidence?.repository.source, "host_observed");
  assert.equal(submission.evidence?.verification.source, "producer_declared");
  if (submission.evidence?.verification.source === "producer_declared") {
    assert.equal(submission.evidence.verification.status, "passed");
  }
  assert.throws(() =>
    TaskSubmissionSchema.parse({
      ...submission,
      artifacts: [
        submission.artifacts[0],
        { ...submission.artifacts[0], filename: "duplicate.md" },
      ],
    }),
  );
  assert.throws(() =>
    TaskSubmissionSchema.parse({
      ...submission,
      evidence: {
        ...submission.evidence,
        repository: {
          ...submission.evidence?.repository,
          patchAttachmentId: "missing-attachment",
        },
      },
    }),
  );

  const userArtifacts = Array.from({ length: 10 }, (_, index) => ({
    ...submission.artifacts[0]!,
    attachmentId: `user-artifact-${index + 1}`,
    filename: `artifact-${index + 1}.md`,
    ordinal: index + 1,
  }));
  const systemPatchArtifact = {
    ...submission.artifacts[0]!,
    attachmentId: "system-delivery-patch",
    filename: "rah-task-delivery.patch",
    ordinal: 11,
  };
  assert.doesNotThrow(() =>
    TaskSubmissionSchema.parse({
      ...submission,
      artifacts: [...userArtifacts, systemPatchArtifact],
      evidence: {
        ...submission.evidence,
        repository: {
          ...submission.evidence?.repository,
          patchAttachmentId: systemPatchArtifact.attachmentId,
        },
        verification: { source: "not_provided" },
      },
    }),
  );
  assert.throws(() =>
    TaskSubmissionSchema.parse({
      ...submission,
      artifacts: [...userArtifacts, systemPatchArtifact],
      evidence: {
        ...submission.evidence,
        repository: {
          reason: "not_git",
          source: "unavailable",
        },
        verification: { source: "not_provided" },
      },
    }),
  );
});

test("Worker Task submit freezes a producer-declared verification result without accepting attestation fields", () => {
  const command = WorkerTaskSubmitRequestSchema.parse({
    basedOnRoomSeq: 9,
    idempotencyKey: "submit-verified-1",
    summary: "Implemented the requested change",
    taskId: "task-1",
    verification: {
      artifactIds: ["artifact-1"],
      status: "passed",
      summary: "npm test passed",
    },
  });
  assert.deepEqual(command.verification, {
    artifactIds: ["artifact-1"],
    status: "passed",
    summary: "npm test passed",
  });
  assert.throws(() =>
    WorkerTaskSubmitRequestSchema.parse({
      ...command,
      verification: {
        ...command.verification,
        source: "host_observed",
      },
    }),
  );
});

test("Worker Task submission evidence lookup accepts only a Task identity", () => {
  assert.deepEqual(
    WorkerTaskSubmissionRequestSchema.parse({ taskId: "task-1" }),
    {
      taskId: "task-1",
    },
  );
  assert.throws(() =>
    WorkerTaskSubmissionRequestSchema.parse({
      roomId: "injected-room",
      submissionId: "injected-submission",
      taskId: "task-1",
    }),
  );
});

test("Task Review freezes one submission and keeps reviewer commands actor-free", () => {
  const command = {
    basedOnRoomSeq: 9,
    disposition: "approved" as const,
    idempotencyKey: "review-1",
    summary: "The frozen submission evidence satisfies the requested scope.",
    taskId: "task-1",
  };
  assert.deepEqual(WorkerTaskReviewRequestSchema.parse(command), command);
  assert.throws(() =>
    WorkerTaskReviewRequestSchema.parse({
      ...command,
      reviewerId: "injected-reviewer",
    }),
  );
  assert.throws(() =>
    WorkerTaskReviewRequestSchema.parse({
      ...command,
      disposition: "commented",
    }),
  );
  const response = WorkerTaskReviewResponseSchema.parse({
    activationIds: [],
    deduplicated: false,
    event: {
      actorId: "agent-reviewer",
      aggregateId: "review-1",
      aggregateType: "review",
      createdAt: "2026-08-29T00:00:02.000Z",
      eventId: "event-review-1",
      idempotencyKey: "review-1",
      payload: {
        basedOnRoomSeq: 9,
        disposition: "approved",
        messageId: "message-review-1",
        submissionDigest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        submissionId: "submission-1",
        summary: command.summary,
        taskId: "task-1",
      },
      roomId: "room-1",
      roomSeq: 10,
      schemaVersion: 1,
      type: "review.submitted",
    },
    review: {
      createdAt: "2026-08-29T00:00:02.000Z",
      disposition: "approved",
      messageId: "message-review-1",
      reviewId: "review-1",
      reviewerId: "agent-reviewer",
      roomId: "room-1",
      submissionDigest:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      submissionId: "submission-1",
      summary: command.summary,
      taskId: "task-1",
    },
    submission: {
      createdAt: "2026-08-29T00:00:01.000Z",
      messageId: "message-submit-1",
      producerId: "agent-owner",
      roomId: "room-1",
      submissionDigest:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      submissionId: "submission-1",
      submissionNumber: 1,
      summary: "Implementation ready",
      taskId: "task-1",
    },
    task: {
      assigneeId: "agent-owner",
      collaboratorIds: [],
      createdAt: "2026-08-29T00:00:00.000Z",
      creatorId: "human-1",
      dependencyTaskIds: [],
      reviewerIds: ["agent-reviewer"],
      roomId: "room-1",
      sourceMessageId: "message-root-1",
      state: "submitted",
      submissionSummary: "Implementation ready",
      submittedAt: "2026-08-29T00:00:01.000Z",
      taskId: "task-1",
      taskNumber: 1,
      threadId: "thread-1",
      title: "Implement feature",
      updatedAt: "2026-08-29T00:00:01.000Z",
    },
  });
  assert.equal(response.review.submissionId, response.submission.submissionId);
});

test("Worker Task query is narrow and returns the canonical projection", () => {
  assert.deepEqual(WorkerTaskGetRequestSchema.parse({ taskId: "task-1" }), {
    taskId: "task-1",
  });
  assert.throws(() =>
    WorkerTaskGetRequestSchema.parse({
      roomId: "injected-room",
      taskId: "task-1",
    }),
  );

  const response = WorkerTaskGetResponseSchema.parse({
    task: {
      assigneeId: "agent-1",
      createdAt: "2026-08-25T00:00:00.000Z",
      creatorId: "human-1",
      roomId: "room-1",
      sourceMessageId: "message-task-1",
      state: "todo",
      taskId: "task-1",
      taskNumber: 1,
      threadId: "thread-task-1",
      title: "Read canonical state",
      updatedAt: "2026-08-25T00:00:00.000Z",
    },
  });
  assert.equal(response.task.state, "todo");

  assert.deepEqual(
    WorkerTaskInputStatusRequestSchema.parse({ taskId: "task-1" }),
    { taskId: "task-1" },
  );
  const inputStatus = WorkerTaskInputStatusResponseSchema.parse({
    inputRequest: {
      inputRequestId: "input-1",
      state: "resolved",
      taskId: "task-1",
    },
  });
  assert.equal(inputStatus.inputRequest?.state, "resolved");
  assert.throws(() =>
    WorkerTaskInputStatusResponseSchema.parse({
      inputRequest: {
        answer: "must remain in the Activation event range",
        inputRequestId: "input-1",
        state: "resolved",
        taskId: "task-1",
      },
    }),
  );
  assert.deepEqual(
    WorkerTaskInputStatusResponseSchema.parse({ inputRequest: null }),
    { inputRequest: null },
  );
});

/**
 * Raft's failure body carries the recovery instruction as a typed field beside
 * the code (`main.js@32524008`). The field is optional so a body written before
 * it existed still parses, and so a situation with no upstream guidance can
 * carry none rather than carrying invented prose.
 */
test("a Worker error body may carry a recovery instruction, and parses without one", () => {
  assert.deepEqual(
    WorkerErrorResponseSchema.parse({
      error: { code: "not_found", message: "message is unavailable" },
    }),
    { error: { code: "not_found", message: "message is unavailable" } },
  );
  const withAction = WorkerErrorResponseSchema.parse({
    error: {
      code: "not_found",
      message: "message is unavailable",
      suggestedNextAction: WORKER_MESSAGE_RESOLVE_NOT_FOUND_NEXT_ACTION,
    },
  });
  assert.equal(
    withAction.error.suggestedNextAction,
    WORKER_MESSAGE_RESOLVE_NOT_FOUND_NEXT_ACTION,
  );
  assert.match(
    WORKER_MESSAGE_RESOLVE_NOT_FOUND_NEXT_ACTION,
    /^Use rah worker message-search to find the message, or rah worker message-read --around only when you want nearby context rather than proof that this id exists\.$/u,
  );
  assert.throws(() =>
    WorkerErrorResponseSchema.parse({
      error: { code: "not_found", message: "m", suggestedNextAction: "" },
    }),
  );
  assert.throws(() =>
    WorkerErrorResponseSchema.parse({
      error: {
        code: "not_found",
        message: "m",
        suggestedNextAction: "x".repeat(4_001),
      },
    }),
  );
  assert.throws(() =>
    WorkerErrorResponseSchema.parse({
      error: { code: "not_found", message: "m", next_action: "wrong name" },
    }),
  );
});
