import assert from "node:assert/strict";
import test from "node:test";
import {
  longSessionPlan,
  normalizeLongStage,
  longArmEnvironment,
} from "../test-cli-long-session.mjs";
test("fixed free plan rejects ambiguous modes and has distinct immutable workload identity", () => {
  const p = longSessionPlan(["--plan"], "codex-cli 0.160.0");
  assert.equal(p.mode, "plan");
  assert.deepEqual(p.order, ["native", "default", "final-output"]);
  assert.equal(p.questions.length, 12);
  assert.equal(p.baseline.workloadId, "restart-audit-12/v1");
  assert.equal(p.config.model, "gpt-6-luna");
  assert.equal(p.config.effort, "low");
  assert.ok(!JSON.stringify(p).includes("rubric"));
  for (const a of [[], ["--paid", "--plan"], ["--plan", "--model=other"]])
    assert.throws(() => longSessionPlan(a, "codex-cli 0.160.0"));
  assert.throws(() => longSessionPlan(["--paid"], "codex-cli 9.9.9"));
});
test("arm flags override inherited trials without changing account environment", () => {
  for (const kind of ["native", "default", "final-output"]) {
    const e = longArmEnvironment(kind, {
      SECRET: "kept",
      LOOM_CODEX_NATIVE_FINAL_TRIAL: "1",
      LOOM_KIMI_NATIVE_FINAL_TRIAL: "1",
      LOOM_CLAUDE_NATIVE_FINAL_TRIAL: "1",
      LOOM_OPENCODE_NATIVE_FINAL_TRIAL: "1",
      LOOM_CODEX_EXEC_NATIVE_FINAL_TRIAL: "1",
      LOOM_PI_NATIVE_FINAL_TRIAL: "1",
      LOOM_CODEX_FINAL_OUTPUT_TRIAL: "1",
      LOOM_OPENCODE_FINAL_OUTPUT_TRIAL: "1",
      RAH_EFFICIENCY_WARM_RESTART: "1",
    });
    assert.equal(e.SECRET, "kept");
    for (const key of Object.keys(e).filter((k) =>
      k.endsWith("NATIVE_FINAL_TRIAL"),
    ))
      assert.equal(e[key], "0", key);
    assert.equal(
      e.LOOM_CODEX_FINAL_OUTPUT_TRIAL,
      kind === "final-output" ? "1" : "0",
    );
    assert.equal(e.LOOM_OPENCODE_FINAL_OUTPUT_TRIAL, "0");
    assert.equal(e.RAH_EFFICIENCY_WARM_RESTART, "0");
  }
});
test("normalization preserves failed cost and never fabricates complete memory/usage", () => {
  const round = {
    round: 1,
    sessionId: "s",
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:00:03Z",
    exit: 1,
    metrics: { input: 10, cached: 3, uncached: 7, output: 2, generations: 1 },
  };
  const s = normalizeLongStage(round, { native: true, memoryOff: false });
  assert.equal(s.completed, false);
  assert.equal(s.usage.input, 10);
  assert.equal(s.memoryOff, false);
  assert.equal(s.durationSeconds, 3);
  assert.equal(
    normalizeLongStage({ ...round, exit: 0 }, { native: true, memoryOff: true })
      .completed,
    false,
  );
  assert.equal(
    normalizeLongStage(
      { ...round, exit: 0, longStageSucceeded: true },
      { native: true, memoryOff: true },
    ).completed,
    true,
  );
  assert.equal(
    normalizeLongStage({ round: 2 }, { native: false, memoryOff: false }).usage
      .completeness,
    "missing",
  );
});

