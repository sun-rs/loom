import test from "node:test";
import assert from "node:assert/strict";
import { reconcileAll } from "./opencode-request-accounting.mjs";
const response = (
  usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
) => ({
  id: 1,
  status: 200,
  complete: true,
  done: true,
  sseParseErrors: 0,
  usage,
});
const native = (input = 100, output = 20) => [
  {
    id: "m1",
    tokens: { input, output, reasoning: 0, cache: { read: 0, write: 0 } },
  },
];
test("missing optional detail preserves known totals, detail stays unknown", () => {
  const r = reconcileAll([response()], native());
  assert.equal(r.input, 100);
  assert.equal(r.output, 20);
  assert.equal(r.complete, true);
  assert.equal(r.cachedInput, null);
  assert.equal(r.reasoningOutput, null);
  assert.equal(r.dimensions.cachedInput.unknownRequests, 1);
});
test("missing primary total never passes and is not fabricated", () => {
  const r = reconcileAll([response({ completion_tokens: 20 })], native());
  assert.equal(r.complete, false);
  assert.equal(r.dimensions.input.unknownRequests, 1);
  assert.equal(r.output, 20);
});
test("incomplete stream cannot pass even if usage seen", () => {
  const r = reconcileAll([{ ...response(), done: false }], native());
  assert.equal(r.complete, false);
  assert.equal(r.dimensions.input.known, 100);
  assert.equal(r.streamCoverageComplete, false);
});
test("explicit invalid detail stays integrity failure, not optional absence", () => {
  const r = reconcileAll(
    [
      response({
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_tokens_details: { cached_tokens: -1 },
      }),
    ],
    native(),
  );
  assert.equal(r.complete, false);
  assert.equal(r.input, 100);
});
test("all valid details compare against native and remain complete", () => {
  const r = reconcileAll(
    [
      response({
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_tokens_details: { cached_tokens: 0 },
        completion_tokens_details: { reasoning_tokens: 0 },
      }),
    ],
    native(),
  );
  assert.equal(r.complete, true);
  assert.equal(r.cachedInput, 0);
  assert.equal(r.reasoningOutput, 0);
});
test("native primary disagreement blocks despite captured totals", () => {
  const r = reconcileAll([response()], native(99));
  assert.equal(r.complete, false);
  assert.equal(r.input, 100);
});
test("duplicate conflicting identities exclude conflicting amounts", () => {
  const r = reconcileAll(
    [
      response(),
      response({
        prompt_tokens: 101,
        completion_tokens: 20,
        total_tokens: 121,
      }),
    ],
    native(),
  );
  assert.equal(r.complete, false);
  assert.equal(r.input, 0);
  assert.equal(r.dimensions.input.unknownRequests, 1);
});
test("invalid primary counts rejected and total inconsistency blocks", () => {
  assert.equal(
    reconcileAll(
      [
        response({
          prompt_tokens: -1,
          completion_tokens: 20,
          total_tokens: 19,
        }),
      ],
      native(),
    ).complete,
    false,
  );
  assert.equal(
    reconcileAll(
      [
        response({
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 121,
        }),
      ],
      native(),
    ).complete,
    false,
  );
});

test("P164 request19: actual sanitized usage shape preserves 18927/283", () => {
  const r = reconcileAll(
    [
      response({
        prompt_tokens: 18927,
        completion_tokens: 283,
        total_tokens: 19210,
      }),
    ],
    native(18927, 283),
  );
  assert.equal(r.primaryComplete, true);
  assert.equal(r.detailsComplete, false);
  assert.equal(r.input, 18927);
  assert.equal(r.output, 283);
  assert.equal(r.cachedInput, null);
  assert.equal(r.reasoningOutput, null);
});
test("complete primary and detailed usage have separate completeness flags", () => {
  const r = reconcileAll(
    [
      response({
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_tokens_details: { cached_tokens: 0 },
        completion_tokens_details: { reasoning_tokens: 0 },
      }),
    ],
    native(),
  );
  assert.equal(r.primaryComplete, true);
  assert.equal(r.detailsComplete, true);
});
test("HTTP failure, parse error, truncation and missing terminator reject coverage", () => {
  for (const bad of [
    { status: 429 },
    { sseParseErrors: 1 },
    { captureLimitExceeded: true },
    { done: false },
    { complete: false },
  ])
    assert.equal(
      reconcileAll([{ ...response(), ...bad }], native()).complete,
      false,
    );
});
test("duplicate identities cannot imply complete coverage", () => {
  const r = reconcileAll([response(), response()], native());
  assert.equal(r.complete, false);
  assert.equal(r.input, 100);
  assert.equal(r.output, 20);
});
test("native identity/coverage mismatches reject reconciliation", () => {
  assert.equal(reconcileAll([response()], []).complete, false);
  assert.equal(
    reconcileAll(
      [response(), { ...response(), id: 2 }],
      [...native(), ...native()],
    ).complete,
    false,
  );
});

test("missing or invalid request/native identities cannot prove coverage", () => {
  for (const id of [undefined, null, "", " ", -1, 1.5]) {
    const requestResult = reconcileAll([{ ...response(), id }], native());
    assert.equal(requestResult.primaryComplete, false);
    assert.equal(requestResult.input, 100);
    const nativeResult = reconcileAll([response()], [{ ...native()[0], id }]);
    assert.equal(nativeResult.primaryComplete, false);
    assert.equal(nativeResult.input, 100);
  }
});

test("empty observations and unsafe sums cannot establish complete totals", () => {
  assert.equal(reconcileAll([], []).primaryComplete, false);
  const huge = Number.MAX_SAFE_INTEGER;
  const r = reconcileAll(
    [
      response({ prompt_tokens: huge, completion_tokens: 0 }),
      { ...response({ prompt_tokens: huge, completion_tokens: 0 }), id: 2 },
    ],
    [...native(huge, 0), { ...native(huge, 0)[0], id: "m2" }],
  );
  assert.equal(r.primaryComplete, false);
});

test("missing output does not invalidate independently reconciled input", () => {
  const r = reconcileAll([response({ prompt_tokens: 100 })], native());
  assert.equal(r.requestCoverageComplete, true);
  assert.equal(r.dimensions.input.complete, true);
  assert.equal(r.dimensions.output.complete, false);
  assert.equal(r.primaryComplete, false);
});
test("input disagreement does not invalidate independently reconciled output", () => {
  const r = reconcileAll([response()], native(99));
  assert.equal(r.requestCoverageComplete, true);
  assert.equal(r.dimensions.input.complete, false);
  assert.equal(r.dimensions.output.complete, true);
});
test("missing cache does not invalidate input but contradictory total blocks both primary dimensions", () => {
  const good = reconcileAll([response()], native());
  assert.equal(good.dimensions.input.complete, true);
  assert.equal(good.dimensions.cachedInput.complete, false);
  const bad = reconcileAll(
    [
      response({
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 121,
      }),
    ],
    native(),
  );
  assert.equal(bad.requestCoverageComplete, true);
  assert.equal(bad.primaryComplete, false);
  assert.equal(bad.dimensions.input.complete, false);
  assert.equal(bad.dimensions.output.complete, false);
});

test("identity coverage is independent of a missing usage dimension or stream termination", () => {
  const partial = reconcileAll(
    [{ ...response({ prompt_tokens: 100 }), done: false }],
    native(),
  );
  assert.equal(partial.identityCoverageComplete, true);
  assert.equal(partial.requestCoverageComplete, false);
  assert.equal(
    reconcileAll([response(), response()], native()).identityCoverageComplete,
    false,
  );
});
