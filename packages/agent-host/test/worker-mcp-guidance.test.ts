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
      "\nUse loom_reply for replies to this conversation; final=true only when finished. For a new reply, set basedOnRoomSeq to the Reply context's --based-on-room-seq value. Do not guess a sequence; if delivery is incomplete, confirm it with message-check first. Other operations retain the Worker CLI. After publishing a request to a Channel peer, end your turn; Loom delivers their reply in a later wake. Native subagent wait tools (such as wait_agent) are only for your own native child agents, not Channel members.",
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

test("MCP guidance maps the delivered CLI causal marker to its JSON field", () => {
  const wake =
    '#room seq 4 msg=12345678 @human: review\nReply context: --target "#room" --turn opaque --based-on-room-seq 4';
  const guided = withWorkerMcpGuidance(wake, true);
  assert.ok(guided.startsWith(wake));
  assert.match(guided, /basedOnRoomSeq.*Reply context.*--based-on-room-seq/);
  assert.match(guided, /Do not guess a sequence/);
  assert.equal(withWorkerMcpGuidance(wake, false), wake);
});
