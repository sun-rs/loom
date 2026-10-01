import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "../src/index.ts";

/** Temporary Kernel/Worker fixture; no provider or formal service. */
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-final-reply-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const database = new DatabaseSync(databasePath);
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const agent = kernel.provisionPrincipal({ handle: "worker", kind: "agent" });
  const agentId = agent.principal.principalId;
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Main", slug: "main" });
  kernel.addMember(actor, { roomId: room.roomId, principalId: agentId });
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "host",
      participantIds: [agentId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  let sequence = 0;
  return {
    database,
    actor,
    host,
    kernel,
    room,
    post(body: string) {
      return kernel.postMessage(actor, {
        body,
        roomId: room.roomId,
        recipients: [{ participantId: agentId, reason: "mention" }],
        idempotencyKey: `seed-${++sequence}`,
      });
    },
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
        execution: kernel.authorizeWorkerExecution(host, scope),
      };
    },
    close() {
      database.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

for (const explicit of [false, true]) {
  for (const newer of [false, true]) {
    test(`explicit held revision keeps ACK fixed and fences later facts (target=${explicit}, newer=${newer})`, () => {
      const c = fixture();
      try {
        c.post("question");
        const r = c.activate();
        c.kernel.presentWorkerMessages(r.execution);
        c.kernel.markPresentedDeliverySent(c.host, {
          activationId: r.activation.activationId,
          consumerId: "worker",
          runAttemptId: r.run.runAttemptId,
        });
        c.post("first new fact");
        const target = explicit ? { channel: "#main" } : {};
        const held = c.kernel.postWorkerMessage(r.execution, {
          ...target,
          body: "original",
          basedOnRoomSeq: r.activation.toSeq,
          final: true,
        });
        assert.ok("state" in held && held.state === "held");
        if (newer) c.post("another fact after the notice");
        const request = {
          ...target,
          reviseDraftId: held.heldDraftId,
          body: "revised",
          idempotencyKey: "revision",
        };
        let result = c.kernel.postWorkerMessage(r.execution, request);
        const replay = c.kernel.postWorkerMessage(r.execution, request);
        if (newer) {
          assert.ok("state" in result && result.state === "held");
          assert.ok(
            "state" in replay && replay.heldDraftId === result.heldDraftId,
          );
          assert.equal(
            c.kernel.finalReplies.read(c.host, {
              runAttemptId: r.run.runAttemptId,
            }),
            null,
          );
          assert.equal(
            c.database
              .prepare(
                "SELECT count(*) n FROM subscription_cursors WHERE consumer_id='worker' AND last_seq>0",
              )
              .get()!.n,
            0,
          );
          result = c.kernel.postWorkerMessage(r.execution, {
            ...target,
            reviseDraftId: result.heldDraftId,
            body: "reviewed newest fact",
          });
        } else {
          assert.ok("event" in result && "event" in replay);
          assert.equal(replay.event.eventId, result.event.eventId);
          assert.equal(replay.deduplicated, true);
          assert.throws(
            () =>
              c.kernel.postWorkerMessage(r.execution, {
                ...target,
                sendDraft: true,
                heldDraftId: held.heldDraftId,
                basedOnRoomSeq: r.activation.toSeq,
                idempotencyKey: "revision",
              }),
            /idempotency/i,
            "revision identity cannot replay as unchanged send",
          );
        }
        assert.ok("event" in result, JSON.stringify(result));
        assert.equal(
          result.event.payload.body,
          newer ? "reviewed newest fact" : "revised",
        );
        assert.ok(
          c.kernel.finalReplies.read(c.host, {
            runAttemptId: r.run.runAttemptId,
          }),
        );
        assert.equal(
          Number(
            c.database
              .prepare(
                "SELECT last_seq FROM subscription_cursors WHERE consumer_id='worker'",
              )
              .get()!.last_seq,
          ),
          r.activation.toSeq,
        );
        assert.throws(
          () =>
            c.kernel.postWorkerMessage(r.execution, {
              ...request,
              body: "different",
            }),
          /idempotency/i,
        );
        assert.throws(
          () =>
            c.kernel.postWorkerMessage(r.execution, {
              ...request,
              idempotencyKey: "new-intent",
              body: "old draft edited again",
            }),
          /active|expired/i,
        );
      } finally {
        c.close();
      }
    });
  }
}

test("revision refuses expired, replaced, foreign execution and mismatched targets", () => {
  const c = fixture();
  try {
    c.post("question");
    const r = c.activate();
    c.post("new fact");
    const held = c.kernel.postWorkerMessage(r.execution, {
      channel: "#main",
      body: "old",
      basedOnRoomSeq: r.activation.toSeq,
    });
    assert.ok("state" in held && held.state === "held");
    const request = {
      channel: "#main",
      reviseDraftId: held.heldDraftId,
      body: "new",
    };
    const before = c.database.prepare("SELECT count(*) n FROM messages").get()!
      .n;
    for (const overrides of [
      { basedOnRoomSeq: 999 },
      { final: true as const },
      { sendDraft: true as const },
      { anyway: true },
      { attachmentIds: [] },
    ])
      assert.throws(
        () =>
          c.kernel.postWorkerMessage(r.execution, { ...request, ...overrides }),
        /revision requires body/,
      );
    assert.throws(
      () =>
        c.kernel.postWorkerMessage(r.execution, {
          ...request,
          threadId: "foreign-thread",
        }),
      /target|Thread|thread/,
    );
    // Persisted provenance must be checked even if the caller knows the ID.
    c.database
      .prepare(
        "UPDATE held_message_drafts SET activation_id=(SELECT activation_id FROM activations WHERE activation_id<>? LIMIT 1) WHERE held_draft_id=?",
      )
      .run(r.activation.activationId, held.heldDraftId);
    assert.throws(
      () => c.kernel.postWorkerMessage(r.execution, request),
      /outside this execution/,
    );
    c.database
      .prepare(
        "UPDATE held_message_drafts SET activation_id=?, expires_at_ms=1 WHERE held_draft_id=?",
      )
      .run(r.activation.activationId, held.heldDraftId);
    assert.throws(
      () => c.kernel.postWorkerMessage(r.execution, request),
      /expired/,
    );
    assert.equal(
      c.database.prepare("SELECT count(*) n FROM messages").get()!.n,
      before,
    );
    c.kernel.recordRuntimeTermination(c.host, {
      exit: { code: 0 },
      runAttemptId: r.run.runAttemptId,
      runtimeRunId: "runtime",
    });
    c.kernel.finishRunAttempt(c.host, {
      runAttemptId: r.run.runAttemptId,
      state: "exited",
      exitCode: 0,
    });
    assert.throws(
      () => c.kernel.postWorkerMessage(r.execution, request),
      /terminal|running|execution|finished|ended/,
    );
  } finally {
    c.close();
  }
});

test("revision preserves a Thread and does not treat unrelated top-level messages as reviewed", () => {
  const c = fixture();
  try {
    const root = c.post("thread question");
    const head = () =>
      Number(
        c.database
          .prepare("SELECT next_seq-1 n FROM rooms WHERE room_id=?")
          .get(c.room.roomId)!.n,
      );
    const thread = c.kernel.createThread(c.actor, {
      roomId: c.room.roomId,
      rootMessageId: root.event.aggregateId,
      recipientIds: [],
      basedOnRoomSeq: head(),
      idempotencyKey: "thread",
    }).thread;
    const r = c.activate();
    c.kernel.presentWorkerMessages(r.execution);
    c.kernel.markPresentedDeliverySent(c.host, {
      activationId: r.activation.activationId,
      consumerId: "worker",
      runAttemptId: r.run.runAttemptId,
    });
    c.kernel.replyThread(c.actor, {
      roomId: c.room.roomId,
      threadId: thread.threadId,
      body: "new thread fact",
      recipientIds: [r.activation.participantId],
      basedOnRoomSeq: head(),
      idempotencyKey: "thread-fact",
    });
    const held = c.kernel.postWorkerMessage(r.execution, {
      channel: `#main:${thread.threadId}`,
      body: "old",
      basedOnRoomSeq: r.activation.toSeq,
    });
    assert.ok("state" in held && held.state === "held");
    c.post("unrelated top-level fact after hold");
    assert.throws(
      () =>
        c.kernel.postWorkerMessage(r.execution, {
          channel: "#main",
          reviseDraftId: held.heldDraftId,
          body: "wrong top-level",
        }),
      /reply target/,
    );
    const sent = c.kernel.postWorkerMessage(r.execution, {
      reviseDraftId: held.heldDraftId,
      body: "thread revision",
    });
    assert.ok("event" in sent);
    assert.equal(sent.event.payload.threadId, thread.threadId);
    assert.equal(
      Number(
        c.database
          .prepare(
            "SELECT last_seq FROM subscription_cursors WHERE consumer_id='worker'",
          )
          .get()!.last_seq,
      ),
      r.activation.toSeq,
    );
    assert.equal(
      c.kernel.finalReplies.read(c.host, { runAttemptId: r.run.runAttemptId }),
      null,
      "a progress draft stays nonfinal",
    );
  } finally {
    c.close();
  }
});

test("optimized revision requires an originating reply marker, not an unproven draft notice", () => {
  const c = fixture();
  try {
    c.post("question");
    const r = c.activate();
    c.post("new fact");
    const held = c.kernel.postWorkerMessage(r.execution, {
      channel: "#main",
      body: "uncited draft",
    });
    assert.ok("state" in held && held.state === "held");
    assert.throws(
      () =>
        c.kernel.postWorkerMessage(r.execution, {
          reviseDraftId: held.heldDraftId,
          body: "revision",
        }),
      /original reply marker/,
    );
  } finally {
    c.close();
  }
});

test("reading a Thread after a marked hold cannot redirect or fabricate a new confirmation draft", () => {
  const c = fixture();
  try {
    const root = c.post("question");
    const r = c.activate();
    c.post("new fact");
    const held = c.kernel.postWorkerMessage(r.execution, {
      channel: "#main",
      body: "old",
      basedOnRoomSeq: r.activation.toSeq,
    });
    assert.ok("state" in held && held.state === "held");
    const head = Number(
      c.database
        .prepare("SELECT next_seq-1 n FROM rooms WHERE room_id=?")
        .get(c.room.roomId)!.n,
    );
    const thread = c.kernel.createThread(c.actor, {
      roomId: c.room.roomId,
      rootMessageId: root.event.aggregateId,
      recipientIds: [],
      basedOnRoomSeq: head,
      idempotencyKey: "later-thread",
    }).thread;
    c.kernel.workerTargetContext.read(r.execution, {
      channel: `#main:${thread.threadId}`,
    });
    const sent = c.kernel.postWorkerMessage(r.execution, {
      channel: "#main",
      reviseDraftId: held.heldDraftId,
      body: "revised top-level",
    });
    assert.ok("event" in sent, JSON.stringify(sent));
    assert.equal(sent.event.payload.threadId, undefined);
  } finally {
    c.close();
  }
});
