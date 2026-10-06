import assert from "node:assert/strict";
import test from "node:test";
import type { Readable } from "node:stream";
import type { UnixWebSocketConnection } from "../src/unix-websocket.mjs";
import {
  codexWorkerMcpConfig,
  verifyCodexWorkerMcpReady,
} from "../src/codex-worker-mcp-config.mjs";
const env = {
  LOOM_WORKER_MCP_SOCKET: "/tmp/loom-test.sock",
  LOOM_WORKER_MCP_SECRET: "secret-never-in-argv",
};
const tool = {
  name: "loom_reply",
  description: "fixture",
  inputSchema: {
    type: "object",
    properties: { body: { type: "string" } },
    required: ["body"],
    additionalProperties: false,
  },
};
const ready = {
  data: [
    {
      name: "loom_worker",
      runtimeStatus: "connected",
      tools: { loom_reply: tool },
    },
  ],
  nextCursor: null,
};
test("optional internal MCP config requires both bindings and never copies secret into CLI args", () => {
  assert.equal(codexWorkerMcpConfig({}), undefined);
  for (const bad of [
    { LOOM_WORKER_MCP_SOCKET: env.LOOM_WORKER_MCP_SOCKET },
    { LOOM_WORKER_MCP_SECRET: env.LOOM_WORKER_MCP_SECRET },
    { ...env, LOOM_WORKER_MCP_SOCKET: "relative.sock" },
  ])
    assert.throws(() => codexWorkerMcpConfig(bad));
  const c = codexWorkerMcpConfig(env);
  assert.ok(c);
  assert.equal(
    JSON.stringify(c.args).includes(env.LOOM_WORKER_MCP_SECRET),
    false,
  );
  assert.ok(
    c.args.includes(
      'mcp_servers.loom_worker.omit_tools_from=["code_mode","deferred"]',
    ),
  );
  assert.ok(
    c.args.includes(
      'mcp_servers.loom_worker.env_vars=["LOOM_WORKER_MCP_SOCKET","LOOM_WORKER_MCP_SECRET"]',
    ),
  );
  assert.ok(
    c.args.some((x) => x.startsWith("mcp_servers.loom_worker.command=")),
  );
  assert.ok(c.args.some((x) => x.includes("worker-mcp-entry.ts")));
});
test("startup verifies only this native thread/server and exact canonical tool schema", async () => {
  const calls: unknown[][] = [];
  await verifyCodexWorkerMcpReady(
    async (...args) => {
      calls.push(args);
      return ready;
    },
    "original-thread",
    tool,
  );
  assert.deepEqual(calls, [
    [
      "mcpServerStatus/list",
      { threadId: "original-thread", serverName: "loom_worker" },
    ],
  ]);
});
test("missing, disconnected, broken, or incompatible tools fail closed without leaking diagnostics", async () => {
  for (const response of [
    { data: [] },
    { data: {} },
    { data: [null] },
    { data: [{ ...ready.data[0], name: "other" }] },
    { data: [{ ...ready.data[0], runtimeStatus: "connecting" }] },
    { data: [{ ...ready.data[0], toolsError: "secret-never-in-argv" }] },
    { data: [{ ...ready.data[0], tools: {} }] },
    {
      data: [
        {
          ...ready.data[0],
          tools: { loom_reply: { ...tool, inputSchema: { type: "object" } } },
        },
      ],
    },
  ]) {
    await assert.rejects(
      verifyCodexWorkerMcpReady(async () => response, "t", tool),
      (e: unknown) =>
        e instanceof Error &&
        e.message.includes("Loom Worker MCP") &&
        !e.message.includes(env.LOOM_WORKER_MCP_SECRET),
    );
  }
  await assert.rejects(
    verifyCodexWorkerMcpReady(
      async () => {
        throw Error(env.LOOM_WORKER_MCP_SECRET);
      },
      "t",
      tool,
    ),
    (e: unknown) =>
      e instanceof Error && !e.message.includes(env.LOOM_WORKER_MCP_SECRET),
  );
});

