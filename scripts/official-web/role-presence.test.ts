import test from "node:test";
import assert from "node:assert/strict";
import {
  rolePresence,
  computerInstances,
} from "../../frontends/raft/loom/role-presence.ts";
test("role badge aggregates execution, not stored sessions or installed CLIs", () => {
  assert.equal(rolePresence(["a"], []), "unknown");
  assert.equal(
    rolePresence(["a"], [{ participantId: "a", state: "idle" }]),
    "idle",
  );
  assert.equal(
    rolePresence(
      ["a", "b"],
      [
        { participantId: "a", state: "idle" },
        { participantId: "b", state: "working" },
      ],
    ),
    "working",
  );
  assert.equal(rolePresence([], []), "idle");
});
test("computer instances are bound role instances, deduplicated across runtime offers", () => {
  assert.deepEqual(
    computerInstances(
      [
        {
          agentBindings: [
            { agentId: "a", participantId: "i", handle: "Tom-1" },
            { agentId: "legacy", participantId: "old", handle: "old" },
          ],
        },
        {
          agentBindings: [
            { agentId: "a", participantId: "i", handle: "Tom-1" },
          ],
        },
      ],
      [{ instanceId: "i", agentId: "a", roleId: "r" }],
    ),
    [{ instanceId: "i", agentId: "a", roleId: "r", name: "Tom-1" }],
  );
});
