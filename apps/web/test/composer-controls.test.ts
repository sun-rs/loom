import assert from "node:assert/strict";
import test from "node:test";
import {
  composerPrimaryAction,
  fileReferenceText,
} from "../src/composer-controls.ts";

test("composer offers stop only without draft content; working never blocks send", () => {
  assert.equal(
    composerPrimaryAction({
      body: "",
      attachmentCount: 0,
      working: true,
      stopping: false,
    }),
    "stop",
  );
  assert.equal(
    composerPrimaryAction({
      body: "correction",
      attachmentCount: 0,
      working: true,
      stopping: true,
    }),
    "send",
  );
  assert.equal(
    composerPrimaryAction({
      body: "",
      attachmentCount: 1,
      working: true,
      stopping: false,
    }),
    "send",
  );
  assert.equal(
    composerPrimaryAction({
      body: "",
      attachmentCount: 0,
      working: false,
      stopping: true,
    }),
    "stopping",
  );
});
test("file references quote absolute paths containing spaces", () => {
  assert.equal(
    fileReferenceText("/Users/me/a file.txt"),
    '@"/Users/me/a file.txt"',
  );
});
