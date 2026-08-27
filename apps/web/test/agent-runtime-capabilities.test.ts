import assert from "node:assert/strict";
import test from "node:test";

import type { LocalRuntimeInventoryEntry } from "@rah-os/protocol";

import {
  normalizeModelBindingId,
  runtimeModelOptions,
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
        evidence: "probed",
        modelBindingId: "probed-model",
        modelId: "verified",
        provider: "example",
        supportedReasoning: ["medium", "high"],
        supportedServiceTiers: ["default"],
      },
    ],
  } satisfies LocalRuntimeInventoryEntry;
  assert.deepEqual(runtimeModelOptions(probedRuntime), [
    { label: "Runtime 默认", modelBindingId: "runtime_default" },
    {
      label: "example / verified",
      modelBindingId: "probed-model",
    },
  ]);
  assert.deepEqual(supportedReasoningLevels(probedRuntime, "probed-model"), [
    "default",
    "medium",
    "high",
  ]);
  assert.deepEqual(supportedReasoningLevels(probedRuntime), ["default"]);
  assert.equal(
    normalizeModelBindingId("declared-only", probedRuntime),
    "runtime_default",
  );
  assert.equal(
    normalizeModelBindingId("probed-model", probedRuntime),
    "probed-model",
  );
});
