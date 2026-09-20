import assert from "node:assert/strict";
import test from "node:test";
import { ModelIntentSchema } from "@rah-os/protocol";
import {
  runtimeModelOptions,
  runtimeReasoningOptions,
  normalizeModelBindingId,
} from "../src/agent-runtime-capabilities.ts";
import {
  modelIntentDraft,
  selectedModelIntent,
} from "../src/runtime-model-selection.ts";
const runtime = {
  cliId: "claude",
  customModelRuntime: "claude",
  executable: "claude",
  modelBindingDescriptors: [
    {
      modelBindingId: "local:claude-cli/v1:default",
      modelId: "default",
      displayName: "Default (recommended)",
      provider: "anthropic",
      evidence: "probed",
      capabilityClasses: [],
      supportedReasoning: [],
      supportedServiceTiers: [],
    },
  ],
} as any;
test("Claude offers named aliases and version candidates without an ambiguous Default", () => {
  const models = runtimeModelOptions(runtime);
  assert.ok(!models.some((m) => m.nativeId === "default"));
  assert.equal(
    models.find((m) => m.nativeId === "fable")?.label,
    "Claude Fable",
  );
  assert.equal(
    models.find((m) => m.nativeId === "claude-opus-5")?.label,
    "Claude Opus 5",
  );
  assert.deepEqual(
    selectedModelIntent(
      models.find((m) => m.nativeId === "claude-opus-5")!.modelBindingId,
    ),
    {
      customModel: { runtime: "claude", modelId: "claude-opus-5" },
      fallback: "disabled",
      reasoning: "default",
    },
  );
});
test("custom IDs round-trip unchanged only on supported native runtimes", () => {
  for (const cli of ["codex", "claude"]) {
    const value = `custom:${cli}:vendor/model-v2`;
    const inventory = { ...runtime, cliId: cli, customModelRuntime: cli };
    assert.equal(normalizeModelBindingId(value, inventory), value);
    const intent = ModelIntentSchema.parse(selectedModelIntent(value));
    assert.equal(modelIntentDraft(intent), value);
    assert.equal(intent.customModel?.modelId, "vendor/model-v2");
    assert.equal(
      normalizeModelBindingId(value, {
        ...inventory,
        customModelRuntime: undefined,
      }),
      "",
    );
  }
  assert.equal(
    ModelIntentSchema.safeParse({
      customModel: { runtime: "claude", modelId: "bad id" },
      fallback: "disabled",
    }).success,
    false,
  );
  assert.equal(
    ModelIntentSchema.safeParse({
      customModel: { runtime: "claude", modelId: "x" },
      exactBindingIds: ["other"],
      fallback: "disabled",
    }).success,
    false,
  );
});

test("documented Claude versions preserve effort without pretending to be probed", () => {
  const value = "custom:claude:claude-sonnet-5";
  assert.deepEqual(
    runtimeReasoningOptions(runtime, value).map((x) => x.value),
    ["default", "low", "medium", "high", "xhigh", "max"],
  );
  const intent = ModelIntentSchema.parse(selectedModelIntent(value, "high"));
  assert.equal(intent.reasoning, "high");
  assert.equal(modelIntentDraft(intent), value);
  assert.deepEqual(
    runtimeReasoningOptions(runtime, "custom:claude:claude-sonnet-4-6").map(
      (x) => x.value,
    ),
    ["default", "low", "medium", "high", "max"],
  );
  for (const id of [
    "vendor/unknown",
    "claude-sonnet-5-future",
    "claude-haiku-4-5",
  ]) {
    const value = `custom:claude:${id}`;
    assert.deepEqual(
      runtimeReasoningOptions(runtime, value).map((x) => x.value),
      ["default"],
    );
    assert.throws(() =>
      ModelIntentSchema.parse(selectedModelIntent(value, "high")),
    );
  }
  assert.throws(() =>
    ModelIntentSchema.parse(
      selectedModelIntent("custom:claude:claude-sonnet-4-6", "xhigh"),
    ),
  );
});
