import assert from "node:assert/strict";
import test from "node:test";

import { validateRoomWakeHint } from "./room-wake";

test("Room wake hints are content-free discriminated envelopes", () => {
  assert.deepEqual(validateRoomWakeHint({
    schema: "rah.room-wake.v1",
    hintId: "outbox-1",
    topic: "room.event",
    eventId: "event-1",
    eventType: "message.posted",
    roomId: "room-one",
    roomSeq: 4,
  }), {
    schema: "rah.room-wake.v1",
    hintId: "outbox-1",
    topic: "room.event",
    eventId: "event-1",
    eventType: "message.posted",
    roomId: "room-one",
    roomSeq: 4,
  });
  assert.deepEqual(validateRoomWakeHint({
    schema: "rah.room-wake.v1",
    hintId: "outbox-2",
    topic: "inbox.available",
    eventId: "event-1",
    participantId: "agent-one",
    reason: "mention",
    disposition: "activation",
    roomId: "room-one",
    roomSeq: 4,
  }), {
    schema: "rah.room-wake.v1",
    hintId: "outbox-2",
    topic: "inbox.available",
    eventId: "event-1",
    participantId: "agent-one",
    reason: "mention",
    disposition: "activation",
    roomId: "room-one",
    roomSeq: 4,
  });

  assert.throws(
    () => validateRoomWakeHint({
      schema: "rah.room-wake.v1",
      hintId: "outbox-3",
      topic: "inbox.available",
      eventId: "event-1",
      participantId: "agent-one",
      reason: "mention",
      disposition: "activation",
      roomId: "room-one",
      roomSeq: 4,
      body: "secret",
    }),
    /unknown field body/,
  );
  assert.throws(
    () => validateRoomWakeHint({
      schema: "rah.room-wake.v2",
      hintId: "outbox-4",
      topic: "room.event",
      eventId: "event-1",
      eventType: "message.posted",
      roomId: "room-one",
      roomSeq: 4,
    }),
    /schema is invalid/,
  );
});
