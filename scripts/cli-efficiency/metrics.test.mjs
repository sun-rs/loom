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
test("usage completion times cannot distinguish a delayed posting record from a follow-up", () => {
  // A record at :07 may be delayed usage for the posting response, not a new
  // generation. Synthetic response IDs do not provide an output association.
  const events = [
    usageAt("check", "2026-01-01T00:00:01.000Z"),
    usageAt("post", "2026-01-01T00:00:04.000Z"),
    usageAt("final", "2026-01-01T00:00:07.000Z"),
  ];
  const m = summarizeUsage(events, { replyAt: "2026-01-01T00:00:05.000Z" });
  assert.equal(m.generations, 3, "generations stays the total");
  assert.equal(m.generationsTotal, 3);
  assert.equal(m.generationsBeforeReply, null);
  assert.equal(m.generationsAfterReply, null);
  assert.deepEqual(m.replyTimingEvidence, {
    basis: "usage-record-upper-bound",
    knownBeforeReply: 2,
    unresolved: 1,
  });
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
test("contract §6: total input ≤ 2 × (native + 3k); per-round first request is not a budget", () => {
  assert.deepEqual(compareRounds(nativeRound, rahRound).failures, []);
  assert.equal(compareRounds(nativeRound, rahRound).status, "within-budget");
  const over = recorded({ ...rahRound, input: 46001 });
  assert.deepEqual(compareRounds(nativeRound, over).failures, ["input"]);
  // Fixed overhead is judged once, at the fresh session's first generation
  // (compareArm); a follow-up round's larger first request is reported only.
  assert.deepEqual(
    compareRounds(nativeRound, recorded({ ...rahRound, firstInput: 23001 }))
      .failures,
    [],
  );
  assert.equal(budgets.firstInputOverheadTokens, undefined);
  assert.equal(budgets.fixedOverheadTokens, 3000);
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

// Per-round metrics shaped like result.json arms[*].rounds[*].metrics.
const round = (m) => ({
  cached: 0,
  uncached: 0,
  output: 1,
  replySeconds: 10,
  toolCalls: [],
  generationsTotal: m.generations,
  generationsBeforeReply: m.generations,
  generationsAfterReply: 0,
  ...m,
});
const post = { name: "exec", kind: "box-post" };
const read = { name: "exec", kind: "other" };
// Native: r1 reads a file (2 generations), follow-ups answer directly.
const nativeArm = [
  round({ generations: 2, firstInput: 10000, input: 22000, toolCalls: [read] }),
  round({ generations: 1, firstInput: 15000, input: 15000 }),
  round({ generations: 1, firstInput: 16000, input: 16000 }),
];
const rahArmRound = (m) =>
  recorded(
    round({
      generationsBeforeReply: m.generations - 1,
      generationsAfterReply: 1,
      ...m,
    }),
  );
test("contract §6 fixed overhead: fresh session first generation only, ≤ native + 3k", async () => {
  const { compareArm } = await import("./metrics.mjs");
  const rah = [
    rahArmRound({
      generations: 3,
      firstInput: 13000,
      input: 42000,
      toolCalls: [read, post],
    }),
    rahArmRound({
      generations: 2,
      firstInput: 18000,
      input: 36000,
      toolCalls: [post],
    }),
    rahArmRound({
      generations: 2,
      firstInput: 19000,
      input: 38000,
      toolCalls: [post],
    }),
  ];
  const r = compareArm(nativeArm, rah);
  assert.deepEqual(r.fixedOverhead, {
    rah: 13000,
    native: 10000,
    tokens: 3000,
    budget: 3000,
  });
  assert.deepEqual(r.failures, []);
  const over = compareArm(nativeArm, [
    rahArmRound({ ...rah[0], firstInput: 13001 }),
    ...rah.slice(1),
  ]);
  assert.deepEqual(over.failures, ["fixedOverhead"]);
  assert.equal(over.status, "over-budget");
  // Follow-up rounds with large first requests do not fail fixed overhead.
  assert.deepEqual(
    r.rounds.map((x) => x.failures),
    [[], [], []],
  );
  const missing = compareArm(nativeArm, [
    { ...rah[0], firstInput: null },
    ...rah.slice(1),
  ]);
  assert.ok(missing.failures.includes("fixedOverheadMissing"));
  assert.equal(missing.status, "missing-evidence");
});
test("contract §6 residue and work-path variance are reported separately", async () => {
  const { compareArm } = await import("./metrics.mjs");
  const rah = [
    // Extra business read in r1 (work-path variance), plus a post.
    rahArmRound({
      generations: 4,
      firstInput: 12000,
      input: 56000,
      toolCalls: [read, read, post],
    }),
    rahArmRound({
      generations: 2,
      firstInput: 19000,
      input: 38500,
      toolCalls: [post],
    }),
    rahArmRound({
      generations: 2,
      firstInput: 20500,
      input: 41500,
      toolCalls: [post],
    }),
  ];
  const r = compareArm(nativeArm, rah);
  // Growth between consecutive follow-up rounds only: r2 -> r3.
  assert.deepEqual(r.perRoundResidue, [
    {
      fromRound: 2,
      toRound: 3,
      rahGrowth: 1500,
      nativeGrowth: 1000,
      tokens: 500,
    },
  ]);
  // r1 -> r2 growth difference carries r1's work path and r1 protocol
  // history; it is reported apart and never folded into fixed overhead.
  assert.deepEqual(r.workPathVariance.round1HistoryDelta, {
    rahGrowth: 7000,
    nativeGrowth: 5000,
    tokens: 2000,
  });
  assert.deepEqual(r.workPathVariance.rounds[0], {
    round: 1,
    businessToolCalls: { rah: 2, native: 1, delta: 1 },
    generations: { rah: 4, native: 2, delta: 2 },
    // Owner A: one of the two extra generations is the extra business read.
    extraGenerations: { raw: 2, workPath: 1, protocol: 1 },
    toolCalls: {
      rah: {
        total: 3,
        business: 2,
        protocol: 1,
        unknown: 0,
        byKind: { other: 2, "box-post": 1 },
      },
      native: {
        total: 1,
        business: 1,
        protocol: 0,
        unknown: 0,
        byKind: { other: 1 },
      },
    },
  });
  assert.equal(r.workPathVariance.rounds[1].businessToolCalls.delta, 0);
});
test("a total-input failure carries the exact fixed/residue/work-path decomposition", async () => {
  const { compareArm } = await import("./metrics.mjs");
  const rah = [
    rahArmRound({
      generations: 3,
      firstInput: 12000,
      input: 40000,
      toolCalls: [read, post],
    }),
    rahArmRound({
      generations: 2,
      firstInput: 18000,
      input: 36000,
      toolCalls: [post],
    }),
    // r3 over 2 × (16000 + 3000) = 38000.
    rahArmRound({
      generations: 2,
      firstInput: 20500,
      input: 41500,
      toolCalls: [post],
    }),
  ];
  const r = compareArm(nativeArm, rah);
  const r3 = r.rounds[2];
  assert.deepEqual(r3.failures, ["input"]);
  const d = r3.inputDecomposition;
  assert.equal(d.budget, 38000);
  assert.equal(d.delta, 41500 - 16000);
  // Start-context difference per RAH generation: fixed 2000 + r1 history
  // (6000 − 5000) 1000 + residue r2->r3 (2500 − 1000) 1500 = 4500 = 20500 − 16000.
  assert.deepEqual(
    {
      fixedOverhead: d.fixedOverhead,
      round1History: d.round1History,
      residue: d.residue,
      extraGenerations: d.extraGenerations,
      intraRound: d.intraRound,
    },
    {
      fixedOverhead: 2 * 2000,
      round1History: 2 * 1000,
      residue: 2 * 1500,
      extraGenerations: (2 - 1) * 16000,
      intraRound: 41500 - 2 * 20500 - 0,
    },
  );
  assert.equal(
    d.fixedOverhead +
      d.round1History +
      d.residue +
      d.extraGenerations +
      d.intraRound,
    d.delta,
  );
  // Within-budget rounds still carry it (report), r1 has no history terms.
  assert.equal(r.rounds[0].inputDecomposition.round1History, 0);
  assert.equal(r.rounds[0].inputDecomposition.residue, 0);
  assert.equal(r.status, "over-budget");
});
test("final-reply interrupt is reported per round and summarized per arm, never budgeted", async () => {
  const { compareArm } = await import("./metrics.mjs");
  const rah = [
    rahArmRound({
      generations: 1,
      firstInput: 13000,
      input: 13000,
      toolCalls: [post],
      finalInterrupt: {
        committedRoomSeq: 4,
        requested: true,
        accepted: true,
        terminal: true,
        sent: true,
        preemptedFollowUp: true,
      },
    }),
    rahArmRound({
      generations: 2,
      firstInput: 18000,
      input: 36000,
      toolCalls: [post],
      finalInterrupt: {
        committedRoomSeq: 7,
        sent: true,
        preemptedFollowUp: false,
      },
    }),
    rahArmRound({
      generations: 2,
      firstInput: 19000,
      input: 38000,
      toolCalls: [post],
      finalInterrupt: {
        committedRoomSeq: 9,
        sent: false,
        preemptedFollowUp: "unknown",
      },
    }),
    rahArmRound({
      generations: 2,
      firstInput: 20000,
      input: 40000,
      toolCalls: [post],
      finalInterrupt: null,
    }),
    rahArmRound({
      generations: 2,
      firstInput: 21000,
      input: 42000,
      toolCalls: [post],
    }),
  ];
  const r = compareArm([...nativeArm, ...nativeArm.slice(0, 2)], rah);
  assert.deepEqual(
    r.rounds.map((x) => x.finalInterrupt),
    [
      {
        committed: true,
        requested: true,
        accepted: true,
        terminal: true,
        sent: true,
        preemptedFollowUp: true,
      },
      // Older product reads: requested follows sent, the rest stays unknown.
      {
        committed: true,
        requested: true,
        accepted: "unknown",
        terminal: "unknown",
        sent: true,
        preemptedFollowUp: false,
      },
      {
        committed: true,
        requested: false,
        accepted: "unknown",
        terminal: "unknown",
        sent: false,
        preemptedFollowUp: "unknown",
      },
      {
        committed: false,
        requested: false,
        accepted: null,
        terminal: null,
        sent: false,
        preemptedFollowUp: null,
      },
      null,
    ],
  );
  assert.deepEqual(r.finalInterrupt, {
    rounds: 5,
    committed: 3,
    requested: 2,
    accepted: 1,
    terminal: 1,
    sent: 2,
    preempted: 1,
    notPreempted: 1,
    unknown: 1,
    noFinalPost: 1,
    evidenceMissing: 1,
  });
  // Reported only: no failure names come from it.
  assert.ok(r.rounds.every((x) => !x.failures.some((f) => /final/i.test(f))));
});

test("per-provider generations (product/transcript records) summarize like Codex usage", async () => {
  const { summarizeGenerations } = await import("./metrics.mjs");
  const g = (id, at, input, cached, output, reasoning = null) => ({
    responseId: id,
    observedAt: at,
    inputTokens: input,
    cachedInputTokens: cached,
    outputTokens: output,
    reasoningOutputTokens: reasoning,
  });
  const records = [
    g("a", "2026-01-01T00:00:01.000Z", 21005, 20000, 40),
    g("b", "2026-01-01T00:00:04.000Z", 21307, 21000, 220),
    g("a", "2026-01-01T00:00:01.000Z", 21005, 20000, 40),
    g("c", "2026-01-01T00:00:07.000Z", 22000, 21300, 10),
  ];
  const m = summarizeGenerations(records, {
    replyAt: "2026-01-01T00:00:05.000Z",
  });
  assert.deepEqual(m, {
    generations: 3,
    generationsTotal: 3,
    generationsBeforeReply: null,
    generationsAfterReply: null,
    replyTimingEvidence: {
      basis: "native-generation-timing",
      knownBeforeReply: 2,
      knownAfterReply: 0,
      unresolved: 1,
    },
    input: 64312,
    cached: 62300,
    uncached: 2012,
    output: 270,
    reasoning: null,
    firstInput: 21005,
    peakInput: 22000,
  });
  assert.equal(summarizeGenerations(records).generationsBeforeReply, 3);
  assert.equal(
    summarizeGenerations(records, { replyAt: null }).generationsBeforeReply,
    null,
  );
  assert.throws(() => summarizeGenerations([]), /Missing/);
  assert.throws(() => summarizeGenerations([g("x", "t", 1, 2, 0)]), /cached/);
});

test("an independent transcript cross-check mismatch is usage evidence mismatch", () => {
  const ok = compareRounds(nativeRound, {
    ...rahRound,
    transcriptUsage: {
      generations: 2,
      inputTokens: 46000,
      cachedInputTokens: rahRound.productUsage.totals.cachedInputTokens,
    },
  });
  assert.deepEqual(ok.usageEvidence.mismatches, []);
  const bad = compareRounds(nativeRound, {
    ...rahRound,
    transcriptUsage: { generations: 3 },
  });
  assert.deepEqual(bad.failures, ["usageEvidenceMismatch"]);
  assert.deepEqual(bad.usageEvidence.mismatches, [
    { field: "generations", product: 2, transcript: 3, source: "transcript" },
  ]);
});

test("unmeasured dimensions are reported as sub-items and make the verdict missing-evidence (Kimi: no product usage)", async () => {
  const { compareArm } = await import("./metrics.mjs");
  const noProduct = compareRounds(
    nativeRound,
    { ...rahRound, productUsage: undefined },
    { unmeasured: ["productUsage"] },
  );
  assert.deepEqual(noProduct.failures, []);
  assert.equal(noProduct.usageEvidence.completeness, "not-recorded");
  assert.deepEqual(noProduct.unmeasured, ["productUsage"]);
  // Contract §6: a usage gap is never within budget (seventh review P1-4);
  // the measured sub-items keep their own verdict.
  assert.equal(noProduct.status, "missing-evidence");
  assert.equal(noProduct.measuredStatus, "within-budget");
  // Latency only: tokens and generations unknown on both sides.
  const bare = (r) => ({ replySeconds: r.replySeconds });
  const latencyOnly = compareArm(
    [bare(nativeRound), bare(nativeRound)],
    [bare(rahRound), bare({ ...rahRound, replySeconds: 99 })],
    { unmeasured: ["productUsage", "tokens", "generations"] },
  );
  assert.deepEqual(latencyOnly.failures, []);
  assert.deepEqual(latencyOnly.rounds[0].failures, []);
  assert.deepEqual(latencyOnly.rounds[1].failures, ["replySeconds"]);
  assert.equal(latencyOnly.status, "missing-evidence");
  assert.equal(latencyOnly.measuredStatus, "over-budget");
  assert.equal(latencyOnly.rounds[0].status, "missing-evidence");
  assert.equal(latencyOnly.rounds[0].measuredStatus, "within-budget");
  assert.deepEqual(latencyOnly.unmeasured, [
    "productUsage",
    "tokens",
    "generations",
  ]);
  // Default (Codex/Claude): nothing is exempt, missing evidence still fails.
  const strict = compareArm([bare(nativeRound)], [bare(rahRound)]);
  assert.equal(strict.status, "missing-evidence");
});

test("seventh review P1-4: latency-only evidence is never within budget or quality-review ready", async () => {
  const { compareArm, gateStatus } = await import("./metrics.mjs");
  const bare = (seconds) => ({ replySeconds: seconds });
  const latencyOnly = compareRounds(bare(1), bare(1), {
    unmeasured: ["tokens", "generations", "productUsage"],
  });
  assert.equal(latencyOnly.status, "missing-evidence");
  assert.equal(latencyOnly.measuredStatus, "within-budget");
  const arm = compareArm([bare(1)], [bare(1)], {
    unmeasured: ["tokens", "generations", "productUsage"],
  });
  const complete = {
    native: { status: "complete" },
    role: { status: "complete" },
  };
  const gate = gateStatus({ arms: complete, comparisons: { role: arm } });
  assert.equal(gate.status, "missing-evidence");
  assert.equal(gate.measuredStatus, "within-budget");
  // Fully measured and within budget: quality review, as before.
  const measured = compareArm([nativeRound], [rahRound]);
  assert.equal(
    gateStatus({ arms: complete, comparisons: { role: measured } }).status,
    measured.status === "within-budget"
      ? "needs-quality-review"
      : measured.status === "over-budget"
        ? "over-budget"
        : "failed",
  );
  // Real missing evidence (a measured dimension absent) still fails.
  const strict = compareArm([bare(1)], [bare(1)]);
  assert.equal(
    gateStatus({ arms: complete, comparisons: { role: strict } }).status,
    "failed",
  );
  assert.equal(
    gateStatus({
      arms: { ...complete, role: { status: "failed" } },
      comparisons: { role: arm },
    }).status,
    "failed",
  );
});

// Owner 2026-09-25 A: extra business generations caused by a different work
// path (e.g. re-reading a file with line numbers) are reported, never judged
// as protocol overhead. Protocol extra = total extra − business call delta.
const at = (s) => `2026-01-01T00:00:${String(s).padStart(2, "0")}.000Z`;
const call = (kind, s) => ({ name: "exec", kind, at: at(s) });
const nativeRead = {
  ...nativeRound,
  generations: 2,
  generationsTotal: 2,
  generationsBeforeReply: 2,
  generationsAfterReply: 0,
  firstInput: 10000,
  input: 22000,
  toolCalls: [call("other", 1)],
};
const rahWork = (toolCalls, overrides = {}) =>
  recorded({
    ...nativeRound,
    generations: 3,
    generationsTotal: 3,
    generationsBeforeReply: 3,
    generationsAfterReply: 0,
    firstInput: 12000,
    input: 45000,
    replySeconds: 12,
    replyAt: at(9),
    toolCalls,
    ...overrides,
  });
test("owner A: a pure business re-read is reported but is not protocol overhead", () => {
  // sed read, nl re-read, post: raw input 55000 exceeds 2 × (22000 + 3000),
  // the re-read generation's input (1 × native first request) is work path.
  const r = compareRounds(
    nativeRead,
    rahWork([call("other", 1), call("other", 3), call("box-post", 5)], {
      input: 55000,
    }),
  );
  assert.deepEqual(r.failures, []);
  assert.equal(r.extraGenerations, 1);
  assert.equal(r.extraGenerationsBeforeReply, 1);
  assert.equal(r.workPathExtraGenerations, 1);
  assert.equal(r.workPathExtraGenerationsBeforeReply, 1);
  assert.equal(r.extraProtocolGenerations, 0);
  assert.equal(r.extraProtocolGenerationsBeforeReply, 0);
  assert.deepEqual(r.workPath.businessToolCalls, {
    rah: 2,
    native: 1,
    delta: 1,
  });
  assert.deepEqual(r.workPath.toolCalls.rah.byKind, {
    other: 2,
    "box-post": 1,
  });
  assert.equal(r.workPath.unknownCountedAsProtocol, 0);
  assert.deepEqual(r.input, {
    raw: 55000,
    workPath: 10000,
    judged: 45000,
    budget: 50000,
  });
  assert.equal(r.inputRatio, 55000 / 22000);
  assert.deepEqual(r.notes, []);
});
test("owner A: one more protocol call is still over budget", () => {
  const r = compareRounds(
    nativeRead,
    rahWork([call("other", 1), call("box-check", 3), call("box-post", 5)]),
  );
  assert.equal(r.workPathExtraGenerations, 0);
  assert.equal(r.extraProtocolGenerationsBeforeReply, 1);
  assert.deepEqual(r.failures, ["generationsBeforeReply"]);
  // RAH doing less business work never hides a protocol generation.
  const lessWork = compareRounds(
    {
      ...nativeRead,
      generations: 3,
      generationsTotal: 3,
      generationsBeforeReply: 3,
      input: 32000,
      toolCalls: [call("other", 1), call("other", 2)],
    },
    rahWork([call("other", 1), call("box-check", 3), call("box-post", 5)]),
  );
  assert.equal(lessWork.extraGenerationsBeforeReply, 0);
  assert.equal(lessWork.workPathExtraGenerations, -1);
  assert.equal(lessWork.extraProtocolGenerationsBeforeReply, 1);
  assert.deepEqual(lessWork.failures, ["generationsBeforeReply"]);
});
test("owner A: an unknown tool category is conservatively counted as protocol", () => {
  const r = compareRounds(
    nativeRead,
    rahWork([call("other", 1), call("unknown", 3), call("box-post", 5)]),
  );
  assert.equal(r.workPath.businessToolCalls.rah, 1);
  assert.equal(r.workPath.unknownCountedAsProtocol, 1);
  assert.equal(r.extraProtocolGenerationsBeforeReply, 1);
  assert.deepEqual(r.failures, ["generationsBeforeReply"]);
  assert.deepEqual(r.notes, ["toolCategoryUnknown"]);
  // Native has no Worker CLI: its unknown calls count as business, which
  // only shrinks the credited delta.
  const nat = compareRounds(
    { ...nativeRead, toolCalls: [call("unknown", 1)] },
    rahWork([call("other", 1), call("other", 3), call("box-post", 5)]),
  );
  assert.equal(nat.workPath.businessToolCalls.native, 1);
  assert.equal(nat.workPathExtraGenerations, 1);
});
test("owner A: without tool-call evidence nothing is credited", () => {
  const r = compareRounds(
    { ...nativeRead, toolCalls: undefined },
    rahWork([call("other", 1), call("other", 3), call("box-post", 5)]),
  );
  assert.equal(r.workPathExtraGenerations, null);
  assert.equal(r.extraProtocolGenerationsBeforeReply, 1);
  assert.equal(r.input.workPath, null);
  assert.equal(r.input.judged, r.input.raw);
  assert.deepEqual(r.notes, ["workPathUnavailable"]);
  assert.deepEqual(r.failures, ["generationsBeforeReply"]);
});
test("owner A: a business call after the reply does not credit before-reply", () => {
  const r = compareRounds(
    nativeRead,
    rahWork([call("other", 1), call("box-post", 5), call("other", 12)], {
      generationsBeforeReply: 2,
      generationsAfterReply: 1,
    }),
  );
  assert.equal(r.workPathExtraGenerations, 1);
  assert.equal(r.workPathExtraGenerationsBeforeReply, 0);
  assert.equal(r.extraProtocolGenerationsBeforeReply, 0);
  assert.equal(r.extraProtocolGenerations, 0);
});
test("owner A: the terminal line reports raw, work-path and protocol counts", async () => {
  const { formatComparisonRound } = await import("./metrics.mjs");
  const r = compareRounds(
    nativeRead,
    rahWork([call("other", 1), call("other", 3), call("box-post", 5)], {
      input: 55000,
    }),
  );
  const line = formatComparisonRound("role", 1, r);
  for (const part of [
    "role round 1",
    "extra raw +1 (before-reply +1)",
    "work-path +1 (before-reply +1)",
    "protocol +0 (before-reply +0)",
    "business calls rah 2 / native 1",
    '"box-post":1',
    "input raw 55000 work-path 10000 judged 45000 budget 50000",
  ])
    assert.ok(line.includes(part), `${part} in ${line}`);
});
test("owner A: the input decomposition splits extra generations into work path and protocol", async () => {
  const { compareArm } = await import("./metrics.mjs");
  const r = compareArm(
    [nativeRead],
    [rahWork([call("other", 1), call("other", 3), call("box-post", 5)])],
  );
  const d = r.rounds[0].inputDecomposition;
  assert.equal(d.extraGenerations, 10000);
  assert.equal(d.workPathGenerations, 10000);
  assert.equal(d.protocolGenerations, 0);
  assert.deepEqual(r.workPathVariance.rounds[0].extraGenerations, {
    raw: 1,
    workPath: 1,
    protocol: 0,
  });
});

test("mixed native timing keeps exact split unknown and excludes proven after-reply generation from its upper bound", async () => {
  const { summarizeGenerations } = await import("./metrics.mjs");
  const row = (responseId, extra = {}) => ({
    responseId,
    observedAt: "2026-01-01T00:00:10Z",
    inputTokens: 1,
    cachedInputTokens: 0,
    outputTokens: 1,
    reasoningOutputTokens: null,
    ...extra,
  });
  const measured = summarizeGenerations(
    [
      row("known-after", {
        startedAfter: "2026-01-01T00:00:06Z",
        startedBy: "2026-01-01T00:00:07Z",
      }),
      row("unknown"),
    ],
    { replyAt: "2026-01-01T00:00:05Z" },
  );
  assert.equal(measured.generationsBeforeReply, null);
  assert.deepEqual(measured.replyTimingEvidence, {
    basis: "native-generation-timing",
    knownBeforeReply: 0,
    knownAfterReply: 1,
    unresolved: 1,
  });
  const compared = compareRounds(
    { generationsTotal: 1, toolCalls: [] },
    { ...measured, toolCalls: [] },
  );
  assert.equal(compared.beforeReplyBudgetEvidence.upper, 0);
  assert.equal(compared.beforeReplyBudgetEvidence.status, "within-budget");
});

test("unreported request coverage on either arm defeats otherwise matching recorded token totals", () => {
  const gap = {
    status: "incomplete",
    requests: 3,
    matchedRequests: 2,
    unreportedRequests: 1,
    unmatchedUsageRecords: 0,
  };
  for (const [native, rah] of [
    [{ ...nativeRound, requestCoverage: gap }, rahRound],
    [nativeRound, { ...rahRound, requestCoverage: gap }],
  ]) {
    const result = compareRounds(native, rah);
    assert.ok(result.failures.includes("usageEvidenceMissing"));
    assert.equal(result.measuredStatus, "missing-evidence");
  }
});
