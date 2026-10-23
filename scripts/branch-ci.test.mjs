import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
test("imported Chatbox pushes run its own quality gate", () => {
  assert.match(workflow, /push:\s*\n\s*branches: \[chatbox\]/);
  assert.match(workflow, /run: npm run test:ci/);
  assert.match(workflow, /run: node --test scripts\/branch-ci\.test\.mjs/);
});
