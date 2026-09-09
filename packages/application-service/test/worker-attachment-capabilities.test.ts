import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { RoomKernel } from "@rah-os/kernel";
import * as P from "@rah-os/protocol";
import { WorkerApplicationService } from "../src/index.ts";

test("upload capabilities match real reservation limits through authenticated HTTP and a real Worker CLI child", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-read-api-"));
  const now = new Date("2026-09-08T12:00:00.000Z");
  const kernel = new RoomKernel({
    databasePath: join(dir, "room.db"),
    now: () => now,
  });
  const service = new WorkerApplicationService({ kernel });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
    const agent = kernel.provisionPrincipal({
      handle: "reader",
      kind: "agent",
    });
    const actor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(actor, {
      name: "Read API",
      slug: "read-api",
    });
    kernel.addMember(actor, {
      roomId: room.roomId,
      principalId: agent.principal.principalId,
    });
    const task = kernel.createTask(actor, {
      roomId: room.roomId,
      title: "Earlier task",
      collaboratorIds: [],
      reviewerIds: [],
      dependencyTaskIds: [],
      idempotencyKey: "task",
    });
    kernel.postMessage(actor, {
      roomId: room.roomId,
      body: "Read old tasks",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      idempotencyKey: "wake",
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "host",
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
      runtimeRunId: "runtime",
      recoveryDescriptor: {
        driver: "fake",
        metadata: {},
        recoveryKey: "runtime",
      },
    };
    kernel.prepareRunAttemptRuntime(host, runtime);
    kernel.markRunAttemptRunning(host, runtime);
    await service.start();
    const credential = service.issueActivationCredential(host, {
      activationId: activation.activationId,
      consumerId: "reader",
      hostId: host.hostId,
      participantId: agent.principal.principalId,
      roomId: room.roomId,
      runAttemptId: run.runAttemptId,
      toSeq: activation.toSeq,
    });
    const call = (path: string, body: unknown = {}) =>
      fetch(`${service.origin}/v1/worker/${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const result = await call("attachments/capabilities");
    assert.equal(result.status, 200, await result.clone().text());
    const capabilities =
      P.WorkerAttachmentUploadCapabilitiesResponseSchema.parse(
        await result.json(),
      );
    assert.deepEqual(capabilities, {
      directUploadEnabled: false,
      directUploadThresholdBytes: null,
      maxBytes: P.MAX_ATTACHMENT_BYTES,
      sessionExpiresInSeconds: 3600,
    });
    const db = new DatabaseSync(join(dir, "room.db"));
    try {
      assert.equal(
        db.prepare("SELECT COUNT(*) AS n FROM room_files").get()!.n,
        0,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS n FROM subscription_cursors").get()!.n,
        0,
      );
    } finally {
      db.close();
    }
    assert.equal(
      (await call("acknowledge", { throughSeq: activation.toSeq })).status,
      409,
    );
    assert.equal(
      (await call("attachments/capabilities", { roomId: "foreign" })).status,
      400,
    );
    assert.equal(
      (
        await call("attachments/capabilities", {
          actorId: human.principal.principalId,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${service.origin}/v1/worker/attachments/capabilities`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
      401,
    );

    const session = join(dir, "worker-session");
    writeFileSync(session, credential.accessToken, { mode: 0o600 });
    const module = new URL(
      "../../agent-host/src/worker-cli.ts",
      import.meta.url,
    ).href;
    const cli = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { runWorkerCliCommand } from ${JSON.stringify(module)}; process.exitCode = await runWorkerCliCommand(process.argv.slice(1));`,
        "worker",
        "attachment-capabilities",
      ],
      {
        cwd: fileURLToPath(new URL("../../..", import.meta.url)),
        env: {
          ...process.env,
          RAH_ACTIVATION_ID: activation.activationId,
          RAH_WORKER_API_URL: service.origin,
          RAH_WORKER_SESSION_FILE: session,
        },
        timeout: 15000,
      },
    );
    // The command has no Raft counterpart, so it renders in the same house
    // style rather than answering in JSON.
    assert.equal(
      cli.stdout.trimEnd(),
      [
        `Attachment uploads: at most ${capabilities.maxBytes} bytes per file.`,
        `A reservation expires ${capabilities.sessionExpiresInSeconds} second(s) after it is created.`,
        "Direct upload is disabled: bytes go to the local daemon upload path, and there is no direct-upload threshold.",
      ].join("\n"),
    );
    const prepare = {
      filename: "ceiling.txt",
      mimeType: "text/plain",
      size: capabilities.maxBytes,
      idempotencyKey: "at-ceiling",
    };
    const reserved = await call("attachments/prepare", prepare);
    assert.equal(reserved.status, 200, await reserved.clone().text());
    const upload = P.WorkerMessageAttachmentUploadSchema.parse(
      await reserved.json(),
    );
    assert.equal(
      Date.parse(upload.expiresAt) - now.getTime(),
      capabilities.sessionExpiresInSeconds * 1000,
    );
    assert.equal(
      (
        await call("attachments/prepare", {
          ...prepare,
          size: capabilities.maxBytes + 1,
          idempotencyKey: "over-ceiling",
        })
      ).status,
      400,
    );

    const observer = new DatabaseSync(join(dir, "room.db"));
    try {
      observer
        .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
        .run(room.roomId, agent.principal.principalId);
    } finally {
      observer.close();
    }
    assert.equal((await call("attachments/capabilities")).status, 403);
    credential.revoke();
    assert.equal((await call("attachments/capabilities")).status, 401);
  } finally {
    await service.close();
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
