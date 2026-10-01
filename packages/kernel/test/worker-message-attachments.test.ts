import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach } from "node:test";

import {
  AuthenticatedHostContext,
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  RoomKernel,
} from "../src/index.ts";
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { force: true, recursive: true });
  }
});

function createClock(initial = "2026-08-25T00:00:00.000Z") {
  let now = new Date(initial).getTime();
  return {
    now: () => new Date(now),
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-kernel-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "room.db");
  const clock = createClock();
  const kernel = new RoomKernel({ databasePath, now: clock.now });
  kernel.initialize();

  const humanProvisioning = kernel.provisionPrincipal({
    handle: "sun",
    kind: "human",
  });
  const agentProvisioning = kernel.provisionPrincipal({
    handle: "codex",
    kind: "agent",
  });
  const otherAgentProvisioning = kernel.provisionPrincipal({
    handle: "opencode",
    kind: "agent",
  });
  const human = humanProvisioning.principal;
  const agent = agentProvisioning.principal;
  const otherAgent = otherAgentProvisioning.principal;
  const humanActor = kernel.authenticateAccessToken(
    humanProvisioning.accessToken,
  );
  const agentActor = kernel.authenticateAccessToken(
    agentProvisioning.accessToken,
  );
  const otherAgentActor = kernel.authenticateAccessToken(
    otherAgentProvisioning.accessToken,
  );
  const room = kernel.createRoom(humanActor, {
    name: "Kernel test",
    slug: "kernel-test",
  });
  kernel.addMember(humanActor, {
    principalId: agent.principalId,
    roomId: room.roomId,
  });
  kernel.addMember(humanActor, {
    principalId: otherAgent.principalId,
    roomId: room.roomId,
  });

  return {
    agent,
    agentActor,
    clock,
    databasePath,
    human,
    humanAccessToken: humanProvisioning.accessToken,
    humanActor,
    kernel,
    otherAgent,
    otherAgentActor,
    room,
  };
}

function authenticateHost(
  kernel: RoomKernel,
  hostId: string,
  participantIds: string[],
): AuthenticatedHostContext {
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({ hostId, participantIds }).accessToken,
  );
  kernel.heartbeatHost(host);
  return host;
}

function startWorkerExecution(
  kernel: RoomKernel,
  label: string,
  participantId: string,
  roomId: string,
) {
  const host = authenticateHost(kernel, `${label}-host`, [participantId]);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 7_200_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, host, {
    recoveryDescriptor: fakeRecovery(`${label}-runtime`),
    runAttemptId: run.runAttemptId,
    runtimeRunId: `${label}-runtime`,
  });
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: `${label}-consumer`,
    hostId: host.hostId,
    participantId,
    roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const delivery = kernel.syncWorker(execution, {});
  kernel.acknowledgeWorkerCursor(execution, {
    throughSeq: delivery.cursorAfter,
  });
  return { activation, execution, host };
}

function fakeRecovery(recoveryKey: string) {
  return {
    driver: "fake-runtime",
    metadata: {},
    recoveryKey,
  };
}

function prepareAndMarkRunAttemptRunning(
  kernel: RoomKernel,
  host: AuthenticatedHostContext,
  input: Parameters<RoomKernel["markRunAttemptRunning"]>[1],
): void {
  kernel.prepareRunAttemptRuntime(host, input);
  kernel.markRunAttemptRunning(host, input);
}

async function* bytes(value: string) {
  yield Buffer.from(value);
}
function attachmentExecution() {
  const f = createFixture();
  f.kernel.postMessage(f.humanActor, {
    roomId: f.room.roomId,
    body: "Share a discussion file",
    recipients: [{ participantId: f.agent.principalId, reason: "mention" }],
    idempotencyKey: "wake",
  });
  const run = startWorkerExecution(
    f.kernel,
    "file",
    f.agent.principalId,
    f.room.roomId,
  );
  return { ...f, ...run };
}

