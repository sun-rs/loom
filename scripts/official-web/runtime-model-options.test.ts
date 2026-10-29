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
test("Kimi K3.1 Pro exposes one model with exact ordinary/highspeed bindings, independent from effort", () => {
  const runtime = {
    cliId: "kimi",
    runtimeOfferId: "kimi-offer",
    label: "Kimi",
    bindings: [
      {
        modelId: "kimi-code/k3.1-pro-highspeed",
        label: "K3.1 Pro Highspeed",
        modelBindingId: "fast-exact",
        reasoning: ["low", "high", "max"],
        serviceTiers: ["default"],
      },
      {
        modelId: "kimi-code/k3.1-pro",
        label: "K3.1 Pro",
        modelBindingId: "normal-exact",
        reasoning: ["low", "high", "max"],
        serviceTiers: ["default"],
      },
      {
        modelId: "kimi-code/kimi-for-coding",
        label: "K2.8 Preview",
        modelBindingId: "k28",
        reasoning: ["low"],
        serviceTiers: ["default"],
      },
      {
        modelId: "kimi-code/kimi-for-coding-highspeed",
        label: "K2.7 Code Highspeed",
        modelBindingId: "k27fast",
        reasoning: ["low"],
        serviceTiers: ["default"],
      },
    ],
  };
  const before = JSON.stringify(runtime);
  const groups = runtimeModelOptions(runtime);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["K3.1 Pro", "K2.8 Preview", "K2.7 Code Highspeed"],
  );
  for (const effort of ["low", "high", "max"]) {
    assert.equal(
      resolveRuntimeModel(groups, "K3.1 Pro", effort, false)?.modelBindingId,
      "normal-exact",
    );
    assert.equal(
      resolveRuntimeModel(groups, "K3.1 Pro", effort, true)?.modelBindingId,
      "fast-exact",
    );
  }
  assert.equal(
    resolveRuntimeModel(groups, "K3.1 Pro", "medium", true),
    undefined,
  );
  assert.deepEqual(groups[0]!.fastBindingIds, ["fast-exact"]);
  assert.equal(
    JSON.stringify(runtime),
    before,
    "display grouping never edits the executable catalog",
  );
  for (const bindings of [
    runtime.bindings.slice(0, 1),
    runtime.bindings.slice(1, 2),
  ])
    assert.equal(
      runtimeModelOptions({ ...runtime, bindings })[0]!.fastBindingIds,
      undefined,
      "missing counterpart stays an exact model, with no invented Fast switch",
    );
  const inconsistent = structuredClone(runtime);
  inconsistent.bindings[0]!.reasoning = ["low"];
  assert.equal(
    runtimeModelOptions(inconsistent).length,
    4,
    "unequal effort capabilities do not silently merge",
  );
  assert.equal(
    runtimeModelOptions({ ...runtime, cliId: "opencode" }).length,
    4,
    "no generic suffix heuristics",
  );
});
