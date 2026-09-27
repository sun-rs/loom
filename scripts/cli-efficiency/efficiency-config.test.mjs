import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseEfficiencyEnv,
  unmeasuredDimensions,
} from "./efficiency-config.mjs";
import { compareArm, gateStatus } from "./metrics.mjs";

test("default provider is codex: the current approved model, role-warm included", () => {
  const c = parseEfficiencyEnv({});
  assert.equal(c.provider, "codex");
  assert.equal(c.model, "gpt-6-luna");
  assert.equal(c.effort, "low");
  assert.equal(c.bindingId, "local:codex-cli/v1:gpt-6-luna");
  assert.equal(c.catalogKind, "codex-cli/v1");
  // The product runs Codex warm by default, so the default gate measures it.
  assert.deepEqual(c.order, ["native", "legacy", "role", "role-warm"]);
  assert.equal(c.instructionFile, "AGENTS.md");
  assert.equal(c.productUsage, "required");
  assert.deepEqual(parseEfficiencyEnv({ RAH_EFFICIENCY_WARM: "1" }).order, [
    "native",
    "legacy",
    "role",
    "role-warm",
  ]);
  // The 2026-09-09 Codex model stays approved.
  assert.equal(
    parseEfficiencyEnv({ RAH_EFFICIENCY_MODEL: "gpt-5.6-luna" }).model,
    "gpt-5.6-luna",
  );
});

test("claude: haiku without effort by default; sonnet/low stays selectable", () => {
  const c = parseEfficiencyEnv({ RAH_EFFICIENCY_PROVIDER: "claude" });
  assert.equal(c.model, "haiku");
  assert.equal(c.effort, null);
  assert.equal(c.bindingId, "local:claude-cli/v1:haiku");
  assert.deepEqual(c.order, ["native", "role", "role-warm"]);
  assert.equal(c.instructionFile, "CLAUDE.md");
  assert.equal(c.productUsage, "required");
  const sonnet = parseEfficiencyEnv({
    RAH_EFFICIENCY_PROVIDER: "claude",
    RAH_EFFICIENCY_MODEL: "local:claude-cli/v1:sonnet",
    RAH_EFFICIENCY_EFFORT: "low",
  });
  assert.equal(sonnet.model, "sonnet");
  assert.equal(sonnet.effort, "low");
  assert.equal(sonnet.bindingId, "local:claude-cli/v1:sonnet");
  assert.deepEqual(
    parseEfficiencyEnv({
      RAH_EFFICIENCY_PROVIDER: "claude",
      RAH_EFFICIENCY_ORDER: "role-warm,native",
    }).order,
    ["role-warm", "native"],
  );
});

test("kimi: k3-256k/low, per-turn role only, product usage required", () => {
  const c = parseEfficiencyEnv({ RAH_EFFICIENCY_PROVIDER: "kimi" });
  assert.equal(c.model, "kimi-code/k3-256k");
  assert.equal(c.effort, "low");
  assert.equal(c.bindingId, "local:kimi-cli/v1:kimi-code/k3-256k");
  assert.deepEqual(c.order, ["native", "role"]);
  // Full review 2 B-P1-2: the driver records Kimi per-generation usage from
  // the session wire (evo §40); a gap is missing evidence, never exempt.
  assert.equal(c.productUsage, "required");
  assert.equal(
    parseEfficiencyEnv({
      RAH_EFFICIENCY_PROVIDER: "kimi",
      RAH_EFFICIENCY_MODEL: "kimi-code/k3",
      RAH_EFFICIENCY_EFFORT: "high",
    }).model,
    "kimi-code/k3",
  );
});

test("opencode: deepseek-flash/low against its own native CLI, warm and per-turn", () => {
  const c = parseEfficiencyEnv({ RAH_EFFICIENCY_PROVIDER: "opencode" });
  assert.equal(c.model, "deepseek/deepseek-flash");
  assert.equal(c.effort, "low");
  assert.equal(c.catalogKind, "opencode-cli/v1");
  assert.equal(c.bindingId, "local:opencode-cli/v1:deepseek/deepseek-flash");
  assert.deepEqual(c.order, ["native", "role", "role-warm"]);
  assert.equal(c.instructionFile, "AGENTS.md");
  assert.equal(c.productUsage, "required");
});

test("fails closed on combinations outside the approval table", () => {
  const bad = [
    { RAH_EFFICIENCY_MODEL: "gpt-6-sol" },
    { RAH_EFFICIENCY_MODEL: "gpt-6-sol", RAH_EFFICIENCY_EFFORT: "ultra" },
    { RAH_EFFICIENCY_EFFORT: "ultra" },
    { RAH_EFFICIENCY_EFFORT: "high" },
    {
      RAH_EFFICIENCY_PROVIDER: "claude",
      RAH_EFFICIENCY_MODEL: "opus",
      RAH_EFFICIENCY_EFFORT: "max",
    },
    {
      RAH_EFFICIENCY_PROVIDER: "claude",
      RAH_EFFICIENCY_MODEL: "sonnet",
      RAH_EFFICIENCY_EFFORT: "max",
    },
    {
      RAH_EFFICIENCY_PROVIDER: "claude",
      RAH_EFFICIENCY_MODEL: "fable",
      RAH_EFFICIENCY_EFFORT: "low",
    },
    {
      RAH_EFFICIENCY_PROVIDER: "kimi",
      RAH_EFFICIENCY_MODEL: "kimi-code/k3",
      RAH_EFFICIENCY_EFFORT: "max",
    },
    { RAH_EFFICIENCY_PROVIDER: "kimi", RAH_EFFICIENCY_EFFORT: "high" },
    { RAH_EFFICIENCY_PROVIDER: "opencode", RAH_EFFICIENCY_EFFORT: "max" },
    {
      RAH_EFFICIENCY_PROVIDER: "opencode",
      RAH_EFFICIENCY_MODEL: "deepseek/deepseek-v4-pro",
    },
  ];
  for (const env of bad)
    assert.throws(
      () => parseEfficiencyEnv(env),
      /Invalid efficiency gate configuration: .*Unapproved paid gate model/,
      JSON.stringify(env),
    );
});

