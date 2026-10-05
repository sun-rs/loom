import assert from "node:assert/strict";
import test from "node:test";
import { businessSmokePlan } from "../test-cli-business-smoke.mjs";
import { multiMcpObservationPlan } from "../test-cli-multi-channel-mcp-observation.mjs";
test("business smoke is product-first bounded six stages per arm with no automatic repeat", () => {
  const p = businessSmokePlan(["--plan"], "codex-cli 0.160.0");
  assert.equal(p.providerStarted, false);
  assert.deepEqual(p.order, ["worker-delivery", "native"]);
  assert.equal(p.stageCount, 6);
  assert.equal(p.roundsPerParticipant, 2);
  assert.equal(p.productArm, "worker-delivery");
  assert.deepEqual(p.limits, {
    perArmInput: 600000,
    perArmMs: 600000,
    maxProductRuns: 12,
  });
  assert.equal(p.answerPolicy, "business-content");
  assert.equal(
    p.validationPolicy.repeatPolicy,
    "one smoke pair only; no automatic repeats",
  );
  assert.equal(
    multiMcpObservationPlan(["--plan"], "codex-cli 0.160.0").baselineIdentity,
    "45103559dfffa51d269112bcbffe41122d62947756626c0247b72c06e4918682",
  );
});
