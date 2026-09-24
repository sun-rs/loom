import assert from "node:assert/strict";
// Budgets of docs/evo/target-contract.zh-CN.md §6 as revised by the owner on
// 2026-09-24 (the earlier "≤2 before reply, total input ≤2×" was unreachable).
// Generation limits are relative to the native arm's whole-turn count, so
// native tool rounds are business work, not protocol overhead. The uncached
// ratio is reported only; §6 signs no budget for it.
export const budgets = {
  maxExtraGenerations: 1, // rah total − native total
  maxExtraGenerationsBeforeReply: 0, // rah before-reply − native total
  // Fixed overhead: first generation input of the fresh session (round 1,
  // generation 1), rah − native. Judged once per arm, never per follow-up.
  fixedOverheadTokens: 3000,
  inputRatio: 2, // rah total input ≤ 2 × (native total input + 3k)
  inputAllowanceTokens: 3000,
  replyAllowanceSeconds: 5, // extra latency ≤ max(5 s, 15% of native)
  replyAllowanceRatio: 0.15,
};
// Evidence failures make the comparison "missing-evidence", never a pass.
const EVIDENCE_FAILURES = new Set([
  "usageEvidenceMissing",
  "usageEvidenceMismatch",
]);
const isEvidenceFailure = (f) =>
  f.endsWith("Missing") || EVIDENCE_FAILURES.has(f);
// replyAt: ISO time the effective Room reply landed. The generation whose tool
// call posted it finished (and recorded usage) before that time, so it counts
// as before-reply; later generations are after-reply. Omitted = native arm,
// where the final answer generation is the reply. null = no effective reply,
// so the split is unknown.
export function summarizeUsage(events, { replyAt } = {}) {
  const byResponse = new Map();
  for (const e of events)
    if (
      e.type === "token_usage_record" &&
      !byResponse.has(e.payload.response_id)
    )
      byResponse.set(e.payload.response_id, e);
  const records = [...byResponse.values()];
  const rows = records.map((e) => e.payload.usage);
  assert.ok(rows.length, "Missing native per-response usage evidence");
  let before = rows.length;
  if (replyAt === null) before = null;
  else if (replyAt !== undefined) {
    const cut = Date.parse(replyAt);
    assert.ok(Number.isFinite(cut), "Invalid effective reply timestamp");
    before = records.filter((e) => {
      const at = Date.parse(e.timestamp);
      assert.ok(Number.isFinite(at), "Invalid usage timestamp");
      return at <= cut;
    }).length;
  }
  const out = {
    generations: rows.length,
    generationsTotal: rows.length,
    generationsBeforeReply: before,
    generationsAfterReply: before === null ? null : rows.length - before,
    input: 0,
    cached: 0,
    uncached: 0,
    output: 0,
    reasoning: 0,
    firstInput: rows[0].input_tokens,
    peakInput: 0,
  };
  for (const u of rows) {
    for (const k of [
      "input_tokens",
      "cached_input_tokens",
      "output_tokens",
      "reasoning_output_tokens",
    ])
      assert.ok(Number.isFinite(u[k]) && u[k] >= 0, "Invalid usage " + k);
    assert.ok(u.cached_input_tokens <= u.input_tokens);
    out.input += u.input_tokens;
    out.cached += u.cached_input_tokens;
    out.output += u.output_tokens;
    out.reasoning += u.reasoning_output_tokens;
    out.peakInput = Math.max(out.peakInput, u.input_tokens);
  }
  out.uncached = out.input - out.cached;
  return out;
}
const generationCounts = (m) => ({
  total: m.generationsTotal ?? m.generations,
  beforeReply: m.generationsBeforeReply ?? null,
  afterReply: m.generationsAfterReply ?? null,
});
const finite = (v) => typeof v === "number" && Number.isFinite(v);
// Product-recorded RAH usage (agent.run.usage.get) must be complete, and when
// both exist it must agree with the transcript-derived RAH usage.
function usageEvidence(rah) {
  const product = rah.productUsage;
  const completeness = product?.completeness ?? "unavailable";
  const mismatches = [];
  if (completeness === "complete")
    for (const [field, transcript] of [
      ["generations", rah.generationsTotal ?? rah.generations],
      ["inputTokens", rah.input],
      ["cachedInputTokens", rah.cached],
      ["outputTokens", rah.output],
    ]) {
      const recorded = product.totals?.[field];
      if (finite(transcript) && recorded !== transcript)
        mismatches.push({ field, product: recorded ?? null, transcript });
    }
  return { completeness, gaps: product?.gaps ?? [], mismatches };
}
// Final-reply turn end (product usage `finalInterrupt`), reported per round
// and never budgeted. `null` from the product means no `final` post
// committed; an absent field means the evidence was not collected. The
// interrupt is three facts: requested, accepted (the runtime answered) and
// terminal (the turn ended interrupted); older product reads carry only
// `sent`, so requested follows it and the other two stay unknown.
function finalInterruptOf(rah) {
  if (rah.finalInterrupt === undefined) return null;
  const f = rah.finalInterrupt;
  if (f === null)
    return {
      committed: false,
      requested: false,
      accepted: null,
      terminal: null,
      sent: false,
      preemptedFollowUp: null,
    };
  const fact = (v) => (typeof v === "boolean" ? v : "unknown");
  return {
    committed: true,
    requested: typeof f.requested === "boolean" ? f.requested : f.sent === true,
    accepted: fact(f.accepted),
    terminal: fact(f.terminal),
    sent: f.sent === true,
    preemptedFollowUp: f.preemptedFollowUp,
  };
}
function summarizeFinalInterrupts(rahRounds) {
  const out = {
    rounds: rahRounds.length,
    committed: 0,
    requested: 0,
    accepted: 0,
    terminal: 0,
    sent: 0,
    preempted: 0,
    notPreempted: 0,
    unknown: 0,
    noFinalPost: 0,
    evidenceMissing: 0,
  };
  for (const r of rahRounds) {
    const f = finalInterruptOf(r);
    if (f === null) out.evidenceMissing += 1;
    else if (!f.committed) out.noFinalPost += 1;
    else {
      out.committed += 1;
      if (f.requested) out.requested += 1;
      if (f.accepted === true) out.accepted += 1;
      if (f.terminal === true) out.terminal += 1;
      if (f.sent) out.sent += 1;
      if (f.preemptedFollowUp === true) out.preempted += 1;
      else if (f.preemptedFollowUp === false) out.notPreempted += 1;
      else out.unknown += 1;
    }
  }
  return out;
}
const statusOf = (failures) =>
  failures.length && failures.every(isEvidenceFailure)
    ? "missing-evidence"
    : failures.length
      ? "over-budget"
      : "within-budget";
