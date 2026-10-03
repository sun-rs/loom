import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { firstRunReplay, firstRunMessageKey } from "../src/agent-first-run.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
} from "./role-instance-fixture.ts";

test("a real Role instance has no synthetic greeting; its first directed turn preserves ACK, durable delivery and exact replay", () => {
  const f = roleInstanceFixture();
  try {
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) n FROM room_events WHERE type='agent.first_run_requested'",
        )
        .get()!.n,
      0,
    );
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM activations").get()!.n,
      0,
    );
    const created = f.db
      .prepare(
        "SELECT * FROM room_events WHERE type='instance.created' AND aggregate_id=?",
      )
      .get(f.instance.instanceId)!;
    const firstRunReplay = f.kernel.roles.instantiate(f.actor, {
      roleId: f.role.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: Number(created.room_seq) - 2,
      idempotencyKey: "instance",
    });
    assert.equal(firstRunReplay.deduplicated, true);
    assert.equal(firstRunReplay.event.eventId, created.event_id);
    assert.equal(firstRunReplay.instance.instanceId, f.instance.instanceId);
    const run = startInstanceRun(f);
    const delivery = f.kernel.syncWorker(run.execution, {});
    assert.ok(delivery.cursorAfter >= run.activation.toSeq);
    const request = {
      body: "Hello from the instance",
      threadId: null,
      idempotencyKey: "first-directed-reply",
    };
    const sent = f.kernel.postWorkerMessage(run.execution, request);
    assert.ok("event" in sent);
    const repeated = f.kernel.postWorkerMessage(run.execution, request);
    assert.ok("event" in repeated);
    assert.equal(repeated.deduplicated, true);
    assert.equal(repeated.event.eventId, sent.event.eventId);
    assert.throws(
      () =>
        f.kernel.postWorkerMessage(run.execution, {
          ...request,
          body: "Changed content",
        }),
      /idempotency|different|already/i,
    );
    f.kernel.acknowledgeWorkerCursor(run.execution, {
      throughSeq: delivery.cursorAfter,
    });
    f.kernel.recordRuntimeTermination(f.host, {
      runAttemptId: run.run.runAttemptId,
      runtimeRunId: run.runtime.runtimeRunId,
      exit: { code: 0 },
    });
    f.kernel.finishRunAttempt(f.host, {
      runAttemptId: run.run.runAttemptId,
      state: "exited",
      exitCode: 0,
    });
    // Posting may acknowledge delivered context, so use a different consumer:
    // process success still cannot manufacture that consumer's delivery ACK.
    assert.throws(
      () =>
        f.kernel.completeActivation(f.host, {
          activationId: run.activation.activationId,
          consumerId: "never-read",
        }),
      /acknowledg|cursor|delivery/i,
    );
    f.kernel.completeActivation(f.host, {
      activationId: run.activation.activationId,
      consumerId: "worker",
    });
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) n FROM room_events WHERE type='message.posted' AND actor_id=?",
        )
        .get(f.instance.instanceId)!.n,
      1,
    );
    assert.equal(f.db.prepare("SELECT count(*) n FROM tasks").get()!.n, 0);
  } finally {
    f.close();
  }
});

test("historical firstRunReplay retains reserved identity, once-only key and durable event compatibility without scheduling a persona", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE room_events(event_id TEXT, room_id TEXT, type TEXT, room_seq INTEGER, payload_json TEXT, idempotency_key TEXT, actor_id TEXT);
      CREATE TABLE inbox_items(event_id TEXT, participant_id TEXT);
      CREATE TABLE activations(activation_id TEXT, participant_id TEXT, from_seq INTEGER, to_seq INTEGER);`);
    const key = firstRunMessageKey("persona"),
      scope = {
        participantId: "persona",
        roomId: "room",
        activationId: "historic",
      };
    db.prepare("INSERT INTO room_events VALUES(?,?,?,?,?,?,?)").run(
      "request",
      "room",
      "agent.first_run_requested",
      1,
      JSON.stringify({ greetingEnabled: true }),
      "request-key",
      "system",
    );
    db.exec(
      "INSERT INTO inbox_items VALUES('request','persona'); INSERT INTO activations VALUES('historic','persona',1,1)",
    );
    const decode = (row: Record<string, unknown>) => row as never;
    assert.equal(firstRunReplay(db, scope, key, null, decode), undefined);
    assert.throws(
      () =>
        firstRunReplay(db, scope, firstRunMessageKey("other"), null, decode),
      /this Agent/,
    );
    assert.throws(
      () => firstRunReplay(db, scope, key, "thread", decode),
      /top-level/,
    );
    db.prepare("INSERT INTO room_events VALUES(?,?,?,?,?,?,?)").run(
      "sent",
      "room",
      "message.posted",
      2,
      "{}",
      key,
      "persona",
    );
    assert.equal(
      (
        firstRunReplay(db, scope, key, null, decode) as unknown as {
          event_id: string;
        }
      ).event_id,
      "sent",
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM room_events WHERE type='message.posted'",
        )
        .get()!.n,
      1,
    );
    assert.throws(
      () =>
        firstRunReplay(
          db,
          { ...scope, activationId: "missing" },
          key,
          null,
          decode,
        ),
      /No first-greeting/,
    );
  } finally {
    db.close();
  }
});
