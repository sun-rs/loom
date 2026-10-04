import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { WORKER_REPLY_MCP_TOOL } from "@rah-os/protocol";

test("installed-style MCP stdio exposes exact schema and forwards native envelope without Worker token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loom-mcp-stdio-"));
  let received: unknown;
  let authorization: string | undefined;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    received = JSON.parse(raw);
    authorization = req.headers.authorization;
    res.end(
      JSON.stringify({
        content: [{ type: "text", text: "full result" }],
        isError: false,
      }),
    );
  });
  const socket = join(dir, "mcp.sock");
  await new Promise<void>((r) => server.listen(socket, r));
  const child = spawn(
    process.execPath,
    [new URL("../src/worker-mcp-entry.ts", import.meta.url).pathname],
    {
      env: {
        ...process.env,
        LOOM_WORKER_MCP_SOCKET: socket,
        LOOM_WORKER_MCP_SECRET: "runtime-secret",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const closed = new Promise<void>((r) => child.once("close", () => r()));
  const pending = new Map<number, (value: any) => void>();
  let id = 0;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const v = JSON.parse(line);
    pending.get(v.id)?.(v);
  });
  const call = (method: string, params = {}) =>
    new Promise<any>((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(() => reject(Error("stdio MCP timeout")), 3000);
      pending.set(key, (value) => {
        clearTimeout(timer);
        pending.delete(key);
        resolve(value);
      });
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: key, method, params }) + "\n",
      );
    });
  try {
    const init = await call("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    assert.equal(init.result.protocolVersion, "2025-11-25");
    assert.deepEqual((await call("tools/list")).result.tools, [
      WORKER_REPLY_MCP_TOOL,
    ]);
    const params = {
      name: "loom_reply",
      arguments: { body: "done", final: true },
      _meta: { native: "untouched" },
    };
    assert.equal(
      (await call("tools/call", params)).result.content[0].text,
      "full result",
    );
    assert.deepEqual(received, params);
    assert.equal(authorization, "Bearer runtime-secret");
    assert.equal(
      (
        await call("tools/call", {
          ...params,
          arguments: { ...params.arguments, actorId: "foreign" },
        })
      ).result.isError,
      true,
    );
    assert.deepEqual(
      received,
      params,
      "invalid arguments never reach Host bridge",
    );
  } finally {
    child.stdin.end();
    child.kill();
    await closed;
    await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
