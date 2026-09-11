import assert from "node:assert/strict";
import test from "node:test";

import type { LocalRuntimeInventoryEntry } from "@rah-os/protocol";

import {
  DEFAULT_TOOL_ACCESS_MODE,
  normalizeModelBindingId,
  runtimeModelOptions,
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
