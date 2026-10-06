import assert from "node:assert/strict";
import test from "node:test";
import { workerMcpPublishedReceipt } from "../src/worker-mcp-receipt.ts";

const response = {
  activationIds: ["activation_next"],
  deduplicated: false,
  event: {
    eventId: "event_post",
    roomId: "room_a",
    roomSeq: 9,
    type: "message.posted",
    actorId: "principal_a",
    aggregateType: "message",
    aggregateId: "message_a",
    payload: {
      body: "already supplied body".repeat(1000),
      threadId: "thread_a",
    },
    idempotencyKey: "private_diagnostic_key",
    schemaVersion: 1,
    createdAt: "2026-10-04T13:42:48.676Z",
  },
};

test("MCP publication returns a bounded receipt, not a second copy of the reply", () => {
  const receipt = workerMcpPublishedReceipt(response);
  assert.deepEqual(receipt, {
    state: "published",
    messageId: "message_a",
    roomSeq: 9,
  });
  assert.ok(JSON.stringify(receipt).length < 400);
  assert.ok(!JSON.stringify(receipt).includes("already supplied"));
});

test("publication receipt retains replay and unresolved mention warnings", () => {
  const receipt = workerMcpPublishedReceipt({
    ...response,
    deduplicated: true,
    unresolvedMentionHandles: ["@missing"],
    replacedDraft: { body: "previous draft that was replaced" },
  });
  assert.equal(receipt.deduplicated, true);
  assert.deepEqual(receipt.unresolvedMentionHandles, ["@missing"]);
  assert.deepEqual(receipt.replacedDraft, {
    body: "previous draft that was replaced",
  });
});

test("held, unrecognized, or non-message results cannot become publication receipts", () => {
  for (const value of [
    { state: "held", heldDraftId: "draft" },
    { ...response, event: { ...response.event, type: "task.completed" } },
    { ...response, event: { ...response.event, aggregateType: "task" } },
    { ...response, event: { ...response.event, roomSeq: -1 } },
    { ...response, event: { ...response.event, actorId: null } },
    { ...response, activationIds: [null] },
  ])
    assert.throws(() => workerMcpPublishedReceipt(value));
});

test("ordinary receipt omits empty warnings without mutating the full response", () => {
  const input = { ...response, unresolvedMentionHandles: [] };
  const before = structuredClone(input);
  assert.deepEqual(workerMcpPublishedReceipt(input), {
    state: "published",
    messageId: "message_a",
    roomSeq: 9,
  });
  assert.deepEqual(input, before);
});
