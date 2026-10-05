import assert from "node:assert/strict";
import test from "node:test";
import { validateNativeAnswer } from "./native.mjs";
test("a new workload can accept a short final without changing the existing review marker/length gate", () => {
  const short = "审查结论：证据不足。";
  assert.throws(() => validateNativeAnswer(short), /Missing effective/);
  assert.doesNotThrow(() =>
    validateNativeAnswer(short, (s) => /^审查结论[:：]/u.test(s)),
  );
  assert.throws(
    () => validateNativeAnswer(undefined, () => true),
    /Missing final/,
  );
});
