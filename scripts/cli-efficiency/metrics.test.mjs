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
    generationsTotal: 1,
    generationsBeforeReply: 1,
    generationsAfterReply: 0,
    firstInput: 100,
    peakInput: 100,
  });
  assert.throws(() => summarizeUsage([]), /Missing/);
});
const usageAt = (id, timestamp) => ({
  type: "token_usage_record",
  timestamp,
  payload: {
    response_id: id,
    usage: {
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 1,
      reasoning_output_tokens: 0,
    },
  },
});
test("generations split at the effective Room reply: the posting generation is before-reply", () => {
  // check -> post (its tool call lands the reply at :05) -> final.
  const events = [
    usageAt("check", "2026-01-01T00:00:01.000Z"),
    usageAt("post", "2026-01-01T00:00:04.000Z"),
    usageAt("final", "2026-01-01T00:00:07.000Z"),
  ];
  const m = summarizeUsage(events, { replyAt: "2026-01-01T00:00:05.000Z" });
  assert.equal(m.generations, 3, "generations stays the total");
  assert.equal(m.generationsTotal, 3);
  assert.equal(m.generationsBeforeReply, 2);
  assert.equal(m.generationsAfterReply, 1);
  // Native: the final answer generation is the reply, so everything is before.
  const n = summarizeUsage(events);
  assert.equal(n.generationsBeforeReply, 3);
  assert.equal(n.generationsAfterReply, 0);
  // No effective reply: the split is unknown, never guessed.
  const u = summarizeUsage(events, { replyAt: null });
  assert.equal(u.generationsBeforeReply, null);
  assert.equal(u.generationsAfterReply, null);
  assert.throws(
    () =>
      summarizeUsage([{ ...events[0], timestamp: "bad" }], {
        replyAt: "2026-01-01T00:00:05Z",
      }),
    /timestamp/,
  );
});
test("large per-round overhead fails even if all replies succeeded", () => {
  const n = {
    input: 100,
    cached: 80,
    uncached: 20,
    generations: 1,
    firstInput: 100,
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
  // Uncached ratio is a reported diagnostic, not a signed §6 budget.
  const cold = compareRounds(n, { ...ok, uncached: 40000 });
  assert.deepEqual(cold.failures, []);
  assert.equal(cold.uncachedRatio, 10);
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
test("missing first-request evidence on either side fails closed", () => {
  const n = {
    input: 100,
    cached: 0,
    uncached: 100,
    generations: 1,
    firstInput: 100,
    replySeconds: 10,
  };
  for (const [a, b] of [
    [{ ...n, firstInput: undefined }, n],
    [n, { ...n, firstInput: null }],
  ]) {
    const r = compareRounds(a, b);
    assert.deepEqual(r.failures, ["firstInputMissing"]);
    assert.notEqual(r.status, "within-budget");
  }
});
test("comparison reports before/after/total generations and extra protocol generations", () => {
  const n = {
    input: 100,
    cached: 0,
    uncached: 100,
    generations: 1,
    generationsTotal: 1,
    generationsBeforeReply: 1,
    generationsAfterReply: 0,
    firstInput: 100,
    replySeconds: 10,
  };
  const r = compareRounds(n, {
    ...n,
    input: 150,
    generations: 3,
    generationsTotal: 3,
    generationsBeforeReply: 2,
    generationsAfterReply: 1,
  });
  assert.deepEqual(r.generations, {
    native: { total: 1, beforeReply: 1, afterReply: 0 },
    rah: { total: 3, beforeReply: 2, afterReply: 1 },
  });
  assert.equal(r.extraProtocolGenerations, 2);
  // Current budget still applies to the total until the owner approves new numbers.
  assert.deepEqual(r.failures, ["generations"]);
});
