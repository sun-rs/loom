import assert from "node:assert/strict";
import test from "node:test";
import type { RahClient } from "@rah-os/client-sdk";
import { markChannelActivity } from "../../frontends/raft/loom/sidebar-activity.ts";
test("unread finds the latest top-level message without sending thread frontier; lost mark is never replayed", async () => {
  const calls: { operation: string; input: any }[] = [];
  const client = {
    async request(operation: string, input: any) {
      calls.push({ operation, input });
      if (operation === "message.list")
        return input.beforeSeq
          ? {
              messages: [{ roomSeq: 6 }, { roomSeq: 7, threadId: "t" }],
              hasMoreBefore: true,
              cursorBefore: 6,
            }
          : {
              messages: [{ roomSeq: 8, threadId: "t" }],
              hasMoreBefore: true,
              cursorBefore: 8,
            };
      throw new Error("lost mark response");
    },
  } as unknown as RahClient;
  await assert.rejects(markChannelActivity(client, "room", "unread"), /lost/);
  assert.deepEqual(
    calls.map((c) => c.operation),
    ["message.list", "message.list", "activity.mark"],
  );
  assert.deepEqual(calls[2]!.input, {
    roomId: "room",
    action: "unread",
    throughSeq: 6,
    source: "channel-list",
  });
});
test("read uses the canonical channel-list action without fetching or guessing the latest head", async () => {
  const calls: any[] = [];
  const client = {
    async request(operation: string, input: unknown) {
      calls.push({ operation, input });
      return {};
    },
  } as unknown as RahClient;
  await markChannelActivity(client, "room", "read");
  assert.deepEqual(calls, [
    {
      operation: "activity.mark",
      input: {
        roomId: "room",
        action: "read",
        throughSeq: 0,
        source: "channel-list",
      },
    },
  ]);
});
test("thread-only scan is bounded and refuses to mark an unproven frontier", async () => {
  let reads = 0;
  const client = {
    async request(operation: string) {
      assert.equal(operation, "message.list");
      reads++;
      return {
        messages: [{ roomSeq: 1000 - reads, threadId: "t" }],
        hasMoreBefore: true,
        cursorBefore: 1000 - reads,
      };
    },
  } as unknown as RahClient;
  await assert.rejects(markChannelActivity(client, "room", "unread"), /未修改/);
  assert.equal(reads, 10);
});
