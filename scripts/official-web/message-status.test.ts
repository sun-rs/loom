import test from "node:test";
import assert from "node:assert/strict";
import { messageInstanceState } from "../../frontends/raft/loom/message-status.ts";
test("message status is conversation-scoped, unknown until authoritative reads and never infers liveness", () => {
  const facts = {
    roomId: "r",
    members: ["a"],
    activities: [
      { roomId: "r", participantId: "a", state: "working" as const },
    ],
  };
  assert.equal(messageInstanceState(undefined, "r", "a"), "unknown");
  assert.equal(messageInstanceState(facts, "other", "a"), "unknown");
  assert.equal(messageInstanceState(facts, "r", "a"), "working");
  assert.equal(
    messageInstanceState({ ...facts, activities: [] }, "r", "a"),
    "unknown",
  );
  assert.equal(
    messageInstanceState(
      { ...facts, activities: [{ ...facts.activities[0], state: "idle" }] },
      "r",
      "a",
    ),
    "idle",
  );
  assert.equal(
    messageInstanceState({ ...facts, members: [] }, "r", "a"),
    "left",
  );
  assert.equal(
    messageInstanceState(
      { ...facts, activities: [{ ...facts.activities[0], roomId: "private" }] },
      "r",
      "a",
    ),
    "unknown",
  );
});
