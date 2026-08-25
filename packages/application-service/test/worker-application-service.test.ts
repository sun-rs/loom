import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  type AuthenticatedHostContext,
  RoomKernel,
  RuntimeTerminationProofError,
} from "@rah-os/kernel";

import { WorkerApplicationService } from "../src/index.ts";

async function jsonObject(
  response: Response,
): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}

async function responseErrorCode(response: Response): Promise<unknown> {
  const body = await jsonObject(response);
  assert.ok(
    typeof body.error === "object" &&
      body.error !== null &&
      !Array.isArray(body.error),
  );
  return (body.error as Record<string, unknown>).code;
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

test("Worker API only acknowledges cursors delivered to its scoped credential", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-worker-api-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const service = new WorkerApplicationService({ kernel });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "worker-api-human",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "worker-api-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(humanActor, {
      name: "Worker API",
      slug: "worker-api",
    });
    kernel.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(humanActor, {
      body: "Scoped delivery",
      idempotencyKey: "worker-api-message",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      roomId: room.roomId,
    });
    const host = authenticateHost(
      kernel,
      "worker-api-host",
      agent.principal.principalId,
    );
    const activation = kernel.leaseNextActivation(host, {
      leaseMs: 30_000,
    });
    assert.ok(activation);
    const runAttempt = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    prepareAndMarkRunAttemptRunning(kernel, host, {
      recoveryDescriptor: fakeRecovery("worker-api-runtime"),
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId: "worker-api-runtime",
    });
    await service.start();
    const credential = service.issueActivationCredential(host, {
      activationId: activation.activationId,
      consumerId: "worker-api-consumer",
      hostId: "worker-api-host",
      participantId: agent.principal.principalId,
      roomId: room.roomId,
      runAttemptId: runAttempt.runAttemptId,
      toSeq: activation.toSeq,
    });
    const futureMessage = kernel.postMessage(humanActor, {
      body: "This belongs to a later Activation range",
      idempotencyKey: "worker-api-future-message",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      roomId: room.roomId,
    });
    const request = async (
      path: string,
      body: Record<string, unknown>,
      accessToken = credential.accessToken,
    ) =>
      await fetch(`${service.origin}${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      });

    const inventedAcknowledgement = await request("/v1/worker/acknowledge", {
      throughSeq: activation.toSeq,
    });
    assert.equal(inventedAcknowledgement.status, 409);
    assert.equal(
      await responseErrorCode(inventedAcknowledgement),
      "cursor_not_delivered",
    );

    const inventedContinuation = await request("/v1/worker/sync", {
      afterSeq: activation.toSeq,
    });
    assert.equal(inventedContinuation.status, 409);
    assert.equal(
      await responseErrorCode(inventedContinuation),
      "invalid_continuation",
    );

    const injectedScope = await request("/v1/worker/sync", {
      roomId: "attacker-selected-room",
    });
    assert.equal(injectedScope.status, 400);
    assert.equal(await responseErrorCode(injectedScope), "unexpected_field");

    const deliveryResponse = await request("/v1/worker/sync", {});
    assert.equal(deliveryResponse.status, 200);
    const delivery = await jsonObject(deliveryResponse);
    assert.equal(typeof delivery.cursorAfter, "number");
    const cursorAfter = delivery.cursorAfter as number;
    assert.equal(cursorAfter, activation.toSeq);
    assert.ok(Array.isArray(delivery.events));
    assert.equal(
      delivery.events.some(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "eventId" in event &&
          event.eventId === futureMessage.event.eventId,
      ),
      false,
    );

    const acceptedAcknowledgement = await request("/v1/worker/acknowledge", {
      throughSeq: cursorAfter,
    });
    assert.equal(acceptedAcknowledgement.status, 200);
    assert.throws(
      () =>
        kernel.completeActivation(host, {
          activationId: activation.activationId,
          consumerId: "worker-api-consumer",
        }),
      RuntimeTerminationProofError,
    );
    kernel.recordRuntimeTermination(host, {
      exit: { code: 0 },
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId: "worker-api-runtime",
    });
    const fencedAfterTermination = await request("/v1/worker/sync", {});
    assert.equal(fencedAfterTermination.status, 409);
    assert.equal(
      await responseErrorCode(fencedAfterTermination),
      "execution_fenced",
    );
    kernel.finishRunAttempt(host, {
      exitCode: 0,
      runAttemptId: runAttempt.runAttemptId,
      state: "exited",
    });
    kernel.completeActivation(host, {
      activationId: activation.activationId,
      consumerId: "worker-api-consumer",
    });

    const followUpActivation = kernel.leaseNextActivation(host, {
      leaseMs: 30_000,
    });
    assert.ok(followUpActivation);
    const followUpRunAttempt = kernel.createRunAttempt(host, {
      activationId: followUpActivation.activationId,
    });
    prepareAndMarkRunAttemptRunning(kernel, host, {
      recoveryDescriptor: fakeRecovery("worker-api-follow-up-runtime"),
      runAttemptId: followUpRunAttempt.runAttemptId,
      runtimeRunId: "worker-api-follow-up-runtime",
    });
    const followUpCredential = service.issueActivationCredential(host, {
      activationId: followUpActivation.activationId,
      consumerId: "worker-api-consumer",
      hostId: "worker-api-host",
      participantId: agent.principal.principalId,
      roomId: room.roomId,
      runAttemptId: followUpRunAttempt.runAttemptId,
      toSeq: followUpActivation.toSeq,
    });
    const followUpResponse = await request(
      "/v1/worker/sync",
      {},
      followUpCredential.accessToken,
    );
    assert.equal(followUpResponse.status, 200);
    const followUpDelivery = await jsonObject(followUpResponse);
    assert.ok(Array.isArray(followUpDelivery.events));
    assert.equal(
      followUpDelivery.events.some(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "eventId" in event &&
          event.eventId === futureMessage.event.eventId,
      ),
      true,
    );
    followUpCredential.revoke();
  } finally {
    await service.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Worker API exposes a causal and execution-fenced Task command surface", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-worker-task-api-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const service = new WorkerApplicationService({
    kernel,
    taskClaimHeartbeatIntervalMs: 50,
    taskClaimLeaseMs: 250,
  });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "worker-task-human",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "worker-task-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(humanActor, {
      name: "Worker Task API",
      slug: "worker-task-api",
    });
    kernel.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    const created = kernel.createTask(humanActor, {
      assigneeId: agent.principal.principalId,
      idempotencyKey: "worker-task-created",
      roomId: room.roomId,
      title: "Complete the Worker Task protocol",
    });
    const host = authenticateHost(
      kernel,
      "worker-task-host",
      agent.principal.principalId,
    );
    const activation = kernel.leaseNextActivation(host, {
      leaseMs: 30_000,
    });
    assert.ok(activation);
    const runAttempt = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    prepareAndMarkRunAttemptRunning(kernel, host, {
      recoveryDescriptor: fakeRecovery("worker-task-runtime"),
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId: "worker-task-runtime",
    });
    await service.start();
    const credential = service.issueActivationCredential(host, {
      activationId: activation.activationId,
      consumerId: "worker-task-consumer",
      hostId: host.hostId,
      participantId: agent.principal.principalId,
      roomId: room.roomId,
      runAttemptId: runAttempt.runAttemptId,
      toSeq: activation.toSeq,
    });
    const request = async (path: string, body: Record<string, unknown>) =>
      await fetch(`${service.origin}${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      });

    const prematureClaim = await request("/v1/worker/tasks/claim", {
      basedOnRoomSeq: created.event.roomSeq,
      idempotencyKey: "worker-task-claim-premature",
      taskId: created.task.taskId,
    });
    assert.equal(prematureClaim.status, 409);
    assert.equal(
      await responseErrorCode(prematureClaim),
      "causal_cursor_not_delivered",
    );

    const deliveryResponse = await request("/v1/worker/sync", {});
    assert.equal(deliveryResponse.status, 200);
    const delivery = await jsonObject(deliveryResponse);
    assert.equal(delivery.cursorAfter, created.event.roomSeq);
    const basedOnRoomSeq = delivery.cursorAfter as number;

    const taskQueryResponse = await request("/v1/worker/tasks/get", {
      taskId: created.task.taskId,
    });
    assert.equal(taskQueryResponse.status, 200);
    const taskQuery = await jsonObject(taskQueryResponse);
    assert.equal((taskQuery.task as Record<string, unknown>).state, "todo");
    const injectedTaskQuery = await request("/v1/worker/tasks/get", {
      roomId: "attacker-room",
      taskId: created.task.taskId,
    });
    assert.equal(injectedTaskQuery.status, 400);
    assert.equal(
      await responseErrorCode(injectedTaskQuery),
      "unexpected_field",
    );

    const injectedScope = await request("/v1/worker/tasks/claim", {
      basedOnRoomSeq,
      idempotencyKey: "worker-task-injected",
      roomId: "attacker-room",
      taskId: created.task.taskId,
    });
    assert.equal(injectedScope.status, 400);
    assert.equal(await responseErrorCode(injectedScope), "unexpected_field");

    const claimResponse = await request("/v1/worker/tasks/claim", {
      basedOnRoomSeq,
      idempotencyKey: "worker-task-claim",
      taskId: created.task.taskId,
    });
    assert.equal(claimResponse.status, 200);
    const claim = await jsonObject(claimResponse);
    assert.equal((claim.task as Record<string, unknown>).state, "claimed");
    assert.equal((claim.event as Record<string, unknown>).type, "task.claimed");

    await new Promise((resolve) => setTimeout(resolve, 350));

    const startResponse = await request("/v1/worker/tasks/start", {
      basedOnRoomSeq: (claim.event as Record<string, unknown>).roomSeq,
      idempotencyKey: "worker-task-start",
      taskId: created.task.taskId,
    });
    assert.equal(startResponse.status, 200);
    const started = await jsonObject(startResponse);

    const progressCommand = {
      basedOnRoomSeq: (started.event as Record<string, unknown>).roomSeq,
      idempotencyKey: "worker-task-progress",
      progress: "HTTP Task commands are covered",
      taskId: created.task.taskId,
    };
    const progressResponse = await request(
      "/v1/worker/tasks/progress",
      progressCommand,
    );
    assert.equal(progressResponse.status, 200);
    const progressed = await jsonObject(progressResponse);
    const repeatedProgress = await request(
      "/v1/worker/tasks/progress",
      progressCommand,
    );
    assert.equal(repeatedProgress.status, 200);
    assert.equal((await jsonObject(repeatedProgress)).deduplicated, true);

    const submitResponse = await request("/v1/worker/tasks/submit", {
      basedOnRoomSeq: (progressed.event as Record<string, unknown>).roomSeq,
      idempotencyKey: "worker-task-submit",
      summary: "Task protocol implemented and tested",
      taskId: created.task.taskId,
    });
    assert.equal(submitResponse.status, 200);
    const submitted = await jsonObject(submitResponse);
    assert.equal(
      (submitted.task as Record<string, unknown>).state,
      "submitted",
    );

    const acknowledgement = await request("/v1/worker/acknowledge", {
      throughSeq: basedOnRoomSeq,
    });
    assert.equal(acknowledgement.status, 200);
    assert.equal(
      kernel.listTasks(humanActor, { roomId: room.roomId })[0]?.state,
      "submitted",
    );
  } finally {
    await service.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Worker API atomically requests human input and releases its Task claim", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-worker-input-api-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const service = new WorkerApplicationService({
    kernel,
    taskClaimHeartbeatIntervalMs: 25,
    taskClaimLeaseMs: 150,
  });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "worker-input-human",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "worker-input-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(humanActor, {
      name: "Worker Input API",
      slug: "worker-input-api",
    });
    kernel.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    const created = kernel.createTask(humanActor, {
      assigneeId: agent.principal.principalId,
      idempotencyKey: "worker-input-created",
      roomId: room.roomId,
      title: "Ask without polling",
    });
    const host = authenticateHost(
      kernel,
      "worker-input-host",
      agent.principal.principalId,
    );
    const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
    assert.ok(activation);
    const runAttempt = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    prepareAndMarkRunAttemptRunning(kernel, host, {
      recoveryDescriptor: fakeRecovery("worker-input-runtime"),
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId: "worker-input-runtime",
    });
    await service.start();
    const credential = service.issueActivationCredential(host, {
      activationId: activation.activationId,
      consumerId: "worker-input-consumer",
      hostId: host.hostId,
      participantId: agent.principal.principalId,
      roomId: room.roomId,
      runAttemptId: runAttempt.runAttemptId,
      toSeq: activation.toSeq,
    });
    const request = async (path: string, body: Record<string, unknown>) =>
      await fetch(`${service.origin}${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      });

    const delivery = await jsonObject(await request("/v1/worker/sync", {}));
    const claimed = await jsonObject(
      await request("/v1/worker/tasks/claim", {
        basedOnRoomSeq: delivery.cursorAfter,
        idempotencyKey: "worker-input-claim",
        taskId: created.task.taskId,
      }),
    );
    const started = await jsonObject(
      await request("/v1/worker/tasks/start", {
        basedOnRoomSeq: (claimed.event as Record<string, unknown>).roomSeq,
        idempotencyKey: "worker-input-start",
        taskId: created.task.taskId,
      }),
    );
    const noInputStatus = await request("/v1/worker/tasks/input-status", {
      taskId: created.task.taskId,
    });
    assert.equal(noInputStatus.status, 200);
    assert.equal((await jsonObject(noInputStatus)).inputRequest, null);
    const command = {
      basedOnRoomSeq: (started.event as Record<string, unknown>).roomSeq,
      idempotencyKey: "worker-input-request",
      question: "Should this phase expose a LAN listener?",
      taskId: created.task.taskId,
    };
    const injected = await request("/v1/worker/tasks/request-input", {
      ...command,
      responderId: "attacker-selected-responder",
    });
    assert.equal(injected.status, 400);
    assert.equal(await responseErrorCode(injected), "unexpected_field");

    const response = await request("/v1/worker/tasks/request-input", command);
    assert.equal(response.status, 200);
    const requested = await jsonObject(response);
    assert.equal(
      (requested.task as Record<string, unknown>).state,
      "waiting_input",
    );
    assert.equal(
      "claimedBy" in (requested.task as Record<string, unknown>),
      false,
    );
    assert.equal(
      (requested.inputRequest as Record<string, unknown>).state,
      "pending",
    );
    assert.equal(
      (requested.inputRequest as Record<string, unknown>).responderId,
      human.principal.principalId,
    );
    assert.equal(
      (requested.event as Record<string, unknown>).type,
      "input.requested",
    );
    const statusResponse = await request("/v1/worker/tasks/input-status", {
      taskId: created.task.taskId,
    });
    assert.equal(statusResponse.status, 200);
    const status = (await jsonObject(statusResponse)).inputRequest as Record<
      string,
      unknown
    >;
    assert.deepEqual(Object.keys(status).sort(), [
      "inputRequestId",
      "state",
      "taskId",
    ]);
    assert.equal(status.state, "pending");
    const injectedStatus = await request("/v1/worker/tasks/input-status", {
      roomId: "attacker-room",
      taskId: created.task.taskId,
    });
    assert.equal(injectedStatus.status, 400);
    assert.equal(await responseErrorCode(injectedStatus), "unexpected_field");
    const replayed = await request("/v1/worker/tasks/request-input", command);
    assert.equal(replayed.status, 200);
    assert.equal((await jsonObject(replayed)).deduplicated, true);

    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(
      kernel.listTasks(humanActor, { roomId: room.roomId })[0]?.state,
      "waiting_input",
    );
  } finally {
    await service.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Worker API rejects an expired activation credential", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-worker-expiry-"));
  let nowMs = Date.parse("2026-08-25T00:00:00.000Z");
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const service = new WorkerApplicationService({
    kernel,
    now: () => new Date(nowMs),
  });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "expiring-worker-human",
      kind: "human",
    });
    const principal = kernel.provisionPrincipal({
      handle: "expiring-worker",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(humanActor, {
      name: "Expiring worker",
      slug: "expiring-worker",
    });
    kernel.addMember(humanActor, {
      principalId: principal.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(humanActor, {
      body: "Expire this scoped credential",
      idempotencyKey: "expiring-worker-message",
      recipients: [
        {
          participantId: principal.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: room.roomId,
    });
    const host = authenticateHost(
      kernel,
      "expiry-host",
      principal.principal.principalId,
    );
    const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
    assert.ok(activation);
    const runAttempt = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    prepareAndMarkRunAttemptRunning(kernel, host, {
      recoveryDescriptor: fakeRecovery("expiry-runtime"),
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId: "expiry-runtime",
    });
    await service.start();
    const credential = service.issueActivationCredential(
      host,
      {
        activationId: activation.activationId,
        consumerId: "expiry-consumer",
        hostId: "expiry-host",
        participantId: principal.principal.principalId,
        roomId: room.roomId,
        runAttemptId: runAttempt.runAttemptId,
        toSeq: activation.toSeq,
      },
      { ttlMs: 10 },
    );
    nowMs += 10;

    const response = await fetch(`${service.origin}/v1/worker/sync`, {
      body: "{}",
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });

    assert.equal(response.status, 401);
    assert.equal(await responseErrorCode(response), "unauthenticated");
  } finally {
    await service.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("only the current scoped Host can mint and retain a Worker execution grant", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-worker-host-scope-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const service = new WorkerApplicationService({ kernel });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "worker-host-scope-human",
      kind: "human",
    });
    const assignedAgent = kernel.provisionPrincipal({
      handle: "worker-host-scope-assigned",
      kind: "agent",
    });
    const otherAgent = kernel.provisionPrincipal({
      handle: "worker-host-scope-other",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(humanActor, {
      name: "Worker Host scope",
      slug: "worker-host-scope",
    });
    kernel.addMember(humanActor, {
      principalId: assignedAgent.principal.principalId,
      roomId: room.roomId,
    });
    kernel.addMember(humanActor, {
      principalId: otherAgent.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(humanActor, {
      body: "Only the assigned Host may execute this range",
      idempotencyKey: "worker-host-scope-message",
      recipients: [
        {
          participantId: assignedAgent.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: room.roomId,
    });
    const assignedProvisioning = kernel.provisionHostCredential({
      hostId: "worker-host-scope-assigned-host",
      participantIds: [assignedAgent.principal.principalId],
    });
    const assignedHost = kernel.authenticateHostAccessToken(
      assignedProvisioning.accessToken,
    );
    kernel.heartbeatHost(assignedHost);
    const otherHost = authenticateHost(
      kernel,
      "worker-host-scope-other-host",
      otherAgent.principal.principalId,
    );
    const activation = kernel.leaseNextActivation(assignedHost, {
      leaseMs: 30_000,
    });
    assert.ok(activation);
    const runAttempt = kernel.createRunAttempt(assignedHost, {
      activationId: activation.activationId,
    });
    const scope = {
      activationId: activation.activationId,
      consumerId: "worker-host-scope-consumer",
      hostId: assignedHost.hostId,
      participantId: assignedAgent.principal.principalId,
      roomId: room.roomId,
      runAttemptId: runAttempt.runAttemptId,
      toSeq: activation.toSeq,
    };
    await service.start();

    assert.throws(() => service.issueActivationCredential(otherHost, scope));
    assert.throws(() =>
      service.issueActivationCredential(assignedHost, {
        ...scope,
        toSeq: scope.toSeq + 1,
      }),
    );

    const credential = service.issueActivationCredential(assignedHost, scope);
    prepareAndMarkRunAttemptRunning(kernel, assignedHost, {
      recoveryDescriptor: fakeRecovery("worker-host-scope-runtime"),
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId: "worker-host-scope-runtime",
    });
    kernel.revokeHostCredential(assignedProvisioning.credentialId);
    const response = await fetch(`${service.origin}/v1/worker/sync`, {
      body: "{}",
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    assert.equal(response.status, 401);
    assert.equal(await responseErrorCode(response), "unauthenticated");
  } finally {
    await service.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Worker API fences a credential when its Activation lease expires", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-worker-fencing-"));
  let nowMs = Date.parse("2026-08-25T00:00:00.000Z");
  const now = () => new Date(nowMs);
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now,
  });
  const service = new WorkerApplicationService({ kernel, now });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "worker-fencing-human",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "worker-fencing-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(humanActor, {
      name: "Worker fencing",
      slug: "worker-fencing",
    });
    kernel.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(humanActor, {
      body: "Fence this execution after lease expiry",
      idempotencyKey: "worker-fencing-message",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      roomId: room.roomId,
    });
    const host = authenticateHost(
      kernel,
      "worker-fencing-host",
      agent.principal.principalId,
    );
    const activation = kernel.leaseNextActivation(host, {
      leaseMs: 1_000,
    });
    assert.ok(activation);
    const runAttempt = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    prepareAndMarkRunAttemptRunning(kernel, host, {
      recoveryDescriptor: fakeRecovery("worker-fencing-runtime"),
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId: "worker-fencing-runtime",
    });
    await service.start();
    const credential = service.issueActivationCredential(host, {
      activationId: activation.activationId,
      consumerId: "worker-fencing-consumer",
      hostId: "worker-fencing-host",
      participantId: agent.principal.principalId,
      roomId: room.roomId,
      runAttemptId: runAttempt.runAttemptId,
      toSeq: activation.toSeq,
    });
    const request = async () =>
      await fetch(`${service.origin}/v1/worker/sync`, {
        body: "{}",
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      });

    assert.equal((await request()).status, 200);
    nowMs += 1_001;
    const fenced = await request();
    assert.equal(fenced.status, 409);
    assert.equal(await responseErrorCode(fenced), "execution_fenced");
  } finally {
    await service.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Worker API safely continues an Activation range across sync pages", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-worker-pages-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const service = new WorkerApplicationService({ kernel });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "worker-pages-human",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "worker-pages-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(humanActor, {
      name: "Worker pagination",
      slug: "worker-pagination",
    });
    kernel.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    for (let index = 0; index < 501; index += 1) {
      kernel.postMessage(humanActor, {
        body: `Pagination event ${String(index)}`,
        idempotencyKey: `worker-page-message-${String(index)}`,
        recipients: [
          { participantId: agent.principal.principalId, reason: "mention" },
        ],
        roomId: room.roomId,
      });
    }
    const host = authenticateHost(
      kernel,
      "worker-pages-host",
      agent.principal.principalId,
    );
    const activation = kernel.leaseNextActivation(host, {
      leaseMs: 30_000,
    });
    assert.ok(activation);
    const runAttempt = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    prepareAndMarkRunAttemptRunning(kernel, host, {
      recoveryDescriptor: fakeRecovery("worker-pages-runtime"),
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId: "worker-pages-runtime",
    });
    await service.start();
    const credential = service.issueActivationCredential(host, {
      activationId: activation.activationId,
      consumerId: "worker-pages-consumer",
      hostId: "worker-pages-host",
      participantId: agent.principal.principalId,
      roomId: room.roomId,
      runAttemptId: runAttempt.runAttemptId,
      toSeq: activation.toSeq,
    });
    const request = async (path: string, body: Record<string, unknown>) =>
      await fetch(`${service.origin}${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      });

    const firstResponse = await request("/v1/worker/sync", {});
    assert.equal(firstResponse.status, 200);
    const firstPage = await jsonObject(firstResponse);
    assert.ok(Array.isArray(firstPage.events));
    assert.equal(firstPage.events.length, 500);
    assert.equal(typeof firstPage.cursorAfter, "number");
    assert.ok((firstPage.cursorAfter as number) < activation.toSeq);

    const secondResponse = await request("/v1/worker/sync", {
      afterSeq: firstPage.cursorAfter,
    });
    assert.equal(secondResponse.status, 200);
    const secondPage = await jsonObject(secondResponse);
    assert.ok(Array.isArray(secondPage.events));
    assert.ok(secondPage.events.length > 0);
    assert.equal(secondPage.cursorAfter, activation.toSeq);

    const acknowledgement = await request("/v1/worker/acknowledge", {
      throughSeq: secondPage.cursorAfter,
    });
    assert.equal(acknowledgement.status, 200);
    kernel.recordRuntimeTermination(host, {
      exit: { code: 0 },
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId: "worker-pages-runtime",
    });
    kernel.finishRunAttempt(host, {
      exitCode: 0,
      runAttemptId: runAttempt.runAttemptId,
      state: "exited",
    });
    kernel.completeActivation(host, {
      activationId: activation.activationId,
      consumerId: "worker-pages-consumer",
    });
    assert.equal(
      kernel.listActivations({ roomId: room.roomId })[0]?.state,
      "completed",
    );
  } finally {
    await service.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

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
