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
  const other = kernel.provisionPrincipal({ handle: "bystander", kind: "agent" });
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
  const post = (body: string, options: { mention?: boolean; roomId?: string } = {}) =>
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
  run: { scope: { activationId: string; consumerId: string; runAttemptId: string } },
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
