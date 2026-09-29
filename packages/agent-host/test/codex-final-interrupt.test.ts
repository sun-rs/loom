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
const outcome = (report: { sent: boolean; preemptedFollowUp: unknown }) => ({
  sent: report.sent,
  preemptedFollowUp: report.preemptedFollowUp,
});

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
  assert.deepEqual(outcome(await tracker.report()), {
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
  assert.deepEqual(outcome(await tracker.report()), {
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
  assert.deepEqual(outcome(await tracker.report()), {
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
  assert.deepEqual(outcome(await tracker.report()), {
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
  assert.deepEqual(outcome(await tracker.report()), {
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
  assert.deepEqual(outcome(await tracker.report()), {
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
  assert.deepEqual(outcome(await tracker.report()), {
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
  assert.deepEqual(outcome(await tracker.report()), {
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
  assert.deepEqual(outcome(await tracker.report()), {
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

/**
 * P2-1 (2026-09-25 review). The posting call is the tool item whose command
 * is the `--final` message post; the follow-up window opens when IT completes
 * and follow-up evidence in that window is irreversible.
 */
const post = (method: string) => ({
  method,
  params: {
    item: {
      id: "post",
      type: "commandExecution",
      command: "loom-worker message-post --target '#c' --final",
    },
  },
});
const turnCompleted = (status: string) => ({
  method: "turn/completed",
  params: { threadId: "t", turn: { id: "turn", status } },
});

test("review sequence 1: the interrupt at the post's completion followed only by a late usage frame is preempted", async () => {
  const tracker = createCodexFinalInterrupt({ interrupt: async () => {} });
  tracker.observe(post("item/started"));
  tracker.arm();
  tracker.observe(post("item/completed"));
  tracker.observe(usage(1_110));
  tracker.observe(turnCompleted("interrupted"));
  assert.deepEqual(await tracker.report(), {
    requested: true,
    accepted: true,
    terminal: true,
    sent: true,
    preemptedFollowUp: true,
  });
});

test("review sequence 2: a follow-up generation observed before a later tool completed stays observed", async () => {
  const tracker = createCodexFinalInterrupt({ interrupt: async () => {} });
  tracker.observe(post("item/started"));
  tracker.observe(post("item/completed"));
  tracker.observe(delta);
  tracker.observe(tool("item/started", "later"));
  tracker.arm();
  tracker.observe(tool("item/completed", "later"));
  assert.equal((await tracker.report()).preemptedFollowUp, false);
});

test("without an identifiable posting call, output between tools makes preemption unknown, never true", async () => {
  const tracker = createCodexFinalInterrupt({ interrupt: async () => {} });
  tracker.observe(tool("item/started", "a"));
  tracker.observe(tool("item/completed", "a"));
  tracker.observe(delta);
  tracker.observe(tool("item/started", "b"));
  tracker.arm();
  tracker.observe(tool("item/completed", "b"));
  assert.equal((await tracker.report()).preemptedFollowUp, "unknown");
});

test("a tool started after the post in the same window is follow-up even after it completes", async () => {
  const tracker = createCodexFinalInterrupt({ interrupt: async () => {} });
  tracker.observe(post("item/started"));
  tracker.observe(tool("item/started", "parallel"));
  tracker.arm();
  tracker.observe(post("item/completed"));
  tracker.observe(tool("item/completed", "parallel"));
  // The parallel tool began with the posting response: not a follow-up.
  assert.equal((await tracker.report()).preemptedFollowUp, true);
});

test("requested, accepted and terminal are reported separately", async () => {
  const lost = createCodexFinalInterrupt({
    interrupt: async () => {
      throw new Error("turn/interrupt timed out");
    },
  });
  lost.observe(post("item/started"));
  lost.arm();
  lost.observe(post("item/completed"));
  lost.observe(turnCompleted("completed"));
  const report = await lost.report();
  assert.equal(report.requested, true);
  assert.equal(report.accepted, "unknown");
  assert.equal(report.terminal, false);
  // A timed-out request was still written; never "proved".
  assert.equal(report.sent, true);

  const rejected = createCodexFinalInterrupt({
    interrupt: async () => {
      throw Object.assign(new Error("no active turn"), {
        providerRejected: true,
      });
    },
  });
  rejected.arm();
  const refused = await rejected.report();
  assert.equal(refused.requested, true);
  assert.equal(refused.accepted, false);
  assert.equal(refused.terminal, "unknown");
  assert.equal(refused.sent, false);
});

test("a --final inside the heredoc body does not identify the posting call", async () => {
  const tracker = createCodexFinalInterrupt({ interrupt: async () => {} });
  const quoted = (method: string) => ({
    method,
    params: {
      item: {
        id: "note",
        type: "commandExecution",
        command:
          "loom-worker message-post --target '#c' <<'EOF'\nuse --final last\nEOF",
      },
    },
  });
  tracker.observe(quoted("item/started"));
  tracker.observe(quoted("item/completed"));
  tracker.observe(delta);
  tracker.observe(post("item/started"));
  tracker.arm();
  tracker.observe(post("item/completed"));
  // The window opened at the real post, not the earlier quoted one.
  assert.equal((await tracker.report()).preemptedFollowUp, true);
});
