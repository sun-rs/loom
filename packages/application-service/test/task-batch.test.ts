import {
  reserveBatchReceipt,
  TASK_BATCH_RECEIPT_TTL_MS,
  TASK_BATCH_RECEIPT_LIMIT,
} from "../../kernel/src/task-batch-receipts.ts";
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
  const policyDb = new DatabaseSync(join(directory, "room.db"));
  policyDb
    .prepare("UPDATE rooms SET allow_instance_task_creation=1 WHERE room_id=?")
    .run(room.roomId);
  policyDb.close();
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
      body: (await response.json()) as {
        results: { success: boolean }[];
        tasks: {
          title?: string;
          taskId?: string;
          success: boolean;
          deleted?: boolean;
        }[];
        state?: string;
      },
      status: response.status,
    };
  };
  await call("sync");
  return {
    actor,
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

test("batch claim reports every selector and preserves partial results", async () => {
  const f = await fixture();
  try {
    const response = await f.call("tasks/claim-batch", {
      channel: "#hold",
      taskNumbers: [f.task.task.taskNumber, 999999, f.second.task.taskNumber],
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(
      response.body.results.map((r) => r.success),
      [true, false, true],
    );
    assert.equal(
      f.database
        .prepare("SELECT COUNT(*) AS n FROM tasks WHERE claimed_by = ?")
        .get(f.agent.principal.principalId)!.n,
      2,
    );
  } finally {
    await f.close();
  }
});

test("batch freshness hold leaves every claim unapplied", async () => {
  const f = await fixture();
  try {
    f.kernel.postMessage(f.actor, {
      body: "Stop and inspect the correction",
      idempotencyKey: "batch-newer",
      recipients: [
        { participantId: f.agent.principal.principalId, reason: "mention" },
      ],
      roomId: f.room.roomId,
    });
    const response = await f.call("tasks/claim-batch", {
      channel: "#hold",
      taskNumbers: [f.task.task.taskNumber, f.second.task.taskNumber],
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.state, "held");
    assert.equal(
      f.database
        .prepare("SELECT COUNT(*) AS n FROM tasks WHERE claimed_by = ?")
        .get(f.agent.principal.principalId)!.n,
      0,
    );
  } finally {
    await f.close();
  }
});

test("batch create creates all titles in one durable request", async () => {
  const f = await fixture();
  try {
    const response = await f.call("tasks/create-batch", {
      channel: "#hold",
      titles: ["Batch A", "Batch B"],
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(
      response.body.tasks.map((t) => t.title),
      ["Batch A", "Batch B"],
    );
    assert.equal(
      f.database.prepare("SELECT COUNT(*) AS n FROM tasks").get()!.n,
      4,
    );
  } finally {
    await f.close();
  }
});

test("batch retry preserves partial results and rejects a changed intent under the same key", async () => {
  const f = await fixture();
  try {
    const request = {
      channel: "#hold",
      taskNumbers: [f.task.task.taskNumber, 999999, f.second.task.taskNumber],
      idempotencyKey: "batch-replay",
    };
    const first = await f.call("tasks/claim-batch", request);
    const second = await f.call("tasks/claim-batch", request);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(second.body.results, first.body.results);
    assert.equal(
      f.database
        .prepare(
          "SELECT COUNT(*) AS n FROM room_events WHERE type='task.claimed'",
        )
        .get()!.n,
      2,
    );
    const conflict = await f.call("tasks/claim-batch", {
      ...request,
      taskNumbers: [f.task.task.taskNumber],
    });
    assert.equal(conflict.status, 409);
  } finally {
    await f.close();
  }
});

test("batch create validates assignment before writing and ordinary retry creates no duplicates", async () => {
  const f = await fixture();
  try {
    const denied = await f.call("tasks/create-batch", {
      titles: ["A", "B"],
      assignee: "@owner",
    });
    assert.equal(denied.status, 403);
    assert.equal(
      f.database.prepare("SELECT COUNT(*) AS n FROM tasks").get()!.n,
      2,
    );
    const request = { titles: ["A", "B"] };
    assert.equal((await f.call("tasks/create-batch", request)).status, 200);
    assert.equal((await f.call("tasks/create-batch", request)).status, 200);
    assert.equal(
      f.database.prepare("SELECT COUNT(*) AS n FROM tasks").get()!.n,
      4,
    );
  } finally {
    await f.close();
  }
});

test("batch claim accepts message selectors and holds can recover after actual read", async () => {
  const f = await fixture();
  try {
    f.kernel.postMessage(f.actor, {
      roomId: f.room.roomId,
      body: "New instruction",
      idempotencyKey: "read-new",
      recipients: [
        { participantId: f.agent.principal.principalId, reason: "mention" },
      ],
    });
    const request = { messageIds: [f.task.task.sourceMessageId] };
    assert.equal(
      (await f.call("tasks/claim-batch", request)).body.state,
      "held",
    );
    assert.equal(
      (await f.call("messages/history", { limit: 100 })).status,
      200,
    );
    const result = await f.call("tasks/claim-batch", request);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.results[0]?.success, true);
  } finally {
    await f.close();
  }
});

test("receipt replay checks current membership before exposing prior results", async () => {
  const f = await fixture();
  try {
    const request = {
      titles: ["private task"],
      idempotencyKey: "member-replay",
    };
    assert.equal((await f.call("tasks/create-batch", request)).status, 200);
    f.database
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(f.room.roomId, f.agent.principal.principalId);
    const response = await f.call("tasks/create-batch", request);
    assert.ok(response.status === 403 || response.status === 401);
  } finally {
    await f.close();
  }
});

test("batch creation rolls back every prior title if later persistence fails", async () => {
  const f = await fixture();
  try {
    f.database.exec(
      "CREATE TRIGGER reject_batch_b BEFORE INSERT ON tasks WHEN NEW.title='Fail B' BEGIN SELECT RAISE(ABORT, 'injected second insert'); END",
    );
    const response = await f.call("tasks/create-batch", {
      titles: ["First A", "Fail B"],
    });
    assert.equal(response.status, 500);
    assert.equal(
      f.database.prepare("SELECT COUNT(*) AS n FROM tasks").get()!.n,
      2,
    );
    assert.equal(
      f.database
        .prepare("SELECT COUNT(*) AS n FROM task_batch_command_receipts")
        .get()!.n,
      0,
    );
  } finally {
    await f.close();
  }
});

test("deleted Task replay keeps the prior applied identity without deleted title", async () => {
  const f = await fixture();
  try {
    const request = {
      titles: ["Confidential title"],
      idempotencyKey: "delete-replay",
    };
    const created = await f.call("tasks/create-batch", request);
    const taskId = created.body.tasks[0]!.taskId!;
    const deletion = await f.call("tasks/delete", {
      roomId: f.room.roomId,
      taskId,
    });
    assert.equal(deletion.status, 200, JSON.stringify(deletion.body));
    const replay = await f.call("tasks/create-batch", request);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.tasks[0]!.success, true);
    assert.equal(replay.body.tasks[0]!.taskId, taskId);
    assert.equal(replay.body.tasks[0]!.deleted, true);
    assert.equal(replay.body.tasks[0]!.title, undefined);
    assert.equal(
      f.database.prepare("SELECT COUNT(*) AS n FROM tasks").get()!.n,
      2,
    );
  } finally {
    await f.close();
  }
});

test("batch limits reject oversized input before mutations", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.call("tasks/create-batch", {
          titles: Array.from({ length: 101 }, () => "Task"),
        })
      ).status,
      400,
    );
    assert.equal(
      f.database.prepare("SELECT COUNT(*) AS n FROM tasks").get()!.n,
      2,
    );
  } finally {
    await f.close();
  }
});

