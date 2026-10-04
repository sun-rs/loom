import assert from "node:assert/strict";
import test, { mock } from "node:test";

import {
  createClaudeFinalInterrupt,
  isAbortedClaudeResult,
  LEGACY_RECEIPT_GRACE_MS,
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

test("without an interrupt answer the legacy result is terminal 'unknown', not the final end, and the report settles within the bounded wait", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const helper = createClaudeFinalInterrupt({
      interrupt: () => new Promise(() => undefined),
    });
    helper.arm();
    assert.equal(helper.issued, true);
    assert.equal(helper.endedByInterrupt(legacy), false);
    helper.observe(legacy);
    let settled: Awaited<ReturnType<typeof helper.report>> | undefined;
    const reporting = helper.report().then((report) => (settled = report));
    await Promise.resolve();
    assert.equal(settled, undefined, "the receipt wait is still open");
    // Review of the review-2 fixes P2-2: the report is the snapshot at the
    // bound, not a wait for the driver's longer control timeout.
    mock.timers.tick(LEGACY_RECEIPT_GRACE_MS);
    const report = await reporting;
    assert.equal(report.accepted, "unknown");
    assert.equal(report.terminal, "unknown");
  } finally {
    mock.timers.reset();
  }
});

test("review-2 fixes P2-2: a lost receipt after a stated abort leaves acceptance unknown at the bound; a late receipt changes no settled report", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { helper, settle } = outstandingReceipt();
    const abortedResult = { ...legacy, terminal_reason: "aborted_tools" };
    assert.equal(helper.endedByInterrupt(abortedResult), true);
    helper.observe(abortedResult);
    const reporting = helper.report();
    mock.timers.tick(LEGACY_RECEIPT_GRACE_MS);
    const report = await reporting;
    assert.equal(report.accepted, "unknown");
    assert.equal(report.terminal, true);
    settle("refused");
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(
      report.terminal,
      true,
      "the settled snapshot is not rewritten",
    );
  } finally {
    mock.timers.reset();
  }
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

/**
 * Receipt race: under load the result is read before the receipt settles (the
 * result first on the pipe, or both in one chunk with the settlement still a
 * pending microtask). The decision waits for this interrupt's receipt, bounded.
 */
function outstandingReceipt() {
  let settle!: (outcome: "success" | "refused" | "lost") => void;
  const helper = createClaudeFinalInterrupt({
    interrupt: () =>
      new Promise((resolve, reject) => {
        settle = (outcome) =>
          outcome === "success"
            ? resolve({})
            : reject(
                Object.assign(new Error(outcome), {
                  providerRejected: outcome === "refused",
                }),
              );
      }),
  });
  helper.arm();
  return {
    helper,
    settle: (outcome: "success" | "refused" | "lost") => settle(outcome),
  };
}

test("receipt race: a legacy result read before the success receipt is the final end once the receipt lands", async () => {
  const { helper, settle } = outstandingReceipt();
  helper.observe(legacy);
  assert.equal(helper.endedByInterrupt(legacy), false);
  assert.equal(helper.awaitsReceipt(legacy), true);
  const decision = helper.endedByInterruptAfterReceipt(legacy);
  settle("success");
  assert.equal(await decision, true);
  assert.equal((await helper.report()).terminal, true);
});

test("receipt race: a refused or lost receipt after a legacy result is not the final end", async () => {
  for (const outcome of ["refused", "lost"] as const) {
    const { helper, settle } = outstandingReceipt();
    helper.observe(legacy);
    const decision = helper.endedByInterruptAfterReceipt(legacy);
    settle(outcome);
    assert.equal(await decision, false, outcome);
    assert.equal(
      (await helper.report()).terminal,
      outcome === "refused" ? false : "unknown",
    );
  }
});

test("receipt race: a success receipt beyond the bounded wait does not make the legacy result the final end", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { helper, settle } = outstandingReceipt();
    helper.observe(legacy);
    const decision = helper.endedByInterruptAfterReceipt(legacy);
    mock.timers.tick(LEGACY_RECEIPT_GRACE_MS);
    assert.equal(await decision, false);
    settle("success");
    const report = await helper.report();
    assert.equal(report.accepted, true);
    assert.equal(
      report.terminal,
      "unknown",
      "a later receipt does not rewrite it",
    );
  } finally {
    mock.timers.reset();
  }
});

test("receipt race: a stated non-abort reason never waits for the receipt", () => {
  const { helper } = outstandingReceipt();
  const failure = { ...legacy, terminal_reason: "model_error" };
  helper.observe(failure);
  assert.equal(helper.awaitsReceipt(failure), false);
});

test("native MCP final is timing evidence only; Host arm and complete result remain required", async () => {
  let interrupts = 0;
  const tracker = createClaudeFinalInterrupt({
    interrupt: async () => {
      interrupts++;
    },
  });
  tracker.observe({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "mcp-final",
          name: "mcp__loom_worker__loom_reply",
          input: { body: "FAKE", final: true },
        },
      ],
    },
  });
  tracker.observe({
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "mcp-final",
          content: "complete receipt",
        },
      ],
    },
  });
  assert.equal(interrupts, 0);
  tracker.observe({ type: "stream_event", event: { type: "message_start" } });
  tracker.arm();
  assert.equal(interrupts, 1);
  assert.equal((await tracker.report()).preemptedFollowUp, false);
});