test("real warm driver gates fresh/resumed readiness on thread-scoped MCP schema verification", async () => {
  const { spawn } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { createServer } = await import("node:net");
  const { createInterface } = await import("node:readline");
  const { fileURLToPath } = await import("node:url");
  const { acceptUnixWebSocket } = await import("../src/unix-websocket.mjs");
  const { WORKER_REPLY_MCP_TOOL } = await import("@rah-os/protocol");
  for (const [resume, compatible, reserved] of [
    [false, true],
    [true, true],
    [true, false],
    [false, true, true],
  ]) {
    const dir = mkdtempSync("/tmp/lwm-");
    const executable = dir + "/fake-codex";
    writeFileSync(
      executable,
      `#!${process.execPath}\nif(process.argv[2]==='mcp'){process.stdout.write(${reserved ? `JSON.stringify([{name:'loom_worker',enabled:!process.argv.includes('mcp_servers.loom_worker.enabled=false')}])` : `'[]'`});}else{setInterval(()=>{},1000);}`,
      { mode: 0o700 },
    );
    const requests: { method: string; params: unknown }[] = [];
    let connection: UnixWebSocketConnection | undefined;
    const server = createServer(async (socket) => {
      const ws = await acceptUnixWebSocket(socket);
      connection = ws;
      ws.onMessage = (text) => {
        const f = JSON.parse(text);
        if (f.id === undefined) return;
        requests.push(f);
        let result;
        if (f.method === "initialize") result = { userAgent: "FAKE" };
        else if (f.method === "thread/start" || f.method === "thread/resume")
          result = { thread: { id: "same-native-thread" } };
        else if (f.method === "mcpServerStatus/list")
          result = {
            data: [
              {
                name: "loom_worker",
                runtimeStatus: "connected",
                tools: {
                  loom_reply: compatible
                    ? WORKER_REPLY_MCP_TOOL
                    : {
                        ...WORKER_REPLY_MCP_TOOL,
                        inputSchema: { type: "object" },
                      },
                },
              },
            ],
          };
        else
          return ws.send(
            JSON.stringify({
              id: f.id,
              error: { code: -32601, message: "unsupported fixture method" },
            }),
          );
        ws.send(JSON.stringify({ id: f.id, result }));
      };
    });
    await new Promise<void>((resolve) =>
      server.listen(dir + "/app-server.sock", resolve),
    );
    const driver =
      process.env.LOOM_MCP_TEST_DRIVER ??
      fileURLToPath(new URL("../src/codex-warm-driver.mjs", import.meta.url));
    const child = spawn(
      process.execPath,
      [
        driver,
        "--executable",
        executable,
        "--tool-access-mode",
        "full_access",
        "--prompt",
        "FAKE",
        "--runtime-id",
        "fake-runtime",
        "--host-generation",
        "fake-generation",
        "--socket-dir",
        dir,
        ...(resume ? ["--resume-session", "same-native-thread"] : []),
      ],
      {
        env: { ...process.env, ...env },
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      },
    );
    const lines = createInterface({ input: child.stdio[3] as Readable });
    let stderr = "";
    child.stderr!.on("data", (x) => (stderr += x));
    try {
      const ready = await new Promise<{ type: string }>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("driver timeout " + stderr)),
          5000,
        );
        lines.on("line", (line) => {
          const f = JSON.parse(line);
          if (["ready", "fatal"].includes(f.type)) {
            clearTimeout(timer);
            resolve(f);
          }
        });
      });
      assert.equal(
        ready.type,
        compatible && !reserved ? "ready" : "fatal",
        JSON.stringify(ready),
      );
      assert.deepEqual(
        requests.map((r) => r.method),
        reserved
          ? []
          : [
              "initialize",
              resume ? "thread/resume" : "thread/start",
              "mcpServerStatus/list",
            ],
      );
      if (!reserved)
        assert.deepEqual(requests.at(-1)?.params, {
          threadId: "same-native-thread",
          serverName: "loom_worker",
        });
    } finally {
      const closed = new Promise<void>((resolve) =>
        child.once("close", () => resolve()),
      );
      child.stdin!.end();
      await closed;
      lines.close();
      connection?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("an enabled internal MCP refuses an existing user server of the reserved name", async () => {
  const { assertCodexWorkerMcpNamespace } =
    await import("../src/codex-worker-mcp-config.mjs");
  assert.doesNotThrow(() =>
    assertCodexWorkerMcpNamespace(undefined, ["loom_worker"]),
  );
  assert.doesNotThrow(() =>
    assertCodexWorkerMcpNamespace(codexWorkerMcpConfig(env), ["user_server"]),
  );
  assert.throws(
    () =>
      assertCodexWorkerMcpNamespace(codexWorkerMcpConfig(env), ["loom_worker"]),
    /reserved.*loom_worker/u,
  );
});
