import test from "node:test";
import assert from "node:assert/strict";
import { recentSearchEntities } from "../../frontends/raft/loom/search-recent.ts";
test("recent visits exclude current, archived, hidden and absent destinations and keep visit order", () => {
  const item = (key: string, channelId: string, extra = {}) => ({
    key,
    channelId,
    type: "channel",
    title: key,
    archivedAt: null,
    ...extra,
  });
  const entities = [
    item("a", "a"),
    item("b", "b"),
    item("old", "old", { archivedAt: "2026-10-16" }),
    item("agent:i", "box", { type: "agentDm", agentId: "i" }),
  ] as never;
  assert.deepEqual(
    recentSearchEntities(
      ["missing", "old", "box", "b", "a"],
      entities,
      ["peer:i"],
      "b",
    ).map((e) => e.key),
    ["a"],
  );
  assert.deepEqual(
    recentSearchEntities(["b", "a"], entities, [], undefined).map((e) => e.key),
    ["b", "a"],
  );
});
test("recent UI does not invent visits from an unvisited directory", () => {
  assert.deepEqual(
    recentSearchEntities(
      [],
      [
        {
          key: "a",
          channelId: "a",
          type: "channel",
          title: "a",
          archivedAt: null,
        },
      ] as never,
      [],
      undefined,
    ),
    [],
  );
});
