import assert from "node:assert/strict";
import test from "node:test";
import { summarizeBusinessObservation } from "./business-observation-summary.mjs";

function arms(n = 12) {
  return Object.fromEntries(
    ["native", "worker-delivery"].map((kind) => [
      kind,
      {
        kind,
        status: "complete",
        rounds: Array.from({ length: n }, (_, i) =>
          ["a", "b", "c"].map((speaker, j) => {
            const input = kind === "native" ? 10 : 20;
            const metrics = {
              input,
              cached: 2,
              uncached: input - 2,
              output: 3,
              generations: i === 0 ? 2 : 1,
            };
            if (kind !== "native")
              metrics.productUsage = {
                completeness: "complete",
                gaps: [],
                totals: {
                  inputTokens: input,
                  cachedInputTokens: 2,
                  outputTokens: 3,
                  generations: metrics.generations,
                },
              };
            return {
              round: i * 3 + j + 1,
              speaker,
              sessionId: `${kind}-${speaker}`,
              longStageSucceeded: true,
              actualIdentityVerified: true,
              actualWorkspaceVerified: true,
              actualMemoryOff: true,
              metrics,
              validation: {
                deliveryVerdict: "delivered",
                qualityVerdict: "correct",
                readProof:
                  i === 0 ? "complete-inline-input" : "previous-turn-only",
                executionIntegrity: "verified",
                transportDiagnostics: [],
                reliability: {
                  attemptedCalls: 1,
                  rejectedCalls: 0,
                  deduplicatedCalls: 0,
                },
              },
            };
          }),
        ).flat(),
      },
    ]),
  );
}

test("all stages correct enables same-quality cost observation, never contract or stability claims", () => {
  const s = summarizeBusinessObservation(arms());
  assert.equal(s.sameQuality.eligible, true);
  assert.equal(s.contractVerdict, "not-assessed");
  assert.equal(s.stability, "not-established");
  assert.deepEqual(
    s.checkpoints.map((c) => c.roundsPerParticipant),
    [1, 4, 8, 12],
  );
  assert.equal(s.checkpoints[3].total.ratios.input, 2);
  assert.equal(s.quality.native.correct, 36);
  assert.equal(s.observedCosts.native.roundMetrics.totals.generations, 39);
});

test("smoke uses exactly two rounds each; incomplete 12-round scope cannot become eligible", () => {
  const a = arms(2);
  const s = summarizeBusinessObservation(a, { roundsPerParticipant: 2 });
  assert.deepEqual(
    s.checkpoints.map((c) => c.roundsPerParticipant),
    [1, 2],
  );
  assert.equal(s.sameQuality.eligible, true);
  assert.equal(summarizeBusinessObservation(a).sameQuality.eligible, false);
  assert.throws(
    () => summarizeBusinessObservation(a, { roundsPerParticipant: 3 }),
    /scope/,
  );
});

test("wrong answer preserves history costs and later prefix; same-quality fails", () => {
  const a = arms();
  a["worker-delivery"].rounds[0].validation.qualityVerdict = "incorrect";
  const s = summarizeBusinessObservation(a);
  assert.equal(s.sameQuality.eligible, false);
  assert.equal(s.quality["worker-delivery"].incorrect, 1);
  assert.equal(s.checkpoints[3].total.ratios.input, 2);
  assert.equal(s.checkpoints[3].comparisonBasis, "diagnostic-cost-only");
  assert.equal(
    s.observedCosts["worker-delivery"].roundMetrics.totals.input,
    720,
  );
});

test("missing fields and failed attempts remain known costs, not zero or eligible", () => {
  const a = arms(2);
  a["worker-delivery"].status = "failed";
  const r = a["worker-delivery"].rounds[5];
  delete r.metrics.output;
  r.longStageSucceeded = false;
  r.validation.qualityVerdict = "unscorable";
  const s = summarizeBusinessObservation(a, { roundsPerParticipant: 2 });
  assert.equal(s.observedCosts["worker-delivery"].status, "unknown");
  assert.equal(s.observedCosts["worker-delivery"].roundMetrics.totals, null);
  assert.equal(
    s.observedCosts["worker-delivery"].roundMetrics.knownTotals.input,
    120,
  );
  assert.equal(s.checkpoints[1].total.ratios, null);
  assert.equal(s.checkpoints[0].total.ratios.input, 2);
  assert.equal(s.sameQuality.eligible, false);
});

