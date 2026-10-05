import assert from "node:assert/strict";
import test from "node:test";
import { multiMcpPlan } from "../test-cli-multi-channel-mcp.mjs";
import { multiPlan } from "../test-cli-multi-channel.mjs";
import { multiInlinePlan } from "../test-cli-multi-channel-inline.mjs";
import { multiLongPlan } from "../test-cli-multi-channel-long.mjs";

test("MCP inline profile is separately registered with candidate flags disabled", () => {
  const p = multiMcpPlan(["--plan"], "codex-cli 0.160.0");
  assert.equal(p.experimentVersion, "multi-channel-mcp-inline/v1");
  assert.equal(p.productArm, "worker-mcp");
  assert.deepEqual(p.order, ["native", "worker-mcp"]);
  assert.equal(p.stageCount, 36);
  assert.equal(p.roundsPerParticipant, 12);
  for (const env of Object.values(p.arms)) {
    assert.equal(env.LOOM_CODEX_FINAL_OUTPUT_TRIAL, "0");
    assert.equal(env.LOOM_OPENCODE_FINAL_OUTPUT_TRIAL, "0");
  }
  assert.equal(p.validationPolicy.replyProof, "single-mcp-final-reply");
  assert.equal(
    p.validationPolicy.reportedGenerations,
    "retain actual positive counts; judge contract without discarding follow-up cost",
  );
  assert.equal("reportedGenerationsPerStage" in p.validationPolicy, false);
  assert.equal(p.validationPolicy.readProofPolicy, "inline-input/v1");
  assert.equal(p.providerStarted, false);
  assert.deepEqual(p.limits, {
    perArmInput: 3600000,
    perArmMs: 2400000,
    maxProductRuns: 36,
  });
  assert.equal(p.steps, multiInlinePlan(["--plan"], "codex-cli 0.160.0").steps);
  assert.ok(!JSON.stringify(p).includes('"answer"'));
  assert.throws(() => multiMcpPlan(["--paid", "--plan"], "codex-cli 0.160.0"));
});
test("existing profiles retain their exact baseline identities", () => {
  assert.deepEqual(
    [multiPlan, multiInlinePlan, multiLongPlan].map(
      (f) => f(["--plan"], "codex-cli 0.160.0").baselineIdentity,
    ),
    [
      "348f47792f5f22fda10193562f558ccfcb77576c735fd73141ede0a38332a42c",
      "6701d39611ff38c41512a69cdb9988b75f1a9024ace38fd7246b1047b7199056",
      "4a89cd04ce54b1f7f03429118fb13813f3c194d0279741f963293b76328e9ab9",
    ],
  );
});

test("MCP plan executable only requests local CLI version", async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "loom-mcp-plan-"));
  try {
    writeFileSync(
      join(dir, "codex"),
      `#!/bin/sh\necho "$*" >> '${dir}/calls'\nif [ "$#" = 1 ] && [ "$1" = --version ]; then echo 'codex-cli 0.160.0'; else exit 71; fi\n`,
      { mode: 0o700 },
    );
    const r = spawnSync(
      process.execPath,
      ["scripts/test-cli-multi-channel-mcp.mjs", "--plan"],
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
