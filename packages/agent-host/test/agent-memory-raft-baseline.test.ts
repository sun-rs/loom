import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildWorkspaceAndMemorySection,
  buildCompactionSafetySection,
} from "../src/raft-memory/upstream-standing-prompt.ts";
import { localWorkbenchWorkerPrompt } from "../../daemon/src/local-cli-runtime-spec.ts";

test("vendored Raft 1.0.18 memory source is byte-exact except the explicit export footer", () => {
  const file = readFileSync(
    new URL("../src/raft-memory/upstream-standing-prompt.ts", import.meta.url),
    "utf8",
  );
  const footer =
    "\nexport { buildWorkspaceAndMemorySection, buildCompactionSafetySection };\n";
  assert.ok(file.endsWith(footer));
  assert.equal(
    createHash("sha256").update(file.slice(0, -footer.length)).digest("hex"),
    "b47ccf545645f927d543aa377d50434b6d0982896c28d7794f1f90b801e97f83",
  );
});

test("all upstream memory instructions after the cwd binding and compaction section survive unchanged", () => {
  const original = buildWorkspaceAndMemorySection();
  const memoryRules = original.slice(original.indexOf("### MEMORY.md"));
  const prompt = localWorkbenchWorkerPrompt();
  assert.ok(
    prompt.includes(memoryRules),
    "must include the actual upstream memory body, not a rewritten approximation",
  );
  assert.ok(prompt.includes(buildCompactionSafetySection()));
  assert.match(prompt, /read the complete original MEMORY\.md/iu);
  assert.match(prompt, /RAH_AGENT_MEMORY_DIR/u);
  assert.match(prompt, /agent inbox check/u);
  assert.match(prompt, /ack --item-id ID --version N/u);
  assert.match(prompt, /does not prove memory was cleaned/u);
  assert.doesNotMatch(
    prompt,
    /Your working directory \(cwd\) is your \*\*persistent, agent-owned workspace/u,
  );
  assert.doesNotMatch(
    prompt,
    /512|omittedBlocks|never a blind full-index load/u,
  );
});

test("default memory prompt adds no RAH retention filter or project-tagging policy to the Raft baseline", () => {
  const original = buildWorkspaceAndMemorySection();
  const memoryRules = original.slice(original.indexOf("### MEMORY.md"));
  const prompt = localWorkbenchWorkerPrompt();
  const bindings = prompt
    .replace(memoryRules, "")
    .replace(buildCompactionSafetySection(), "");

  // Raft keeps channel knowledge and unfinished work even when it is not
  // reusable outside that Room. Observer skip rules are not worker policy.
  assert.match(memoryRules, /Channel context/u);
  assert.match(memoryRules, /Work history/u);
  assert.match(buildCompactionSafetySection(), /what tasks are in progress/u);
  assert.doesNotMatch(
    bindings,
    /useful beyond the current Room|Do not persist the current date|a test probe or marker|A tool was used is not a reason to remember|Keep curated conclusions|remove completed or cancelled work/u,
  );
  assert.doesNotMatch(
    bindings,
    /Project hints are optional relevance clues|writing short index tags|selecting notes|Keep long source paths|updated time is not last-verified time/u,
  );
  assert.match(bindings, /RAH_AGENT_MEMORY_DIR/u);
  assert.match(bindings, /RAH_AGENT_MEMORY_SOURCE_FILE/u);
  assert.match(
    bindings,
    /Never copy credentials, access tokens, private keys/u,
  );
});
