import assert from "node:assert/strict";
import { test } from "node:test";
import { RouteIntentOwners } from "../../frontends/raft/loom/intent-route-owners.ts";
test("shared slot registrations retain each owner independently and limit blocking to owned actions", () => {
  const registry = new RouteIntentOwners();
  const slot = { state: "unknown", current: { action: "message" } };
  const removeTask = registry.register(slot, ["task-create", "task-convert"]);
  const removeReaction = registry.register(slot, [
    "message-reaction",
    "message-save",
  ]);
  assert.equal(
    registry.blocked(),
    false,
    "durable channel send survives navigation",
  );
  slot.current.action = "task-create";
  assert.equal(registry.blocked(), true);
  removeReaction();
  assert.equal(
    registry.blocked(),
    true,
    "removing another subscriber cannot clear task guard",
  );
  removeTask();
  assert.equal(registry.blocked(), false);
  const removeThread = registry.register(slot);
  assert.equal(
    registry.blocked(),
    true,
    "thread-local owner guards all writes",
  );
  slot.state = "idle";
  assert.equal(registry.blocked(), false);
  removeThread();
});
