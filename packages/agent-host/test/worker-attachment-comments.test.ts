import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkerReadCommand } from "../src/worker-read-cli.ts";
test("attachment comment CLI validates bounded pages and never accepts actor scope", () => {
  assert.deepEqual(
    parseWorkerReadCommand("attachment-comments", {
      "attachment-id": "file",
      limit: "5",
      "before-room-seq": "21",
    }),
    {
      path: "/v1/worker/attachments/comments",
      body: { attachmentId: "file", limit: 5, beforeRoomSeq: 21 },
    },
  );
  assert.throws(
    () =>
      parseWorkerReadCommand("attachment-comments", {
        "attachment-id": "file",
        "actor-id": "fake",
      }),
    /unknown/,
  );
});
