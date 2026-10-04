import assert from "node:assert/strict";
import test from "node:test";
import { assertClaudeWorkerMcpReady } from "../src/claude-worker-mcp-ready.js";
test("Claude init must advertise exactly the internal reply tool and connected server", () => {
  const good = {
    tools: ["Read", "mcp__loom_worker__loom_reply"],
    mcp_servers: [{ name: "loom_worker", status: "connected" }],
  };
  assert.doesNotThrow(() => assertClaudeWorkerMcpReady(good));
  for (const bad of [
    { ...good, tools: [] },
    { ...good, mcp_servers: [] },
    { ...good, mcp_servers: [{ name: "loom_worker", status: "failed" }] },
    { ...good, tools: [...good.tools, "mcp__loom_worker__other"] },
  ])
    assert.throws(() => assertClaudeWorkerMcpReady(bad));
});
