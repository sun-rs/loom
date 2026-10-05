import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";
import { FinalDeliveryUnconfirmedError } from "../src/errors.ts";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-presented-window-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const database = new DatabaseSync(databasePath);
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const agent = kernel.provisionPrincipal({ handle: "worker", kind: "agent" });
  const other = kernel.provisionPrincipal({
    handle: "bystander",
    kind: "agent",
  });
  const agentId = agent.principal.principalId;
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Main", slug: "main" });
  const away = kernel.createRoom(actor, { name: "Away", slug: "away" });
  for (const roomId of [room.roomId, away.roomId])
    for (const principalId of [agentId, other.principal.principalId])
      kernel.addMember(actor, { roomId, principalId });
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "host",
      participantIds: [agentId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  let sequence = 0;
  const head = (roomId: string) =>
    Number(
      database
        .prepare("SELECT next_seq - 1 AS n FROM rooms WHERE room_id = ?")
        .get(roomId)!.n,
    );
  const post = (
    body: string,
    options: { mention?: boolean; roomId?: string } = {},
  ) =>
    kernel.postMessage(actor, {
      body,
      roomId: options.roomId ?? room.roomId,
      recipients:
        options.mention === false
          ? []
          : [{ participantId: agentId, reason: "mention" }],
      idempotencyKey: `seed-${++sequence}`,
    });
  /** A Room event inside the window that is not a `message.posted`. */
  const nonMessageEvent = () => {
    const extra = kernel.provisionPrincipal({
      handle: `joiner-${++sequence}`,
      kind: "agent",
    });
    return kernel.addMember(actor, {
      roomId: room.roomId,
      principalId: extra.principal.principalId,
    });
  };
  return {
    actor,
    agentId,
    away,
    database,
    head,
    host,
    kernel,
    nonMessageEvent,
    post,
    room,
    /** Lease the queued Activation and bring its RunAttempt to `running`. */
    activate() {
      const activation = kernel.leaseNextActivation(host, { leaseMs: 600_000 });
      assert.ok(activation, "an Activation must be queued");
      const run = kernel.createRunAttempt(host, {
        activationId: activation.activationId,
      });
      const runtime = {
        runAttemptId: run.runAttemptId,
        runtimeRunId: "runtime",
        recoveryDescriptor: {
          driver: "fake",
          recoveryKey: "fake",
          metadata: {},
        },
      };
      kernel.prepareRunAttemptRuntime(host, runtime);
      kernel.markRunAttemptRunning(host, runtime);
      const scope = {
        activationId: activation.activationId,
        consumerId: "worker",
        hostId: "host",
        participantId: agentId,
        roomId: room.roomId,
        runAttemptId: run.runAttemptId,
        toSeq: activation.toSeq,
      };
      return {
        activation,
        run,
        scope,
        execution: kernel.authorizeWorkerExecution(host, scope),
      };
    },
    cursor: () =>
      Number(
        database
          .prepare(
            "SELECT last_seq AS n FROM subscription_cursors WHERE room_id=? AND participant_id=? AND consumer_id='worker'",
          )
          .get(room.roomId, agentId)?.n ?? 0,
      ),
    close() {
      database.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function sent(
  context: ReturnType<typeof fixture>,
  run: {
    scope: { activationId: string; consumerId: string; runAttemptId: string };
  },
): void {
  context.kernel.markPresentedDeliverySent(context.host, {
    activationId: run.scope.activationId,
    consumerId: run.scope.consumerId,
    runAttemptId: run.scope.runAttemptId,
  });
}

for (const other of ["consumer", "run"] as const) {
  test(`final cannot borrow a full pending presentation from another ${other}`, () => {
    const f = fixture();
    try {
      f.post("question");
      const r = f.activate();
      f.kernel.presentWorkerMessages(r.execution);
      const progress = f.kernel.postWorkerMessage(r.execution, {
        body: "progress",
        basedOnRoomSeq: r.scope.toSeq,
      });
      assert.ok("event" in progress);
      // Identity-mismatch fixture: the genuine rendered proof and model echo
      // now belong to another transport identity, not the active caller.
      f.database
        .prepare(
          `UPDATE activation_presented_windows SET ${other === "consumer" ? "consumer_id" : "run_attempt_id"}=? WHERE activation_id=?`,
        )
        .run(`other-${other}`, r.scope.activationId);
      const before = f.database
        .prepare("SELECT count(*) n FROM messages")
        .get()!.n;
      assert.throws(
        () =>
          f.kernel.postWorkerMessage(r.execution, {
            channel: "#main",
            body: "final",
            final: true,
          }),
        FinalDeliveryUnconfirmedError,
      );
      assert.equal(
        f.database.prepare("SELECT count(*) n FROM messages").get()!.n,
        before,
      );
      assert.equal(f.cursor(), 0);
    } finally {
      f.close();
    }
  });
}

test("another consumer's acknowledged cursor cannot authorize this final", () => {
  const f = fixture();
  try {
    f.post("question");
    const r = f.activate();
    f.kernel.presentWorkerMessages(r.execution);
    sent(f, r);
    f.kernel.postWorkerMessage(r.execution, {
      body: "progress",
      basedOnRoomSeq: r.scope.toSeq,
    });
    assert.equal(f.cursor(), r.scope.toSeq);
    f.database
      .prepare(
        "UPDATE subscription_cursors SET consumer_id='another-consumer' WHERE consumer_id='worker'",
      )
      .run();
    assert.throws(
      () =>
        f.kernel.postWorkerMessage(r.execution, {
          channel: "#main",
          body: "final",
          final: true,
        }),
      FinalDeliveryUnconfirmedError,
    );
    assert.equal(f.cursor(), 0);
  } finally {
    f.close();
  }
});

test("an earlier genuine progress echo can support this Run's final pending Host receipt", () => {
  const f = fixture();
  try {
    f.post("question");
    const r = f.activate();
    f.kernel.presentWorkerMessages(r.execution);
    f.kernel.postWorkerMessage(r.execution, {
      body: "progress",
      basedOnRoomSeq: r.scope.toSeq,
    });
    const result = f.kernel.postWorkerMessage(r.execution, {
      channel: "#main",
      body: "final",
      final: true,
    });
    assert.ok("event" in result);
    assert.equal(f.cursor(), 0, "pending proof never becomes an ACK by itself");
    sent(f, r);
    assert.equal(f.cursor(), r.scope.toSeq);
  } finally {
    f.close();
  }
});

test("rejected final rolls back attachment consumption and leaves uploaded bytes usable", async () => {
  const f = fixture();
  try {
    f.post("question");
    const r = f.activate();
    const file = f.kernel.files.prepareWorkerMessage(r.execution, {
      filename: "answer.txt",
      mimeType: "text/plain",
      size: 5,
      idempotencyKey: "file",
    });
    async function* bytes() {
      yield Buffer.from("hello");
    }
    await f.kernel.files.uploadWorkerMessage(
      r.execution,
      file.attachmentId,
      bytes(),
    );
    const before = f.database.prepare("SELECT count(*) n FROM messages").get()!
      .n;
    const hints: string[] = [];
    f.kernel.finalReplies.subscribe((id) => hints.push(id));
    assert.throws(
      () =>
        f.kernel.postWorkerMessage(r.execution, {
          body: "final with file",
          attachmentIds: [file.attachmentId],
          final: true,
        }),
      FinalDeliveryUnconfirmedError,
    );
    assert.equal(
      f.database.prepare("SELECT count(*) n FROM messages").get()!.n,
      before,
    );
    assert.deepEqual(
      f.database
        .prepare(
          "SELECT state,message_id FROM room_files WHERE attachment_id=?",
        )
        .get(file.attachmentId),
      Object.assign(Object.create(null), {
        state: "completed",
        message_id: null,
      }),
    );
    assert.equal(
      f.kernel.finalReplies.read(f.host, {
        runAttemptId: r.scope.runAttemptId,
      }),
      null,
    );
    assert.deepEqual(hints, []);
    f.kernel.presentWorkerMessages(r.execution);
    sent(f, r);
    const accepted = f.kernel.postWorkerMessage(r.execution, {
      body: "final with file",
      attachmentIds: [file.attachmentId],
      final: true,
      basedOnRoomSeq: r.scope.toSeq,
    });
    assert.ok("event" in accepted);
    assert.equal(
      f.database
        .prepare("SELECT state FROM room_files WHERE attachment_id=?")
        .get(file.attachmentId)!.state,
      "consumed",
    );
  } finally {
    f.close();
  }
});

for (const revise of [false, true]) {
  test(`rejected held final ${revise ? "revision" : "resend"} preserves the saved draft and intent`, () => {
    const f = fixture();
    try {
      f.post("question");
      const r = f.activate();
      f.post("new fact");
      let held = f.kernel.postWorkerMessage(r.execution, {
        body: "saved answer",
        final: true,
        basedOnRoomSeq: r.scope.toSeq,
      });
      assert.ok("state" in held && held.state === "held");
      if (!revise) {
        for (let i = 0; i < 2; i++) {
          held = f.kernel.postWorkerMessage(r.execution, {
            sendDraft: true,
            heldDraftId: held.heldDraftId,
          });
          assert.ok("state" in held && held.state === "held");
        }
      }
      const before = f.database
        .prepare("SELECT * FROM held_message_drafts WHERE held_draft_id=?")
        .get(held.heldDraftId);
      const messages = f.database
        .prepare("SELECT count(*) n FROM messages")
        .get()!.n;
      assert.throws(
        () =>
          f.kernel.postWorkerMessage(
            r.execution,
            revise
              ? { reviseDraftId: held.heldDraftId, body: "revised answer" }
              : {
                  sendDraft: true,
                  heldDraftId: held.heldDraftId,
                  anyway: true,
                },
          ),
        FinalDeliveryUnconfirmedError,
      );
      assert.deepEqual(
        f.database
          .prepare("SELECT * FROM held_message_drafts WHERE held_draft_id=?")
          .get(held.heldDraftId),
        before,
      );
      assert.equal(
        f.database.prepare("SELECT count(*) n FROM messages").get()!.n,
        messages,
      );
      assert.equal(
        f.kernel.finalReplies.read(f.host, {
          runAttemptId: r.scope.runAttemptId,
        }),
        null,
      );
    } finally {
      f.close();
    }
  });
}
