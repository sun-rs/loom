import assert from "node:assert/strict";
// Owner-approved evo contract budgets (docs/evo/target-contract.zh-CN.md §6).
// Budgets are data: a null generation limit is reported but not enforced.
// The uncached ratio is a diagnostic only; §6 does not sign it as a budget.
export const budgets = {
  inputRatio: 2,
  maxGenerations: { total: 2, beforeReply: null, afterReply: null },
  firstInputOverheadTokens: 3000,
  replyAllowanceSeconds: 5,
  replyAllowanceRatio: 0.15,
};
const generationFailure = {
  total: "generations",
  beforeReply: "generationsBeforeReply",
  afterReply: "generationsAfterReply",
};
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
export function compareRounds(native, rah) {
  const failures = [];
  if (rah.input > native.input * budgets.inputRatio) failures.push("input");
  // Short tasks are judged in seconds, long tasks by percentage.
  const replyAllowance = Math.max(
    budgets.replyAllowanceSeconds,
    native.replySeconds * budgets.replyAllowanceRatio,
  );
  if (rah.replySeconds > native.replySeconds + replyAllowance)
    failures.push("replySeconds");
  const generations = {
    native: generationCounts(native),
    rah: generationCounts(rah),
  };
  for (const [key, limit] of Object.entries(budgets.maxGenerations)) {
    if (limit === null) continue;
    const count = generations.rah[key];
    // An enforced limit without evidence fails closed.
    if (!Number.isFinite(count))
      failures.push(generationFailure[key] + "Missing");
    else if (count > limit) failures.push(generationFailure[key]);
  }
  if (!Number.isFinite(native.firstInput) || !Number.isFinite(rah.firstInput))
    failures.push("firstInputMissing");
  else if (
    rah.firstInput >
    native.firstInput + budgets.firstInputOverheadTokens
  )
    failures.push("firstInput");
  const evidenceOnly =
    failures.length && failures.every((f) => f.endsWith("Missing"));
  return {
    status: evidenceOnly
      ? "missing-evidence"
      : failures.length
        ? "over-budget"
        : "within-budget",
    failures,
    generations,
    extraProtocolGenerations: generations.rah.total - generations.native.total,
    inputRatio: rah.input / native.input,
    uncachedRatio: native.uncached ? rah.uncached / native.uncached : null,
    replyRatio: rah.replySeconds / native.replySeconds,
    extraGenerations: rah.generations - native.generations,
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
