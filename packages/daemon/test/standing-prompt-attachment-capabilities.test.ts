import assert from "node:assert/strict";
import test from "node:test";
import { compileStandingPrompt } from "../src/standing-prompt-compiler.ts";

test("attachment guidance asks the live owner for limits and does not imply direct cloud upload", () => {
  const prompt = compileStandingPrompt().prompt;
  assert.match(prompt, /attachment-capabilities/u);
  assert.match(
    prompt,
    /server-authoritative upload size and reservation lifetime/u,
  );
  assert.match(prompt, /directUploadEnabled=false/u);
});
