// Descriptive experiment results only; never changes Kernel or contract state.
const ARMS = ["native", "worker-delivery"];
const SPEAKERS = ["a", "b", "c"];
const FIELDS = ["input", "cached", "uncached", "output", "generations"];
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const usageNames = {
  input: "inputTokens",
  cached: "cachedInputTokens",
  output: "outputTokens",
  generations: "generations",
};
function sum(metrics) {
  const knownTotals = Object.fromEntries(FIELDS.map((k) => [k, 0]));
  const issues = metrics.length ? [] : ["no-observations"];
  for (const [i, m] of metrics.entries()) {
    if (m?.usageRecoveryIncomplete)
      issues.push(`recovered-usage-incomplete:${i}`);
    if (m?.requestCoverage && m.requestCoverage.status !== "complete")
      issues.push(`request-coverage-incomplete:${i}`);
    for (const k of FIELDS) {
      if (count(m?.[k])) knownTotals[k] += m[k];
      else issues.push(`usage-missing:${i}:${k}`);
    }
    if (m?.input !== m?.cached + m?.uncached || !(m?.generations > 0))
      issues.push(`usage-inconsistent:${i}`);
  }
  return {
    knownTotals,
    totals: issues.length ? null : { ...knownTotals },
    issues,
  };
}
function productIssues(metrics) {
  const issues = [];
  for (const m of metrics) {
    const u = m?.productUsage;
    if (
      u?.completeness !== "complete" ||
      !Array.isArray(u.gaps) ||
      u.gaps.length ||
      u.truncated
    )
      issues.push("product-usage-incomplete");
    for (const [k, v] of Object.entries(usageNames))
      if (m?.[k] === undefined || m[k] !== u?.totals?.[v])
        issues.push(`product-usage-mismatch:${k}`);
  }
  return issues;
}
function observed(arm, product) {
  const roundMetrics = sum((arm?.rounds ?? []).map((r) => r.metrics));
  const issues = [
    ...roundMetrics.issues,
    ...(product
      ? productIssues((arm?.rounds ?? []).map((r) => r.metrics))
      : []),
  ];
  let durableUsage;
  if (product && Array.isArray(arm?.usageRows)) {
    durableUsage = sum(
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
    const reported = new Set(arm.usageRows.map((u) => u.run_attempt_id));
    for (const r of arm.runs ?? [])
      if (!reported.has(r.runAttemptId))
        durableUsage.issues.push("unreported-run");
    if (arm.usageGaps?.length) durableUsage.issues.push("durable-usage-gap");
    for (const k of FIELDS)
      if (durableUsage.knownTotals[k] !== roundMetrics.knownTotals[k])
        durableUsage.issues.push(`durable-round-mismatch:${k}`);
    if (durableUsage.issues.length) durableUsage.totals = null;
    issues.push(...durableUsage.issues);
  } else if (product && arm?.usageGaps?.length)
    issues.push("durable-usage-gap");
  return {
    status: issues.length ? "unknown" : "complete",
    roundMetrics,
    ...(durableUsage ? { durableUsage } : {}),
    issues,
    accounting:
      "Round metrics and durable usage overlap; never add them together. Known totals retain observed failures; missing values remain unknown.",
  };
}
function prefix(arm, speaker, n, product, globalIssues, durableIssues) {
  const rounds = (arm?.rounds ?? [])
    .filter((r) => r.speaker === speaker)
    .slice(0, n);
  const sums = sum(rounds.map((r) => r.metrics));
  const issues = [...sums.issues, ...globalIssues, ...durableIssues];
  if (rounds.length !== n) issues.push("prefix-not-reached");
  if (arm?.integrityError || arm?.identityError || arm?.evidenceError)
    issues.push("arm-evidence-failed");
  rounds.forEach((r, i) => {
    if (r.round !== i * 3 + SPEAKERS.indexOf(speaker) + 1)
      issues.push("stage-order");
    if (!r.sessionId || r.sessionId !== rounds[0].sessionId)
      issues.push("session-changed");
    if (
      !r.longStageSucceeded ||
      !r.actualIdentityVerified ||
      !r.actualWorkspaceVerified ||
      !r.actualMemoryOff ||
      r.validation?.executionIntegrity !== "verified"
    )
      issues.push("execution-unverified");
    if (
      r.validation?.readProof !==
      (i === 0 ? "complete-inline-input" : "previous-turn-only")
    )
      issues.push("input-proof-missing");
    if (!["delivered", "not-delivered"].includes(r.validation?.deliveryVerdict))
      issues.push("delivery-verdict-missing");
    if (
      !["correct", "incorrect", "unscorable"].includes(
        r.validation?.qualityVerdict,
      )
    )
      issues.push("quality-verdict-missing");
  });
  if (product) issues.push(...productIssues(rounds.map((r) => r.metrics)));
  return {
    status: issues.length ? "unknown" : "complete",
    totals: issues.length ? null : sums.totals,
    knownTotals: sums.knownTotals,
    issues,
  };
}
function combine(parts) {
  const knownTotals = Object.fromEntries(
    FIELDS.map((k) => [k, parts.reduce((s, p) => s + p.knownTotals[k], 0)]),
  );
  const issues = parts.flatMap((p) => p.issues);
  return {
    status: issues.length ? "unknown" : "complete",
    totals: issues.length ? null : knownTotals,
    knownTotals,
    issues,
  };
}
function pair(native, product) {
  const complete =
    native.status === "complete" && product.status === "complete";
  return {
    status: complete ? "comparable" : "unknown",
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
function quality(arm, expected) {
  const result = {
    correct: 0,
    incorrect: 0,
    unscorable: 0,
    unknown: 0,
    delivered: 0,
    notDelivered: 0,
    deliveryUnknown: 0,
    notRun: 0,
  };
  const stages = new Set();
  for (const r of arm?.rounds ?? []) {
    if (count(r.round) && r.round > 0 && r.round <= expected)
      stages.add(r.round);
    const q = r.validation?.qualityVerdict;
    result[
      ["correct", "incorrect", "unscorable"].includes(q) ? q : "unknown"
    ]++;
    const d = r.validation?.deliveryVerdict;
    result[
      d === "delivered"
        ? "delivered"
        : d === "not-delivered"
          ? "notDelivered"
          : "deliveryUnknown"
    ]++;
  }
  result.notRun = expected - stages.size;
  return result;
}
function reliability(arm) {
  const fields = ["attemptedCalls", "rejectedCalls", "deduplicatedCalls"];
  const result = Object.fromEntries(fields.map((k) => [k, 0]));
  const missing = new Set();
  if (!arm?.rounds?.length) fields.forEach((k) => missing.add(k));
  for (const r of arm?.rounds ?? [])
    for (const k of fields) {
      const v = r.validation?.reliability?.[k];
      if (count(v)) result[k] += v;
      else missing.add(k);
    }
  return {
    ...Object.fromEntries(
      fields.map((k) => [k, missing.has(k) ? null : result[k]]),
    ),
    knownTotals: result,
    status: missing.size ? "unknown" : "complete",
  };
}
export function summarizeBusinessObservation(
  arms,
  { roundsPerParticipant = 12 } = {},
) {
  if (![2, 12].includes(roundsPerParticipant))
    throw new Error("Unregistered observation scope");
  const globalIssues = [],
    owners = new Map();
  for (const kind of ARMS)
    for (const r of arms?.[kind]?.rounds ?? []) {
      if (!SPEAKERS.includes(r.speaker)) globalIssues.push("unknown-speaker");
      if (!r.sessionId) continue;
      const owner = `${kind}/${r.speaker}`;
      if (owners.has(r.sessionId) && owners.get(r.sessionId) !== owner)
        globalIssues.push("shared-session");
      owners.set(r.sessionId, owner);
    }
  const observedCosts = Object.fromEntries(
    ARMS.map((k) => [k, observed(arms?.[k], k !== "native")]),
  );
  const checkpoints = (roundsPerParticipant === 2 ? [1, 2] : [1, 4, 8, 12]).map(
    (n) => {
      const participants = Object.fromEntries(
        SPEAKERS.map((s) => [
          s,
          pair(
            ...ARMS.map((k) =>
              prefix(
                arms?.[k],
                s,
                n,
                k !== "native",
                globalIssues,
                observedCosts[k].durableUsage?.issues ?? [],
              ),
            ),
          ),
        ]),
      );
      return {
        roundsPerParticipant: n,
        comparisonBasis: "diagnostic-cost-only",
        participants,
        total: pair(
          combine(Object.values(participants).map((p) => p.native)),
          combine(Object.values(participants).map((p) => p.product)),
        ),
      };
    },
  );
  const expected = roundsPerParticipant * 3;
  const counts = Object.fromEntries(
    ARMS.map((k) => [k, quality(arms?.[k], expected)]),
  );
  const eligible =
    checkpoints.at(-1).total.status === "comparable" &&
    ARMS.every(
      (k) =>
        arms?.[k]?.status === "complete" &&
        arms[k].rounds.length === expected &&
        counts[k].correct === expected &&
        counts[k].delivered === expected &&
        observedCosts[k].status === "complete",
    );
  return {
    roundsPerParticipant,
    observedCosts,
    quality: counts,
    reliability: Object.fromEntries(
      ARMS.map((k) => [k, reliability(arms?.[k])]),
    ),
    checkpoints,
    sameQuality: {
      eligible,
      basis: eligible
        ? "both-complete-correct-and-delivered"
        : "not-established",
      ratios: eligible ? checkpoints.at(-1).total.ratios : null,
    },
    contractVerdict: "not-assessed",
    stability: "not-established",
    interpretation:
      "All observed costs remain visible. Prefix ratios are descriptive only; quality failure is not cured by later success. Token vectors are not bills.",
  };
}
