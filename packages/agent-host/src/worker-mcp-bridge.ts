import { KimiColdWorkerMcp } from "./kimi-cold-worker-mcp.ts";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { isAbsolute } from "node:path";
import {
  WorkerMcpTurns,
  mcpResult,
  type WorkerMcpBinding,
} from "./worker-mcp-turns.ts";

import { ClaudeColdWorkerMcp } from "./claude-cold-worker-mcp.ts";
import type {
  WorkerMcpExecutionBinding,
  McpResult,
} from "./worker-mcp-execution.ts";

/** Private runtime transport; real Worker credentials stay inside AgentHost. */
type BridgeInput = {
  socketPath: string;
  workerApiOrigin: string;
  fetch?: typeof fetch;
};
export async function createWorkerMcpBridge(input: BridgeInput) {
  const turns = new WorkerMcpTurns(input.workerApiOrigin, input.fetch ?? fetch);
  return {
    ...(await createTransport(input, turns)),
    bind: (binding: WorkerMcpBinding) => turns.bind(binding),
  };
}
export async function createClaudeColdWorkerMcpBridge(
  input: BridgeInput & { binding: WorkerMcpExecutionBinding },
) {
  return await createTransport(
    input,
    new ClaudeColdWorkerMcp(
      input.workerApiOrigin,
      input.fetch ?? fetch,
      input.binding,
    ),
  );
}
export async function createKimiColdWorkerMcpBridge(
  input: BridgeInput & {
    binding: WorkerMcpExecutionBinding;
    transportNonce: string;
  },
) {
  return await createTransport(
    input,
    new KimiColdWorkerMcp(
      input.workerApiOrigin,
      input.fetch ?? fetch,
      input.binding,
      input.transportNonce,
    ),
  );
}
async function createTransport(
  input: BridgeInput,
  turns: { call(params: unknown): Promise<McpResult>; close(): void },
) {
  if (!isAbsolute(input.socketPath)) throw Error("MCP socket must be absolute");
  const origin = new URL(input.workerApiOrigin);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== input.workerApiOrigin ||
    origin.username ||
    origin.password
  )
    throw Error("Invalid Worker origin");
  const secret = randomBytes(32).toString("base64url");
  const server = createServer(async (req, res) => {
    const supplied = Buffer.from(req.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${secret}`);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      res.writeHead(401).end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/call") {
      res.writeHead(404).end("{}");
      return;
    }
    try {
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) throw Error("Call too large");
        chunks.push(chunk);
      }
      const result = await turns.call(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(result));
    } catch {
      res
        .writeHead(400, { "content-type": "application/json" })
        .end(
          JSON.stringify(
            mcpResult(
              { error: "Invalid MCP request; no retry was performed." },
              true,
            ),
          ),
        );
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.socketPath, resolve);
  });
  await chmod(input.socketPath, 0o600);
  let closed: Promise<void> | undefined;
  return {
    env: {
      LOOM_WORKER_MCP_SOCKET: input.socketPath,
      LOOM_WORKER_MCP_SECRET: secret,
    },
    close: () =>
      (closed ??= (async () => {
        turns.close();
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await rm(input.socketPath, { force: true });
      })()),
  };
}
export type WorkerMcpBridge = Awaited<ReturnType<typeof createWorkerMcpBridge>>;
