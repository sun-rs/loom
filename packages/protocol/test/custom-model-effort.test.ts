import assert from "node:assert/strict";
import test from "node:test";
import { ModelIntentSchema, ResolvedModelSchema } from "../src/index.ts";
test("custom effort is explicitly bounded in commands and frozen launch models", () => {
  for (const [id, effort, valid] of [
    ["claude-sonnet-5", "high", true],
    ["claude-sonnet-5", "max", true],
    ["claude-sonnet-4-6", "xhigh", false],
    ["claude-haiku-4-5", "high", false],
    ["vendor/unknown", "high", false],
    ["claude-sonnet-5", "ultra", false],
  ] as const) {
    const model = { runtime: "claude", modelId: id };
    assert.equal(
      ModelIntentSchema.safeParse({
        customModel: model,
        reasoning: effort,
        fallback: "disabled",
      }).success,
      valid,
    );
    assert.equal(
      ResolvedModelSchema.safeParse({
        ...model,
        source: "custom_model",
        reasoning: effort,
      }).success,
      valid,
    );
  }
  assert.equal(
    ResolvedModelSchema.safeParse({
      source: "custom_model",
      runtime: "codex",
      modelId: "claude-sonnet-5",
      reasoning: "high",
    }).success,
    false,
  );
});
