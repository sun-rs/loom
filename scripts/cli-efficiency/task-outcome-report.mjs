#!/usr/bin/env node
// Offline projections of explicit historical evidence formats. No provider,
// database, network, task mutation or release decision is owned by this module.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { summarizePairedUsage } from "./paired-usage-summary.mjs";

const metric = (known, complete) => {
  assert.ok(Number.isSafeInteger(known) && known >= 0, "Invalid usage count");
  assert.equal(typeof complete, "boolean");
  return { known, complete, total: complete ? known : null };
};
function sumMetric(rows, field) {
  return metric(
    rows.reduce((n, r) => n + (r.usage[field]?.known ?? 0), 0),
    rows.length > 0 && rows.every((r) => r.usage[field]?.complete === true),
  );
}
const missingUsage = () => ({
  input: metric(0, false),
  output: metric(0, false),
  cachedInput: metric(0, false),
  requests: metric(0, false),
});
const boolean = (value) => assert.equal(typeof value, "boolean");
const nonempty = (value) =>
  assert.ok(typeof value === "string" && value.length > 0);
const unique = (values) =>
  assert.equal(
    new Set(values).size,
    values.length,
    "Duplicate evidence identity",
  );

function teamReport(source) {
  assert.ok(Array.isArray(source.order) && source.order.length > 0);
  unique(source.order);
  unique(source.samples.map((s) => s.sampleId));
  const plan = source.order.map((id) => {
    const match = /^pair([1-9]\d*)-(loom|native)$/.exec(id);
    assert.ok(match, "Unsupported planned sample ID");
    return { id, round: Number(match[1]), arm: match[2] };
  });
  const plannedRounds = plan.length / 2;
  assert.ok(Number.isSafeInteger(plannedRounds));
  for (let round = 1; round <= plannedRounds; round++) {
    for (const arm of ["native", "loom"])
      assert.ok(
        plan.some((p) => p.round === round && p.arm === arm),
        "Missing planned pair arm",
      );
  }
  for (const sample of source.samples) {
    const entry = plan.find((p) => p.id === sample.sampleId);
    assert.ok(
      entry && entry.arm === sample.arm,
      "Unplanned sample or arm mismatch",
    );
    for (const key of [
      "complete",
      "usageComplete",
      "instrumentInterrupted",
      "qualityPassed",
      "functionalPassed",
    ])
      boolean(sample[key]);
  }
  const cases = plan.map((p) => {
    const s = source.samples.find((s) => s.sampleId === p.id);
    const base = {
      ...p,
      sourceRevision: source.sourceRevision,
      bindings: source.bindings,
      versions: source.versions,
      evidencePointer: s ? `/samples/${source.samples.indexOf(s)}` : "/order",
      humanIntervention: "unknown",
      humanDeclaration: source.authorization,
      descendantCoverage: "unknown",
      wallMs: null,
      runIds: null,
      billing: null,
      automaticMemoryDisabled:
        source.accounting?.automaticMemoryDisabled ?? null,
    };
    if (!s)
      return {
        ...base,
        executionFinished: false,
        outcome: "unknown",
        usage: missingUsage(),
        handoff: { proof: "unknown" },
        limitations: [
          "Planned attempt has no sample record; not a free or successful attempt.",
        ],
      };
    const complete = s.usageComplete === true;
    return {
      ...base,
      executionFinished: s.complete,
      outcome:
        !s.complete || s.instrumentInterrupted
          ? "unknown"
          : s.qualityPassed && s.functionalPassed
            ? "passed"
            : "failed",
      usage: {
        input: metric(s.input, complete),
        output: metric(s.output, complete),
        requests: metric(s.requests, complete),
        cachedInput: metric(0, false),
      },
      artifactEvidence: {
        resultSha256: s.resultSha256 ?? null,
        auditSha256: s.auditSha256 ?? null,
      },
      handoff: {
        proof: "aggregate-only",
        publicActivations: s.publicActivations,
        automaticReturns: s.replyReturns,
        limitation:
          "Counts cannot prove ordered delivery, Inbox consumption or A→B→A causality.",
      },
      limitations: [...(s.reviewLimitations ?? [])],
    };
  });
  const arms = Object.fromEntries(
    ["native", "loom"].map((arm) => {
      const rows = cases.filter((c) => c.arm === arm);
      const failed = rows.filter((c) => c.outcome === "failed");
      return [
        arm,
        {
          planned: rows.length,
          passed: rows.filter((c) => c.outcome === "passed").length,
          failed: failed.length,
          unknown: rows.filter((c) => c.outcome === "unknown").length,
          input: sumMetric(rows, "input"),
          output: sumMetric(rows, "output"),
          // Empty failed subset means no recorded failures, not all unknown work cost zero.
          failedInput: failed.length
            ? sumMetric(failed, "input")
            : metric(0, true),
          unknownOutcomeInput: sumMetric(
            rows.filter((c) => c.outcome === "unknown"),
            "input",
          ),
        },
      ];
    }),
  );
  const comparisonIssues = [];
  if (cases.some((c) => c.outcome !== "passed"))
    comparisonIssues.push("not-all-planned-tasks-passed");
  if (source.accounting?.automaticMemoryDisabled !== true)
    comparisonIssues.push("automatic-memory-disablement-unverified");
  // This source does not carry a reconciled descendants policy/coverage ledger.
  comparisonIssues.push(
    "descendant-coverage-and-policy-not-established-by-this-source",
  );
  const toRows = (arm) =>
    cases
      .filter((c) => c.arm === arm)
      .map((c) => ({
        round: c.round,
        finished: c.executionFinished,
        qualityPassed: c.outcome === "passed",
        requestCoverageComplete: c.usage.requests.complete,
        usage: c.usage,
      }));
  const arithmetic = summarizePairedUsage({
    plannedRounds,
    lateRounds: [plannedRounds],
    comparisonIssues,
    native: toRows("native"),
    loom: toRows("loom"),
  });
  return {
    kind: "loom-task-outcome-report/v1",
    sourceKind: source.kind,
    cases,
    arms,
    comparison: {
      arithmetic,
      equalQualityRatio: { input: null, output: null },
      limitation:
        "Arithmetic retains all attempts; it is not a same-quality efficiency verdict or billing ratio.",
    },
    sourceLimitations: source.qualityLimits ?? [],
    sourceFailure: source.failure ?? null,
  };
}

