import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { type AuthenticatedHostContext, RoomKernel } from "../src/index.ts";
import { WAKE_BODY_MAX_MESSAGES } from "../src/activation-presented-window.ts";

/**
 * Owner ruling 2026-09-27 (contract §3, with the Human-@ wake rule): an
 * instance that was not woken still reads the Channel later. The wake
 * rendering prepends the Channel events after this consumer's cursor and
 * before the Activation range (a bounded catch-up), so the implicit
 * acknowledgement no longer crosses events the model was never shown. The
 * Activation range, its `fromSeq` (the latency anchor) and its budget priority
 * are unchanged; an older part that does not fit is stated, not listed.
 */

test("a woken instance's wake carries the Channel messages it was not woken for", () => {
  const f = fixture();
  try {
    f.human("Everyone, hello");
    f.finishTurn(f.activate("worker"), "worker: hi");
    const asked = f.human("@bystander what is the PID risk?");
    const answered = f.bystanderReply("bystander: PID reuse is the risk");
    const now = f.human("@worker do you agree?");

    const run = f.activate("worker");
    const rendered = f.kernel.presentWorkerMessages(run.execution);
    assert.equal(rendered.fromSeq, now, "the Activation range is unchanged");
    assert.equal(rendered.toSeq, now);
    const bodies = messageBodies(rendered.events);
    assert.deepEqual(bodies, [
      "@bystander what is the PID risk?",
      "bystander: PID reuse is the risk",
      "@worker do you agree?",
    ]);
    assert.ok(rendered.catchUpFromSeq !== undefined);
    assert.ok(rendered.catchUpFromSeq <= asked);
    assert.ok(answered < now);
    assert.equal(rendered.catchUpOmittedCount, 0);
    assert.equal(rendered.presentedThroughSeq, now);
  } finally {
    f.close();
  }
});

test("the implicit acknowledgement is continuous from the catch-up start", () => {
  const f = fixture();
  try {
    f.human("Everyone, hello");
    f.finishTurn(f.activate("worker"), "worker: hi");
    f.human("@bystander first");
    const now = f.human("@worker second");
    const run = f.activate("worker");
    f.kernel.presentWorkerMessages(run.execution);
    f.sent(run);
    const posted = f.kernel.postWorkerMessage(run.execution, {
      basedOnRoomSeq: now,
      body: "worker: done",
      idempotencyKey: "reply-after-catch-up",
    });
    assert.ok("event" in posted, JSON.stringify(posted));
    assert.equal(f.cursor("worker"), now);
  } finally {
    f.close();
  }
});

test("the instance's own earlier posts are covered but not rendered again", () => {
  const f = fixture();
  try {
    f.human("Everyone, hello");
    const turn = f.activate("worker");
    f.kernel.presentWorkerMessages(turn.execution);
    f.sent(turn);
    const own = f.kernel.postWorkerMessage(turn.execution, {
      basedOnRoomSeq: turn.scope.toSeq,
      body: "worker: my own answer",
      idempotencyKey: "own",
    });
    assert.ok("event" in own);
    f.finish(turn);
    f.human("@bystander your turn");
    const now = f.human("@worker again");
    const run = f.activate("worker");
    const rendered = f.kernel.presentWorkerMessages(run.execution);
    assert.deepEqual(messageBodies(rendered.events), [
      "@bystander your turn",
      "@worker again",
    ]);
    assert.ok(rendered.presentedSeqs.includes(own.event.roomSeq));
    assert.equal(rendered.presentedThroughSeq, now);
  } finally {
    f.close();
  }
});

test("a first delivery (no cursor yet) has no catch-up", () => {
  const f = fixture();
  try {
    f.human("@bystander before the worker ever ran");
    const now = f.human("@worker first wake");
    const run = f.activate("worker");
    const rendered = f.kernel.presentWorkerMessages(run.execution);
    assert.deepEqual(messageBodies(rendered.events), ["@worker first wake"]);
    assert.equal(rendered.catchUpFromSeq, undefined);
    assert.equal(rendered.fromSeq, now);
  } finally {
    f.close();
  }
});

