import test from "node:test";
import assert from "node:assert/strict";
import { businessLongPlan } from "../test-cli-business-long.mjs";
import { naturalBusinessLongPlan } from "../test-cli-business-natural-long.mjs";
test("natural observation is explicit new identity with unchanged task, resource caps and one pair only", () => {
  for (let pair = 1; pair <= 4; pair++) {
    const args = ["--plan", `--pair=${pair}`],
      strict = businessLongPlan(args, "codex-cli 0.160.0"),
      natural = naturalBusinessLongPlan(args, "codex-cli 0.160.0");
    assert.notEqual(natural.baselineIdentity, strict.baselineIdentity);
    assert.equal(strict.completionPolicy, undefined);
    assert.equal(natural.completionPolicy, "canonical-and-ack/v1");
    assert.equal(
      natural.experimentVersion,
      "business-observation-natural-long/v1",
    );
    assert.equal(natural.steps, strict.steps);
    assert.deepEqual(natural.limits, strict.limits);
    assert.deepEqual(natural.order, strict.order);
    assert.equal(natural.validationPolicy.study.pairsPerInvocation, 1);
    assert.equal(natural.stageCount, 36);
  }
  assert.throws(() =>
    naturalBusinessLongPlan(["--paid", "--pair=5"], "codex-cli 0.160.0"),
  );
  const p = naturalBusinessLongPlan(["--plan", "--pair=1"], "1.18.32", {
    RAH_EFFICIENCY_PROVIDER: "opencode",
  });
  assert.equal(p.config.provider, "opencode");
});
