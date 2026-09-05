import assert from "node:assert/strict";
import test from "node:test";

import { getOrCreateBoundedSession } from "../src/bounded-session-cache.ts";

test("Room and Message session caches retain a strict least-recently-used bound", () => {
  const sessions = new Map<string, { roomId: string }>();
  for (let index = 1; index <= 10; index += 1) {
    const roomId = `room-${String(index)}`;
    getOrCreateBoundedSession(sessions, roomId, () => ({ roomId }), 8);
  }
  assert.deepEqual(
    [...sessions.keys()],
    [
      "room-3",
      "room-4",
      "room-5",
      "room-6",
      "room-7",
      "room-8",
      "room-9",
      "room-10",
    ],
  );

  const reused = getOrCreateBoundedSession(
    sessions,
    "room-3",
    () => ({ roomId: "must-not-create" }),
    8,
  );
  assert.equal(reused.roomId, "room-3");
  getOrCreateBoundedSession(
    sessions,
    "room-11",
    () => ({ roomId: "room-11" }),
    8,
  );
  assert.equal(sessions.has("room-4"), false);
  assert.equal(sessions.has("room-3"), true);
});
