import { request as httpRequest } from "node:http";
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
  const dir = mkdtempSync(join(tmpdir(), "rah-amend-http-")),
    kernel = new RoomKernel({ databasePath: join(dir, "db") });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ kind: "human", handle: "human" }),
    agent = kernel.provisionPrincipal({ kind: "agent", handle: "reviewer" }),
    owner = kernel.provisionPrincipal({ kind: "agent", handle: "owner" });
  const actor = kernel.authenticateAccessToken(human.accessToken),
    room = kernel.createRoom(actor, { name: "Amend", slug: "amend" });
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

/**
 * `task-history` and `sync` render Raft's text; upstream prints the event
 * payload as JSON on its own indented line (`formatTaskHistory`,
 * `main.js@677573`), so a test that asserts on a payload reads that line.
 */
const renderedPayloads = (stdout: string): any[] =>
  stdout
    .split("\n")
    .filter((line) => line.startsWith("  {"))
    .map((line) => JSON.parse(line.trim()));

/** Every `seq=`/`type=` pair the rendered sync window states. */
const renderedEvents = (stdout: string): { roomSeq: number; type: string }[] =>
  [...stdout.matchAll(/^\[?seq=(\d+) [^\n]*?type=([a-z_]+\.[a-z_]+)/gmu)].map(
    (match) => ({ roomSeq: Number(match[1]), type: match[2]! }),
  );

/** The delivered cursor the sync header states. */
const renderedCursorAfter = (stdout: string): number => {
  const matched = /cursor \d+ to (\d+) of \d+/u.exec(stdout);
  assert.ok(matched, stdout);
  return Number(matched[1]);
};

test("Worker noncreator amendment through HTTP and real Node CLI preserves ownership, exact replay and full history", async () => {
  const f = await fixture();
  try {
    const input = {
      taskId: f.task.task.taskId,
      title: "  Worker amended  ",
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "amend",
    };
    const r = await f.call("tasks/amend", input);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.task.title, "Worker amended");
    assert.equal(r.body.task.assigneeId, f.owner.principal.principalId);
    assert.equal(r.body.task.claimedBy, undefined);
    assert.equal(
      (await f.call("tasks/amend", input)).body.event.eventId,
      r.body.event.eventId,
    );
    assert.equal(
      (await f.call("tasks/amend", { ...input, description: null })).status,
      409,
    );
    const out = await f.cli([
      "task-amend",
      "--task-id",
      input.taskId,
      "--clear-description",
      "--based-on-room-seq",
      String(r.body.event.roomSeq),
      "--idempotency-key",
      "clear",
    ]);
    // Raft's `task amend` acknowledges in text (`formatTaskAmended`): the
    // headline names the recorded event and a cleared description renders as
    // `details: <none>`.
    assert.match(out.stdout, /^details: <none>$/mu, out.stderr);
    const clearedSeq = Number(
      /amended — event seq (\d+)\./u.exec(out.stdout)?.[1],
    );
    assert.ok(Number.isInteger(clearedSeq), out.stdout);
    const history = renderedPayloads(
      (await f.cli(["task-history", "--task-id", input.taskId])).stdout,
    );
    assert.deepEqual(history[0].changes.description, {
      from: "Criteria",
      to: null,
    });
    assert.equal(
      (
        await f.call("tasks/claim", {
          taskId: input.taskId,
          basedOnRoomSeq: clearedSeq,
          idempotencyKey: "steal",
        })
      ).status,
      403,
    );
    const future = f.kernel.createTask(f.actor, {
      roomId: f.room.roomId,
      title: "Future",
      collaboratorIds: [],
      reviewerIds: [],
      dependencyTaskIds: [],
      idempotencyKey: "future",
    });
    assert.equal(
      (
        await f.call("tasks/amend", {
          ...input,
          taskId: future.task.taskId,
          idempotencyKey: "future-amend",
        })
      ).status,
      403,
    );
    f.credential.revoke();
    assert.equal((await f.call("tasks/amend", input)).status, 401);
  } finally {
    await f.close();
  }
});

