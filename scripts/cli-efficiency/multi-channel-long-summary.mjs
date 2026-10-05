// Descriptive same-batch prefixes; never replaces per-participant contract gates.
const SPEAKERS = ["a", "b", "c"];
const FIELDS = ["input", "cached", "uncached", "output", "generations"];
const count = (n) => Number.isSafeInteger(n) && n >= 0;
function sumMetrics(metrics) {
  const knownTotals = Object.fromEntries(FIELDS.map((k) => [k, 0]));
  const missing = metrics.length ? [] : ["no-observations"];
  metrics.forEach((m, i) =>
    FIELDS.forEach((k) => {
      if (count(m?.[k])) knownTotals[k] += m[k];
      else missing.push(`${i}:${k}`);
    }),
  );
  return {
    totals: missing.length ? null : { ...knownTotals },
    knownTotals,
    missing,
  };
}
function prefix(arm, speaker, n, product, firstReadProof, replyProof) {
  const rounds = (arm?.rounds ?? [])
    .filter((r) => r.speaker === speaker)
    .slice(0, n);
  const sums = sumMetrics(rounds.map((r) => r.metrics));
  const issues = [...sums.missing];
  const sessionOwners = new Map();
  for (const r of arm?.rounds ?? []) {
    if (typeof r.sessionId !== "string" || !r.sessionId) continue;
    const owner = sessionOwners.get(r.sessionId);
    if (owner !== undefined && owner !== r.speaker)
      issues.push("cross-speaker-session-reuse");
    sessionOwners.set(r.sessionId, r.speaker);
  }
  if (rounds.length !== n) issues.push("prefix-not-reached");
  if (arm?.integrityError || arm?.identityError || arm?.evidenceError)
    issues.push("arm-identity-failed");
  rounds.forEach((r, i) => {
    if (r.round !== i * 3 + SPEAKERS.indexOf(speaker) + 1)
      issues.push("stage-order");
    if (!r.sessionId || r.sessionId !== rounds[0].sessionId)
      issues.push("session-identity");
    if (
      !r.longStageSucceeded ||
      !r.actualIdentityVerified ||
      !r.actualWorkspaceVerified ||
      !r.actualMemoryOff
    )
      issues.push("execution-identity-incomplete");
    if (
      r.validation?.answer !== "exact" ||
      r.validation?.readProof !==
        (i === 0 ? firstReadProof : "previous-turn-only") ||
      r.validationError
    )
      issues.push("validation-incomplete");
    if (replyProof && r.validation?.replyProof !== replyProof)
      issues.push("reply-proof-incomplete");
    const m = r.metrics;
    if (!m || m.input !== m.cached + m.uncached || !(m.generations > 0))
      issues.push("usage-inconsistent");
    if (product) {
      const u = m?.productUsage;
      if (
        u?.completeness !== "complete" ||
        !Array.isArray(u.gaps) ||
        u.gaps.length
      )
        issues.push("product-usage-incomplete");
      for (const [k, p] of Object.entries({
        input: "inputTokens",
        cached: "cachedInputTokens",
        output: "outputTokens",
        generations: "generations",
      }))
        if (m?.[k] === undefined || m[k] !== u?.totals?.[p])
          issues.push(`product-usage-mismatch:${k}`);
    }
  });
  return {
    status: issues.length ? "missing-evidence" : "complete",
    totals: issues.length ? null : sums.totals,
    knownTotals: sums.knownTotals,
    issues,
  };
}
function pair(native, product) {
  const complete =
    native.status === "complete" && product.status === "complete";
  return {
    status: complete ? "comparable" : "missing-evidence",
    native,
    product,
    ratios: complete
      ? Object.fromEntries(
          FIELDS.map((k) => [
            k,
            native.totals[k] > 0 ? product.totals[k] / native.totals[k] : null,
          ]),
        )
      : null,
  };
}
function combine(parts) {
  const sums = sumMetrics(parts.map((p) => p.knownTotals));
  const issues = parts.flatMap((p) => p.issues);
  return {
    status: issues.length ? "missing-evidence" : "complete",
    totals: issues.length ? null : sums.totals,
    knownTotals: sums.knownTotals,
    issues,
  };
}
export function summarizeLongChannel(
  arms,
  {
    readProofPolicy = "tool-result/v1",
    productArm = "final-output",
    mcpReplyProof = "single-mcp-final-reply",
  } = {},
) {
  if (
    !["single-mcp-final-reply", "observed-mcp-final-reply"].includes(
      mcpReplyProof,
    )
  )
    throw new Error("Unknown MCP reply proof");
  if (!["final-output", "worker-mcp"].includes(productArm))
    throw new Error("Unknown product arm");
  if (!["tool-result/v1", "inline-input/v1"].includes(readProofPolicy))
    throw new Error("Unknown read proof policy");
  const firstReadProof =
    readProofPolicy === "inline-input/v1"
      ? "complete-inline-input"
      : "complete-tool-result";
  const observedTotals = {};
  for (const [name, arm] of Object.entries(arms ?? {})) {
    const roundMetrics = sumMetrics((arm.rounds ?? []).map((r) => r.metrics));
    observedTotals[name] = { roundMetrics };
    // Separate overlapping representations, never add DB rows to round totals.
    // Raw DB rows retain unexpected/recovery Runs even when no stage accepted them.
    if (Array.isArray(arm.usageRows))
      observedTotals[name].durableUsage = sumMetrics(
        arm.usageRows.map((u) => ({
          input: u.input_tokens,
          cached: u.cached_input_tokens,
          uncached:
            count(u.input_tokens) &&
            count(u.cached_input_tokens) &&
            u.input_tokens >= u.cached_input_tokens
              ? u.input_tokens - u.cached_input_tokens
              : undefined,
          output: u.output_tokens,
          generations: 1,
        })),
      );
    if (observedTotals[name].durableUsage) {
      const durable = observedTotals[name].durableUsage;
      const reported = new Set(arm.usageRows.map((u) => u.run_attempt_id));
      for (const run of arm.runs ?? [])
        if (!reported.has(run.runAttemptId))
          durable.missing.push(`unreported-run:${run.runAttemptId}`);
      if (arm.usageGaps?.length) durable.missing.push("reported-usage-gaps");
      if (durable.missing.length) durable.totals = null;
    }
  }
  const checkpoints = [1, 4, 8, 12].map((n) => {
    const participants = Object.fromEntries(
      SPEAKERS.map((s) => [
        s,
        pair(
          prefix(arms?.native, s, n, false, firstReadProof),
          prefix(
            arms?.[productArm],
            s,
            n,
            true,
            firstReadProof,
            productArm === "worker-mcp" ? mcpReplyProof : undefined,
          ),
        ),
      ]),
    );
    return {
      roundsPerParticipant: n,
      participants,
      total: pair(
        combine(Object.values(participants).map((p) => p.native)),
        combine(Object.values(participants).map((p) => p.product)),
      ),
    };
  });
  return {
    status:
      arms?.native?.status === "complete" &&
      arms?.[productArm]?.status === "complete" &&
      checkpoints.at(-1).total.status === "comparable"
        ? "complete"
        : "incomplete",
    budgetVerdict: "not-assessed",
    interpretation:
      "Descriptive matched prefixes only; an earlier complete prefix never overturns whole-batch failure. Tokens are not prices. Missing values are not zero.",
    observedTotals,
    checkpoints,
  };
}
