import test from "node:test";
import assert from "node:assert/strict";
import { runtimeChoices } from "../../packages/client-core/src/role-form.ts";
import {
  runtimeModelOptions,
  resolveRuntimeModel,
} from "../../frontends/raft/loom/runtime-model-options.ts";
import { parseAgyModelCatalog } from "../../packages/agent-host/src/agy-model-catalog.ts";
test("AGY model/effort controls resolve only exact published bindings", () => {
  const bindings = parseAgyModelCatalog(
    "gemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\ngpt-oss-120b-medium\tGPT-OSS 120B (Medium)",
  );
  const [runtime] = runtimeChoices({
    runtimes: [
      {
        cliId: "agy",
        available: true,
        runtimeOfferId: "opaque",
        displayName: "Antigravity",
        modelBindingDescriptors: bindings,
      },
    ],
  } as any);
  const groups = runtimeModelOptions(runtime!);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Gemini 3.8 Flash", "GPT-OSS 120B"],
  );
  assert.deepEqual(groups[0]!.reasoning, ["high", "medium", "low"]);
  assert.equal(
    resolveRuntimeModel(groups, groups[0]!.value, "low")?.modelBindingId,
    "local:agy-cli/v1:gemini-3.8-flash-low",
  );
  assert.equal(resolveRuntimeModel(groups, groups[0]!.value, "max"), undefined);
  assert.equal(
    resolveRuntimeModel(groups, groups[1]!.value, "medium")?.modelBindingId,
    "local:agy-cli/v1:gpt-oss-120b-medium",
  );
  assert.equal(
    runtime!.bindings.length,
    4,
    "logical groups never replace executable catalog bindings",
  );
});
test("ordinary CLI and inconsistent AGY metadata stay distinct", () => {
  const runtime = {
    cliId: "codex",
    runtimeOfferId: "opaque",
    label: "Codex",
    bindings: [
      {
        modelId: "model-low",
        label: "Model (Low)",
        modelBindingId: "exact-id",
        reasoning: ["low", "high"],
      },
    ],
  };
  assert.equal(runtimeModelOptions(runtime)[0]!.value, "Model (Low)");
  assert.equal(
    runtimeModelOptions({ ...runtime, cliId: "agy" })[0]!.value,
    "Model (Low)",
  );
});
