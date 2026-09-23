// Opt-in RED evidence for a proposed message-check projection repair.
// Do not remove durable ledger events or bypass ACK to make this pass.
import assert from "node:assert/strict";
import test from "node:test";
import { renderWorkerReadResult } from "../../../packages/agent-host/src/worker-read-render.ts";

test("ordinary conversation delivery preserves the question without raw runtime receipts", () => {
  const output = renderWorkerReadResult(
    "/v1/worker/sync",
    {},
    {
      cursorBefore: 1,
      cursorAfter: 3,
      latestRoomSeq: 3,
      snapshot: null,
      events: [
        {
          roomSeq: 2,
          type: "run.started",
          actorId: "rah-system",
          payload: {
            runtimeRunId: "INTERNAL_RUNTIME_RECEIPT",
            hostId: "host-test",
          },
        },
        {
          roomSeq: 3,
          type: "message.posted",
          actorId: "human-test",
          payload: { messageId: "message-test", body: "17加26等于多少？" },
        },
      ],
    },
  );
  assert.match(output, /17加26等于多少？/u);
  assert.equal(
    output.includes("INTERNAL_RUNTIME_RECEIPT"),
    false,
    "current check shares the raw sync renderer and injects internal runtime receipts",
  );
});
