import assert from "node:assert/strict";
import test from "node:test";
import { summarizeLongSession } from "./long-session-metrics.mjs";
const stage = (n, input = 100) => ({
  stage: n,
  sessionId: "session",
  completed: true,
  memoryOff: true,
  durationSeconds: 2,
  usage: {
    input,
    cached: 60,
    uncached: input - 60,
    output: 10,
    generations: 1,
    completeness: "complete",
    gaps: [],
  },
});
const arm = (input = 100) => ({
  stages: Array.from({ length: 12 }, (_, i) => stage(i + 1, input)),
});
const run = (product = arm(120), native = arm()) =>
  summarizeLongSession({ arms: { native, product } });
test("cumulative raw costs and startup/steady windows retain every generation", () => {
  const product = arm(120);
  product.stages[0].usage = {
    ...product.stages[0].usage,
    input: 360,
    uncached: 300,
    generations: 3,
  };
  const r = run(product);
  assert.equal(r.status, "complete");
  assert.deepEqual(r.arms.product.total.totals, {
    input: 1680,
    cached: 720,
    uncached: 960,
    output: 120,
    generations: 14,
    durationSeconds: 24,
  });
  assert.deepEqual(
    r.arms.product.checkpoints.map((x) => x.toStage),
    [1, 3, 6, 9, 12],
  );
  assert.deepEqual(
    r.arms.product.windows.map((x) => x.totals.generations),
    [3, 5, 6],
  );
  assert.equal(r.comparisons.product.checkpoints.at(-1).ratios.input, 1.4);
  assert.equal("withinBudget" in r, false);
});
test("missing usage retains measured subtotal but never invents a complete total", () => {
  const a = arm();
  a.stages[3].usage.completeness = "missing";
  a.stages[3].usage.gaps = ["unreported"];
  const r = run(a);
  assert.equal(r.status, "incomplete");
  assert.equal(r.arms.product.total.totals, null);
  assert.equal(r.arms.product.total.knownObservedTotals.input, 1200);
  assert.equal(r.comparisons.product.checkpoints[1].status, "comparable");
  assert.equal(r.comparisons.product.checkpoints[2].ratios, null);
  assert.equal(r.comparisons.product.windows[2].status, "comparable");
});
test("missing token fields are null, not zero or inferred", () => {
  const a = arm();
  delete a.stages[0].usage.uncached;
  const r = run(a);
  assert.equal(r.arms.product.total.totals, null);
  assert.equal(r.arms.product.total.knownObservedTotals.uncached, 440);
  assert.ok(r.arms.product.total.issues.some((x) => x.includes("uncached")));
});
test("session change, unknown memory, duplicate and misordered stages fail closed", () => {
  for (const mutate of [
    (a) => (a.stages[1].sessionId = "other"),
    (a) => (a.stages[1].memoryOff = null),
    (a) => (a.stages[1].stage = 1),
    (a) => ([a.stages[0], a.stages[1]] = [a.stages[1], a.stages[0]]),
  ]) {
    const a = arm();
    mutate(a);
    const r = run(a);
    assert.equal(r.status, "incomplete");
    assert.equal(r.comparisons.product.total.ratios, null);
  }
});
test("invalid numerical evidence and cached sum mismatch cannot compare", () => {
  for (const mutate of [
    (u) => (u.input = Infinity),
    (u) => (u.output = -1),
    (u) => (u.generations = 0),
    (u) => (u.cached = 99),
    (u) => (u.input = 1.5),
  ]) {
    const a = arm();
    mutate(a.stages[0].usage);
    assert.equal(run(a).comparisons.product.total.ratios, null);
  }
});
test("unfinished native cannot become a denominator; completed prefix stays visible", () => {
  const n = arm();
  n.stages = n.stages.slice(0, 6);
  const r = run(arm(), n);
  assert.equal(r.status, "incomplete");
  assert.equal(r.comparisons.product.checkpoints[2].status, "comparable");
  assert.equal(r.comparisons.product.total.ratios, null);
});
test("failed stage cost is retained without confusing completion with quality", () => {
  const a = arm();
  a.stages[5].completed = false;
  const r = run(a);
  assert.equal(r.arms.product.total.knownObservedTotals.input, 1200);
  assert.equal(r.comparisons.product.total.ratios, null);
  assert.equal(r.comparisons.product.windows[2].status, "comparable");
  assert.equal(r.quality, "not-assessed");
});
test("zero denominator ratios stay unknown, not Infinity or automatic pass", () => {
  const n = arm();
  for (const s of n.stages) {
    s.usage.output = 0;
    s.durationSeconds = 0;
  }
  const r = run(arm(), n);
  assert.equal(r.comparisons.product.total.ratios.output, null);
  assert.equal(r.comparisons.product.total.ratios.durationSeconds, null);
});
test("unexpected-stage cost remains in observed full-arm subtotal while rejecting comparison", () => {
  const a = arm();
  a.stages.push(stage(13, 250));
  const r = run(a);
  assert.equal(r.arms.product.total.knownObservedTotals.input, 1450);
  assert.equal(r.comparisons.product.total.ratios, null);
});
