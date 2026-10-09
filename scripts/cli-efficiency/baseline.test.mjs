import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { instructions, questions } from "./common.mjs";
import {
  FIXED_WORKLOAD,
  createCostBaseline,
  nativePairEvidence,
} from "./baseline.mjs";

const fixture = () => ({
  config: {
    provider: "codex",
    bindingId: "local:codex-cli/v1:gpt-6-luna",
    model: "gpt-6-luna",
    effort: "low",
    order: ["native", "role-warm"],
  },
  cliVersion: "codex-cli 0.160.0",
  instructions,
  questions,
  snapshot: Object.fromEntries(
    Object.keys(FIXED_WORKLOAD.sourceHashes).map((p) => [
      p,
      execFileSync("git", ["show", `${FIXED_WORKLOAD.sourceRef}:${p}`]),
    ]),
  ),
  nativeInvocation: { initial: ["exec"], resume: ["exec", "resume"] },
  nativePolicy: { args: ["-c", "features.memories=false"], environment: {} },
  memoryPolicy: {
    provider: "codex",
    supported: true,
    status: "supported",
    scope: "provider-native-auto-memory",
    mechanism: "cli-config",
  },
});

test("fixed workload identifies identical experiments without tying identity to implementation commits", () => {
  const input = fixture(),
    a = createCostBaseline(input);
  const b = createCostBaseline({
    ...input,
    codeCommit: "another implementation",
    sourceRef: "different commit with same bytes",
    sourceOverride: true,
    workingTree: { dirty: true },
  });
  assert.equal(a.baselineId, b.baselineId);
  assert.equal(a.identity.workload.id, "p97-direct-review-v1");
  assert.equal(a.identity.delivery.native, "native-final-text");
  assert.equal(a.identity.delivery.loom, "explicit-room-post");
  assert.equal(a.identity.session.rounds, 3);
});

test("workload edits cannot silently keep the canonical baseline", () => {
  const input = fixture();
  assert.throws(
    () =>
      createCostBaseline({
        ...input,
        questions: ["changed", ...questions.slice(1)],
      }),
    /question/i,
  );
  assert.throws(
    () =>
      createCostBaseline({
        ...input,
        instructions: instructions + " new instruction",
      }),
    /instruction/i,
  );
  const snapshot = {
    ...input.snapshot,
    [Object.keys(input.snapshot)[0]]: Buffer.from("changed source"),
  };
  assert.throws(() => createCostBaseline({ ...input, snapshot }), /source/i);
  const custom = createCostBaseline({
    ...input,
    snapshot,
    sourceOverride: true,
  });
  assert.notEqual(custom.baselineId, createCostBaseline(input).baselineId);
  assert.equal(custom.identity.workload.variant, "source-override");
});

test("provider conditions, CLI, native policy, order and restart create distinct baselines", () => {
  const input = fixture(),
    original = createCostBaseline(input).baselineId;
  for (const patch of [
    { cliVersion: "codex-cli 0.161.0" },
    { nativeInvocation: { initial: ["app-server"], resume: ["app-server"] } },
    {
      config: {
        ...input.config,
        model: "gpt-6-sol",
        bindingId: "local:codex-cli/v1:gpt-6-sol",
      },
    },
    { config: { ...input.config, order: ["role-warm", "native"] } },
    {
      nativePolicy: {
        ...input.nativePolicy,
        args: [...input.nativePolicy.args, "--new-isolation"],
      },
    },
    { warmRestart: true },
  ])
    assert.notEqual(
      createCostBaseline({ ...input, ...patch }).baselineId,
      original,
    );
  assert.throws(
    () => createCostBaseline({ ...input, cliVersion: "" }),
    /version/i,
  );
  assert.throws(
    () =>
      createCostBaseline({
        ...input,
        memoryPolicy: {
          ...input.memoryPolicy,
          supported: false,
          status: "unsupported",
        },
      }),
    /memory/i,
  );
});

