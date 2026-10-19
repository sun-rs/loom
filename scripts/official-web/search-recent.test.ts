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
test("native recent list keeps visits first and fills only from authorized activity timestamps", () => {
  const entities = ["a", "b", "c"].map((id) => ({
    key: id,
    channelId: id,
    type: "channel",
    title: id,
    archivedAt: null,
  })) as never;
  assert.deepEqual(
    recentSearchEntities(["a"], entities, [], undefined, {
      b: "2026-10-19T10:00:00Z",
      c: "2026-10-18T10:00:00Z",
      missing: "2026-10-20T10:00:00Z",
    }).map((e) => e.key),
    ["a", "b", "c"],
  );
});

test("recorded visits include the visible default desktop channel, never a hidden non-chat selection", async () => {
  const { readFileSync } = await import("node:fs");
  const s = readFileSync("frontends/raft/loom/ChannelApp.tsx", "utf8");
  assert.match(s, /destination === "channels" && !savedOpen/);
  assert.match(s, /!mobileList \|\| desktopChat/);
});
