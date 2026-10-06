import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

/** Process-only configuration; the runtime secret stays in inherited env. */
export function codexWorkerMcpConfig(env) {
  const socket = env.LOOM_WORKER_MCP_SOCKET;
  const secret = env.LOOM_WORKER_MCP_SECRET;
  if (socket === undefined && secret === undefined) return undefined;
  if (
    typeof socket !== "string" ||
    !isAbsolute(socket) ||
    socket.includes("\0") ||
    typeof secret !== "string" ||
    secret.length === 0 ||
    /[\0\r\n]/u.test(secret)
  ) {
    throw new Error(
      "Loom Worker MCP requires an absolute socket and runtime authentication",
    );
  }
  const values = {
    command: process.execPath,
    args: [fileURLToPath(new URL("./worker-mcp-entry.ts", import.meta.url))],
    env_vars: ["LOOM_WORKER_MCP_SOCKET", "LOOM_WORKER_MCP_SECRET"],
    enabled: true,
    // Keep the single reply tool direct: no extra code-mode MCP wrapper.
    omit_tools_from: ["code_mode", "deferred"],
  };
  return {
    args: Object.entries(values).flatMap(([key, value]) => [
      "-c",
      `mcp_servers.loom_worker.${key}=${JSON.stringify(value)}`,
    ]),
  };
}

/** Inventory is transport readiness only, never delivery ACK or work completion. */
export async function verifyCodexWorkerMcpReady(request, threadId, tool) {
  let response;
  try {
    response = await request("mcpServerStatus/list", {
      threadId,
      serverName: "loom_worker",
    });
  } catch {
    throw new Error("Loom Worker MCP readiness request failed");
  }
  const servers = Array.isArray(response?.data)
    ? response.data.filter((server) => server?.name === "loom_worker")
    : [];
  const server = servers?.length === 1 ? servers[0] : undefined;
  const actual = server?.tools?.[tool.name];
  if (
    server?.runtimeStatus !== "connected" ||
    server.toolsError != null ||
    Object.keys(server.tools ?? {}).length !== 1 ||
    actual?.name !== tool.name ||
    actual.description !== tool.description ||
    !isDeepStrictEqual(actual.inputSchema, tool.inputSchema)
  ) {
    throw new Error(
      "Loom Worker MCP is unavailable or its tool schema is incompatible",
    );
  }
}

/** User config is enumerated before internal overrides, preventing TOML merging. */
export function assertCodexWorkerMcpNamespace(config, userServerNames) {
  if (config !== undefined && userServerNames.includes("loom_worker"))
    throw new Error(
      "Loom Worker MCP reserved name loom_worker conflicts with a user server",
    );
}