function nativeArm() {
  return {
    status: "complete",
    rounds: [1, 2, 3].map((round) => ({
      round,
      sessionId: "continuous",
      answer: "审查结论：" + "明确业务答案".repeat(20),
      nativeMemoryPolicy: {
        provider: "codex",
        status: "enforced",
        scope: "provider-native-auto-memory",
        evidence: "spawn-configuration",
      },
      metrics: {
        generations: 1,
        input: 100,
        cached: 50,
        uncached: 50,
        output: 20,
      },
    })),
  };
}

test("a denominator must be this complete native arm with memory enforcement on every round", () => {
  const baseline = createCostBaseline(fixture()),
    native = nativeArm();
  const paired = nativePairEvidence({ baseline, native });
  assert.match(paired.nativeEvidenceSha256, /^[a-f0-9]{64}$/);
  assert.equal(paired.baselineId, baseline.baselineId);
  for (const mutate of [
    (n) => n.rounds.pop(),
    (n) => delete n.rounds[1].nativeMemoryPolicy,
    (n) => (n.rounds[1].nativeMemoryPolicy.status = "supported"),
    (n) => (n.rounds[1].sessionId = "new-session"),
    (n) => (n.rounds[1].metrics.input = null),
    (n) => (n.rounds[1].answer = "received"),
    (n) => (n.status = "failed"),
  ]) {
    const n = structuredClone(native);
    mutate(n);
    assert.throws(() => nativePairEvidence({ baseline, native: n }));
  }
  const changed = structuredClone(native);
  changed.rounds[0].metrics.input = 101;
  changed.rounds[0].metrics.uncached = 51;
  assert.notEqual(
    nativePairEvidence({ baseline, native: changed }).nativeEvidenceSha256,
    paired.nativeEvidenceSha256,
  );
});

test("version-audited providers reject upgrades before either arm and require exact per-spawn audit evidence", async () => {
  const { describeNativeMemoryPolicy } =
    await import("./native-memory-policy.mjs");
  for (const [provider, version] of [
    ["kimi", "0.39.1"],
    ["opencode", "1.18.32"],
    ["opencode", "1.18.35"],
  ]) {
    const input = fixture();
    input.config.provider = provider;
    input.memoryPolicy = describeNativeMemoryPolicy(provider, version);
    input.cliVersion = version;
    assert.throws(
      () => createCostBaseline({ ...input, cliVersion: "999.0.0" }),
      /audit.*version/i,
    );
    const baseline = createCostBaseline(input),
      native = nativeArm();
    for (const round of native.rounds)
      round.nativeMemoryPolicy = {
        ...input.memoryPolicy,
        status: "not-applicable",
        evidence: "audited-cli-version",
      };
    assert.ok(nativePairEvidence({ baseline, native }).nativeEvidenceSha256);
    for (const patch of [
      { version: "999.0.0" },
      { sourceRevision: "invented" },
      { status: "enforced" },
      { evidence: "spawn-configuration" },
    ]) {
      const bad = structuredClone(native);
      Object.assign(bad.rounds[1].nativeMemoryPolicy, patch);
      assert.throws(() => nativePairEvidence({ baseline, native: bad }));
    }
  }
  const baseline = createCostBaseline(fixture()),
    native = nativeArm();
  native.rounds[0].nativeMemoryPolicy.status = "not-applicable";
  assert.throws(() => nativePairEvidence({ baseline, native }));
});

test("native denominator cannot hide unreported native requests behind complete usage records", () => {
  const baseline = createCostBaseline(fixture()),
    native = nativeArm();
  native.rounds[0].metrics.requestCoverage = {
    status: "incomplete",
    requests: 3,
    matchedRequests: 2,
    unreportedRequests: 1,
    unmatchedUsageRecords: 0,
  };
  assert.throws(
    () => nativePairEvidence({ baseline, native }),
    /request.*coverage/i,
  );
});
