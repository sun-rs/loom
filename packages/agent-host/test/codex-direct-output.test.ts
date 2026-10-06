import assert from "node:assert/strict";
import test from "node:test";
import { createCodexFinalInterrupt } from "../src/codex-final-interrupt.js";

const scope = { threadId: "thread", turnId: "turn" };
const receipt = "transport result, not a business completion proof";
const call = (id = "direct") => ({
  method: "rawResponseItem/completed",
  params: {
    ...scope,
    item: {
      type: "function_call",
      call_id: id,
      namespace: "mcp__loom_worker",
      name: "loom_reply",
      arguments: "{}",
    },
  },
});
const native = (completed: boolean, id = "direct") => ({
  method: completed ? "item/completed" : "item/started",
  params: {
    ...scope,
    item: {
      type: "mcpToolCall",
      id,
      server: "loom_worker",
      tool: "loom_reply",
      status: completed ? "completed" : "inProgress",
      error: null,
      result: completed ? { content: [{ type: "text", text: receipt }] } : null,
    },
  },
});
const output = (id = "direct") => ({
  method: "rawResponseItem/completed",
  params: {
    ...scope,
    item: {
      type: "function_call_output",
      call_id: id,
      output: [
        { type: "input_text", text: "Wall time: 0.01 seconds\nOutput:" },
        { type: "input_text", text: receipt },
      ],
    },
  },
});
function setup() {
  let interrupts = 0;
  const tracker = createCodexFinalInterrupt({
    expectOuterOutput: true,
    interrupt: async () => {
      interrupts++;
    },
  });
  return { tracker, count: () => interrupts };
}
const frames = () => [call(), native(false), native(true), output()];

test("direct MCP waits for native completion AND exact full raw output, Host alone arms", () => {
  for (const reversed of [false, true]) {
    const f = setup();
    f.tracker.observe(call());
    f.tracker.observe(native(false));
    f.tracker.arm();
    f.tracker.observe(reversed ? output() : native(true));
    assert.equal(f.count(), 0);
    f.tracker.observe(reversed ? native(true) : output());
    assert.equal(f.count(), 1);
  }
  const f = setup();
  frames().forEach((x) => f.tracker.observe(x));
  assert.equal(f.count(), 0);
  f.tracker.arm();
  assert.equal(f.count(), 1);
});

test("missing any direct proof never allows early stop", () => {
  for (let omitted = 0; omitted < 4; omitted++) {
    const f = setup();
    frames()
      .filter((_, i) => i !== omitted)
      .forEach((x) => f.tracker.observe(x));
    f.tracker.arm();
    assert.equal(f.count(), 0, `missing ${omitted}`);
  }
});

test("wrong scope, identity, status, envelope and result cannot prove direct completion", () => {
  const mutations: ((x: any[]) => void)[] = [
    (x) => {
      x[0].params.item.namespace = "attacker";
    },
    (x) => {
      x[0].params.item.name = "another";
    },
    (x) => {
      x[1].params.item.id = "other";
    },
    (x) => {
      x[2].params.item.server = "other";
    },
    (x) => {
      x[2].params.item.tool = "other";
    },
    (x) => {
      x[2].params.item.status = "failed";
    },
    (x) => {
      x[2].params.item.error = { message: "failed" };
    },
    (x) => {
      x[2].params.turnId = "old";
    },
    (x) => {
      x[3].params.threadId = "other";
    },
    (x) => {
      x[3].params.item.call_id = "other";
    },
    (x) => {
      delete x[3].params.turnId;
    },
    (x) => {
      x[3].params.item.output[0].text = "Script running with cell ID 1";
    },
    (x) => {
      x[3].params.item.output[1].text = "not the native result";
    },
    (x) => {
      x[3].params.item.output.push({ type: "input_text", text: "extra" });
    },
  ];
  for (const mutate of mutations) {
    const xs = frames();
    mutate(xs);
    const f = setup();
    xs.forEach((x) => f.tracker.observe(x));
    f.tracker.arm();
    assert.equal(f.count(), 0);
  }
});

