import test from "node:test";
import assert from "node:assert/strict";
import { nativeSearchFilters } from "../../frontends/raft/loom/native-search.ts";
test("native scopes preserve combined human/agent and mention semantics", () => {
  assert.deepEqual(
    nativeSearchFilters(
      new URLSearchParams("scopes=humans,agents,mentioned"),
      "x",
    ),
    { sort: "relevance", mentionSelf: true },
  );
  assert.deepEqual(
    nativeSearchFilters(new URLSearchParams("scopes=agents"), ""),
    { sort: "recent", senderKind: "agent" },
  );
  assert.deepEqual(
    nativeSearchFilters(new URLSearchParams("scopes=humans&sort=recent"), "x"),
    { sort: "recent", senderKind: "human" },
  );
});
test("time window uses native range boundaries and is supplied once per result window", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const result = nativeSearchFilters(new URLSearchParams("range=7d"), "x", now);
  assert.equal(result.before, now.toISOString());
  assert.equal(result.after, "2026-10-08T12:00:00.000Z");
});
