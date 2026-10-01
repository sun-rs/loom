import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { RoomKernel } from "@rah-os/kernel";
import {
  ProfileImageUploadResponseSchema,
  WorkerSelfProfileResponseSchema,
  WorkerSelfProfileUpdateResponseSchema,
  WorkerSyncResponseSchema,
  WorkerTaskMutationResponseSchema,
  WorkerMessageAttachmentUploadSchema,
  WorkerArtifactUploadSchema,
  type RuntimeOffer,
} from "@rah-os/protocol";
import { WorkerApplicationService } from "../src/index.ts";
import { ProfileImageStore } from "../../daemon/src/profile-image-store.ts";
import { uploadWorkerSelfAvatar } from "../src/worker-profile-image-upload.ts";
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-self-profile-api-"));
  const now = new Date("2026-09-01T00:00:00Z");
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now: () => now,
  });
  kernel.initialize();
  const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const bootstrap = kernel.provisionPrincipal({
    handle: "bootstrap",
    kind: "agent",
  });
  const actor = kernel.authenticateAccessToken(owner.accessToken);
  const workspace = kernel.createWorkspace(actor, {
    idempotencyKey: "workspace",
    name: "Profile",
    slug: "profile",
  });
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "test-host",
      participantIds: [bootstrap.principal.principalId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const digest = `sha256:${"a".repeat(64)}`;
  const offer: RuntimeOffer = {
    capacityPoolIds: [],
    capabilityEvidence: [],
    certificationRefs: [],
    hostId: host.hostId,
    hostInstanceId: host.instanceId,
    isolation: { evidence: "declared", level: "none" },
    leaseUntil: "2026-09-01T00:05:00Z",
    maxConcurrent: 1,
    modelBindingDescriptors: [],
    observedAt: now.toISOString(),
    protocolFamily: "rah-worker-process/v1",
    revisionDigest: digest,
    runtimeOfferId: "offer",
    runtimeProfileId: "profile",
    runtimeProfileRevisionId: "profile-v1",
    state: "available",
    supportedToolAccessModes: ["full_access"],
    workspaceMountDescriptors: [
      {
        modes: ["in_place"],
        workspaceDefinitionId: workspace.workspace.workspaceId,
        workspaceMountDigest: digest,
        workspaceMountRevisionId: "mount-v1",
      },
    ],
  };
  kernel.publishRuntimeOffer(host, offer);
  const created = kernel.provisionWorkspaceAgent(actor, {
    basedOnRoomSeq: workspace.event.roomSeq,
    controlRoomId: workspace.controlRoom.roomId,
    displayName: "Alice",
    description: "Original",
    handle: "alice",
    idempotencyKey: "create",
    instructions: "Retain this persona.",
    role: "Assistant",
    modelIntent: { fallback: "disabled" },
    runtimeOfferId: "offer",
  });

  const controlRoomId = workspace.controlRoom.roomId;
  const room = kernel.createWorkspaceRoom(actor, {
    workspaceId: workspace.workspace.workspaceId,
    kind: "channel",
    name: "Work",
    slug: "work",
    visibility: "public",
    basedOnControlRoomSeq: created.event.roomSeq,
    idempotencyKey: "work-room",
    allowInstanceTaskCreation: true,
  }).room;
  kernel.addMember(actor, {
    roomId: room.roomId,
    principalId: created.agent.definition.participantId,
  });
  const db = new DatabaseSync(join(directory, "room.db"));
  const wake = () =>
    kernel.postMessage(actor, {
      roomId: room.roomId,
      body: "Profile work",
      recipients: [
        {
          participantId: created.agent.definition.participantId,
          reason: "mention",
        },
      ],
      idempotencyKey: `wake-${Math.random()}`,
    });
  wake();
  const start = () => {
    const placement = kernel.scheduleNextPlacement({ leaseMs: 120000 });
    assert.ok(placement);
    const launch = kernel.claimNextPlacement(host, { leaseMs: 120000 });
    assert.ok(launch);
    const runtime = {
      runAttemptId: launch.runAttempt.runAttemptId,
      runtimeRunId: `runtime-${launch.runAttempt.runAttemptId}`,
      recoveryDescriptor: {
        driver: "fake",
        metadata: {},
        recoveryKey: `recovery-${launch.runAttempt.runAttemptId}`,
      },
    };
    kernel.prepareRunAttemptRuntime(host, runtime);
    kernel.markRunAttemptRunning(host, runtime);
    const scope = {
      activationId: launch.activation.activationId,
      consumerId: `consumer-${launch.runAttempt.runAttemptId}`,
      hostId: host.hostId,
      participantId: created.agent.definition.participantId,
      roomId: room.roomId,
      runAttemptId: launch.runAttempt.runAttemptId,
      toSeq: launch.activation.toSeq,
    };
    return {
      launch,
      runtime,
      scope,
      execution: kernel.authorizeWorkerExecution(host, scope),
    };
  };
  const run = start();
  const store = new ProfileImageStore({ directory: join(directory, "images") });
  const service = new WorkerApplicationService({
    kernel,
    profileImageStore: store,
  });
  await service.start();
  const credential = service.issueActivationCredential(host, run.scope);
  const call = (
    path: string,
    body: unknown = {},
    token = credential.accessToken,
  ) =>
    fetch(`${service.origin}/v1/worker/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  return {
    directory,
    now,
    kernel,
    db,
    service,
    store,
    host,
    actor,
    created,
    room,
    controlRoomId,
    run,
    credential,
    call,
    wake,
    start,
    async close() {
      await service.close();
      db.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
test("authenticated self profile update keeps distinct control/work Room causality and a live frozen Run", async () => {
  const f = await fixture();
  try {
    const get = await f.call("profile/self/get");
    assert.equal(get.status, 200, await get.clone().text());
    const before = WorkerSelfProfileResponseSchema.parse(await get.json());
    assert.equal(before.writeContext.controlRoomId, f.controlRoomId);
    assert.notEqual(before.writeContext.controlRoomId, f.run.scope.roomId);
    const sync = WorkerSyncResponseSchema.parse(
      await (await f.call("sync")).json(),
    );
    const readRun = () =>
      f.kernel
        .listRunAttempts({ roomId: f.room.roomId })
        .find((run) => run.runAttemptId === f.run.scope.runAttemptId)!;
    const frozen = JSON.stringify(readRun());
    const command = {
      writeContext: before.writeContext,
      idempotencyKey: "self-update",
      patch: { displayName: "Alicia", description: "Updated through Worker" },
    };
    const response = await f.call("profile/self/update", command);
    assert.equal(response.status, 200, await response.clone().text());
    const changed = WorkerSelfProfileUpdateResponseSchema.parse(
      await response.json(),
    );
    assert.equal(changed.profile.displayName, "Alicia");
    assert.equal(
      changed.writeContext.controlRoomSeq,
      before.writeContext.controlRoomSeq + 1,
    );
    assert.equal(JSON.stringify(readRun()), frozen);
    assert.equal(readRun().state, "running");
    assert.equal(
      WorkerSelfProfileUpdateResponseSchema.parse(
        await (await f.call("profile/self/update", command)).json(),
      ).deduplicated,
      true,
    );
    assert.equal(
      (
        await f.call("profile/self/update", {
          ...command,
          idempotencyKey: "stale",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.call("profile/self/update", {
          ...command,
          patch: { displayName: "Other" },
        })
      ).status,
      409,
    );
    assert.equal(
      (await f.call("profile/self/update", { ...command, target: "other" }))
        .status,
      400,
    );
    assert.equal(
      (
        await f.call("profile/self/update", {
          ...command,
          idempotencyKey: "wrong-room",
          writeContext: {
            ...changed.writeContext,
            controlRoomId: f.room.roomId,
          },
        })
      ).status,
      403,
    );
    const wrongWrite = await f.call("messages/post", {
      body: "No cross-frontier",
      threadId: null,
      basedOnRoomSeq: changed.writeContext.controlRoomSeq,
      idempotencyKey: "wrong-frontier",
    });
    assert.equal(wrongWrite.status, 409);
    const posted = await f.call("messages/post", {
      body: "Still running after self update",
      threadId: null,
      basedOnRoomSeq: f.run.scope.toSeq,
      idempotencyKey: "live-after-update",
    });
    assert.equal(posted.status, 200, await posted.clone().text());
    assert.equal(
      (await f.call("acknowledge", { throughSeq: sync.cursorAfter })).status,
      200,
    );
    f.kernel.recordRuntimeTermination(f.host, {
      runAttemptId: f.run.scope.runAttemptId,
      runtimeRunId: f.run.runtime.runtimeRunId,
      exit: { code: 0 },
    });
    f.kernel.finishRunAttempt(f.host, {
      runAttemptId: f.run.scope.runAttemptId,
      state: "exited",
      exitCode: 0,
    });
    f.kernel.completeActivation(f.host, {
      activationId: f.run.scope.activationId,
      consumerId: f.run.scope.consumerId,
    });
    assert.equal((await f.call("profile/self/get")).status, 409);
    f.wake();
    const next = f.start();
    assert.equal(
      next.launch.agentContext.agentDefinitionRevision.displayName,
      "Alicia",
    );
    assert.equal(
      next.launch.agentContext.agentDefinitionRevision.memoryPolicyRef
        .artifactId,
      f.run.launch.agentContext.agentDefinitionRevision.memoryPolicyRef
        .artifactId,
    );
    assert.equal(
      f.run.launch.agentContext.agentDefinitionRevision.displayName,
      "Alice",
    );
  } finally {
    await f.close();
  }
});

test("the minimal profile update carries no write context and still fails a concurrent change", async () => {
  const f = await fixture();
  try {
    // Raft's `profile update` sends the patch alone.
    const observed = WorkerSelfProfileResponseSchema.parse(
      await (await f.call("profile/self/get")).json(),
    );
    const minimal = await f.call("profile/self/update", {
      patch: { displayName: "Minimal" },
    });
    assert.equal(minimal.status, 200, await minimal.clone().text());
    const changed = WorkerSelfProfileUpdateResponseSchema.parse(
      await minimal.json(),
    );
    assert.equal(changed.profile.displayName, "Minimal");
    assert.equal(
      changed.writeContext.controlRoomSeq,
      observed.writeContext.controlRoomSeq + 1,
    );
    // An identical retry is one logical update.
    const retried = WorkerSelfProfileUpdateResponseSchema.parse(
      await (
        await f.call("profile/self/update", {
          patch: { displayName: "Minimal" },
        })
      ).json(),
    );
    assert.equal(retried.deduplicated, true);
    // A genuinely different patch is a different update.
    const second = await f.call("profile/self/update", {
      patch: { description: "Second change" },
    });
    assert.equal(second.status, 200, await second.clone().text());

    // Optimistic concurrency is unchanged: this Run observed a revision, and a
    // profile change committed by somebody else afterwards still conflicts.
    const current = WorkerSelfProfileResponseSchema.parse(
      await (await f.call("profile/self/get")).json(),
    );
    f.kernel.manageWorkspaceAgent(f.actor, {
      action: "update_profile",
      agentId: f.created.agent.definition.agentId,
      basedOnRoomSeq: current.writeContext.controlRoomSeq,
      expectedRevisionId: current.writeContext.expectedRevisionId,
      field: "displayName",
      idempotencyKey: "human-edit",
      value: "Edited elsewhere",
    });
    const conflicted = await f.call("profile/self/update", {
      patch: { displayName: "Racing update" },
    });
    assert.equal(conflicted.status, 409, await conflicted.clone().text());
  } finally {
    await f.close();
  }
});

test("avatar byte ingestion rechecks revoked execution before recording an intent or returning a receipt", async () => {
  const f = await fixture();
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=",
    "base64",
  );
  try {
    const count = () =>
      f.db
        .prepare("SELECT COUNT(*) AS n FROM profile_image_upload_intents")
        .get()!.n;
    const before = count();
    await assert.rejects(
      uploadWorkerSelfAvatar({
        profiles: f.kernel.workerSelfProfile,
        execution: () => f.run.execution,
        store: f.store,
        mimeType: "image/png",
        chunks: (async function* () {
          yield bytes;
          f.kernel.recordRuntimeTermination(f.host, {
            runAttemptId: f.run.scope.runAttemptId,
            runtimeRunId: f.run.runtime.runtimeRunId,
            exit: { code: 0 },
          });
          f.kernel.finishRunAttempt(f.host, {
            runAttemptId: f.run.scope.runAttemptId,
            state: "exited",
            exitCode: 0,
          });
        })(),
      }),
    );
    assert.equal(count(), before);
    assert.deepEqual(f.store.inventory(), []);
  } finally {
    await f.close();
  }
});

test("avatar upload reauthenticates a revoked bearer after the real store finishes and leaves unbound bytes to GC", async () => {
  const f = await fixture();
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=",
    "base64",
  );
  let revoke = () => {};
  const service = new WorkerApplicationService({
    kernel: f.kernel,
    profileImageStore: {
      async upload(mime, chunks, record) {
        const uploaded = await f.store.upload(mime, chunks, record);
        revoke();
        return uploaded;
      },
    },
  });
  try {
    await service.start();
    const credential = service.issueActivationCredential(f.host, f.run.scope);
    revoke = credential.revoke;
    const response = await fetch(
      `${service.origin}/v1/worker/profile/self/avatar`,
      {
        method: "PUT",
        body: bytes,
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "content-type": "image/png",
        },
      },
    );
    assert.equal(response.status, 401, await response.clone().text());
    assert.equal(f.store.inventory().length, 1);
    assert.equal(
      f.db
        .prepare("SELECT COUNT(*) AS n FROM profile_image_upload_intents")
        .get()!.n,
      1,
    );
    f.now.setTime(f.now.getTime() + 16 * 60000);
    assert.equal(
      f.kernel.profileImages.reconcile({
        limit: 50,
        reclaimBlob: (key) => f.store.reclaim(key),
      }).reclaimed,
      1,
    );
    assert.deepEqual(f.store.inventory(), []);
  } finally {
    await service.close();
    await f.close();
  }
});

test("Worker avatar uploads real image bytes, binds only its own intent and leaves failed-CAS uploads for existing GC", async () => {
  const f = await fixture();
  try {
    const before = WorkerSelfProfileResponseSchema.parse(
      await (await f.call("profile/self/get")).json(),
    );
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=",
      "base64",
    );
    const upload = () =>
      fetch(`${f.service.origin}/v1/worker/profile/self/avatar`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${f.credential.accessToken}`,
          "content-type": "image/png",
        },
        body: bytes,
      });
    const result = await upload();
    assert.equal(result.status, 200, await result.clone().text());
    const image = ProfileImageUploadResponseSchema.parse(await result.json());
    const stored = f.store.read(image.avatarKey);
    const parts = [];
    for await (const chunk of stored.stream) parts.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(parts), bytes);
    const patch = {
      avatarKey: image.avatarKey,
      avatarUploadIntentId: image.uploadIntentId,
    };
    const changed = await f.call("profile/self/update", {
      writeContext: before.writeContext,
      idempotencyKey: "avatar",
      patch,
    });
    assert.equal(changed.status, 200, await changed.clone().text());
    assert.equal(
      WorkerSelfProfileUpdateResponseSchema.parse(await changed.json()).profile
        .avatarKey,
      image.avatarKey,
    );
    const invalid = await fetch(
      `${f.service.origin}/v1/worker/profile/self/avatar`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${f.credential.accessToken}`,
          "content-type": "image/png",
        },
        body: "not a PNG",
      },
    );
    assert.notEqual(invalid.status, 200);
    const otherBytes = Buffer.concat([bytes, Buffer.from("unbound")]);
    const unbound = ProfileImageUploadResponseSchema.parse(
      await (
        await fetch(`${f.service.origin}/v1/worker/profile/self/avatar`, {
          method: "PUT",
          headers: {
            authorization: `Bearer ${f.credential.accessToken}`,
            "content-type": "image/png",
          },
          body: otherBytes,
        })
      ).json(),
    );
    assert.equal(
      (
        await f.call("profile/self/update", {
          writeContext: before.writeContext,
          idempotencyKey: "stale-avatar",
          patch: {
            avatarKey: unbound.avatarKey,
            avatarUploadIntentId: unbound.uploadIntentId,
          },
        })
      ).status,
      409,
    );
    f.now.setTime(f.now.getTime() + 16 * 60000);
    const swept = f.kernel.profileImages.reconcile({
      limit: 50,
      reclaimBlob: (key) => f.store.reclaim(key),
    });
    assert.ok(swept.reclaimed >= 1);
    assert.throws(() => f.store.read(unbound.avatarKey));
    assert.doesNotThrow(() => f.store.read(image.avatarKey).stream.destroy());
  } finally {
    await f.close();
  }
});

test("revoking the bearer while JSON awaits its final body chunk rejects metadata before any canonical mutation", async () => {
  const f = await fixture();
  try {
    const before = WorkerSelfProfileResponseSchema.parse(
      await (await f.call("profile/self/get")).json(),
    );
    const count = () =>
      f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM room_events WHERE type='agent.profile_updated'",
        )
        .get()!.n;
    const initial = count();
    const body = JSON.stringify({
      writeContext: before.writeContext,
      idempotencyKey: "revoked-json",
      patch: { displayName: "Must not commit" },
    });
    let request!: ReturnType<typeof httpRequest>;
    let ready!: () => void;
    const awaitingBody = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const completed = new Promise<{ status: number | undefined; body: string }>(
      (resolve, reject) => {
        request = httpRequest(
          `${f.service.origin}/v1/worker/profile/self/update`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${f.credential.accessToken}`,
              "content-type": "application/json",
              expect: "100-continue",
            },
          },
          (response) => {
            let text = "";
            response.on("data", (chunk) => {
              text += String(chunk);
            });
            response.on("end", () =>
              resolve({ status: response.statusCode, body: text }),
            );
          },
        );
        request.on("error", reject);
        request.on("continue", ready);
      },
    );
    request.flushHeaders();
    await awaitingBody;
    request.write(body.slice(0, -1));
    f.credential.revoke();
    request.end(body.slice(-1));
    const response = await completed;
    assert.equal(response.status, 401, response.body);
    assert.equal(count(), initial);
    assert.equal(
      f.kernel.getWorkspaceAgentManagementView(f.actor, before.profile.agentId)
        .agent.currentRevision.displayName,
      before.profile.displayName,
    );
  } finally {
    await f.close();
  }
});

