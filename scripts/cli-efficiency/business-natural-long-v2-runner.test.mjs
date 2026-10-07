import test from "node:test";
import assert from "node:assert/strict";
import { naturalBusinessLongPlan } from "../test-cli-business-natural-long.mjs";
import { naturalBusinessLongV2Plan } from "../test-cli-business-natural-long-v2.mjs";
test("natural v2 explicitly selects correlated retry proof, stdin OpenCode and product-first counterbalance", () => {
  for (let pair = 1; pair <= 4; pair++) {
    const args = ["--plan", `--pair=${pair}`],
      old = naturalBusinessLongPlan(args, "codex-cli 0.160.1"),
      p = naturalBusinessLongV2Plan(args, "codex-cli 0.160.1");
    assert.equal(p.completionPolicy, "canonical-and-ack/v2");
    assert.equal(old.completionPolicy, "canonical-and-ack/v1");
    assert.notEqual(p.baselineIdentity, old.baselineIdentity);
    assert.deepEqual(p.order, [...old.order].reverse());
    assert.deepEqual(p.limits, old.limits);
    assert.equal(p.stageCount, 36);
  }
  const env = { RAH_EFFICIENCY_PROVIDER: "opencode" },
    p = naturalBusinessLongV2Plan(["--plan", "--pair=1"], "1.18.32", env),
    old = naturalBusinessLongPlan(["--plan", "--pair=1"], "1.18.32", env);
  assert.equal(p.nativePromptTransport, "stdin");
  assert.equal(p.nativeInvocationPolicy.inputTransport, "stdin/v1");
  assert.equal(old.nativePromptTransport, undefined);
  for (const args of Object.values(p.nativeInvocation))
    assert.ok(!args.includes("<channel-delta>"));
  assert.ok(old.nativeInvocation.initial.includes("<channel-delta>"));
});
