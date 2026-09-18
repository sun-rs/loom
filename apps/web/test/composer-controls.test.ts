import assert from "node:assert/strict";
import test from "node:test";
import { fileReferenceText } from "../src/composer-controls.ts";

test("file references quote absolute paths containing spaces", () => {
  assert.equal(
    fileReferenceText("/Users/me/a file.txt"),
    '@"/Users/me/a file.txt"',
  );
});
