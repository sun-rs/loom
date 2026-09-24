import assert from "node:assert/strict";
import test from "node:test";
import {
  providerActivationInput,
  withRuntimeNotice,
} from "../src/provider-activation-input.js";

test("golden: the fallback wake is one compact line that asks for the startup check first", () => {
  assert.equal(
    providerActivationInput(""),
    "Run message-check --startup first.",
  );
  const handle = "AbCdEfGhIjKlMnOpQrStUv";
  assert.equal(
    providerActivationInput("", handle),
    `Run message-check --startup --turn ${handle} first.`,
  );
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
