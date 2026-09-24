import assert from "node:assert/strict";
// Owner-approved evo contract budgets (docs/evo/target-contract.zh-CN.md §6).
export const budgets = {
  inputRatio: 2,
  uncachedRatio: 2,
  maxGenerations: 2,
  firstInputOverheadTokens: 3000,
  replyAllowanceSeconds: 5,
  replyAllowanceRatio: 0.15,
};
export function summarizeUsage(events) {
  const rows = [
    ...new Map(
      events
        .filter((e) => e.type === "token_usage_record")
        .map((e) => [e.payload.response_id, e.payload.usage]),
    ).values(),
  ];
  assert.ok(rows.length, "Missing native per-response usage evidence");
  const out = {
    generations: rows.length,
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
export function compareRounds(native, rah) {
  const failures = [];
  if (rah.input > native.input * budgets.inputRatio) failures.push("input");
  if (rah.uncached > native.uncached * budgets.uncachedRatio)
    failures.push("uncached");
  // Short tasks are judged in seconds, long tasks by percentage.
  const replyAllowance = Math.max(
    budgets.replyAllowanceSeconds,
    native.replySeconds * budgets.replyAllowanceRatio,
  );
  if (rah.replySeconds > native.replySeconds + replyAllowance)
    failures.push("replySeconds");
  if (rah.generations > budgets.maxGenerations) failures.push("generations");
  if (
    Number.isFinite(native.firstInput) &&
    Number.isFinite(rah.firstInput) &&
    rah.firstInput > native.firstInput + budgets.firstInputOverheadTokens
  )
    failures.push("firstInput");
  return {
    status: failures.length ? "over-budget" : "within-budget",
    failures,
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
