import assert from "node:assert/strict";
import test from "node:test";
import { visibleSearchResults } from "../src/search-visible-results.ts";

test("an entity-only search reports a result even with zero message matches", () => {
  const result = visibleSearchResults(
    { rooms: [{ roomId: "room" }], principals: [] },
    [],
    "human",
  );
  assert.equal(result.count, 1);
});

test("count includes displayed people and accumulated message hits, excluding hidden self", () => {
  const people = [{ principalId: "human" }, { principalId: "agent" }];
  const result = visibleSearchResults(
    { rooms: [{ roomId: "room" }], principals: people },
    [{ messageId: "one" }, { messageId: "two" }],
    "human",
  );
  assert.equal(result.count, 4);
  assert.deepEqual(result.principals, [people[1]]);
  assert.equal(people.length, 2, "the canonical response is not mutated");
});

test("the Raft counter follows loaded results, not the backend total for unloaded pages", () => {
  const response = { rooms: [], principals: [], total: 999 };
  assert.equal(visibleSearchResults(response, [{}], undefined).count, 1);
  assert.equal(visibleSearchResults(response, [{}, {}], undefined).count, 2);
  assert.equal(visibleSearchResults(undefined, [], undefined).count, 0);
  assert.equal(
    visibleSearchResults(
      { rooms: [], principals: [{ principalId: "self" }] },
      [],
      "self",
    ).count,
    0,
    "a hidden current Human does not suppress the empty state",
  );
});

test("sigil search immediately lists matching directory identities without duplicate DMs or truncating channels", async () => {
  const { searchDirectoryMatches } =
    await import("../src/search-visible-results.ts");
  const entries = [
    ...Array.from({ length: 9 }, (_, i) => ({
      key: `room:${i}`,
      kind: "channel",
      title: `channel-${i}`,
      subtitle: "频道",
      archived: i === 8,
    })),
    {
      key: "room:dm",
      kind: "agent",
      title: "Kimi",
      subtitle: "@KiMi",
      principalId: "agent-a",
      roomId: "dm",
    },
    {
      key: "person:a",
      kind: "agent",
      title: "Kimi",
      subtitle: "@KiMi",
      principalId: "agent-a",
    },
    {
      key: "person:b",
      kind: "agent",
      title: "Kimi",
      subtitle: "@other",
      principalId: "agent-b",
    },
  ];
  assert.equal(searchDirectoryMatches("#", entries)?.length, 9);
  assert.equal(searchDirectoryMatches("@", entries)?.length, 2);
  assert.equal(searchDirectoryMatches("@KiMi", entries)?.length, 2);
  assert.equal(
    searchDirectoryMatches("#channel-8", entries)?.[0]?.archived,
    true,
  );
  assert.equal(searchDirectoryMatches("normal", entries), undefined);
});

test("only bare @ and # bypass message search, including surrounding whitespace", async () => {
  const { isDirectoryOnlySearch } =
    await import("../src/search-visible-results.ts");
  for (const query of ["@", "#", " @ ", "\t#\n"])
    assert.equal(isDirectoryOnlySearch(query), true);
  for (const query of ["", "word", "@Kimi", "#Solars", "@@", "a #"])
    assert.equal(isDirectoryOnlySearch(query), false);
});
