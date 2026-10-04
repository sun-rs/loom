/** Native init proves advertised transport readiness, not tool schema or delivery. */
export function assertClaudeWorkerMcpReady(frame) {
  const tools = Array.isArray(frame.tools)
    ? frame.tools.filter(
        (name) =>
          typeof name === "string" && name.startsWith("mcp__loom_worker__"),
      )
    : [];
  const servers = Array.isArray(frame.mcp_servers)
    ? frame.mcp_servers.filter((server) => server?.name === "loom_worker")
    : [];
  if (
    tools.length !== 1 ||
    tools[0] !== "mcp__loom_worker__loom_reply" ||
    servers.length !== 1 ||
    servers[0].status !== "connected"
  )
    throw new Error(
      "Loom Worker MCP was not advertised as connected with its reply tool",
    );
}
