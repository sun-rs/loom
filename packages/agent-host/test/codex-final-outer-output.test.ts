import assert from "node:assert/strict";
import test from "node:test";
import { createCodexFinalInterrupt } from "../src/codex-final-interrupt.js";

const raw = (
  type: string,
  call = "outer",
  text = "Script completed\nWall time 0.2 seconds\nOutput:\n",
  turnId = "turn",
) => ({
  method: "rawResponseItem/completed",
  params: {
    threadId: "thread",
    turnId,
    item: {
      type,
      name: "exec",
      call_id: call,
      output: [{ type: "input_text", text }],
    },
  },
});
const inner = (method: string, type: string) => ({
  method,
  params: { item: { type, id: "inner" } },
});
function setup(expectOuterOutput = true) {
  let calls = 0;
  const tracker = createCodexFinalInterrupt({
    expectOuterOutput,
    interrupt: async () => {
      calls++;
    },
  });
  return { tracker, calls: () => calls };
}
for (const type of [
  "commandExecution",
  "mcpToolCall",
  "dynamicToolCall",
  "fileChange",
  "webSearch",
  "collabAgentToolCall",
]) {
  test(`${type}: Host arm and inner completion wait for correlated outer output`, () => {
    const { tracker, calls } = setup();
    tracker.observe(raw("custom_tool_call"));
    tracker.observe(inner("item/started", type));
    tracker.arm();
    tracker.observe(inner("item/completed", type));
    assert.equal(calls(), 0);
    tracker.observe(raw("custom_tool_call_output", "wrong"));
    tracker.observe(
      raw("custom_tool_call_output", "outer", undefined, "other-turn"),
    );
    assert.equal(calls(), 0);
    tracker.observe(raw("custom_tool_call_output"));
    assert.equal(calls(), 1);
  });
}
test("late raw start cannot turn missing raw into shell fallback", () => {
  const { tracker, calls } = setup();
  tracker.observe(inner("item/started", "commandExecution"));
  tracker.arm();
  tracker.observe(inner("item/completed", "commandExecution"));
  assert.equal(calls(), 0);
  tracker.observe(raw("custom_tool_call"));
  assert.equal(calls(), 0);
  tracker.observe(raw("custom_tool_call_output"));
  assert.equal(calls(), 1);
});
test("all observed outer calls must complete; raw output never arms Host", () => {
  const { tracker, calls } = setup();
  tracker.observe(raw("custom_tool_call", "a"));
  tracker.observe(raw("custom_tool_call", "b"));
  tracker.observe(raw("custom_tool_call_output", "a"));
  tracker.arm();
  assert.equal(calls(), 0);
  tracker.observe(raw("custom_tool_call_output", "b"));
  assert.equal(calls(), 1);
  const unarmed = setup();
  unarmed.tracker.observe(raw("custom_tool_call"));
  unarmed.tracker.observe(raw("custom_tool_call_output"));
  assert.equal(unarmed.calls(), 0);
});
test("yield or missing completion envelope conservatively disables early interrupt", () => {
  for (const text of ["Script running with cell ID 42", "", "FAKE_RECEIPT"]) {
    const { tracker, calls } = setup();
    tracker.observe(raw("custom_tool_call"));
    tracker.arm();
    tracker.observe(raw("custom_tool_call_output", "outer", text));
    assert.equal(calls(), 0);
  }
});
test("outer output before inner completion still waits for inner", () => {
  const { tracker, calls } = setup();
  tracker.observe(raw("custom_tool_call"));
  tracker.observe(inner("item/started", "dynamicToolCall"));
  tracker.arm();
  tracker.observe(raw("custom_tool_call_output"));
  assert.equal(calls(), 0);
  tracker.observe(inner("item/completed", "dynamicToolCall"));
  assert.equal(calls(), 1);
});
test("observed raw protects legacy option; MCP without raw cannot assume shell", () => {
  const { tracker, calls } = setup(false);
  tracker.observe(raw("custom_tool_call"));
  tracker.arm();
  assert.equal(calls(), 0);
  tracker.observe(raw("custom_tool_call_output"));
  assert.equal(calls(), 1);
  const missing = setup(false);
  missing.tracker.observe(inner("item/started", "mcpToolCall"));
  missing.tracker.arm();
  missing.tracker.observe(inner("item/completed", "mcpToolCall"));
  assert.equal(missing.calls(), 0);
});

for (const type of [
  "commandExecution",
  "mcpToolCall",
  "dynamicToolCall",
  "fileChange",
  "webSearch",
  "collabAgentToolCall",
]) {
  test(`a later ${type} cannot borrow a previous cell's completed output`, () => {
    const { tracker, calls } = setup();
    tracker.observe(raw("custom_tool_call", "cell-a"));
    tracker.observe(inner("item/started", type));
    tracker.observe(inner("item/completed", type));
    tracker.observe(raw("custom_tool_call_output", "cell-a"));
    tracker.observe(inner("item/started", type));
    tracker.arm();
    tracker.observe(inner("item/completed", type));
    assert.equal(
      calls(),
      0,
      "cell A does not prove cell B's missing outer output",
    );
    tracker.observe(raw("custom_tool_call_output", "cell-a"));
    assert.equal(calls(), 0, "duplicate old output cannot restore proof");
    tracker.observe(raw("custom_tool_call", "cell-a"));
    tracker.observe(raw("custom_tool_call_output", "cell-a"));
    assert.equal(calls(), 0, "replayed old call cannot supply fresh proof");
    tracker.observe(raw("custom_tool_call", "cell-b"));
    assert.equal(calls(), 0);
    tracker.observe(raw("custom_tool_call_output", "cell-b"));
    assert.equal(calls(), 1);
  });
}

test("multiple inner tools under one pending outer have ambiguous ownership and do not interrupt", () => {
  const { tracker, calls } = setup();
  tracker.observe(raw("custom_tool_call", "cell-a"));
  tracker.observe(inner("item/started", "mcpToolCall"));
  tracker.observe(inner("item/completed", "mcpToolCall"));
  tracker.observe(inner("item/started", "dynamicToolCall"));
  tracker.arm();
  tracker.observe(inner("item/completed", "dynamicToolCall"));
  tracker.observe(raw("custom_tool_call_output", "cell-a"));
  assert.equal(
    calls(),
    0,
    "an unseen concurrent cell B cannot borrow cell A's output",
  );
});
