import assert from "node:assert/strict";
import test from "node:test";
import { summarizeUsage, compareRounds } from "./metrics.mjs";
test("usage deduplicates response IDs, preserves uncached and rejects missing evidence", () => {
  const e = {
    type: "token_usage_record",
    timestamp: "2026-01-01T00:00:01Z",
    payload: {
      response_id: "r1",
      usage: {
        input_tokens: 100,
        cached_input_tokens: 60,
        output_tokens: 12,
        reasoning_output_tokens: 5,
      },
      thread_token_usage: { input_tokens: 900 },
    },
  };
  assert.deepEqual(summarizeUsage([e, e]), {
    generations: 1,
    input: 100,
    cached: 60,
    uncached: 40,
    output: 12,
    reasoning: 5,
    firstInput: 100,
    peakInput: 100,
  });
  assert.throws(() => summarizeUsage([]), /Missing/);
});
test("large per-round overhead fails even if all replies succeeded", () => {
  const n = {
    input: 100,
    cached: 80,
    uncached: 20,
    generations: 1,
    replySeconds: 10,
  };
  assert.equal(
    compareRounds(n, { ...n, input: 400, uncached: 60, replySeconds: 35 })
      .status,
    "over-budget",
  );
  assert.equal(
    compareRounds(n, {
      ...n,
      input: 150,
      uncached: 25,
      generations: 2,
      replySeconds: 15,
    }).status,
    "within-budget",
  );
});
test("a receipt or progress message is not an effective final answer", async () => {
  const { isEffectiveAnswer } = await import("./metrics.mjs");
  assert.equal(isEffectiveAnswer("收到。我将只读审查两份脚本。"), false);
  assert.equal(isEffectiveAnswer("审查结论：收到"), false);
  assert.equal(
    isEffectiveAnswer("审查结论：" + "有证据的限定范围审查结果。".repeat(8)),
    true,
  );
});
test("evo contract budgets: generations, first-request overhead, seconds-or-percent latency", () => {
  const n = {
    input: 20000,
    cached: 16000,
    uncached: 4000,
    generations: 1,
    firstInput: 20000,
    replySeconds: 10,
  };
  const ok = { ...n, input: 40000, uncached: 8000, generations: 2 };
  assert.deepEqual(compareRounds(n, ok).failures, []);
  assert.deepEqual(compareRounds(n, { ...ok, generations: 3 }).failures, [
    "generations",
  ]);
  assert.deepEqual(compareRounds(n, { ...ok, firstInput: 23000 }).failures, []);
  assert.deepEqual(compareRounds(n, { ...ok, firstInput: 23001 }).failures, [
    "firstInput",
  ]);
  // Short task: native 10 s allows +5 s.
  assert.deepEqual(compareRounds(n, { ...ok, replySeconds: 15 }).failures, []);
  assert.deepEqual(compareRounds(n, { ...ok, replySeconds: 15.1 }).failures, [
    "replySeconds",
  ]);
  // Long task: native 100 s allows +15%.
  const long = { ...n, replySeconds: 100 };
  const longOk = { ...ok, replySeconds: 115 };
  assert.deepEqual(compareRounds(long, longOk).failures, []);
  assert.deepEqual(
    compareRounds(long, { ...longOk, replySeconds: 115.1 }).failures,
    ["replySeconds"],
  );
});
