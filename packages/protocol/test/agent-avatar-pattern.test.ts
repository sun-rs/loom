import assert from "node:assert/strict";
import test from "node:test";
import { randomAgentAvatarPattern } from "../src/agent-avatar-pattern.ts";

test("Raft seeded avatar recipe is stable, mirrored, and distinguishes legacy keys", () => {
  for (const seed of ["claude", "codex", "kimi", "opencode", "agent-α"]) {
    const a = randomAgentAvatarPattern(seed);
    assert.deepEqual(a, randomAgentAvatarPattern(seed));
    assert.equal(a.rows.length, 8);
    for (const row of a.rows) {
      assert.equal(row.length, 8);
      assert.equal(row, [...row].reverse().join(""));
    }
    assert.ok(a.colorPair >= 0 && a.colorPair < 12);
  }
  assert.equal(
    new Set(
      ["claude", "codex", "kimi", "opencode"].map((s) =>
        JSON.stringify(randomAgentAvatarPattern(s)),
      ),
    ).size,
    4,
  );
});
