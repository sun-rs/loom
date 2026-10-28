import test from "node:test";
import assert from "node:assert/strict";
import {
  assertToolReceipt,
  successfulBriefing,
} from "./codex-tool-preflight.mjs";
test("requires the current native tool output, including structured output arrays", () => {
  const item = {
    type: "custom_tool_call_output",
    call_id: "probe-call",
    output: [{ type: "input_text", text: "unique-file-marker" }],
  };
  assert.doesNotThrow(() => assertToolReceipt([item], "unique-file-marker"));
  for (const input of [
    [],
    [{ type: "message", text: "unique-file-marker" }],
    [{ ...item, call_id: "old-call" }],
    [{ ...item, output: "timed out negotiating with the code-mode host" }],
  ])
    assert.throws(() => assertToolReceipt(input, "unique-file-marker"));
});
test("warm briefing completion does not require process exit; errors and pending activations refuse", () => {
  assert(
    successfulBriefing(
      [{ state: "exited", error: null, exit_code: null }],
      false,
    ),
  );
  assert(
    successfulBriefing([{ state: "exited", error: null, exit_code: 0 }], false),
  );
  for (const [runs, pending] of [
    [[], false],
    [[{ state: "running" }], false],
    [[{ state: "exited", exit_code: 1 }], false],
    [[{ state: "exited", error: "bad", exit_code: null }], false],
    [[{ state: "exited", exit_code: 0 }], true],
  ])
    assert(!successfulBriefing(runs, pending));
});
