import assert from "node:assert/strict";
import test from "node:test";
import { applyAgentResetBatch } from "../src/agent-reset-batch.ts";
test("batch reset freezes per-agent keys and retries only unfinished requests", async () => {
  const completed = new Set<string>(),
    calls: string[] = [];
  let fail = true;
  const input = {
    ids: ["a", "b"],
    mode: "session" as const,
    key: "reset-group",
    completed,
    signal: new AbortController().signal,
    apply: async (id: string, _mode: string, key: string) => {
      calls.push(`${id}:${key}`);
      if (id === "b" && fail) {
        fail = false;
        throw new Error("lost response");
      }
    },
  };
  await assert.rejects(applyAgentResetBatch(input), /lost response/);
  await applyAgentResetBatch(input);
  assert.deepEqual(calls, [
    "a:reset-group:0",
    "b:reset-group:1",
    "b:reset-group:1",
  ]);
  assert.deepEqual([...completed], ["a", "b"]);
});
test("leaving batch scope stops subsequent Agent resets", async () => {
  const controller = new AbortController(),
    calls: string[] = [];
  await assert.rejects(
    applyAgentResetBatch({
      ids: ["a", "b"],
      mode: "restart",
      key: "reset",
      completed: new Set(),
      signal: controller.signal,
      apply: async (id) => {
        calls.push(id);
        controller.abort();
      },
    }),
    { name: "AbortError" },
  );
  assert.deepEqual(calls, ["a"]);
});