test("the Activation range keeps budget priority; an older catch-up part is stated, not listed", () => {
  const f = fixture();
  try {
    f.human("Everyone, hello");
    f.finishTurn(f.activate("worker"), "worker: hi");
    const gap: number[] = [];
    for (let index = 0; index < WAKE_BODY_MAX_MESSAGES + 5; index++)
      gap.push(f.human(`@bystander note ${String(index)}`));
    const now = f.human("@worker summarise");
    const run = f.activate("worker");
    const rendered = f.kernel.presentWorkerMessages(run.execution);
    const bodies = messageBodies(rendered.events);
    assert.equal(bodies.at(-1), "@worker summarise");
    assert.equal(rendered.events.length, WAKE_BODY_MAX_MESSAGES);
    assert.equal(rendered.presentedThroughSeq, now);
    assert.equal(rendered.noticeCount, 0, "nothing in the range degraded");
    // The newest gap messages are shown; the older ones are summarised.
    assert.equal(bodies[0], `@bystander note ${String(6)}`);
    assert.equal(rendered.catchUpOmittedCount, 6);
    assert.equal(rendered.catchUpOmittedFromSeq, gap[0]);
    assert.equal(rendered.catchUpOmittedToSeq, gap[5]);
  } finally {
    f.close();
  }
});

test("a re-present in the same RunAttempt returns the same catch-up after the cursor moved", () => {
  const f = fixture();
  try {
    f.human("Everyone, hello");
    f.finishTurn(f.activate("worker"), "worker: hi");
    f.human("@bystander side note");
    const now = f.human("@worker go");
    const run = f.activate("worker");
    const first = f.kernel.presentWorkerMessages(run.execution);
    f.kernel.acknowledgeWorkerCursor(run.execution, { throughSeq: now });
    const again = f.kernel.presentWorkerMessages(run.execution);
    assert.equal(again.contentDigest, first.contentDigest);
    assert.equal(again.catchUpFromSeq, first.catchUpFromSeq);
    assert.deepEqual(messageBodies(again.events), messageBodies(first.events));
  } finally {
    f.close();
  }
});

test("another Room's messages never enter the catch-up", () => {
  const f = fixture();
  try {
    f.human("Everyone, hello");
    f.finishTurn(f.activate("worker"), "worker: hi");
    f.human("@bystander elsewhere", f.away.roomId);
    const now = f.human("@worker here");
    const run = f.activate("worker");
    const rendered = f.kernel.presentWorkerMessages(run.execution);
    assert.deepEqual(messageBodies(rendered.events), ["@worker here"]);
    assert.equal(rendered.fromSeq, now);
  } finally {
    f.close();
  }
});

test("review P1-2: a merged Activation names only the events that woke this instance as directed", () => {
  const f = fixture();
  try {
    const first = f.human("@worker question one");
    const other = f.human("@bystander a question only for you");
    const second = f.human("@worker question two");
    const run = f.activate("worker");
    assert.equal(run.scope.toSeq, second, "the queued Activation merged");
    const rendered = f.kernel.presentWorkerMessages(run.execution);
    assert.ok(rendered.presentedSeqs.includes(other));
    assert.deepEqual(rendered.directedSeqs, [first, second]);
  } finally {
    f.close();
  }
});