const diff = (a, b) => (finite(a) && finite(b) ? a - b : null);
const businessToolCalls = (m) =>
  Array.isArray(m.toolCalls)
    ? m.toolCalls.filter((c) => c.kind !== "box-post").length
    : null;
// Context growth of round i = first request of i − first request of i−1.
const growth = (rounds, i) =>
  diff(rounds[i]?.firstInput, rounds[i - 1]?.firstInput);
// Contract §6 decomposition over both arms of one gate run.
// - fixedOverhead: fresh session, round 1 generation 1 (budgeted).
// - perRoundResidue: RAH growth − native growth between consecutive
//   follow-up rounds (reported).
// - workPathVariance: business tool calls/generations per round and the
//   round 1 → 2 history difference (reported; it holds round 1's work path
//   and round 1's protocol history, which usage alone cannot separate).
// Each round's total-input delta is split exactly into
//   G_rah·(fixed + round1History + cumulative residue)
//   + (G_rah − G_native)·native first request + intra-round growth delta.
export function compareArm(nativeRounds, rahRounds) {
  const failures = [];
  const fixedTokens = diff(
    rahRounds[0]?.firstInput,
    nativeRounds[0]?.firstInput,
  );
  const fixedOverhead = {
    rah: rahRounds[0]?.firstInput ?? null,
    native: nativeRounds[0]?.firstInput ?? null,
    tokens: fixedTokens,
    budget: budgets.fixedOverheadTokens,
  };
  if (fixedTokens === null) failures.push("fixedOverheadMissing");
  else if (fixedTokens > budgets.fixedOverheadTokens)
    failures.push("fixedOverhead");
  const n = Math.min(nativeRounds.length, rahRounds.length);
  const history1 =
    n >= 2
      ? {
          rahGrowth: growth(rahRounds, 1),
          nativeGrowth: growth(nativeRounds, 1),
          tokens: diff(growth(rahRounds, 1), growth(nativeRounds, 1)),
        }
      : null;
  const perRoundResidue = [];
  for (let i = 2; i < n; i++) {
    const rahGrowth = growth(rahRounds, i);
    const nativeGrowth = growth(nativeRounds, i);
    perRoundResidue.push({
      fromRound: i,
      toRound: i + 1,
      rahGrowth,
      nativeGrowth,
      tokens: diff(rahGrowth, nativeGrowth),
    });
  }
  const workRounds = [];
  const rounds = [];
  let residueSum = 0;
  for (let i = 0; i < n; i++) {
    const nat = nativeRounds[i];
    const rah = rahRounds[i];
    const gRah = generationCounts(rah).total;
    const gNat = generationCounts(nat).total;
    const nb = businessToolCalls(nat);
    const rb = businessToolCalls(rah);
    workRounds.push({
      round: i + 1,
      businessToolCalls: { rah: rb, native: nb, delta: diff(rb, nb) },
      generations: {
        rah: gRah ?? null,
        native: gNat ?? null,
        delta: diff(gRah, gNat),
      },
    });
    // Residue accumulates: round i's context carries every earlier residue.
    if (i >= 2) {
      const step = perRoundResidue[i - 2].tokens;
      residueSum =
        finite(residueSum) && finite(step) ? residueSum + step : null;
    }
    const h = i >= 1 ? (history1?.tokens ?? null) : 0;
    const r = i >= 2 ? residueSum : 0;
    const parts = [
      fixedTokens,
      h,
      r,
      gRah,
      gNat,
      nat.firstInput,
      nat.input,
      rah.input,
      rah.firstInput,
    ];
    const inputDecomposition = parts.every(finite)
      ? {
          rah: rah.input,
          native: nat.input,
          budget:
            budgets.inputRatio * (nat.input + budgets.inputAllowanceTokens),
          delta: rah.input - nat.input,
          fixedOverhead: gRah * fixedTokens,
          round1History: gRah * h,
          residue: gRah * r,
          extraGenerations: (gRah - gNat) * nat.firstInput,
          intraRound:
            rah.input -
            gRah * rah.firstInput -
            (nat.input - gNat * nat.firstInput),
        }
      : null;
    rounds.push({ ...compareRounds(nat, rah), inputDecomposition });
  }
  const all = [...failures, ...rounds.flatMap((x) => x.failures)];
  return {
    status: statusOf(all),
    failures,
    finalInterrupt: summarizeFinalInterrupts(rahRounds.slice(0, n)),
    fixedOverhead,
    perRoundResidue,
    workPathVariance: { round1HistoryDelta: history1, rounds: workRounds },
    rounds,
  };
}
export function compareRounds(native, rah) {
  const failures = [];
  if (!finite(native.input) || !finite(rah.input))
    failures.push("inputMissing");
  else if (
    rah.input >
    budgets.inputRatio * (native.input + budgets.inputAllowanceTokens)
  )
    failures.push("input");
  // A follow-up's first request is reported (and decomposed by compareArm),
  // not budgeted; the decomposition still needs it on both sides.
  if (!finite(native.firstInput) || !finite(rah.firstInput))
    failures.push("firstInputMissing");
  const generations = {
    native: generationCounts(native),
    rah: generationCounts(rah),
  };
  const nativeTotal = generations.native.total;
  const extraProtocolGenerations =
    finite(nativeTotal) && finite(generations.rah.total)
      ? generations.rah.total - nativeTotal
      : null;
  const extraGenerationsBeforeReply =
    finite(nativeTotal) && finite(generations.rah.beforeReply)
      ? generations.rah.beforeReply - nativeTotal
      : null;
  if (extraProtocolGenerations === null) failures.push("generationsMissing");
  else if (extraProtocolGenerations > budgets.maxExtraGenerations)
    failures.push("generations");
  if (extraGenerationsBeforeReply === null)
    failures.push("generationsBeforeReplyMissing");
  else if (extraGenerationsBeforeReply > budgets.maxExtraGenerationsBeforeReply)
    failures.push("generationsBeforeReply");
  // Short tasks are judged in seconds, long tasks by percentage.
  if (!finite(native.replySeconds) || !finite(rah.replySeconds))
    failures.push("replySecondsMissing");
  else if (
    rah.replySeconds >
    native.replySeconds +
      Math.max(
        budgets.replyAllowanceSeconds,
        native.replySeconds * budgets.replyAllowanceRatio,
      )
  )
    failures.push("replySeconds");
  const evidence = usageEvidence(rah);
  if (evidence.completeness !== "complete")
    failures.push("usageEvidenceMissing");
  else if (evidence.mismatches.length) failures.push("usageEvidenceMismatch");
  return {
    status: statusOf(failures),
    failures,
    generations,
    extraProtocolGenerations,
    extraGenerationsBeforeReply,
    usageEvidence: evidence,
    finalInterrupt: finalInterruptOf(rah),
    inputRatio: rah.input / native.input,
    uncachedRatio: native.uncached ? rah.uncached / native.uncached : null,
    replyRatio: rah.replySeconds / native.replySeconds,
  };
}
// The shared workload explicitly requests this marker. Still needs human quality review.
export function isEffectiveAnswer(body) {
  return (
    typeof body === "string" &&
    /^审查结论[:：]/u.test(body.trim()) &&
    body.trim().length >= 80
  );
}
