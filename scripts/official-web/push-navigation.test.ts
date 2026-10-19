import assert from "node:assert/strict";
import test from "node:test";
import { pushTargetParams } from "../../frontends/raft/loom/push-navigation.ts";
test("resolved message lands in its exact thread; tasks reuse existing task owner", () => {
  assert.deepEqual(
    Object.fromEntries(
      pushTargetParams({
        kind: "message",
        roomId: "r",
        messageId: "m",
        threadId: "t",
        rootMessageId: "root",
      }),
    ),
    { room: "r", message: "m", thread: "root" },
  );
  assert.deepEqual(
    Object.fromEntries(
      pushTargetParams({ kind: "task", roomId: "r", taskId: "t" }),
    ),
    { view: "tasks", taskChannel: "r", task: "t" },
  );
  assert.deepEqual(
    Object.fromEntries(pushTargetParams({ kind: "computer", hostId: "h" })),
    { view: "computers", computer: "h" },
  );
});
test("thread without resolved root and unsupported targets never guess a destination", () => {
  assert.throws(() =>
    pushTargetParams({ kind: "thread", roomId: "r", threadId: "t" }),
  );
  assert.throws(() => pushTargetParams({ kind: "agent", agentId: "a" }));
});
