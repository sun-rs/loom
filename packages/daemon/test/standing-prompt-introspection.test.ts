import assert from "node:assert/strict";
import test from "node:test";
import { compileStandingPrompt } from "../src/standing-prompt-compiler.ts";
test("introspection guidance separates configured metadata, frozen actual Run and serving daemon from the invoked CLI carrier", () => {
  const prompt = compileStandingPrompt().prompt;
  for (const word of [
    "configured",
    "actualRun",
    "whoami",
    "serving daemon",
    "CLI carrier",
  ])
    assert.ok(prompt.includes(word), word);
  assert.match(prompt, /redacted/u);
  assert.ok(prompt.includes("createdAgentsNextCursor"));
  assert.ok(prompt.includes("--created-agents-cursor"));
  assert.ok(prompt.includes("availability"));
});
