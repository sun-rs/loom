import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { type AuthenticatedHostContext, RoomKernel } from "@rah-os/kernel";

import { ClientApplicationService } from "../src/index.ts";

test("Client API authenticates humans and exposes canonical Room work without owning it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-client-api-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const service = new ClientApplicationService({
    health: () => ({
      apiVersion: 2,
      buildVersion: "test-build",
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
    }),
    kernel,
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
    const room = kernel.createRoom(humanActor, {
      name: "Client API",
      slug: "client-api",
    });
    kernel.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    kernel.addMember(humanActor, {
      principalId: memberHuman.principal.principalId,
      roomId: room.roomId,
    });
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

    const legacyP2Route = await request(
      "/v1/client/workspaces/list",
      {},
      human.accessToken,
    );
    assert.equal(legacyP2Route.status, 404);
    assert.equal(await responseErrorCode(legacyP2Route), "not_found");

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
    assert.equal(rooms.rooms[0]?.roomId, room.roomId);

    const membersResponse = await request(
      "/v2/client/rooms/members/list",
      { roomId: room.roomId },
      human.accessToken,
    );
    assert.equal(membersResponse.status, 200);
    const members = await jsonObject(membersResponse);
    assert.equal(members.memberships.length, 3);

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
