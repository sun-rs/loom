// Observational long-session accounting. No prices, business-work deductions,
// quality inference or replacement of the existing per-turn contract budgets.
const FIELDS = ["input", "cached", "uncached", "output", "generations"];
const TOTAL_FIELDS = [...FIELDS, "durationSeconds"];
const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
const validDuration = (value) => Number.isFinite(value) && value >= 0;

function summarizeRange(stages, fromStage, toStage) {
  const issues = [];
  const selected = stages.filter(
    (s) =>
      Number.isInteger(s.stage) && s.stage >= fromStage && s.stage <= toStage,
  );
  // Identity/order are prefix properties, including windows after startup.
  const prefix = stages.filter(
    (s) => !Number.isInteger(s.stage) || s.stage <= toStage,
  );
  let session;
  for (let i = 0; i < prefix.length; i++) {
    const s = prefix[i];
    if (s.stage !== i + 1) issues.push(`stage-order:${i + 1}`);
    if (typeof s.sessionId !== "string" || !s.sessionId.trim())
      issues.push(`session-missing:${s.stage}`);
    else if (session === undefined) session = s.sessionId;
    else if (session !== s.sessionId) issues.push(`session-changed:${s.stage}`);
  }
  if (prefix.length !== toStage) issues.push("prefix-incomplete");
  const knownObservedTotals = Object.fromEntries(
    TOTAL_FIELDS.map((f) => [f, 0]),
  );
  for (let n = fromStage; n <= toStage; n++) {
    if (selected.filter((s) => s.stage === n).length !== 1)
      issues.push(`stage-missing-or-duplicate:${n}`);
  }
  for (const s of selected) {
    if (s.completed !== true) issues.push(`not-completed:${s.stage}`);
    if (s.memoryOff !== true) issues.push(`memory-evidence:${s.stage}`);
    const u = s.usage ?? {};
    if (
      u.completeness !== "complete" ||
      !Array.isArray(u.gaps) ||
      u.gaps.length
    )
      issues.push(`usage-evidence:${s.stage}`);
    for (const field of FIELDS) {
      if (!validCount(u[field])) issues.push(`invalid-${field}:${s.stage}`);
      else knownObservedTotals[field] += u[field];
    }
    if (!validCount(u.generations) || u.generations === 0)
      issues.push(`no-generations:${s.stage}`);
    if (
      validCount(u.input) &&
      validCount(u.cached) &&
      validCount(u.uncached) &&
      u.input !== u.cached + u.uncached
    )
      issues.push(`usage-sum-mismatch:${s.stage}`);
    if (!validDuration(s.durationSeconds))
      issues.push(`duration-missing:${s.stage}`);
    else knownObservedTotals.durationSeconds += s.durationSeconds;
  }
  for (const field of FIELDS)
    if (!Number.isSafeInteger(knownObservedTotals[field]))
      issues.push(`sum-overflow:${field}`);
  if (!validDuration(knownObservedTotals.durationSeconds))
    issues.push("duration-overflow");
  return {
    fromStage,
    toStage,
    status: issues.length ? "incomplete" : "complete",
    knownObservedTotals,
    totals: issues.length ? null : { ...knownObservedTotals },
    issues: [...new Set(issues)],
  };
}

function compare(native, product) {
  const comparable = native.totals !== null && product.totals !== null;
  return {
    fromStage: product.fromStage,
    toStage: product.toStage,
    status: comparable ? "comparable" : "missing-evidence",
    ratios: comparable
      ? Object.fromEntries(
          TOTAL_FIELDS.map((field) => [
            field,
            native.totals[field] > 0
              ? product.totals[field] / native.totals[field]
              : null,
          ]),
        )
      : null,
    deltas: comparable
      ? Object.fromEntries(
          TOTAL_FIELDS.map((field) => [
            field,
            product.totals[field] - native.totals[field],
          ]),
        )
      : null,
  };
}

/**
 * Caller normalizes raw observations WITHOUT discarding failed/recovery cost.
 * stages: {stage, sessionId, completed, memoryOff, durationSeconds,
 * usage:{input,cached,uncached,output,generations,completeness,gaps}}[].
 * completed means delivery/execution succeeded, never semantic quality.
 */
export function summarizeLongSession({
  arms,
  checkpoints = [1, 3, 6, 9, 12],
  expectedStages = 12,
}) {
  if (
    !arms?.native ||
    !Number.isSafeInteger(expectedStages) ||
    expectedStages < 1
  )
    throw new Error("A native arm and positive expectedStages are required");
  if (
    !Array.isArray(checkpoints) ||
    checkpoints.some(
      (n, i) =>
        !Number.isInteger(n) ||
        n < 1 ||
        n > expectedStages ||
        (i > 0 && n <= checkpoints[i - 1]),
    )
  )
    throw new Error("Checkpoints must be increasing task stages");
  const windows = [
    [1, 1],
    [2, 6],
    [7, 12],
  ]
    .filter(([from]) => from <= expectedStages)
    .map(([from, to]) => [from, Math.min(to, expectedStages)]);
  const summaries = {};
  for (const [name, arm] of Object.entries(arms)) {
    if (!Array.isArray(arm.stages))
      throw new Error(`Missing stages for ${name}`);
    const total = summarizeRange(arm.stages, 1, expectedStages);
    if (
      arm.stages.some(
        (s) =>
          !Number.isInteger(s.stage) || s.stage > expectedStages || s.stage < 1,
      )
    ) {
      total.issues.push("unexpected-stage");
      total.status = "incomplete";
      total.totals = null;
      // Keep every observed charge, including stages the plan did not allow.
      for (const s of arm.stages.filter(
        (s) =>
          !Number.isInteger(s.stage) || s.stage > expectedStages || s.stage < 1,
      )) {
        for (const field of FIELDS)
          if (validCount(s.usage?.[field]))
            total.knownObservedTotals[field] += s.usage[field];
        if (validDuration(s.durationSeconds))
          total.knownObservedTotals.durationSeconds += s.durationSeconds;
      }
    }
    summaries[name] = {
      total,
      checkpoints: checkpoints.map((n) => summarizeRange(arm.stages, 1, n)),
      windows: windows.map(([from, to]) =>
        summarizeRange(arm.stages, from, to),
      ),
    };
  }
  const comparisons = {};
  for (const [name, arm] of Object.entries(summaries)) {
    if (name === "native") continue;
    comparisons[name] = {
      total: compare(summaries.native.total, arm.total),
      checkpoints: arm.checkpoints.map((r, i) =>
        compare(summaries.native.checkpoints[i], r),
      ),
      windows: arm.windows.map((r, i) =>
        compare(summaries.native.windows[i], r),
      ),
    };
  }
  return {
    status: Object.values(summaries).every((a) => a.total.status === "complete")
      ? "complete"
      : "incomplete",
    quality: "not-assessed",
    budgetVerdict: "not-assessed",
    arms: summaries,
    comparisons,
  };
}
