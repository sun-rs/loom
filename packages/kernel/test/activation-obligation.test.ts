import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { afterEach } from "node:test";

import {
  type AuthenticatedHostContext,
  RoomKernel,
  TaskSubmissionProofError,
} from "../src/index.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { force: true, recursive: true });
  }
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-obligation-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const humanProvisioning = kernel.provisionPrincipal({
    handle: "owner",
    kind: "human",
  });
  const ownerProvisioning = kernel.provisionPrincipal({
    handle: "owner-agent",
    kind: "agent",
  });
  const secondOwnerProvisioning = kernel.provisionPrincipal({
    handle: "second-owner-agent",
    kind: "agent",
  });
  const reviewerProvisioning = kernel.provisionPrincipal({
    handle: "reviewer-agent",
    kind: "agent",
  });
  const humanActor = kernel.authenticateAccessToken(
    humanProvisioning.accessToken,
  );
  const room = kernel.createRoom(humanActor, {
    name: "Activation obligation test",
    slug: "activation-obligation-test",
  });
  for (const principal of [
    ownerProvisioning.principal,
    secondOwnerProvisioning.principal,
    reviewerProvisioning.principal,
  ]) {
    kernel.addMember(humanActor, {
      principalId: principal.principalId,
      roomId: room.roomId,
    });
  }
  return {
    databasePath,
    humanActor,
    kernel,
    owner: ownerProvisioning.principal,
    reviewer: reviewerProvisioning.principal,
    room,
    secondOwner: secondOwnerProvisioning.principal,
  };
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

function beginNextActivation(
  kernel: RoomKernel,
  host: AuthenticatedHostContext,
  participantId: string,
  label: string,
) {
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation, `${label} must have a queued Activation`);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    recoveryDescriptor: {
      driver: "fake-runtime",
      metadata: {},
      recoveryKey: `${label}-recovery`,
    },
    runAttemptId: run.runAttemptId,
    runtimeRunId: `${label}-runtime`,
  };
  kernel.prepareRunAttemptRuntime(host, runtime);
  kernel.markRunAttemptRunning(host, runtime);
  const consumerId = `${label}-consumer`;
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId,
    hostId: host.hostId,
    participantId,
    roomId: activation.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const delivery = kernel.syncWorker(execution, {});
  kernel.acknowledgeWorkerCursor(execution, {
    throughSeq: delivery.cursorAfter,
  });
  return { activation, consumerId, delivery, execution, run, runtime };
}

function finishRun(
  kernel: RoomKernel,
  host: AuthenticatedHostContext,
  running: ReturnType<typeof beginNextActivation>,
): void {
  kernel.recordRuntimeTermination(host, {
    exit: { code: 0 },
    runAttemptId: running.run.runAttemptId,
    runtimeRunId: running.runtime.runtimeRunId,
  });
  kernel.finishRunAttempt(host, {
    exitCode: 0,
    runAttemptId: running.run.runAttemptId,
    state: "exited",
  });
}

function expectUnfinishedObligation(
  kernel: RoomKernel,
  host: AuthenticatedHostContext,
  running: ReturnType<typeof beginNextActivation>,
): void {
  finishRun(kernel, host, running);
  assert.throws(
    () =>
      kernel.completeActivation(host, {
        activationId: running.activation.activationId,
        consumerId: running.consumerId,
      }),
    TaskSubmissionProofError,
  );
}

function taskState(
  kernel: RoomKernel,
  humanActor: Parameters<RoomKernel["listTasks"]>[0],
  roomId: string,
  taskId: string,
) {
  const task = kernel
    .listTasks(humanActor, { roomId })
    .find((candidate) => candidate.taskId === taskId);
  assert.ok(task);
  return task.state;
}

function latestRoomSeq(
  kernel: RoomKernel,
  humanActor: Parameters<RoomKernel["sync"]>[0],
  roomId: string,
  consumerId: string,
): number {
  return kernel.sync(humanActor, { consumerId, roomId }).latestRoomSeq;
}

