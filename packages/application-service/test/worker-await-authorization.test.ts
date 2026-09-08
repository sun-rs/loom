import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";
import { WorkerApplicationService } from "../src/index.ts";
import { WORKER_HTTP_ROUTE_PATHS } from "../src/worker-application-service.ts";

async function jsonObject(
  response: Response,
): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  assert.ok(typeof body === "object" && body !== null && !Array.isArray(body));
  return body as Record<string, unknown>;
}

function errorCode(body: Record<string, unknown>): unknown {
  assert.ok(typeof body.error === "object" && body.error !== null);
  return (body.error as Record<string, unknown>).code;
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function fixture(
  options: {
    capture?: () => Promise<void>;
    patch?: string;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "rah-worker-await-auth-"));
  let nowMs = Date.parse("2026-09-08T00:00:00Z");
  const now = () => new Date(nowMs);
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath, now });
  const service = new WorkerApplicationService({
    kernel,
    now,
    deliveryEvidenceCollector: {
      async captureBaseline({ workspaceRoot }) {
        return {
          baseCommit: "1".repeat(40),
          repositoryId: `sha256:${"a".repeat(64)}`,
          source: "git",
          workspaceRoot,
        };
      },
      async captureSubmission({ baseline }) {
        await options.capture?.();
        return {
          baseCommit: baseline.baseCommit,
          headCommit: "2".repeat(40),
          repositoryId: baseline.repositoryId,
          patch: new TextEncoder().encode(options.patch ?? ""),
        };
      },
    },
  });
  kernel.initialize();
  const human = kernel.provisionPrincipal({
    handle: "await-human",
    kind: "human",
  });
  const agent = kernel.provisionPrincipal({
    handle: "await-agent",
    kind: "agent",
  });
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const workspace = kernel.createWorkspace(actor, {
    idempotencyKey: "await-workspace",
    name: "Await authorization",
    slug: "await-auth",
  });
  const controlRoomId = workspace.controlRoom.roomId;
  const roomId = kernel.createWorkspaceRoom(actor, {
    basedOnControlRoomSeq: workspace.event.roomSeq,
    idempotencyKey: "await-room",
    kind: "channel",
    name: "Work",
    slug: "work",
    workspaceId: workspace.workspace.workspaceId,
  }).room.roomId;
  for (const id of [controlRoomId, roomId])
    kernel.addMember(actor, {
      principalId: agent.principal.principalId,
      roomId: id,
    });
  const created = kernel.createTask(actor, {
    assigneeId: agent.principal.principalId,
    idempotencyKey: "await-task",
    roomId,
    title: "Guard awaited Worker commands",
  });
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "await-host",
      participantIds: [agent.principal.principalId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    recoveryDescriptor: {
      driver: "fake-runtime",
      metadata: {},
      recoveryKey: "await-runtime",
    },
    runAttemptId: run.runAttemptId,
    runtimeRunId: "await-runtime",
  };
  kernel.prepareRunAttemptRuntime(host, runtime);
  kernel.markRunAttemptRunning(host, runtime);
  await service.start();
  const credential = await service.issueActivationCredentialForWorkspace(
    host,
    {
      activationId: activation.activationId,
      consumerId: "await-consumer",
      hostId: host.hostId,
      participantId: agent.principal.principalId,
      roomId,
      runAttemptId: run.runAttemptId,
      toSeq: activation.toSeq,
    },
    { ttlMs: 10_000, workspaceRoot: directory },
  );
  const request = (path: string, body: Record<string, unknown> = {}) =>
    fetch(`${service.origin}/v1/worker/${path}`, {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
  return {
    actor,
    credential,
    databasePath,
    kernel,
    request,
    roomId,
    run,
    terminate() {
      kernel.recordRuntimeTermination(host, {
        exit: { code: 0 },
        runAttemptId: run.runAttemptId,
        runtimeRunId: "await-runtime",
      });
      kernel.finishRunAttempt(host, {
        exitCode: 0,
        runAttemptId: run.runAttemptId,
        state: "exited",
      });
    },
    taskId: created.task.taskId,
    expire() {
      nowMs += 10_001;
    },
    async startTask() {
      const synced = await request("sync");
      assert.equal(synced.status, 200);
      let basedOnRoomSeq = (await jsonObject(synced)).cursorAfter as number;
      for (const operation of ["claim", "start"]) {
        const response = await request(`tasks/${operation}`, {
          basedOnRoomSeq,
          idempotencyKey: `await-${operation}`,
          taskId: created.task.taskId,
        });
        assert.equal(response.status, 200, await response.clone().text());
        basedOnRoomSeq = (
          (await jsonObject(response)).event as Record<string, unknown>
        ).roomSeq as number;
      }
      return basedOnRoomSeq;
    },
    async close() {
      await service.close();
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

for (const scenario of [
  "revoked-empty",
  "revoked-patch",
  "expired-patch",
] as const) {
  test(`Worker submit does not freeze or publish after authorization is ${scenario} during capture`, async () => {
    const entered = gate();
    const resume = gate();
    const f = await fixture({
      capture: async () => {
        entered.release();
        await resume.promise;
      },
      patch:
        scenario === "revoked-empty"
          ? ""
          : "diff --git a/a b/a\n+private patch\n",
    });
    try {
      const basedOnRoomSeq = await f.startTask();
      const eventCount = f.kernel.sync(f.actor, {
        consumerId: "await-before",
        roomId: f.roomId,
      }).events.length;
      const pending = f.request("tasks/submit", {
        basedOnRoomSeq,
        idempotencyKey: "await-submit",
        summary: "Must not commit after revocation",
        taskId: f.taskId,
      });
      await entered.promise;
      if (scenario === "expired-patch") f.expire();
      else f.credential.revoke();
      resume.release();
      const response = await pending;
      const db = new DatabaseSync(f.databasePath, { readOnly: true });
      try {
        assert.equal(
          f.kernel
            .listTasks(f.actor, { roomId: f.roomId })
            .find((task) => task.taskId === f.taskId)?.state,
          "in_progress",
          "revoked submit must not change canonical Task state",
        );
        assert.equal(
          f.kernel.taskReviews.listTaskSubmissions(f.actor, {
            roomId: f.roomId,
            taskId: f.taskId,
          }).length,
          0,
        );
        assert.equal(
          f.kernel.files.list(f.actor, { roomId: f.roomId }).files.length,
          0,
        );
        assert.equal(
          f.kernel.sync(f.actor, {
            consumerId: "await-after",
            roomId: f.roomId,
          }).events.length,
          eventCount,
        );
        assert.equal(
          db.prepare("SELECT count(*) AS count FROM room_files").get()?.count,
          0,
          "capture finished after revoke must not even reserve a patch Artifact",
        );
        assert.equal(
          db
            .prepare("SELECT state FROM run_attempts WHERE run_attempt_id = ?")
            .get(f.run.runAttemptId)?.state,
          "running",
          "only Worker bearer changed; execution remains valid",
        );
        assert.equal(response.status, 401);
        assert.equal(errorCode(await jsonObject(response)), "unauthenticated");
      } finally {
        db.close();
      }
    } finally {
      resume.release();
      await f.close();
    }
  });
}

test("Worker submit reauthenticates during its internal patch upload before completing bytes", async () => {
  const entered = gate();
  const resume = gate();
  const f = await fixture({ patch: "diff --git a/a b/a\n+private patch\n" });
  const upload = f.kernel.files.uploadWorker.bind(f.kernel.files);
  f.kernel.files.uploadWorker = (execution, attachmentId, chunks, authorize) =>
    upload(
      execution,
      attachmentId,
      (async function* () {
        entered.release();
        await resume.promise;
        yield* chunks;
      })(),
      authorize,
    );
  try {
    const basedOnRoomSeq = await f.startTask();
    const pending = f.request("tasks/submit", {
      basedOnRoomSeq,
      idempotencyKey: "await-submit-upload",
      summary: "Must not publish after revoke",
      taskId: f.taskId,
    });
    await entered.promise;
    f.credential.revoke();
    resume.release();
    const response = await pending;
    const db = new DatabaseSync(f.databasePath, { readOnly: true });
    try {
      assert.equal(
        f.kernel
          .listTasks(f.actor, { roomId: f.roomId })
          .find((task) => task.taskId === f.taskId)?.state,
        "in_progress",
      );
      assert.equal(
        f.kernel.taskReviews.listTaskSubmissions(f.actor, {
          roomId: f.roomId,
          taskId: f.taskId,
        }).length,
        0,
      );
      assert.equal(
        f.kernel.files.list(f.actor, { roomId: f.roomId }).files.length,
        0,
      );
      const artifacts = db.prepare("SELECT state FROM room_files").all();
      assert.equal(artifacts.length, 1);
      assert.equal(
        artifacts[0]?.state,
        "failed",
        "existing upload owner must mark interrupted bytes failed, never completed",
      );
      assert.equal(response.status, 401);
      assert.equal(errorCode(await jsonObject(response)), "unauthenticated");
    } finally {
      db.close();
    }
  } finally {
    resume.release();
    await f.close();
  }
});

test("retired managed MCP routes are absent while authenticated Room tools remain usable", async () => {
  assert.ok(WORKER_HTTP_ROUTE_PATHS.every((path) => !path.includes("/mcp/")));
  const f = await fixture();
  try {
    for (const path of ["mcp/tools", "mcp/call"])
      assert.equal((await f.request(path)).status, 404, path);
    const sync = await f.request("sync");
    assert.equal(sync.status, 200);
    assert.equal(
      (await f.request("tasks/get", { taskId: f.taskId })).status,
      200,
    );
    assert.ok(await f.startTask());
  } finally {
    await f.close();
  }
});
