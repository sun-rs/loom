import assert from "node:assert/strict";
import test from "node:test";
import { multiInlinePlan } from "../test-cli-multi-channel-inline.mjs";
import { multiLongPlan } from "../test-cli-multi-channel-long.mjs";

test("inline profile has independent identity and bounded 36-stage plan without leaking evaluator answers", () => {
  const p = multiInlinePlan(["--plan"], "codex-cli 0.160.0");
  const old = multiLongPlan(["--plan"], "codex-cli 0.160.0");
  assert.equal(p.experimentVersion, "multi-channel-inline/v1");
  assert.equal(p.stageCount, 36);
  assert.equal(p.roundsPerParticipant, 12);
  assert.deepEqual(p.order, ["native", "final-output"]);
  assert.deepEqual(p.limits, {
    perArmInput: 3600000,
    perArmMs: 2400000,
    maxProductRuns: 36,
  });
  assert.notEqual(p.baselineIdentity, old.baselineIdentity);
  assert.equal(p.validationPolicy.readProofPolicy, "inline-input/v1");
  assert.match(p.validationPolicy.expectedSha256, /^[a-f0-9]{64}$/);
  assert.equal(p.providerStarted, false);
  assert.ok(!JSON.stringify(p).includes('"answer"'));
  assert.throws(() =>
    multiInlinePlan(["--plan", "--paid"], "codex-cli 0.160.0"),
  );
});

test("inline executable plan only performs version lookup", async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "loom-inline-plan-"));
  try {
    writeFileSync(
      join(dir, "codex"),
      `#!/bin/sh\necho "$*" >> '${dir}/calls'\nif [ "$#" = 1 ] && [ "$1" = --version ]; then echo 'codex-cli 0.160.0'; else exit 71; fi\n`,
      { mode: 0o700 },
    );
    const r = spawnSync(
      process.execPath,
      ["scripts/test-cli-multi-channel-inline.mjs", "--plan"],
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
