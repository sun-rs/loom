import assert from "node:assert/strict";
import test from "node:test";

import { LocalRuntimeInventoryEntrySchema } from "../src/index.ts";

test("local runtime inventory exposes only redacted model binding descriptors", () => {
  const runtime = LocalRuntimeInventoryEntrySchema.parse({
    agentBindings: [],
    available: true,
    configured: true,
    displayName: "Codex",
    executable: "codex",
    modelBindingDescriptors: [
      {
        capabilityClasses: ["deep_coding"],
        evidence: "probed",
        modelBindingId: "codex-luna",
        modelId: "gpt-5.6-luna",
        provider: "openai",
        supportedReasoning: ["low", "high"],
        supportedServiceTiers: ["default"],
      },
    ],
    resolvedExecutablePath: "/usr/local/bin/codex",
    runtimeOfferId: "offer-codex",
    runtimeProfileId: "profile-codex",
    runtimeProfileRevisionId: "profile-codex-v1",
    source: "configured",
  });

  assert.deepEqual(runtime.modelBindingDescriptors[0]?.supportedReasoning, [
    "low",
    "high",
  ]);
  assert.throws(() =>
    LocalRuntimeInventoryEntrySchema.parse({
      ...runtime,
      modelBindingDescriptors: [
        {
          ...runtime.modelBindingDescriptors[0],
          adapterMapping: {
            config: { modelFlag: "--model" },
            kind: "codex-cli/v1",
          },
        },
      ],
    }),
  );
});