test("review P2-1: a re-present keeps the omitted-history summary after the cursor moved", () => {
  const f = fixture();
  try {
    f.human("Everyone, hello");
    f.finishTurn(f.activate("worker"), "worker: hi");
    for (let index = 0; index < WAKE_BODY_MAX_MESSAGES + 5; index++)
      f.human(`@bystander note ${String(index)}`);
    const now = f.human("@worker summarise");
    const run = f.activate("worker");
    const first = f.kernel.presentWorkerMessages(run.execution);
    assert.equal(first.catchUpOmittedCount, 6);
    f.kernel.acknowledgeWorkerCursor(run.execution, { throughSeq: now });
    const again = f.kernel.presentWorkerMessages(run.execution);
    assert.equal(again.contentDigest, first.contentDigest);
    assert.equal(again.catchUpFromSeq, first.catchUpFromSeq);
    assert.equal(again.catchUpOmittedCount, 6);
    assert.equal(again.catchUpOmittedFromSeq, first.catchUpOmittedFromSeq);
    assert.equal(again.catchUpOmittedToSeq, first.catchUpOmittedToSeq);
  } finally {
    f.close();
  }
});

test("review P2-1: when no catch-up body fits, the omitted history is still stated, first and on replay", () => {
  const f = fixture();
  try {
    f.human("Everyone, hello");
    f.finishTurn(f.activate("worker"), "worker: hi");
    const gap: number[] = [];
    for (let index = 0; index < 3; index++)
      gap.push(f.human(`@bystander note ${String(index)}`));
    f.human(`@worker ${"x".repeat(65_000)}`);
    const run = f.activate("worker");
    const first = f.kernel.presentWorkerMessages(run.execution);
    assert.equal(first.catchUpFromSeq, undefined, "no catch-up body fits");
    assert.equal(first.catchUpOmittedCount, 3);
    assert.equal(first.catchUpOmittedFromSeq, gap[0]);
    assert.equal(first.catchUpOmittedToSeq, gap[2]);
    const again = f.kernel.presentWorkerMessages(run.execution);
    assert.equal(again.catchUpOmittedCount, 3);
  } finally {
    f.close();
  }
});

function messageBodies(
  events: readonly { type: string; payload: unknown }[],
): string[] {
  return events
    .filter((event) => event.type === "message.posted")
    .map((event) => String((event.payload as { body: string }).body));
}

