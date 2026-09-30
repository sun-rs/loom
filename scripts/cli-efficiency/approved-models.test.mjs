import test from "node:test";
import assert from "node:assert/strict";
import {
  APPROVED_GATE_MODELS,
  assertApprovedGateModel,
} from "./approved-models.mjs";

test("admits exactly the owner-approved provider/model/effort combinations", () => {
  const admitted = [
    // 2026-09-09 matrix
    ["claude", "sonnet", "low"],
    ["codex", "gpt-5.6-luna", "low"],
    ["opencode", "deepseek/deepseek-v4-flash", "low"],
    ["kimi", "kimi-code/k3", "high"],
    // 2026-09-25 owner approval
    ["codex", "gpt-6-luna", "low"],
    ["kimi", "kimi-code/k3-256k", "low"],
    ["claude", "haiku", null],
    ["opencode", "deepseek/deepseek-flash", "low"],
    ["opencode", "aihubmix/deepseek-v4.1-flash", "low"],
  ];
  for (const [provider, model, effort] of admitted)
    assert.doesNotThrow(
      () => assertApprovedGateModel({ provider, model, effort }),
      `${provider} ${model} ${effort}`,
    );
  assert.equal(APPROVED_GATE_MODELS.length, admitted.length);
});

test("rejects every combination outside the table before any paid call", () => {
  const rejected = [
    ["codex", "gpt-6-sol", "low"],
    ["codex", "gpt-6-luna", "ultra"],
    ["codex", "gpt-6-luna", "high"],
    ["codex", "gpt-5.6-sol", "ultra"],
    ["codex", "gpt-5.6-ultra", "low"],
    ["codex", "gpt-6-astra", "low"],
    ["claude", "opus", "max"],
    ["claude", "opus", "low"],
    ["claude", "sonnet", "max"],
    ["claude", "sonnet", "xhigh"],
    ["claude", "sonnet", null],
    ["claude", "haiku", "low"],
    ["claude", "fable", "low"],
    ["claude", "claude-fable-5-1", null],
    ["kimi", "kimi-code/k3", "max"],
    ["kimi", "kimi-code/k3", "low"],
    ["kimi", "kimi-code/k3-256k", "high"],
    ["kimi", "kimi-code/k3-256k", "max"],
    ["opencode", "deepseek/deepseek-v4-pro", "low"],
    ["opencode", "deepseek/deepseek-flash", "max"],
    ["opencode", "deepseek/deepseek-flash", "high"],
    // Right model under another provider.
    ["codex", "sonnet", "low"],
    ["unknown", "gpt-6-luna", "low"],
  ];
  for (const [provider, model, effort] of rejected)
    assert.throws(
      () => assertApprovedGateModel({ provider, model, effort }),
      /Unapproved paid gate model/,
      `${provider} ${model} ${effort}`,
    );
});

test("the table itself never carries Fable, Ultra or a max/ultra level", () => {
  for (const row of APPROVED_GATE_MODELS) {
    assert.doesNotMatch(row.model, /fable|ultra/iu);
    assert.ok(![`max`, `ultra`, `xhigh`].includes(row.effort));
    assert.match(row.approvedOn, /^\d{4}-\d{2}-\d{2}$/u);
  }
  assert.ok(Object.isFrozen(APPROVED_GATE_MODELS));
  assert.ok(APPROVED_GATE_MODELS.every((row) => Object.isFrozen(row)));
});