test("discussion attachments publish actual bytes without creating a Task and replay once", async () => {
  const f = attachmentExecution();
  try {
    const command = {
      filename: "notes.txt",
      mimeType: "text/plain",
      size: 5,
      idempotencyKey: "file",
    };
    const prepared = f.kernel.files.prepareWorkerMessage(f.execution, command);
    assert.equal(prepared.state, "pending");
    assert.deepEqual(
      f.kernel.files.prepareWorkerMessage(f.execution, command),
      prepared,
    );
    const completed = await f.kernel.files.uploadWorkerMessage(
      f.execution,
      prepared.attachmentId,
      bytes("hello"),
    );
    assert.equal(completed.state, "completed");
    assert.equal(
      f.kernel.files.prepareWorkerMessage(f.execution, command).sha256,
      completed.sha256,
    );
    await assert.rejects(
      f.kernel.files.downloadWorkerTaskArtifact(
        f.execution,
        prepared.attachmentId,
      ),
      /not attached/,
    );
    const post = {
      body: "Discussion evidence",
      attachmentIds: [prepared.attachmentId],
      threadId: null,
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "publish",
    };
    const sent = f.kernel.postWorkerMessage(f.execution, post);
    assert.ok("event" in sent);
    assert.equal(
      (sent.event.payload.attachments as Array<{ sha256: string }>)[0]?.sha256,
      completed.sha256,
    );
    assert.equal(
      f.kernel.listTasks(f.humanActor, { roomId: f.room.roomId }).length,
      0,
    );
    assert.deepEqual(f.kernel.postWorkerMessage(f.execution, post), {
      ...sent,
      activationIds: [],
      deduplicated: true,
    });
    const download = await f.kernel.files.downloadWorkerTaskArtifact(
      f.execution,
      prepared.attachmentId,
    );
    const chunks = [];
    for await (const chunk of download.stream) chunks.push(Buffer.from(chunk));
    assert.equal(Buffer.concat(chunks).toString(), "hello");
    assert.equal(
      f.kernel.files.list(f.humanActor, { roomId: f.room.roomId }).files[0]
        ?.messageId,
      sent.event.aggregateId,
    );
    assert.throws(
      () =>
        f.kernel.files.cancelWorkerMessage(f.execution, {
          attachmentId: prepared.attachmentId,
        }),
      /sent files/,
    );
  } finally {
    f.kernel.close();
  }
});

test("discussion upload failure, cancellation, expiry and Task artifact boundaries stay enforced", async () => {
  const f = attachmentExecution();
  try {
    const input = {
      filename: "x.txt",
      mimeType: "text/plain",
      size: 5,
      idempotencyKey: "bad",
    };
    const failed = f.kernel.files.prepareWorkerMessage(f.execution, input);
    await assert.rejects(
      f.kernel.files.uploadWorkerMessage(
        f.execution,
        failed.attachmentId,
        bytes("wrong length"),
      ),
      /size/,
    );
    assert.equal(
      f.kernel.files.prepareWorkerMessage(f.execution, input).state,
      "failed",
    );
    const canceled = f.kernel.files.prepareWorkerMessage(f.execution, {
      ...input,
      idempotencyKey: "cancel",
    });
    assert.equal(
      f.kernel.files.cancelWorkerMessage(f.execution, {
        attachmentId: canceled.attachmentId,
      }).state,
      "canceled",
    );
    assert.equal(
      f.kernel.files.cancelWorkerMessage(f.execution, {
        attachmentId: canceled.attachmentId,
      }).state,
      "canceled",
    );
    await assert.rejects(
      f.kernel.files.uploadWorkerMessage(
        f.execution,
        canceled.attachmentId,
        bytes("hello"),
      ),
      /pending/,
    );
    const pending = f.kernel.files.prepareWorkerMessage(f.execution, {
      ...input,
      idempotencyKey: "pending",
    });
    await assert.rejects(
      f.kernel.files.uploadWorker(
        f.execution,
        pending.attachmentId,
        bytes("hello"),
      ),
      ForbiddenError,
    );
    assert.throws(
      () =>
        f.kernel.postWorkerMessage(f.execution, {
          body: "Not sent",
          attachmentIds: [pending.attachmentId],
          basedOnRoomSeq: f.activation.toSeq,
          idempotencyKey: "not-completed",
        }),
      /completed/,
    );
    const humanFile = f.kernel.files.prepare(f.humanActor, {
      ...input,
      roomId: f.room.roomId,
      idempotencyKey: "human",
    });
    await assert.rejects(
      f.kernel.files.uploadWorkerMessage(
        f.execution,
        humanFile.attachmentId,
        bytes("hello"),
      ),
      ForbiddenError,
    );
    const injected = { ...input, roomId: "foreign" };
    assert.throws(
      () => f.kernel.files.prepareWorkerMessage(f.execution, injected),
      /unrecognized|Unrecognized/,
    );
  } finally {
    f.kernel.close();
  }
});