type Run = {
  activation: { activationId: string; toSeq: number };
  run: { runAttemptId: string };
  runtimeRunId: string;
  host: AuthenticatedHostContext;
  scope: {
    activationId: string;
    consumerId: string;
    hostId: string;
    participantId: string;
    roomId: string;
    runAttemptId: string;
    toSeq: number;
  };
  execution: ReturnType<RoomKernel["authorizeWorkerExecution"]>;
};

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "loom-catch-up-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const database = new DatabaseSync(databasePath, { readOnly: true });
  const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const actor = kernel.authenticateAccessToken(owner.accessToken);
  const room = kernel.createRoom(actor, { name: "Main", slug: "main" });
  const away = kernel.createRoom(actor, { name: "Away", slug: "away" });
  const agents: Record<string, string> = {};
  const hosts: Record<string, AuthenticatedHostContext> = {};
  for (const handle of ["worker", "bystander"]) {
    const agent = kernel.provisionPrincipal({ handle, kind: "agent" });
    agents[handle] = agent.principal.principalId;
    for (const roomId of [room.roomId, away.roomId])
      kernel.addMember(actor, {
        principalId: agent.principal.principalId,
        roomId,
      });
    hosts[handle] = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: `host-${handle}`,
        participantIds: [agent.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(hosts[handle]);
  }
  let sequence = 0;
  const activate = (handle: string, roomId = room.roomId): Run => {
    const host = hosts[handle]!;
    const activation = kernel.leaseNextActivation(host, { leaseMs: 600_000 });
    assert.ok(activation, `an Activation must be queued for ${handle}`);
    assert.equal(activation.roomId, roomId);
    const run = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    const runtimeRunId = `runtime-${run.runAttemptId}`;
    const runtime = {
      runAttemptId: run.runAttemptId,
      runtimeRunId,
      recoveryDescriptor: { driver: "fake", recoveryKey: "fake", metadata: {} },
    };
    kernel.prepareRunAttemptRuntime(host, runtime);
    kernel.markRunAttemptRunning(host, runtime);
    const scope = {
      activationId: activation.activationId,
      consumerId: handle,
      hostId: `host-${handle}`,
      participantId: agents[handle]!,
      roomId: activation.roomId,
      runAttemptId: run.runAttemptId,
      toSeq: activation.toSeq,
    };
    return {
      activation,
      execution: kernel.authorizeWorkerExecution(host, scope),
      host,
      run,
      runtimeRunId,
      scope,
    };
  };
  const sent = (turn: Run) =>
    kernel.markPresentedDeliverySent(turn.host, {
      activationId: turn.scope.activationId,
      consumerId: turn.scope.consumerId,
      runAttemptId: turn.scope.runAttemptId,
    });
  const finish = (turn: Run) => {
    kernel.acknowledgeWorkerCursor(turn.execution, {
      throughSeq: turn.activation.toSeq,
    });
    kernel.recordRuntimeTermination(turn.host, {
      exit: { code: 0 },
      runAttemptId: turn.run.runAttemptId,
      runtimeRunId: turn.runtimeRunId,
    });
    kernel.finishRunAttempt(turn.host, {
      exitCode: 0,
      runAttemptId: turn.run.runAttemptId,
      state: "exited",
    });
    kernel.completeActivation(turn.host, {
      activationId: turn.activation.activationId,
      consumerId: turn.scope.consumerId,
    });
  };
  /** Present, register as sent, reply at the head, then finish. */
  const finishTurn = (turn: Run, body: string) => {
    kernel.presentWorkerMessages(turn.execution);
    sent(turn);
    const posted = kernel.postWorkerMessage(turn.execution, {
      basedOnRoomSeq: turn.scope.toSeq,
      body,
      idempotencyKey: `turn-${++sequence}`,
    });
    assert.ok("event" in posted, JSON.stringify(posted));
    finish(turn);
  };
  const human = (body: string, roomId = room.roomId): number =>
    kernel.postRoomMessage(actor, {
      body,
      idempotencyKey: `human-${++sequence}`,
      roomId,
    }).event.roomSeq;
  /** The bystander answers its own pending Activation in the main Room. */
  const bystanderReply = (body: string): number => {
    const turn = activate("bystander");
    kernel.presentWorkerMessages(turn.execution);
    sent(turn);
    const posted = kernel.postWorkerMessage(turn.execution, {
      basedOnRoomSeq: turn.scope.toSeq,
      body,
      idempotencyKey: `bystander-${++sequence}`,
    });
    assert.ok("event" in posted, JSON.stringify(posted));
    finish(turn);
    return posted.event.roomSeq;
  };
  return {
    activate,
    away,
    bystanderReply,
    close() {
      database.close();
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
    cursor: (handle: string) =>
      Number(
        database
          .prepare(
            "SELECT last_seq AS n FROM subscription_cursors WHERE room_id=? AND participant_id=? AND consumer_id=?",
          )
          .get(room.roomId, agents[handle]!, handle)?.n ?? 0,
      ),
    finish,
    finishTurn,
    human,
    kernel,
    room,
    sent,
  };
}

test("schema 77 upgrades a schema 76 database: presented windows gain the frozen catch-up bound", () => {
  const directory = mkdtempSync(join(tmpdir(), "loom-catch-up-v77-"));
  const path = join(directory, "room.db");
  try {
    let kernel = new RoomKernel({ databasePath: path });
    kernel.initialize();
    kernel.close();
    const db = new DatabaseSync(path);
    db.exec(`
      ALTER TABLE activation_presented_windows DROP COLUMN catch_up_json;
      PRAGMA user_version = 76;
    `);
    db.close();
    kernel = new RoomKernel({ databasePath: path });
    kernel.initialize();
    kernel.close();
    const read = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(read.prepare("PRAGMA user_version").get()!.user_version, 85);
      assert.ok(
        read
          .prepare("PRAGMA table_info(activation_presented_windows)")
          .all()
          .some((column) => column.name === "catch_up_json"),
      );
      assert.equal(RoomKernel.inspectSchemaState(path).pending.length, 0);
    } finally {
      read.close();
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
