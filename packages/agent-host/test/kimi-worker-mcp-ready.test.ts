import assert from "node:assert/strict";
import test from "node:test";
import { KimiWorkerMcpReady } from "../src/kimi-worker-mcp-ready.js";
test("native advertised local /mcp must report exactly connected one internal tool before business prompt", async () => {
  const ready = new KimiWorkerMcpReady();
  let calls = 0;
  const request = async (method: string, params: any) => {
    calls++;
    assert.equal(method, "session/prompt");
    assert.deepEqual(params.prompt, [{ type: "text", text: "/mcp" }]);
    ready.observe({
      method: "session/update",
      params: {
        sessionId: "same",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "MCP servers (1):\n- loom_worker (stdio): connected, 1 tools",
          },
        },
      },
    });
    return { stopReason: "end_turn" };
  };
  await assert.rejects(ready.wait("same", request), /advertised/);
  assert.equal(calls, 0);
  ready.observe({
    method: "session/update",
    params: {
      sessionId: "same",
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "mcp" }],
      },
    },
  });
  await ready.wait("same", request);
  assert.equal(calls, 1);
  await assert.rejects(ready.wait("foreign", request), /advertised/);
});
test("failed/missing/extra tool status fails closed without another business request", async () => {
  const ready = new KimiWorkerMcpReady();
  ready.observe({
    method: "session/update",
    params: {
      sessionId: "same",
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "mcp" }],
      },
    },
  });
  await assert.rejects(
    ready.wait("same", async () => {
      ready.observe({
        method: "session/update",
        params: {
          sessionId: "same",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: "MCP servers (1):\n- loom_worker (stdio): failed, 0 tools",
            },
          },
        },
      });
      return { stopReason: "end_turn" };
    }),
    /not connected/,
  );
});
