import assert from "node:assert/strict";
import test from "node:test";
import { parseLocalModelCatalog } from "../src/model-catalog-probe.ts";
import { localCliRuntimeSpec } from "../../daemon/src/local-cli-runtime-spec.ts";
test("AGY discovery uses its own adapter and exact native model IDs, never a display label", () => {
  assert.equal(
    localCliRuntimeSpec("agy", "/tmp")?.adapterKind,
    "agy-print-json/v1",
  );
  const models = parseLocalModelCatalog(
    "agy-cli/v1",
    "gemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n",
  );
  assert.equal(models[0]?.modelId, "gemini-3.8-flash-low");
  assert.deepEqual(models[0]?.supportedReasoning, ["low"]);
  assert.deepEqual(models[0]?.supportedServiceTiers, ["default"]);
});
test("AGY rejects ambiguous or malformed model listings instead of guessing", () => {
  for (const input of ["oops", "x\tOne\nx\tTwo\n", "--model\tBad\n"])
    assert.deepEqual(parseLocalModelCatalog("agy-cli/v1", input), []);
});
