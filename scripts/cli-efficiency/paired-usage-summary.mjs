import assert from "node:assert/strict";

// Descriptive arithmetic over already reconciled per-round evidence. This does
// not establish capture completeness, billing, task quality or comparability.
const FIELDS = ["input", "output", "cachedInput", "reasoningOutput"];
const count = (n) => Number.isSafeInteger(n) && n >= 0;

export function summarizePairedUsage({
  plannedRounds,
  lateRounds,
  native,
  loom,
  comparisonIssues,
}) {
  assert.ok(Number.isSafeInteger(plannedRounds) && plannedRounds > 0);
  assert.ok(Array.isArray(comparisonIssues));
  assert.ok(comparisonIssues.every((s) => typeof s === "string" && s));
  const validRound = (r) =>
    Number.isSafeInteger(r) && r >= 1 && r <= plannedRounds;
  assert.ok(Array.isArray(lateRounds) && lateRounds.length > 0);
  assert.ok(lateRounds.every(validRound));
  assert.equal(new Set(lateRounds).size, lateRounds.length);
  const arms = { native, loom };
  for (const rows of Object.values(arms)) {
    assert.ok(Array.isArray(rows));
    assert.equal(new Set(rows.map((r) => r.round)).size, rows.length);
    for (const row of rows) {
      assert.ok(validRound(row.round));
      assert.equal(typeof row.finished, "boolean");
      assert.equal(typeof row.requestCoverageComplete, "boolean");
      for (const field of FIELDS) {
        const u = row.usage?.[field];
        if (u === undefined) continue;
        assert.ok(count(u.known));
        assert.equal(typeof u.complete, "boolean");
      }
    }
  }
  function sum(rows, expected) {
    return Object.fromEntries(
      FIELDS.map((field) => {
        const known = rows.reduce(
          (n, r) => n + (r.usage?.[field]?.known ?? 0),
          0,
        );
        assert.ok(count(known), "Usage sum exceeds safe integer range");
        const complete =
          rows.length > 0 &&
          rows.length === expected &&
          rows.every(
            (r) => r.requestCoverageComplete && r.usage?.[field]?.complete,
          );
        return [field, { known, complete, total: complete ? known : null }];
      }),
    );
  }
  function window(rounds) {
    const result = { rounds };
    let finished = rounds.length > 0;
    for (const [arm, rows] of Object.entries(arms)) {
      const selected = rows.filter((r) => rounds.includes(r.round));
      result[arm] = sum(selected, rounds.length);
      finished &&=
        selected.length === rounds.length && selected.every((r) => r.finished);
    }
    result.finished = finished;
    result.ratios = Object.fromEntries(
      FIELDS.map((field) => {
        const n = result.native[field];
        const l = result.loom[field];
        return [
          field,
          finished && n.complete && l.complete && n.total > 0
            ? l.total / n.total
            : null,
        ];
      }),
    );
    return result;
  }
  const all = Array.from({ length: plannedRounds }, (_, i) => i + 1);
  const prefix = [];
  for (const round of all) {
    if (
      !Object.values(arms).every((rows) =>
        rows.some((r) => r.round === round && r.finished),
      )
    )
      break;
    prefix.push(round);
  }
  return {
    comparable: comparisonIssues.length === 0,
    comparisonIssues: [...comparisonIssues],
    full: window(all),
    late: window(lateRounds),
    prefix: window(prefix),
    observed: Object.fromEntries(
      Object.entries(arms).map(([arm, rows]) => [arm, sum(rows, rows.length)]),
    ),
    quality: Object.fromEntries(
      Object.entries(arms).map(([arm, rows]) => [
        arm,
        {
          allPassed:
            rows.length === plannedRounds &&
            rows.every((r) => r.finished && r.qualityPassed === true),
          failedRounds: rows
            .filter((r) => r.qualityPassed === false)
            .map((r) => r.round),
        },
      ]),
    ),
    interpretation:
      "Ratios are observed arithmetic for the labeled window, not an efficiency verdict. Comparability and quality are independent. Prefixes do not replace the planned full task. Observed known expense includes unfinished work; unknown is never zero. Tokens are not invoices.",
  };
}
