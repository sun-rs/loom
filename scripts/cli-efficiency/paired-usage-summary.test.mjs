import assert from "node:assert/strict";
import test from "node:test";
import { summarizePairedUsage } from "./paired-usage-summary.mjs";

const row = (round, input, output, extra = {}) => ({
  round,
  finished: true,
  requestCoverageComplete: true,
  qualityPassed: true,
  usage: {
    input: { known: input, complete: true },
    output: { known: output, complete: true },
  },
  ...extra,
});
const sample = () => ({
  plannedRounds: 2,
  lateRounds: [2],
  comparisonIssues: [],
  native: [row(1, 100, 10), row(2, 200, 20)],
  loom: [row(1, 120, 12), row(2, 220, 22)],
});

test("missing cache detail cannot erase complete primary ratios", () => {
  const result = summarizePairedUsage(sample());
  assert.equal(result.full.ratios.input, 340 / 300);
  assert.equal(result.full.ratios.output, 34 / 30);
  assert.equal(result.full.ratios.cachedInput, null);
  assert.equal(result.late.ratios.input, 1.1);
});

test("quality failure retains all cost and does not masquerade as equal quality", () => {
  const input = sample();
  input.native[1].qualityPassed = false;
  const result = summarizePairedUsage(input);
  assert.equal(result.full.ratios.input, 340 / 300);
  assert.deepEqual(result.quality.native.failedRounds, [2]);
  assert.equal(result.quality.native.allPassed, false);
});

test("incomplete later work keeps the fixed common prefix and all observed expense", () => {
  const input = sample();
  input.loom[1] = row(2, 90, 3, {
    finished: false,
    requestCoverageComplete: false,
  });
  const result = summarizePairedUsage(input);
  assert.equal(result.full.ratios.input, null);
  assert.deepEqual(result.prefix.rounds, [1]);
  assert.equal(result.prefix.ratios.input, 1.2);
  assert.equal(result.observed.loom.input.known, 210);
  assert.equal(result.observed.loom.input.complete, false);
});

test("missing output leaves independently complete input measurable", () => {
  const input = sample();
  input.loom[1].usage.output = { known: 2, complete: false };
  const result = summarizePairedUsage(input);
  assert.equal(result.full.ratios.input, 340 / 300);
  assert.equal(result.full.ratios.output, null);
  assert.equal(result.full.loom.output.known, 14);
});

test("unfair environment is disclosed without deleting measured arithmetic", () => {
  const input = sample();
  input.comparisonIssues = ["worker-unavailable"];
  const result = summarizePairedUsage(input);
  assert.equal(result.comparable, false);
  assert.equal(result.full.ratios.input, 340 / 300);
  assert.deepEqual(result.comparisonIssues, ["worker-unavailable"]);
});

test("zero native usage has no ratio, and unexecuted tasks are not complete zero", () => {
  const input = sample();
  input.native = [];
  const result = summarizePairedUsage(input);
  assert.equal(result.full.ratios.input, null);
  assert.equal(result.observed.native.input.complete, false);
  assert.deepEqual(result.prefix.rounds, []);
  input.native = [row(1, 0, 0), row(2, 0, 0)];
  assert.equal(summarizePairedUsage(input).full.ratios.input, null);
});

test("duplicates, out-of-plan rounds and invalid usage cannot silently enter totals", () => {
  for (const change of [
    (x) => x.native.push(row(2, 100, 10)),
    (x) => x.native.push(row(3, 100, 10)),
    (x) => (x.native[0].usage.input.known = -1),
  ]) {
    const input = sample();
    change(input);
    assert.throws(() => summarizePairedUsage(input));
  }
});