test("executable --plan permits only version lookup and does not enter provider/catalog", async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "loom-long-plan-"));
  try {
    writeFileSync(
      join(dir, "codex"),
      `#!/bin/sh\necho "$*" >> '${dir}/calls'\nif [ "$#" = 1 ] && [ "$1" = --version ]; then echo 'codex-cli 0.160.0'; else exit 71; fi\n`,
      { mode: 0o700 },
    );
    const r = spawnSync(
      process.execPath,
      ["scripts/test-cli-long-session.mjs", "--plan"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: dir + ":" + process.env.PATH,
          NODE_TEST_CONTEXT: undefined,
        },
        timeout: 10000,
      },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).providerStarted, false);
    assert.equal(readFileSync(join(dir, "calls"), "utf8"), "--version\n");
    const two = spawnSync(
      process.execPath,
      ["scripts/test-cli-long-session.mjs", "--plan", "--final-output-only"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: dir + ":" + process.env.PATH,
          NODE_TEST_CONTEXT: undefined,
        },
        timeout: 10000,
      },
    );
    assert.equal(two.status, 0, two.stderr);
    const twoPlan = JSON.parse(two.stdout);
    assert.equal(twoPlan.providerStarted, false);
    assert.deepEqual(twoPlan.order, ["native", "final-output"]);
    assert.equal(
      readFileSync(join(dir, "calls"), "utf8"),
      "--version\n--version\n",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("identity failure invalidates a measured stage without dropping observed tokens", () => {
  const stage = normalizeLongStage(
    {
      round: 1,
      longStageSucceeded: true,
      metrics: {
        input: 20,
        cached: 5,
        uncached: 15,
        output: 1,
        generations: 1,
      },
    },
    { native: true, memoryOff: true, identityVerified: false },
  );
  assert.equal(stage.completed, false);
  assert.equal(stage.usage.input, 20);
});
test("baseline hash covers declared launch and trial policy", () => {
  const p = longSessionPlan(["--plan"], "codex-cli 0.160.0");
  assert.ok(p.baseline.nativeInvocation.initial.includes("exec"));
  assert.ok(p.baseline.nativeInvocation.resume.includes("<session>"));
  assert.equal(p.baseline.memoryPolicy.scope, "provider-native-auto-memory");
  assert.deepEqual(p.baseline.order, p.order);
  assert.equal(p.baseline.arms["default"].LOOM_CODEX_FINAL_OUTPUT_TRIAL, "0");
  assert.equal(
    p.baseline.arms["final-output"].LOOM_CODEX_FINAL_OUTPUT_TRIAL,
    "1",
  );
  assert.equal(p.baseline.forcedCompaction, false);
});
test("product stage requires post-measurement success and matching complete product usage", () => {
  const r = {
    round: 1,
    longStageSucceeded: true,
    runs: [{ succeeded: true }],
    metrics: {
      input: 10,
      cached: 3,
      uncached: 7,
      output: 2,
      generations: 1,
      productUsage: {
        completeness: "complete",
        gaps: [],
        totals: {
          inputTokens: 10,
          cachedInputTokens: 3,
          outputTokens: 2,
          generations: 1,
        },
      },
    },
  };
  assert.equal(
    normalizeLongStage(r, { native: false, memoryOff: true }).completed,
    true,
  );
  assert.equal(
    normalizeLongStage(
      { ...r, longStageSucceeded: false },
      { native: false, memoryOff: true },
    ).completed,
    false,
  );
  const bad = structuredClone(r);
  bad.metrics.productUsage.totals.inputTokens = 999;
  assert.notEqual(
    normalizeLongStage(bad, { native: false, memoryOff: true }).usage
      .completeness,
    "complete",
  );
});
test("failed identity forbids a summary ratio while preserving observed cost", async () => {
  const { summarizeLongSession } = await import("./long-session-metrics.mjs");
  const r = {
    round: 1,
    sessionId: "s",
    longStageSucceeded: true,
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:00:01Z",
    metrics: { input: 10, cached: 3, uncached: 7, output: 2, generations: 1 },
  };
  const native = normalizeLongStage(r, { native: true, memoryOff: true });
  const bad = normalizeLongStage(r, {
    native: true,
    memoryOff: true,
    identityVerified: false,
  });
  const s = summarizeLongSession({
    arms: { native: { stages: [native] }, product: { stages: [bad] } },
    checkpoints: [1],
    expectedStages: 1,
  });
  assert.equal(s.comparisons.product.total.ratios, null);
  assert.equal(s.arms.product.total.knownObservedTotals.input, 10);
});

test("explicit final-output-only plan selects a distinct two-arm identity without changing workload", () => {
  const old = longSessionPlan(["--plan"], "codex-cli 0.160.0");
  const plan = longSessionPlan(
    ["--plan", "--final-output-only"],
    "codex-cli 0.160.0",
  );
  const paid = longSessionPlan(
    ["--paid", "--final-output-only"],
    "codex-cli 0.160.0",
  );
  assert.deepEqual(plan.order, ["native", "final-output"]);
  assert.deepEqual(Object.keys(plan.baseline.arms), plan.order);
  assert.deepEqual(plan.baseline.order, plan.order);
  assert.notEqual(plan.baseline.identitySha256, old.baseline.identitySha256);
  assert.equal(paid.baseline.identitySha256, plan.baseline.identitySha256);
  assert.equal(paid.mode, "paid");
  for (const key of ["questions", "instructions", "limits"])
    assert.deepEqual(plan[key], old[key]);
  for (const key of [
    "memoryPolicy",
    "nativeInvocation",
    "sourceHashes",
    "workloadId",
  ])
    assert.deepEqual(plan.baseline[key], old.baseline[key]);
  for (const args of [
    ["--final-output-only"],
    ["--final-output-only", "--plan"],
    ["--plan", "--final-output-only", "--final-output-only"],
    ["--plan", "--arms=native,other"],
    ["--plan", "--order=final-output,native"],
    ["--paid", "--default-only"],
  ])
    assert.throws(() => longSessionPlan(args, "codex-cli 0.160.0"));
  assert.throws(() => longArmEnvironment("unknown", {}));
});

test("two-arm summary keeps native pairing and failed final cost without requiring default", async () => {
  const { summarizeLongSession } = await import("./long-session-metrics.mjs");
  const plan = longSessionPlan(
    ["--plan", "--final-output-only"],
    "codex-cli 0.160.0",
  );
  const stage = {
    stage: 1,
    sessionId: "s",
    completed: true,
    memoryOff: true,
    durationSeconds: 1,
    usage: {
      input: 10,
      cached: 3,
      uncached: 7,
      output: 2,
      generations: 1,
      completeness: "complete",
      gaps: [],
    },
  };
  for (const completed of [true, false]) {
    const summary = summarizeLongSession({
      arms: Object.fromEntries(
        plan.order.map((kind) => [
          kind,
          { stages: [{ ...stage, completed: kind === "native" || completed }] },
        ]),
      ),
      checkpoints: [1],
      expectedStages: 1,
    });
    assert.deepEqual(Object.keys(summary.arms), plan.order);
    assert.equal(
      summary.arms["final-output"].total.knownObservedTotals.input,
      10,
    );
    if (completed)
      assert.equal(summary.comparisons["final-output"].total.ratios.input, 1);
    else assert.equal(summary.comparisons["final-output"].total.ratios, null);
  }
});
