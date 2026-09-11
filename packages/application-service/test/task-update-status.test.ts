import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { RoomKernel } from "@rah-os/kernel";
import { WorkerApplicationService } from "../src/index.ts";

/**
 * A freshness hold tells the Agent to read the newer context and rerun the
 * command if it is still correct. That instruction is only true if reading can
 * clear the hold; otherwise the retry carries the same frozen Activation head
 * and is held forever inside the Run.
 */
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-task-hold-recovery-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const database = new DatabaseSync(join(directory, "room.db"));
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const agent = kernel.provisionPrincipal({ handle: "worker", kind: "agent" });
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Hold", slug: "hold" });
  kernel.addMember(actor, {
    principalId: agent.principal.principalId,
    roomId: room.roomId,
  });
  const task = kernel.createTask(actor, {
    collaboratorIds: [],
    dependencyTaskIds: [],
    idempotencyKey: "task-1",
    reviewerIds: [],
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

test("status setter starts and releases through the canonical Task lane", async () => {
  const f = await fixture();
  try {
    const req = {
      channel: "#hold",
      taskNumber: f.task.task.taskNumber,
      status: "in_progress",
    };
    const started = await f.call("tasks/update-status", req);
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.task.state, "in_progress");
    const replay = await f.call("tasks/update-status", req);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.deduplicated, true);
    const released = await f.call("tasks/update-status", {
      ...req,
      status: "todo",
    });
    assert.equal(released.status, 200, JSON.stringify(released.body));
    assert.equal(released.body.task.state, "todo");
  } finally {
    await f.close();
  }
});
test("status setter holds before a start and does not leave a partial claim", async () => {
  const f = await fixture();
  try {
    f.kernel.postMessage(f.actor, {
      roomId: f.room.roomId,
      body: "Wait for the correction",
      recipients: [
        { participantId: f.agent.principal.principalId, reason: "mention" },
      ],
      idempotencyKey: "correction",
    });
    const held = await f.call("tasks/update-status", {
      taskId: f.task.task.taskId,
      status: "in_progress",
    });
    assert.equal(held.status, 200);
    assert.equal(held.body.state, "held");
    assert.equal(
      f.database
        .prepare("SELECT state FROM tasks WHERE task_id=?")
        .get(f.task.task.taskId)!.state,
      "todo",
    );
  } finally {
    await f.close();
  }
});
test("status in_review requires actual summary and reuses submission evidence owner", async () => {
  const f = await fixture();
  try {
    const started = await f.call("tasks/update-status", {
      taskId: f.task.task.taskId,
      status: "in_progress",
    });
    assert.equal(started.status, 200);
    const absent = await f.call("tasks/update-status", {
      taskId: f.task.task.taskId,
      status: "in_review",
    });
    assert.equal(absent.status, 409);
    assert.equal(
      f.database.prepare("SELECT COUNT(*) AS n FROM task_submissions").get()!.n,
      0,
    );
    const submitted = await f.call("tasks/update-status", {
      taskId: f.task.task.taskId,
      status: "in_review",
      summary: "Actual supplied result",
    });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.equal(submitted.body.task.state, "submitted");
    assert.equal(
      f.database.prepare("SELECT COUNT(*) AS n FROM task_submissions").get()!.n,
      1,
    );
  } finally {
    await f.close();
  }
});

test("claimed is not started, and repeated status cycles create a new execution step", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.call("tasks/claim", { taskId: f.task.task.taskId })).status,
      200,
    );
    const req = { taskId: f.task.task.taskId, status: "in_progress" };
    const started = await f.call("tasks/update-status", req);
    assert.equal(started.status, 200);
    assert.equal(started.body.task.state, "in_progress");
    assert.equal(
      (await f.call("tasks/update-status", { ...req, status: "todo" })).status,
      200,
    );
    const again = await f.call("tasks/update-status", req);
    assert.equal(again.status, 200);
    assert.equal(again.body.task.state, "in_progress");
    assert.notEqual(again.body.event.eventId, started.body.event.eventId);
  } finally {
    await f.close();
  }
});
test("start transaction rollback restores the unclaimed Task", async () => {
  const f = await fixture();
  try {
    f.database.exec(
      "CREATE TRIGGER fail_status_start BEFORE UPDATE OF state ON tasks WHEN NEW.state='in_progress' BEGIN SELECT RAISE(ABORT,'injected status fault'); END",
    );
    const events = f.database
      .prepare("SELECT COUNT(*) AS n FROM room_events")
      .get()!.n;
    const result = await f.call("tasks/update-status", {
      taskId: f.task.task.taskId,
      status: "in_progress",
    });
    assert.equal(result.status, 500);
    assert.equal(
      f.database
        .prepare("SELECT state FROM tasks WHERE task_id=?")
        .get(f.task.task.taskId)!.state,
      "todo",
    );
    assert.equal(
      f.database.prepare("SELECT COUNT(*) AS n FROM room_events").get()!.n,
      events,
    );
  } finally {
    await f.close();
  }
});
test("status updates reject revoked execution and a foreign Room Task", async () => {
  const f = await fixture();
  try {
    const room = f.kernel.createRoom(f.actor, { name: "Other", slug: "other" });
    const task = f.kernel.createTask(f.actor, {
      roomId: room.roomId,
      title: "Private",
      idempotencyKey: "other-task",
      collaboratorIds: [],
      reviewerIds: [],
      dependencyTaskIds: [],
    });
    assert.equal(
      (
        await f.call("tasks/update-status", {
          taskId: task.task.taskId,
          status: "in_progress",
        })
      ).status,
      403,
    );
    f.credential.revoke();
    assert.equal(
      (
        await f.call("tasks/update-status", {
          taskId: f.task.task.taskId,
          status: "in_progress",
        })
      ).status,
      401,
    );
  } finally {
    await f.close();
  }
});

