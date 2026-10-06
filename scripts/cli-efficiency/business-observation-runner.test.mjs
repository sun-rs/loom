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

test("explicit platform memory isolation is frozen in the plan and unsupported policies fail", async () => {
  const { multiPlan } = await import("../test-cli-multi-channel.mjs");
  const { businessSmokeWorkload } =
    await import("../test-cli-business-smoke.mjs");
  const profile = {
    productArm: "worker-delivery",
    answerPolicy: "business-content",
    workload: businessSmokeWorkload,
    experimentVersion: "memory-proof/v1",
    roundsPerParticipant: 2,
    limits: { perArmInput: 600000, perArmMs: 600000, maxProductRuns: 12 },
  };
  const old = multiPlan(["--plan"], "codex-cli 0.160.0", profile);
  const isolated = multiPlan(["--plan"], "codex-cli 0.160.0", {
    ...profile,
    platformMemoryPolicy: "disabled",
  });
  assert.equal(isolated.platformMemoryPolicy, "disabled");
  assert.notEqual(isolated.baselineIdentity, old.baselineIdentity);
  assert.equal(Object.hasOwn(old, "platformMemoryPolicy"), false);
  assert.throws(
    () =>
      multiPlan(["--plan"], "codex-cli 0.160.0", {
        ...profile,
        platformMemoryPolicy: "prompt-only",
      }),
    /platform memory/i,
  );
});
