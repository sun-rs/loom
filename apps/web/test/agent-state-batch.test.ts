import assert from "node:assert/strict";
import test from "node:test";
import { applyAgentStateBatch } from "../src/agent-state-batch.ts";
test("batch stops after scope cancellation and retries only unfinished intents with the same key", async () => {
  const keys = new Map<string, string>(),
    states = new Map([
      ["a", "enabled"],
      ["b", "enabled"],
    ]);
  const calls: string[] = [];
  let fail = true;
  const apply = async (id: string, _state: string, key: string) => {
    calls.push(id + ":" + key);
    if (id === "b" && fail) {
      fail = false;
      throw new Error("lost response");
    }
    states.set(id, "disabled");
  };
  const input = {
    ids: ["a", "b"],
    state: "disabled" as const,
    keys,
    currentState: (id: string) => states.get(id),
    apply,
    signal: new AbortController().signal,
    onProgress: () => {},
  };
  await assert.rejects(applyAgentStateBatch(input), /lost response/);
  await applyAgentStateBatch(input);
  assert.equal(calls.filter((c) => c.startsWith("a:")).length, 1);
  assert.equal(calls[1], calls[2]);
  const controller = new AbortController();
  const touched: string[] = [];
  await applyAgentStateBatch({
    ...input,
    ids: ["c", "d"],
    keys: new Map(),
    signal: controller.signal,
    apply: async (id) => {
      touched.push(id);
      controller.abort();
    },
  });
  assert.deepEqual(touched, ["c"]);
});
