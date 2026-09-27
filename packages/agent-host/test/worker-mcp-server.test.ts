import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { runWorkerMcpServer, WORKER_TOOL_DEFINITIONS } from "../src/index.ts";

/**
 * The Loom-owned stdio MCP entry (evo §57): a minimal newline-delimited
 * JSON-RPC server exposing exactly the two Worker tools. It is started by the
 * Provider CLI as `"$RAH_WORKER_CLI" __worker-mcp`, inherits the Provider's
 * environment (Worker origin, turn root or per-Activation token path, sweep
 * labels) and never writes a credential anywhere.
 */
const ENTRY = fileURLToPath(
  new URL("../src/worker-cli-entry.ts", import.meta.url),
);

function lines(stream: NodeJS.ReadableStream) {
  let buffer = "";
  const queue: unknown[] = [];
  const waiters: ((value: unknown) => void)[] = [];
  stream.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim() === "") continue;
      const value = JSON.parse(line) as unknown;
      const waiter = waiters.shift();
      if (waiter) waiter(value);
      else queue.push(value);
    }
  });
  return () =>
    new Promise<Record<string, any>>((resolve) => {
      const next = queue.shift();
      if (next !== undefined) resolve(next as Record<string, any>);
      else waiters.push(resolve as (value: unknown) => void);
    });
}

test("the MCP entry negotiates, lists exactly the Worker tools and answers calls", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const calls: unknown[] = [];
  const next = lines(stdout);
  const done = runWorkerMcpServer({
    env: {},
    fetch: async () => {
      throw new Error("no network in this test");
    },
    invoke: async (name, args) => {
      calls.push({ name, args });
      return name === "message_post"
        ? { text: "Sent to #main.\n", isError: false }
        : { text: "error: INVALID_ARG\n", isError: true };
    },
    stdin,
    stdout,
  });
  const send = (value: unknown) => stdin.write(`${JSON.stringify(value)}\n`);
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "opencode", version: "1.18.32" },
    },
  });
  const init = await next();
  assert.equal(init.id, 1);
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.equal(init.result.serverInfo.name, "loom");
  // A notification gets no answer; the next answer is the list.
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: "list", method: "tools/list", params: {} });
  const list = await next();
  assert.equal(list.id, "list");
  assert.deepEqual(list.result.tools, WORKER_TOOL_DEFINITIONS);
  send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "message_post",
      arguments: { target: "#main", body: "x", final: true },
    },
  });
  const posted = await next();
  assert.deepEqual(posted, {
    jsonrpc: "2.0",
    id: 2,
    result: {
      content: [{ type: "text", text: "Sent to #main.\n" }],
      isError: false,
    },
  });
  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "message_check" },
  });
  const checked = await next();
  assert.equal(checked.result.isError, true);
  assert.deepEqual(calls, [
    { name: "message_post", args: { target: "#main", body: "x", final: true } },
    { name: "message_check", args: {} },
  ]);
  send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "x" } });
  assert.equal((await next()).error.code, -32602);
  send({ jsonrpc: "2.0", id: 5, method: "resources/list" });
  assert.equal((await next()).error.code, -32601);
  send({ jsonrpc: "2.0", id: 6, method: "ping" });
  assert.deepEqual((await next()).result, {});
  stdin.write("not json\n");
  assert.equal((await next()).error.code, -32700);
  // An older client version is answered with that version.
  send({
    jsonrpc: "2.0",
    id: 7,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" },
  });
  assert.equal((await next()).result.protocolVersion, "2024-11-05");
  stdin.end();
  assert.equal(await done, 0);
});

test("the spawned entry posts through the Worker route with the inherited credential", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loom-worker-mcp-"));
  chmodSync(directory, 0o700);
  const tokenPath = join(directory, "token");
  writeFileSync(tokenPath, "worker-secret", { mode: 0o600 });
  const received: { url: string; authorization: string; body: string }[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received.push({
        url: request.url ?? "",
        authorization: String(request.headers.authorization),
        body,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, roomSeq: 9, messageId: "m-1" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const child = spawn(process.execPath, [ENTRY, "__worker-mcp"], {
      env: {
        PATH: process.env.PATH,
        RAH_WORKER_API_URL: `http://127.0.0.1:${port}`,
        RAH_WORKER_SESSION_FILE: tokenPath,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const next = lines(child.stdout!);
    const send = (value: unknown) =>
      child.stdin!.write(`${JSON.stringify(value)}\n`);
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    assert.equal((await next()).result.serverInfo.name, "loom");
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "message_post",
        arguments: {
          target: "#main",
          body: "answer",
          based_on_room_seq: 9,
          final: true,
        },
      },
    });
    const result = await next();
    assert.equal(result.result.isError, false, JSON.stringify(result));
    assert.equal(received.length, 1);
    assert.equal(received[0]!.url, "/v1/worker/messages/post");
    assert.equal(received[0]!.authorization, "Bearer worker-secret");
    assert.deepEqual(JSON.parse(received[0]!.body), {
      channel: "#main",
      basedOnRoomSeq: 9,
      body: "answer",
      final: true,
    });
    const exited = new Promise<number | null>((resolve) =>
      child.once("close", (code) => resolve(code)),
    );
    child.stdin!.end();
    assert.equal(await exited, 0);
  } finally {
    server.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
