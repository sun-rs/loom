import assert from "node:assert/strict";
import {
  messageMentionCandidates,
  messageHasBroadcastMention,
} from "../../packages/protocol/src/message-mention.ts";

// Caller-side protection for Human test/task openers. This neither changes
// Kernel routing nor proves delivery; supply a fresh enabled-member snapshot.
export function assertHumanWakeTargets(body, enabledHandles, expectedHandles) {
  assert.equal(typeof body, "string");
  for (const list of [enabledHandles, expectedHandles]) {
    assert.ok(
      Array.isArray(list) &&
        list.every((s) => typeof s === "string" && s.length > 0),
    );
    assert.equal(new Set(list).size, list.length);
  }
  assert.ok(expectedHandles.every((h) => enabledHandles.includes(h)));
  const mentions = [
    ...new Set(
      messageMentionCandidates(body, enabledHandles).map((m) => m.handle),
    ),
  ];
  const actual = (
    messageHasBroadcastMention(body) || !mentions.length
      ? [...enabledHandles]
      : mentions
  ).sort();
  assert.deepEqual(
    actual,
    [...expectedHandles].sort(),
    "Unexpected wake targets: inspect all literal mentions in the Human message",
  );
  return actual;
}