test("a held discussion draft retains its published-intent attachments through rehold and send-anyway", async () => {
  const f = attachmentExecution();
  try {
    const file = f.kernel.files.prepareWorkerMessage(f.execution, {
      filename: "held.txt",
      mimeType: "text/plain",
      size: 5,
      idempotencyKey: "file",
    });
    await f.kernel.files.uploadWorkerMessage(
      f.execution,
      file.attachmentId,
      bytes("hello"),
    );
    f.kernel.postMessage(f.humanActor, {
      roomId: f.room.roomId,
      body: "Newer context",
      recipients: [{ participantId: f.agent.principalId, reason: "mention" }],
      idempotencyKey: "newer",
    });
    const held = f.kernel.postWorkerMessage(f.execution, {
      body: "Draft",
      attachmentIds: [file.attachmentId],
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "draft",
    });
    assert.ok("heldDraftId" in held);
    await assert.rejects(
      f.kernel.files.downloadWorkerTaskArtifact(f.execution, file.attachmentId),
      /not attached/,
    );
    const reheld = f.kernel.postWorkerMessage(f.execution, {
      sendDraft: true,
      heldDraftId: held.heldDraftId,
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "rehold",
    });
    assert.ok("heldDraftId" in reheld);
    const sent = f.kernel.postWorkerMessage(f.execution, {
      sendDraft: true,
      anyway: true,
      heldDraftId: reheld.heldDraftId,
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "send-anyway",
    });
    assert.ok("event" in sent);
    assert.equal(
      (sent.event.payload.attachments as Array<{ attachmentId: string }>)[0]
        ?.attachmentId,
      file.attachmentId,
    );
    assert.equal(
      f.kernel.files.list(f.humanActor, { roomId: f.room.roomId }).files.length,
      1,
    );
  } finally {
    f.kernel.close();
  }
});

test("held attachment receipts replay after cancellation without republishing or changing intent", async () => {
  const f = attachmentExecution();
  try {
    const file = f.kernel.files.prepareWorkerMessage(f.execution, {
      filename: "canceled-held.txt",
      mimeType: "text/plain",
      size: 5,
      idempotencyKey: "file",
    });
    await f.kernel.files.uploadWorkerMessage(
      f.execution,
      file.attachmentId,
      bytes("hello"),
    );
    f.kernel.postMessage(f.humanActor, {
      roomId: f.room.roomId,
      body: "Newer context",
      recipients: [{ participantId: f.agent.principalId, reason: "mention" }],
      idempotencyKey: "newer",
    });
    const command = {
      body: "Draft",
      attachmentIds: [file.attachmentId],
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "draft",
    };
    const held = f.kernel.postWorkerMessage(f.execution, command);
    assert.ok("heldDraftId" in held);
    f.kernel.files.cancelWorkerMessage(f.execution, {
      attachmentId: file.attachmentId,
    });
    assert.deepEqual(f.kernel.postWorkerMessage(f.execution, command), held);
    assert.throws(
      () =>
        f.kernel.postWorkerMessage(f.execution, {
          ...command,
          attachmentIds: [],
        }),
      IdempotencyConflictError,
    );
    assert.throws(
      () =>
        f.kernel.postWorkerMessage(f.execution, {
          sendDraft: true,
          heldDraftId: held.heldDraftId,
          basedOnRoomSeq: f.activation.toSeq,
          idempotencyKey: "cannot-send-canceled",
        }),
      /completed/,
    );
    assert.equal(
      f.kernel.files.list(f.humanActor, { roomId: f.room.roomId }).files.length,
      0,
    );
  } finally {
    f.kernel.close();
  }
});

