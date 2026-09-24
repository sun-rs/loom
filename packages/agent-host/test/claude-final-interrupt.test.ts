import assert from "node:assert/strict";
import test from "node:test";

import {
  createClaudeFinalInterrupt,
  isAbortedClaudeResult,
} from "../src/claude-final-interrupt.js";

/**
 * Seventh review P2-4: an older CLI's `error_during_execution` result without
 * `terminal_reason` is not blanket proof that the platform interrupt ended the
 * turn. Only the interrupt's own success receipt makes it one.
 */
const legacy = {
  type: "result",
  subtype: "error_during_execution",
  is_error: true,
};

test("a reason-less error_during_execution is an abort only with a correlated receipt", () => {
  assert.equal(isAbortedClaudeResult(legacy), false);
  assert.equal(
    isAbortedClaudeResult(legacy, { interruptAcknowledged: true }),
    true,
  );
  assert.equal(
    isAbortedClaudeResult({ ...legacy, terminal_reason: "aborted_tools" }),
    true,
  );
  assert.equal(
    isAbortedClaudeResult(
      { ...legacy, terminal_reason: "model_error" },
      { interruptAcknowledged: true },
    ),
    false,
    "a stated non-abort reason is never overridden by the receipt",
  );
});

test("without an interrupt answer the legacy result is terminal 'unknown', not the final end", async () => {
  const helper = createClaudeFinalInterrupt({
    interrupt: () => new Promise(() => undefined),
  });
  helper.arm();
  assert.equal(helper.issued, true);
  assert.equal(helper.endedByInterrupt(legacy), false);
  helper.observe(legacy);
  const report = await Promise.race([
    helper.report(),
    new Promise<undefined>((resolve) =>
      setTimeout(() => resolve(undefined), 50),
    ),
  ]);
  // The receipt never arrives, so report() stays pending: the caller's own
  // control timeout bounds it. The decision above is what counts.
  assert.equal(report, undefined);
});

test("with the interrupt's success receipt the legacy result is the final end", async () => {
  const helper = createClaudeFinalInterrupt({ interrupt: async () => ({}) });
  helper.arm();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(helper.endedByInterrupt(legacy), true);
  helper.observe(legacy);
  assert.equal((await helper.report()).terminal, true);
});

test("a failed interrupt answer (timeout) leaves the legacy result 'unknown'", async () => {
  const helper = createClaudeFinalInterrupt({
    interrupt: async () => {
      throw new Error("control_request interrupt timed out");
    },
  });
  helper.arm();
  await Promise.resolve();
  assert.equal(helper.endedByInterrupt(legacy), false);
  helper.observe(legacy);
  assert.equal((await helper.report()).terminal, "unknown");
});
