import assert from "node:assert/strict";
// Budgets of docs/evo/target-contract.zh-CN.md §6 as revised by the owner on
// 2026-09-24 (the earlier "≤2 before reply, total input ≤2×" was unreachable).
// Generation limits are relative to the native arm's whole-turn count, so
// native tool rounds are business work, not protocol overhead. The uncached
// ratio is reported only; §6 signs no budget for it.
export const budgets = {
  maxExtraGenerations: 1, // rah total − native total
  maxExtraGenerationsBeforeReply: 0, // rah before-reply − native total
  firstInputOverheadTokens: 3000, // rah first ≤ native first + 3k
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
export function compareRounds(native, rah) {
  const failures = [];
  if (!finite(native.input) || !finite(rah.input))
    failures.push("inputMissing");
  else if (
    rah.input >
    budgets.inputRatio * (native.input + budgets.inputAllowanceTokens)
  )
    failures.push("input");
  if (!finite(native.firstInput) || !finite(rah.firstInput))
    failures.push("firstInputMissing");
  else if (
    rah.firstInput >
    native.firstInput + budgets.firstInputOverheadTokens
  )
    failures.push("firstInput");
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
  const evidenceOnly = failures.length && failures.every(isEvidenceFailure);
  return {
    status: evidenceOnly
      ? "missing-evidence"
      : failures.length
        ? "over-budget"
        : "within-budget",
    failures,
    generations,
    extraProtocolGenerations,
    extraGenerationsBeforeReply,
    usageEvidence: evidence,
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
