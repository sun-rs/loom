import assert from "node:assert/strict";
import test from "node:test";
import { summarizeUsage, compareRounds } from "./metrics.mjs";
import { p99ReplyTiming } from "./fixtures/p99-codex-reply-timing.mjs";

for (const round of p99ReplyTiming) {
  test(`P99 round ${round.round}: late usage does not prove a post-reply generation`, () => {
    const measured = summarizeUsage(round.events, { replyAt: round.replyAt });
    const unsplit = summarizeUsage(round.events);
    assert.equal(measured.generationsBeforeReply, null);
    assert.equal(measured.generationsAfterReply, null);
    assert.deepEqual(measured.replyTimingEvidence, {
      basis: "usage-record-upper-bound",
      knownBeforeReply: round.round === 1 ? 2 : 0,
      unresolved: 1,
    });
    for (const key of [
      "generations",
      "generationsTotal",
      "input",
      "cached",
      "uncached",
      "output",
      "reasoning",
    ])
      assert.equal(
        measured[key],
        unsplit[key],
        `${key} remains observed usage`,
      );
    const comparison = compareRounds(
      { ...unsplit, replySeconds: 1, toolCalls: [] },
      {
        ...measured,
        replySeconds: 1,
        toolCalls: [{ kind: "worker-mcp-reply" }],
      },
      { unmeasured: ["productUsage"] },
    );
    assert.equal(comparison.extraProtocolGenerationsBeforeReply, null);
    assert.equal(
      comparison.failures.includes("generationsBeforeReplyMissing"),
      false,
    );
    assert.equal(comparison.beforeReplyBudgetEvidence.status, "within-budget");
  });
}

test("usage already recorded before reply remains a valid completion upper bound", () => {
  const round = p99ReplyTiming[0];
  const measured = summarizeUsage(round.events, {
    replyAt: "2026-10-04T13:42:49.000Z",
  });
  assert.equal(measured.generationsBeforeReply, 3);
  assert.equal(measured.generationsAfterReply, 0);
  assert.deepEqual(measured.replyTimingEvidence, {
    basis: "usage-record-upper-bound",
    knownBeforeReply: 3,
    unresolved: 0,
  });
});

for (const [name, known, total, nativeTotal, expected] of [
  ["upper bound proves budget", 0, 1, 1, "within-budget"],
  ["lower bound proves excess", 2, 3, 1, "over-budget"],
  ["straddling interval stays unknown", 1, 3, 1, "missing-evidence"],
]) {
  test(name, () => {
    const comparison = compareRounds(
      { generationsTotal: nativeTotal, toolCalls: [] },
      {
        generationsTotal: total,
        generationsBeforeReply: null,
        toolCalls: [],
        replyTimingEvidence: {
          basis: "usage-record-upper-bound",
          knownBeforeReply: known,
          unresolved: total - known,
        },
      },
    );
    assert.deepEqual(comparison.beforeReplyBudgetEvidence, {
      basis: "usage-record-upper-bound",
      lower: known - nativeTotal,
      upper: total - nativeTotal,
      budget: 0,
      status: expected,
    });
    assert.equal(comparison.extraProtocolGenerationsBeforeReply, null);
    assert.equal(
      comparison.failures.includes("generationsBeforeReplyMissing"),
      expected === "missing-evidence",
    );
    assert.equal(
      comparison.failures.includes("generationsBeforeReply"),
      expected === "over-budget",
    );
  });
}
test("untimed business tools cannot prove a before-reply credit", () => {
  const comparison = compareRounds(
    { generationsTotal: 1, toolCalls: [] },
    {
      generationsTotal: 2,
      generationsBeforeReply: null,
      toolCalls: [{ kind: "other" }],
      replyTimingEvidence: {
        basis: "usage-record-upper-bound",
        knownBeforeReply: 0,
        unresolved: 2,
      },
    },
  );
  assert.equal(comparison.beforeReplyBudgetEvidence.upper, 1);
  assert.ok(comparison.failures.includes("generationsBeforeReplyMissing"));
});

test("independently timed business delta can certify the conservative upper bound", () => {
  const comparison = compareRounds(
    { generationsTotal: 2, toolCalls: [{ kind: "other" }] },
    {
      generationsTotal: 3,
      generationsBeforeReply: null,
      replyAt: "2026-10-04T13:42:48.676Z",
      toolCalls: [
        { kind: "other", at: "2026-10-04T13:42:37.559Z" },
        { kind: "other", at: "2026-10-04T13:42:40.332Z" },
        { kind: "worker-mcp-reply" },
      ],
      replyTimingEvidence: {
        basis: "usage-record-upper-bound",
        knownBeforeReply: 2,
        unresolved: 1,
      },
    },
  );
  assert.equal(comparison.extraProtocolGenerationsBeforeReply, null);
  assert.deepEqual(comparison.beforeReplyBudgetEvidence, {
    basis: "usage-record-upper-bound",
    lower: -1,
    upper: 0,
    budget: 0,
    status: "within-budget",
  });
  assert.equal(
    comparison.failures.includes("generationsBeforeReplyMissing"),
    false,
  );
});