test("truncated participant prefixes are not averaged and unrun quality remains distinct", () => {
  const a = arms();
  a["worker-delivery"].rounds = a["worker-delivery"].rounds.slice(0, 11);
  a["worker-delivery"].status = "failed";
  const s = summarizeBusinessObservation(a);
  assert.equal(s.checkpoints[1].total.ratios, null);
  assert.equal(s.checkpoints[1].participants.a.ratios.input, 2);
  assert.equal(s.quality["worker-delivery"].notRun, 25);
  assert.equal(
    s.observedCosts["worker-delivery"].roundMetrics.knownTotals.input,
    220,
  );
});

test("all observed identity conflicts and unknown execution integrity block comparisons", () => {
  for (const mutate of [
    (a) =>
      (a["worker-delivery"].rounds[34].sessionId =
        a["worker-delivery"].rounds[0].sessionId),
    (a) => (a["worker-delivery"].rounds[0].actualMemoryOff = false),
    (a) =>
      (a["worker-delivery"].rounds[0].validation.executionIntegrity =
        "unknown"),
    (a) =>
      a["worker-delivery"].rounds[0].metrics.productUsage.gaps.push("late"),
  ]) {
    const a = arms();
    mutate(a);
    const s = summarizeBusinessObservation(a);
    assert.equal(s.checkpoints[0].total.ratios, null);
    assert.equal(s.sameQuality.eligible, false);
  }
});

test("retry and replay costs are not discounted; transport unknown alone is not a blocker", () => {
  const a = arms(2);
  const r = a["worker-delivery"].rounds[0];
  r.validation.reliability = {
    attemptedCalls: 4,
    rejectedCalls: 2,
    deduplicatedCalls: 1,
  };
  r.validation.transportDiagnostics = ["unknown"];
  r.metrics.generations = 5;
  r.metrics.productUsage.totals.generations = 5;
  const s = summarizeBusinessObservation(a, { roundsPerParticipant: 2 });
  assert.equal(s.sameQuality.eligible, true);
  assert.equal(
    s.observedCosts["worker-delivery"].roundMetrics.totals.generations,
    12,
  );
  assert.equal(s.reliability["worker-delivery"].attemptedCalls, 9);
  assert.equal(s.reliability["worker-delivery"].rejectedCalls, 2);
});

test("safe no-delivery has costs but cannot be equal-quality and is not an unrun stage", () => {
  const a = arms(2);
  const r = a["worker-delivery"].rounds[0];
  r.validation.deliveryVerdict = "not-delivered";
  r.validation.qualityVerdict = "unscorable";
  const s = summarizeBusinessObservation(a, { roundsPerParticipant: 2 });
  assert.equal(s.sameQuality.eligible, false);
  assert.equal(s.quality["worker-delivery"].notDelivered, 1);
  assert.equal(s.quality["worker-delivery"].notRun, 0);
  assert.equal(s.checkpoints[1].total.ratios.input, 2);
});

test("durable unknown attempts are separate overlapping costs, never lost or double-counted", () => {
  const a = arms(2);
  const p = a["worker-delivery"];
  p.runs = [{ runAttemptId: "extra" }, { runAttemptId: "unreported" }];
  p.usageRows = [
    {
      run_attempt_id: "extra",
      input_tokens: 99,
      cached_input_tokens: 9,
      output_tokens: 7,
    },
  ];
  p.usageGaps = [];
  const s = summarizeBusinessObservation(a, { roundsPerParticipant: 2 });
  assert.equal(
    s.observedCosts["worker-delivery"].durableUsage.knownTotals.input,
    99,
  );
  assert.equal(s.observedCosts["worker-delivery"].durableUsage.totals, null);
  assert.equal(
    s.observedCosts["worker-delivery"].roundMetrics.knownTotals.input,
    120,
  );
  assert.equal(s.observedCosts["worker-delivery"].status, "unknown");
  assert.equal(s.checkpoints[1].total.ratios, null);
  assert.equal(s.sameQuality.eligible, false);
});
