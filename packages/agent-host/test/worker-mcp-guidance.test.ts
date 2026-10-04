import assert from "node:assert/strict";
import test from "node:test";
import { withWorkerMcpGuidance } from "../src/worker-mcp-guidance.js";
test("one shared per-turn native tool entry hint preserves original wake and is absent without Host MCP", () => {
  const wake = "#room seq 7 msg=12345678 @human: review";
  assert.equal(withWorkerMcpGuidance(wake, false), wake);
  const guided = withWorkerMcpGuidance(wake, true);
  assert.equal(
    guided,
    wake +
      "\nUse loom_reply for replies to this conversation; final=true only when finished. Other operations retain the Worker CLI.",
  );
  assert.equal(guided.startsWith(wake), true);
  assert.equal(guided.split("Use loom_reply").length - 1, 1);
});
