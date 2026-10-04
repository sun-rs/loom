#!/usr/bin/env node
// FAKE native readiness only: this legacy CLI business-chain fixture does not
// execute MCP tools. Real entry/bridge/Worker coverage lives in agent-host tests.
// All business prompts, tool output and cancellation pass unchanged to the
// existing fake Kimi model. Match the installed ACP local /mcp branch exactly.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const child = spawn(
  process.execPath,
  [process.env.FAKE_KIMI_UPSTREAM, ...process.argv.slice(2)],
  { stdio: ["pipe", "pipe", "pipe"] },
);
const pending = new Map();
const sessions = new Set();
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const frame = JSON.parse(line);
  if (frame.method === "session/new" || frame.method === "session/resume") {
    const servers = frame.params?.mcpServers;
    const internal =
      Array.isArray(servers) &&
      servers.length === 1 &&
      servers[0].name === "loom_worker" &&
      servers[0].command === process.execPath &&
      servers[0].args?.length === 1 &&
      servers[0].args[0].endsWith("/worker-mcp-entry.ts");
    pending.set(frame.id, { internal, sessionId: frame.params.sessionId });
  }
  if (
    frame.method === "session/prompt" &&
    Array.isArray(frame.params?.prompt) &&
    frame.params.prompt.length === 1 &&
    frame.params.prompt[0].type === "text" &&
    frame.params.prompt[0].text === "/mcp"
  ) {
    const sessionId = frame.params.sessionId;
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: sessions.has(sessionId)
              ? "MCP servers (1):\n- loom_worker (stdio): connected, 1 tools"
              : "No MCP servers configured for this session.",
          },
        },
      },
    });
    send({ jsonrpc: "2.0", id: frame.id, result: { stopReason: "end_turn" } });
    return;
  }
  child.stdin.write(line + "\n");
});
createInterface({ input: child.stdout }).on("line", (line) => {
  const frame = JSON.parse(line),
    start = pending.get(frame.id);
  if (start) {
    pending.delete(frame.id);
    const sessionId = frame.result?.sessionId ?? start.sessionId;
    if (start.internal && sessionId) {
      sessions.add(sessionId);
      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "available_commands_update",
            availableCommands: [
              { name: "mcp", description: "Show MCP server status" },
            ],
          },
        },
      });
    }
  }
  process.stdout.write(line + "\n");
});
child.stderr.pipe(process.stderr);
child.on("exit", (code) => process.exit(code ?? 1));
process.stdin.on("end", () => child.stdin.end());
