import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { probeLocalModelCatalog } from "../src/model-catalog-probe.ts";
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

test("AGY accepts a valid network-refreshed catalog taking longer than five seconds", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "loom-agy-catalog-delay-"));
  const executablePath = join(cwd, "agy.mjs");
  writeFileSync(
    executablePath,
    `#!${process.execPath}\nsetTimeout(() => process.stdout.write("gemini-3.8-flash-low\\tGemini 3.8 Flash (Low)\\n"), 5200);\n`,
  );
  chmodSync(executablePath, 0o700);
  try {
    const bindings = await probeLocalModelCatalog({
      cwd,
      executablePath,
      kind: "agy-cli/v1",
    });
    assert.equal(bindings[0]?.modelId, "gemini-3.8-flash-low");
    await assert.rejects(
      probeLocalModelCatalog({
        cwd,
        executablePath,
        kind: "agy-cli/v1",
        timeoutMs: 50,
      }),
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
