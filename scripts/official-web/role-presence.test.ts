import test from "node:test";
import assert from "node:assert/strict";
import {
  rolePresence,
  computerInstances,
} from "../../frontends/raft/loom/role-presence.ts";
test("role badge aggregates actual Host connectivity across its stable agent IDs", () => {
  assert.equal(rolePresence(["a"], []), "unknown");
  assert.equal(
    rolePresence(["a"], [{ agentId: "a", activity: "online" }] as any),
    "online",
  );
  assert.equal(
    rolePresence(["a", "b"], [
      { agentId: "a", activity: "offline" },
      { agentId: "b", activity: "working" },
    ] as any),
    "online",
  );
  assert.equal(rolePresence([], []), "offline");
  assert.equal(
    rolePresence(["a"], [{ agentId: "a", activity: "offline" }] as any),
    "offline",
  );
  assert.equal(
    rolePresence(["a"], [
      { agentId: "another-role", activity: "online" },
    ] as any),
    "unknown",
  );
  assert.equal(
    rolePresence(["a"], [{ agentId: "a", activity: "thinking" }] as any),
    "online",
  );
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
