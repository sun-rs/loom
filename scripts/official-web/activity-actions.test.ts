import assert from "node:assert/strict";
import { test } from "node:test";
import { activityMarkRequest } from "../../frontends/raft/loom/activity-actions.ts";
test("activity actions preserve exact visible frontier and thread scope, without conflating read and done", () => {
  const row = {
    message: { roomId: "r" },
    activityFrontier: { throughSeq: 17, threadId: "t" },
  };
  for (const action of ["read", "unread", "done"] as const)
    assert.deepEqual(activityMarkRequest(row, action), {
      roomId: "r",
      throughSeq: 17,
      threadId: "t",
      action,
    });
  assert.equal(
    activityMarkRequest({ message: { roomId: "r" } }, "done"),
    undefined,
  );
});
