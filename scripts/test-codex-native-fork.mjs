/** Opt-in installed CLI gate. All model requests go to a local deterministic
 * Responses fixture, never a paid provider. Does not use the user's Codex home.
 * Protocol evidence: Codex 6b9826e3, app-server tests/suite/v2/thread_fork.rs.
 * RAH-written integration test, not copied upstream implementation. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";

const executable = process.argv[2];
assert.ok(
  executable && isAbsolute(executable),
  "Pass an absolute Codex executable path",
);
const root = await mkdtemp(join(tmpdir(), "rah-native-fork-gate-"));
const requests = [];
const children = [];
const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/v1/responses") {
    res.writeHead(404).end();
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.model, "rah-local-fixture");
    assert.equal(
      req.headers.authorization,
      undefined,
      "No account credentials in fixture",
    );
    requests.push(body);
    const n = requests.length;
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      { type: "response.created", response: { id: `r${n}` } },
      {
        type: "response.output_item.done",
        item: {
          type: "message",
          role: "assistant",
          id: `m${n}`,
          content: [{ type: "output_text", text: `FAKE LOCAL REPLY ${n}` }],
        },
      },
      {
        type: "response.completed",
        response: {
          id: `r${n}`,
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        },
      },
    ])
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
// localhost also avoids macOS system proxy interception of numeric loopback.
await writeFile(
  join(root, "config.toml"),
  `
model = "rah-local-fixture"
model_provider = "rah_fixture"
[model_providers.rah_fixture]
name = "RAH LOCAL FAKE MODEL - NO BILLING"
base_url = "http://localhost:${server.address().port}/v1"
wire_api = "responses"
requires_openai_auth = false
[features]
respect_system_proxy = false
memories = false
[analytics]
enabled = false
`,
);

function launch() {
  const child = spawn(executable, ["app-server", "--listen", "stdio://"], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: root,
      CODEX_HOME: root,
      SHELL: "/bin/zsh",
      NO_PROXY: "localhost,127.0.0.1",
      no_proxy: "localhost,127.0.0.1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  const pending = new Map(),
    events = [];
  let nextId = 0,
    stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error)
        waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    } else events.push(message);
  });
  function fail(error) {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  }
  child.on("error", fail);
  child.on("exit", () => fail(new Error(`Fixture CLI exited: ${stderr}`)));
  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out: ${method}; ${stderr}`));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  return {
    rpc,
    async initialize() {
      const result = await rpc("initialize", {
        clientInfo: { name: "rah-native-fork-fixture", version: "1" },
        capabilities: { experimentalApi: true },
      });
      child.stdin.write(
        JSON.stringify({ method: "initialized", params: {} }) + "\n",
      );
      return result.userAgent;
    },
    async turn(threadId, text, extra = {}) {
      const result = await rpc("turn/start", {
        threadId,
        input: [{ type: "text", text, text_elements: [] }],
        ...extra,
      });
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const done = events.find(
          (event) =>
            event.method === "turn/completed" &&
            event.params.threadId === threadId &&
            event.params.turn.id === result.turn.id,
        );
        if (done) {
          assert.equal(
            done.params.turn.status,
            "completed",
            JSON.stringify(done.params.turn.error),
          );
          return done.params.turn.id;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Fixture turn timeout: ${stderr}`);
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, "exit");
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      child.kill("SIGTERM");
      await exited;
      clearTimeout(timer);
      lines.close();
    },
  };
}
const serialized = (request) => JSON.stringify(request);
const turns = (result) => JSON.stringify(result.thread.turns);
const check = (request, marker, expected = true) =>
  assert.equal(serialized(request).includes(marker), expected, marker);
let client;
try {
  client = launch();
  const version = await client.initialize();
  const parent = (
    await client.rpc("thread/start", {
      cwd: root,
      developerInstructions: "SOURCE_IDENTITY_ALPHA",
      modelProvider: "rah_fixture",
      approvalPolicy: "never",
      sandbox: "read-only",
    })
  ).thread;
  const cutoff = await client.turn(parent.id, "SOURCE_SHARED_CONTEXT");
  await client.turn(parent.id, "SOURCE_LATER_CONTEXT");
  await assert.rejects(
    client.rpc("thread/fork", {
      threadId: parent.id,
      lastTurnId: "00000000-0000-4000-8000-000000000001",
    }),
    /turn|not found|invalid/i,
  );
  const countBeforeFork = requests.length;
  const fork = (
    await client.rpc("thread/fork", {
      threadId: parent.id,
      lastTurnId: cutoff,
      developerInstructions: "FORK_PARAMETER_IDENTITY_BETA",
      modelProvider: "rah_fixture",
      approvalPolicy: "never",
      sandbox: "read-only",
    })
  ).thread;
  assert.notEqual(fork.id, parent.id);
  assert.equal(
    requests.length,
    countBeforeFork,
    "Fork itself must not generate",
  );
  assert.match(JSON.stringify(fork.turns), /SOURCE_SHARED_CONTEXT/);
  assert.doesNotMatch(JSON.stringify(fork.turns), /SOURCE_LATER_CONTEXT/);
  await client.turn(fork.id, "CHILD_BEFORE_REBIND");
  const bareFork = requests.at(-1);
  check(bareFork, "SOURCE_SHARED_CONTEXT");
  check(bareFork, "SOURCE_LATER_CONTEXT", false);
  const forkParameterDelivered = serialized(bareFork).includes(
    "FORK_PARAMETER_IDENTITY_BETA",
  );
  await client.turn(fork.id, "CHILD_AFTER_REBIND", {
    collaborationMode: {
      mode: "default",
      settings: {
        model: "rah-local-fixture",
        reasoning_effort: null,
        developer_instructions:
          "CHILD_IDENTITY_BETA. Prior identity belongs to the source. Do not inherit its tasks.",
      },
    },
  });
  const rebound = requests.at(-1);
  const newIdentityIndex = rebound.input.findIndex(
    (item) =>
      item.role === "developer" &&
      serialized(item).includes("CHILD_IDENTITY_BETA"),
  );
  const sourceIdentityIndex = rebound.input.findIndex(
    (item) =>
      item.role === "developer" &&
      serialized(item).includes("SOURCE_IDENTITY_ALPHA"),
  );
  assert.ok(
    newIdentityIndex > sourceIdentityIndex && sourceIdentityIndex >= 0,
    "New identity must be an actual later developer message, not only an RPC acknowledgement",
  );
  await client.close();
  client = launch();
  await client.initialize();
  const resumed = await client.rpc("thread/resume", { threadId: fork.id });
  assert.equal(resumed.thread.id, fork.id);
  await client.turn(fork.id, "CHILD_AFTER_RESTART");
  check(requests.at(-1), "CHILD_IDENTITY_BETA");
  check(requests.at(-1), "SOURCE_SHARED_CONTEXT");
  check(requests.at(-1), "CHILD_AFTER_REBIND");
  check(requests.at(-1), "SOURCE_LATER_CONTEXT", false);
  const source = await client.rpc("thread/resume", { threadId: parent.id });
  assert.doesNotMatch(turns(source), /CHILD_AFTER/);
  await client.turn(parent.id, "SOURCE_AFTER_FORK");
  check(requests.at(-1), "SOURCE_LATER_CONTEXT");
  check(requests.at(-1), "CHILD_IDENTITY_BETA", false);
  check(requests.at(-1), "CHILD_AFTER_RESTART", false);
  // Do not store complete native prompts/transcripts in repository evidence.
  console.log(
    JSON.stringify(
      {
        gate: "installed-codex-native-fork-local-model",
        version,
        modelBackend: "loopback deterministic fixture",
        paidModelRequests: 0,
        requests: requests.length,
        forkParameterDelivered,
        completedTurnCutoff: "passed",
        unknownCutoffRejected: "passed",
        distinctSessionIds: "passed",
        laterDeveloperIdentity: "passed",
        restartContinuity: "passed",
        sourceChildIsolation: "passed",
        productForkEntry: "not implemented",
      },
      null,
      2,
    ),
  );
} finally {
  await client?.close();
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
