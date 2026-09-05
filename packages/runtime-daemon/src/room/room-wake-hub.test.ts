import assert from "node:assert/strict";
import test from "node:test";

import { RoomWakeHub } from "./room-wake-hub";

const hint = {
  schema: "rah.room-wake.v1" as const,
  hintId: "outbox-one",
  topic: "room.event" as const,
  eventId: "event-one",
  eventType: "message.posted",
  roomId: "room-one",
  roomSeq: 2,
};

test("Room wake hub isolates listeners and keeps hints lossy and content-free", () => {
  const errors: unknown[] = [];
  const received: string[] = [];
  const hub = new RoomWakeHub({ onListenerError: (error) => errors.push(error) });
  hub.subscribe(() => { throw new Error("broken listener"); });
  const unsubscribe = hub.subscribe((value) => received.push(value.hintId));
  assert.equal(hub.publish(hint), 1);
  assert.deepEqual(received, ["outbox-one"]);
  assert.equal(errors.length, 1);
  unsubscribe();
  assert.equal(hub.publish(hint), 0);
  hub.close();
  assert.throws(() => hub.subscribe(() => undefined), /closed/);
  assert.throws(() => hub.publish(hint), /closed/);
});
