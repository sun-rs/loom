import test from "node:test";
import assert from "node:assert/strict";
import { parseDriftEnv } from "./drift-config.mjs";

const base = {
  RAH_DRIFT_PROVIDER: "codex",
  RAH_DRIFT_MODEL: "gpt-6-luna",
  RAH_DRIFT_EFFORT: "low",
};

test("defaults: cold, 20 rounds, compaction after 8 and 15", () => {
  const c = parseDriftEnv(base);
  assert.equal(c.mode, "cold");
  assert.equal(c.rounds, 20);
  assert.deepEqual(c.compactAt, [8, 15]);
  assert.equal(c.bindingId, "local:codex-cli/v1:gpt-6-luna");
  assert.equal(c.catalogKind, "codex-cli/v1");
});

test("accepts the full binding id and derives the model id", () => {
  const c = parseDriftEnv({
    RAH_DRIFT_PROVIDER: "kimi",
    RAH_DRIFT_MODEL: "local:kimi-cli/v1:kimi-code/k3-256k",
    RAH_DRIFT_EFFORT: "low",
  });
  assert.equal(c.model, "kimi-code/k3-256k");
  assert.equal(c.bindingId, "local:kimi-cli/v1:kimi-code/k3-256k");
});

test("fails closed on missing or ambiguous parameters", () => {
  const bad = [
    { ...base, RAH_DRIFT_PROVIDER: "opencode" },
    {
      RAH_DRIFT_PROVIDER: "claude",
      RAH_DRIFT_MODEL: "sonnet",
      RAH_DRIFT_EFFORT: "turbo",
    },
    {
      RAH_DRIFT_PROVIDER: "claude",
      RAH_DRIFT_MODEL: "local:codex-cli/v1:gpt-5.6-luna",
      RAH_DRIFT_EFFORT: "low",
    },
    { ...base, RAH_DRIFT_MODEL: undefined },
    { ...base, RAH_DRIFT_EFFORT: undefined },
    { ...base, RAH_DRIFT_EFFORT: "default" },
    { ...base, RAH_DRIFT_MODEL: "local:kimi-cli/v1:kimi-code/k3" },
    { ...base, RAH_DRIFT_PROVIDER: "kimi", RAH_DRIFT_MODE: "warm" },
    { ...base, RAH_DRIFT_MODE: "hot" },
    { ...base, RAH_DRIFT_ROUNDS: "3" },
    { ...base, RAH_DRIFT_ROUNDS: "2x" },
    { ...base, RAH_DRIFT_COMPACT_AT: "15,8" },
    { ...base, RAH_DRIFT_COMPACT_AT: "20" },
    { ...base, RAH_DRIFT_COMPACT_AT: "a" },
  ];
  for (const env of bad)
    assert.throws(
      () => parseDriftEnv(env),
      /Invalid drift gate/,
      JSON.stringify(env),
    );
});

test("warm is accepted for codex only", () => {
  assert.equal(parseDriftEnv({ ...base, RAH_DRIFT_MODE: "warm" }).mode, "warm");
});

test("claude: warm and cold, claude-cli binding, Claude effort levels", () => {
  const env = {
    RAH_DRIFT_PROVIDER: "claude",
    RAH_DRIFT_MODEL: "sonnet",
    RAH_DRIFT_EFFORT: "low",
  };
  const cold = parseDriftEnv(env);
  assert.equal(cold.mode, "cold");
  assert.equal(cold.catalogKind, "claude-cli/v1");
  assert.equal(cold.bindingId, "local:claude-cli/v1:sonnet");
  assert.equal(parseDriftEnv({ ...env, RAH_DRIFT_MODE: "warm" }).mode, "warm");
});

test("claude haiku: RAH_DRIFT_EFFORT=none yields a null effort, cold and warm", () => {
  const env = {
    RAH_DRIFT_PROVIDER: "claude",
    RAH_DRIFT_MODEL: "haiku",
    RAH_DRIFT_EFFORT: "none",
  };
  const cold = parseDriftEnv(env);
  assert.equal(cold.effort, null);
  assert.equal(cold.model, "haiku");
  assert.equal(cold.bindingId, "local:claude-cli/v1:haiku");
  assert.equal(parseDriftEnv({ ...env, RAH_DRIFT_MODE: "warm" }).mode, "warm");
  assert.equal(
    parseDriftEnv({ ...env, RAH_DRIFT_MODEL: "local:claude-cli/v1:haiku" })
      .effort,
    null,
  );
});