function submitTaskForReview(input: {
  kernel: RoomKernel;
  ownerId: string;
  reviewerId: string;
  humanActor: Parameters<RoomKernel["createTask"]>[0];
  roomId: string;
  label: string;
}) {
  const created = input.kernel.createTask(input.humanActor, {
    assigneeId: input.ownerId,
    idempotencyKey: `${input.label}-create`,
    reviewerIds: [input.reviewerId],
    roomId: input.roomId,
    title: "Produce evidence for canonical review",
  });
  const ownerHost = authenticateHost(
    input.kernel,
    `${input.label}-owner-host`,
    input.ownerId,
  );
  const ownerRun = beginNextActivation(
    input.kernel,
    ownerHost,
    input.ownerId,
    `${input.label}-owner`,
  );
  const claimed = input.kernel.claimTask(ownerRun.execution, {
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: `${input.label}-claim`,
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const started = input.kernel.startTask(ownerRun.execution, {
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: `${input.label}-start`,
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const submitted = input.kernel.submitTask(ownerRun.execution, {
    basedOnRoomSeq: started.event.roomSeq,
    idempotencyKey: `${input.label}-submit`,
    summary: "The frozen evidence is ready for review.",
    taskId: created.task.taskId,
  });
  finishRun(input.kernel, ownerHost, ownerRun);
  assert.equal(
    input.kernel.completeActivation(ownerHost, {
      activationId: ownerRun.activation.activationId,
      consumerId: ownerRun.consumerId,
    }).state,
    "completed",
  );
  return { created, ownerHost, submitted };
}

function submitAssignedTask(input: {
  host: AuthenticatedHostContext;
  kernel: RoomKernel;
  label: string;
  participantId: string;
  taskId: string;
}) {
  const running = beginNextActivation(
    input.kernel,
    input.host,
    input.participantId,
    input.label,
  );
  const claimed = input.kernel.claimTask(running.execution, {
    basedOnRoomSeq: running.delivery.cursorAfter,
    idempotencyKey: `${input.label}-claim`,
    leaseMs: 30_000,
    taskId: input.taskId,
  });
  const started = input.kernel.startTask(running.execution, {
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: `${input.label}-start`,
    leaseMs: 30_000,
    taskId: input.taskId,
  });
  const submitted = input.kernel.submitTask(running.execution, {
    basedOnRoomSeq: started.event.roomSeq,
    idempotencyKey: `${input.label}-submit`,
    summary: `${input.label} frozen delivery`,
    taskId: input.taskId,
    verification: {
      artifactIds: [],
      status: "passed",
      summary: `${input.label} verification declared`,
    },
  });
  finishRun(input.kernel, input.host, running);
  assert.equal(
    input.kernel.completeActivation(input.host, {
      activationId: running.activation.activationId,
      consumerId: running.consumerId,
    }).state,
    "completed",
  );
  return submitted;
}

function reviewAssignedTask(input: {
  disposition: "approved" | "changes_requested";
  host: AuthenticatedHostContext;
  kernel: RoomKernel;
  label: string;
  reviewerId: string;
  taskId: string;
}) {
  const running = beginNextActivation(
    input.kernel,
    input.host,
    input.reviewerId,
    input.label,
  );
  const reviewed = input.kernel.taskReviews.reviewTask(running.execution, {
    basedOnRoomSeq: running.activation.toSeq,
    disposition: input.disposition,
    idempotencyKey: `${input.label}-review`,
    summary: `${input.label} independent review`,
    taskId: input.taskId,
  });
  finishRun(input.kernel, input.host, running);
  assert.equal(
    input.kernel.completeActivation(input.host, {
      activationId: running.activation.activationId,
      consumerId: running.consumerId,
    }).state,
    "completed",
  );
  return reviewed;
}

test("the canonical team workflow requires plan review, helper delivery, rework, Human acceptance, and dependency release", () => {
  const flow = fixture();
  const { databasePath, humanActor, owner, reviewer, room, secondOwner } = flow;
  let kernel = flow.kernel;
  const plan = kernel.createTask(humanActor, {
    assigneeId: owner.principalId,
    idempotencyKey: "team-flow-plan-create",
    reviewerIds: [reviewer.principalId],
    roomId: room.roomId,
    title: "Review the implementation plan",
  });
  const helper = kernel.createTask(humanActor, {
    assigneeId: secondOwner.principalId,
    dependencyTaskIds: [plan.task.taskId],
    idempotencyKey: "team-flow-helper-create",
    roomId: room.roomId,
    title: "Produce the required helper delivery",
  });
  const implementation = kernel.createTask(humanActor, {
    assigneeId: owner.principalId,
    dependencyTaskIds: [plan.task.taskId, helper.task.taskId],
    idempotencyKey: "team-flow-implementation-create",
    reviewerIds: [reviewer.principalId],
    roomId: room.roomId,
    title: "Implement against the approved plan and helper delivery",
  });
  const downstream = kernel.createTask(humanActor, {
    assigneeId: secondOwner.principalId,
    dependencyTaskIds: [implementation.task.taskId],
    idempotencyKey: "team-flow-downstream-create",
    roomId: room.roomId,
    title: "Start only after Human acceptance",
  });
  assert.deepEqual(helper.activationIds, []);
  assert.deepEqual(implementation.activationIds, []);
  assert.deepEqual(downstream.activationIds, []);

  const ownerHost = authenticateHost(
    kernel,
    "team-flow-owner",
    owner.principalId,
  );
  const reviewerHost = authenticateHost(
    kernel,
    "team-flow-reviewer",
    reviewer.principalId,
  );
  const helperHost = authenticateHost(
    kernel,
    "team-flow-helper",
    secondOwner.principalId,
  );

  submitAssignedTask({
    host: ownerHost,
    kernel,
    label: "team-flow-plan",
    participantId: owner.principalId,
    taskId: plan.task.taskId,
  });
  const planReview = reviewAssignedTask({
    disposition: "approved",
    host: reviewerHost,
    kernel,
    label: "team-flow-plan",
    reviewerId: reviewer.principalId,
    taskId: plan.task.taskId,
  });
  const planCompletion = kernel.completeTask(humanActor, {
    basedOnRoomSeq: latestRoomSeq(
      kernel,
      humanActor,
      room.roomId,
      "team-flow-plan-human",
    ),
    idempotencyKey: "team-flow-plan-human-complete",
    taskId: plan.task.taskId,
  });
  assert.deepEqual(planCompletion.event.payload.readyTaskIds, [
    helper.task.taskId,
  ]);

  const helperSubmission = submitAssignedTask({
    host: helperHost,
    kernel,
    label: "team-flow-helper",
    participantId: secondOwner.principalId,
    taskId: helper.task.taskId,
  });
  const helperCompletion = kernel.completeTask(humanActor, {
    basedOnRoomSeq: latestRoomSeq(
      kernel,
      humanActor,
      room.roomId,
      "team-flow-helper-human",
    ),
    idempotencyKey: "team-flow-helper-human-complete",
    taskId: helper.task.taskId,
  });
  assert.deepEqual(helperCompletion.event.payload.readyTaskIds, [
    implementation.task.taskId,
  ]);

  const firstImplementation = submitAssignedTask({
    host: ownerHost,
    kernel,
    label: "team-flow-implementation-v1",
    participantId: owner.principalId,
    taskId: implementation.task.taskId,
  });
  const rejected = reviewAssignedTask({
    disposition: "changes_requested",
    host: reviewerHost,
    kernel,
    label: "team-flow-implementation-v1",
    reviewerId: reviewer.principalId,
    taskId: implementation.task.taskId,
  });
  assert.equal(rejected.task.state, "todo");
  assert.notEqual(
    rejected.submission.submissionId,
    planReview.submission.submissionId,
  );

  kernel.close();
  kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  kernel.heartbeatHost(ownerHost);
  kernel.heartbeatHost(reviewerHost);
  kernel.heartbeatHost(helperHost);
  assert.equal(
    taskState(kernel, humanActor, room.roomId, implementation.task.taskId),
    "todo",
  );
  assert.deepEqual(
    kernel.taskReviews
      .listTaskReviews(humanActor, {
        roomId: room.roomId,
        taskId: implementation.task.taskId,
      })
      .map(({ disposition }) => disposition),
    ["changes_requested"],
  );

  const revisedImplementation = submitAssignedTask({
    host: ownerHost,
    kernel,
    label: "team-flow-implementation-v2",
    participantId: owner.principalId,
    taskId: implementation.task.taskId,
  });
  const approved = reviewAssignedTask({
    disposition: "approved",
    host: reviewerHost,
    kernel,
    label: "team-flow-implementation-v2",
    reviewerId: reviewer.principalId,
    taskId: implementation.task.taskId,
  });
  assert.notEqual(
    revisedImplementation.event.payload.submissionDigest,
    firstImplementation.event.payload.submissionDigest,
  );
  assert.equal(
    approved.review.submissionDigest,
    revisedImplementation.event.payload.submissionDigest,
  );
  assert.deepEqual(
    kernel.taskReviews
      .listTaskReviews(humanActor, {
        roomId: room.roomId,
        taskId: implementation.task.taskId,
      })
      .map(({ disposition }) => disposition),
    ["changes_requested", "approved"],
  );

  const accepted = kernel.completeTask(humanActor, {
    basedOnRoomSeq: latestRoomSeq(
      kernel,
      humanActor,
      room.roomId,
      "team-flow-implementation-human",
    ),
    idempotencyKey: "team-flow-implementation-human-complete",
    taskId: implementation.task.taskId,
  });
  assert.equal(accepted.task.state, "completed");
  assert.deepEqual(accepted.event.payload.readyTaskIds, [
    downstream.task.taskId,
  ]);
  assert.ok(
    kernel.leaseNextActivation(helperHost, { leaseMs: 30_000 }),
    "the downstream owner wakes only after canonical Human acceptance",
  );
  const evidenceScope = {
    roomId: room.roomId,
    taskId: implementation.task.taskId,
  };
  const submissionsBefore = kernel.taskReviews.listTaskSubmissions(
    humanActor,
    evidenceScope,
  );
  const reviewsBefore = kernel.taskReviews.listTaskReviews(
    humanActor,
    evidenceScope,
  );
  kernel.close();
  kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  assert.equal(
    taskState(kernel, humanActor, room.roomId, implementation.task.taskId),
    "completed",
  );
  assert.deepEqual(
    kernel.taskReviews.listTaskSubmissions(humanActor, evidenceScope),
    submissionsBefore,
  );
  assert.deepEqual(
    kernel.taskReviews.listTaskReviews(humanActor, evidenceScope),
    reviewsBefore,
  );

  kernel.close();
});

test("a reviewer cannot complete the task.submitted Activation without a canonical Review", () => {
  const { humanActor, kernel, owner, reviewer, room } = fixture();
  const { created } = submitTaskForReview({
    humanActor,
    kernel,
    label: "silent-reviewer",
    ownerId: owner.principalId,
    reviewerId: reviewer.principalId,
    roomId: room.roomId,
  });
  const reviewerHost = authenticateHost(
    kernel,
    "silent-reviewer-host",
    reviewer.principalId,
  );
  const reviewerRun = beginNextActivation(
    kernel,
    reviewerHost,
    reviewer.principalId,
    "silent-reviewer",
  );
  assert.equal(reviewerRun.delivery.events.at(-1)?.type, "task.submitted");

  expectUnfinishedObligation(kernel, reviewerHost, reviewerRun);
  assert.equal(
    taskState(kernel, humanActor, room.roomId, created.task.taskId),
    "submitted",
  );
  assert.equal(
    kernel.taskReviews.listTaskReviews(humanActor, {
      roomId: room.roomId,
      taskId: created.task.taskId,
    }).length,
    0,
  );
  kernel.close();
});

test("an assigned owner cannot complete a task.reopened Activation without a Task outcome", () => {
  const { humanActor, kernel, owner, room } = fixture();
  const created = kernel.createTask(humanActor, {
    assigneeId: owner.principalId,
    idempotencyKey: "silent-reopen-create",
    roomId: room.roomId,
    title: "Resume this cancelled Task",
  });
  const cancelled = kernel.cancelTask(humanActor, {
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: "silent-reopen-cancel",
    reason: "Exercise reversible cancellation",
    taskId: created.task.taskId,
  });
  const host = authenticateHost(
    kernel,
    "silent-reopen-host",
    owner.principalId,
  );
  const cancelledRun = beginNextActivation(
    kernel,
    host,
    owner.principalId,
    "silent-reopen-cancelled",
  );
  finishRun(kernel, host, cancelledRun);
  assert.equal(
    kernel.completeActivation(host, {
      activationId: cancelledRun.activation.activationId,
      consumerId: cancelledRun.consumerId,
    }).state,
    "completed",
  );
  const reopened = kernel.reopenTask(humanActor, {
    basedOnRoomSeq: kernel.sync(humanActor, {
      consumerId: "silent-reopen-human",
      roomId: room.roomId,
    }).latestRoomSeq,
    idempotencyKey: "silent-reopen-reopen",
    taskId: created.task.taskId,
  });
  assert.equal(reopened.task.state, "todo");
  const reopenedRun = beginNextActivation(
    kernel,
    host,
    owner.principalId,
    "silent-reopen-owner",
  );
  assert.equal(
    reopenedRun.delivery.events.some(({ type }) => type === "task.reopened"),
    true,
  );

  expectUnfinishedObligation(kernel, host, reopenedRun);
  assert.equal(
    taskState(kernel, humanActor, room.roomId, created.task.taskId),
    "todo",
  );
  kernel.close();
});

test("a new owner cannot complete a task.reassigned Activation without a Task outcome", () => {
  const { humanActor, kernel, owner, room, secondOwner } = fixture();
  const created = kernel.createTask(humanActor, {
    assigneeId: owner.principalId,
    idempotencyKey: "silent-reassign-create",
    roomId: room.roomId,
    title: "Safely move this Task to another Agent",
  });
  const oldHost = authenticateHost(
    kernel,
    "silent-reassign-old",
    owner.principalId,
  );
  const oldRun = beginNextActivation(
    kernel,
    oldHost,
    owner.principalId,
    "silent-reassign-old",
  );
  const claimed = kernel.claimTask(oldRun.execution, {
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: "silent-reassign-claim",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const started = kernel.startTask(oldRun.execution, {
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: "silent-reassign-start",
    leaseMs: 30_000,
    taskId: created.task.taskId,
  });
  const requested = kernel.taskReassignment.request(humanActor, {
    assigneeId: secondOwner.principalId,
    basedOnRoomSeq: started.event.roomSeq,
    idempotencyKey: "silent-reassign-request",
    reason: "The new owner must prove its follow-up work",
    taskId: created.task.taskId,
  });
  kernel.recordRuntimeTermination(oldHost, {
    exit: { code: null, signal: "SIGTERM" },
    runAttemptId: oldRun.run.runAttemptId,
    runtimeRunId: oldRun.runtime.runtimeRunId,
  });
  kernel.finishRunAttempt(oldHost, {
    error: "Task reassignment requested",
    exitSignal: "SIGTERM",
    runAttemptId: oldRun.run.runAttemptId,
    state: "cancelled",
  });
  kernel.resolveActivationCancellation(oldHost, {
    activationId: oldRun.activation.activationId,
  });
  const reassigned = kernel.taskReassignment.continue(humanActor, {
    operationId: requested.operation.operationId,
  });
  assert.equal(reassigned.event.type, "task.reassigned");
  const newHost = authenticateHost(
    kernel,
    "silent-reassign-new",
    secondOwner.principalId,
  );
  const newRun = beginNextActivation(
    kernel,
    newHost,
    secondOwner.principalId,
    "silent-reassign-new",
  );
  assert.equal(
    newRun.delivery.events.some(({ type }) => type === "task.reassigned"),
    true,
  );

  expectUnfinishedObligation(kernel, newHost, newRun);
  assert.equal(
    taskState(kernel, humanActor, room.roomId, created.task.taskId),
    "todo",
  );
  kernel.close();
});

test("an owner cannot complete changes_requested without a revised Task outcome", () => {
  const { humanActor, kernel, owner, reviewer, room } = fixture();
  const { created, ownerHost } = submitTaskForReview({
    humanActor,
    kernel,
    label: "silent-rework",
    ownerId: owner.principalId,
    reviewerId: reviewer.principalId,
    roomId: room.roomId,
  });
  const reviewerHost = authenticateHost(
    kernel,
    "silent-rework-reviewer-host",
    reviewer.principalId,
  );
  const reviewerRun = beginNextActivation(
    kernel,
    reviewerHost,
    reviewer.principalId,
    "silent-rework-reviewer",
  );
  const reviewed = kernel.taskReviews.reviewTask(reviewerRun.execution, {
    basedOnRoomSeq: reviewerRun.activation.toSeq,
    disposition: "changes_requested",
    idempotencyKey: "silent-rework-review",
    summary: "The owner must produce a revised submission.",
    taskId: created.task.taskId,
  });
  finishRun(kernel, reviewerHost, reviewerRun);
  assert.equal(
    kernel.completeActivation(reviewerHost, {
      activationId: reviewerRun.activation.activationId,
      consumerId: reviewerRun.consumerId,
    }).state,
    "completed",
  );
  assert.equal(reviewed.task.state, "todo");
  const ownerRun = beginNextActivation(
    kernel,
    ownerHost,
    owner.principalId,
    "silent-rework-owner",
  );
  assert.equal(
    ownerRun.delivery.events.some(
      ({ payload, type }) =>
        type === "review.submitted" &&
        payload.disposition === "changes_requested",
    ),
    true,
  );

  expectUnfinishedObligation(kernel, ownerHost, ownerRun);
  assert.equal(
    taskState(kernel, humanActor, room.roomId, created.task.taskId),
    "todo",
  );
  kernel.close();
});

test("schema v30 backfills business obligations for an already active reviewer Activation", () => {
  const { humanActor, kernel, owner, reviewer, room } = fixture();
  const { created } = submitTaskForReview({
    humanActor,
    kernel,
    label: "legacy-reviewer",
    ownerId: owner.principalId,
    reviewerId: reviewer.principalId,
    roomId: room.roomId,
  });
  const reviewerHost = authenticateHost(
    kernel,
    "legacy-reviewer-host",
    reviewer.principalId,
  );
  const reviewerRun = beginNextActivation(
    kernel,
    reviewerHost,
    reviewer.principalId,
    "legacy-reviewer",
  );
  finishRun(kernel, reviewerHost, reviewerRun);
  const databasePath = kernel.databasePath;
  kernel.close();

  const legacyDatabase = new DatabaseSync(databasePath);
  legacyDatabase.exec(
    "DELETE FROM activation_obligations; PRAGMA user_version = 29;",
  );
  legacyDatabase.close();

  const migrated = new RoomKernel({ databasePath });
  migrated.initialize();
  assert.throws(
    () =>
      migrated.completeActivation(reviewerHost, {
        activationId: reviewerRun.activation.activationId,
        consumerId: reviewerRun.consumerId,
      }),
    TaskSubmissionProofError,
  );
  assert.equal(
    taskState(migrated, humanActor, room.roomId, created.task.taskId),
    "submitted",
  );
  migrated.close();
});

test("D1-A: a Task the Agent claims from the head message during its own Activation adds no obligation to that Activation", () => {
  const { humanActor, kernel, owner, room } = fixture();
  const posted = kernel.postRoomMessage(humanActor, {
    body: "Review the retry path read-only and summarize in the channel",
    idempotencyKey: "self-claim-head",
    recipients: [{ participantId: owner.principalId, reason: "mention" }],
    roomId: room.roomId,
  });
  const ownerHost = authenticateHost(
    kernel,
    "self-claim-owner-host",
    owner.principalId,
  );
  const running = beginNextActivation(
    kernel,
    ownerHost,
    owner.principalId,
    "self-claim",
  );
  assert.equal(running.activation.toSeq, posted.event.roomSeq);
  const claimed = kernel.claimMessageAsTask(running.execution, {
    basedOnRoomSeq: posted.event.roomSeq,
    idempotencyKey: "self-claim-claim",
    leaseMs: 30_000,
    messageId: posted.event.aggregateId,
    rationale: "multi-step review",
  });
  assert.ok(claimed.event.roomSeq > running.activation.toSeq);
  const started = kernel.startTask(running.execution, {
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: "self-claim-start",
    leaseMs: 30_000,
    taskId: claimed.task.taskId,
  });
  kernel.progressTask(running.execution, {
    basedOnRoomSeq: started.event.roomSeq,
    idempotencyKey: "self-claim-progress",
    leaseMs: 30_000,
    progress: "read the files",
    taskId: claimed.task.taskId,
  });
  kernel.postWorkerMessage(running.execution, {
    body: "summary",
    final: true,
  });
  finishRun(kernel, ownerHost, running);
  assert.equal(
    kernel.completeActivation(ownerHost, {
      activationId: running.activation.activationId,
      consumerId: running.consumerId,
    }).state,
    "completed",
  );
  assert.equal(
    taskState(kernel, humanActor, room.roomId, claimed.task.taskId),
    "in_progress",
  );
  kernel.close();
});
