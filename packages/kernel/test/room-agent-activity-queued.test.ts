import assert from "node:assert/strict";
import test from "node:test";
import {
  roleInstanceFixture,
  startInstanceRunFromQueue,
  type RoleInstanceFixture,
} from "./role-instance-fixture.ts";

// Console batch 2 (B3): Room Agent activity reports whether this Room holds a
// queued Activation for the instance. The flag is scoped to the listed Room:
// private-box work never shows in the channel result. Fake Host only.

const activityIn = (f: RoleInstanceFixture, roomId: string) => {
  const entry = f.kernel
    .listRoomAgentActivity(f.actor, { roomId })
    .find(({ participantId }) => participantId === f.instance.instanceId);
  assert.ok(entry, "the instance is listed in the Room");
  return { queued: entry.queued, state: entry.state };
};

const post = (f: RoleInstanceFixture, roomId: string, key: string) =>
  f.kernel.postMessage(f.actor, {
    roomId,
    body: `work ${key}`,
    idempotencyKey: key,
    recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
  });

test("an idle instance reports queued=false", () => {
  const f = roleInstanceFixture();
  try {
    assert.deepEqual(activityIn(f, f.home.roomId), {
      queued: false,
      state: "idle",
    });
  } finally {
    f.close();
  }
});

test("only a queued Activation reports waking with queued=true", () => {
  const f = roleInstanceFixture();
  try {
    post(f, f.home.roomId, "queued-only");
    assert.deepEqual(activityIn(f, f.home.roomId), {
      queued: true,
      state: "waking",
    });
  } finally {
    f.close();
  }
});

test("a leased run with a queued follow-up reports working with queued=true", () => {
  const f = roleInstanceFixture();
  try {
    post(f, f.home.roomId, "first");
    startInstanceRunFromQueue(f);
    assert.deepEqual(activityIn(f, f.home.roomId), {
      queued: false,
      state: "working",
    });
    post(f, f.home.roomId, "follow-up");
    const queuedRows = Number(
      f.db
        .prepare(
          "SELECT count(*) n FROM activations WHERE room_id=? AND participant_id=? AND state='queued'",
        )
        .get(f.home.roomId, f.instance.instanceId)!.n,
    );
    assert.equal(queuedRows, 1, "the follow-up is durable queued work");
    assert.deepEqual(activityIn(f, f.home.roomId), {
      queued: true,
      state: "working",
    });
  } finally {
    f.close();
  }
});

test("private-box queued work never marks the channel result as queued", () => {
  const f = roleInstanceFixture();
  try {
    post(f, f.privateBox.roomId, "private-queued");
    assert.deepEqual(activityIn(f, f.home.roomId), {
      queued: false,
      state: "idle",
    });
    assert.equal(activityIn(f, f.privateBox.roomId).queued, true);

    // Busy in the channel while the private box queues: still not queued here.
    const other = roleInstanceFixture();
    try {
      post(other, other.home.roomId, "channel-run");
      startInstanceRunFromQueue(other);
      post(other, other.privateBox.roomId, "private-while-busy");
      assert.deepEqual(activityIn(other, other.home.roomId), {
        queued: false,
        state: "working",
      });
    } finally {
      other.close();
    }
  } finally {
    f.close();
  }
});
