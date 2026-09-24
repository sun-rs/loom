import assert from "node:assert/strict";
import test from "node:test";
import { budgets, summarizeUsage, compareRounds } from "./metrics.mjs";
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
test("a receipt or progress message is not an effective final answer", async () => {
  const { isEffectiveAnswer } = await import("./metrics.mjs");
  assert.equal(isEffectiveAnswer("收到。我将只读审查两份脚本。"), false);
  assert.equal(isEffectiveAnswer("审查结论：收到"), false);
  assert.equal(
    isEffectiveAnswer("审查结论：" + "有证据的限定范围审查结果。".repeat(8)),
    true,
  );
});
// Product-recorded RAH usage (agent.run.usage.get) mirroring the transcript.
const recorded = (m, overrides = {}) => ({
  ...m,
  productUsage: {
    completeness: "complete",
    gaps: [],
    totals: {
      generations: m.generationsTotal ?? m.generations,
      inputTokens: m.input,
      cachedInputTokens: m.cached,
      outputTokens: m.output,
    },
    ...overrides,
  },
});
const nativeRound = {
  input: 20000,
  cached: 16000,
  uncached: 4000,
  output: 500,
  generations: 1,
  generationsTotal: 1,
  generationsBeforeReply: 1,
  generationsAfterReply: 0,
  firstInput: 20000,
  replySeconds: 10,
};
const rahRound = recorded({
  ...nativeRound,
  input: 46000,
  uncached: 8000,
  generations: 2,
  generationsTotal: 2,
  generationsBeforeReply: 1,
  generationsAfterReply: 1,
  firstInput: 23000,
  replySeconds: 15,
});
test("contract §6: total input ≤ 2 × (native + 3k), first request ≤ native + 3k", () => {
  assert.deepEqual(compareRounds(nativeRound, rahRound).failures, []);
  assert.equal(compareRounds(nativeRound, rahRound).status, "within-budget");
  const over = recorded({ ...rahRound, input: 46001 });
  assert.deepEqual(compareRounds(nativeRound, over).failures, ["input"]);
  assert.deepEqual(
    compareRounds(nativeRound, recorded({ ...rahRound, firstInput: 23001 }))
      .failures,
    ["firstInput"],
  );
  // Uncached ratio is reported only; §6 signs no budget for it.
  const cold = compareRounds(
    nativeRound,
    recorded({ ...rahRound, uncached: 40000 }),
  );
  assert.deepEqual(cold.failures, []);
  assert.equal(cold.uncachedRatio, 10);
  assert.equal(budgets.maxGenerations, undefined, "no absolute total cap");
});
test("contract §6 latency: short task +5 s, long task +15%", () => {
  const short = recorded({ ...rahRound, replySeconds: 15.1 });
  assert.deepEqual(compareRounds(nativeRound, short).failures, [
    "replySeconds",
  ]);
  const longNative = { ...nativeRound, replySeconds: 100 };
  assert.deepEqual(
    compareRounds(longNative, recorded({ ...rahRound, replySeconds: 115 }))
      .failures,
    [],
  );
  assert.deepEqual(
    compareRounds(longNative, recorded({ ...rahRound, replySeconds: 115.1 }))
      .failures,
    ["replySeconds"],
  );
  // Around the 33 s crossover the seconds rule still applies below it.
  const mid = { ...nativeRound, replySeconds: 30 };
  assert.deepEqual(
    compareRounds(mid, recorded({ ...rahRound, replySeconds: 35 })).failures,
    [],
  );
  assert.deepEqual(
    compareRounds(mid, recorded({ ...rahRound, replySeconds: 35.1 })).failures,
    ["replySeconds"],
  );
});
test("tool-heavy native work: RAH may add one protocol generation, none before the reply", () => {
  const n = {
    ...nativeRound,
    generations: 6,
    generationsTotal: 6,
    generationsBeforeReply: 6,
  };
  const gens = (total, beforeReply) =>
    recorded({
      ...rahRound,
      generations: total,
      generationsTotal: total,
      generationsBeforeReply: beforeReply,
      generationsAfterReply: total - beforeReply,
    });
  const ok = compareRounds(n, gens(7, 6));
  assert.deepEqual(ok.failures, []);
  assert.equal(ok.extraProtocolGenerations, 1);
  assert.equal(ok.extraGenerationsBeforeReply, 0);
  assert.deepEqual(compareRounds(n, gens(8, 6)).failures, ["generations"]);
  assert.deepEqual(compareRounds(n, gens(7, 7)).failures, [
    "generationsBeforeReply",
  ]);
  // An unknown before-reply split fails closed as missing evidence.
  const unknown = compareRounds(
    n,
    recorded({ ...gens(7, 6), generationsBeforeReply: null }),
  );
  assert.deepEqual(unknown.failures, ["generationsBeforeReplyMissing"]);
  assert.equal(unknown.status, "missing-evidence");
});
test("missing first-request evidence on either side fails closed", () => {
  for (const [a, b] of [
    [{ ...nativeRound, firstInput: undefined }, rahRound],
    [nativeRound, { ...rahRound, firstInput: null }],
  ]) {
    const r = compareRounds(a, b);
    assert.deepEqual(r.failures, ["firstInputMissing"]);
    assert.equal(r.status, "missing-evidence");
  }
});
test("partial or unavailable product usage is missing evidence, never within budget", () => {
  for (const productUsage of [
    undefined,
    {
      completeness: "partial",
      gaps: [{ reason: "inconsistent_total" }],
      totals: rahRound.productUsage.totals,
    },
    {
      completeness: "unavailable",
      gaps: [],
      totals: {
        generations: null,
        inputTokens: null,
        cachedInputTokens: null,
        outputTokens: null,
      },
    },
  ]) {
    const r = compareRounds(nativeRound, { ...rahRound, productUsage });
    assert.deepEqual(r.failures, ["usageEvidenceMissing"]);
    assert.equal(r.status, "missing-evidence");
  }
});
test("product-recorded RAH usage is cross-checked against the transcript", () => {
  const r = compareRounds(nativeRound, rahRound);
  assert.equal(r.usageEvidence.completeness, "complete");
  assert.deepEqual(r.usageEvidence.mismatches, []);
  const drift = compareRounds(nativeRound, {
    ...rahRound,
    productUsage: {
      ...rahRound.productUsage,
      totals: { ...rahRound.productUsage.totals, inputTokens: 45000 },
    },
  });
  assert.deepEqual(drift.failures, ["usageEvidenceMismatch"]);
  assert.deepEqual(drift.usageEvidence.mismatches, [
    { field: "inputTokens", product: 45000, transcript: 46000 },
  ]);
  assert.equal(drift.status, "missing-evidence");
  // Evidence problems do not hide a real budget failure.
  const both = compareRounds(nativeRound, {
    ...rahRound,
    replySeconds: 60,
    productUsage: undefined,
  });
  assert.equal(both.status, "over-budget");
});
test("comparison reports before/after/total generations of both arms", () => {
  const r = compareRounds(nativeRound, rahRound);
  assert.deepEqual(r.generations, {
    native: { total: 1, beforeReply: 1, afterReply: 0 },
    rah: { total: 2, beforeReply: 1, afterReply: 1 },
  });
  assert.equal(r.extraProtocolGenerations, 1);
});
