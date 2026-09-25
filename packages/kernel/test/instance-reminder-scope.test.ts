import assert from "node:assert/strict";
import test from "node:test";
import {
  roleInstanceFixture,
  startInstanceRunFromQueue,
  type RoleInstanceFixture,
} from "./role-instance-fixture.ts";

// S3 review P1-1/P1-2: a Role instance's reminders belong to the room whose
// turn created them. A channel turn cannot list or replay private reminders,
// and a legacy cross-room reminder never fires private context into a
// channel. Fake Host, temporary database; assertions read durable state.

const count = (f: RoleInstanceFixture, sql: string, ...values: string[]) =>
  Number(f.db.prepare(sql).get(...values)!.n);

function startTurn(f: RoleInstanceFixture, roomId: string, body: string) {
  const message = f.kernel.postMessage(f.actor, {
    roomId,
    body,
    idempotencyKey: `turn-${String(Math.random())}`,
    recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
  });
  const work = startInstanceRunFromQueue(f);
  assert.equal(work.activation.roomId, roomId);
  return { ...work, messageId: message.event.aggregateId };
}

const scopeRefusal = /outside this Worker execution scope/;

test("a channel turn cannot list or replay the instance's private reminders", () => {
  const f = roleInstanceFixture();
  try {
    const priv = startTurn(f, f.privateBox.roomId, "private question");
    const basedOnRoomSeq = priv.activation.toSeq;
    const schedule = {
      basedOnRoomSeq,
      delaySeconds: 600,
      idempotencyKey: "private-schedule",
      messageId: priv.messageId,
      title: "PRIVATE SECRET",
    };
    const scheduled = f.kernel.reminders.schedule(priv.execution, schedule);
    const snoozedId = f.kernel.reminders.schedule(priv.execution, {
      ...schedule,
      idempotencyKey: "private-schedule-snoozed",
      title: "PRIVATE SNOOZED",
    }).reminder.reminderId;
    const updatedId = f.kernel.reminders.schedule(priv.execution, {
      ...schedule,
      idempotencyKey: "private-schedule-updated",
      title: "PRIVATE BEFORE UPDATE",
    }).reminder.reminderId;
    const canceledId = f.kernel.reminders.schedule(priv.execution, {
      ...schedule,
      idempotencyKey: "private-schedule-canceled",
      title: "PRIVATE CANCELED",
    }).reminder.reminderId;
    const cancel = { idempotencyKey: "private-cancel", reminderId: canceledId };
    const snooze = {
      delaySeconds: 900,
      idempotencyKey: "private-snooze",
      reminderId: snoozedId,
    };
    const update = {
      idempotencyKey: "private-update",
      reminderId: updatedId,
      title: "PRIVATE UPDATED",
    };
    f.kernel.reminders.cancel(priv.execution, cancel);
    f.kernel.reminders.snooze(priv.execution, snooze);
    f.kernel.reminders.update(priv.execution, update);
    // The private turn itself still sees and replays its own reminders.
    assert.equal(
      f.kernel.reminders.listWorker(priv.execution, { all: true }).length,
      4,
    );
    assert.equal(
      f.kernel.reminders.cancel(priv.execution, cancel).deduplicated,
      true,
    );
    priv.finish(0);

    const channel = startTurn(f, f.home.roomId, "channel work");
    const own = f.kernel.reminders.schedule(channel.execution, {
      delaySeconds: 600,
      idempotencyKey: "channel-schedule",
      messageId: channel.messageId,
      title: "channel follow-up",
    }).reminder.reminderId;
    const listed = (
      input: Parameters<typeof f.kernel.reminders.listWorker>[1],
    ) =>
      f.kernel.reminders
        .listWorker(channel.execution, input)
        .map((reminder) => reminder.reminderId);
    assert.deepEqual(listed({}), [own], "default scheduled/fired list");
    assert.deepEqual(listed({ status: "scheduled" }), [own]);
    assert.deepEqual(listed({ all: true }), [own], "all list");
    assert.deepEqual(listed({ status: "canceled" }), [], "canceled list");
    assert.deepEqual(listed({ statuses: ["canceled", "scheduled"] }), [own]);

    const unchanged = () =>
      f.db
        .prepare(
          "SELECT reminder_id, status, title, version FROM reminders ORDER BY reminder_id",
        )
        .all();
    const before = unchanged();
    assert.throws(
      () => f.kernel.reminders.cancel(channel.execution, cancel),
      scopeRefusal,
      "cancel replay",
    );
    assert.throws(
      () => f.kernel.reminders.snooze(channel.execution, snooze),
      scopeRefusal,
      "snooze replay",
    );
    assert.throws(
      () => f.kernel.reminders.update(channel.execution, update),
      scopeRefusal,
      "update replay",
    );
    // Same request bytes, including the original cursor, so the refusal is the
    // scope check and not an idempotency conflict.
    assert.throws(
      () => f.kernel.reminders.schedule(channel.execution, schedule),
      scopeRefusal,
      "schedule replay",
    );
    assert.deepEqual(unchanged(), before);
    assert.equal(scheduled.reminder.roomId, f.privateBox.roomId);
  } finally {
    f.close();
  }
});

