import test from "node:test";
import assert from "node:assert/strict";
import { nativePresence } from "../../frontends/raft/adapter123/presence.ts";
test("native instance and aggregate Role lights use verified Host observations rather than enabled definitions or reused display names", () => {
  const facts: any = [
    { agentId: "agent-A", activity: "working", reason: "working" },
    { agentId: "agent-B", activity: "offline", reason: "paused" },
  ];
  assert.equal(nativePresence(["agent-A"], facts).activityKind, "working");
  assert.equal(nativePresence(["agent-B"], facts).status, "stopped");
  assert.equal(nativePresence(["unknown-id"], facts).activityKind, undefined);
  assert.equal(nativePresence(["agent-B", "agent-A"], facts).status, "active");
});
