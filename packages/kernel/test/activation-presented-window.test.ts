import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "../src/index.ts";
import {
  markPresentedWindowSent,
  readPresentedWindow,
  WAKE_BODY_MAX_BYTES,
  WAKE_BODY_MAX_MESSAGES,
} from "../src/activation-presented-window.ts";
import { ConflictError, ExecutionFencedError } from "../src/errors.ts";

/**
 * Real Kernel, real SQLite, real Activation/RunAttempt/credential chain. The
 * earlier version of this file built four hand-written tables, which let a
 * cursor bug survive review: nothing in it knew which sequences in a window
 * were `message.posted` at all.
 */
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

test("the Kernel renders the range itself and the record is server-owned", () => {
  const context = fixture();
  try {
    context.post("first");
    context.post("second");
    const run = context.activate();
    const rendered = context.kernel.presentWorkerMessages(run.execution);
    assert.deepEqual(
      rendered.events.map((event: { roomSeq: number }) => event.roomSeq),
      rendered.presentedSeqs,
    );
    assert.match(rendered.contentDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(rendered.sentAt, undefined);
    // A second render is the same record, byte for byte, and does not reset it.
    sent(context, run);
    const again = context.kernel.presentWorkerMessages(run.execution);
    assert.equal(again.contentDigest, rendered.contentDigest);
    assert.ok(again.sentAt !== undefined);
    // Present-only: no cursor moved.
    assert.equal(context.cursor(), 0);
  } finally {
    context.close();
  }
});

test("the cursor stops before the first message that degraded to a notice", () => {
  const context = fixture();
  try {
    const first = context.post("small one");
    const oversized = context.post("x".repeat(WAKE_BODY_MAX_BYTES + 1_000));
    const third = context.post("small two");
    context.nonMessageEvent();
    const run = context.activate();
    const rendered = context.kernel.presentWorkerMessages(run.execution);
    assert.deepEqual(rendered.presentedSeqs, [
      first.event.roomSeq,
      third.event.roomSeq,
    ]);
    assert.equal(rendered.noticeCount, 1);
    assert.equal(rendered.noticeFromSeq, oversized.event.roomSeq);
    assert.equal(rendered.presentedThroughSeq, first.event.roomSeq);
    sent(context, run);
    const result = context.kernel.postWorkerMessage(run.execution, {
      body: "answering the first",
      basedOnRoomSeq: run.scope.toSeq,
      idempotencyKey: "reply-1",
    });
    assert.ok("event" in result);
    // The whole point: the cursor stopped at the last presented message BEFORE
    // the notice, not at the window head, so the notice and everything after it
    // stay unread.
    assert.equal(context.cursor(), first.event.roomSeq);
    const check = context.kernel.syncWorker(run.execution, {
      replayDelivery: true,
    });
    const delivered = check.events
      .filter((event) => event.type === "message.posted")
      .map((event) => event.roomSeq);
    assert.ok(delivered.includes(oversized.event.roomSeq));
    assert.ok(delivered.includes(third.event.roomSeq));
  } finally {
    context.close();
  }
});

test("a window whose events were all presented reaches its head", () => {
  const context = fixture();
  try {
    const first = context.post("one");
    context.nonMessageEvent();
    const crossedSeq = context.head(context.room.roomId);
    const second = context.post("two");
    const run = context.activate();
    context.kernel.presentWorkerMessages(run.execution);
    sent(context, run);
    const result = context.kernel.postWorkerMessage(run.execution, {
      body: "answering both",
      basedOnRoomSeq: run.scope.toSeq,
      idempotencyKey: "reply-2",
    });
    assert.ok("event" in result);
    // The member event sits between the two messages and is itself presented,
    // so the acknowledgement reaches the second message, not the first.
    assert.ok(first.event.roomSeq < crossedSeq);
    assert.ok(crossedSeq < second.event.roomSeq);
    assert.equal(context.cursor(), second.event.roomSeq);
  } finally {
    context.close();
  }
});

test("a non-message event that degraded to a notice stops the cursor too", () => {
  const context = fixture();
  try {
    // Fill the message budget exactly, so the next event — which is NOT a
    // message — degrades. Before this batch the prefix scan ignored every type
    // but `message.posted` and would have crossed it in silence.
    const posted: number[] = [];
    for (let index = 0; index < WAKE_BODY_MAX_MESSAGES; index++)
      posted.push(context.post(`filler ${index}`).event.roomSeq);
    context.nonMessageEvent();
    const crossedSeq = context.head(context.room.roomId);
    // One more message so the Activation range actually reaches past the
    // non-message event; a frozen `to_seq` would otherwise end before it.
    const tail = context.post("after the membership change");
    const last = posted[posted.length - 1]!;
    const run = context.activate();
    const rendered = context.kernel.presentWorkerMessages(run.execution);
    assert.deepEqual(rendered.presentedSeqs, posted);
    assert.equal(rendered.noticeCount, 2);
    assert.equal(rendered.noticeToSeq, tail.event.roomSeq);
    assert.equal(rendered.noticeFromSeq, crossedSeq);
    assert.equal(rendered.presentedThroughSeq, last);
    sent(context, run);
    // Cited at the window head, the way a model that ignored the notice would.
    // The Kernel still acknowledges only the prefix: the membership event and
    // the message after it stay unread. (Over HTTP the model cannot even cite
    // this number any more — see the chain test on `knownRoomSeqs`.)
    const result = context.kernel.postWorkerMessage(run.execution, {
      body: "answering the ones I saw",
      basedOnRoomSeq: run.scope.toSeq,
      idempotencyKey: "reply-nm",
    });
    assert.ok("event" in result);
    assert.equal(context.cursor(), last);
    assert.ok(context.cursor() < crossedSeq);
  } finally {
    context.close();
  }
});

test("an unsent rendering acknowledges nothing", () => {
  const context = fixture();
  try {
    context.post("waiting");
    const run = context.activate();
    context.kernel.presentWorkerMessages(run.execution);
    // No markPresentedDeliverySent: the Host never reported handing this to a
    // runtime, so a Worker-side post is not evidence the model saw it.
    const result = context.kernel.postWorkerMessage(run.execution, {
      body: "posting anyway",
      basedOnRoomSeq: run.scope.toSeq,
      idempotencyKey: "reply-3",
    });
    assert.ok("event" in result);
    assert.equal(context.cursor(), 0);
  } finally {
    context.close();
  }
});

test("a post with no model-submitted causal marker acknowledges nothing", () => {
  const context = fixture();
  try {
    context.post("needs an explicit cursor");
    const run = context.activate();
    context.kernel.presentWorkerMessages(run.execution);
    sent(context, run);
    const result = context.kernel.postWorkerMessage(run.execution, {
      body: "no basedOnRoomSeq at all",
      idempotencyKey: "reply-4",
    });
    assert.ok("event" in result);
    assert.equal(context.cursor(), 0);
  } finally {
    context.close();
  }
});

test("a presented record can only be created and marked sent by the server and the Host", () => {
  const context = fixture();
  try {
    context.post("subject");
    const run = context.activate();
    // (b): the send registration needs a Host identity. There is no Worker
    // entry point at all — `recordPresentedDelivery(execution, ...)` is gone.
    assert.equal(
      (context.kernel as unknown as Record<string, unknown>)
        .recordPresentedDelivery,
      undefined,
    );
    assert.throws(
      () =>
        context.kernel.markPresentedDeliverySent(context.host, {
          activationId: run.scope.activationId,
          consumerId: "worker",
          runAttemptId: run.scope.runAttemptId,
        }),
      /no presented rendering to register as sent/u,
      "the send fact may only reference a rendering the server already wrote",
    );
    context.kernel.presentWorkerMessages(run.execution);
    context.kernel.markPresentedDeliverySent(context.host, {
      activationId: run.scope.activationId,
      consumerId: "worker",
      runAttemptId: run.scope.runAttemptId,
    });
    const stored = readPresentedWindow(context.database, run.scope);
    assert.ok(stored?.sentAt);
    assert.equal(stored.sentByHostId, "host");
    // Idempotent for the same Host, refused for a different one.
    context.kernel.markPresentedDeliverySent(context.host, {
      activationId: run.scope.activationId,
      consumerId: "worker",
      runAttemptId: run.scope.runAttemptId,
    });
    assert.throws(
      () =>
        markPresentedWindowSent(
          context.database,
          {
            activationId: run.scope.activationId,
            consumerId: "worker",
            runAttemptId: run.scope.runAttemptId,
          },
          "other-host",
          "2026-09-18T00:00:00.000Z",
        ),
      ConflictError,
    );
    // Neither the range nor the digest moved.
    const after = readPresentedWindow(context.database, run.scope);
    assert.equal(after?.contentDigest, stored.contentDigest);
    assert.equal(after?.toSeq, stored.toSeq);
  } finally {
    context.close();
  }
});

test("a finished RunAttempt renders nothing", () => {
  const context = fixture();
  try {
    context.post("stale");
    const run = context.activate();
    context.kernel.recordRuntimeTermination(context.host, {
      runAttemptId: run.scope.runAttemptId,
      runtimeRunId: "runtime",
      exit: { code: 0 },
    });
    context.kernel.finishRunAttempt(context.host, {
      runAttemptId: run.scope.runAttemptId,
      state: "exited",
      exitCode: 0,
    });
    // The credential fence fires first — a terminal RunAttempt's credential is
    // no longer current — and `renderPresentedWindow`'s own terminal-state
    // guard stands behind it for any future caller that bypasses the fence.
    assert.throws(
      () => context.kernel.presentWorkerMessages(run.execution),
      ExecutionFencedError,
    );
  } finally {
    context.close();
  }
});

test("the phase table's fields are readable without any new measurement", () => {
  const context = fixture();
  try {
    const first = context.post("a question to time");
    const run = context.activate();
    const before = context.kernel.readPresentedDeliveryPhases(run.execution);
    assert.equal(before.postedAt, first.event.createdAt, "落库");
    assert.ok(before.injectedAt, "注入 (RunAttempt start)");
    assert.equal(before.renderedAt, undefined);
    assert.equal(before.acceptedAt, undefined);
    assert.equal(before.firstReplyAt, undefined);
    context.kernel.presentWorkerMessages(run.execution);
    sent(context, run);
    context.kernel.postWorkerMessage(run.execution, {
      body: "the reply",
      basedOnRoomSeq: run.scope.toSeq,
      idempotencyKey: "phase-reply",
    });
    const after = context.kernel.readPresentedDeliveryPhases(run.execution);
    assert.ok(after.renderedAt, "present");
    assert.ok(after.acceptedAt, "接受");
    assert.ok(after.firstReplyAt, "首帖");
    assert.ok(Date.parse(after.renderedAt!) >= Date.parse(after.postedAt!));
    assert.ok(Date.parse(after.firstReplyAt!) >= Date.parse(after.acceptedAt!));
  } finally {
    context.close();
  }
});

test("execution-audit events are covered by the window without being rendered or spending its budget", () => {
  const context = fixture();
  try {
    // A second Host serves the bystander, so its lease/run audit events land in
    // this Room between two messages that both belong to the worker's range.
    const bystanderId = context.database
      .prepare("SELECT principal_id AS id FROM principals WHERE handle=?")
      .get("bystander")!.id as string;
    const otherHost = context.kernel.authenticateHostAccessToken(
      context.kernel.provisionHostCredential({
        hostId: "other-host",
        participantIds: [bystanderId],
      }).accessToken,
    );
    context.kernel.heartbeatHost(otherHost);
    const first = context.kernel.postMessage(context.actor, {
      body: "both of you",
      roomId: context.room.roomId,
      recipients: [
        { participantId: context.agentId, reason: "mention" },
        { participantId: bystanderId, reason: "mention" },
      ],
      idempotencyKey: "audit-first",
    });
    const leased = context.kernel.leaseNextActivation(otherHost, {
      leaseMs: 600_000,
    });
    assert.ok(leased);
    context.kernel.createRunAttempt(otherHost, {
      activationId: leased.activationId,
    });
    const second = context.post("only you");
    const run = context.activate();
    const auditSeqs = (
      context.database
        .prepare(
          "SELECT room_seq, type FROM room_events WHERE room_id=? AND room_seq>? AND room_seq<?",
        )
        .all(
          context.room.roomId,
          first.event.roomSeq,
          second.event.roomSeq,
        ) as { room_seq: number; type: string }[]
    ).map((row) => row.room_seq);
    assert.ok(auditSeqs.length > 0, "the fixture must interleave audit events");
    const rendered = context.kernel.presentWorkerMessages(run.execution);
    assert.deepEqual(
      rendered.events.map((event) => event.roomSeq),
      [first.event.roomSeq, second.event.roomSeq],
      "message-check projection semantics: audit events are not rendered",
    );
    for (const seq of auditSeqs)
      assert.ok(rendered.presentedSeqs.includes(seq));
    assert.equal(rendered.noticeCount, 0);
    assert.equal(rendered.presentedThroughSeq, run.scope.toSeq);
    sent(context, run);
    context.kernel.postWorkerMessage(run.execution, {
      body: "answering both messages",
      basedOnRoomSeq: rendered.presentedThroughSeq,
      idempotencyKey: "audit-reply",
    });
    assert.equal(context.cursor(), run.scope.toSeq);
  } finally {
    context.close();
  }
});

test("a late acceptance for a RunAttempt that already finished registers nothing", () => {
  const context = fixture();
  try {
    context.post("asked once");
    const run = context.activate();
    const rendered = context.kernel.presentWorkerMessages(run.execution);
    // The model posted before the acceptance signal: the marker is parked.
    context.kernel.postWorkerMessage(run.execution, {
      body: "an answer",
      basedOnRoomSeq: rendered.presentedThroughSeq,
      idempotencyKey: "late-reply",
    });
    assert.equal(context.cursor(), 0);
    context.kernel.recordRuntimeTermination(context.host, {
      runAttemptId: run.scope.runAttemptId,
      runtimeRunId: "runtime",
      exit: { code: 1 },
    });
    context.kernel.finishRunAttempt(context.host, {
      runAttemptId: run.scope.runAttemptId,
      state: "failed",
      exitCode: 1,
    });
    // The receipt arrives after the RunAttempt reached a terminal state.
    sent(context, run);
    assert.equal(context.cursor(), 0);
    assert.equal(
      readPresentedWindow(context.database, run.scope)?.sentAt,
      undefined,
    );
  } finally {
    context.close();
  }
});

test("a retry after an attempt that neither posted nor confirmed delivery is flagged on the next rendering only", () => {
  const f = fixture();
  try {
    f.post("please look");
    const first = f.activate();
    const rendered = f.kernel.presentWorkerMessages(first.execution);
    assert.equal(rendered.previousAttemptUnconfirmed, undefined);
    const end = (attempt: { run: { runAttemptId: string } }) => {
      f.kernel.recordRuntimeTermination(f.host, {
        exit: { code: 0 },
        runAttemptId: attempt.run.runAttemptId,
        runtimeRunId: "runtime",
      });
      f.kernel.finishRunAttempt(f.host, {
        runAttemptId: attempt.run.runAttemptId,
        state: "exited",
        exitCode: 0,
      });
    };
    end(first);
    let failure = "";
    assert.throws(
      () => {
        try {
          f.kernel.completeActivation(f.host, {
            activationId: first.activation.activationId,
            consumerId: "worker",
          });
        } catch (error) {
          failure = (error as Error).message;
          throw error;
        }
      },
      (error: unknown) =>
        (error as { code?: string }).code === "delivery_not_proven",
    );
    f.kernel.retryActivation(f.host, {
      activationId: first.activation.activationId,
      error: failure,
      retryAfterMs: 0,
    });
    const second = f.activate();
    assert.equal(second.activation.activationId, first.activation.activationId);
    assert.equal(
      f.kernel.presentWorkerMessages(second.execution)
        .previousAttemptUnconfirmed,
      true,
    );
    // A later retry for another reason carries no reminder.
    end(second);
    f.kernel.retryActivation(f.host, {
      activationId: first.activation.activationId,
      error: "runtime exited with code 1",
      retryAfterMs: 0,
    });
    const third = f.activate();
    assert.equal(
      f.kernel.presentWorkerMessages(third.execution)
        .previousAttemptUnconfirmed,
      undefined,
    );
  } finally {
    f.close();
  }
});

test("a delivery-unproven retry whose previous attempt did post carries no reminder", () => {
  const f = fixture();
  try {
    f.post("please look");
    const first = f.activate();
    // A post without a causal marker commits but confirms nothing.
    const posted = f.kernel.postWorkerMessage(first.execution, {
      body: "on it",
    });
    assert.ok("event" in posted);
    f.kernel.recordRuntimeTermination(f.host, {
      exit: { code: 0 },
      runAttemptId: first.run.runAttemptId,
      runtimeRunId: "runtime",
    });
    f.kernel.finishRunAttempt(f.host, {
      runAttemptId: first.run.runAttemptId,
      state: "exited",
      exitCode: 0,
    });
    let failure = "";
    try {
      f.kernel.completeActivation(f.host, {
        activationId: first.activation.activationId,
        consumerId: "worker",
      });
    } catch (error) {
      failure = (error as Error).message;
    }
    assert.match(failure, /not acknowledged/u);
    f.kernel.retryActivation(f.host, {
      activationId: first.activation.activationId,
      error: failure,
      retryAfterMs: 0,
    });
    const second = f.activate();
    const rendered = f.kernel.presentWorkerMessages(second.execution);
    assert.equal(rendered.previousAttemptUnconfirmed, undefined);
    // The retry names the committed post so the wake asks for confirmation.
    assert.equal(
      rendered.previousAttemptReplyMessageId,
      posted.event.aggregateId,
    );
  } finally {
    f.close();
  }
});
