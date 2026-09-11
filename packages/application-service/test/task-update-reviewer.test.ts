import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { RoomKernel } from "@rah-os/kernel";
import { WorkerApplicationService } from "../src/index.ts";

/** Real service, two authenticated Worker executions, and persisted Reviewer evidence. */
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-task-hold-recovery-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const database = new DatabaseSync(join(directory, "room.db"));
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const agent = kernel.provisionPrincipal({ handle: "worker", kind: "agent" });
  const reviewer = kernel.provisionPrincipal({
    handle: "reviewer",
    kind: "agent",
  });
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Hold", slug: "hold" });
  kernel.addMember(actor, {
    principalId: agent.principal.principalId,
    roomId: room.roomId,
  });
  kernel.addMember(actor, {
    principalId: reviewer.principal.principalId,
    roomId: room.roomId,
  });
  const task = kernel.createTask(actor, {
    assigneeId: agent.principal.principalId,
    collaboratorIds: [],
    dependencyTaskIds: [],
    idempotencyKey: "task-1",
    reviewerIds: [reviewer.principal.principalId],
    roomId: room.roomId,
    title: "First",
  });
  const second = kernel.createTask(actor, {
    collaboratorIds: [],
    dependencyTaskIds: [],
    idempotencyKey: "task-2",
    reviewerIds: [],
    roomId: room.roomId,
    title: "Second",
  });
  kernel.postMessage(actor, {
    body: "Wake up and claim",
    idempotencyKey: "wake",
    recipients: [
      { participantId: agent.principal.principalId, reason: "mention" },
    ],
    roomId: room.roomId,
  });
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "host",
      participantIds: [agent.principal.principalId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 60_000 })!;
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    recoveryDescriptor: { driver: "fake", metadata: {}, recoveryKey: "fake" },
    runAttemptId: run.runAttemptId,
    runtimeRunId: "fake",
  };
  kernel.prepareRunAttemptRuntime(host, runtime);
  kernel.markRunAttemptRunning(host, runtime);
  const service = new WorkerApplicationService({ kernel });
  await service.start();
  const credential = service.issueActivationCredential(host, {
    activationId: activation.activationId,
    consumerId: "consumer",
    hostId: host.hostId,
    participantId: agent.principal.principalId,
    roomId: room.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const call = async (path: string, body: unknown = {}) => {
    const response = await fetch(`${service.origin}/v1/worker/${path}`, {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    return {
      body: (await response.json()) as Record<string, any>,
      status: response.status,
    };
  };
  await call("sync");
  return {
    actor,
    service,
    reviewer,
    credential,
    agent,
    call,
    database,
    kernel,
    room,
    second,
    task,
    async close() {
      await service.close();
      database.close();
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

test("Worker done preserves actual selected Reviewer evidence and is reachable after approval", async () => {
  const f = await fixture();
  try {
    const taskId = f.task.task.taskId;
    assert.equal(
      (await f.call("tasks/update-status", { taskId, status: "in_progress" }))
        .status,
      200,
    );
    const submit = await f.call("tasks/update-status", {
      taskId,
      status: "in_review",
      summary: "Real supplied result",
    });
    assert.equal(submit.status, 200, JSON.stringify(submit.body));
    const denied = await f.call("tasks/update-status", {
      taskId,
      status: "done",
    });
    assert.equal(denied.status, 409, JSON.stringify(denied.body));
    assert.match(JSON.stringify(denied.body), /approved Review evidence/);
    assert.equal(
      f.database.prepare("SELECT state FROM tasks WHERE task_id=?").get(taskId)!
        .state,
      "submitted",
    );
    const host = f.kernel.authenticateHostAccessToken(
      f.kernel.provisionHostCredential({
        hostId: "review-host",
        participantIds: [f.reviewer.principal.principalId],
      }).accessToken,
    );
    f.kernel.heartbeatHost(host);
    const activation = f.kernel.leaseNextActivation(host, { leaseMs: 60000 })!;
    assert.ok(activation);
    const run = f.kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    const runtime = {
      runAttemptId: run.runAttemptId,
      runtimeRunId: "review-fake",
      recoveryDescriptor: {
        driver: "fake",
        metadata: {},
        recoveryKey: "review-fake",
      },
    };
    f.kernel.prepareRunAttemptRuntime(host, runtime);
    f.kernel.markRunAttemptRunning(host, runtime);
    const credential = f.service.issueActivationCredential(host, {
      activationId: activation.activationId,
      consumerId: "review-consumer",
      hostId: host.hostId,
      participantId: f.reviewer.principal.principalId,
      roomId: f.room.roomId,
      runAttemptId: run.runAttemptId,
      toSeq: activation.toSeq,
    });
    const reviewCall = async (path: string, body: unknown = {}) => {
      const response = await fetch(f.service.origin + "/v1/worker/" + path, {
        method: "POST",
        headers: {
          authorization: "Bearer " + credential.accessToken,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: (await response.json()) as any };
    };
    assert.equal((await reviewCall("sync")).status, 200);
    const review = await reviewCall("tasks/review", {
      taskId,
      disposition: "approved",
      summary: "Independent actual review passed",
    });
    assert.equal(review.status, 200, JSON.stringify(review.body));
    assert.equal(
      review.body.review.reviewerId,
      f.reviewer.principal.principalId,
    );
    const history = await f.call("tasks/history", { taskId, limit: 100 });
    assert.equal(history.status, 200, JSON.stringify(history.body));
    assert.equal(
      (await f.call("messages/history", { limit: 100 })).status,
      200,
    );
    const done = await f.call("tasks/update-status", {
      taskId,
      status: "done",
    });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.task.state, "completed", JSON.stringify(done.body));
    assert.equal(done.body.event.actorId, f.agent.principal.principalId);
    const again = await f.call("tasks/update-status", {
      taskId,
      status: "done",
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.deduplicated, true);
    assert.equal(
      f.database
        .prepare(
          "SELECT COUNT(*) n FROM task_reviews WHERE disposition='approved'",
        )
        .get()!.n,
      1,
    );
  } finally {
    await f.close();
  }
});
