import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "./upstream-diff.mjs";
test("upstream comparison separates shared bytes, one-sided edits and overlapping edits", () => {
  assert.equal(classify("base", "base", "base"), "identical");
  assert.equal(classify("base", "new", "new"), "identical");
  assert.equal(classify("base", "base", "new"), "upstream-only");
  assert.equal(classify("base", "local", "base"), "loom-only");
  assert.equal(classify("base", "local", "new"), "both-changed-review");
  assert.equal(classify("base", "local", null), "missing-upstream");
  assert.equal(classify("base", null, "new"), "missing-loom");
});
