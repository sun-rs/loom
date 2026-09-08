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
async function fixture(
  setup?: (
    kernel: RoomKernel,
    actor: ReturnType<RoomKernel["authenticateAccessToken"]>,
    room: ReturnType<RoomKernel["createRoom"]>,
    agentId: string,
  ) => Promise<void>,
) {
  const dir = mkdtempSync(join(tmpdir(), "rah-comments-http-")),
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
  await setup?.(kernel, actor, room, agent.principal.principalId);
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
    host,
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

test("published comments roundtrip through Human SDK and authenticated Worker CLI without ACK", async () => {
  const f = await fixture();
  try {
    const client = new HttpRahClient({
      baseUrl: f.humanService.origin!,
      accessToken: () => f.human.accessToken,
    });
    const bytes = new Blob(["first\nsecond\nthird"]);
    const upload = await client.request("file.prepare", {
      roomId: f.room.roomId,
      filename: "lines.txt",
      mimeType: "text/plain",
      size: bytes.size,
      idempotencyKey: "upload-comment",
    });
    await client.files.upload(upload.attachmentId, bytes);
    await client.request("message.post", {
      roomId: f.room.roomId,
      body: "file",
      attachmentIds: [upload.attachmentId],
      recipients: [],
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "post-file",
    });
    const post = await client.request("file.comment", {
      attachmentId: upload.attachmentId,
      body: "Look here",
      anchor: { type: "lines", data: { start: 2, end: 2 } },
      recipientIds: [],
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "comment",
    });
    const human = await client.request("file.comments", {
      attachmentId: upload.attachmentId,
      limit: 50,
    });
    assert.equal(human.comments[0]!.id, post.event.aggregateId);
    const reply = await f.cli([
      "attachment-comments",
      "--attachment-id",
      upload.attachmentId,
    ]);
    assert.deepEqual(JSON.parse(reply.stdout), human);
    assert.equal(
      (await f.call("acknowledge", { throughSeq: f.activation.toSeq })).status,
      409,
    );
    assert.equal(
      (
        await f.call("attachments/comments", {
          attachmentId: upload.attachmentId,
          actorId: f.human.principal.principalId,
        })
      ).status,
      400,
    );
    assert.equal(
      await (await client.files.download(upload.attachmentId)).text(),
      await bytes.text(),
    );
  } finally {
    await f.close();
  }
});

test("Agent replies explicitly to one attachment and held retry retains that comment target", async () => {
  let attachmentId = "",
    threadId = "";
  const f = await fixture(async (kernel, actor, room, agentId) => {
    const head = () =>
      kernel.sync(actor, { roomId: room.roomId, consumerId: "setup" })
        .latestRoomSeq;
    const uploaded = kernel.files.prepare(actor, {
      roomId: room.roomId,
      filename: "comment.txt",
      mimeType: "text/plain",
      size: 4,
      idempotencyKey: "file",
    });
    attachmentId = uploaded.attachmentId;
    await kernel.files.upload(
      actor,
      attachmentId,
      (async function* () {
        yield Buffer.from("line");
      })(),
    );
    kernel.postRoomMessage(actor, {
      roomId: room.roomId,
      body: "parent",
      attachmentIds: [attachmentId],
      recipients: [],
      basedOnRoomSeq: head(),
      idempotencyKey: "parent",
    });
    kernel.attachmentComments.post(actor, {
      attachmentId,
      body: "Human question",
      recipientIds: [agentId],
      basedOnRoomSeq: head(),
      idempotencyKey: "human-comment",
    });
    threadId = kernel.attachmentComments.list(actor, {
      attachmentId,
    }).threadId!;
  });
  try {
    const client = new HttpRahClient({
      baseUrl: f.humanService.origin!,
      accessToken: () => f.human.accessToken,
    });
    await f.call("sync");
    await client.request("file.comment", {
      attachmentId,
      body: "New fact",
      recipientIds: [],
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "new-comment",
    });
    const cliReply = await f
      .cli([
        "message-post",
        "--json",
        "--body",
        "Agent answer",
        "--comment-attachment-id",
        attachmentId,
        "--thread-id",
        threadId,
        "--based-on-room-seq",
        String(f.activation.toSeq),
        "--idempotency-key",
        "agent-comment",
      ])
      .then(
        () => {
          throw new Error("held send must exit unsuccessfully");
        },
        (error: { code: number; stderr: string; stdout: string }) => {
          assert.equal(error.code, 1);
          assert.match(error.stderr, /SEND_HELD_AS_DRAFT/);
          return error;
        },
      );
    const first = { body: JSON.parse(cliReply.stdout) };
    assert.equal(first.body.state, "held");
    await f.call("acknowledge", { throughSeq: f.activation.toSeq });
    f.kernel.recordRuntimeTermination(f.host, {
      exit: { code: 0 },
      runAttemptId: f.run.runAttemptId,
      runtimeRunId: "fake",
    });
    f.kernel.finishRunAttempt(f.host, {
      exitCode: 0,
      runAttemptId: f.run.runAttemptId,
      state: "exited",
    });
    f.kernel.completeActivation(f.host, {
      activationId: f.activation.activationId,
      consumerId: "amend-consumer",
    });
    const next = f.kernel.leaseNextActivation(f.host, { leaseMs: 60000 });
    assert.ok(next);
    const run = f.kernel.createRunAttempt(f.host, {
      activationId: next.activationId,
    });
    const runtime = {
      runAttemptId: run.runAttemptId,
      runtimeRunId: "followup",
      recoveryDescriptor: {
        driver: "fake",
        recoveryKey: "followup",
        metadata: {},
      },
    };
    f.kernel.prepareRunAttemptRuntime(f.host, runtime);
    f.kernel.markRunAttemptRunning(f.host, runtime);
    const credential = f.worker.issueActivationCredential(f.host, {
      activationId: next.activationId,
      consumerId: "followup",
      hostId: f.host.hostId,
      participantId: f.agent.principal.principalId,
      roomId: f.room.roomId,
      runAttemptId: run.runAttemptId,
      toSeq: next.toSeq,
    });
    const call = async (path: string, body: unknown = {}) => {
      const r = await fetch(`${f.worker.origin}/v1/worker/${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      return {
        status: r.status,
        body: (await r.json()) as Record<string, unknown>,
      };
    };
    const delivered = await call("sync");
    assert.equal(delivered.status, 200);
    const sent = await call("messages/post", {
      sendDraft: true,
      heldDraftId: first.body.heldDraftId,
      threadId,
      basedOnRoomSeq: delivered.body.cursorAfter,
      idempotencyKey: "send-comment",
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.ok(sent.body.event, JSON.stringify(sent.body));
    const result = await client.request("file.comments", {
      attachmentId,
      limit: 50,
    });
    assert.equal(result.comments.length, 3);
    assert.equal(result.comments[2]!.senderType, "agent");
    assert.equal(result.comments[2]!.content, "Agent answer");
  } finally {
    await f.close();
  }
});

async function configured() {
  const targets: {
    a?: string;
    b?: string;
    c?: string;
    d?: string;
    thread?: string;
    otherThread?: string;
  } = {};
  const f = await fixture(async (k, actor, room, agentId) => {
    const head = (id = room.roomId) =>
      k.sync(actor, { roomId: id, consumerId: "setup-files" }).latestRoomSeq;
    const upload = async (key: string, roomId = room.roomId) => {
      const x = k.files.prepare(actor, {
        roomId,
        filename: `${key}.txt`,
        mimeType: "text/plain",
        size: 4,
        idempotencyKey: key,
      });
      await k.files.upload(
        actor,
        x.attachmentId,
        (async function* () {
          yield Buffer.from("data");
        })(),
      );
      return x.attachmentId;
    };
    targets.a = await upload("a");
    targets.b = await upload("b");
    k.postRoomMessage(actor, {
      roomId: room.roomId,
      body: "Two files same parent",
      attachmentIds: [targets.a, targets.b],
      recipients: [],
      basedOnRoomSeq: head(),
      idempotencyKey: "ab-parent",
    });
    k.attachmentComments.post(actor, {
      attachmentId: targets.a,
      body: "Question A",
      recipientIds: [agentId],
      basedOnRoomSeq: head(),
      idempotencyKey: "ask-a",
    });
    targets.thread = k.attachmentComments.list(actor, {
      attachmentId: targets.a,
    }).threadId!;
    targets.c = await upload("c");
    k.postRoomMessage(actor, {
      roomId: room.roomId,
      body: "Other Thread",
      attachmentIds: [targets.c],
      recipients: [],
      basedOnRoomSeq: head(),
      idempotencyKey: "c-parent",
    });
    k.attachmentComments.post(actor, {
      attachmentId: targets.c,
      body: "Question C",
      recipientIds: [],
      basedOnRoomSeq: head(),
      idempotencyKey: "ask-c",
    });
    targets.otherThread = k.attachmentComments.list(actor, {
      attachmentId: targets.c,
    }).threadId!;
    const foreign = k.createRoom(actor, { name: "Foreign", slug: "foreign" });
    k.addMember(actor, { roomId: foreign.roomId, principalId: agentId });
    targets.d = await upload("d", foreign.roomId);
    k.postRoomMessage(actor, {
      roomId: foreign.roomId,
      body: "Other Room",
      attachmentIds: [targets.d],
      recipients: [],
      basedOnRoomSeq: head(foreign.roomId),
      idempotencyKey: "d-parent",
    });
  });
  await f.call("sync");
  return {
    ...f,
    targets: targets as Required<typeof targets>,
    command: {
      body: "Agent comment",
      commentAttachmentId: targets.a!,
      threadId: targets.thread!,
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "agent-comment",
    },
  };
}

test("Same accepted or held key cannot change or omit the explicit comment target, including another file on the same Message", async () => {
  const f = await configured();
  try {
    const r = await f.call("messages/post", f.command);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.event);
    const again = await f.call("messages/post", f.command);
    assert.equal(again.status, 200);
    assert.equal(again.body.event.eventId, r.body.event.eventId);
    for (const patch of [
      { commentAttachmentId: f.targets.b },
      { commentAttachmentId: undefined },
    ])
      assert.equal(
        (await f.call("messages/post", { ...f.command, ...patch })).status,
        409,
      );
    assert.equal(
      f.kernel.attachmentComments
        .list(f.actor, { attachmentId: f.targets.a })
        .comments.filter((c) => c.senderType === "agent").length,
      1,
    );
    assert.equal(
      f.kernel.attachmentComments.list(f.actor, { attachmentId: f.targets.b })
        .comments.length,
      0,
    );
    f.kernel.attachmentComments.post(f.actor, {
      attachmentId: f.targets.a,
      body: "New fact",
      recipientIds: [],
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "newer",
    });
    const heldInput = { ...f.command, idempotencyKey: "held-comment" };
    const held = await f.call("messages/post", heldInput);
    assert.equal(held.body.state, "held");
    for (const patch of [
      { commentAttachmentId: f.targets.b },
      { commentAttachmentId: undefined },
    ])
      assert.equal(
        (await f.call("messages/post", { ...heldInput, ...patch })).status,
        409,
      );
    assert.equal(
      JSON.parse(
        String(
          f.db
            .prepare(
              "SELECT attachment_comment_json FROM held_message_drafts WHERE held_draft_id=?",
            )
            .get(held.body.heldDraftId)!.attachment_comment_json,
        ),
      ).attachmentId,
      f.targets.a,
    );
  } finally {
    await f.close();
  }
});

test("Comment cannot bind a same-Room different Thread or a joined foreign Room file and cannot redirect saved drafts", async () => {
  const f = await configured();
  try {
    const before = f.latest();
    for (const id of [f.targets.c, f.targets.d]) {
      const r = await f.call("messages/post", {
        ...f.command,
        commentAttachmentId: id,
        idempotencyKey: `wrong-${id}`,
      });
      assert.equal(r.status, 404, JSON.stringify(r.body));
    }
    assert.equal(f.latest(), before);
    f.kernel.attachmentComments.post(f.actor, {
      attachmentId: f.targets.a,
      body: "new",
      recipientIds: [],
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "new",
    });
    const held = await f.call("messages/post", f.command);
    assert.equal(held.body.state, "held");
    const retry = {
      sendDraft: true,
      heldDraftId: held.body.heldDraftId,
      threadId: f.targets.thread,
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "retry",
    };
    assert.equal(
      (
        await f.call("messages/post", {
          ...retry,
          commentAttachmentId: f.targets.b,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.call("messages/post", {
          ...retry,
          threadId: f.targets.otherThread,
        })
      ).status,
      403,
    );
    assert.equal(
      (await f.call("messages/post", { ...retry, threadId: null })).status,
      403,
    );
    await assert.rejects(
      () =>
        f.cli([
          "message-post",
          "--json",
          "--send-draft",
          "--held-draft-id",
          held.body.heldDraftId,
          "--comment-attachment-id",
          f.targets.b,
          "--based-on-room-seq",
          String(f.activation.toSeq),
          "--idempotency-key",
          "cli-replace",
        ]),
      /cannot replace/,
    );
    const reheld = await f.call("messages/post", {
      sendDraft: true,
      heldDraftId: held.body.heldDraftId,
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "inferred-target",
    });
    assert.equal(reheld.status, 200);
    assert.equal(reheld.body.state, "held");
    const row = f.db
      .prepare(
        "SELECT thread_id,attachment_comment_json FROM held_message_drafts WHERE held_draft_id=?",
      )
      .get(reheld.body.heldDraftId)!;
    assert.equal(row.thread_id, f.targets.thread);
    assert.equal(
      JSON.parse(String(row.attachment_comment_json)).attachmentId,
      f.targets.a,
    );
  } finally {
    await f.close();
  }
});

test("Comment-link storage failure rolls back the canonical message, attached upload consumption and Room sequence", async () => {
  const f = await configured();
  try {
    const u = await f.call("attachments/prepare", {
      filename: "reply.txt",
      mimeType: "text/plain",
      size: 4,
      idempotencyKey: "reply-upload",
    });
    assert.equal(u.status, 200, JSON.stringify(u.body));
    const put = await fetch(
      `${f.worker.origin}/v1/worker/attachments/${u.body.attachmentId}`,
      {
        method: "PUT",
        headers: { authorization: `Bearer ${f.credential.accessToken}` },
        body: "data",
      },
    );
    assert.equal(put.status, 200);
    f.db.exec(
      "CREATE TRIGGER reject_agent_comment BEFORE INSERT ON attachment_comment_links BEGIN SELECT RAISE(ABORT,'injected comment link failure'); END",
    );
    const seq = f.latest(),
      count = f.db.prepare("SELECT COUNT(*) n FROM messages").get()!.n,
      followers = f.db
        .prepare(
          "SELECT * FROM agent_thread_follows ORDER BY participant_id,thread_id",
        )
        .all();
    const result = await f.call("messages/post", {
      ...f.command,
      attachmentIds: [u.body.attachmentId],
    });
    assert.equal(result.status, 500, JSON.stringify(result.body));
    assert.equal(f.latest(), seq);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM messages").get()!.n,
      count,
    );
    assert.deepEqual(
      f.db
        .prepare(
          "SELECT * FROM agent_thread_follows ORDER BY participant_id,thread_id",
        )
        .all(),
      followers,
    );
    const upload = f.db
      .prepare("SELECT state,message_id FROM room_files WHERE attachment_id=?")
      .get(u.body.attachmentId)!;
    assert.equal(upload.state, "completed");
    assert.equal(upload.message_id, null);
    assert.equal(
      f.db
        .prepare("SELECT COUNT(*) n FROM room_events WHERE idempotency_key=?")
        .get(f.command.idempotencyKey)!.n,
      0,
    );
    f.db.exec("DROP TRIGGER reject_agent_comment");
    assert.equal(
      (
        await f.call("messages/post", {
          ...f.command,
          attachmentIds: [u.body.attachmentId],
        })
      ).status,
      200,
    );
  } finally {
    await f.close();
  }
});
