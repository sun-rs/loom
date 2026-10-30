import test from "node:test";
import assert from "node:assert/strict";
import { nativeRoleConfiguration } from "../../frontends/raft/adapter123/role-config.ts";
import { nativeRuntimeModels } from "../../frontends/raft/adapter123/runtime-models.ts";
const inventory: any = {
  hostId: "host",
  runtimes: [
    {
      available: true,
      cliId: "agy",
      runtimeOfferId: "offer",
      modelBindingDescriptors: ["low", "high"].map((e) => ({
        modelBindingId: "binding-" + e,
        modelId: "gemini-flash-" + e,
        displayName: "Gemini Flash (" + e + ")",
        supportedReasoning: [e],
        defaultReasoning: e,
        supportedServiceTiers: ["default"],
      })),
    },
  ],
};
test("native model form groups AGY choices but writes exact published model/effort; remarks preserve the executable prompt", () => {
  const models = nativeRuntimeModels(inventory, "host", "antigravity");
  assert.equal(models.value.models.length, 1);
  const model = models.value.models[0];
  assert.deepEqual(model.supportedReasoningEfforts, ["low", "high"]);
  const config = nativeRoleConfiguration(
    {
      name: "Tom",
      description: "备注",
      runtime: "antigravity",
      machineId: "host",
      runtimeConfig: {
        model: { kind: "preset", id: model.id },
        reasoningEffort: "high",
      },
    },
    inventory,
  );
  assert.deepEqual(config.modelIntent.exactBindingIds, ["binding-high"]);
  assert.equal(config.modelIntent.reasoning, "high");
  assert.equal(config.instructions, "");
  assert.equal(
    nativeRoleConfiguration({ description: "新备注" }, inventory, {
      ...config,
      instructions: "private prompt",
    }).instructions,
    "private prompt",
  );
  assert.throws(
    () =>
      nativeRoleConfiguration(
        { name: "Tom", runtime: "antigravity", model: "invented" },
        inventory,
      ),
    /发布/,
  );
  assert.throws(
    () => nativeRuntimeModels(inventory, "unverified-computer", "antigravity"),
    /计算机/,
  );
});
