import test from "node:test";
import assert from "node:assert/strict";
import { resolveCollaborationBindings } from "./collaboration-preflight.mjs";
const row = (provider, model, effort = "low") => ({
  runtimeProfileId: "local-workbench-profile-" + provider,
  runtimeOfferId: provider,
  modelBindingDescriptors: [
    {
      modelId: model,
      modelBindingId: provider + ":" + model,
      supportedReasoning: [effort],
    },
  ],
});
test("all exact peer bindings must resolve before any member setup", () => {
  const models = {
    codex: { model: "gpt-6-luna" },
    agy: { model: "gemini-3.8-flash-low" },
  };
  const c = row("codex", models.codex.model),
    a = row("agy", models.agy.model);
  assert.equal(
    resolveCollaborationBindings([c, a], models).agy.binding.modelId,
    models.agy.model,
  );
  for (const bad of [
    { ...a, modelBindingDescriptors: [] },
    row("agy", "other"),
    row("agy", models.agy.model, "high"),
  ])
    assert.throws(() => resolveCollaborationBindings([c, bad], models), /agy/);
});
