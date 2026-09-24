import test from "node:test";
import assert from "node:assert/strict";
import { parseEfficiencyEnv } from "./efficiency-config.mjs";

test("default provider is codex and keeps the historical arms and model", () => {
  const c = parseEfficiencyEnv({});
  assert.equal(c.provider, "codex");
  assert.equal(c.model, "gpt-5.6-luna");
  assert.equal(c.effort, "low");
  assert.equal(c.bindingId, "local:codex-cli/v1:gpt-5.6-luna");
  assert.equal(c.catalogKind, "codex-cli/v1");
  assert.deepEqual(c.order, ["native", "legacy", "role"]);
  assert.equal(c.instructionFile, "AGENTS.md");
  assert.equal(c.productUsage, "required");
  assert.deepEqual(parseEfficiencyEnv({ RAH_EFFICIENCY_WARM: "1" }).order, [
    "native",
    "legacy",
    "role",
    "role-warm",
  ]);
});

test("claude: sonnet/low, role and role-warm against native, CLAUDE.md", () => {
  const c = parseEfficiencyEnv({ RAH_EFFICIENCY_PROVIDER: "claude" });
  assert.equal(c.model, "sonnet");
  assert.equal(c.effort, "low");
  assert.equal(c.bindingId, "local:claude-cli/v1:sonnet");
  assert.deepEqual(c.order, ["native", "role", "role-warm"]);
  assert.equal(c.instructionFile, "CLAUDE.md");
  assert.equal(c.productUsage, "required");
  assert.deepEqual(
    parseEfficiencyEnv({
      RAH_EFFICIENCY_PROVIDER: "claude",
      RAH_EFFICIENCY_ORDER: "role-warm,native",
    }).order,
    ["role-warm", "native"],
  );
});

test("kimi: k3/high, per-turn role only, usage not recorded by the product", () => {
  const c = parseEfficiencyEnv({ RAH_EFFICIENCY_PROVIDER: "kimi" });
  assert.equal(c.model, "kimi-code/k3");
  assert.equal(c.effort, "high");
  assert.equal(c.bindingId, "local:kimi-cli/v1:kimi-code/k3");
  assert.deepEqual(c.order, ["native", "role"]);
  assert.equal(c.productUsage, "not-recorded");
});

test("model and effort overrides accept bare or full binding ids", () => {
  const c = parseEfficiencyEnv({
    RAH_EFFICIENCY_PROVIDER: "claude",
    RAH_EFFICIENCY_MODEL: "local:claude-cli/v1:opus",
    RAH_EFFICIENCY_EFFORT: "medium",
  });
  assert.equal(c.model, "opus");
  assert.equal(c.effort, "medium");
  assert.equal(c.bindingId, "local:claude-cli/v1:opus");
});

test("fails closed on unknown providers, foreign bindings and unsupported arms", () => {
  const bad = [
    { RAH_EFFICIENCY_PROVIDER: "opencode" },
    { RAH_EFFICIENCY_PROVIDER: "" },
    {
      RAH_EFFICIENCY_PROVIDER: "claude",
      RAH_EFFICIENCY_MODEL: "local:codex-cli/v1:gpt-5.6-luna",
    },
    { RAH_EFFICIENCY_PROVIDER: "claude", RAH_EFFICIENCY_EFFORT: "default" },
    { RAH_EFFICIENCY_PROVIDER: "claude", RAH_EFFICIENCY_EFFORT: "turbo" },
    { RAH_EFFICIENCY_MODEL: "bad model" },
    { RAH_EFFICIENCY_PROVIDER: "kimi", RAH_EFFICIENCY_WARM: "1" },
    {
      RAH_EFFICIENCY_PROVIDER: "kimi",
      RAH_EFFICIENCY_ORDER: "native,role-warm",
    },
    { RAH_EFFICIENCY_PROVIDER: "claude", RAH_EFFICIENCY_ORDER: "role" },
  ];
  for (const env of bad)
    assert.throws(
      () => parseEfficiencyEnv(env),
      /Invalid efficiency gate|order/,
      JSON.stringify(env),
    );
});
