import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkerReplyMcpArgumentsSchema,
  WORKER_REPLY_MCP_TOOL,
} from "../src/worker-mcp.ts";

test("reply exposes business fields and requires explicit final intent", () => {
  assert.equal(WORKER_REPLY_MCP_TOOL.inputSchema.additionalProperties, false);
  assert.deepEqual(
    WorkerReplyMcpArgumentsSchema.parse({ body: "done", final: true }),
    { body: "done", final: true },
  );
  assert.deepEqual(
    WorkerReplyMcpArgumentsSchema.parse({ body: "working", final: false }),
    { body: "working", final: false },
  );
  for (const extra of [
    {},
    { final: true, actorId: "other" },
    { final: true, _meta: {} },
    { final: true, idempotencyKey: "own" },
  ])
    assert.equal(
      WorkerReplyMcpArgumentsSchema.safeParse({ body: "done", ...extra })
        .success,
      false,
    );
});

test("draft revision preserves saved target and final intent", () => {
  assert.deepEqual(
    WorkerReplyMcpArgumentsSchema.parse({
      body: "revised",
      reviseDraftId: "draft",
    }),
    { body: "revised", reviseDraftId: "draft" },
  );
  for (const extra of [
    { final: true },
    { final: false },
    { basedOnRoomSeq: 9 },
    { threadId: "new" },
  ])
    assert.equal(
      WorkerReplyMcpArgumentsSchema.safeParse({
        body: "revised",
        reviseDraftId: "draft",
        ...extra,
      }).success,
      false,
    );
});
