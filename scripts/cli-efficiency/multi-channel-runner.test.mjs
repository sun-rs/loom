import assert from "node:assert/strict";
import test from "node:test";
import { multiPlan, validateMultiHistory } from "../test-cli-multi-channel.mjs";

test("multichannel plan is fixed and rejects extra paid/model choices before invocation", () => {
  const p = multiPlan(["--plan"], "codex-cli 0.160.0");
  assert.equal(p.providerStarted, false);
  assert.deepEqual(p.order, ["native", "final-output"]);
  assert.equal(p.stageCount, 12);
  assert.equal(p.config.model, "gpt-6-luna");
  assert.equal(p.config.effort, "low");
  assert.equal(p.autonomousAdmission, "requires-separate-four-gate-review");
  assert.match(p.historyPolicy, /independent/);
  for (const args of [[], ["--paid", "--paid"], ["--plan", "--model=other"]])
    assert.throws(() => multiPlan(args, "codex-cli 0.160.0"));
  assert.throws(() => multiPlan(["--paid"], "codex-cli next"));
});

test("identity validation rejects shared sessions and missing memory even when costs exist", () => {
  const arm = {
    rounds: ["a", "b", "c", "a"].map((speaker, i) => ({
      speaker,
      round: i + 1,
      sessionId: `s-${speaker}`,
      longStageSucceeded: true,
      actualMemoryOff: true,
      actualIdentityVerified: true,
      actualWorkspaceVerified: true,
      metrics: { input: 10, cached: 2, uncached: 8, output: 2, generations: 1 },
    })),
  };
  assert.doesNotThrow(() => validateMultiHistory(arm));
  assert.throws(
    () =>
      validateMultiHistory({
        rounds: [{ ...arm.rounds[0], actualWorkspaceVerified: false }],
      }),
    /workspace/,
  );
  assert.throws(
    () => validateMultiHistory({ ...arm, kind: "final-output" }),
    /product usage/,
  );
  assert.throws(
    () =>
      validateMultiHistory({
        rounds: [{ ...arm.rounds[0], actualIdentityVerified: false }],
      }),
    /identity/,
  );
  assert.throws(
    () =>
      validateMultiHistory({
        rounds: arm.rounds.map((r) => ({ ...r, sessionId: "same" })),
      }),
    /share/,
  );
  assert.throws(
    () =>
      validateMultiHistory({
        rounds: [{ ...arm.rounds[0], actualMemoryOff: false }],
      }),
    /memory/,
  );
  assert.throws(
    () =>
      validateMultiHistory({
        rounds: [{ ...arm.rounds[0], longStageSucceeded: false }],
      }),
    /Incomplete/,
  );
  assert.throws(
    () =>
      validateMultiHistory({
        rounds: [
          {
            ...arm.rounds[0],
            metrics: { ...arm.rounds[0].metrics, uncached: 9 },
          },
        ],
      }),
    /usage/,
  );
});

test("executable free plan never probes a catalog or starts any model", async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const root = mkdtempSync(join(tmpdir(), "loom-multi-plan-only-"));
  try {
    writeFileSync(
      join(root, "codex"),
      `#!/usr/bin/env node\nimport{appendFileSync}from'node:fs';appendFileSync(${JSON.stringify(join(root, "calls"))},JSON.stringify(process.argv.slice(2))+'\\n');if(process.argv.length===3&&process.argv[2]==='--version')console.log('codex-cli 0.160.0');else process.exit(71);\n`,
      { mode: 0o700 },
    );
    const result = spawnSync(
      process.execPath,
      ["scripts/test-cli-multi-channel.mjs", "--plan"],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: root + ":" + process.env.PATH },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).providerStarted, false);
    assert.deepEqual(
      readFileSync(join(root, "calls"), "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse),
      [["--version"]],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("new plan identifies the AGENTS-only business carrier and retains reference overhead", () => {
  const p = multiPlan(["--plan"], "codex-cli 0.160.0");
  assert.equal(p.experimentVersion, "multi-channel/v2");
  assert.deepEqual(p.instructionPolicy, {
    id: "workspace-agents-business-only/v2",
    businessCarrier: "workspace/AGENTS.md in both arms",
    roleInstructions: "Follow the workspace AGENTS.md.",
    roleReferenceCost: "retained in product raw usage",
  });
  assert.notEqual(
    p.baselineIdentity,
    "ee165964664ebcb6093c489ca2667e4eaaa3ee38f119d921ec8f54cae9d16294",
  );
  assert.equal(p.providerStarted, false);
});
