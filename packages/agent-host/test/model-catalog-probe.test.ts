import assert from "node:assert/strict";
import test from "node:test";

import type { ResolvedModel } from "@rah-os/protocol";

import {
  parseLocalModelCatalog,
  resolveModelBindingArguments,
} from "../src/model-catalog-probe.ts";

test("Codex model catalog becomes probed bindings with exact reasoning support", () => {
  const bindings = parseLocalModelCatalog(
    "codex-cli/v1",
    JSON.stringify({
      models: [
        {
          service_tiers: [{ id: "priority" }],
          slug: "gpt-5.6-luna",
          supported_in_api: true,
          supported_reasoning_levels: [
            { effort: "low" },
            { effort: "high" },
            { effort: "ultra" },
          ],
          visibility: "list",
        },
        {
          service_tiers: [],
          slug: "hidden-model",
          supported_in_api: true,
          supported_reasoning_levels: [],
          visibility: "hide",
        },
      ],
    }),
  );
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0]?.modelId, "gpt-5.6-luna");
  assert.deepEqual(bindings[0]?.supportedReasoning, ["low", "high"]);
  assert.deepEqual(bindings[0]?.supportedServiceTiers, ["default", "priority"]);
});

test("Kimi and OpenCode catalogs publish model selectors without inventing effort", () => {
  const kimi = parseLocalModelCatalog(
    "kimi-cli/v1",
    JSON.stringify({
      models: {
        "kimi-code/k3": {
          defaultEffort: "high",
          displayName: "K3",
          model: "k3",
          provider: "managed:kimi-code",
          supportEfforts: ["low", "high", "max"],
        },
      },
      providers: {},
    }),
  );
  assert.equal(kimi[0]?.modelId, "kimi-code/k3");
  assert.deepEqual(kimi[0]?.supportedReasoning, []);

  const opencode = parseLocalModelCatalog(
    "opencode-cli/v1",
    "openai/gpt-5.6-luna\naihubmix/claude-sonnet-5\n",
  );
  assert.deepEqual(
    opencode.map(({ modelId }) => modelId),
    ["aihubmix/claude-sonnet-5", "openai/gpt-5.6-luna"],
  );
});

test("resolved model binding becomes shell-free argv and rejects mismatches", () => {
  const [binding] = parseLocalModelCatalog(
    "codex-cli/v1",
    JSON.stringify({
      models: [
        {
          service_tiers: [{ id: "priority" }],
          slug: "gpt-5.6-luna",
          supported_in_api: true,
          supported_reasoning_levels: [{ effort: "high" }],
          visibility: "list",
        },
      ],
    }),
  );
  const resolved = {
    modelBindingId: binding!.modelBindingId,
    modelId: binding!.modelId,
    provider: binding!.provider,
    reasoning: "high",
    serviceTier: "priority",
    source: "explicit_binding",
  } satisfies ResolvedModel;
  assert.deepEqual(resolveModelBindingArguments(binding!, resolved), [
    "--model",
    "gpt-5.6-luna",
    "--config",
    "model_reasoning_effort=high",
    "--config",
    "service_tier=priority",
  ]);
  assert.throws(
    () =>
      resolveModelBindingArguments(binding!, {
        ...resolved,
        modelId: "different-model",
      }),
    /does not match/,
  );
  assert.throws(
    () =>
      resolveModelBindingArguments(binding!, {
        ...resolved,
        reasoning: "medium",
      }),
    /does not support reasoning/,
  );
  assert.throws(
    () =>
      resolveModelBindingArguments(binding!, {
        ...resolved,
        serviceTier: "fast",
      }),
    /does not support service tier/,
  );
});

test("model catalogs are bounded before they enter immutable probe evidence", () => {
  const models = Object.fromEntries(
    Array.from({ length: 600 }, (_, index) => [
      `provider/model-${String(index).padStart(3, "0")}`,
      { provider: "managed:provider" },
    ]),
  );
  models[`provider/${"x".repeat(1_100)}`] = {
    provider: "managed:provider",
  };

  const bindings = parseLocalModelCatalog(
    "kimi-cli/v1",
    JSON.stringify({ models, providers: {} }),
  );
  assert.equal(bindings.length, 512);
  assert.equal(
    bindings.some(({ modelId }) => modelId.length > 1_024),
    false,
  );
});
