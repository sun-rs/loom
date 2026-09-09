import { request as httpRequest, type ClientRequest } from "node:http";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { RoomKernel } from "@rah-os/kernel";
import { WorkerApplicationService } from "../src/index.ts";

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "rah-target-review-"));
  let now = new Date("2026-09-08T10:00:00Z");
  const k = new RoomKernel({ databasePath: join(dir, "db"), now: () => now });
  k.initialize();
  const h = k.provisionPrincipal({ kind: "human", handle: "human" }),
    a = k.provisionPrincipal({ kind: "agent", handle: "agent" }),
    actor = k.authenticateAccessToken(h.accessToken);
  const origin = k.createRoom(actor, { name: "Origin", slug: "origin" }),
    target = k.createRoom(actor, { name: "Target", slug: "target" });
  for (const r of [origin, target])
    k.addMember(actor, {
      roomId: r.roomId,
      principalId: a.principal.principalId,
    });
  k.postMessage(actor, {
    roomId: origin.roomId,
    body: "Work",
    idempotencyKey: "wake",
    recipients: [{ participantId: a.principal.principalId, reason: "mention" }],
  });
  const host = k.authenticateHostAccessToken(
    k.provisionHostCredential({
      hostId: "fake-host",
      participantIds: [a.principal.principalId],
    }).accessToken,
  );
  k.heartbeatHost(host);
  const activation = k.leaseNextActivation(host, { leaseMs: 7200000 })!;
  const run = k.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    runAttemptId: run.runAttemptId,
    runtimeRunId: "fake",
    recoveryDescriptor: { driver: "fake", recoveryKey: "fake", metadata: {} },
  };
  k.prepareRunAttemptRuntime(host, runtime);
  k.markRunAttemptRunning(host, runtime);
  const s = new WorkerApplicationService({ kernel: k, now: () => now });
  await s.start();
  const c = s.issueActivationCredential(
    host,
    {
      activationId: activation.activationId,
      consumerId: "worker",
      hostId: host.hostId,
      participantId: a.principal.principalId,
      roomId: origin.roomId,
      runAttemptId: run.runAttemptId,
      toSeq: activation.toSeq,
    },
    { ttlMs: 7200000 },
  );
  let token = c.accessToken;
  let currentRun = run;
  let currentRuntime = runtime;
  let currentActivation = activation;
  const tokenFile = join(dir, "token");
  writeFileSync(tokenFile, token, { mode: 0o600 });
  const call = async (path: string, body: unknown = {}) => {
    const r = await fetch(`${s.origin}/v1/worker/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const db = new DatabaseSync(join(dir, "db"));
  return {
    db,
    get token() {
      return token;
    },
    /**
     * `room-read` renders Raft's window text; the receipt and the through-seq
     * stay on that text because `attachment-publish --context-receipt` and
     * `message-post --based-on-room-seq` take them.
     */
    async cliRoomContext(
      this: { cliText(args: string[]): Promise<string> },
      args: string[],
    ) {
      const stdout = await this.cliText(args);
      const header =
        /^Read window: \d+ delivered at \S+, seq \d+-(\d+), /mu.exec(stdout);
      const receipt = /^Context receipt: (.+)$/mu.exec(stdout);
      assert.ok(header && receipt, stdout);
      return {
        contextReceipt: receipt[1]!,
        throughRoomSeq: Number(header[1]),
      };
    },
    cliText: async (args: string[]) => {
      const result = await promisify(execFile)(
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
            RAH_WORKER_API_URL: s.origin!,
            RAH_WORKER_SESSION_FILE: tokenFile,
          },
          maxBuffer: 3 * 1024 * 1024,
        },
      );
      return result.stdout;
    },
    cli: async (args: string[]) => {
      const result = await promisify(execFile)(
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
            RAH_WORKER_API_URL: s.origin!,
            RAH_WORKER_SESSION_FILE: tokenFile,
          },
          maxBuffer: 3 * 1024 * 1024,
        },
      );
      return JSON.parse(result.stdout);
    },
    async nextRun() {
      await call("sync");
      const ack = await call("acknowledge", {
        throughSeq: currentActivation.toSeq,
      });
      assert.equal(ack.status, 200, JSON.stringify(ack.body));
      k.recordRuntimeTermination(host, {
        runAttemptId: currentRun.runAttemptId,
        runtimeRunId: currentRuntime.runtimeRunId,
        exit: { code: 0 },
      });
      k.finishRunAttempt(host, {
        runAttemptId: currentRun.runAttemptId,
        state: "exited",
        exitCode: 0,
      });
      k.completeActivation(host, {
        activationId: currentActivation.activationId,
        consumerId: "worker",
      });
      k.postMessage(actor, {
        roomId: origin.roomId,
        body: "Continue saved work",
        recipients: [
          { participantId: a.principal.principalId, reason: "mention" },
        ],
        idempotencyKey: `wake-${currentRun.runAttemptId}`,
      });
      currentActivation = k.leaseNextActivation(host, { leaseMs: 7200000 })!;
      assert.ok(currentActivation);
      currentRun = k.createRunAttempt(host, {
        activationId: currentActivation.activationId,
      });
      currentRuntime = {
        runAttemptId: currentRun.runAttemptId,
        runtimeRunId: `runtime-${currentRun.runAttemptId}`,
        recoveryDescriptor: {
          driver: "fake",
          recoveryKey: "fake",
          metadata: {},
        },
      };
      k.prepareRunAttemptRuntime(host, currentRuntime);
      k.markRunAttemptRunning(host, currentRuntime);
      token = s.issueActivationCredential(
        host,
        {
          activationId: currentActivation.activationId,
          consumerId: "worker",
          hostId: host.hostId,
          participantId: a.principal.principalId,
          roomId: currentActivation.roomId,
          runAttemptId: currentRun.runAttemptId,
          toSeq: currentActivation.toSeq,
        },
        { ttlMs: 7200000 },
      ).accessToken;
      writeFileSync(tokenFile, token, { mode: 0o600 });
    },
    revoke: () => c.revoke(),
    participantId: a.principal.principalId,
    dir,
    k,
    s,
    actor,
    target,
    origin,
    call,
    host,
    run,
    advance() {
      now = new Date(now.getTime() + 3600001);
      k.heartbeatHost(host);
    },
    async close() {
      await s.close();
      db.close();
      k.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function upload(
  f: Awaited<ReturnType<typeof fixture>>,
  context: any,
  key: string,
  bytes = Buffer.from("Cross Room evidence"),
) {
  const prepared = await f.call("attachments/prepare", {
    channel: "#target",
    contextReceipt: context.contextReceipt,
    filename: "evidence.txt",
    mimeType: "text/plain",
    size: bytes.length,
    idempotencyKey: key,
  });
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
  const response = await fetch(
    `${f.s.origin}/v1/worker/attachments/${prepared.body.attachmentId}`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${f.token}` },
      body: bytes,
    },
  );
  assert.equal(response.status, 200, await response.text());
  return prepared.body.attachmentId as string;
}

