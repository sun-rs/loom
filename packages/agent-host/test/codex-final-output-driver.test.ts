import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { once } from "node:events";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  acceptUnixWebSocket,
  type UnixWebSocketConnection,
} from "../src/unix-websocket.mjs";

test(
  "real Codex driver transports final evidence but excludes commentary, late frames and in-flight dynamic tools",
  { timeout: 15000 },
  async () => {
    const dir = mkdtempSync("/tmp/lcf-");
    const executable = dir + "/codex";
    writeFileSync(
      executable,
      `#!${process.execPath}\nif(process.argv[2]==='mcp')console.log('[]');else setInterval(()=>{},1000);`,
      { mode: 0o700 },
    );
    let ws: UnixWebSocketConnection | undefined;
    let turn = 0;
    let instructions = "";
    const server = createServer(async (socket) => {
      ws = await acceptUnixWebSocket(socket);
      ws.onMessage = (text) => {
        const f = JSON.parse(text);
        if (f.id === undefined) return;
        let result: unknown = {};
        if (f.method === "initialize") result = { userAgent: "FAKE" };
        if (f.method === "thread/start") {
          instructions = f.params.developerInstructions;
          result = { thread: { id: "thread-original" } };
        }
        if (f.method === "turn/start")
          result = { turn: { id: `turn-${++turn}` } };
        ws!.send(JSON.stringify({ id: f.id, result }));
      };
    });
    await new Promise<void>((r) => server.listen(dir + "/app-server.sock", r));
    const env = { ...process.env };
    delete env.LOOM_WORKER_MCP_SOCKET;
    delete env.LOOM_WORKER_MCP_SECRET;
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("../src/codex-warm-driver.mjs", import.meta.url)),
        "--executable",
        executable,
        "--tool-access-mode",
        "full_access",
        "--prompt",
        "FAKE",
        "--runtime-id",
        "runtime",
        "--host-generation",
        "generation",
        "--socket-dir",
        dir,
        "--final-output-mode",
        "enabled",
      ],
      { env, stdio: ["pipe", "pipe", "pipe", "pipe"] },
    );
    const frames: any[] = [];
    let stderr = "";
    child.stderr!.on("data", (x) => (stderr += x));
    const lines = createInterface({ input: child.stdio[3] as Readable });
    lines.on("line", (line) => frames.push(JSON.parse(line)));
    const wait = async (type: string, count: number) => {
      const end = Date.now() + 7000;
      for (;;) {
        const matches = frames.filter((f) => f.type === type);
        if (matches.length >= count) return matches[count - 1];
        if (Date.now() > end) throw Error(`timeout ${type}: ${stderr}`);
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    const notify = (method: string, params: unknown) =>
      ws!.send(JSON.stringify({ method, params }));
    try {
      await wait("ready", 1);
      assert.match(instructions, /message-post\/MCP reply requirement/);
      for (const [index, mode] of [
        "normal",
        "commentary",
        "late",
        "dynamic",
      ].entries()) {
        child.stdin!.write(
          JSON.stringify({
            op: "turn.begin",
            runAttemptId: `run-${index}`,
            text: "FAKE",
          }) + "\n",
        );
        await wait("turn.accepted", index + 1);
        const identity = {
          threadId: "thread-original",
          turnId: `turn-${index + 1}`,
        };
        if (mode === "dynamic")
          notify("item/started", {
            ...identity,
            item: { type: "dynamicToolCall", id: "pending-tool" },
          });
        const final = {
          ...identity,
          item: {
            type: "agentMessage",
            id: "final-item",
            phase: mode === "commentary" ? "commentary" : "final_answer",
            text: "opaque final text",
          },
        };
        if (mode !== "late") notify("item/completed", final);
        notify("turn/completed", {
          threadId: identity.threadId,
          turn: { id: identity.turnId, status: "completed", error: null },
        });
        if (mode === "late") notify("item/completed", final);
        const drained = await wait("turn.drained", index + 1);
        if (mode === "normal")
          assert.deepEqual(drained.finalOutputCandidate, {
            text: "opaque final text",
            nativeMessageId: "final-item",
          });
        else assert.equal(drained.finalOutputCandidate, undefined, mode);
      }
    } finally {
      child.stdin!.end();
      if (child.exitCode === null) child.kill("SIGTERM");
      await once(child, "close");
      ws?.close();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
