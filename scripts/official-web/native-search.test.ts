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
test("selected sender and channel map to authorized Kernel ID filters, including empty query", () => {
  assert.deepEqual(
    nativeSearchFilters(
      new URLSearchParams("senderId=person&channelId=room"),
      "",
    ),
    {
      sort: "recent",
      senderIds: ["person"],
      roomIds: ["room"],
    },
  );
});
test("native sender and scope conflict resolution preserves mentions, clear keeps sort/query", async () => {
  const { changeNativeSearchFilter } =
    await import("../../frontends/raft/loom/native-search.ts");
  const kinds = new Map([
    ["a", "agent"],
    ["h", "human"],
  ]);
  const sender = changeNativeSearchFilter(
    new URLSearchParams("q=x&sort=recent&scopes=humans,mentioned"),
    "senderId",
    "a",
    kinds,
  );
  assert.equal(sender.get("scopes"), "mentioned");
  assert.equal(sender.get("senderId"), "a");
  const scope = changeNativeSearchFilter(sender, "scopes", "humans", kinds);
  assert.equal(scope.has("senderId"), false);
  const clear = changeNativeSearchFilter(sender, "clear", "", kinds);
  assert.equal(clear.toString(), "q=x&sort=recent");
});
test("native grouping keeps ordinary hits separate and collects replies under their root", async () => {
  const { groupSearchRows } =
    await import("../../frontends/raft/loom/native-search.ts");
  const row = (id, threadId) => ({
    id,
    message: { messageId: id, threadId, createdAt: "2026-10-15T12:00:00Z" },
    rootMessageId: threadId ? "root" : undefined,
    rootMessagePreview: "Thread title",
  });
  const groups = groupSearchRows([
    row("a", "thread"),
    row("b"),
    row("c", "thread"),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].kind, "thread");
  assert.deepEqual(
    groups[0].results.map((r) => r.row.id),
    ["a", "c"],
  );
  assert.equal(groups[1].kind, "message");
});
