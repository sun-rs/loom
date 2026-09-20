import assert from "node:assert/strict";
import test from "node:test";

import type { LocalRuntimeInventoryEntry } from "@rah-os/protocol";

import {
  DEFAULT_TOOL_ACCESS_MODE,
  runtimeFastTier,
  normalizeModelBindingId,
  runtimeModelOptions,
  runtimeModelLabel,
  runtimeReasoningOptions,
  runtimeToolAccessModes,
  supportedReasoningLevels,
} from "../src/agent-runtime-capabilities.ts";

const runtime = {
  agentBindings: [],
  available: true,
  configured: true,
  displayName: "Codex",
  executable: "codex",
  modelBindingDescriptors: [],
  resolvedExecutablePath: "/usr/local/bin/codex",
  runtimeOfferId: "offer-codex",
  runtimeProfileId: "profile-codex",
  runtimeProfileRevisionId: "profile-codex-v1",
  source: "configured",
} satisfies LocalRuntimeInventoryEntry;

test("Agent reasoning choices are derived only from verified runtime bindings", () => {
  assert.deepEqual(supportedReasoningLevels(runtime), ["default"]);
  const probedRuntime = {
    ...runtime,
    modelBindingDescriptors: [
      {
        capabilityClasses: ["deep_coding"],
        evidence: "declared",
        modelBindingId: "declared-only",
        modelId: "unverified",
        provider: "example",
        supportedReasoning: ["max"],
        supportedServiceTiers: ["default"],
      },
      {
        capabilityClasses: ["deep_coding"],
        displayName: "Verified Model",
        evidence: "probed",
        modelBindingId: "probed-model",
        modelId: "verified",
        provider: "example",
        reasoningOptions: [
          { value: "medium", label: "Balanced" },
          { value: "high", label: "High" },
        ],
        supportedReasoning: ["medium", "high"],
        supportedServiceTiers: ["default"],
      },
    ],
  } satisfies LocalRuntimeInventoryEntry;
  assert.deepEqual(runtimeModelOptions(probedRuntime), [
    {
      label: "Verified Model",
      modelBindingId: "probed-model",
      nativeId: "verified",
    },
  ]);
  assert.deepEqual(supportedReasoningLevels(probedRuntime, "probed-model"), [
    "default",
    "medium",
    "high",
  ]);
  assert.deepEqual(runtimeReasoningOptions(probedRuntime, "probed-model"), [
    { label: "Runtime 默认", value: "default" },
    { label: "Balanced", value: "medium" },
    { label: "High", value: "high" },
  ]);
  assert.deepEqual(supportedReasoningLevels(probedRuntime), ["default"]);
  assert.equal(normalizeModelBindingId("declared-only", probedRuntime), "");
  assert.equal(
    normalizeModelBindingId("probed-model", probedRuntime),
    "probed-model",
  );
});

test("Agent permission is fixed to the Raft-compatible unattended policy", () => {
  assert.equal(DEFAULT_TOOL_ACCESS_MODE, "full_access");
  assert.deepEqual(runtimeToolAccessModes(runtime), ["full_access"]);
  assert.deepEqual(
    runtimeToolAccessModes({
      ...runtime,
      supportedToolAccessModes: ["read_only", "workspace_write"],
    }),
    [],
  );
});

test("model selection never invents a runtime default", () => {
  assert.deepEqual(runtimeModelOptions(runtime), []);
  assert.equal(normalizeModelBindingId(undefined, runtime), "");
});

test("OpenCode labels preserve provider identity when model names collide", () => {
  const r = {
    ...runtime,
    cliId: "opencode",
    modelBindingDescriptors: ["deepseek", "aihubmix"].map((provider) => ({
      modelBindingId: `${provider}/deepseek`,
      modelId: "deepseek",
      provider,
      displayName: "DeepSeek",
      evidence: "probed",
      capabilityClasses: [],
      supportedReasoning: [],
      supportedServiceTiers: ["default"],
    })),
  } as LocalRuntimeInventoryEntry;
  assert.deepEqual(
    runtimeModelOptions(r).map((x) => x.label),
    ["DeepSeek · DeepSeek", "Aihubmix · DeepSeek"],
  );
});

test("Fast mode requires a verified model service tier", () => {
  const model = {
    capabilityClasses: [],
    evidence: "probed",
    modelBindingId: "m",
    modelId: "m",
    provider: "openai",
    supportedReasoning: [],
    supportedServiceTiers: ["default", "priority"],
  } as const;
  const candidate = {
    ...runtime,
    modelBindingDescriptors: [model],
  } as unknown as LocalRuntimeInventoryEntry;
  assert.equal(runtimeFastTier(candidate, "m"), "priority");
  assert.equal(runtimeFastTier(candidate, "missing"), undefined);
  assert.equal(
    runtimeFastTier(
      {
        ...candidate,
        modelBindingDescriptors: [
          { ...candidate.modelBindingDescriptors[0]!, evidence: "declared" },
        ],
      },
      "m",
    ),
    undefined,
  );
});

test("OpenCode options prefer real names with provider first and preserve native IDs", () => {
  const binding = {
    modelBindingId: "aihubmix/deepseek-v4",
    modelId: "deepseek-v4",
    displayName: "DeepSeek V4",
    provider: "aihubmix",
    evidence: "probed",
    capabilityClasses: [],
    supportedReasoning: [],
    supportedServiceTiers: ["default"],
  } satisfies LocalRuntimeInventoryEntry["modelBindingDescriptors"][number];
  const openCode = {
    ...runtime,
    cliId: "opencode",
    modelBindingDescriptors: [binding],
  } satisfies LocalRuntimeInventoryEntry;
  assert.equal(runtimeModelLabel(openCode, binding), "Aihubmix · DeepSeek V4");
  assert.equal(
    runtimeModelLabel(openCode, {
      ...binding,
      modelId: "aihubmix/deepseek-v4",
    }),
    "Aihubmix · DeepSeek V4",
  );
  assert.equal(
    runtimeModelLabel(openCode, { ...binding, provider: "deepseek" }),
    "DeepSeek · DeepSeek V4",
  );
  assert.equal(
    runtimeModelOptions(openCode)[0]?.label,
    runtimeModelLabel(openCode, binding),
  );
  assert.equal(
    runtimeModelLabel(openCode, { ...binding, displayName: undefined }),
    "Aihubmix · DeepSeek-V4",
  );
  assert.equal(
    runtimeModelLabel(openCode, {
      ...binding,
      modelId: "aihubmix/gpt-6-astra",
      displayName: undefined,
    }),
    "Aihubmix · GPT-6-Astra",
  );
  assert.equal(
    runtimeModelOptions(openCode)[0]?.modelBindingId,
    binding.modelBindingId,
  );
  assert.equal(runtimeModelOptions(openCode)[0]?.nativeId, binding.modelId);
  for (const cliId of ["codex", "claude", "kimi"] as const) {
    assert.equal(
      runtimeModelLabel({ ...runtime, cliId }, binding),
      "DeepSeek V4",
    );
    assert.equal(
      runtimeModelLabel(
        { ...runtime, cliId },
        { ...binding, displayName: undefined },
      ),
      "deepseek-v4",
    );
  }
  assert.equal(
    runtimeModelLabel(
      { ...runtime, executable: "/usr/local/bin/opencode" },
      binding,
    ),
    "Aihubmix · DeepSeek V4",
  );
});
