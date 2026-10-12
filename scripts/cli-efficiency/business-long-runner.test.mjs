// 2026-10-12 owner-approved identity update: only the retired native
// multi_agent=false switch was removed; old paid evidence stays unchanged.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { businessLongPlan } from "../test-cli-business-long.mjs";
import { businessSmokePlan } from "../test-cli-business-smoke.mjs";
import {
  inlineWorkload,
  inlineExpected,
} from "./multi-channel-inline-workload.mjs";
import { longHash } from "./long-session-support.mjs";
const version = "codex-cli 0.160.0";

test("one numbered long pair retains full workload and alternates frozen order", () => {
  const identities = new Set();
  for (let pair = 1; pair <= 4; pair++) {
    const p = businessLongPlan(["--plan", `--pair=${pair}`], version);
    identities.add(p.baselineIdentity);
    assert.equal(p.stageCount, 36);
    assert.equal(p.roundsPerParticipant, 12);
    assert.equal(p.participantCount, 3);
    assert.equal(p.platformMemoryPolicy, "disabled");
    assert.equal(p.steps, longHash(JSON.stringify(inlineWorkload.steps)));
    assert.equal(p.instructions, longHash(inlineWorkload.instructions));
    assert.equal(inlineExpected.length, 12);
    assert.equal(
      p.validationPolicy.expectedSha256,
      longHash(JSON.stringify(inlineExpected)),
    );
    assert.deepEqual(
      p.order,
      pair % 2 ? ["native", "worker-delivery"] : ["worker-delivery", "native"],
    );
    assert.deepEqual(p.limits, {
      perArmInput: 1500000,
      perArmMs: 1200000,
      maxProductRuns: 72,
    });
    assert.equal(p.validationPolicy.study.pairIndex, pair);
    assert.equal(p.validationPolicy.study.plannedPairs, 4);
    assert.equal(p.validationPolicy.study.pairsPerInvocation, 1);
    assert.equal(
      p.validationPolicy.study.authorization,
      "explicit authorization required for each pair; no automatic admission of remaining pairs",
    );
    assert.equal(p.providerStarted, false);
    for (const env of Object.values(p.arms)) {
      assert.equal(env.LOOM_CODEX_FINAL_OUTPUT_TRIAL, "0");
      assert.equal(env.LOOM_OPENCODE_FINAL_OUTPUT_TRIAL, "0");
    }
    assert.equal(
      businessLongPlan(["--paid", `--pair=${pair}`], version).baselineIdentity,
      p.baselineIdentity,
    );
  }
  assert.equal(
    identities.size,
    4,
    "same-order pairs still have distinct identities",
  );
});

test("long entry refuses absent, unknown, duplicated or rearranged arguments", () => {
  for (const args of [
    [],
    ["--plan"],
    ["--pair=1", "--plan"],
    ["--plan", "--pair=0"],
    ["--plan", "--pair=5"],
    ["--plan", "--pair=01"],
    ["--plan", "--pair=1\n"],
    ["--plan", "--pair=all"],
    ["--plan", "--pair=1", "--paid"],
    ["--paid", "--pair=1", "--pair=2"],
    ["--unknown", "--pair=1"],
  ])
    assert.throws(() => businessLongPlan(args, version));
});

test("smoke identity pins the owner-approved native-subagent policy", () => {
  assert.equal(
    businessSmokePlan(["--plan"], version).baselineIdentity,
    "79958d6bc7ecb4e7a875b0366d85b5f06d454256bd3c67f9b4e687097b0380d1",
  );
});

test("long executable plans one pair with only local CLI version access", () => {
  const dir = mkdtempSync(join(tmpdir(), "loom-business-long-plan-"));
  try {
    writeFileSync(
      join(dir, "codex"),
      `#!/bin/sh\necho "$*" >> '${dir}/calls'\nif [ "$#" = 1 ] && [ "$1" = --version ]; then echo '${version}'; else exit 71; fi\n`,
      { mode: 0o700 },
    );
    const r = spawnSync(
      process.execPath,
      ["scripts/test-cli-business-long.mjs", "--plan", "--pair=2"],
      {
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          PATH: dir + ":" + process.env.PATH,
          NODE_TEST_CONTEXT: undefined,
        },
      },
    );
    assert.equal(r.status, 0, r.stderr);
    const p = JSON.parse(r.stdout);
    assert.equal(p.validationPolicy.study.pairIndex, 2);
    assert.equal(p.providerStarted, false);
    assert.equal(readFileSync(join(dir, "calls"), "utf8"), "--version\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
