// Installed CLI + native tool host, localhost fake model only. No credentials
// or paid provider endpoint enters this process. Do not replace with --version.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { connectUnixWebSocket } from "../../packages/agent-host/src/unix-websocket.mjs";
import { writeGuardedShim } from "./guarded-shim.mjs";
const cache = new Map();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const digest = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
export function assertToolReceipt(items, marker) {
  assert(
    items.some(
      (x) =>
        ["custom_tool_call_output", "function_call_output"].includes(x.type) &&
        x.call_id === "probe-call" &&
        JSON.stringify(x.output).includes(marker),
    ),
    "Native tool did not read the probe file; check macOS Codex host approval before paid work",
  );
}
export function successfulBriefing(runs, pending) {
  return (
    runs.length > 0 &&
    !pending &&
    runs.every(
      (x) =>
        x.state === "exited" &&
        !x.error &&
        (x.exit_code === 0 || x.exit_code === null),
    )
  );
}
export async function ensureCodexToolPreflight({
  executable = "codex",
  model = "gpt-6-luna",
  effort = "low",
  transport = "warm",
} = {}) {
  const cli = realpathSync(
    executable.includes("/")
      ? executable
      : execFileSync("which", [executable], { encoding: "utf8" }).trim(),
  );
  const host = join(dirname(cli), "codex-code-mode-host");
  const identity = {
    cli,
    sha256: digest(cli),
    hostSha256: existsSync(host) ? digest(host) : null,
    model,
    effort,
    transport,
  };
  const key = JSON.stringify(identity);
  if (!cache.has(key))
    cache.set(
      key,
      probe(identity).catch((e) => {
        cache.delete(key);
        throw e;
      }),
    );
  return await cache.get(key);
}
async function probe(identity) {
  const root = mkdtempSync(join(tmpdir(), "loom-tool-check-")),
    home = join(root, "home"),
    cwd = join(root, "work");
  mkdirSync(home);
  mkdirSync(cwd);
  const marker = randomUUID();
  writeFileSync(join(cwd, "probe.txt"), marker);
  const receipt = {
    ...identity,
    root,
    paidCalls: 0,
    startedAt: new Date().toISOString(),
    passed: false,
  };
  let child,
    closed,
    connection,
    requests = 0,
    proof = false,
    serverError,
    stderr = "";
  const frames = [],
    pending = new Map();
  let id = 0;
  const event = (type, data) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/v1/responses");
      assert(++requests <= 2, "Unexpected probe generation");
      let bytes = "";
      for await (const b of req) {
        bytes += b;
        assert(bytes.length < 8 * 1024 * 1024);
      }
      const body = JSON.parse(bytes);
      if (requests === 2) {
        assertToolReceipt(body.input, marker);
        proof = true;
      }
      const item =
        requests === 1
          ? {
              type: "custom_tool_call",
              id: "probe-tool",
              status: "completed",
              call_id: "probe-call",
              name: "exec",
              input: `const r=await tools.exec_command(${JSON.stringify({ cmd: "cat probe.txt", workdir: cwd, max_output_tokens: 1000 })});text(r.output);`,
            }
          : {
              type: "message",
              role: "assistant",
              phase: "final_answer",
              id: "probe-final",
              status: "completed",
              content: [
                { type: "output_text", text: "Local tool probe finished." },
              ],
            };
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        event("response.created", {
          response: { id: "probe-response-" + requests },
        }),
      );
      res.write(event("response.output_item.added", { output_index: 0, item }));
      res.write(event("response.output_item.done", { output_index: 0, item }));
      res.end(
        event("response.completed", {
          response: {
            id: "probe-response-" + requests,
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              total_tokens: 120,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
          },
        }),
      );
    } catch (e) {
      serverError = e;
      res.writeHead(400);
      res.end("Local probe refused");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  writeFileSync(
    join(home, "config.toml"),
    `model_provider="loopback_fixture"\nmodel=${JSON.stringify(identity.model)}\nmodel_reasoning_effort=${JSON.stringify(identity.effort)}\nproject_doc_max_bytes=0\napproval_policy="never"\nsandbox_mode="danger-full-access"\n[model_providers.loopback_fixture]\nname="LOCAL FAKE ONLY"\nbase_url="http://localhost:${server.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=0\nstream_max_retries=0\n[features]\nmemories=false\ngoals=false\n[memories]\ngenerate_memories=false\nuse_memories=false\n`,
  );
  const env = {
    HOME: home,
    CODEX_HOME: home,
    PATH: process.env.PATH,
    USER: process.env.USER,
    SHELL: "/bin/zsh",
    NO_PROXY: "*",
    no_proxy: "*",
  };
  const socket = join(root, "app.sock");
  try {
    let executable = identity.cli,
      args;
    if (identity.transport === "warm") {
      executable = writeGuardedShim({
        provider: "codex",
        path: join(root, "guard.mjs"),
        realCli: identity.cli,
        model: identity.model,
        effort: identity.effort,
      });
      args = ["app-server", "--listen", "unix://" + socket];
    } else {
      assert.equal(identity.transport, "exec");
      args = [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "Use the native execution tool to read probe.txt.",
      ];
    }
    child = spawn(executable, args, {
      cwd,
      env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    closed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    if (identity.transport === "exec") child.stdin.end();
    child.stdout.resume();
    child.stderr.on("data", (b) => {
      stderr = (stderr + b).slice(-6000);
    });
    const deadline = Date.now() + 60000;
    if (identity.transport === "warm") {
      while (!existsSync(socket)) {
        assert(child.exitCode === null, "Codex probe exited before socket");
        assert(Date.now() < deadline, "Codex probe socket timeout");
        await delay(25);
      }
      connection = await connectUnixWebSocket(socket, { timeoutMs: 10000 });
      connection.onMessage = (text) => {
        const frame = JSON.parse(text);
        frames.push(frame);
        if (frame.id !== undefined && !frame.method) {
          const p = pending.get(frame.id);
          if (p) {
            pending.delete(frame.id);
            frame.error
              ? p.reject(Error(JSON.stringify(frame.error)))
              : p.resolve(frame.result);
          }
        } else if (frame.id !== undefined)
          connection.send(
            JSON.stringify({
              id: frame.id,
              error: {
                code: -32601,
                message: "Probe refuses unexpected requests",
              },
            }),
          );
      };
      const request = (method, params) =>
        new Promise((resolve, reject) => {
          const n = ++id;
          pending.set(n, { resolve, reject });
          connection.send(JSON.stringify({ id: n, method, params }));
        });
      let timer;
      try {
        await Promise.race([
          (async () => {
            await request("initialize", {
              clientInfo: { name: "loom-free-tool-check", version: "1" },
              capabilities: { experimentalApi: true },
            });
            connection.send(
              JSON.stringify({ method: "initialized", params: {} }),
            );
            const t = await request("thread/start", {
              model: identity.model,
              cwd,
              approvalPolicy: "never",
              sandbox: "danger-full-access",
              config: {
                model_reasoning_effort: identity.effort,
                "features.memories": false,
                "memories.generate_memories": false,
                "memories.use_memories": false,
              },
            });
            const turn = await request("turn/start", {
              threadId: t.thread.id,
              input: [
                {
                  type: "text",
                  text: "Use the native tool to read probe.txt.",
                },
              ],
              model: identity.model,
              effort: identity.effort,
            });
            while (
              !frames.some(
                (f) =>
                  f.method === "turn/completed" &&
                  f.params?.threadId === t.thread.id &&
                  f.params?.turn?.id === turn.turn.id,
              )
            ) {
              if (serverError) throw serverError;
              assert(
                Date.now() < deadline,
                "Tool probe timeout: check native host approval",
              );
              await delay(25);
            }
            assert.equal(
              frames.find(
                (f) =>
                  f.method === "turn/completed" &&
                  f.params?.turn?.id === turn.turn.id,
              ).params.turn.status,
              "completed",
            );
          })(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(Error("Tool preflight timed out; paid launch blocked")),
              60000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    } else {
      let timer;
      try {
        const exit = await Promise.race([
          closed,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error("Native exec tool preflight timeout")),
              60000,
            );
          }),
        ]);
        assert.equal(exit.code, 0);
      } finally {
        clearTimeout(timer);
      }
    }
    if (serverError) throw serverError;
    assert(proof && requests === 2, "No actual native tool receipt");
    receipt.passed = true;
  } catch (e) {
    receipt.error = String(e);
    throw e;
  } finally {
    // Close the client first: a live WebSocket can keep the guarded server draining.
    connection?.close();
    if (child) {
      child.stdin.end();
      if (child.exitCode === null) child.kill("SIGTERM");
      let timer;
      try {
        receipt.exit = await Promise.race([
          closed,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error("Probe cleanup timeout")),
              5000,
            );
          }),
        ]);
      } catch (e) {
        receipt.passed = false;
        receipt.cleanupError = String(e);
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
        await closed;
      } finally {
        clearTimeout(timer);
      }
    }
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    receipt.requests = requests;
    receipt.stderr = stderr;
    receipt.finishedAt = new Date().toISOString();
    writeFileSync(
      join(root, "receipt.json"),
      JSON.stringify(receipt, null, 2),
      { mode: 0o600 },
    );
  }
  assert(receipt.passed, "Native tool preflight cleanup failed");
  return receipt;
}