test("effort none is fail-closed: only for the effortless Claude binding, which requires it", () => {
  const bad = [
    // Haiku with an explicit effort, or without any effort value.
    {
      RAH_DRIFT_PROVIDER: "claude",
      RAH_DRIFT_MODEL: "haiku",
      RAH_DRIFT_EFFORT: "low",
    },
    { RAH_DRIFT_PROVIDER: "claude", RAH_DRIFT_MODEL: "haiku" },
    {
      RAH_DRIFT_PROVIDER: "claude",
      RAH_DRIFT_MODEL: "haiku",
      RAH_DRIFT_EFFORT: "default",
    },
    // Other Claude models still need an explicit effort.
    {
      RAH_DRIFT_PROVIDER: "claude",
      RAH_DRIFT_MODEL: "sonnet",
      RAH_DRIFT_EFFORT: "none",
    },
    { RAH_DRIFT_PROVIDER: "claude", RAH_DRIFT_MODEL: "sonnet" },
    // Other providers never accept none.
    { ...base, RAH_DRIFT_EFFORT: "none" },
    {
      RAH_DRIFT_PROVIDER: "opencode",
      RAH_DRIFT_MODEL: "deepseek/deepseek-flash",
      RAH_DRIFT_EFFORT: "none",
    },
  ];
  for (const env of bad)
    assert.throws(
      () => parseDriftEnv(env),
      /Invalid drift gate/,
      JSON.stringify(env),
    );
});

test("opencode: cold and warm, opencode-cli binding, provider/model ids", () => {
  const env = {
    RAH_DRIFT_PROVIDER: "opencode",
    RAH_DRIFT_MODEL: "deepseek/deepseek-flash",
    RAH_DRIFT_EFFORT: "low",
  };
  const cold = parseDriftEnv(env);
  assert.equal(cold.mode, "cold");
  assert.equal(cold.catalogKind, "opencode-cli/v1");
  assert.equal(cold.model, "deepseek/deepseek-flash");
  assert.equal(cold.effort, "low");
  assert.equal(cold.bindingId, "local:opencode-cli/v1:deepseek/deepseek-flash");
  assert.equal(parseDriftEnv({ ...env, RAH_DRIFT_MODE: "warm" }).mode, "warm");
  assert.equal(
    parseDriftEnv({
      ...env,
      RAH_DRIFT_MODEL: "local:opencode-cli/v1:deepseek/deepseek-flash",
    }).model,
    "deepseek/deepseek-flash",
  );
  const bad = [
    { ...env, RAH_DRIFT_MODEL: "deepseek-flash" },
    { ...env, RAH_DRIFT_MODEL: "local:claude-cli/v1:haiku" },
    { ...env, RAH_DRIFT_EFFORT: undefined },
    { ...env, RAH_DRIFT_EFFORT: "default" },
    { ...env, RAH_DRIFT_MODE: "hot" },
  ];
  for (const b of bad)
    assert.throws(
      () => parseDriftEnv(b),
      /Invalid drift gate/,
      JSON.stringify(b),
    );
});

test("fails closed on combinations outside the approval table", () => {
  const bad = [
    { ...base, RAH_DRIFT_MODEL: "gpt-6.1-sol" },
    { ...base, RAH_DRIFT_MODEL: "gpt-5.6-sol", RAH_DRIFT_EFFORT: "ultra" },
    { ...base, RAH_DRIFT_EFFORT: "ultra" },
    { ...base, RAH_DRIFT_EFFORT: "high" },
    {
      RAH_DRIFT_PROVIDER: "claude",
      RAH_DRIFT_MODEL: "opus",
      RAH_DRIFT_EFFORT: "max",
    },
    {
      RAH_DRIFT_PROVIDER: "claude",
      RAH_DRIFT_MODEL: "sonnet",
      RAH_DRIFT_EFFORT: "max",
    },
    {
      RAH_DRIFT_PROVIDER: "claude",
      RAH_DRIFT_MODEL: "fable",
      RAH_DRIFT_EFFORT: "low",
    },
    {
      RAH_DRIFT_PROVIDER: "kimi",
      RAH_DRIFT_MODEL: "kimi-code/k3",
      RAH_DRIFT_EFFORT: "max",
    },
    {
      RAH_DRIFT_PROVIDER: "kimi",
      RAH_DRIFT_MODEL: "kimi-code/k3-256k",
      RAH_DRIFT_EFFORT: "high",
    },
    {
      RAH_DRIFT_PROVIDER: "opencode",
      RAH_DRIFT_MODEL: "deepseek/deepseek-v4-pro",
      RAH_DRIFT_EFFORT: "low",
    },
  ];
  for (const env of bad)
    assert.throws(
      () => parseDriftEnv(env),
      /Invalid drift gate configuration: .*Unapproved paid gate model/,
      JSON.stringify(env),
    );
  // Both 2026-09-09 and 2026-09-25 approvals parse.
  for (const env of [
    { ...base, RAH_DRIFT_MODEL: "gpt-5.6-luna" },
    {
      RAH_DRIFT_PROVIDER: "kimi",
      RAH_DRIFT_MODEL: "kimi-code/k3",
      RAH_DRIFT_EFFORT: "high",
    },
    {
      RAH_DRIFT_PROVIDER: "opencode",
      RAH_DRIFT_MODEL: "deepseek/deepseek-v4-flash",
      RAH_DRIFT_EFFORT: "low",
    },
  ])
    assert.doesNotThrow(() => parseDriftEnv(env), JSON.stringify(env));
});

