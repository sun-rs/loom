import assert from "node:assert/strict";
import test from "node:test";

import {
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
  ClientRoomsListRequestSchema,
  ClientThreadCreateRequestSchema,
  ClientThreadReplyRequestSchema,
  ClientWorkspacesListRequestSchema,
  ClientRoomSyncRequestSchema,
  ClientRoomSyncResponseSchema,
  ClientTasksListRequestSchema,
  ClientTasksListResponseSchema,
  ClientTaskAssignRequestSchema,
  ClientTaskCancelRequestSchema,
  ClientTaskCompleteRequestSchema,
  ClientTaskCreateRequestSchema,
  ClientTaskUnblockRequestSchema,
  InputRequestSchema,
  InputRequestResolveRequestSchema,
  InputRequestResolveResponseSchema,
  RoomEventSchema,
  RuntimeRecoveryDescriptorSchema,
  TaskSchema,
  WakeHintSchema,
  WorkerAcknowledgeRequestSchema,
  WorkerErrorResponseSchema,
  WorkerSyncRequestSchema,
  WorkerTaskClaimRequestSchema,
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
  WorkerTaskReleaseRequestSchema,
  WorkerTaskStartRequestSchema,
  WorkerTaskSubmitRequestSchema,
} from "../src/index.ts";

test("Client API v1/v2 contracts are strict, actor-free, and transport-neutral", () => {
  assert.equal(CLIENT_API_VERSION, 2);
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
      afterSeq: 0,
      limit: 100,
      roomId: "room-1",
      threadId: "thread-1",
    },
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

  assert.deepEqual(ClientTasksListRequestSchema.parse({ roomId: "room-1" }), {
    roomId: "room-1",
  });
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
    apiVersion: 2,
    buildVersion: "0.1.0",
    capabilities: {
      cursorAcknowledge: true,
      hints: false,
      inputRequestRead: true,
      inputRequestResolve: true,
      memberRead: true,
      memberWrite: true,
      messageRead: true,
      messageWrite: true,
      roomRead: true,
      roomSync: true,
      taskRead: true,
      taskWrite: true,
      threadRead: true,
      threadWrite: true,
      workspaceRead: true,
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
  assert.deepEqual(ClientTasksListResponseSchema.parse({ tasks: [] }), {
    tasks: [],
  });
  assert.deepEqual(
    ClientInputRequestsListResponseSchema.parse({ inputRequests: [] }),
    { inputRequests: [] },
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
    claimedBy: "agent-1",
    claimUntil: "2026-08-25T00:05:00.000Z",
    createdAt: "2026-08-25T00:00:00.000Z",
    creatorId: "human-1",
    description: "Implement the narrow protocol",
    roomId: "room-1",
    state: "claimed",
    taskId: "task-1",
    title: "Build Task workflow",
    updatedAt: "2026-08-25T00:00:01.000Z",
  });

  assert.equal(task.state, "claimed");
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
  assert.throws(() =>
    TaskSchema.parse({
      ...task,
      claimUntil: undefined,
      claimedBy: undefined,
      state: "submitted",
    }),
  );
});

test("Task Coordination v1 represents open, blocked, and cancelled work explicitly", () => {
  const open = TaskSchema.parse({
    createdAt: "2026-08-25T00:00:00.000Z",
    creatorId: "human-1",
    dependencyTaskIds: [],
    roomId: "room-1",
    state: "todo",
    taskId: "task-open",
    title: "Available to every Room Agent",
    updatedAt: "2026-08-25T00:00:00.000Z",
  });
  assert.equal(open.assigneeId, undefined);
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
});

test("Task Coordination worker commands are causal and actor-free", () => {
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
      dependencyTaskIds: ["task-older"],
      idempotencyKey: "create-task-new",
      roomId: "room-1",
      title: "Coordinate the next step",
    }),
    {
      dependencyTaskIds: ["task-older"],
      idempotencyKey: "create-task-new",
      roomId: "room-1",
      title: "Coordinate the next step",
    },
  );
  const causal = {
    basedOnRoomSeq: 12,
    idempotencyKey: "task-command",
    taskId: "task-1",
  };
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
      state: "todo",
      taskId: "task-1",
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
      state: "claimed",
      taskId: "task-1",
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
      state: "waiting_input",
      taskId: "task-1",
      title: "Build Task workflow",
      updatedAt: "2026-08-25T00:00:02.000Z",
    },
  });
  assert.equal(inputResponse.inputRequest.state, "pending");
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
      state: "todo",
      taskId: "task-1",
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
