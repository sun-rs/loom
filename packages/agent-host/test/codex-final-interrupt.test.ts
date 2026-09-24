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
  tracker.observe(delta);
  assert.deepEqual(await tracker.report(), {
    sent: true,
    preemptedFollowUp: false,
  });
});

/**
 * Usage evidence (the measured gap: every real round reported `false` while
 * zero generations followed the reply). `thread/tokenUsage/updated` carries
 * no response id and may repeat unchanged, and the usage of the generation
 * that called the posting tool may land after that tool finished. Only a
 * usage report that advances the thread total beyond every generation
 * already observed is a new (follow-up) generation.
 */
const usage = (total: number, last = 110) => ({
  method: "thread/tokenUsage/updated",
  params: {
    tokenUsage: {
      last: { totalTokens: last },
      total: { totalTokens: total },
    },
  },
});

test("an unchanged usage repeat after the interrupt is not a follow-up generation", async () => {
  const tracker = createCodexFinalInterrupt({ interrupt: async () => {} });
  tracker.observe(delta);
  tracker.observe(tool("item/started"));
  tracker.observe(usage(1_110));
  tracker.arm();
  tracker.observe(tool("item/completed"));
  tracker.observe(usage(1_110));
  assert.deepEqual(await tracker.report(), {
    sent: true,
    preemptedFollowUp: true,
  });
});

test("the posting generation's own usage arriving after the tool finished is not a follow-up", async () => {
  const tracker = createCodexFinalInterrupt({ interrupt: async () => {} });
  tracker.observe(usage(1_000));
  tracker.observe(tool("item/started"));
  tracker.arm();
  tracker.observe(tool("item/completed"));
  tracker.observe(usage(1_110));
  assert.deepEqual(await tracker.report(), {
    sent: true,
    preemptedFollowUp: true,
  });
});

test("an advancing usage report after the posting generation settled is a follow-up generation", async () => {
  const tracker = createCodexFinalInterrupt({ interrupt: async () => {} });
  tracker.observe(tool("item/started"));
  tracker.observe(usage(1_110));
  tracker.arm();
  tracker.observe(tool("item/completed"));
  tracker.observe(usage(1_300, 190));
  assert.deepEqual(await tracker.report(), {
    sent: true,
    preemptedFollowUp: false,
  });
});

test("an unreadable usage report after the tool finished makes preemption unknown", async () => {
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
    preemptedFollowUp: "unknown",
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