test("cross-target files are reserved there, atomically published there, and downloadable without expanding the original execution", async () => {
  const f = await fixture();
  try {
    const context = (await f.call("rooms/read", { channel: "#target" })).body;
    const before = f.k.sync(f.actor, {
      roomId: f.origin.roomId,
      consumerId: "test",
    }).latestRoomSeq;
    const id = await upload(f, context, "prepare");
    const row = f.db
      .prepare("SELECT * FROM room_files WHERE attachment_id=?")
      .get(id)!;
    assert.equal(row.room_id, f.target.roomId);
    const download = () =>
      fetch(`${f.s.origin}/v1/worker/attachments/${id}`, {
        headers: { authorization: `Bearer ${f.token}` },
      });
    assert.equal((await download()).status, 404);
    const post = {
      channel: "#target",
      contextReceipt: context.contextReceipt,
      basedOnRoomSeq: context.throughRoomSeq,
      attachmentIds: [id],
      body: "Evidence",
      idempotencyKey: "post",
    };
    const result = await f.call("messages/post", post);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.event.roomId, f.target.roomId);
    assert.equal(result.body.event.payload.attachments[0].attachmentId, id);
    assert.equal(
      (await f.call("messages/post", post)).body.event.eventId,
      result.body.event.eventId,
    );
    assert.equal(
      f.db
        .prepare("SELECT state FROM room_files WHERE attachment_id=?")
        .get(id)!.state,
      "consumed",
    );
    const actual = await download();
    assert.equal(actual.status, 200);
    assert.equal(await actual.text(), "Cross Room evidence");
    assert.equal(
      f.k.sync(f.actor, { roomId: f.origin.roomId, consumerId: "test" })
        .latestRoomSeq,
      before,
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
});

test("cross-target stale sends preserve attachments in held drafts and resume with a fresh target read", async () => {
  const f = await fixture();
  try {
    const context = (await f.call("rooms/read", { channel: "#target" })).body;
    const id = await upload(f, context, "held-file");
    f.k.postMessage(f.actor, {
      roomId: f.target.roomId,
      body: "New relevant target fact",
      recipients: [],
      idempotencyKey: "new",
    });
    const command = {
      channel: "#target",
      contextReceipt: context.contextReceipt,
      basedOnRoomSeq: context.throughRoomSeq,
      body: "Saved evidence",
      attachmentIds: [id],
      idempotencyKey: "held",
    };
    const held = await f.call("messages/post", command);
    assert.equal(held.status, 200, JSON.stringify(held.body));
    assert.equal(held.body.state, "held");
    assert.equal(
      f.db
        .prepare("SELECT state FROM room_files WHERE attachment_id=?")
        .get(id)!.state,
      "completed",
    );
    const fresh = (await f.call("rooms/read", { channel: "#target" })).body;
    const sent = await f.call("messages/post", {
      channel: "#target",
      contextReceipt: fresh.contextReceipt,
      basedOnRoomSeq: fresh.throughRoomSeq,
      sendDraft: true,
      heldDraftId: held.body.heldDraftId,
      idempotencyKey: "send-held",
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.event.payload.body, "Saved evidence");
    assert.equal(sent.body.event.payload.attachments[0].attachmentId, id);
  } finally {
    await f.close();
  }
});

test("real Worker CLI publishes PNG to target and resumes its TXT held draft in a later Run", async () => {
  const f = await fixture();
  try {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
    const path = join(f.dir, "pixel.png");
    writeFileSync(path, png);
    const context = await f.cliRoomContext([
      "room-read",
      "--target",
      "#target",
    ]);
    const file = await f.cli([
      "attachment-publish",
      "--target",
      "#target",
      "--context-receipt",
      context.contextReceipt,
      "--path",
      path,
      "--mime-type",
      "image/png",
      "--idempotency-key",
      "cli-png",
    ]);
    const posted = await f.cli([
      "message-post",
      "--json",
      "--target",
      "#target",
      "--context-receipt",
      context.contextReceipt,
      "--based-on-room-seq",
      String(context.throughRoomSeq),
      "--attachment-ids",
      file.attachmentId,
      "--idempotency-key",
      "cli-post",
    ]);
    assert.equal(posted.event.roomId, f.target.roomId);
    const output = join(f.dir, "download.png");
    await f.cli([
      "attachment-download",
      "--attachment-id",
      file.attachmentId,
      "--output",
      output,
    ]);
    assert.deepEqual(readFileSync(output), png);
    const fresh = await f.cliRoomContext(["room-read", "--target", "#target"]);
    const id = await upload(f, fresh, "cli-txt");
    f.k.postMessage(f.actor, {
      roomId: f.target.roomId,
      body: "A new target message",
      recipients: [],
      idempotencyKey: "race",
    });
    const held = await f
      .cli([
        "message-post",
        "--json",
        "--target",
        "#target",
        "--context-receipt",
        fresh.contextReceipt,
        "--based-on-room-seq",
        String(fresh.throughRoomSeq),
        "--body",
        "Saved exact TXT",
        "--attachment-ids",
        id,
        "--idempotency-key",
        "cli-held",
      ])
      .then(
        () => {
          throw new Error("held send must exit unsuccessfully");
        },
        (error: { code: number; stderr: string; stdout: string }) => {
          assert.equal(error.code, 1);
          // Raft's `--json` refusal: stdout stays empty and the held payload
          // travels inside the stderr error envelope's `details.held`.
          assert.equal(error.stdout, "");
          const envelope = JSON.parse(error.stderr) as {
            details: { held: { heldDraftId: string; state: string } };
            error: { code: string };
            ok: boolean;
          };
          assert.equal(envelope.ok, false);
          assert.equal(envelope.error.code, "SEND_HELD_AS_DRAFT");
          return envelope.details.held;
        },
      );
    assert.equal(held.state, "held");
    const oldToken = f.token;
    await f.nextRun();
    assert.notEqual(f.token, oldToken);
    const invalid = await f.call("messages/post", {
      channel: "#target",
      contextReceipt: fresh.contextReceipt,
      basedOnRoomSeq: fresh.throughRoomSeq,
      sendDraft: true,
      heldDraftId: held.heldDraftId,
      idempotencyKey: "wrong-run-receipt",
    });
    assert.equal(invalid.status, 403);
    const next = await f.cliRoomContext(["room-read", "--target", "#target"]);
    const sent = await f.cli([
      "message-post",
      "--json",
      "--target",
      "#target",
      "--context-receipt",
      next.contextReceipt,
      "--based-on-room-seq",
      String(next.throughRoomSeq),
      "--send-draft",
      "--held-draft-id",
      held.heldDraftId,
      "--idempotency-key",
      "next-run-sent",
    ]);
    assert.equal(sent.event.payload.body, "Saved exact TXT");
    assert.equal(sent.event.payload.attachments[0].attachmentId, id);
    assert.equal(
      f.db
        .prepare("SELECT state FROM held_message_drafts WHERE held_draft_id=?")
        .get(held.heldDraftId)!.state,
      "replaced",
    );
  } finally {
    await f.close();
  }
});

test("cross-target publication refuses another Room's attachment and rolls back bytes consumption with a failed event", async () => {
  const f = await fixture();
  try {
    const context = (await f.call("rooms/read", { channel: "#target" })).body;
    const original = await f.call("attachments/prepare", {
      filename: "original.txt",
      mimeType: "text/plain",
      size: 3,
      idempotencyKey: "original",
    });
    assert.equal(original.status, 200);
    await fetch(
      `${f.s.origin}/v1/worker/attachments/${original.body.attachmentId}`,
      {
        method: "PUT",
        headers: { authorization: `Bearer ${f.token}` },
        body: "abc",
      },
    );
    const post = {
      channel: "#target",
      contextReceipt: context.contextReceipt,
      basedOnRoomSeq: context.throughRoomSeq,
      body: "evidence",
      idempotencyKey: "atomic",
      attachmentIds: [original.body.attachmentId],
    };
    assert.equal((await f.call("messages/post", post)).status, 403);
    const id = await upload(f, context, "atomic-file");
    post.attachmentIds = [id];
    f.db.exec(
      "CREATE TRIGGER reject_target_message BEFORE INSERT ON room_events WHEN NEW.idempotency_key='atomic' BEGIN SELECT RAISE(ABORT,'injected append failure'); END;",
    );
    assert.equal((await f.call("messages/post", post)).status, 500);
    assert.equal(
      f.db
        .prepare("SELECT state FROM room_files WHERE attachment_id=?")
        .get(id)!.state,
      "completed",
    );
    assert.equal(
      Number(
        f.db
          .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
          .get(f.target.roomId)!.n,
      ),
      context.throughRoomSeq,
    );
    f.db.exec("DROP TRIGGER reject_target_message");
    const sent = await f.call("messages/post", post);
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(
      (await f.call("messages/post", post)).body.event.eventId,
      sent.body.event.eventId,
    );
    assert.equal(
      f.db
        .prepare("SELECT room_id FROM room_files WHERE attachment_id=?")
        .get(original.body.attachmentId)!.room_id,
      f.origin.roomId,
    );
  } finally {
    await f.close();
  }
});

for (const reason of ["membership", "bearer", "run"] as const)
  test(`target upload rechecks ${reason} after HTTP body wait and leaves no published or temporary bytes`, async () => {
    const f = await fixture();
    try {
      const context = (await f.call("rooms/read", { channel: "#target" })).body;
      const prepared = await f.call("attachments/prepare", {
        channel: "#target",
        contextReceipt: context.contextReceipt,
        filename: "revoke.txt",
        mimeType: "text/plain",
        size: 6,
        idempotencyKey: "revoke",
      });
      assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
      const continued = Promise.withResolvers<void>();
      let request!: ClientRequest;
      const resultPromise = new Promise<{
        status: number | undefined;
        body: string;
      }>((resolve, reject) => {
        request = httpRequest(
          `${f.s.origin}/v1/worker/attachments/${prepared.body.attachmentId}`,
          {
            method: "PUT",
            headers: {
              authorization: `Bearer ${f.token}`,
              "content-type": "application/octet-stream",
              expect: "100-continue",
            },
          },
          (r) => {
            let body = "";
            r.on("data", (c) => (body += String(c)));
            r.on("end", () => resolve({ status: r.statusCode, body }));
          },
        );
        request.on("error", reject);
        request.on("continue", () => continued.resolve());
      });
      request.setTimeout(5000, () =>
        request.destroy(new Error("bounded test upload timeout")),
      );
      request.flushHeaders();
      await continued.promise;
      request.write("abc");
      if (reason === "membership")
        f.db
          .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
          .run(f.target.roomId, f.participantId);
      else if (reason === "bearer") f.revoke();
      else await f.nextRun();
      request.end("def");
      const result = await resultPromise;
      assert.equal(
        result.status,
        reason === "bearer" ? 401 : reason === "membership" ? 403 : 409,
        result.body,
      );
      assert.equal(
        f.db
          .prepare("SELECT state FROM room_files WHERE attachment_id=?")
          .get(prepared.body.attachmentId)!.state,
        "failed",
      );
      assert.equal(
        existsSync(join(f.dir, "room-files", prepared.body.attachmentId)),
        false,
      );
      assert.equal(
        existsSync(
          join(f.dir, "room-files", `${prepared.body.attachmentId}.part`),
        ),
        false,
      );
    } finally {
      await f.close();
    }
  });

test("repeated target reholds use the existing anyway threshold and never replace saved attachment intent", async () => {
  const f = await fixture();
  try {
    const first = (await f.call("rooms/read", { channel: "#target" })).body;
    const id = await upload(f, first, "anyway-file");
    const add = (key: string) =>
      f.k.postMessage(f.actor, {
        roomId: f.target.roomId,
        body: `Fresh ${key}`,
        recipients: [],
        idempotencyKey: key,
      });
    add("one");
    const held = await f.call("messages/post", {
      channel: "#target",
      contextReceipt: first.contextReceipt,
      basedOnRoomSeq: first.throughRoomSeq,
      body: "Original body",
      attachmentIds: [id],
      idempotencyKey: "held-one",
    });
    assert.equal(held.body.state, "held");
    const second = (await f.call("rooms/read", { channel: "#target" })).body;
    const draft = {
      channel: "#target",
      contextReceipt: second.contextReceipt,
      basedOnRoomSeq: second.throughRoomSeq,
      sendDraft: true,
      heldDraftId: held.body.heldDraftId,
      idempotencyKey: "held-two",
    };
    assert.equal(
      (await f.call("messages/post", { ...draft, anyway: true })).status,
      409,
    );
    assert.equal(
      (await f.call("messages/post", { ...draft, attachmentIds: [] })).status,
      400,
    );
    add("two");
    const reheld = await f.call("messages/post", draft);
    assert.equal(reheld.body.reholdCount, 2, JSON.stringify(reheld.body));
    const third = (await f.call("rooms/read", { channel: "#target" })).body;
    add("three");
    const anyway = {
      channel: "#target",
      contextReceipt: third.contextReceipt,
      basedOnRoomSeq: third.throughRoomSeq,
      sendDraft: true,
      heldDraftId: reheld.body.heldDraftId,
      anyway: true,
      idempotencyKey: "send-anyway",
    };
    const sent = await f.call("messages/post", anyway);
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.event.payload.body, "Original body");
    assert.equal(sent.body.event.payload.attachments[0].attachmentId, id);
    assert.equal(
      (await f.call("messages/post", anyway)).body.event.eventId,
      sent.body.event.eventId,
    );
    assert.equal(
      (await f.call("messages/post", { ...anyway, anyway: false })).status,
      409,
    );
  } finally {
    await f.close();
  }
});

test("a different valid Agent cannot take another Agent's reservation, receipt or held draft", async () => {
  const f = await fixture();
  try {
    const context = (await f.call("rooms/read", { channel: "#target" })).body;
    const id = await upload(f, context, "private-reservation");
    f.k.postMessage(f.actor, {
      roomId: f.target.roomId,
      body: "Race",
      recipients: [],
      idempotencyKey: "other-race",
    });
    const held = await f.call("messages/post", {
      channel: "#target",
      contextReceipt: context.contextReceipt,
      basedOnRoomSeq: context.throughRoomSeq,
      body: "Original private intent",
      attachmentIds: [id],
      idempotencyKey: "private-held",
    });
    const other = f.k.provisionPrincipal({ kind: "agent", handle: "other" });
    for (const room of [f.origin, f.target])
      f.k.addMember(f.actor, {
        roomId: room.roomId,
        principalId: other.principal.principalId,
      });
    f.k.postMessage(f.actor, {
      roomId: f.origin.roomId,
      body: "Other work",
      recipients: [
        { participantId: other.principal.principalId, reason: "mention" },
      ],
      idempotencyKey: "other-work",
    });
    const host = f.k.authenticateHostAccessToken(
      f.k.provisionHostCredential({
        hostId: "other-host",
        participantIds: [other.principal.principalId],
      }).accessToken,
    );
    f.k.heartbeatHost(host);
    const activation = f.k.leaseNextActivation(host, { leaseMs: 60000 })!;
    assert.ok(activation);
    const run = f.k.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    const runtime = {
      runAttemptId: run.runAttemptId,
      runtimeRunId: "other",
      recoveryDescriptor: {
        driver: "fake",
        recoveryKey: "other",
        metadata: {},
      },
    };
    f.k.prepareRunAttemptRuntime(host, runtime);
    f.k.markRunAttemptRunning(host, runtime);
    const credential = f.s.issueActivationCredential(host, {
      activationId: activation.activationId,
      consumerId: "other",
      hostId: host.hostId,
      participantId: other.principal.principalId,
      roomId: activation.roomId,
      runAttemptId: run.runAttemptId,
      toSeq: activation.toSeq,
    });
    const call = async (path: string, body: unknown) => {
      const r = await fetch(`${f.s.origin}/v1/worker/${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: (await r.json()) as any };
    };
    assert.equal(
      (await call("attachments/cancel", { attachmentId: id })).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${f.s.origin}/v1/worker/attachments/${id}`, {
          method: "PUT",
          headers: { authorization: `Bearer ${credential.accessToken}` },
          body: "abc",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("attachments/prepare", {
          channel: "#target",
          contextReceipt: context.contextReceipt,
          filename: "steal.txt",
          mimeType: "text/plain",
          size: 1,
          idempotencyKey: "steal",
        })
      ).status,
      403,
    );
    const own = (await call("rooms/read", { channel: "#target" })).body;
    assert.equal(
      (
        await call("messages/post", {
          channel: "#target",
          contextReceipt: own.contextReceipt,
          basedOnRoomSeq: own.throughRoomSeq,
          body: "Steal",
          attachmentIds: [id],
          idempotencyKey: "steal-post",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("messages/post", {
          channel: "#target",
          contextReceipt: own.contextReceipt,
          basedOnRoomSeq: own.throughRoomSeq,
          sendDraft: true,
          heldDraftId: held.body.heldDraftId,
          idempotencyKey: "steal-draft",
        })
      ).status,
      403,
    );
    assert.equal(
      f.db
        .prepare("SELECT state FROM room_files WHERE attachment_id=?")
        .get(id)!.state,
      "completed",
    );
  } finally {
    await f.close();
  }
});

test("target Thread held resending keeps the explicit attachment-comment target across Run replacement", async () => {
  const f = await fixture();
  try {
    const base = (await f.call("rooms/read", { channel: "#target" })).body;
    const parentFile = await upload(f, base, "comment-parent");
    const parent = await f.call("messages/post", {
      channel: "#target",
      contextReceipt: base.contextReceipt,
      basedOnRoomSeq: base.throughRoomSeq,
      attachmentIds: [parentFile],
      idempotencyKey: "comment-parent-post",
    });
    const thread = f.k.createThread(f.actor, {
      roomId: f.target.roomId,
      rootMessageId: parent.body.event.aggregateId,
      recipientIds: [],
      basedOnRoomSeq: parent.body.event.roomSeq,
      idempotencyKey: "comment-thread",
    }).thread;
    const channel = `#target:${thread.threadId}`;
    const before = (await f.call("rooms/read", { channel })).body;
    const prepared = await f.call("attachments/prepare", {
      channel,
      contextReceipt: before.contextReceipt,
      filename: "reply.txt",
      mimeType: "text/plain",
      size: 3,
      idempotencyKey: "reply-upload",
    });
    assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
    assert.equal(
      (
        await fetch(
          `${f.s.origin}/v1/worker/attachments/${prepared.body.attachmentId}`,
          {
            method: "PUT",
            headers: { authorization: `Bearer ${f.token}` },
            body: "xyz",
          },
        )
      ).status,
      200,
    );
    f.k.replyThread(f.actor, {
      roomId: f.target.roomId,
      threadId: thread.threadId,
      body: "New comment",
      recipientIds: [],
      basedOnRoomSeq: before.throughRoomSeq,
      idempotencyKey: "new-comment",
    });
    const held = await f.call("messages/post", {
      channel,
      contextReceipt: before.contextReceipt,
      basedOnRoomSeq: before.throughRoomSeq,
      body: "Reply to this file",
      attachmentIds: [prepared.body.attachmentId],
      commentAttachmentId: parentFile,
      idempotencyKey: "held-comment",
    });
    assert.equal(held.body.state, "held", JSON.stringify(held.body));
    await f.nextRun();
    const fresh = (await f.call("rooms/read", { channel })).body;
    const sent = await f.call("messages/post", {
      channel,
      contextReceipt: fresh.contextReceipt,
      basedOnRoomSeq: fresh.throughRoomSeq,
      sendDraft: true,
      heldDraftId: held.body.heldDraftId,
      idempotencyKey: "sent-comment",
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(
      sent.body.event.payload.attachmentComment.attachmentId,
      parentFile,
    );
    assert.equal(
      sent.body.event.payload.attachments[0].attachmentId,
      prepared.body.attachmentId,
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT attachment_id FROM attachment_comment_links WHERE message_id=?",
        )
        .get(sent.body.event.aggregateId)!.attachment_id,
      parentFile,
    );
  } finally {
    await f.close();
  }
});

test("non-message target changes stay stale and target preparation cannot accept missing or mismatched receipts", async () => {
  const f = await fixture();
  try {
    const context = (await f.call("rooms/read", { channel: "#target" })).body;
    const outsider = f.k.provisionPrincipal({
      kind: "agent",
      handle: "new-member",
    });
    f.k.addMember(f.actor, {
      roomId: f.target.roomId,
      principalId: outsider.principal.principalId,
    });
    assert.equal(
      (
        await f.call("messages/post", {
          channel: "#target",
          contextReceipt: context.contextReceipt,
          basedOnRoomSeq: context.throughRoomSeq,
          body: "stale metadata",
          idempotencyKey: "metadata-stale",
        })
      ).status,
      409,
    );
    const input = {
      channel: "#target",
      contextReceipt: context.contextReceipt,
      filename: "proof.txt",
      mimeType: "text/plain",
      size: 1,
      idempotencyKey: "proof",
    };
    assert.equal(
      (await f.call("attachments/prepare", { ...input, channel: "#origin" }))
        .status,
      403,
    );
    assert.equal(
      (
        await f.call("attachments/prepare", {
          ...input,
          contextReceipt: "forged",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.call("attachments/prepare", {
          ...input,
          contextReceipt: undefined,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.call("attachments/prepare", {
          ...input,
          roomId: f.target.roomId,
        })
      ).status,
      400,
    );
  } finally {
    await f.close();
  }
});

test("explicit top-level target messages resolve the Room causal event", async () => {
  const f = await fixture();
  try {
    const context = (await f.call("rooms/read", { channel: "#target" })).body;
    const result = await f.call("messages/post", {
      channel: "#target",
      contextReceipt: context.contextReceipt,
      basedOnRoomSeq: context.throughRoomSeq,
      threadId: null,
      body: "Top level",
      idempotencyKey: "explicit-top-level",
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.event.payload.threadId, undefined);
  } finally {
    await f.close();
  }
});

test("a canonical joined DM accepts its own file through the same target CLI path", async () => {
  const f = await fixture();
  try {
    const workspace = f.k.createWorkspace(f.actor, {
      name: "Direct",
      slug: "direct",
      idempotencyKey: "workspace",
    });
    f.k.addMember(f.actor, {
      roomId: workspace.controlRoom.roomId,
      principalId: f.participantId,
    });
    const dm = f.k.openDirectRoom(f.actor, {
      workspaceId: workspace.workspace.workspaceId,
      peerPrincipalId: f.participantId,
      basedOnControlRoomSeq: f.k.sync(f.actor, {
        roomId: workspace.controlRoom.roomId,
        consumerId: "dm-head",
      }).latestRoomSeq,
      idempotencyKey: "dm",
    });
    const context = await f.cliRoomContext([
      "room-read",
      "--target",
      "dm:@human",
    ]);
    const path = join(f.dir, "dm.txt");
    writeFileSync(path, "Direct file");
    const file = await f.cli([
      "attachment-publish",
      "--target",
      "dm:@human",
      "--context-receipt",
      context.contextReceipt,
      "--path",
      path,
      "--idempotency-key",
      "dm-file",
    ]);
    const posted = await f.cli([
      "message-post",
      "--json",
      "--target",
      "dm:@human",
      "--context-receipt",
      context.contextReceipt,
      "--based-on-room-seq",
      String(context.throughRoomSeq),
      "--attachment-ids",
      file.attachmentId,
      "--idempotency-key",
      "dm-file-post",
    ]);
    assert.equal(posted.event.roomId, dm.roomId);
    assert.equal(file.roomId, dm.roomId);
  } finally {
    await f.close();
  }
});