test("expired discussion bytes are reclaimed and a failed message transaction never consumes files", async () => {
  const f = attachmentExecution();
  try {
    const input = {
      filename: "roll.txt",
      mimeType: "text/plain",
      size: 5,
      idempotencyKey: "file",
    };
    const file = f.kernel.files.prepareWorkerMessage(f.execution, input);
    await f.kernel.files.uploadWorkerMessage(
      f.execution,
      file.attachmentId,
      bytes("hello"),
    );
    const db = new DatabaseSync(f.databasePath);
    db.exec(
      "CREATE TRIGGER reject_file_event BEFORE INSERT ON room_events WHEN NEW.idempotency_key='fault' BEGIN SELECT RAISE(ABORT,'test atomic rollback'); END;",
    );
    const post = {
      body: "File",
      attachmentIds: [file.attachmentId],
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "fault",
    };
    assert.throws(
      () => f.kernel.postWorkerMessage(f.execution, post),
      /test atomic rollback/,
    );
    assert.equal(
      db
        .prepare("SELECT state FROM room_files WHERE attachment_id=?")
        .get(file.attachmentId)?.state,
      "completed",
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM room_events WHERE idempotency_key='fault'",
        )
        .get()?.n,
      0,
    );
    db.exec("DROP TRIGGER reject_file_event");
    const sent = f.kernel.postWorkerMessage(f.execution, post);
    assert.ok("event" in sent);
    const expiring = f.kernel.files.prepareWorkerMessage(f.execution, {
      ...input,
      idempotencyKey: "expires",
    });
    await f.kernel.files.uploadWorkerMessage(
      f.execution,
      expiring.attachmentId,
      bytes("hello"),
    );
    f.clock.advance(3_600_001);
    assert.equal(
      f.kernel.files.prepareWorkerMessage(f.execution, {
        ...input,
        idempotencyKey: "expires",
      }).state,
      "expired",
    );
    assert.equal(
      db
        .prepare(
          "SELECT storage_reclaimed FROM room_files WHERE attachment_id=?",
        )
        .get(expiring.attachmentId)?.storage_reclaimed,
      1,
    );
    assert.equal(
      db
        .prepare(
          "SELECT state,storage_reclaimed FROM room_files WHERE attachment_id=?",
        )
        .get(file.attachmentId)?.state,
      "consumed",
    );
    db.close();
  } finally {
    f.kernel.close();
  }
});

