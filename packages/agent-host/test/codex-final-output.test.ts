import assert from "node:assert/strict";
import test from "node:test";
import { createCodexFinalOutput } from "../src/codex-final-output.js";
const binding = { threadId: "original-thread", turnId: "original-turn" };
function item(text = "not parsed here", id = "final-item") {
  return {
    method: "item/completed",
    params: {
      ...binding,
      item: { type: "agentMessage", phase: "final_answer", id, text },
    },
  };
}
function terminal(status = "completed") {
  return {
    method: "turn/completed",
    params: {
      threadId: binding.threadId,
      turn: { id: binding.turnId, status, error: null },
    },
  };
}
test("Codex accepts exactly one completed final item of the original completed turn", () => {
  const c = createCodexFinalOutput(binding);
  c.observe(item());
  c.observe(item());
  assert.equal(c.candidate(), undefined);
  c.observe(terminal());
  assert.deepEqual(c.candidate(), {
    text: "not parsed here",
    nativeMessageId: "final-item",
  });
});
test("commentary, deltas, foreign identity and late final items never supply a candidate", () => {
  const frames = [
    { ...item(), method: "item/started" },
    {
      method: "item/completed",
      params: {
        ...binding,
        item: { ...item().params.item, phase: "commentary" },
      },
    },
    {
      method: "item/completed",
      params: { ...item().params, threadId: "foreign" },
    },
    {
      method: "item/completed",
      params: { ...item().params, turnId: "foreign" },
    },
    {
      method: "item/completed",
      params: { turnId: binding.turnId, item: item().params.item },
    },
  ];
  for (const f of frames) {
    const c = createCodexFinalOutput(binding);
    c.observe(f);
    c.observe(terminal());
    assert.equal(c.candidate(), undefined);
  }
  const c = createCodexFinalOutput(binding);
  c.observe(terminal());
  c.observe(item());
  assert.equal(c.candidate(), undefined);
});
test("ambiguous final items, conflicting repeats, bad identity/text, errors and non-completion fail closed", () => {
  for (const f of [
    item("other", "another-item"),
    item("changed"),
    item("", "final-item"),
    item("text", ""),
    item("界".repeat(21846)),
    { method: "error", params: { ...binding, error: { message: "failed" } } },
  ]) {
    const c = createCodexFinalOutput(binding);
    c.observe(item());
    c.observe(f);
    c.observe(terminal());
    assert.equal(c.candidate(), undefined);
  }
  for (const f of [
    terminal("interrupted"),
    terminal("failed"),
    { method: "turn/completed", params: { turn: terminal().params.turn } },
    {
      method: "turn/completed",
      params: {
        ...terminal().params,
        turn: { ...terminal().params.turn, error: { message: "bad" } },
      },
    },
  ]) {
    const c = createCodexFinalOutput(binding);
    c.observe(item());
    c.observe(f);
    assert.equal(c.candidate(), undefined);
  }
  assert.equal(
    createCodexFinalOutput({ threadId: "", turnId: "" }).candidate(),
    undefined,
  );
});
test("text limit is bytes, and post-terminal frames cannot replace a completed candidate", () => {
  const text = "界".repeat(21845) + "x";
  const c = createCodexFinalOutput(binding);
  c.observe(item(text));
  c.observe(terminal());
  c.observe(item("late", "other"));
  assert.equal(c.candidate()?.text, text);
});
