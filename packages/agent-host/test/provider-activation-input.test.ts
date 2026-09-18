import assert from "node:assert/strict";
import test from "node:test";
import { providerActivationInput } from "../src/provider-activation-input.js";

test("wake batches startup reads without bypassing canonical delivery or retaining a busy lane", () => {
  const input = providerActivationInput();
  assert.match(input, /message-check --startup/);
  assert.match(input, /complete original MEMORY.md/);
  assert.match(input, /not.*Task completion/i);
  assert.match(input, /finish this turn/);
  assert.match(input, /do not poll/i);
  assert.ok(input.length < 2000);
});
