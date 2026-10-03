import test from "node:test";
import assert from "node:assert/strict";
import {
  MODELS,
  parseArgs,
  openingMessage,
} from "./loom-advantage-discussion.mjs";
test("discussion requires explicit mode and bounds its authorized run budget", () => {
  assert.throws(() => parseArgs([]));
  assert.throws(() => parseArgs(["--dry", "--paid"]));
  for (const n of ["0", "16", "NaN", "3.5"])
    assert.throws(() => parseArgs(["--paid", "--max-runs", n]));
  assert.equal(parseArgs(["--paid"]).maxRuns, 12);
  assert.equal(parseArgs(["--dry", "--max-runs", "15"]).maxRuns, 15);
});
test("three distinct instances use only the exact approved discussion matrix", () => {
  assert.deepEqual(
    Object.values(MODELS).map((s) => [s.provider, s.model, s.effort]),
    [
      ["codex", "gpt-6-sol", "low"],
      ["codex", "gpt-6-sol", "low"],
      ["codex", "gpt-6-astra", "low"],
    ],
  );
  const opening = openingMessage(["actual-a", "actual-b", "actual-c"]);
  for (const handle of ["actual-a", "actual-b", "actual-c"])
    assert.ok(opening.includes(`@${handle}`));
  assert.match(opening, /不超过300字/);
  assert.match(opening, /不修改任何文件/);
});
