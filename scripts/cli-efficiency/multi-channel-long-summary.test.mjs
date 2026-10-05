import assert from "node:assert/strict";
import test from "node:test";
import { summarizeLongChannel } from "./multi-channel-long-summary.mjs";
const round = (speaker, local, input = 10) => ({
  round: (local - 1) * 3 + ["a", "b", "c"].indexOf(speaker) + 1,
  speaker,
  sessionId: `session-${speaker}`,
  longStageSucceeded: true,
  actualIdentityVerified: true,
  actualWorkspaceVerified: true,
  actualMemoryOff: true,
  validation: {
    answer: "exact",
    readProof: local === 1 ? "complete-tool-result" : "previous-turn-only",
  },
  metrics: { input, cached: 2, uncached: input - 2, output: 1, generations: 1 },
});
const arms = () =>
  Object.fromEntries(
    ["native", "final-output"].map((kind) => [
      kind,
      {
        kind,
        status: "complete",
        rounds: Array.from({ length: 12 }, (_, i) =>
          ["a", "b", "c"].map((s) =>
            round(s, i + 1, kind === "native" ? 10 : 20),
          ),
        )
          .flat()
          .map((r) =>
            kind === "native"
              ? r
              : {
                  ...r,
                  metrics: {
                    ...r.metrics,
                    productUsage: {
                      completeness: "complete",
                      gaps: [],
                      totals: {
                        inputTokens: 20,
                        cachedInputTokens: 2,
                        outputTokens: 1,
                        generations: 1,
                      },
                    },
                  },
                },
          ),
      },
    ]),
  );
test("complete same-prefix totals sum all three participants and never infer a budget verdict", () => {
  const s = summarizeLongChannel(arms());
  assert.equal(s.budgetVerdict, "not-assessed");
  assert.deepEqual(
    s.checkpoints.map((x) => x.roundsPerParticipant),
    [1, 4, 8, 12],
  );
  for (const c of s.checkpoints) {
    assert.equal(c.total.ratios.input, 2);
    assert.equal(c.total.native.totals.input, c.roundsPerParticipant * 30);
    assert.equal(c.participants.a.ratios.input, 2);
  }
});
test("incomplete or failed later stage keeps completed earlier prefix but never averages missing speakers", () => {
  const a = arms();
  a["final-output"].status = "failed";
  a["final-output"].rounds = a["final-output"].rounds.slice(0, 11);
  a["final-output"].rounds.at(-1).validationError = "wrong";
  const s = summarizeLongChannel(a);
  assert.equal(s.status, "incomplete");
  assert.equal(s.checkpoints[0].total.ratios.input, 2);
  assert.equal(s.checkpoints[1].total.ratios, null);
  assert.equal(s.observedTotals["final-output"].roundMetrics.totals.input, 220);
});
test("missing usage remains unknown and known failure charges stay visible", () => {
  const a = arms();
  a["final-output"].rounds[1].metrics = undefined;
  const s = summarizeLongChannel(a);
  assert.equal(s.checkpoints[0].total.ratios, null);
  assert.equal(s.checkpoints[0].participants.b.product.totals, null);
  assert.equal(s.observedTotals["final-output"].roundMetrics.totals, null);
  assert.equal(
    s.observedTotals["final-output"].roundMetrics.knownTotals.input,
    700,
  );
});
test("identity, arithmetic, session replacement and product gaps cannot compare", () => {
  for (const mutate of [
    (r) => {
      r.actualIdentityVerified = false;
    },
    (r) => {
      r.metrics.uncached = 0;
    },
    (r) => {
      r.metrics.productUsage.gaps = ["gap"];
    },
    (r) => {
      r.validationError = "bad";
    },
  ]) {
    const a = arms();
    mutate(a["final-output"].rounds[0]);
    assert.equal(summarizeLongChannel(a).checkpoints[0].total.ratios, null);
  }
  const a = arms();
  a["final-output"].rounds[3].sessionId = "new";
  assert.equal(
    summarizeLongChannel(a).checkpoints[1].participants.a.ratios,
    null,
  );
});

test("unexpected durable Run charges are retained separately and unreported Runs are never zero", () => {
  const a = arms();
  a["final-output"].status = "failed";
  a["final-output"].runs = [
    { runAttemptId: "extra" },
    { runAttemptId: "missing" },
  ];
  a["final-output"].usageRows = [
    {
      run_attempt_id: "extra",
      input_tokens: 99,
      cached_input_tokens: 9,
      output_tokens: 4,
    },
  ];
  const s = summarizeLongChannel(a);
  assert.equal(s.status, "incomplete");
  assert.equal(s.observedTotals["final-output"].durableUsage.totals, null);
  assert.equal(
    s.observedTotals["final-output"].durableUsage.knownTotals.input,
    99,
  );
  assert.ok(
    s.observedTotals["final-output"].durableUsage.missing.includes(
      "unreported-run:missing",
    ),
  );
});

test("any observed cross-speaker session collision invalidates prefix comparisons", () => {
  const a = arms();
  // Even a later observed collision invalidates the arm's identity evidence.
  a["final-output"].rounds[34].sessionId = "session-a";
  const s = summarizeLongChannel(a);
  for (const checkpoint of s.checkpoints) {
    assert.equal(checkpoint.total.ratios, null);
    for (const participant of Object.values(checkpoint.participants))
      assert.equal(participant.ratios, null);
  }
});

test("exact answer alone is not complete read validation; each phase needs its own proof", () => {
  for (const [index, proof] of [
    [0, undefined],
    [0, "previous-turn-only"],
    [3, "complete-tool-result"],
  ]) {
    const a = arms();
    a["final-output"].rounds[index].validation.readProof = proof;
    const s = summarizeLongChannel(a);
    assert.equal(
      s.checkpoints[index === 0 ? 0 : 1].participants.a.ratios,
      null,
    );
  }
});