test("ordinary message publication cannot consume a Task evidence reservation", async () => {
  const f = attachmentExecution();
  try {
    const task = f.kernel.createWorkerTask(f.execution, {
      title: "Durable work",
      assigneeId: f.agent.principalId,
      basedOnRoomSeq: f.activation.toSeq,
      leaseMs: 30000,
      idempotencyKey: "task",
    });
    f.kernel.startTask(f.execution, {
      taskId: task.task.taskId,
      basedOnRoomSeq: task.event.roomSeq,
      leaseMs: 30000,
      idempotencyKey: "start",
    });
    const artifact = f.kernel.files.prepareWorker(f.execution, {
      taskId: task.task.taskId,
      filename: "task.txt",
      mimeType: "text/plain",
      size: 5,
      idempotencyKey: "task-file",
    });
    await assert.rejects(
      f.kernel.files.uploadWorkerMessage(
        f.execution,
        artifact.attachmentId,
        bytes("hello"),
      ),
      ForbiddenError,
    );
    await f.kernel.files.uploadWorker(
      f.execution,
      artifact.attachmentId,
      bytes("hello"),
    );
    assert.throws(
      () =>
        f.kernel.postWorkerMessage(f.execution, {
          body: "Bypass submission",
          attachmentIds: [artifact.attachmentId],
          basedOnRoomSeq: f.activation.toSeq,
          idempotencyKey: "bypass",
        }),
      ForbiddenError,
    );
    assert.throws(
      () =>
        f.kernel.files.cancelWorkerMessage(f.execution, {
          attachmentId: artifact.attachmentId,
        }),
      ForbiddenError,
    );
  } finally {
    f.kernel.close();
  }
});

test("membership revocation during a discussion upload prevents completion and leaves no published file", async () => {
  const f = attachmentExecution();
  try {
    const upload = f.kernel.files.prepareWorkerMessage(f.execution, {
      filename: "revoked.txt",
      mimeType: "text/plain",
      size: 5,
      idempotencyKey: "revoked",
    });
    const db = new DatabaseSync(f.databasePath);
    async function* revokedBytes() {
      yield Buffer.from("he");
      db.prepare(
        "DELETE FROM memberships WHERE room_id=? AND principal_id=?",
      ).run(f.room.roomId, f.agent.principalId);
      yield Buffer.from("llo");
    }
    await assert.rejects(
      f.kernel.files.uploadWorkerMessage(
        f.execution,
        upload.attachmentId,
        revokedBytes(),
      ),
      ForbiddenError,
    );
    assert.equal(
      db
        .prepare("SELECT state FROM room_files WHERE attachment_id=?")
        .get(upload.attachmentId)?.state,
      "failed",
    );
    assert.equal(
      f.kernel.files.list(f.humanActor, { roomId: f.room.roomId }).files.length,
      0,
    );
    db.close();
  } finally {
    f.kernel.close();
  }
});

test("an explicit revision retains attachments and replays without republishing", async () => {
  const f = attachmentExecution();
  try {
    const file = f.kernel.files.prepareWorkerMessage(f.execution, {
      filename: "held.txt",
      mimeType: "text/plain",
      size: 5,
      idempotencyKey: "file",
    });
    await f.kernel.files.uploadWorkerMessage(
      f.execution,
      file.attachmentId,
      bytes("hello"),
    );
    f.kernel.postMessage(f.humanActor, {
      roomId: f.room.roomId,
      body: "Newer context",
      recipients: [{ participantId: f.agent.principalId, reason: "mention" }],
      idempotencyKey: "newer",
    });
    const held = f.kernel.postWorkerMessage(f.execution, {
      body: "Draft",
      attachmentIds: [file.attachmentId],
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "draft",
    });
    assert.ok("heldDraftId" in held);
    await assert.rejects(
      f.kernel.files.downloadWorkerTaskArtifact(f.execution, file.attachmentId),
      /not attached/,
    );
    const request = {
      reviseDraftId: held.heldDraftId,
      body: "revised attachment reply",
    };
    const sent = f.kernel.postWorkerMessage(f.execution, request);
    const replay = f.kernel.postWorkerMessage(f.execution, request);
    assert.ok("event" in sent && "event" in replay);
    assert.equal(sent.event.eventId, replay.event.eventId);
    assert.equal(sent.event.payload.body, "revised attachment reply");
    assert.ok("event" in sent);
    assert.equal(
      (sent.event.payload.attachments as Array<{ attachmentId: string }>)[0]
        ?.attachmentId,
      file.attachmentId,
    );
    assert.equal(
      f.kernel.files.list(f.humanActor, { roomId: f.room.roomId }).files.length,
      1,
    );
  } finally {
    f.kernel.close();
  }
});