test("owner B: the compaction overhead rise threshold defaults to 25% and is adjustable", () => {
  assert.equal(parseDriftEnv(base).overheadRise, 0.25);
  assert.equal(
    parseDriftEnv({ ...base, RAH_DRIFT_OVERHEAD_RISE: "0.4" }).overheadRise,
    0.4,
  );
  for (const v of ["0", "-0.1", "abc", "", "11"])
    assert.throws(
      () => parseDriftEnv({ ...base, RAH_DRIFT_OVERHEAD_RISE: v }),
      /RAH_DRIFT_OVERHEAD_RISE/,
    );
});

test("an empty RAH_DRIFT_COMPACT_AT runs without forced compaction (short smoke)", () => {
  const c = parseDriftEnv({
    ...base,
    RAH_DRIFT_ROUNDS: "6",
    RAH_DRIFT_COMPACT_AT: "",
  });
  assert.equal(c.rounds, 6);
  assert.deepEqual(c.compactAt, []);
  assert.deepEqual(
    parseDriftEnv({ ...base, RAH_DRIFT_ROUNDS: "6", RAH_DRIFT_COMPACT_AT: " " })
      .compactAt,
    [],
  );
});

test("RAH_DRIFT_ATTACH: opt-in attached-directory check, off by default", () => {
  assert.equal(parseDriftEnv(base).attach, false);
  assert.equal(parseDriftEnv({ ...base, RAH_DRIFT_ATTACH: "0" }).attach, false);
  const c = parseDriftEnv({
    ...base,
    RAH_DRIFT_ATTACH: "1",
    RAH_DRIFT_ROUNDS: "6",
    RAH_DRIFT_COMPACT_AT: "",
  });
  assert.equal(c.attach, true);
  for (const value of ["yes", "true", "2", ""])
    assert.throws(
      () => parseDriftEnv({ ...base, RAH_DRIFT_ATTACH: value }),
      /RAH_DRIFT_ATTACH must be 1 or 0/,
      value,
    );
});

test("RAH_DRIFT_ATTACH keeps the round minimum and compaction constraints and needs one more round in the last segment", () => {
  const attach = { ...base, RAH_DRIFT_ATTACH: "1" };
  // Unchanged constraints.
  for (const env of [
    { ...attach, RAH_DRIFT_ROUNDS: "5", RAH_DRIFT_COMPACT_AT: "" },
    { ...attach, RAH_DRIFT_ROUNDS: "12", RAH_DRIFT_COMPACT_AT: "12" },
    { ...attach, RAH_DRIFT_ROUNDS: "20", RAH_DRIFT_COMPACT_AT: "15,8" },
  ])
    assert.throws(() => parseDriftEnv(env), /Invalid drift gate/);
  // The attached-read round sits in the last segment after its five kinds.
  assert.throws(
    () => parseDriftEnv(attach),
    /RAH_DRIFT_ATTACH needs at least 6 rounds after the last compaction/,
  );
  assert.throws(
    () =>
      parseDriftEnv({
        ...attach,
        RAH_DRIFT_ROUNDS: "10",
        RAH_DRIFT_COMPACT_AT: "5",
      }),
    /at least 6 rounds after the last compaction/,
  );
  assert.deepEqual(
    parseDriftEnv({
      ...attach,
      RAH_DRIFT_ROUNDS: "11",
      RAH_DRIFT_COMPACT_AT: "5",
    }).compactAt,
    [5],
  );
  // Without attach the same short last segment stays valid.
  assert.equal(
    parseDriftEnv({
      ...base,
      RAH_DRIFT_ROUNDS: "10",
      RAH_DRIFT_COMPACT_AT: "5",
    }).rounds,
    10,
  );
});
