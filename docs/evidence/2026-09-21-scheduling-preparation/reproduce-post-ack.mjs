// Intentionally RED on frozen 9f5a83e; opt-in evidence, not a passing CI gate.
// Run: node --test docs/evidence/2026-09-21-scheduling-preparation/reproduce-post-ack.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { compileStandingPrompt } from "../../../packages/daemon/src/standing-prompt-compiler.ts";

test("the emitted prompt must not order another acknowledgement after posting", () => {
  const { prompt } = compileStandingPrompt();
  assert.equal(
    prompt.includes("and then acknowledge"),
    false,
    "message-check already confirms delivered pages; post must not request redundant ACK",
  );
});