for (const mode of ["attachments", "artifacts"] as const)
  test(`${mode} PUT rejects a bearer revoked while body is incomplete, keeps Run alive, and removes partial bytes`, async () => {
    const f = await fixture();
    try {
      let extra: { taskId?: string } = {};
      if (mode === "artifacts") {
        const synced = WorkerSyncResponseSchema.parse(
          await (await f.call("sync")).json(),
        );
        const madeResponse = await f.call("tasks/create", {
          basedOnRoomSeq: synced.cursorAfter,
          idempotencyKey: "upload-task",
          title: "Upload evidence",
          assigneeId: f.run.scope.participantId,
        });
        assert.equal(
          madeResponse.status,
          200,
          await madeResponse.clone().text(),
        );
        const made = WorkerTaskMutationResponseSchema.parse(
          await madeResponse.json(),
        );
        const started = await f.call("tasks/start", {
          taskId: made.task.taskId,
          basedOnRoomSeq: made.event.roomSeq,
          idempotencyKey: "upload-start",
        });
        assert.equal(started.status, 200, await started.clone().text());
        extra = { taskId: made.task.taskId };
      }
      const preparedResponse = await f.call(`${mode}/prepare`, {
        filename: "revoke.txt",
        mimeType: "text/plain",
        size: 6,
        idempotencyKey: "upload-reservation",
        ...extra,
      });
      assert.equal(
        preparedResponse.status,
        200,
        await preparedResponse.clone().text(),
      );
      const prepared = (
        mode === "artifacts"
          ? WorkerArtifactUploadSchema
          : WorkerMessageAttachmentUploadSchema
      ).parse(await preparedResponse.json());
      let request!: ReturnType<typeof httpRequest>;
      const continued = Promise.withResolvers<void>();
      const response = new Promise<{
        status: number | undefined;
        body: string;
      }>((resolve, reject) => {
        request = httpRequest(
          `${f.service.origin}/v1/worker/${mode}/${prepared.attachmentId}`,
          {
            method: "PUT",
            headers: {
              authorization: `Bearer ${f.credential.accessToken}`,
              "content-type": "application/octet-stream",
              expect: "100-continue",
            },
          },
          (r) => {
            let text = "";
            r.on("data", (chunk) => {
              text += String(chunk);
            });
            r.on("end", () => resolve({ status: r.statusCode, body: text }));
          },
        );
        request.on("error", reject);
        request.on("continue", () => continued.resolve());
      });
      request.flushHeaders();
      await continued.promise;
      request.write("abc");
      f.credential.revoke();
      request.end("def");
      const result = await response;
      assert.equal(result.status, 401, result.body);
      assert.equal(
        f.db
          .prepare("SELECT state FROM room_files WHERE attachment_id=?")
          .get(prepared.attachmentId)!.state,
        "failed",
      );
      assert.equal(
        existsSync(join(f.directory, "room-files", prepared.attachmentId)),
        false,
      );
      assert.equal(
        existsSync(
          join(f.directory, "room-files", `${prepared.attachmentId}.part`),
        ),
        false,
      );
      assert.equal(
        f.kernel
          .listRunAttempts({ roomId: f.room.roomId })
          .find((run) => run.runAttemptId === f.run.scope.runAttemptId)?.state,
        "running",
      );
    } finally {
      await f.close();
    }
  });

test("RoomFiles rechecks facade authority after the final rename and cleans bytes before marking completed", async () => {
  const f = await fixture();
  try {
    const prepared = f.kernel.files.prepareWorkerMessage(f.run.execution, {
      filename: "last-window.txt",
      mimeType: "text/plain",
      size: 3,
      idempotencyKey: "final-rename",
    });
    let checks = 0;
    await assert.rejects(
      f.kernel.files.uploadWorkerMessage(
        f.run.execution,
        prepared.attachmentId,
        (async function* () {
          yield Buffer.from("abc");
        })(),
        () => {
          checks += 1;
          if (checks === 3) throw new Error("revoked after final rename");
        },
      ),
      /revoked after final rename/u,
    );
    assert.equal(checks, 3);
    assert.equal(
      f.db
        .prepare("SELECT state FROM room_files WHERE attachment_id=?")
        .get(prepared.attachmentId)!.state,
      "failed",
    );
    assert.equal(
      existsSync(join(f.directory, "room-files", prepared.attachmentId)),
      false,
    );
    assert.equal(
      existsSync(
        join(f.directory, "room-files", `${prepared.attachmentId}.part`),
      ),
      false,
    );
  } finally {
    await f.close();
  }
});
