import assert from "node:assert/strict";
import test from "node:test";
import {
  providerActivationInput,
  withRuntimeNotice,
} from "../src/provider-activation-input.js";

test("wake batches startup reads without bypassing canonical delivery or retaining a busy lane", () => {
  const input = providerActivationInput();
  assert.match(input, /message-check --startup/);
  assert.match(input, /complete original MEMORY.md/);
  assert.match(input, /not.*Task completion/i);
  assert.match(input, /finish this turn/);
  assert.match(input, /do not poll/i);
  assert.ok(input.length < 2000);
});

test("S2-0 the Host cleanup line rides the wake once, bounded, only when present", () => {
  const previous = process.env.RAH_RUNTIME_NOTICE;
  try {
    delete process.env.RAH_RUNTIME_NOTICE;
    const plain = providerActivationInput();
    assert.doesNotMatch(plain, /Host cleanup/);
    assert.equal(withRuntimeNotice("bodied wake"), "bodied wake");

    process.env.RAH_RUNTIME_NOTICE =
      "Host cleanup after your previous run: 1 leftover background process was stopped.";
    const noticed = providerActivationInput();
    assert.equal(noticed.split("Host cleanup").length - 1, 1);
    assert.ok(noticed.startsWith(plain));
    assert.match(
      withRuntimeNotice("bodied wake"),
      /^bodied wake\nHost cleanup/,
    );

    process.env.RAH_RUNTIME_NOTICE = `Host cleanup ${"x".repeat(2000)}\nsecond line`;
    const bounded = withRuntimeNotice("w");
    assert.ok(bounded.length <= 1 + 1 + 300);
    assert.doesNotMatch(bounded, /second line/);
  } finally {
    if (previous === undefined) delete process.env.RAH_RUNTIME_NOTICE;
    else process.env.RAH_RUNTIME_NOTICE = previous;
  }
});
