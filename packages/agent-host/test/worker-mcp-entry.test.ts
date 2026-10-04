import { KimiColdWorkerMcp } from "../src/kimi-cold-worker-mcp.ts";
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

test("cold entry restart preserves Host Run namespace and request id, never model envelope", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loom-cold-entry-")),
    socket = join(dir, "mcp.sock");
  const received: Array<{
    transportIdentity: { nonce: string; requestId: number };
  }> = [];
  let posts = 0;
  const execution = new KimiColdWorkerMcp(
    "http://127.0.0.1:1",
    async () => {
      posts++;
      return Response.json({
        activationIds: [],
        deduplicated: false,
        event: {
          eventId: "event",
          roomId: "room",
          roomSeq: 2,
          type: "message.posted",
          actorId: "instance",
          aggregateType: "message",
          aggregateId: "message",
          payload: { body: "same" },
          idempotencyKey: "key",
          schemaVersion: 1,
          createdAt: "2026-10-04T00:00:00.000Z",
        },
      });
    },
    {
      runAttemptId: "same-run",
      accessToken: "fixture-token",
      isActive: () => true,
    },
    "11111111-1111-4111-8111-111111111111",
  );
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    received.push(JSON.parse(raw));
    res.end(JSON.stringify(await execution.call(JSON.parse(raw))));
  });
  await new Promise<void>((r) => server.listen(socket, r));
  try {
    for (let phase = 0; phase < 2; phase++) {
      const child = spawn(
        process.execPath,
        [new URL("../src/worker-mcp-entry.ts", import.meta.url).pathname],
        {
          env: {
            ...process.env,
            LOOM_WORKER_MCP_SOCKET: socket,
            LOOM_WORKER_MCP_SECRET: "fixture",
            LOOM_WORKER_MCP_IDENTITY: "cold-stdio/v1",
            LOOM_WORKER_MCP_NONCE: "11111111-1111-4111-8111-111111111111",
          },
        },
      );
      const closed = new Promise<void>((r) => child.once("close", () => r()));
      const lines = createInterface({ input: child.stdout });
      try {
        for (let n = 0; n < 2; n++) {
          const reply = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(Error("entry timeout")),
              3000,
            );
            lines.once("line", () => {
              clearTimeout(timer);
              resolve();
            });
          });
          child.stdin.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              method: "tools/call",
              params: {
                name: "loom_reply",
                arguments: { body: "same", final: true },
                transportIdentity: { nonce: "FORGED", requestId: 99 },
              },
            }) + "\n",
          );
          await reply;
        }
      } finally {
        child.kill();
        await closed;
        lines.close();
      }
    }
    assert.equal(received.length, 4);
    assert.equal(
      posts,
      1,
      "entry restart replays same Run receipt rather than re-posting",
    );
    for (const r of received) {
      assert.match(r.transportIdentity.nonce, /^[a-f0-9-]{36}$/);
      assert.equal(r.transportIdentity.requestId, 2);
    }
    assert.deepEqual(
      received[0]!.transportIdentity,
      received[1]!.transportIdentity,
    );
    assert.equal(
      received[0]!.transportIdentity.nonce,
      received[2]!.transportIdentity.nonce,
    );
  } finally {
    execution.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
