import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { NATIVE_MEMORY_VERSION_AUDITS } from "./native-memory-version.mjs";
import { isEffectiveAnswer } from "./metrics.mjs";

// P97's direct-answer workload. Product HEAD is deliberately NOT the question
// snapshot: a backend fix must not silently change the experiment's denominator.
export const FIXED_WORKLOAD = Object.freeze({
  id: "p97-direct-review-v1",
  sourceRef: "4b8e7e5897e024fbe17dc08fbcf5beb556e5ee6b",
  instructionsSha256:
    "f4c367df91c230e5bb69dc4841053b0451a6910dbb904aa00c92fff0d227213c",
  questionsSha256:
    "990900ed483b97932456e6dd68f2d52b76cca2f760ff045629ff72c8537a26b0",
  sourceHashes: Object.freeze({
    "scripts/workbench-launch-receipt.mjs":
      "3a3172ea85a970ff74eb410ef5c8aee4673e2d94037c9d4a77b67a02efbb5059",
    "scripts/workbench-launch-receipt.test.mjs":
      "10bdfcbfe0512dfd9e877d7f0609981cd21131a392a7c9a8853563b00bb12fd2",
  }),
});
const sha = (value) => createHash("sha256").update(value).digest("hex");
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  return value;
}
const digest = (value) => sha(JSON.stringify(stable(value)));

export function createCostBaseline({
  config,
  cliVersion,
  instructions,
  questions,
  snapshot,
  nativePolicy,
  nativeInvocation,
  memoryPolicy,
  sourceOverride = false,
  warmRestart = false,
}) {
  assert.equal(
    sha(instructions),
    FIXED_WORKLOAD.instructionsSha256,
    "Business instructions changed: version the fixed workload explicitly",
  );
  assert.equal(
    sha(JSON.stringify(questions)),
    FIXED_WORKLOAD.questionsSha256,
    "Questions changed: version the fixed workload explicitly",
  );
  assert.ok(
    typeof cliVersion === "string" && cliVersion.trim(),
    "CLI version is required",
  );
  assert.ok(
    memoryPolicy?.supported === true &&
      memoryPolicy.provider === config.provider,
    "Native memory-off policy is not verified for this provider",
  );
  const audit = NATIVE_MEMORY_VERSION_AUDITS[config.provider];
  if (audit) {
    assert.equal(
      cliVersion,
      audit.version,
      "Native audited CLI version differs",
    );
    assert.equal(
      memoryPolicy.version,
      audit.version,
      "Native audit version missing",
    );
    assert.equal(
      memoryPolicy.sourceRevision,
      audit.sourceRevision,
      "Native audit source differs",
    );
  }
  assert.ok(
    nativePolicy &&
      Array.isArray(nativePolicy.args) &&
      nativePolicy.environment,
    "Native launch isolation policy is required",
  );
  assert.ok(
    nativeInvocation?.initial && nativeInvocation?.resume,
    "Native invocation shape is required",
  );
  const sourceHashes = Object.fromEntries(
    Object.entries(snapshot).map(([path, body]) => [path, sha(body)]),
  );
  assert.deepEqual(
    Object.keys(sourceHashes).sort(),
    Object.keys(FIXED_WORKLOAD.sourceHashes).sort(),
    "Source inventory changed",
  );
  if (!sourceOverride)
    assert.deepEqual(
      sourceHashes,
      FIXED_WORKLOAD.sourceHashes,
      "Source changed: use an explicit snapshot override, with a distinct baseline",
    );
  const identity = {
    workload: {
      id: FIXED_WORKLOAD.id,
      variant:
        digest(sourceHashes) === digest(FIXED_WORKLOAD.sourceHashes)
          ? "canonical"
          : "source-override",
      sourceHashes,
      instructionsSha256: FIXED_WORKLOAD.instructionsSha256,
      questionsSha256: FIXED_WORKLOAD.questionsSha256,
    },
    delivery: {
      native: "native-final-text",
      loom: "explicit-room-post",
      successfulAnswer:
        "review-prefix-and-80-characters; human-quality-review-required",
      final: "explicit-only; never infer completion from stdout",
    },
    session: {
      rounds: questions.length,
      continuity: "one-session-per-arm",
      order: config.order,
      warmRestart,
      prewarm: config.order.includes("role-prewarm"),
      forcedCompaction: false,
    },
    runtime: {
      provider: config.provider,
      bindingId: config.bindingId,
      model: config.model,
      effort: config.effort,
      cliVersion,
    },
    nativePolicy: { ...nativePolicy, memoryPolicy },
    nativeInvocation,
    sampling: {
      order: config.order,
      cacheControl: "uncontrolled-record-observed-hits",
      automaticPaidRerun: false,
    },
  };
  return {
    schemaVersion: 1,
    baselineId: digest(identity),
    identity,
    limits: [
      "Same identity is necessary, not proof of equal quality or server-side model revision",
      "Never substitute a historical native denominator",
      "Memory evidence certifies launch configuration, not OS filesystem isolation",
    ],
  };
}

/** Only this sample's fully measured, memory-disabled native arm is a denominator. */
export function nativePairEvidence({ baseline, native }) {
  assert.equal(native?.status, "complete", "Native arm incomplete");
  assert.equal(
    native.rounds.length,
    baseline.identity.session.rounds,
    "Native round count differs",
  );
  const session = native.rounds[0]?.sessionId;
  assert.ok(
    typeof session === "string" && session,
    "Native session evidence missing",
  );
  for (const [index, round] of native.rounds.entries()) {
    assert.equal(round.round, index + 1, "Native round order differs");
    assert.equal(round.sessionId, session, "Native session changed");
    assert.ok(
      isEffectiveAnswer(round.answer),
      "Native effective delivery missing",
    );
    const policy = round.nativeMemoryPolicy;
    const audit =
      NATIVE_MEMORY_VERSION_AUDITS[baseline.identity.runtime.provider];
    assert.equal(
      policy?.provider,
      baseline.identity.runtime.provider,
      "Native memory provider differs",
    );
    assert.equal(policy?.scope, "provider-native-auto-memory");
    if (audit) {
      assert.equal(
        policy.status,
        "not-applicable",
        "Native version audit evidence missing",
      );
      assert.equal(policy.evidence, "audited-cli-version");
      assert.equal(policy.version, audit.version);
      assert.equal(policy.version, baseline.identity.runtime.cliVersion);
      assert.equal(policy.sourceRevision, audit.sourceRevision);
    } else {
      assert.equal(
        policy?.status,
        "enforced",
        "Native memory-off enforcement missing",
      );
      assert.equal(policy.evidence, "spawn-configuration");
    }
    assert.ok(
      round.metrics?.requestCoverage === undefined ||
        round.metrics.requestCoverage.status === "complete",
      "Native request coverage incomplete",
    );
    for (const field of [
      "generations",
      "input",
      "cached",
      "uncached",
      "output",
    ])
      assert.ok(
        typeof round.metrics?.[field] === "number" &&
          Number.isFinite(round.metrics[field]) &&
          round.metrics[field] >= 0,
        `Native usage missing: ${field}`,
      );
    assert.ok(
      round.metrics.generations > 0,
      "Native generation evidence missing",
    );
    assert.equal(
      round.metrics.cached + round.metrics.uncached,
      round.metrics.input,
      "Native usage totals differ",
    );
  }
  return {
    baselineId: baseline.baselineId,
    nativeEvidenceSha256: digest(native),
    rounds: native.rounds.length,
    source: "this-sample-native-arm",
  };
}