test("later calls cannot borrow old direct output; ambiguous overlap stays conservative", () => {
  for (const type of ["commandExecution", "mcpToolCall", "dynamicToolCall"]) {
    const f = setup();
    frames().forEach((x) => f.tracker.observe(x));
    const item = { type, id: "next" };
    f.tracker.observe({ method: "item/started", params: { ...scope, item } });
    f.tracker.observe({ method: "item/completed", params: { ...scope, item } });
    f.tracker.observe(output());
    f.tracker.arm();
    assert.equal(f.count(), 0);
  }
  const f = setup();
  f.tracker.observe(call());
  f.tracker.observe(native(false));
  f.tracker.observe(call("parallel"));
  f.tracker.observe(native(true));
  f.tracker.observe(output());
  f.tracker.arm();
  assert.equal(f.count(), 0);
});

test("completed code-mode work may precede direct reply, but pending cell may not", () => {
  for (const complete of [false, true]) {
    const f = setup();
    f.tracker.observe({
      method: "rawResponseItem/completed",
      params: {
        ...scope,
        item: { type: "custom_tool_call", call_id: "cell", name: "exec" },
      },
    });
    if (complete)
      f.tracker.observe({
        method: "rawResponseItem/completed",
        params: {
          ...scope,
          item: {
            type: "custom_tool_call_output",
            call_id: "cell",
            output: [
              {
                type: "input_text",
                text: "Script completed\nWall time 0.01 seconds\nOutput:\n",
              },
            ],
          },
        },
      });
    frames().forEach((x) => f.tracker.observe(x));
    f.tracker.arm();
    assert.equal(f.count(), complete ? 1 : 0);
  }
});

test("duplicate old calls cannot restore proof; unknown raw functions invalidate old proof immediately", () => {
  for (const unknown of [false, true]) {
    const f = setup();
    frames().forEach((x) => f.tracker.observe(x));
    if (unknown)
      f.tracker.observe({
        ...call("next"),
        params: {
          ...scope,
          item: { ...call("next").params.item, namespace: "unknown" },
        },
      });
    else {
      f.tracker.observe(native(false));
      f.tracker.observe(native(true));
    }
    frames().forEach((x) => f.tracker.observe(x));
    f.tracker.arm();
    assert.equal(f.count(), 0);
  }
});

test("unmatched native completion and stray old code output invalidate direct proof", () => {
  for (const next of [
    {
      method: "item/completed",
      params: { ...scope, item: { type: "commandExecution", id: "unknown" } },
    },
    {
      method: "rawResponseItem/completed",
      params: {
        ...scope,
        item: {
          type: "custom_tool_call_output",
          call_id: "old-cell",
          output: [
            {
              type: "input_text",
              text: "Script completed\nWall time 0.01 seconds\nOutput:\n",
            },
          ],
        },
      },
    },
  ]) {
    const f = setup();
    frames().forEach((x) => f.tracker.observe(x));
    f.tracker.observe(next);
    f.tracker.arm();
    assert.equal(f.count(), 0);
  }
});

test("conflicting duplicate call and unknown output cannot borrow completed direct proof", () => {
  for (const next of [
    {
      ...call(),
      params: {
        ...scope,
        item: { ...call().params.item, arguments: '{"body":"different"}' },
      },
    },
    output("unseen"),
  ]) {
    const f = setup();
    frames().forEach((x) => f.tracker.observe(x));
    f.tracker.observe(next);
    f.tracker.arm();
    assert.equal(f.count(), 0);
  }
  const f = setup();
  frames().forEach((x) => f.tracker.observe(x));
  frames()
    .filter((x) => x.method !== "item/started")
    .forEach((x) => f.tracker.observe(x));
  f.tracker.arm();
  assert.equal(f.count(), 1);
});
