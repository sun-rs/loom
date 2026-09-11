import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { RoomKernel } from "@rah-os/kernel";
import { runWorkerCliCommand } from "../../agent-host/src/worker-cli.ts";

import { WorkerApplicationService } from "../src/index.ts";

/** Raft message-check tool delivery and local durable replay recovery. */
async function fixture(prefixCount = 0) {
  const directory = mkdtempSync(join(tmpdir(), "rah-minimal-commands-"));
  const databasePath = join(directory, "room.db");
  let kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const database = new DatabaseSync(databasePath);
  const human = kernel.provisionPrincipal({ kind: "human", handle: "human" });
  const agent = kernel.provisionPrincipal({ kind: "agent", handle: "agent" });
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Channel", slug: "channel" });
  const second = kernel.createRoom(actor, { name: "Second", slug: "second" });
  for (const roomId of [room.roomId, second.roomId])
    kernel.addMember(actor, {
      roomId,
      principalId: agent.principal.principalId,
    });
  const prefix = kernel.postMessage(actor, {
    roomId: room.roomId,
    body: "Original unacknowledged context",
    recipients: [],
    idempotencyKey: "prefix",
  });
  for (let i = 0; i < prefixCount; i++)
    kernel.postMessage(actor, {
      roomId: room.roomId,
      body: `prefix ${i}`,
      recipients: [],
      idempotencyKey: `prefix-${i}`,
    });
  const task = kernel.createTask(actor, {
    roomId: room.roomId,
    title: "Still owed",
    assigneeId: agent.principal.principalId,
    collaboratorIds: [],
    reviewerIds: [],
    dependencyTaskIds: [],
    idempotencyKey: "owed",
  });
  const source = kernel.postMessage(actor, {
    roomId: room.roomId,
    body: "Please carry this durable work",
    idempotencyKey: "source",
    recipients: [
      { participantId: agent.principal.principalId, reason: "mention" },
    ],
  });
  const thread = kernel.createThread(actor, {
    roomId: room.roomId,
    rootMessageId: source.event.aggregateId,
    recipientIds: [],
    idempotencyKey: "thread",
    basedOnRoomSeq: source.event.roomSeq,
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
  let run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  let runtime = {
    runAttemptId: run.runAttemptId,
    runtimeRunId: "fake",
    recoveryDescriptor: { driver: "fake", recoveryKey: "fake", metadata: {} },
  };
  kernel.prepareRunAttemptRuntime(host, runtime);
  kernel.markRunAttemptRunning(host, runtime);
  let service = new WorkerApplicationService({ kernel });
  await service.start();
  const activationHead = () =>
    Number(
      database
        .prepare("SELECT to_seq AS n FROM activations WHERE activation_id=?")
        .get(activation.activationId)!.n,
    );
  let credential = service.issueActivationCredential(host, {
    activationId: activation.activationId,
    consumerId: "worker",
    hostId: host.hostId,
    participantId: agent.principal.principalId,
    roomId: room.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const token = join(directory, "token");
  writeFileSync(token, credential.accessToken, { mode: 0o600 });
  const call = async (path: string, body: unknown = {}) => {
    const response = await fetch(`${service.origin}/v1/worker/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  };
  const firstSync = await call("sync");
  assert.equal(firstSync.status, 200);
  const head = () =>
    Number(
      database
        .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
        .get(room.roomId)!.n,
    );
  const post = (key: string) =>
    kernel.postRoomMessage(actor, {
      roomId: room.roomId,
      body: `filler ${key}`,
      idempotencyKey: key,
      recipients: [],
    });
  return {
    actor,
    async cli(replay = false, loseAck = false) {
      writeFileSync(token, credential.accessToken, { mode: 0o600 });
      let stdout = "",
        stderr = "";
      const exit = await runWorkerCliCommand(
        ["worker", "message-check", ...(replay ? ["--replay"] : [])],
        {
          env: {
            RAH_ACTIVATION_ID: activation.activationId,
            RAH_WORKER_API_URL: service.origin,
            RAH_WORKER_SESSION_FILE: token,
          },
          fetch: async (input, init) => {
            const response = await fetch(input, init);
            if (loseAck && String(input).endsWith("/acknowledge"))
              throw new Error("ACK response lost");
            return response;
          },
          stdout: {
            write: (text) => {
              stdout += text;
            },
          },
          stderr: {
            write: (text) => {
              stderr += text;
            },
          },
        },
      );
      return { exit, stdout, stderr };
    },
    revoke: () => credential.revoke(),
    prefix,
    task,
    async retryAfterCrash() {
      kernel.recordRuntimeTermination(host, {
        runAttemptId: run.runAttemptId,
        runtimeRunId: runtime.runtimeRunId,
        exit: { code: 1 },
      });
      kernel.finishRunAttempt(host, {
        runAttemptId: run.runAttemptId,
        state: "failed",
        exitCode: 1,
      });
      assert.throws(
        () =>
          kernel.completeActivation(host, {
            activationId: activation.activationId,
            consumerId: "worker",
          }),
        /Task|task|obligation/,
      );
      kernel.retryActivation(host, {
        activationId: activation.activationId,
        error: "model crashed after delivery ACK",
        retryAfterMs: 0,
      });
      await service.close();
      kernel.close();
      kernel = new RoomKernel({ databasePath });
      kernel.initialize();
      const retry = kernel.leaseNextActivation(host, { leaseMs: 600000 });
      assert.ok(retry);
      assert.equal(retry.activationId, activation.activationId);
      run = kernel.createRunAttempt(host, { activationId: retry.activationId });
      const nextRuntime = {
        ...runtime,
        runAttemptId: run.runAttemptId,
        runtimeRunId: "retry-runtime",
      };
      runtime = nextRuntime;
      kernel.prepareRunAttemptRuntime(host, nextRuntime);
      kernel.markRunAttemptRunning(host, nextRuntime);
      service = new WorkerApplicationService({ kernel });
      await service.start();
      credential = service.issueActivationCredential(host, {
        activationId: retry.activationId,
        consumerId: "worker",
        hostId: host.hostId,
        participantId: agent.principal.principalId,
        roomId: room.roomId,
        runAttemptId: run.runAttemptId,
        toSeq: retry.toSeq,
      });
    },
    async completeRecoveredWork(throughSeq: number) {
      assert.equal((await call("acknowledge", { throughSeq })).status, 200);
      for (const [path, body] of [
        ["tasks/claim", { taskId: task.task.taskId }],
        ["tasks/start", { taskId: task.task.taskId }],
        [
          "tasks/submit",
          {
            taskId: task.task.taskId,
            summary: "Recovered task handled in deterministic fixture",
          },
        ],
      ] as const) {
        const result = await call(path, body);
        assert.equal(result.status, 200, JSON.stringify(result.body));
      }
      kernel.recordRuntimeTermination(host, {
        runAttemptId: run.runAttemptId,
        runtimeRunId: runtime.runtimeRunId,
        exit: { code: 0 },
      });
      kernel.finishRunAttempt(host, {
        runAttemptId: run.runAttemptId,
        state: "exited",
        exitCode: 0,
      });
      kernel.completeActivation(host, {
        activationId: activation.activationId,
        consumerId: "worker",
      });
    },
    agent,
    activation,
    activationHead,
    call,
    database,
    head,
    kernel,
    post,
    room,
    second,
    source,
    thread: thread.thread,
    async close() {
      await service.close();
      database.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("automatic delivery ACK survives model failure and restart with original prefix and Task obligation", async () => {
  const f = await fixture();
  try {
    assert.ok(f.prefix.event.roomSeq < f.activation.fromSeq);
    const first = await f.call("message-check");
    assert.equal(first.status, 200);
    const initialIds = first.body.delivery.events.map((e: any) => e.eventId);
    assert.ok(initialIds.includes(f.prefix.event.eventId));
    assert.ok(initialIds.includes(f.source.event.eventId));
    assert.equal(
      (
        await f.call("acknowledge", {
          throughSeq: first.body.delivery.cursorAfter,
        })
      ).status,
      200,
    );
    assert.equal(
      (await f.call("message-check")).body.delivery.events.length,
      0,
    );
    await f.retryAfterCrash();
    const replay = await f.call("message-check");
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    const replayIds = replay.body.delivery.events.map((e: any) => e.eventId);
    for (const id of initialIds)
      assert.ok(replayIds.includes(id), `original event ${id} disappeared`);
    assert.notEqual(
      f.database
        .prepare("SELECT state FROM tasks WHERE task_id=?")
        .get(f.task.task.taskId)!.state,
      "completed",
    );
    assert.equal(
      f.database
        .prepare(
          "SELECT COUNT(*) AS n FROM activation_delivery_windows WHERE activation_id=?",
        )
        .get(f.activation.activationId)!.n,
      1,
    );
    await f.completeRecoveredWork(replay.body.delivery.cursorAfter);
    assert.equal(
      f.database
        .prepare("SELECT state FROM activations WHERE activation_id=?")
        .get(f.activation.activationId)!.state,
      "completed",
    );
    assert.equal(
      f.database
        .prepare("SELECT state FROM tasks WHERE task_id=?")
        .get(f.task.task.taskId)!.state,
      "submitted",
    );
  } finally {
    await f.close();
  }
});

test("check output can replay before ACK and never acknowledges a late follow-up", async () => {
  const f = await fixture();
  try {
    const first = await f.call("message-check");
    assert.equal(first.status, 200);
    const repeated = await f.call("message-check");
    assert.deepEqual(repeated.body.delivery.events, first.body.delivery.events);
    const late = f.post("late");
    assert.equal(
      (await f.call("acknowledge", { throughSeq: late.event.roomSeq })).status,
      409,
    );
    assert.equal(
      (
        await f.call("acknowledge", {
          throughSeq: first.body.delivery.cursorAfter,
        })
      ).status,
      200,
    );
    const replay = await f.call("message-check", { replay: true });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.throughSeq, f.activation.toSeq);
    assert.ok(
      replay.body.delivery.events.every(
        (e: any) => e.roomSeq <= f.activation.toSeq,
      ),
    );
    assert.equal((await f.call("message-check", { afterSeq: 0 })).status, 400);
  } finally {
    await f.close();
  }
});

test("large check pages acknowledge in order and revoked credentials cannot replay", async () => {
  const f = await fixture(510);
  try {
    const first = await f.call("message-check");
    assert.equal(first.status, 200);
    assert.equal(first.body.delivery.events.length, 500);
    const unackedAgain = await f.call("message-check");
    assert.equal(
      unackedAgain.body.delivery.cursorAfter,
      first.body.delivery.cursorAfter,
    );
    assert.equal(
      (
        await f.call("acknowledge", {
          throughSeq: first.body.delivery.cursorAfter,
        })
      ).status,
      200,
    );
    const second = await f.call("message-check");
    assert.equal(second.status, 200);
    assert.equal(
      second.body.delivery.events[0].roomSeq,
      first.body.delivery.cursorAfter + 1,
    );
    assert.equal(second.body.delivery.cursorAfter, f.activation.toSeq);
    assert.equal(
      (
        await f.call("acknowledge", {
          throughSeq: second.body.delivery.cursorAfter,
        })
      ).status,
      200,
    );
    const empty = await f.call("message-check");
    assert.equal(empty.body.delivery.events.length, 0);
    f.revoke();
    assert.equal((await f.call("message-check", { replay: true })).status, 401);
  } finally {
    await f.close();
  }
});

test("legacy explicit ACK before first check does not pretend to recover already consumed prefix", async () => {
  const f = await fixture();
  try {
    const legacy = await f.call("sync");
    assert.equal(
      (await f.call("acknowledge", { throughSeq: legacy.body.cursorAfter }))
        .status,
      200,
    );
    const check = await f.call("message-check");
    assert.equal(check.status, 200);
    assert.ok(
      check.body.delivery.events.some(
        (e: any) => e.eventId === f.source.event.eventId,
      ),
    );
    assert.equal(
      check.body.delivery.events.some(
        (e: any) => e.eventId === f.prefix.event.eventId,
      ),
      false,
    );
    assert.equal(
      f.database
        .prepare(
          "SELECT after_seq FROM activation_delivery_windows WHERE activation_id=?",
        )
        .get(f.activation.activationId)!.after_seq,
      f.activation.fromSeq - 1,
    );
  } finally {
    await f.close();
  }
});

test("real CLI HTTP check recovers lost ACK response via replay and a new Run", async () => {
  const f = await fixture();
  try {
    const lost = await f.cli(false, true);
    assert.equal(lost.exit, 1);
    assert.match(lost.stdout, /Original unacknowledged context/);
    assert.match(lost.stderr, /ACK response lost/);
    const replay = await f.cli(true);
    assert.equal(replay.exit, 0, replay.stderr);
    assert.match(replay.stdout, /Original unacknowledged context/);
    await f.retryAfterCrash();
    const retry = await f.cli();
    assert.equal(retry.exit, 0, retry.stderr);
    assert.match(retry.stdout, /Please carry this durable work/);
    assert.match(retry.stdout, /Original unacknowledged context/);
    await f.completeRecoveredWork(f.activation.toSeq);
  } finally {
    await f.close();
  }
});
