import test from "node:test";
import assert from "node:assert/strict";
import { createTaskBatch } from "../../frontends/raft/loom/task-create-batch.ts";
test("a rejected row stops the form batch; accepted rows are reported once", async () => {
  const calls: string[] = [],
    accepted: number[] = [];
  const facade = {
    create: async (title: string, settled: any) => {
      calls.push(title);
      const result =
        title === "bad"
          ? { kind: "rejected", error: Error("denied") }
          : { kind: "ok", result: {} };
      settled(result);
      return result;
    },
  };
  await assert.rejects(
    createTaskBatch(
      facade as any,
      ["one", "bad", "three"],
      (n) => accepted.push(n),
      () => {},
    ),
    /denied/,
  );
  assert.deepEqual(calls, ["one", "bad"]);
  assert.deepEqual(accepted, [1]);
});
test("unknown result leaves the batch awaiting the same slot callback, without sending later rows", async () => {
  let callback: any;
  const calls: string[] = [],
    accepted: number[] = [];
  const facade = {
    create: async (title: string, settled: any) => {
      calls.push(title);
      if (title === "one") {
        callback = settled;
        const r = { kind: "unknown" };
        settled(r);
        return r;
      }
      const r = { kind: "ok", result: {} };
      settled(r);
      return r;
    },
  };
  let unknown = 0;
  const done = createTaskBatch(
    facade as any,
    ["one", "two"],
    (n) => accepted.push(n),
    () => unknown++,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ["one"]);
  assert.equal(unknown, 1);
  callback({ kind: "ok", result: {} });
  await done;
  assert.deepEqual(calls, ["one", "two"]);
  assert.deepEqual(accepted, [1, 2]);
});
