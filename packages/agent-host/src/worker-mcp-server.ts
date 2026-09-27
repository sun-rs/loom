import { createInterface } from "node:readline";

import carrierPackage from "../package.json" with { type: "json" };
import {
  invokeWorkerTool,
  WORKER_TOOL_DEFINITIONS,
  type WorkerToolResult,
  type WorkerToolRuntime,
} from "./worker-tool-facade.ts";

/**
 * Loom's own stdio MCP entry for the Worker tool facade (evo §57), started by
 * the Provider CLI as `"$RAH_WORKER_CLI" __worker-mcp`. Minimal by design
 * (no SDK dependency): newline-delimited JSON-RPC 2.0 with `initialize`,
 * `ping`, `tools/list` and `tools/call`; notifications are accepted silently.
 * It exposes exactly `WORKER_TOOL_DEFINITIONS`.
 *
 * Process and credential rules: it is a child of the Provider process, so it
 * lives in the Provider's process group and inherits its environment,
 * including the `LOOM_RUNTIME_ID`/`LOOM_RUN_ID` sweep labels. It holds no
 * state between calls: each call re-reads the credential path the CLI reads
 * (the per-Activation token file, or the active turn under a warm turn
 * root). No token appears in its argv or in any config it is named by.
 *
 * Never blocking: a call returns when its one Worker CLI command returns;
 * notification delivery and long waits stay with the Activation (AGENTS.md:
 * an LLM tool-call loop never owns delivery or long-term waiting).
 */
const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

export async function runWorkerMcpServer(
  io: WorkerToolRuntime & {
    stdin: NodeJS.ReadableStream;
    stdout: { write(value: string): unknown };
    invoke?: (name: string, args: unknown) => Promise<WorkerToolResult>;
  },
): Promise<0> {
  const invoke =
    io.invoke ??
    ((name: string, args: unknown) =>
      invokeWorkerTool(name, args, { env: io.env, fetch: io.fetch }));
  const reply = (message: Record<string, unknown>) =>
    io.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const pending = new Set<Promise<void>>();
  const handle = async (line: string) => {
    let request: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      )
        throw new Error("not an object");
      request = parsed as Record<string, unknown>;
    } catch {
      reply({ id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    const id = request.id;
    // A notification (no id) is never answered.
    if (id === undefined || id === null) return;
    const params =
      typeof request.params === "object" && request.params !== null
        ? (request.params as Record<string, unknown>)
        : {};
    switch (request.method) {
      case "initialize": {
        const asked = params.protocolVersion;
        reply({
          id,
          result: {
            protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(
              asked as (typeof SUPPORTED_PROTOCOL_VERSIONS)[number],
            )
              ? asked
              : SUPPORTED_PROTOCOL_VERSIONS[0],
            capabilities: { tools: {} },
            serverInfo: { name: "loom", version: carrierPackage.version },
          },
        });
        return;
      }
      case "ping":
        reply({ id, result: {} });
        return;
      case "tools/list":
        reply({ id, result: { tools: WORKER_TOOL_DEFINITIONS } });
        return;
      case "tools/call": {
        const name = params.name;
        if (!WORKER_TOOL_DEFINITIONS.some((tool) => tool.name === name)) {
          reply({
            id,
            error: { code: -32602, message: `Unknown tool: ${String(name)}` },
          });
          return;
        }
        let result: WorkerToolResult;
        try {
          result = await invoke(String(name), params.arguments ?? {});
        } catch (error) {
          result = {
            text: `error: INTERNAL_BUG: ${error instanceof Error ? error.message : String(error)}\n`,
            isError: true,
          };
        }
        reply({
          id,
          result: {
            content: [{ type: "text", text: result.text }],
            isError: result.isError,
          },
        });
        return;
      }
      default:
        reply({
          id,
          error: {
            code: -32601,
            message: `Method not found: ${String(request.method)}`,
          },
        });
    }
  };
  const input = createInterface({ input: io.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (line.trim() === "") continue;
    const work = handle(line).catch((error: unknown) => {
      process.stderr.write(
        `[loom worker-mcp] ${error instanceof Error ? error.message : String(error)}\n`,
      );
    });
    pending.add(work);
    void work.finally(() => pending.delete(work));
  }
  await Promise.all([...pending]);
  return 0;
}