/** Rebuilds the parent-revision data shape: a private-turn reminder whose
 * target was allowed to be the channel, now due. */
function legacyCrossRoomReminder(
  f: RoleInstanceFixture,
  repeat: string | undefined,
) {
  const priv = startTurn(f, f.privateBox.roomId, "private question");
  const reminderId = f.kernel.reminders.schedule(priv.execution, {
    delaySeconds: 600,
    idempotencyKey: `legacy-${repeat ?? "once"}`,
    messageId: priv.messageId,
    title: "PRIVATE LEGACY TITLE",
    ...(repeat === undefined ? {} : { repeat, timezone: "UTC" }),
  }).reminder.reminderId;
  priv.finish(0);
  f.db
    .prepare(
      "UPDATE reminders SET target_room_id=?, fire_at_ms=?, fire_at=? WHERE reminder_id=?",
    )
    .run(
      f.home.roomId,
      Date.now() - 1_000,
      new Date(Date.now() - 1_000).toISOString(),
      reminderId,
    );
  return reminderId;
}

for (const repeat of [undefined, "every:15m"]) {
  test(`an upgraded cross-room ${repeat === undefined ? "one-shot" : "repeating"} instance reminder fires nothing and stops`, () => {
    const f = roleInstanceFixture();
    try {
      const reminderId = legacyCrossRoomReminder(f, repeat);
      const footprint = () => ({
        roomEvents: count(
          f,
          "SELECT count(*) n FROM room_events WHERE type='reminder.fired'",
        ),
        homeHead: f.head(f.home.roomId),
        privateHead: f.head(f.privateBox.roomId),
        inbox: count(f, "SELECT count(*) n FROM inbox_items"),
        activations: count(f, "SELECT count(*) n FROM activations"),
      });
      const before = footprint();
      const first = f.kernel.reminders.reconcileDue();
      assert.equal(first.delivered, 0);
      assert.equal(first.pending, 0, "not retried");
      assert.deepEqual(footprint(), before, "no public event, no derivation");
      assert.equal(
        f.db
          .prepare(
            "SELECT state FROM reminder_fire_receipts WHERE reminder_id=?",
          )
          .get(reminderId)!.state,
        "obsolete",
      );
      assert.equal(
        f.db
          .prepare("SELECT status FROM reminders WHERE reminder_id=?")
          .get(reminderId)!.status,
        "canceled",
        "future schedule stopped",
      );
      // Later reconciles never stage it again.
      assert.equal(f.kernel.reminders.reconcileDue().staged, 0);
      assert.equal(
        count(
          f,
          "SELECT count(*) n FROM reminder_fire_receipts WHERE reminder_id=?",
          reminderId,
        ),
        1,
      );
      assert.deepEqual(footprint(), before);
    } finally {
      f.close();
    }
  });
}
