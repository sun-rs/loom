import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { RoomKernel } from "@rah-os/kernel";

import { WorkerApplicationService } from "../src/index.ts";

/**
 * Raft has neither `--based-on-room-seq` nor `--idempotency-key` on any Task
 * command. These tests drive the whole Task family in that minimal form.
 */
async function fixture(options: { reviewerSeat?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "rah-minimal-task-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const database = new DatabaseSync(databasePath);
  const human = kernel.provisionPrincipal({ kind: "human", handle: "human" });
  const agent = kernel.provisionPrincipal({ kind: "agent", handle: "agent" });
  const helper = kernel.provisionPrincipal({ kind: "agent", handle: "helper" });
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Minimal", slug: "minimal" });
  for (const principalId of [
    agent.principal.principalId,
    helper.principal.principalId,
  ])
    kernel.addMember(actor, { roomId: room.roomId, principalId });
  const source = kernel.postMessage(actor, {
    roomId: room.roomId,
    body: "Please carry this durable work",
    idempotencyKey: "source",
    recipients: [
      { participantId: agent.principal.principalId, reason: "mention" },
    ],
  });
  // A Task with a legacy reviewer seat, so a submission wakes the reviewer.
  const reviewedTask =
    options.reviewerSeat !== true
      ? undefined
      : kernel.createTask(actor, {
          roomId: room.roomId,
          title: "Reviewed work",
          assigneeId: agent.principal.principalId,
          collaboratorIds: [],
          reviewerIds: [helper.principal.principalId],
          dependencyTaskIds: [],
          idempotencyKey: "reviewed-task",
        });

  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "host",
      participantIds: [agent.principal.principalId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 600_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    runAttemptId: run.runAttemptId,
    runtimeRunId: "fake",
    recoveryDescriptor: { driver: "fake", recoveryKey: "fake", metadata: {} },
  };
  kernel.prepareRunAttemptRuntime(host, runtime);
  kernel.markRunAttemptRunning(host, runtime);
  const service = new WorkerApplicationService({ kernel });
  await service.start();
  const head = () =>
    Number(
      database
        .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
        .get(room.roomId)!.n,
    );
  // A leased Activation's head grows as new events land (room-event-writer
  // extends to_seq), and a credential must be issued for exactly that head.
  const activationHead = () =>
    Number(
      database
        .prepare("SELECT to_seq AS n FROM activations WHERE activation_id=?")
        .get(activation.activationId)!.n,
    );
  const credentialFor = (consumerId: string, toSeq = activationHead()) =>
    service.issueActivationCredential(host, {
      activationId: activation.activationId,
      consumerId,
      hostId: host.hostId,
      participantId: agent.principal.principalId,
      roomId: room.roomId,
      runAttemptId: run.runAttemptId,
      toSeq,
    });
  const credential = credentialFor("worker", activation.toSeq);
  const callWith =
    (token: string) =>
    async (path: string, body: unknown = {}) => {
      const response = await fetch(`${service.origin}/v1/worker/${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        body: (await response.json()) as Record<string, any>,
      };
    };
  const call = callWith(credential.accessToken);
  const firstSync = await call("sync");
  assert.equal(firstSync.status, 200);
  const deliveredCursor = firstSync.body.cursorAfter as number;
  const session = (
    sessionHost: ReturnType<typeof kernel.authenticateHostAccessToken>,
    participantId: string,
    label: string,
  ) => {
    const next = kernel.leaseNextActivation(sessionHost, { leaseMs: 600_000 });
    assert.ok(next, `${label} has no queued Activation`);
    const attempt = kernel.createRunAttempt(sessionHost, {
      activationId: next.activationId,
    });
    const descriptor = {
      runAttemptId: attempt.runAttemptId,
      runtimeRunId: label,
      recoveryDescriptor: { driver: "fake", recoveryKey: label, metadata: {} },
    };
    kernel.prepareRunAttemptRuntime(sessionHost, descriptor);
    kernel.markRunAttemptRunning(sessionHost, descriptor);
    return service.issueActivationCredential(sessionHost, {
      activationId: next.activationId,
      consumerId: `${label}-consumer`,
      hostId: sessionHost.hostId,
      participantId,
      roomId: room.roomId,
      runAttemptId: attempt.runAttemptId,
      toSeq: next.toSeq,
    });
  };
  const hostFor = (participantId: string, hostId: string) => {
    const authenticated = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId,
        participantIds: [participantId],
      }).accessToken,
    );
    kernel.heartbeatHost(authenticated);
    return authenticated;
  };
  return {
    actor,
    agent,
    helper,
    host,
    hostFor,
    session,
    room,
    source,
    reviewedTask,
    kernel,
    activation,
    call,
    callWith,
    credentialFor,
    deliveredCursor,
    /** End this Run the way the daemon does, so the next Activation can lease. */
    finishFirstSession() {
      kernel.recordRuntimeTermination(host, {
        exit: { code: 0 },
        runAttemptId: run.runAttemptId,
        runtimeRunId: "fake",
      });
      kernel.finishRunAttempt(host, {
        exitCode: 0,
        runAttemptId: run.runAttemptId,
        state: "exited",
      });
      kernel.completeActivation(host, {
        activationId: activation.activationId,
        consumerId: "worker",
      });
    },
    activationHead,
    head,
    async close() {
      await service.close();
      database.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("the owner lifecycle runs end to end with no cursor and no idempotency key", async () => {
  const f = await fixture();
  try {
    const claimed = await f.call("tasks/claim-message", {
      messageId: f.source.event.aggregateId,
      rationale: "Durable multi-step work",
    });
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    const taskId = claimed.body.task.taskId as string;
    assert.equal(claimed.body.task.state, "claimed");

    const started = await f.call("tasks/start", { taskId });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.task.state, "in_progress");

    const progressed = await f.call("tasks/progress", {
      taskId,
      progress: "Half way",
    });
    assert.equal(progressed.status, 200, JSON.stringify(progressed.body));
    assert.equal(progressed.body.deduplicated, false);

    // An identical retry is one logical command.
    const retried = await f.call("tasks/progress", {
      taskId,
      progress: "Half way",
    });
    assert.equal(retried.status, 200);
    assert.equal(retried.body.deduplicated, true);
    assert.equal(retried.body.event.eventId, progressed.body.event.eventId);

    // A genuinely different operation is not deduplicated.
    const second = await f.call("tasks/progress", {
      taskId,
      progress: "Nearly done",
    });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.deduplicated, false);
    assert.notEqual(second.body.event.eventId, progressed.body.event.eventId);

    const submitted = await f.call("tasks/submit", {
      taskId,
      summary: "Finished the work",
    });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.equal(submitted.body.task.state, "submitted");
    const submitRetry = await f.call("tasks/submit", {
      taskId,
      summary: "Finished the work",
    });
    assert.equal(submitRetry.status, 200);
    assert.equal(
      submitRetry.body.event.eventId,
      submitted.body.event.eventId,
      "an identical resubmission replays",
    );
  } finally {
    await f.close();
  }
});

test("a rework round after changes_requested records new canonical events", async () => {
  const f = await fixture({ reviewerSeat: true });
  try {
    const taskId = f.reviewedTask!.task.taskId;
    const claimed = await f.call("tasks/claim", { taskId });
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    assert.equal((await f.call("tasks/start", { taskId })).status, 200);
    const firstProgress = await f.call("tasks/progress", {
      taskId,
      progress: "Round one",
    });
    assert.equal(firstProgress.status, 200, JSON.stringify(firstProgress.body));
    const firstSubmit = await f.call("tasks/submit", {
      taskId,
      summary: "Round one result",
    });
    assert.equal(firstSubmit.status, 200, JSON.stringify(firstSubmit.body));

    // The owner's Run ends on the submission, as it does in production.
    assert.equal(
      (await f.call("acknowledge", { throughSeq: f.deliveredCursor })).status,
      200,
    );
    f.finishFirstSession();

    // A reviewer asks for changes; the Task returns to the owner.
    const reviewerHost = f.hostFor(
      f.helper.principal.principalId,
      "reviewer-host",
    );
    const reviewer = f.callWith(
      f.session(reviewerHost, f.helper.principal.principalId, "review")
        .accessToken,
    );
    assert.equal((await reviewer("sync")).status, 200);
    const review = await reviewer("tasks/review", {
      taskId,
      disposition: "changes_requested",
      summary: "The evidence does not cover the failing case",
    });
    assert.equal(review.status, 200, JSON.stringify(review.body));
    assert.equal(review.body.task.state, "todo");

    // The owner's rework round: the same commands, the same prose, no cursor
    // and no key — and none of them may replay the rejected round.
    const rework = f.callWith(
      f.session(f.host, f.agent.principal.principalId, "rework").accessToken,
    );
    assert.equal((await rework("sync")).status, 200);
    const reclaimed = await rework("tasks/claim", { taskId });
    assert.equal(reclaimed.status, 200, JSON.stringify(reclaimed.body));
    assert.equal(reclaimed.body.deduplicated, false);
    assert.notEqual(reclaimed.body.event.eventId, claimed.body.event.eventId);
    const restarted = await rework("tasks/start", { taskId });
    assert.equal(restarted.status, 200, JSON.stringify(restarted.body));
    assert.equal(restarted.body.deduplicated, false);
    const reprogressed = await rework("tasks/progress", {
      taskId,
      progress: "Round one",
    });
    assert.equal(reprogressed.status, 200, JSON.stringify(reprogressed.body));
    assert.equal(
      reprogressed.body.deduplicated,
      false,
      "identical rework prose is a new round, not a replay",
    );
    assert.notEqual(
      reprogressed.body.event.eventId,
      firstProgress.body.event.eventId,
    );
    const resubmitted = await rework("tasks/submit", {
      taskId,
      summary: "Round one result",
    });
    assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted.body));
    assert.equal(resubmitted.body.task.state, "submitted");
    assert.notEqual(
      resubmitted.body.event.eventId,
      firstSubmit.body.event.eventId,
    );
  } finally {
    await f.close();
  }
});

test("creation, assignment, amendment, conversion and deletion accept the minimal form", async () => {
  const f = await fixture();
  try {
    const created = await f.call("tasks/create", { title: "Delegate later" });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const taskId = created.body.task.taskId as string;
    const createRetry = await f.call("tasks/create", {
      title: "Delegate later",
    });
    assert.equal(createRetry.status, 200, JSON.stringify(createRetry.body));
    assert.equal(createRetry.body.event.eventId, created.body.event.eventId);
    const other = await f.call("tasks/create", { title: "Another subtask" });
    assert.equal(other.status, 200, JSON.stringify(other.body));
    assert.notEqual(other.body.event.eventId, created.body.event.eventId);

    const assigned = await f.call("tasks/assign", {
      taskId,
      assigneeId: f.helper.principal.principalId,
    });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
    assert.equal(assigned.body.task.assigneeId, f.helper.principal.principalId);

    const amended = await f.call("tasks/amend", {
      taskId,
      title: "Delegate now",
    });
    assert.equal(amended.status, 200, JSON.stringify(amended.body));
    assert.equal(amended.body.task.title, "Delegate now");

    const converted = await f.call("tasks/convert", {
      messageId: f.source.event.aggregateId,
    });
    assert.equal(converted.status, 200, JSON.stringify(converted.body));
    assert.equal(converted.body.task.state, "todo");

    const deleted = await f.call("tasks/delete", {
      roomId: f.room.roomId,
      taskId: other.body.task.taskId,
    });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.equal(deleted.body.deleted, true);
    const deleteRetry = await f.call("tasks/delete", {
      roomId: f.room.roomId,
      taskId: other.body.task.taskId,
    });
    assert.equal(deleteRetry.status, 200);
    assert.equal(deleteRetry.body.deduplicated, true);
  } finally {
    await f.close();
  }
});

test("release, block, unblock and request-input accept the minimal form", async () => {
  const f = await fixture();
  try {
    const blocking = await f.call("tasks/create", { title: "Own this" });
    assert.equal(blocking.status, 200, JSON.stringify(blocking.body));
    const taskId = blocking.body.task.taskId as string;
    assert.equal((await f.call("tasks/claim", { taskId })).status, 200);
    assert.equal((await f.call("tasks/start", { taskId })).status, 200);
    const blocked = await f.call("tasks/block", {
      taskId,
      reason: "Waiting for the delegated subtasks",
    });
    assert.equal(blocked.status, 200, JSON.stringify(blocked.body));
    assert.equal(blocked.body.task.state, "blocked");

    // Recovery belongs to the next Activation, which is where an Agent sees
    // its own block delivered — still with no cursor and no key.
    assert.equal(
      (await f.call("acknowledge", { throughSeq: f.deliveredCursor })).status,
      200,
    );
    f.finishFirstSession();
    const later = f.callWith(
      f.session(f.host, f.agent.principal.principalId, "recovery").accessToken,
    );
    assert.equal((await later("sync")).status, 200);
    const unblocked = await later("tasks/unblock", { taskId });
    assert.equal(unblocked.status, 200, JSON.stringify(unblocked.body));
    assert.equal(unblocked.body.task.state, "todo");
  } finally {
    await f.close();
  }
});

test("an owned started Task asks for Human input with the minimal form", async () => {
  const f = await fixture();
  try {
    const created = await f.call("tasks/create", { title: "Needs an answer" });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const taskId = created.body.task.taskId as string;
    assert.equal((await f.call("tasks/claim", { taskId })).status, 200);
    assert.equal((await f.call("tasks/start", { taskId })).status, 200);
    const asked = await f.call("tasks/request-input", {
      taskId,
      question: "Which environment?",
    });
    assert.equal(asked.status, 200, JSON.stringify(asked.body));
    assert.equal(asked.body.task.state, "waiting_input");
    const retry = await f.call("tasks/request-input", {
      taskId,
      question: "Which environment?",
    });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.event.eventId, asked.body.event.eventId);
  } finally {
    await f.close();
  }
});

test("a claimed Task is released with the minimal form", async () => {
  const f = await fixture();
  try {
    const created = await f.call("tasks/create", { title: "Hand back" });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const taskId = created.body.task.taskId as string;
    assert.equal((await f.call("tasks/claim", { taskId })).status, 200);
    const released = await f.call("tasks/release", { taskId });
    assert.equal(released.status, 200, JSON.stringify(released.body));
    assert.equal(released.body.task.state, "todo");
  } finally {
    await f.close();
  }
});

test("a presented cursor is still fenced against this credential's delivered range", async () => {
  const f = await fixture();
  try {
    const created = await f.call("tasks/create", { title: "Fenced" });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const taskId = created.body.task.taskId as string;
    const undelivered = await f.call("tasks/claim", {
      taskId,
      basedOnRoomSeq: f.activation.toSeq + 5_000,
      idempotencyKey: "presented-claim",
    });
    assert.equal(undelivered.status, 409, JSON.stringify(undelivered.body));
    assert.equal(undelivered.body.error.code, "causal_cursor_not_delivered");

    // The explicit form still works when the cursor really was delivered.
    const explicit = await f.call("tasks/claim", {
      taskId,
      basedOnRoomSeq: created.body.event.roomSeq,
      idempotencyKey: "presented-claim",
    });
    assert.equal(explicit.status, 200, JSON.stringify(explicit.body));
    assert.equal(explicit.body.task.state, "claimed");
  } finally {
    await f.close();
  }
});

test("a reviewer records one canonical Review without carrying causal parameters", async () => {
  const f = await fixture({ reviewerSeat: true });
  try {
    const taskId = f.reviewedTask!.task.taskId;
    const claimed = await f.call("tasks/claim", { taskId });
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    assert.equal((await f.call("tasks/start", { taskId })).status, 200);
    assert.equal(
      (await f.call("tasks/submit", { taskId, summary: "Done" })).status,
      200,
    );
    const reviewerHost = f.hostFor(
      f.helper.principal.principalId,
      "reviewer-host",
    );
    const reviewer = f.callWith(
      f.session(reviewerHost, f.helper.principal.principalId, "review")
        .accessToken,
    );
    assert.equal((await reviewer("sync")).status, 200);
    const summary = "Read the trajectory and the frozen submission";
    const reviewed = await reviewer("tasks/review", {
      taskId,
      disposition: "approved",
      summary,
    });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    assert.equal(reviewed.body.review.disposition, "approved");
    const replay = await reviewer("tasks/review", {
      taskId,
      disposition: "approved",
      summary,
    });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.deduplicated, true);
    assert.equal(replay.body.event.eventId, reviewed.body.event.eventId);
  } finally {
    await f.close();
  }
});