test("Human typed task.amend and Worker history accept complete worst-case legal fields without relaxing ordinary read limits", async () => {
  const f = await fixture();
  try {
    const client = new HttpRahClient({
      baseUrl: f.humanService.origin!,
      accessToken: () => f.human.accessToken,
    });
    const taskId = f.task.task.taskId;
    const first = await f.call("tasks/amend", {
      taskId,
      title: "\u0001".repeat(10000),
      description: "\u0002".repeat(50000),
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "large1",
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const a = first.body;
    const b = await client.request("task.amend", {
      taskId,
      title: "\u0003".repeat(10000),
      description: "\u0004".repeat(50000),
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "large2",
    });
    const history = renderedPayloads(
      (await f.cli(["task-history", "--task-id", taskId])).stdout,
    );
    assert.deepEqual(history[0].changes, b.event.payload.changes);
    assert.equal(a.task.description?.length, 50000);
    const read = await client.request("task.history", {
      roomId: f.room.roomId,
      taskId,
    });
    assert.deepEqual(read.events[0]!.changes, b.event.payload.changes);
  } finally {
    await f.close();
  }
});

test("Large amended events reach the assignee next execution through bounded complete sync pages; an unseen final cursor cannot be ACKed", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 6; i++)
      createHumanApplicationPort(f.kernel).amendTask(f.actor, {
        taskId: f.task.task.taskId,
        title: String.fromCharCode(i + 1).repeat(10000),
        description: String.fromCharCode(i + 1).repeat(50000),
        basedOnRoomSeq: f.latest(),
        idempotencyKey: `big-${i}`,
      });
    const host = f.kernel.authenticateHostAccessToken(
      f.kernel.provisionHostCredential({
        hostId: "owner-host",
        participantIds: [f.owner.principal.principalId],
      }).accessToken,
    );
    f.kernel.heartbeatHost(host);
    const activation = f.kernel.leaseNextActivation(host, { leaseMs: 60000 });
    assert.ok(activation);
    const run = f.kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    const runtime = {
      runAttemptId: run.runAttemptId,
      runtimeRunId: "owner-fake",
      recoveryDescriptor: {
        driver: "fake",
        recoveryKey: "owner-fake",
        metadata: {},
      },
    };
    f.kernel.prepareRunAttemptRuntime(host, runtime);
    f.kernel.markRunAttemptRunning(host, runtime);
    const grant = f.worker.issueActivationCredential(host, {
      activationId: activation.activationId,
      consumerId: "owner-read",
      hostId: host.hostId,
      participantId: f.owner.principal.principalId,
      roomId: f.room.roomId,
      runAttemptId: run.runAttemptId,
      toSeq: activation.toSeq,
    });
    writeFileSync(join(f.dir, "token"), grant.accessToken, { mode: 0o600 });
    let cursor = 0;
    const seqs: number[] = [],
      amendments: string[] = [];
    let pages = 0;
    do {
      const out = await f.cli([
        "sync",
        ...(cursor ? ["--after-seq", String(cursor)] : []),
      ]);
      assert.ok(Buffer.byteLength(out.stdout) < 2 * 1024 * 1024);
      const delivered = renderedEvents(out.stdout);
      pages++;
      const cursorAfter = renderedCursorAfter(out.stdout);
      assert.ok(cursorAfter > cursor);
      seqs.push(...delivered.map((event) => event.roomSeq));
      amendments.push(
        ...delivered
          .filter((event) => event.type === "task.amended")
          .map((event) => String(event.roomSeq)),
      );
      cursor = cursorAfter;
      if (pages === 1) {
        assert.ok(cursor < activation.toSeq);
        await assert.rejects(
          () =>
            f.cli(["acknowledge", "--through-seq", String(activation.toSeq)]),
          /cursor.*not.delivered|not delivered/i,
        );
      }
    } while (cursor < activation.toSeq);
    assert.equal(amendments.length, 6);
    assert.equal(new Set(seqs).size, seqs.length);
    assert.deepEqual(
      seqs,
      Array.from({ length: activation.toSeq }, (_, i) => i + 1),
    );
    const ack = JSON.parse(
      (await f.cli(["acknowledge", "--through-seq", String(activation.toSeq)]))
        .stdout,
    );
    assert.equal(ack.acknowledgedThrough, activation.toSeq);
  } finally {
    await f.close();
  }
});

test("Amendment body upload revalidates revoked bearer and current Room membership before changing card/history", async () => {
  for (const revoke of ["bearer", "membership"] as const) {
    const f = await fixture();
    try {
      const before = f.db
        .prepare("SELECT COUNT(*) AS n FROM room_events")
        .get()!.n;
      const body = JSON.stringify({
        taskId: f.task.task.taskId,
        title: "Must not land",
        basedOnRoomSeq: f.activation.toSeq,
        idempotencyKey: "revoked",
      });
      let request!: ReturnType<typeof httpRequest>;
      const continued = Promise.withResolvers<void>();
      const response = new Promise<{
        status: number | undefined;
        body: string;
      }>((resolve, reject) => {
        request = httpRequest(
          `${f.worker.origin}/v1/worker/tasks/amend`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${f.credential.accessToken}`,
              "content-type": "application/json",
              expect: "100-continue",
            },
          },
          (r) => {
            let text = "";
            r.on("data", (c) => (text += String(c)));
            r.on("end", () => resolve({ status: r.statusCode, body: text }));
          },
        );
        request.on("error", reject);
        request.on("continue", () => continued.resolve());
      });
      request.flushHeaders();
      await continued.promise;
      request.write(body.slice(0, 10));
      if (revoke === "bearer") f.credential.revoke();
      else
        f.db
          .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
          .run(f.room.roomId, f.agent.principal.principalId);
      request.end(body.slice(10));
      const result = await response;
      assert.equal(result.status, revoke === "bearer" ? 401 : 403, result.body);
      assert.equal(
        f.db.prepare("SELECT COUNT(*) AS n FROM room_events").get()!.n,
        before,
      );
      assert.equal(
        f.db
          .prepare("SELECT title FROM tasks WHERE task_id=?")
          .get(f.task.task.taskId)!.title,
        "Original",
      );
      assert.equal(
        f.db
          .prepare("SELECT state FROM run_attempts WHERE run_attempt_id=?")
          .get(f.run.runAttemptId)!.state,
        "running",
      );
    } finally {
      await f.close();
    }
  }
});
