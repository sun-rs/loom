import assert from "node:assert/strict";
import test from "node:test";

import { createCodexFinalInterrupt } from "../src/codex-final-interrupt.js";

/**
 * The driver-side rule behind the final-reply turn end: once the Host says a
 * final reply committed, interrupt at the first moment no tool item is in
 * flight (so the posting CLI is never cut off), and report whether model
 * output or usage arrived after the last tool finished.
 */
const tool = (method: string, id = "post") => ({
  method,
  params: { item: { id, type: "commandExecution" } },
});
const delta = { method: "item/agentMessage/delta", params: { delta: "sent" } };

test("armed while the posting tool runs: interrupts at its completion, before any follow-up output", async () => {
  const calls: string[] = [];
  const tracker = createCodexFinalInterrupt({
    interrupt: async () => {
      calls.push("interrupt");
    },
  });
  tracker.observe(tool("item/started"));
  assert.equal(tracker.arm(), true);
  assert.deepEqual(calls, [], "never cuts the posting CLI off");
  tracker.observe(tool("item/completed"));
  assert.deepEqual(calls, ["interrupt"]);
  assert.equal(tracker.issued, true);
  assert.deepEqual(await tracker.report(), {
    sent: true,
    preemptedFollowUp: true,
  });
});

test("armed after the follow-up generation began: interrupts at once and reports it was not preempted", async () => {
  let interrupts = 0;
  const tracker = createCodexFinalInterrupt({
    interrupt: async () => {
      interrupts += 1;
    },
  });
  tracker.observe(tool("item/started"));
  tracker.observe(tool("item/completed"));
  tracker.observe(delta);
  tracker.arm();
  assert.equal(interrupts, 1);
  assert.equal(tracker.arm(), false, "armed once");
  tracker.observe(delta);
  assert.equal(interrupts, 1, "one interrupt per turn");
  assert.deepEqual(await tracker.report(), {
    sent: true,
    preemptedFollowUp: false,
  });
});

test("output after the interrupt was issued still means the follow-up was not preempted", async () => {
  const tracker = createCodexFinalInterrupt({ interrupt: async () => {} });
  tracker.observe(tool("item/started"));
  tracker.arm();
  tracker.observe(tool("item/completed"));
  tracker.observe({
    method: "thread/tokenUsage/updated",
    params: { tokenUsage: {} },
  });
  assert.deepEqual(await tracker.report(), {
    sent: true,
    preemptedFollowUp: false,
  });
});

test("a rejected interrupt reports not sent and unknown preemption (the turn runs on)", async () => {
  const tracker = createCodexFinalInterrupt({
    interrupt: async () => {
      throw Object.assign(new Error("turn/interrupt: no active turn"), {
        providerRejected: true,
      });
    },
  });
  tracker.arm();
  assert.deepEqual(await tracker.report(), {
    sent: false,
    preemptedFollowUp: "unknown",
  });
});

test("never armed: nothing is interrupted and the report is unknown", async () => {
  let interrupts = 0;
  const tracker = createCodexFinalInterrupt({
    interrupt: async () => {
      interrupts += 1;
    },
  });
  tracker.observe(tool("item/started"));
  tracker.observe(tool("item/completed"));
  assert.equal(interrupts, 0);
  assert.equal(tracker.armed, false);
  assert.deepEqual(await tracker.report(), {
    sent: false,
    preemptedFollowUp: "unknown",
  });
});

test("parallel tools: waits until the last one completes", () => {
  let interrupts = 0;
  const tracker = createCodexFinalInterrupt({
    interrupt: async () => {
      interrupts += 1;
    },
  });
  tracker.observe(tool("item/started", "a"));
  tracker.observe(tool("item/started", "b"));
  tracker.arm();
  tracker.observe(tool("item/completed", "a"));
  assert.equal(interrupts, 0);
  tracker.observe(tool("item/completed", "b"));
  assert.equal(interrupts, 1);
});
