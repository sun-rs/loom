import assert from "node:assert/strict";
import test from "node:test";
import { mergeRoundProductUsage, roundRunVerdict } from "./round-retry.mjs";
import { compareArm, compareRounds } from "./metrics.mjs";

const ok = { state: "exited", exitCode: 0, succeeded: true };
const done = [{ state: "completed" }];
const final = { committedRoomSeq: 9, requested: true, sent: true };
const reply = { roomId: "room", threadId: null };

test("a retried round with exactly one on-target final reply and a completed ACK is a soft retried item", () => {
  const verdict = roundRunVerdict({
    runs: [ok, ok],
    replies: [reply],
    activations: done,
    finalInterrupts: [null, final],
    roomId: "room",
  });
  assert.deepEqual(verdict, { attempts: 2, retried: true, failures: [] });
});

test("a single-run round keeps the historical checks", () => {
  assert.deepEqual(
    roundRunVerdict({
      runs: [ok],
      replies: [reply],
      activations: done,
      finalInterrupts: [final],
      roomId: "room",
    }),
    { attempts: 1, retried: false, failures: [] },
  );
});

test("a retried round stays a hard failure for duplicate, missing, non-final, unacknowledged, quarantined or misdirected replies", () => {
  const base = {
    runs: [ok, ok],
    replies: [reply],
    activations: done,
    finalInterrupts: [null, final],
    roomId: "room",
  };
  const cases = [
    [{ replies: [reply, reply] }, "duplicateReply"],
    [{ replies: [] }, "noReply"],
    [{ finalInterrupts: [null, null] }, "finalMissing"],
    [{ finalInterrupts: [null, undefined] }, "finalMissing"],
    [{ activations: [{ state: "leased" }] }, "ackIncomplete"],
    [
      { activations: [{ state: "quarantined" }, { state: "completed" }] },
      "quarantined",
    ],
    [{ replies: [{ roomId: "room", threadId: "thread" }] }, "wrongTarget"],
    [{ replies: [{ roomId: "other", threadId: null }] }, "wrongTarget"],
    [
      { runs: [{ state: "failed", exitCode: 1, succeeded: false }, ok] },
      "runFailed",
    ],
  ];
  for (const [override, failure] of cases) {
    const verdict = roundRunVerdict({ ...base, ...override });
    assert.ok(
      verdict.failures.includes(failure),
      `${failure}: ${JSON.stringify(verdict)}`,
    );
  }
});

test("round usage is the sum over every attempt, with the first attempt's execution and the committed final", () => {
  const generation = (id, input) => ({
    responseId: id,
    observedAt: "2026-09-25T12:00:00.000Z",
    inputTokens: input,
    cachedInputTokens: 0,
    outputTokens: 10,
    reasoningOutputTokens: 1,
  });
  const merged = mergeRoundProductUsage([
    {
      runAttemptId: "run-1",
      completeness: "complete",
      gaps: [],
      generations: [generation("g1", 100), generation("g2", 200)],
      totals: {
        generations: 2,
        inputTokens: 300,
        cachedInputTokens: 0,
        outputTokens: 20,
        reasoningOutputTokens: 2,
      },
      truncated: false,
      execution: { mode: "cold", instanceRuntimeId: "rt" },
      finalInterrupt: null,
      sessionResumeMs: 40,
    },
    {
      runAttemptId: "run-2",
      completeness: "complete",
      gaps: [],
      generations: [generation("g3", 400)],
      totals: {
        generations: 1,
        inputTokens: 400,
        cachedInputTokens: 0,
        outputTokens: 10,
        reasoningOutputTokens: null,
      },
      truncated: false,
      execution: { mode: "warm", instanceRuntimeId: "rt" },
      finalInterrupt: final,
      sessionResumeMs: null,
    },
  ]);
  assert.equal(merged.generations.length, 3);
  assert.deepEqual(merged.totals, {
    generations: 3,
    inputTokens: 700,
    cachedInputTokens: 0,
    outputTokens: 30,
    reasoningOutputTokens: null,
  });
  assert.equal(merged.completeness, "complete");
  assert.equal(merged.execution.mode, "cold");
  assert.equal(merged.sessionResumeMs, 40);
  assert.equal(merged.finalInterrupt, final);
  assert.equal(
    mergeRoundProductUsage([
      { completeness: "complete", totals: {}, finalInterrupt: null },
      { completeness: "partial", totals: {}, finalInterrupt: null },
    ]).completeness,
    "partial",
  );
});

const metrics = (extra = {}) => ({
  generations: 2,
  generationsTotal: 2,
  generationsBeforeReply: 2,
  generationsAfterReply: 0,
  input: 1000,
  cached: 0,
  uncached: 1000,
  output: 10,
  firstInput: 500,
  replySeconds: 10,
  ...extra,
});

test("a retried round is never within budget, even when its summed cost happens to fit", () => {
  const verdict = compareRounds(metrics(), metrics({ retried: true }), {
    unmeasured: ["productUsage"],
  });
  assert.ok(verdict.failures.includes("retried"));
  assert.equal(verdict.measuredStatus, "over-budget");
  const arm = compareArm(
    [metrics(), metrics()],
    [metrics({ retried: true, attempts: 2 }), metrics()],
    { unmeasured: ["productUsage"] },
  );
  assert.deepEqual(arm.retriedRounds, [1]);
  assert.equal(arm.measuredStatus, "over-budget");
  const clean = compareArm([metrics()], [metrics()], {
    unmeasured: ["productUsage"],
  });
  assert.deepEqual(clean.retriedRounds, []);
});
