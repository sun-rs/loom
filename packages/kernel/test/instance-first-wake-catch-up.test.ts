import assert from "node:assert/strict";
import test from "node:test";
import "../src/index.ts";
import { WAKE_BODY_MAX_MESSAGES } from "../src/activation-presented-window.ts";
import {
  roleInstanceFixture,
  startInstanceRunFromQueue,
} from "./role-instance-fixture.ts";

const bodies = (
  events: ReadonlyArray<{ type: string; payload: Record<string, unknown> }>,
) =>
  events.filter((e) => e.type === "message.posted").map((e) => e.payload.body);

test("P77: first peer handoff carries Human opening without waking every member", () => {
  const f = roleInstanceFixture();
  try {
    const b = f.kernel.roles.instantiate(f.actor, {
      roleId: f.role.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "second-instance",
    });
    const opening = f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "Six steps: A reviews, B checks and hands back to A.",
      idempotencyKey: "opening",
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
    });
    assert.equal(opening.activationIds.length, 1);
    const a = startInstanceRunFromQueue(f);
    f.kernel.presentWorkerMessages(a.execution);
    f.kernel.markPresentedDeliverySent(f.host, a.scope);
    const handoff = f.kernel.postWorkerMessage(a.execution, {
      body: `@${b.agent.handle} verify my finding`,
      basedOnRoomSeq: a.activation.toSeq,
      idempotencyKey: "handoff",
    });
    assert.ok("event" in handoff);
    a.finish(0);
    const run = startInstanceRunFromQueue({ ...f, instance: b.instance });
    const first = f.kernel.presentWorkerMessages(run.execution);
    assert.deepEqual(bodies(first.events), [
      opening.event.payload.body,
      handoff.event.payload.body,
    ]);
    assert.equal(
      first.fromSeq,
      handoff.event.roomSeq,
      "activation obligation is not expanded",
    );
    assert.deepEqual(first.directedSeqs, [handoff.event.roomSeq]);
    assert.ok(first.presentedSeqs.includes(opening.event.roomSeq));
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) n FROM subscription_cursors WHERE participant_id=?",
        )
        .get(b.instance.instanceId)!.n,
      0,
      "presentation is not ACK",
    );
    f.kernel.markPresentedDeliverySent(f.host, run.scope);
    const posted = f.kernel.postWorkerMessage(run.execution, {
      body: "Verified",
      basedOnRoomSeq: handoff.event.roomSeq,
      idempotencyKey: "b-reply",
    });
    assert.ok("event" in posted);
    assert.equal(
      f.db
        .prepare(
          "SELECT last_seq FROM subscription_cursors WHERE room_id=? AND participant_id=? AND consumer_id='worker'",
        )
        .get(f.home.roomId, b.instance.instanceId)!.last_seq,
      handoff.event.roomSeq,
    );
    const again = f.kernel.presentWorkerMessages(run.execution);
    assert.equal(again.contentDigest, first.contentDigest);
    assert.deepEqual(bodies(again.events), bodies(first.events));
    run.finish(0);
    assert.equal(
      f.kernel.leaseNextActivation(f.host, { leaseMs: 60000 }),
      null,
      "no self wake or synthetic followup",
    );
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "next request",
      idempotencyKey: "next",
      recipients: [{ participantId: b.instance.instanceId, reason: "mention" }],
    });
    const next = startInstanceRunFromQueue({ ...f, instance: b.instance });
    assert.deepEqual(
      bodies(f.kernel.presentWorkerMessages(next.execution).events),
      ["next request"],
      "acknowledged opening is not repeated each turn",
    );
  } finally {
    f.close();
  }
});