function agyReport(source) {
  const v = source.verified;
  const runs = source.runs ?? [];
  const boundRuns = source.result?.runs ?? [];
  const activations = source.activations ?? [];
  unique(runs.map((r) => r.run_attempt_id));
  unique(boundRuns.map((r) => r.run_attempt_id));
  unique(activations.map((a) => a.activation_id));
  const requester = v?.replyReturn?.participantId;
  const review = activations.find(
    (a) => a.to_seq === v?.requestSeq && a.participant_id !== requester,
  );
  const returned = activations.find(
    (a) => a.to_seq === v?.replySeq && a.participant_id === requester,
  );
  function runFor(activation) {
    if (!activation || activation.state !== "completed") return null;
    const bound = boundRuns.find(
      (r) =>
        r.activation_id === activation.activation_id &&
        r.participant_id === activation.participant_id,
    );
    return (
      runs.find(
        (r) =>
          r.run_attempt_id === bound?.run_attempt_id &&
          r.participant_id === activation.participant_id &&
          r.state === "exited" &&
          r.finished_at,
      ) ?? null
    );
  }
  const reviewRun = runFor(review);
  const returnRun = runFor(returned);
  const presented = (source.presentedWindows ?? []).some((w) => {
    if (
      !reviewRun ||
      w.activation_id !== review?.activation_id ||
      w.run_attempt_id !== reviewRun.run_attempt_id
    )
      return false;
    const seqs = JSON.parse(w.presented_seqs_json);
    return Array.isArray(seqs) && seqs.includes(v.requestSeq);
  });
  const events = [v?.requestEvent, v?.replyEvent, v?.finalEvent];
  const seqs = [v?.requestSeq, v?.replySeq, v?.finalSeq];
  const linked =
    events.every((e) => typeof e === "string" && e.length > 0) &&
    new Set(events).size === 3 &&
    seqs.every((n) => Number.isSafeInteger(n) && n > 0) &&
    seqs[0] < seqs[1] &&
    seqs[1] < seqs[2] &&
    v.replyReturn?.sourceEventId === v.requestEvent &&
    reviewRun !== null &&
    returnRun !== null &&
    presented &&
    v.reviewActuallyRanTests === true;
  const stages = source.usageByStage ?? {};
  const usage = { requests: metric(0, false) };
  for (const [field, key] of Object.entries({
    input: "input",
    output: "output",
    cachedInput: "cached",
    generations: "generations",
  })) {
    let known = 0;
    for (const stage of Object.values(stages)) {
      if (stage[key] !== undefined) known += metric(stage[key], false).known;
    }
    // Stage aggregates are observed lower bounds, not provider/native reconciliation.
    usage[field] = metric(known, false);
  }
  const dates = runs.flatMap((r) => [
    Date.parse(r.started_at),
    Date.parse(r.finished_at),
  ]);
  const wallMs =
    dates.length && dates.every(Number.isFinite)
      ? Math.max(...dates) - Math.min(...dates)
      : null;
  return {
    kind: "loom-task-outcome-report/v1",
    sourceKind: "agy-bounded-review-closeout",
    cases: [
      {
        id: "agy-review-resumed",
        sourceRevision: source.codeBase,
        bindings: source.placements,
        sourceScope: source.scope,
        executionFinished:
          runs.length > 0 &&
          runs.every((r) => r.state === "exited" && r.finished_at),
        outcome: "unknown",
        boundedReview: linked ? "passed" : "unknown",
        humanIntervention: /Human resumed/.test(source.scope ?? "")
          ? "recorded"
          : "unknown",
        humanDeclaration: source.scope,
        descendantCoverage: "unknown",
        billing: null,
        automaticMemoryDisabled: null,
        wallMs,
        wallScope:
          "Earliest observed Run start to latest finish; excludes prior stopped attempts and Human waiting.",
        runIds: runs.map((r) => r.run_attempt_id),
        usage,
        usageByStage: stages,
        handoff: {
          proof: linked ? "linked-summary-without-inbox" : "unknown",
          sourceEventId: v?.requestEvent ?? null,
          replyEventId: v?.replyEvent ?? null,
          finalEventId: v?.finalEvent ?? null,
          reviewRunId: reviewRun?.run_attempt_id ?? null,
          returnRunId: returnRun?.run_attempt_id ?? null,
          limitation:
            "Cross-checks archived summary links and presentation only; raw Room events/Inbox and consumed-delivery receipts are not included. Not a fresh ledger audit.",
        },
        limitations: [
          ...source.limits,
          "Whole implementation task remains unassessed here; bounded resumed review is not uninterrupted completion.",
          "Earlier failed attempts are outside this source and remain in their original evidence; this is not cumulative project expense.",
        ],
      },
    ],
    comparison: null,
  };
}

export function buildTaskOutcomeReport(source) {
  if (source.kind === "bounded-team-cohort-closeout/v8")
    return teamReport(source);
  if (
    source.verdict === "bounded_review_and_automatic_return_pass" &&
    source.codeBase &&
    source.verified
  )
    return agyReport(source);
  throw new Error(
    "Unsupported evidence format; add an explicit audited adapter, do not infer success from prose or exit codes.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    assert.equal(
      process.argv.length,
      3,
      "Usage: node scripts/cli-efficiency/task-outcome-report.mjs <evidence.json>",
    );
    nonempty(process.argv[2]);
    const bytes = readFileSync(process.argv[2]);
    const report = buildTaskOutcomeReport(JSON.parse(bytes));
    console.log(
      JSON.stringify(
        {
          ...report,
          source: {
            path: process.argv[2],
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
