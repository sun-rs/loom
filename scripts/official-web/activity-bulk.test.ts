import test from "node:test";
import assert from "node:assert/strict";
import { captureUnreadActivity } from "../../frontends/raft/loom/activity-bulk.ts";
test("all-read captures every page before mutation and keeps exact target frontiers", async () => {
  const calls: (string | undefined)[] = [];
  const item = (key: string, latestSeq: number) => ({
    key,
    roomId: "r",
    latestSeq,
    threadId: key,
  });
  const rows = await captureUnreadActivity(async (cursor) => {
    calls.push(cursor);
    return cursor
      ? { items: [item("b", 8)], total: 2 }
      : { items: [item("a", 4)], total: 2, nextCursor: "next" };
  });
  assert.deepEqual(calls, [undefined, "next"]);
  assert.deepEqual(rows, [
    { roomId: "r", threadId: "a", throughSeq: 4, action: "read" },
    { roomId: "r", threadId: "b", throughSeq: 8, action: "read" },
  ]);
});
test("repeated cursors abort before any writes; incomplete pages are not advertised as all", async () => {
  await assert.rejects(
    captureUnreadActivity(async () => ({
      items: [],
      total: 2,
      nextCursor: "loop",
    })),
    /完整/,
  );
});