test("a private-box first wake does not use the Channel membership floor", () => {
  const f = roleInstanceFixture();
  try {
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "Channel only",
      idempotencyKey: "channel",
      recipients: [],
    });
    f.kernel.postMessage(f.actor, {
      roomId: f.privateBox.roomId,
      body: "Private request",
      idempotencyKey: "private",
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
    });
    const run = startInstanceRunFromQueue(f);
    const rendered = f.kernel.presentWorkerMessages(run.execution);
    assert.deepEqual(bodies(rendered.events), ["Private request"]);
    assert.equal(rendered.catchUpFromSeq, undefined);
  } finally {
    f.close();
  }
});

test("first wake includes pre-join Channel context but excludes other channels and private boxes", () => {
  const f = roleInstanceFixture();
  try {
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "before new member",
      idempotencyKey: "old",
      recipients: [],
    });
    const b = f.kernel.roles.instantiate(f.actor, {
      roleId: f.role.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "late",
    });
    for (const [roomId, body] of [
      [f.home.roomId, "after joining"],
      [f.privateBox.roomId, "private secret"],
      [f.channel("elsewhere").roomId, "other channel"],
    ]) {
      f.kernel.postMessage(f.actor, {
        roomId: roomId!,
        body: body!,
        idempotencyKey: body!,
        recipients: [],
      });
    }
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "first direct request",
      idempotencyKey: "wake",
      recipients: [{ participantId: b.instance.instanceId, reason: "mention" }],
    });
    const run = startInstanceRunFromQueue({ ...f, instance: b.instance });
    assert.deepEqual(
      bodies(f.kernel.presentWorkerMessages(run.execution).events),
      ["before new member", "after joining", "first direct request"],
    );
  } finally {
    f.close();
  }
});

test("first catch-up keeps shared budget, reports omitted range and freezes its floor", () => {
  const f = roleInstanceFixture();
  try {
    const seqs = [];
    for (let i = 0; i < WAKE_BODY_MAX_MESSAGES + 5; i++)
      seqs.push(
        f.kernel.postMessage(f.actor, {
          roomId: f.home.roomId,
          body: `unaddressed ${i}`,
          idempotencyKey: `gap-${i}`,
          recipients: [],
        }).event.roomSeq,
      );
    const late = f.kernel.roles.instantiate(f.actor, {
      roleId: f.role.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "late-budget",
    });
    const wake = f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "current request",
      idempotencyKey: "wake",
      recipients: [
        { participantId: late.instance.instanceId, reason: "mention" },
      ],
    });
    const run = startInstanceRunFromQueue({ ...f, instance: late.instance }),
      first = f.kernel.presentWorkerMessages(run.execution);
    assert.equal(first.events.length, WAKE_BODY_MAX_MESSAGES);
    assert.equal(bodies(first.events)[0], "unaddressed 6");
    assert.equal(bodies(first.events).at(-1), "current request");
    assert.equal(first.catchUpOmittedCount, 6);
    assert.equal(first.catchUpOmittedFromSeq, seqs[0]);
    assert.equal(first.catchUpOmittedToSeq, seqs[5]);
    f.kernel.markPresentedDeliverySent(f.host, run.scope);
    f.kernel.postWorkerMessage(run.execution, {
      body: "done",
      basedOnRoomSeq: wake.event.roomSeq,
      idempotencyKey: "done",
    });
    assert.equal(
      f.db
        .prepare(
          `SELECT count(*) n FROM worker_message_presentations
      WHERE participant_id=? AND room_id=? AND room_seq<=?`,
        )
        .get(late.instance.instanceId, f.home.roomId, seqs[5]!)!.n,
      0,
      "omitted history must not receive read receipts",
    );
    const older = f.kernel.workerReads.history(run.execution, {
      channel: `#${f.home.slug}`,
      limit: 50,
    });
    assert.ok(
      JSON.stringify(older).includes("unaddressed 0"),
      "omitted history stays readable",
    );
    const again = f.kernel.presentWorkerMessages(run.execution);
    assert.equal(again.contentDigest, first.contentDigest);
    assert.deepEqual(again.events, first.events);
    assert.equal(again.catchUpOmittedCount, 6);
  } finally {
    f.close();
  }
});
