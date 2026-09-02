import assert from "node:assert/strict";
import test from "node:test";
import {
  discoveryLocation,
  highlightParts,
  raftTaskGroup,
  globalSurfaceFromSearch,
  searchDateBound,
  searchExcerpt,
  visibleReadFrontier,
  focusAfterSuccessfulSubmit,
  groupSearchHits,
  mergeSearchHits,
} from "../src/global-discovery-model.ts";
import type { WorkspaceSearchResponse } from "@rah-os/protocol";
test("successful submit exits only its own focused snapshot, not a newer navigation", () => {
  assert.equal(
    focusAfterSuccessfulSubmit("old-message", "old-message"),
    undefined,
  );
  assert.equal(
    focusAfterSuccessfulSubmit("new-message", "old-message"),
    "new-message",
  );
  assert.equal(
    focusAfterSuccessfulSubmit("new-message", undefined),
    "new-message",
  );
});
test("global routes preserve Room/thread/message identities without treating DM as a channel Task board", () => {
  assert.equal(globalSurfaceFromSearch("?surface=tasks"), "tasks");
  assert.equal(globalSurfaceFromSearch("?surface=evil"), "room");
  const url = new URL(
    discoveryLocation({
      target: {
        kind: "message",
        roomId: "room one",
        messageId: "m+1",
        rootMessageId: "root&1",
      },
    }),
    "http://local",
  );
  assert.equal(url.searchParams.get("thread"), "room one:root&1");
  assert.equal(url.searchParams.get("message"), "m+1");
  assert.equal(url.searchParams.get("room"), "room one");
});
test("Activity Thread deep links retain the Activity filter and background", () => {
  const url = new URL(
    discoveryLocation(
      {
        target: {
          kind: "message",
          roomId: "room-target",
          rootMessageId: "root-target",
          messageId: "reply-target",
        },
        surface: "activity",
      },
      "?surface=activity&filter=mentions&room=old",
    ),
    "http://local",
  );
  assert.equal(url.searchParams.get("surface"), "activity");
  assert.equal(url.searchParams.get("filter"), "mentions");
  assert.equal(url.searchParams.get("room"), "room-target");
  assert.equal(url.searchParams.get("thread"), "room-target:root-target");
  assert.equal(url.searchParams.get("message"), "reply-target");
});
test("Raft five task groups map canonical states; highlight keeps user text inert", () => {
  assert.equal(raftTaskGroup("waiting_input"), "in-progress");
  assert.equal(raftTaskGroup("cancelled"), "closed");
  assert.deepEqual(highlightParts("<script>100%_</script>", "%_"), [
    { text: "<script>100", match: false },
    { text: "%_", match: true },
    { text: "</script>", match: false },
  ]);
  assert.deepEqual(highlightParts("先处理任务，再等待认领。", "任务 认领"), [
    { text: "先处理", match: false },
    { text: "任务", match: true },
    { text: "，再等待", match: false },
    { text: "认领", match: true },
    { text: "。", match: false },
  ]);
  assert.deepEqual(highlightParts("a+b and [x]", "a+b [x]"), [
    { text: "a+b", match: true },
    { text: " and ", match: false },
    { text: "[x]", match: true },
  ]);
});
test("untrusted date links cannot crash Search, and long-message excerpts include the match", () => {
  assert.equal(searchDateBound("invalid"), undefined);
  assert.equal(searchDateBound("2026-02-30"), undefined);
  assert.equal(searchDateBound("2026-13-01"), undefined);
  assert.ok(searchDateBound("2026-08-30"));
  const excerpt = searchExcerpt(
    "a".repeat(9000) + "needle" + "z".repeat(9000),
    "needle",
  );
  assert.ok(excerpt.includes("needle"));
  assert.ok(excerpt.length <= 1002);
  const tokenExcerpt = searchExcerpt(
    "a".repeat(9000) + "任务" + "z".repeat(9000),
    "不存在 任务",
  );
  assert.ok(tokenExcerpt.includes("任务"));
  assert.ok(tokenExcerpt.startsWith("…"));
});
test("Human read acknowledgement uses visible message sequence, never transport head or virtual overscan", () => {
  assert.equal(
    visibleReadFrontier(
      [
        { seq: 8, top: 150, bottom: 250 },
        { seq: 99, top: 900, bottom: 950 },
      ],
      { top: 100, bottom: 800 },
    ),
    8,
  );
  assert.equal(
    visibleReadFrontier([{ seq: 8, top: 1, bottom: 99 }], {
      top: 100,
      bottom: 800,
    }),
    0,
  );
});

test("Raft Search groups Thread hits and append pagination never duplicates messages", () => {
  const hit = (
    messageId: string,
    rootMessageId?: string,
  ): WorkspaceSearchResponse["hits"][number] => ({
    message: {
      messageId,
      roomId: "room-a",
      actorId: "agent-a",
      body: `body ${messageId}`,
      createdAt: "2026-09-01T00:00:00.000Z",
      ...(rootMessageId ? { threadId: "thread-a" } : {}),
    },
    roomName: "Design",
    senderName: "Alice",
    ...(rootMessageId ? { rootMessageId } : {}),
    target: {
      kind: "message",
      roomId: "room-a",
      messageId,
      ...(rootMessageId ? { rootMessageId, threadId: "thread-a" } : {}),
    },
  });
  const root = hit("message-root");
  const replyOne = hit("message-reply-1", "message-root");
  const replyTwo = hit("message-reply-2", "message-root");
  const merged = mergeSearchHits([root, replyOne], [replyOne, replyTwo]);
  assert.deepEqual(
    merged.map(({ message }) => message.messageId),
    ["message-root", "message-reply-1", "message-reply-2"],
  );
  const groups = groupSearchHits(merged);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.kind, "message");
  assert.equal(groups[1]?.kind, "thread");
  assert.deepEqual(
    groups[1]?.hits.map(({ message }) => message.messageId),
    ["message-reply-1", "message-reply-2"],
  );
});
