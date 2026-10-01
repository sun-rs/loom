import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RoomKernel, createHumanApplicationPort } from "@rah-os/kernel";
import { HttpRahClient } from "@rah-os/client-sdk";
import {
  ClientApplicationService,
  WorkerApplicationService,
} from "../src/index.ts";
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "rah-delete-http-")),
    kernel = new RoomKernel({ databasePath: join(dir, "db") });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ kind: "human", handle: "human" }),
    agent = kernel.provisionPrincipal({ kind: "agent", handle: "reviewer" }),
    owner = kernel.provisionPrincipal({ kind: "agent", handle: "owner" });
  const actor = kernel.authenticateAccessToken(human.accessToken),
    room = kernel.createRoom(actor, { name: "Amend", slug: "amend" });
  const policyDb = new DatabaseSync(join(dir, "db"));
  policyDb
    .prepare("UPDATE rooms SET allow_instance_task_creation=1 WHERE room_id=?")
    .run(room.roomId);
  policyDb.close();
  for (const id of [agent.principal.principalId, owner.principal.principalId])
    kernel.addMember(actor, { roomId: room.roomId, principalId: id });
  const task = kernel.createTask(actor, {
    roomId: room.roomId,
    title: "Original",
    description: "Criteria",
    assigneeId: owner.principal.principalId,
    reviewerIds: [agent.principal.principalId],
    collaboratorIds: [],
    dependencyTaskIds: [],
    idempotencyKey: "task",
  });
  kernel.postMessage(actor, {
    roomId: room.roomId,
    body: "Review criteria only",
    recipients: [
      { participantId: agent.principal.principalId, reason: "mention" },
    ],
    idempotencyKey: "wake",
  });
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "test-host",
      participantIds: [agent.principal.principalId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 60000 });
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
  const worker = new WorkerApplicationService({ kernel }),
    humanService = new ClientApplicationService({
      human: createHumanApplicationPort(kernel),
      health: () => {
        throw new Error("health is outside this Task facade fixture");
      },
    });
  await worker.start();
  await humanService.start();
  const credential = worker.issueActivationCredential(host, {
    activationId: activation.activationId,
    consumerId: "amend-consumer",
    hostId: host.hostId,
    participantId: agent.principal.principalId,
    roomId: room.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const db = new DatabaseSync(join(dir, "db"));
  const call = async (path: string, body: unknown = {}) => {
    const r = await fetch(`${worker.origin}/v1/worker/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  await call("sync");
  const tokenFile = join(dir, "token");
  writeFileSync(tokenFile, credential.accessToken, { mode: 0o600 });
  const cli = async (args: string[]) =>
    promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {runWorkerCliCommand} from ${JSON.stringify(new URL("../../agent-host/src/worker-cli.ts", import.meta.url).href)};process.exitCode=await runWorkerCliCommand(process.argv.slice(1));`,
        "worker",
        ...args,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          RAH_WORKER_API_URL: worker.origin!,
          RAH_WORKER_SESSION_FILE: tokenFile,
          RAH_ACTIVATION_ID: activation.activationId,
        },
        maxBuffer: 3 * 1024 * 1024,
      },
    );
  return {
    dir,
    kernel,
    db,
    human,
    actor,
    agent,
    owner,
    room,
    task,
    activation,
    run,
    host,
    runtime,
    worker,
    credential,
    call,
    cli,
    humanService,
    latest: () =>
      Number(
        db
          .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
          .get(room.roomId)!.n,
      ),
    async close() {
      await worker.close();
      await humanService.close();
      db.close();
      kernel.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("Human SDK truly deletes Task metadata and replays the durable deletion receipt", async () => {
  const f = await fixture();
  try {
    const client = new HttpRahClient({
      baseUrl: f.humanService.origin!,
      accessToken: () => f.human.accessToken,
    });
    const input = {
      roomId: f.room.roomId,
      taskId: f.task.task.taskId,
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "human-delete",
    };
    const result = await client.request("task.delete", input);
    assert.equal(result.deleted, true);
    assert.equal(result.deduplicated, false);
    assert.equal(
      (await client.request("task.delete", input)).event.eventId,
      result.event.eventId,
    );
    assert.equal(
      f.db
        .prepare("SELECT COUNT(*) n FROM tasks WHERE task_id=?")
        .get(input.taskId)!.n,
      0,
    );
    assert.ok(
      f.db
        .prepare("SELECT 1 FROM messages WHERE message_id=?")
        .get(result.sourceMessageId),
    );
    assert.ok(
      f.db
        .prepare("SELECT 1 FROM threads WHERE thread_id=?")
        .get(result.threadId),
    );
    await assert.rejects(
      () =>
        client.request("task.get", {
          roomId: input.roomId,
          taskId: input.taskId,
        }),
      /not found/,
    );
  } finally {
    await f.close();
  }
});

test("Worker creator deletion uses current Room and execution authority; real CLI reaches the same owner", async () => {
  const f = await fixture();
  try {
    const created = await f.call("tasks/create", {
      title: "Worker discussion Task",
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "created",
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const input = {
      roomId: f.room.roomId,
      taskId: created.body.task.taskId,
      basedOnRoomSeq: created.body.event.roomSeq,
      idempotencyKey: "worker-delete",
    };
    assert.equal(
      (await f.call("tasks/delete", { ...input, taskId: f.task.task.taskId }))
        .status,
      403,
    );
    assert.equal(
      (await f.call("tasks/delete", { ...input, roomId: "foreign-room" }))
        .status,
      403,
    );
    const deleted = await f.call("tasks/delete", input);
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.equal(deleted.body.deleted, true);
    // Raft's `task delete` acknowledges in text (`formatTaskDeleted`), so the
    // Agent's own surface is read as text and the durable replay receipt is
    // asserted where it lives, on the ledger response.
    const replay = await f.cli([
      "task-delete",
      "--room-id",
      input.roomId,
      "--task-id",
      input.taskId,
      "--based-on-room-seq",
      String(input.basedOnRoomSeq),
      "--idempotency-key",
      input.idempotencyKey,
    ]);
    assert.equal(
      replay.stdout.trim(),
      `#${deleted.body.taskNumber} deleted.`,
      replay.stderr,
    );
    const receipt = await f.call("tasks/delete", input);
    assert.equal(receipt.body.event.eventId, deleted.body.event.eventId);
    assert.equal(receipt.body.deduplicated, true);
    assert.equal(
      (await f.call("tasks/delete", { ...input, taskId: "another" })).status,
      409,
    );
    const replacement = f.worker.issueActivationCredential(f.host, {
      activationId: f.activation.activationId,
      consumerId: "delete-replacement",
      hostId: f.host.hostId,
      participantId: f.agent.principal.principalId,
      roomId: f.room.roomId,
      runAttemptId: f.run.runAttemptId,
      toSeq: f.activation.toSeq,
    });
    const retry = () =>
      fetch(`${f.worker.origin}/v1/worker/tasks/delete`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${replacement.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      });
    const persisted = await retry();
    assert.equal(persisted.status, 200);
    assert.equal(
      ((await persisted.json()) as { event: { eventId: string } }).event
        .eventId,
      deleted.body.event.eventId,
    );
    f.db
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(f.room.roomId, f.agent.principal.principalId);
    assert.equal(
      (await retry()).status,
      403,
      "persisted receipt does not bypass current membership",
    );
    replacement.revoke();
    f.credential.revoke();
    assert.equal((await f.call("tasks/delete", input)).status, 401);
  } finally {
    await f.close();
  }
});

test("Task-delete CLI rejects actor and target overrides before transport", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      () =>
        f.cli([
          "task-delete",
          "--room-id",
          f.room.roomId,
          "--task-id",
          f.task.task.taskId,
          "--based-on-room-seq",
          String(f.activation.toSeq),
          "--idempotency-key",
          "x",
          "--actor-id",
          f.human.principal.principalId,
        ]),
      /unknown --actor-id/,
    );
  } finally {
    await f.close();
  }
});

async function ownRunningTask(
  f: Awaited<ReturnType<typeof fixture>>,
  key: string,
) {
  const created = await f.call("tasks/create", {
    title: key,
    assigneeId: f.agent.principal.principalId,
    basedOnRoomSeq: f.activation.toSeq,
    idempotencyKey: key,
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const taskId = created.body.task.taskId;
  assert.equal(created.body.task.state, "claimed");
  const started = await f.call("tasks/start", {
    taskId,
    basedOnRoomSeq: created.body.event.roomSeq,
    idempotencyKey: `${key}-start`,
  });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  return { taskId, seq: started.body.event.roomSeq };
}
function terminate(f: Awaited<ReturnType<typeof fixture>>) {
  f.kernel.recordRuntimeTermination(f.host, {
    runAttemptId: f.run.runAttemptId,
    runtimeRunId: f.runtime.runtimeRunId,
    exit: { code: 0 },
  });
  f.kernel.finishRunAttempt(f.host, {
    runAttemptId: f.run.runAttemptId,
    state: "exited",
    exitCode: 0,
  });
}

test("Delete never removes an active claim or execution, including expired claim before runtime terminal proof", async () => {
  const f = await fixture();
  try {
    const { taskId, seq } = await ownRunningTask(f, "fenced");
    const input = {
      roomId: f.room.roomId,
      taskId,
      basedOnRoomSeq: seq,
      idempotencyKey: "delete-fenced",
    };
    assert.match(
      JSON.stringify((await f.call("tasks/delete", input)).body),
      /active claim/,
    );
    f.db
      .prepare(
        "UPDATE tasks SET claim_until_ms=0,claim_until='1970-01-01T00:00:00.000Z' WHERE task_id=?",
      )
      .run(taskId);
    const blocked = await f.call("tasks/delete", input);
    assert.equal(blocked.status, 409);
    assert.match(JSON.stringify(blocked.body), /active execution/);
    assert.ok(f.db.prepare("SELECT 1 FROM tasks WHERE task_id=?").get(taskId));
    terminate(f);
    assert.equal(
      (await f.call("tasks/delete", input)).status,
      409,
      "terminal credentials cannot mutate even their own Task",
    );
    const removed = createHumanApplicationPort(f.kernel).deleteTask(f.actor, {
      ...input,
      basedOnRoomSeq: f.latest(),
    });
    assert.equal(removed.deleted, true);
    assert.ok(
      f.db
        .prepare(
          "SELECT 1 FROM run_attempts WHERE run_attempt_id=? AND state='exited'",
        )
        .get(f.run.runAttemptId),
    );
  } finally {
    await f.close();
  }
});

test("Published Task submission bytes and messages survive deletion; private submission graph is removed without FK corruption", async () => {
  const f = await fixture();
  try {
    const { taskId, seq } = await ownRunningTask(f, "published");
    const prepared = await f.call("artifacts/prepare", {
      taskId,
      filename: "proof.txt",
      mimeType: "text/plain",
      size: 5,
      idempotencyKey: "artifact",
    });
    assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
    const attachmentId = prepared.body.attachmentId;
    const put = await fetch(
      `${f.worker.origin}/v1/worker/artifacts/${attachmentId}`,
      {
        method: "PUT",
        headers: { authorization: `Bearer ${f.credential.accessToken}` },
        body: "proof",
      },
    );
    assert.equal(put.status, 200);
    const pending = await f.call("artifacts/prepare", {
      taskId,
      filename: "pending.txt",
      mimeType: "text/plain",
      size: 5,
      idempotencyKey: "pending",
    });
    assert.equal(pending.status, 200);
    const submitted = await f.call("tasks/submit", {
      taskId,
      basedOnRoomSeq: seq,
      idempotencyKey: "submit",
      summary: "Evidence",
      verification: {
        status: "passed",
        summary: "fake deterministic proof",
        artifactIds: [attachmentId],
      },
    });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    terminate(f);
    const receipt = createHumanApplicationPort(f.kernel).deleteTask(f.actor, {
      roomId: f.room.roomId,
      taskId,
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "delete-published",
    });
    assert.equal(receipt.deleted, true);
    assert.equal(
      f.db
        .prepare("SELECT COUNT(*) n FROM task_submissions WHERE task_id=?")
        .get(taskId)!.n,
      0,
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT COUNT(*) n FROM task_submission_artifacts WHERE task_id=?",
        )
        .get(taskId)!.n,
      0,
    );
    const file = f.db
      .prepare("SELECT * FROM room_files WHERE attachment_id=?")
      .get(attachmentId)!;
    assert.equal(file.state, "consumed");
    assert.equal(file.task_id, null);
    assert.ok(file.message_id);
    assert.equal(file.run_attempt_id, f.run.runAttemptId);
    const downloaded = await f.kernel.files.download(f.actor, attachmentId),
      chunks = [];
    for await (const chunk of downloaded.stream) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), "proof");
    assert.equal(
      f.db
        .prepare("SELECT state FROM room_files WHERE attachment_id=?")
        .get(pending.body.attachmentId)!.state,
      "canceled",
    );
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
    const restarted = new RoomKernel({ databasePath: join(f.dir, "db") });
    try {
      restarted.initialize();
      assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      restarted.close();
    }
  } finally {
    await f.close();
  }
});

test("Unpublished completed and pending Artifact reservations are canceled by deletion and reclaimed by existing restart GC", async () => {
  const f = await fixture();
  try {
    const { taskId } = await ownRunningTask(f, "abandoned");
    const ids = [];
    for (const [key, complete] of [
      ["complete", true],
      ["pending", false],
    ] as const) {
      const p = await f.call("artifacts/prepare", {
        taskId,
        filename: `${key}.txt`,
        mimeType: "text/plain",
        size: 5,
        idempotencyKey: key,
      });
      assert.equal(p.status, 200);
      ids.push(p.body.attachmentId);
      if (complete) {
        const put = await fetch(
          `${f.worker.origin}/v1/worker/artifacts/${p.body.attachmentId}`,
          {
            method: "PUT",
            headers: { authorization: `Bearer ${f.credential.accessToken}` },
            body: "proof",
          },
        );
        assert.equal(put.status, 200);
      }
    }
    terminate(f);
    f.db
      .prepare(
        "UPDATE tasks SET claim_until_ms=0,claim_until='1970-01-01T00:00:00.000Z' WHERE task_id=?",
      )
      .run(taskId);
    createHumanApplicationPort(f.kernel).deleteTask(f.actor, {
      roomId: f.room.roomId,
      taskId,
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "delete-abandoned",
    });
    for (const id of ids) {
      const row = f.db
        .prepare("SELECT state,task_id FROM room_files WHERE attachment_id=?")
        .get(id)!;
      assert.equal(row.state, "canceled");
      assert.equal(row.task_id, null);
      await assert.rejects(() => f.kernel.files.download(f.actor, id));
    }
    const restarted = new RoomKernel({ databasePath: join(f.dir, "db") });
    try {
      restarted.initialize();
      for (const id of ids)
        assert.equal(
          f.db
            .prepare(
              "SELECT storage_reclaimed FROM room_files WHERE attachment_id=?",
            )
            .get(id)!.storage_reclaimed,
          1,
        );
    } finally {
      restarted.close();
    }
  } finally {
    await f.close();
  }
});

test("Expired creation-time claim still fences deletion until its creating Run terminates", async () => {
  const f = await fixture();
  try {
    const created = await f.call("tasks/create", {
      title: "Claimed at creation",
      assigneeId: f.agent.principal.principalId,
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "creation-claim",
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.task.state, "claimed");
    const taskId = created.body.task.taskId;
    f.db
      .prepare(
        "UPDATE tasks SET claim_until_ms=0,claim_until='1970-01-01T00:00:00.000Z' WHERE task_id=?",
      )
      .run(taskId);
    assert.throws(
      () =>
        createHumanApplicationPort(f.kernel).deleteTask(f.actor, {
          roomId: f.room.roomId,
          taskId,
          basedOnRoomSeq: f.latest(),
          idempotencyKey: "delete-creation-claim",
        }),
      /active execution/,
    );
  } finally {
    await f.close();
  }
});

test("Task deletion refuses pending Human input and preserves its running execution fence after cancellation", async () => {
  const f = await fixture();
  try {
    const { taskId, seq } = await ownRunningTask(f, "waiting");
    const requested = await f.call("tasks/request-input", {
      taskId,
      basedOnRoomSeq: seq,
      idempotencyKey: "input",
      question: "Keep this Task?",
    });
    assert.equal(requested.status, 200, JSON.stringify(requested.body));
    const remove = () =>
      createHumanApplicationPort(f.kernel).deleteTask(f.actor, {
        roomId: f.room.roomId,
        taskId,
        basedOnRoomSeq: f.latest(),
        idempotencyKey: "delete-waiting",
      });
    assert.throws(remove, /Human input/);
    f.kernel.cancelTask(f.actor, {
      taskId,
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "cancel-waiting",
      reason: "Task no longer needed",
    });
    assert.throws(remove, /active execution/);
    terminate(f);
    assert.equal(remove().deleted, true);
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    await f.close();
  }
});

test("Delete does not erase an unresolved cancellation until its existing Host recovery finishes", async () => {
  const f = await fixture();
  try {
    const { taskId } = await ownRunningTask(f, "canceling");
    f.kernel.cancelTask(f.actor, {
      taskId,
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "cancel",
      reason: "obsolete",
    });
    const remove = () =>
      createHumanApplicationPort(f.kernel).deleteTask(f.actor, {
        roomId: f.room.roomId,
        taskId,
        basedOnRoomSeq: f.latest(),
        idempotencyKey: "delete-canceling",
      });
    assert.ok(
      f.db
        .prepare(
          "SELECT 1 FROM activation_cancellation_requests WHERE task_id=? AND resolved_at IS NULL",
        )
        .get(taskId),
    );
    assert.throws(remove, /cancellation/);
    terminate(f);
    assert.throws(remove, /cancellation/);
    f.kernel.resolveActivationCancellation(f.host, {
      activationId: f.activation.activationId,
    });
    assert.equal(remove().deleted, true);
  } finally {
    await f.close();
  }
});
