import test from "node:test";
import assert from "node:assert/strict";
import {
  ThreadActivityClient,
  visibleThreadFrontier,
} from "../../frontends/raft/loom/thread-activity.ts";

test("read frontier contains only visible replies of this exact thread", () => {
  const messages: any[] = [
    { messageId: "root", roomId: "r", roomSeq: 99 },
    { messageId: "a", roomId: "r", threadId: "t", roomSeq: 3 },
    { messageId: "b", roomId: "r", threadId: "t", roomSeq: 8 },
    { messageId: "other", roomId: "other", threadId: "t", roomSeq: 100 },
  ];
  assert.equal(
    visibleThreadFrontier(messages, ["a", "root", "other"], "r", "t"),
    3,
  );
  assert.equal(visibleThreadFrontier(messages, [], "r", "t"), 0);
});
test("lost follow is verified through a read, never silently resent", async () => {
  const calls: any[] = [];
  let following = false;
  const client: any = {
    request: async (op: string, input: any) => {
      calls.push([op, input]);
      if (op === "activity.follow") {
        following = input.following;
        throw Error("lost");
      }
      return { following, agentParticipantIds: [], canManage: true };
    },
  };
  const b = new ThreadActivityClient(client, "r", "t");
  await b.refresh();
  await b.follow(true);
  assert.equal(b.following, true);
  assert.equal(calls.filter(([op]) => op === "activity.follow").length, 1);
  assert.deepEqual(calls.at(-1), [
    "thread.followers",
    { roomId: "r", threadId: "t" },
  ]);
});
test("unverifiable follow clears stale authority and blocks another write until a successful read", async () => {
  let fail = false;
  let writes = 0;
  const client: any = {
    request: async (op: string) => {
      if (op === "activity.follow") {
        writes++;
        fail = true;
        throw Error("lost");
      }
      if (fail) throw Error("denied");
      return { following: false };
    },
  };
  const b = new ThreadActivityClient(client, "r", "t");
  await b.refresh();
  await assert.rejects(b.follow(true));
  assert.equal(b.following, undefined);
  await assert.rejects(b.follow(true));
  assert.equal(writes, 1);
  fail = false;
  await b.refresh();
  assert.equal(b.following, false);
});
test("passive reads are thread scoped, bounded by observed frontier and never replay a lost result", async () => {
  const calls: any[] = [];
  const client: any = {
    request: async (op: string, input: any) => {
      calls.push([op, input]);
      throw Error("lost");
    },
  };
  const b = new ThreadActivityClient(client, "r", "t");
  await assert.rejects(b.markVisible(4));
  await b.markVisible(4);
  await b.markVisible(2);
  assert.deepEqual(calls, [
    [
      "activity.mark",
      {
        roomId: "r",
        threadId: "t",
        action: "read",
        source: "viewport",
        throughSeq: 4,
      },
    ],
  ]);
});
