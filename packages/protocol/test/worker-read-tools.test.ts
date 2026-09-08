import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkerHistoryRequestSchema,
  WorkerMembersRequestSchema,
  WorkerMessageResolveRequestSchema,
  WorkerProfileReadRequestSchema,
  WorkerTaskHistoryRequestSchema,
  WorkerTaskListRequestSchema,
} from "../src/worker-read-tools.ts";

test("Worker reads accept bounded selectors but never caller-supplied authority", () => {
  assert.equal(WorkerHistoryRequestSchema.parse({}).limit, 50);
  assert.ok(
    WorkerHistoryRequestSchema.safeParse({ around: "message", limit: 3 })
      .success,
  );
  for (const value of [
    { before: "message", after: "message" },
    { around: "message", before: "message" },
    { limit: 101 },
    { limit: 0 },
    { roomId: "foreign" },
    { participantId: "other-agent" },
  ])
    assert.equal(WorkerHistoryRequestSchema.safeParse(value).success, false);
  assert.equal(
    WorkerMessageResolveRequestSchema.safeParse({
      messageId: "m",
      actorId: "h",
    }).success,
    false,
  );
  assert.equal(
    WorkerMembersRequestSchema.safeParse({ workspaceId: "other" }).success,
    false,
  );
  assert.equal(
    WorkerProfileReadRequestSchema.safeParse({ target: "@human" }).success,
    true,
  );
  assert.equal(
    WorkerTaskListRequestSchema.safeParse({ mine: true, status: "in_review" })
      .success,
    true,
  );
  assert.equal(
    WorkerTaskListRequestSchema.safeParse({ assigneeId: "other" }).success,
    false,
  );
  assert.equal(
    WorkerTaskHistoryRequestSchema.safeParse({ taskId: "task", limit: 100 })
      .success,
    true,
  );
  assert.equal(
    WorkerTaskHistoryRequestSchema.safeParse({
      taskId: "task",
      roomId: "other",
    }).success,
    false,
  );
});

test("Raft filter-only Worker searches still require a selector and reserve relevance for text queries", async () => {
  const { WorkerMessageSearchRequestSchema: search } =
    await import("../src/worker-message-tools.ts");
  for (const input of [
    {},
    { query: " " },
    { sort: "recent" },
    { sender: "@human", sort: "relevance" },
  ])
    assert.equal(search.safeParse(input).success, false);
  for (const input of [
    { channel: "#room" },
    { sender: "@human" },
    { senderId: "principal" },
    { after: "2026-01-01T00:00:00.000Z" },
    { query: "needle", sort: "relevance" },
  ])
    assert.ok(search.safeParse(input).success);
});
