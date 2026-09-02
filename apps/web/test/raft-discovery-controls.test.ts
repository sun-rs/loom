import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeScopes,
  senderKindForScopes,
  searchTimeBounds,
  searchSort,
  searchShouldRun,
  reconcileSender,
  normalizeDiscoveryParams,
  taskPeopleChoices,
} from "../src/raft-discovery-controls.ts";

test("Activity normalization preserves a selected exact Thread on reload", () => {
  const params = normalizeDiscoveryParams(
    "?surface=activity&filter=unread&room=r&thread=r:root&message=reply",
    "activity",
  );
  assert.equal(params.get("thread"), "r:root");
  assert.equal(params.get("message"), "reply");
});

test("Raft Tasks menus put My assignment before Unassigned and name My creation explicitly", () => {
  const people = [
    { principalId: "a", handle: "Alice", kind: "agent" },
    { principalId: "me", handle: "owner", kind: "human" },
  ];
  assert.deepEqual(
    taskPeopleChoices(people, "me", "assignee").map((x) => x.label),
    ["分配给我的", "未分配", "Alice"],
  );
  assert.deepEqual(
    taskPeopleChoices(people, "me", "creator").map((x) => x.label),
    ["我创建的", "Alice"],
  );
});

test("surface navigation cannot carry invisible Tasks filters into single-channel Search", () => {
  const cross = normalizeDiscoveryParams(
    "?room=base&surface=tasks&channel=a&channel=b&creator=x&view=board",
    "search",
  );
  assert.equal(cross.get("room"), "base");
  assert.deepEqual(cross.getAll("channel"), []);
  const linked = normalizeDiscoveryParams(
    "?room=base&surface=search&channel=a&channel=b&sender=x&sender=y&q=text",
    "search",
  );
  assert.deepEqual(linked.getAll("channel"), ["a"]);
  assert.deepEqual(linked.getAll("sender"), ["x"]);
  assert.equal(linked.get("q"), "text");
});

test("Raft scopes deduplicate in canonical order and human+agent cancels the type restriction", () => {
  assert.deepEqual(
    normalizeScopes(["agents", "bogus", "mentioned", "agents"]),
    ["mentioned", "agents"],
  );
  assert.equal(senderKindForScopes(["humans", "agents"]), undefined);
  assert.equal(senderKindForScopes(["humans"]), "human");
  assert.equal(senderKindForScopes(["mentioned", "agents"]), "agent");
  assert.equal(
    reconcileSender(["agents"], { principalId: "h", kind: "human" }),
    undefined,
  );
  assert.equal(
    reconcileSender(["mentioned"], { principalId: "h", kind: "human" }),
    "h",
  );
});
test("Raft sort defaults to relevance, filtered blank searches use recent, time bounds are frozen by caller", () => {
  assert.equal(searchSort("x", "unexpected"), "relevance");
  assert.equal(searchSort("x", "recent"), "recent");
  assert.equal(searchSort(" ", "relevance"), "recent");
  const now = new Date("2026-08-30T08:12:00.000Z");
  assert.deepEqual(searchTimeBounds("any", now), {});
  assert.equal(searchTimeBounds("7d", now).after, "2026-08-23T08:12:00.000Z");
  assert.equal(searchTimeBounds("30d", now).before, now.toISOString());
  assert.deepEqual(searchTimeBounds("evil", now), {});
  assert.equal(searchShouldRun("", {}), false);
  assert.equal(searchShouldRun("  ", { timeRange: "any" }), false);
  assert.equal(searchShouldRun("needle", {}), true);
  assert.equal(searchShouldRun("", { timeRange: "today" }), true);
  assert.equal(searchShouldRun("", { scopes: ["mentioned"] }), true);
  assert.equal(searchShouldRun("", { roomIds: ["room-a"] }), true);
  assert.equal(searchShouldRun("", { senderIds: ["human-a"] }), true);
  assert.equal(searchShouldRun("", { after: "2026-09-02T00:00:00Z" }), true);
});
