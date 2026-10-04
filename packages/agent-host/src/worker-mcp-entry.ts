// Internal stdio facade. CLI-owned metadata is forwarded unchanged; the Host
// resolves original execution authority. No Worker token or current-Run lookup.
import { request } from "node:http";
import { isAbsolute } from "node:path";
import {
  WORKER_REPLY_MCP_TOOL,
  WorkerReplyMcpArgumentsSchema,
} from "@rah-os/protocol";

const socketPath = process.env.LOOM_WORKER_MCP_SOCKET;
const secret = process.env.LOOM_WORKER_MCP_SECRET;
if (!socketPath || !isAbsolute(socketPath) || !secret)
  throw Error("Loom MCP transport is not configured");
const errorResult = (message: string) => ({
  content: [{ type: "text", text: message }],
  isError: true,
});
async function invoke(params: unknown): Promise<unknown> {
  if (
    !params ||
    typeof params !== "object" ||
    !("name" in params) ||
    params.name !== "loom_reply" ||
    !("arguments" in params) ||
    !WorkerReplyMcpArgumentsSchema.safeParse(params.arguments).success
  )
    return errorResult(
      "Invalid loom_reply arguments. Supply only declared business fields; identity is supplied by the CLI.",
    );
  return await new Promise((resolve) => {
    const req = request(
      {
        socketPath,
        path: "/call",
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 9 * 1024 * 1024)
            res.destroy(Error("MCP result too large"));
          else chunks.push(chunk);
        });
        res.on("error", () =>
          resolve(
            errorResult(
              "Worker result unknown. Do not repeat the write; ask Human to verify.",
            ),
          ),
        );
        res.on("end", () => {
          try {
            resolve(
              res.statusCode === 200
                ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
                : errorResult(
                    "Worker transport refused this call; no retry was performed.",
                  ),
            );
          } catch {
            resolve(
              errorResult(
                "Worker result unknown. Do not repeat the write; ask Human to verify.",
              ),
            );
          }
        });
      },
    );
    req.setTimeout(40_000, () => req.destroy(Error("MCP request timeout")));
    req.on("error", () =>
      resolve(
        errorResult(
          "Worker transport result unknown. Do not repeat the write; ask Human to verify.",
        ),
      ),
    );
    req.end(JSON.stringify(params));
  });
}
async function handle(line: string): Promise<void> {
  let id: unknown = null;
  let response: unknown;
  try {
    const req = JSON.parse(line);
    if (!req || req.jsonrpc !== "2.0" || typeof req.method !== "string")
      throw Error("Invalid request");
    if (req.id === undefined) return;
    id = req.id;
    if (typeof id !== "string" && typeof id !== "number")
      throw Error("Invalid request id");
    let result: unknown;
    if (req.method === "initialize") {
      const version = req.params?.protocolVersion;
      result = {
        protocolVersion: [
          "2024-11-05",
          "2025-03-26",
          "2025-06-18",
          "2025-11-25",
        ].includes(version)
          ? version
          : "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "loom-worker", version: "1" },
      };
    } else if (req.method === "ping") result = {};
    else if (req.method === "tools/list")
      result = { tools: [WORKER_REPLY_MCP_TOOL] };
    else if (req.method === "tools/call") result = await invoke(req.params);
    else {
      response = {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "Unknown method" },
      };
    }
    response ??= { jsonrpc: "2.0", id, result };
  } catch {
    response = {
      jsonrpc: "2.0",
      id,
      error: { code: -32600, message: "Invalid MCP request" },
    };
  }
  // This write is transport only. It never ACKs Room delivery or completes work.
  await new Promise<void>((resolve, reject) =>
    process.stdout.write(JSON.stringify(response) + "\n", (error) =>
      error ? reject(error) : resolve(),
    ),
  );
}
let buffer = "";
let pending = 0;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) {
    process.stdin.destroy();
    process.exitCode = 1;
    return;
  }
  for (;;) {
    const end = buffer.indexOf("\n");
    if (end < 0) break;
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!line.trim()) continue;
    if (pending >= 64) {
      process.stdin.destroy();
      process.exitCode = 1;
      return;
    }
    pending++;
    void handle(line)
      .catch(() => {
        process.exitCode = 1;
      })
      .finally(() => {
        pending--;
      });
  }
});
