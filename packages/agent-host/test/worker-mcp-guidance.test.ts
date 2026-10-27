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
      "\nUse loom_reply for replies to this conversation; final=true only when finished. Other operations retain the Worker CLI. After publishing a request to a Channel peer, end your turn; Loom delivers their reply in a later wake. Native subagent wait tools (such as wait_agent) are only for your own native child agents, not Channel members.",
  );
  assert.equal(guided.startsWith(wake), true);
  assert.equal(guided.split("Use loom_reply").length - 1, 1);
});

test("peer handoff ends the current turn without using native subagent waiting", () => {
  const guided = withWorkerMcpGuidance("existing delivered context", true);
  assert.match(
    guided,
    /After publishing a request to a Channel peer, end your turn/,
  );
  assert.match(guided, /Loom delivers their reply in a later wake/);
  assert.match(
    guided,
    /Native subagent wait tools .*only for your own native child agents/,
  );
  assert.match(guided, /not Channel members/);
  assert.equal(withWorkerMcpGuidance("original", false), "original");
});
