import test from "node:test";
import assert from "node:assert/strict";
import { MemoryClient } from "../../frontends/raft/loom/memory-client.ts";
test("memory aggregation is bounded, preserves partial errors and searches through server", async () => {
  const calls: any[] = [];
  const owner = new MemoryClient({
    request: async (op: any, p: any) => {
      calls.push([op, p]);
      if (p.channelId === "bad") throw Error("denied");
      return {
        entries: [{ entryId: "one", state: "active" }],
        truncated: true,
      };
    },
  } as any);
  const result = await owner.list(["good", "bad"], "query", "active");
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.failed, ["bad"]);
  assert.equal(result.truncated, true);
  assert.equal(calls[0][0], "memory.search");
  assert.equal(calls[0][1].limit, 50);
});
test("memory mutation retries frozen revision and key after unknown response", async () => {
  const calls: any[] = [];
  let fail = true;
  const owner = new MemoryClient({
    request: async (op: any, p: any) => {
      calls.push([op, p]);
      if (fail) {
        fail = false;
        throw Error("lost");
      }
      return {};
    },
  } as any);
  await owner.change(
    "delete",
    { entryId: "entry", revision: 7 } as any,
    "obsolete",
    () => {},
  );
  assert.equal(owner.writes.state, "unknown");
  await owner.writes.retry();
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0][1].expectedRevision, 7);
  assert.equal(calls[0][0], "memory.delete");
  owner.writes.discard();
});
test("Human editor freezes content and revision on unknown-result replay", async () => {
  const calls: any[] = [];
  let fail = true;
  const owner = new MemoryClient({
    request: async (op: any, p: any) => {
      calls.push([op, p]);
      if (fail) {
        fail = false;
        throw Error("lost");
      }
      return {};
    },
  } as any);
  await owner.update(
    { entryId: "e", revision: 3 } as any,
    "description",
    "body",
    () => {},
  );
  assert.equal(owner.writes.state, "unknown");
  await owner.writes.retry();
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0][0], "memory.update");
  assert.equal(calls[0][1].expectedRevision, 3);
  owner.writes.discard();
});
test("Human deleted-memory filter requests tombstones explicitly", async () => {
  let input: any;
  const owner = new MemoryClient({
    request: async (_op: any, p: any) => {
      input = p;
      return { entries: [], truncated: false };
    },
  } as any);
  await owner.list(["room"], "", "deleted");
  assert.equal(input.includeDeleted, true);
});