test("in_review without summary reuses the actual authored Thread result", async () => {
  const f = await fixture();
  try {
    const id = f.task.task.taskId;
    assert.equal(
      (
        await f.call("tasks/update-status", {
          taskId: id,
          status: "in_progress",
        })
      ).status,
      200,
    );
    const sent = await f.call("messages/post", {
      channel: `#hold:${f.task.task.threadId}`,
      body: "Actual result already posted in this Thread",
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.ok(sent.body.event);
    const result = await f.call("tasks/update-status", {
      taskId: id,
      status: "in_review",
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.task.state, "submitted");
    assert.equal(
      result.body.task.submissionSummary,
      "Actual result already posted in this Thread",
    );
    const replay = await f.call("tasks/update-status", {
      taskId: id,
      status: "in_review",
    });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.deduplicated, true);
    assert.equal(
      f.database.prepare("SELECT COUNT(*) AS n FROM task_submissions").get()!.n,
      1,
    );
  } finally {
    await f.close();
  }
});
test("freshness hold is recoverable by reading, without weakening the start fence", async () => {
  const f = await fixture();
  try {
    f.kernel.postMessage(f.actor, {
      roomId: f.room.roomId,
      body: "Read this change before beginning",
      recipients: [
        { participantId: f.agent.principal.principalId, reason: "mention" },
      ],
      idempotencyKey: "read-correction",
    });
    const body = { taskId: f.task.task.taskId, status: "in_progress" };
    assert.equal(
      (await f.call("tasks/update-status", body)).body.state,
      "held",
    );
    assert.equal((await f.call("messages/history", { limit: 20 })).status, 200);
    const retried = await f.call("tasks/update-status", body);
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.task.state, "in_progress");
  } finally {
    await f.close();
  }
});

test("owner status done commits with the Agent identity after submitted work and context read", async () => {
  const f = await fixture();
  try {
    const taskId = f.task.task.taskId;
    assert.equal(
      (await f.call("tasks/update-status", { taskId, status: "in_progress" }))
        .status,
      200,
    );
    const premature = await f.call("tasks/update-status", {
      taskId,
      status: "done",
    });
    assert.notEqual(premature.status, 200);
    assert.equal(
      (
        await f.call("tasks/update-status", {
          taskId,
          status: "in_review",
          summary: "Completed the requested work",
        })
      ).status,
      200,
    );
    f.kernel.postMessage(f.actor, {
      roomId: f.room.roomId,
      body: "Looks good, mark it done",
      recipients: [
        { participantId: f.agent.principal.principalId, reason: "mention" },
      ],
      idempotencyKey: "human-approval",
    });
    const held = await f.call("tasks/update-status", {
      taskId,
      status: "done",
    });
    assert.equal(held.body.state, "held");
    await f.call("messages/history", { limit: 20 });
    const done = await f.call("tasks/update-status", {
      taskId,
      status: "done",
    });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.task.state, "completed");
    assert.equal(done.body.event.actorId, f.agent.principal.principalId);
    const replay = await f.call("tasks/update-status", {
      taskId,
      status: "done",
    });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.deduplicated, true);
  } finally {
    await f.close();
  }
});

test("Worker closes only its owned Task without terminating the shared execution lane", async () => {
  const f = await fixture();
  try {
    const taskId = f.task.task.taskId;
    const unowned = await f.call("tasks/update-status", {
      taskId,
      status: "closed",
    });
    assert.notEqual(unowned.status, 200);
    assert.equal(
      (await f.call("tasks/update-status", { taskId, status: "in_progress" }))
        .status,
      200,
    );
    const closed = await f.call("tasks/update-status", {
      taskId,
      status: "closed",
    });
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    assert.equal(closed.body.task.state, "cancelled");
    assert.equal(closed.body.event.actorId, f.agent.principal.principalId);
    assert.equal(
      f.database
        .prepare("SELECT COUNT(*) AS n FROM activation_cancellation_requests")
        .get()!.n,
      0,
    );
    assert.equal(
      (
        await f.call("tasks/update-status", {
          taskId: f.second.task.taskId,
          status: "in_progress",
        })
      ).status,
      200,
    );
    const replay = await f.call("tasks/update-status", {
      taskId,
      status: "closed",
    });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.deduplicated, true);
  } finally {
    await f.close();
  }
});
