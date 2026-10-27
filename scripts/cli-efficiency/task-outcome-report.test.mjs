import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildTaskOutcomeReport } from "./task-outcome-report.mjs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const team = () =>
  read("docs/evo/evidence/2026-10-13-backend-finish/team-v8.json");
const agy = () =>
  read("docs/evo/evidence/2026-10-27-agy-closeout/summary.json");

test("six attempts retain failed business work and its cost, independent of process completion", () => {
  const report = buildTaskOutcomeReport(team());
  assert.equal(report.cases.length, 6);
  const failed = report.cases.find((c) => c.id === "pair2-native");
  assert.equal(failed.executionFinished, true);
  assert.equal(failed.outcome, "failed");
  assert.equal(report.arms.native.passed, 2);
  assert.equal(report.arms.native.failed, 1);
  assert.equal(report.arms.native.input.known, 1940003);
  assert.equal(report.arms.native.failedInput.known, 100935);
  assert.equal(report.arms.loom.input.known, 2007597);
  assert.equal(report.comparison.equalQualityRatio.input, null);
  assert.equal(
    report.comparison.arithmetic.full.ratios.input,
    2007597 / 1940003,
  );
  assert.equal(report.cases[0].handoff.proof, "aggregate-only");
  assert.equal(report.cases[0].descendantCoverage, "unknown");
  assert.equal(report.cases[0].wallMs, null);
});

test("missing planned attempts remain unknown; missing accounting never becomes complete zero", () => {
  const source = team();
  source.samples = source.samples.filter((s) => s.sampleId !== "pair3-loom");
  source.samples[0].usageComplete = false;
  const report = buildTaskOutcomeReport(source);
  assert.equal(report.cases.length, 6);
  assert.equal(report.arms.loom.unknown, 1);
  assert.equal(report.arms.loom.input.total, null);
  assert.equal(report.comparison.arithmetic.full.ratios.input, null);
  assert.equal(
    report.cases.find((c) => c.id === "pair3-loom").outcome,
    "unknown",
  );
});

test("duplicate or unplanned samples and invalid usage are rejected", () => {
  for (const mutate of [
    (s) => s.samples.push(s.samples[0]),
    (s) => (s.samples[0].sampleId = "pair4-loom"),
    (s) => (s.samples[0].input = -1),
    (s) => (s.samples[0].output = Number.MAX_SAFE_INTEGER + 1),
    (s) => (s.samples[0].arm = "native"),
    (s) => (s.samples[0].input = null),
  ]) {
    const source = team();
    mutate(source);
    assert.throws(() => buildTaskOutcomeReport(source));
  }
});

test("AGY review keeps human recovery and its usage, with no whole-task or efficiency promotion", () => {
  const report = buildTaskOutcomeReport(agy());
  const c = report.cases[0];
  assert.equal(c.outcome, "unknown");
  assert.equal(c.boundedReview, "passed");
  assert.equal(c.humanIntervention, "recorded");
  assert.equal(c.usage.input.known, 145018);
  assert.equal(c.usage.input.total, null);
  assert.equal(c.usage.output.known, 633);
  assert.equal(c.usage.cachedInput.known, 107347);
  assert.equal(c.handoff.proof, "linked-summary-without-inbox");
  assert.equal(c.handoff.sourceEventId, agy().verified.requestEvent);
  assert.equal(c.runIds.length, 5);
  assert.equal(report.comparison, null);
});

test("reply counts or a copied verdict cannot replace matching causal and execution evidence", () => {
  for (const mutate of [
    (s) => (s.verified.replyReturn.sourceEventId = "wrong"),
    (s) => (s.verified.finalSeq = s.verified.replySeq),
    (s) => (s.presentedWindows = []),
    (s) => (s.result.runs = []),
    (s) => (s.verified.reviewActuallyRanTests = false),
    (s) => (s.activations.find((a) => a.to_seq === 54).state = "failed"),
    (s) => (s.verified.replyReturn.participantId = "wrong"),
  ]) {
    const source = agy();
    mutate(source);
    const c = buildTaskOutcomeReport(source).cases[0];
    assert.equal(c.boundedReview, "unknown");
    assert.notEqual(c.handoff.proof, "linked-summary-without-inbox");
  }
});

test("a missing AGY stage leaves its expense unknown, not an inferred zero", () => {
  const source = agy();
  delete source.usageByStage.manual_resume;
  const c = buildTaskOutcomeReport(source).cases[0];
  assert.equal(c.usage.input.known, 100481);
  assert.equal(c.usage.input.total, null);
  assert.equal(c.humanIntervention, "recorded");
});

test("unsupported formats fail closed and report building leaves original evidence untouched", () => {
  assert.throws(
    () => buildTaskOutcomeReport({ verdict: "pass" }),
    /Unsupported/,
  );
  const source = team();
  const original = structuredClone(source);
  buildTaskOutcomeReport(source);
  assert.deepEqual(source, original);
});

test("native aggregation is not summed again with member records, and cache is not deducted", () => {
  const source = team();
  source.samples[0].members = {
    child: { input: 999999999, output: 999999999 },
  };
  assert.equal(buildTaskOutcomeReport(source).arms.loom.input.known, 2007597);
  const report = buildTaskOutcomeReport(agy());
  assert.equal(report.cases[0].usage.input.known, 145018);
  assert.equal(report.cases[0].usage.generations.known, 9);
  assert.equal(report.cases[0].usage.requests.total, null);
});

test("aggregate overflow fails instead of producing an imprecise report", () => {
  const source = team();
  for (const s of source.samples) s.input = Number.MAX_SAFE_INTEGER;
  assert.throws(() => buildTaskOutcomeReport(source), /usage|safe integer/i);
});

test("CLI reads archived evidence without changing it and attaches the exact source hash", async () => {
  const { spawnSync } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const file = "docs/evo/evidence/2026-10-13-backend-finish/team-v8.json";
  const before = readFileSync(file);
  const result = spawnSync(
    process.execPath,
    ["scripts/cli-efficiency/task-outcome-report.mjs", file],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(result.stdout).source.sha256,
    createHash("sha256").update(before).digest("hex"),
  );
  assert.deepEqual(readFileSync(file), before);
  const invalid = spawnSync(
    process.execPath,
    ["scripts/cli-efficiency/task-outcome-report.mjs", "--paid"],
    { encoding: "utf8" },
  );
  assert.notEqual(invalid.status, 0);
});