test("fails closed on unknown providers, foreign bindings and unsupported arms", () => {
  const bad = [
    { RAH_EFFICIENCY_PROVIDER: "gemini" },
    { RAH_EFFICIENCY_PROVIDER: "" },
    {
      RAH_EFFICIENCY_PROVIDER: "claude",
      RAH_EFFICIENCY_MODEL: "local:codex-cli/v1:gpt-6-luna",
    },
    { RAH_EFFICIENCY_EFFORT: "default" },
    { RAH_EFFICIENCY_PROVIDER: "claude", RAH_EFFICIENCY_EFFORT: "turbo" },
    { RAH_EFFICIENCY_MODEL: "bad model" },
    { RAH_EFFICIENCY_PROVIDER: "kimi", RAH_EFFICIENCY_WARM: "1" },
    {
      RAH_EFFICIENCY_PROVIDER: "kimi",
      RAH_EFFICIENCY_ORDER: "native,role-warm",
    },
    // Kimi runs per turn: nothing to prewarm.
    {
      RAH_EFFICIENCY_PROVIDER: "kimi",
      RAH_EFFICIENCY_ORDER: "native,role,role-prewarm",
    },
    { RAH_EFFICIENCY_PROVIDER: "claude", RAH_EFFICIENCY_ORDER: "role" },
    // Effortless haiku requires "none"; an effort binding never takes it.
    { RAH_EFFICIENCY_PROVIDER: "claude", RAH_EFFICIENCY_EFFORT: "low" },
    {
      RAH_EFFICIENCY_PROVIDER: "claude",
      RAH_EFFICIENCY_MODEL: "sonnet",
      RAH_EFFICIENCY_EFFORT: "none",
    },
    {
      RAH_EFFICIENCY_PROVIDER: "opencode",
      RAH_EFFICIENCY_ORDER: "native,legacy",
    },
  ];
  for (const env of bad)
    assert.throws(
      () => parseEfficiencyEnv(env),
      /Invalid efficiency gate|order/,
      JSON.stringify(env),
    );
});

// Owner 2026-09-27: the prewarmed first round is an opt-in arm of the warm
// runtimes, beside (never instead of) the cold role-warm arm.
test("role-prewarm is an opt-in arm for Codex, Claude and OpenCode", () => {
  for (const provider of ["codex", "claude", "opencode"]) {
    const env = {
      RAH_EFFICIENCY_PROVIDER: provider,
      RAH_EFFICIENCY_ORDER: "native,role-warm,role-prewarm",
      ...(provider === "claude" ? { RAH_EFFICIENCY_EFFORT: "none" } : {}),
    };
    assert.deepEqual(parseEfficiencyEnv(env).order, [
      "native",
      "role-warm",
      "role-prewarm",
    ]);
    assert.ok(
      !parseEfficiencyEnv({
        RAH_EFFICIENCY_PROVIDER: provider,
        ...(provider === "claude" ? { RAH_EFFICIENCY_EFFORT: "none" } : {}),
      }).order.includes("role-prewarm"),
      `${provider}: not a default arm`,
    );
  }
});

// Full review 2 B-P1-2: the committed Kimi run recorded complete product
// usage every round, yet the old exemption forced missing-evidence. With the
// product usage required nothing is unmeasured and the arm gets a budget
// verdict; missing product usage fails as evidence.
test("kimi evidence: complete product usage is judged, a gap is missing evidence", () => {
  const evidence = JSON.parse(
    readFileSync(
      new URL(
        "../../docs/evo/evidence/2026-09-27-eff-kimi.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const config = parseEfficiencyEnv({ RAH_EFFICIENCY_PROVIDER: "kimi" });
  const nat = evidence.arms.native.rounds.map((r) => r.metrics);
  const rah = evidence.arms.role.rounds.map((r) => r.metrics);
  const unmeasured = unmeasuredDimensions(config, [...nat, ...rah]);
  assert.deepEqual(unmeasured, []);
  const arms = { native: { status: "complete" }, role: { status: "complete" } };
  const judged = compareArm(nat, rah, { unmeasured });
  assert.deepEqual(judged.unmeasured, []);
  assert.ok(
    judged.rounds.every((r) => r.usageEvidence.completeness === "complete"),
  );
  // A budget verdict (the recorded latency is over budget), not an exemption.
  assert.equal(
    gateStatus({ arms, comparisons: { role: judged } }).status,
    "over-budget",
  );
  // Missing product usage is never exempt: with the latency excess removed
  // it alone decides the verdict.
  const gap = compareArm(
    nat,
    rah.map((m, i) => ({
      ...m,
      productUsage: undefined,
      replySeconds: nat[i].replySeconds,
    })),
    { unmeasured },
  );
  assert.ok(
    gap.rounds.every((r) => r.failures.includes("usageEvidenceMissing")),
  );
  assert.equal(gap.measuredStatus, "missing-evidence");
  assert.equal(
    gateStatus({ arms, comparisons: { role: gap } }).status,
    "failed",
  );
});
