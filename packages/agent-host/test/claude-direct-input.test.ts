import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { attachClaudeBusyInput } from "../src/claude-busy-input.js";

for (const activity of ["thinking", "parallel-tools", "compaction"]) {
  test(`Claude delivers resumed busy input directly during ${activity}`, () => {
    const input = new PassThrough();
    const writes: string[] = [];
    const receipts: boolean[] = [];
    const delivery = attachClaudeBusyInput({
      input,
      resumedSession: true,
      session: () => "resumable-session",
      write: (text, done) => {
        writes.push(text);
        done();
      },
      receipt: (frame) => receipts.push(frame.accepted),
    });
    try {
      delivery.observe({
        type: "assistant",
        message: {
          content:
            activity === "parallel-tools"
              ? [
                  { type: "tool_use", id: "tool-a" },
                  { type: "tool_use", id: "tool-b" },
                ]
              : [{ type: "thinking", thinking: "fixture" }],
        },
      });
      if (activity === "compaction") {
        delivery.observe({
          type: "system",
          subtype: "status",
          status: "compacting",
        });
      }
      input.write(
        JSON.stringify({
          protocol: "rah-runtime-notice/v1",
          id: "notice",
          fingerprint: "a".repeat(64),
          text: "New unread input in #room. Check the canonical messages.",
        }) + "\n",
      );
      assert.equal(writes.length, 1, "must not wait for a tool boundary");
      assert.deepEqual(JSON.parse(writes[0]!), {
        type: "user",
        session_id: "resumable-session",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: "New unread input in #room. Check the canonical messages.",
            },
          ],
        },
      });
      assert.deepEqual(receipts, [true]);
    } finally {
      delivery.close();
    }
  });
}