test("receipt TTL keeps recoverable work and capacity never evicts unexpired results", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.call("tasks/create-batch", { titles: ["receipt"] })).status,
      200,
    );
    const row = f.database
      .prepare("SELECT * FROM task_batch_command_receipts")
      .get()!;
    const before = Number(row.created_at_ms),
      expires = Number(row.expires_at_ms);
    assert.equal(expires - before, TASK_BATCH_RECEIPT_TTL_MS);
    reserveBatchReceipt(f.database, expires + 1);
    assert.equal(
      f.database
        .prepare("SELECT COUNT(*) AS n FROM task_batch_command_receipts")
        .get()!.n,
      1,
      "active Activation keeps its receipt beyond TTL",
    );
    f.database
      .prepare("UPDATE activations SET state='completed' WHERE activation_id=?")
      .run(row.activation_id!);
    reserveBatchReceipt(f.database, expires + 1);
    assert.equal(
      f.database
        .prepare("SELECT COUNT(*) AS n FROM task_batch_command_receipts")
        .get()!.n,
      1,
      "running process prevents expiry cleanup",
    );
    f.database
      .prepare("UPDATE run_attempts SET state='exited' WHERE activation_id=?")
      .run(row.activation_id!);
    reserveBatchReceipt(f.database, expires - 1);
    assert.equal(
      f.database
        .prepare("SELECT COUNT(*) AS n FROM task_batch_command_receipts")
        .get()!.n,
      1,
      "terminal work still retains full TTL",
    );
    const insert = f.database.prepare(
      "INSERT INTO task_batch_command_receipts SELECT actor_id,room_id,operation,?,request_digest,response_json,activation_id,created_at_ms,expires_at_ms FROM task_batch_command_receipts LIMIT 1",
    );
    for (let i = 1; i < TASK_BATCH_RECEIPT_LIMIT; i++)
      insert.run(`capacity-${i}`);
    assert.throws(
      () => reserveBatchReceipt(f.database, expires - 1),
      /capacity/,
    );
    assert.equal(
      f.database
        .prepare("SELECT COUNT(*) AS n FROM task_batch_command_receipts")
        .get()!.n,
      TASK_BATCH_RECEIPT_LIMIT,
    );
    reserveBatchReceipt(f.database, expires + 1);
    assert.equal(
      f.database
        .prepare("SELECT COUNT(*) AS n FROM task_batch_command_receipts")
        .get()!.n,
      TASK_BATCH_RECEIPT_LIMIT - 100,
      "expiry pruning is bounded per operation",
    );
  } finally {
    await f.close();
  }
});
