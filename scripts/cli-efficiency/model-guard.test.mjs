import { WorkerFinalOutputEnvelopeSchema } from "@rah-os/protocol";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyCodexLaunch,
  codexThreadRecord,
  createCodexRequestGuard,
  listenPlan,
} from "./model-guard.mjs";
import { writeGuardedShim } from "./guarded-shim.mjs";

const approved = { model: "gpt-6-luna", effort: "low" };
const guard = createCodexRequestGuard(approved);
// The exact shapes the product drivers and the drift compaction client send.
const threadStart = {
  config: {
    "features.memories": false,
    "memories.generate_memories": false,
    "memories.use_memories": false,
    model_reasoning_effort: "low",
  },
  approvalPolicy: "never",
  cwd: "/tmp/w",
  developerInstructions: "rules",
  experimentalRawEvents: true,
  sandbox: "danger-full-access",
  model: "gpt-6-luna",
};
const text = [{ type: "text", text: "hi" }];
const productMessages = [
  {
    id: 1,
    method: "initialize",
    params: {
      capabilities: { experimentalApi: true },
      clientInfo: { name: "loom-codex-warm", title: "Loom", version: "1.0.0" },
    },
  },
  { method: "initialized", params: {} },
  { id: 2, method: "thread/start", params: threadStart },
  {
    id: 3,
    method: "thread/resume",
    params: { threadId: "t", ...threadStart, excludeTurns: true },
  },
  {
    id: 4,
    method: "thread/resume",
    params: {
      threadId: "t",
      model: "gpt-6-luna",
      config: {
        "features.memories": false,
        "memories.generate_memories": false,
        "memories.use_memories": false,
        "features.multi_agent": false,
        "features.goals": false,
        model_reasoning_effort: "low",
      },
      approvalPolicy: "never",
      sandbox: "read-only",
      excludeTurns: true,
    },
  },
  {
    id: 5,
    method: "turn/start",
    params: {
      clientUserMessageId: "run-1",
      input: text,
      threadId: "t",
      model: "gpt-6-luna",
      effort: "low",
    },
  },
  { id: 6, method: "turn/start", params: { input: text, threadId: "t" } },
  {
    id: 7,
    method: "turn/steer",
    params: { threadId: "t", expectedTurnId: "u", input: text },
  },
  { id: 8, method: "turn/interrupt", params: { threadId: "t", turnId: "u" } },
  { id: 9, method: "thread/compact/start", params: { threadId: "t" } },
  // Responses to server requests (approval decisions, errors).
  { id: 10, jsonrpc: "2.0", result: { decision: "decline" } },
  { id: 11, jsonrpc: "2.0", error: { code: -32602, message: "no" } },
];

test("admits exactly the requests the product and the gate actually send", () => {
  for (const m of productMessages)
    assert.doesNotThrow(() => guard(m), JSON.stringify(m));
});

test("rejects unapproved model or effort on every model-bearing request", () => {
  const bad = [
    {
      method: "thread/start",
      params: { ...threadStart, model: "gpt-6-sol" },
    },
    {
      method: "thread/resume",
      params: {
        threadId: "t",
        ...threadStart,
        config: { ...threadStart.config, model_reasoning_effort: "ultra" },
      },
    },
    { method: "thread/start", params: {} },
    { method: "thread/start", params: { ...threadStart, model: undefined } },
    {
      method: "turn/start",
      params: { input: text, threadId: "t", model: "gpt-6-sol" },
    },
    {
      method: "turn/start",
      params: { input: text, threadId: "t", effort: "high" },
    },
  ];
  for (const m of bad)
    assert.throws(() => guard(m), /Unapproved/, JSON.stringify(m));
});

test("is a whitelist: unknown methods and extra parameters are refused", () => {
  const bad = [
    { id: 1, method: "review/start", params: { threadId: "t" } },
    {
      id: 1,
      method: "config/value/write",
      params: { keyPath: "model", value: "gpt-6-sol" },
    },
    { id: 1, method: "thread/fork", params: { threadId: "t", ...threadStart } },
    { id: 1, method: "command/exec", params: { command: ["ls"] } },
    { id: 1, method: "model/list", params: {} },
    { method: "thread/unsubscribe", params: { threadId: "t" } },
    // Auto review sub-agent, service tier, and any other key.
    {
      id: 1,
      method: "thread/start",
      params: { ...threadStart, approvalsReviewer: "auto_review" },
    },
    {
      id: 1,
      method: "thread/start",
      params: { ...threadStart, serviceTier: "fast" },
    },
    {
      id: 1,
      method: "turn/start",
      params: { input: text, threadId: "t", approvalsReviewer: "auto_review" },
    },
    {
      id: 1,
      method: "turn/start",
      params: { input: text, threadId: "t", serviceTier: "fast" },
    },
    {
      id: 1,
      method: "turn/start",
      params: { input: text, threadId: "t", sandboxPolicy: { type: "x" } },
    },
    // Config keys: only the product's process switches (false) and effort.
    {
      id: 1,
      method: "thread/start",
      params: {
        ...threadStart,
        config: { ...threadStart.config, review_model: "gpt-6-sol" },
      },
    },
    {
      id: 1,
      method: "thread/start",
      params: {
        ...threadStart,
        config: { ...threadStart.config, "features.memories": true },
      },
    },
    {
      id: 1,
      method: "thread/start",
      params: { ...threadStart, approvalPolicy: "on-request" },
    },
    {
      id: 1,
      method: "thread/start",
      params: { ...threadStart, sandbox: "external" },
    },
    {
      id: 1,
      method: "thread/compact/start",
      params: { threadId: "t", model: "gpt-6-sol" },
    },
    {
      id: 1,
      method: "turn/steer",
      params: {
        threadId: "t",
        expectedTurnId: "u",
        input: [{ type: "skill", name: "x" }],
      },
    },
    {
      id: 1,
      method: "initialize",
      params: { capabilities: { experimentalApi: true }, other: 1 },
    },
    // A frame with neither method nor result/error, and a non-object.
    { id: 1 },
    { id: 1, result: {}, method: "x" },
    [],
  ];
  for (const m of bad)
    assert.throws(() => guard(m), undefined, JSON.stringify(m));
});

test("argv: only the product's subcommand forms reach the real CLI", () => {
  assert.deepEqual(classifyCodexLaunch(["--version"]), { kind: "version" });
  assert.deepEqual(classifyCodexLaunch(["debug", "models"]), {
    kind: "catalog",
  });
  assert.deepEqual(classifyCodexLaunch(["debug", "models", "--bundled"]), {
    kind: "catalog",
  });
  for (const ok of [
    ["app-server"],
    [
      "app-server",
      "-c",
      "features.memories=false",
      "-c",
      "memories.generate_memories=false",
      "-c",
      "memories.use_memories=false",
      "-c",
      "features.multi_agent=false",
      "-c",
      "features.goals=false",
      "--listen",
      "stdio://",
    ],
    ["app-server", "--listen", "unix:///s/d/app-server.sock"],
  ])
    assert.equal(classifyCodexLaunch(ok).kind, "app-server", ok.join(" "));
  // The product lists the user's MCP servers before every Codex launch
  // (read-only, no model); the verification pass adds per-name disables.
  assert.deepEqual(classifyCodexLaunch(["mcp", "list", "--json"]), {
    kind: "mcp-list",
  });
  assert.deepEqual(
    classifyCodexLaunch([
      "mcp",
      "list",
      "--json",
      "-c",
      "features.plugins=false",
      "-c",
      "mcp_servers.node_repl.enabled=false",
    ]),
    { kind: "mcp-list" },
  );
  for (const bad of [
    ["mcp", "add", "x"],
    ["mcp", "list"],
    ["mcp", "list", "--json", "-c", "model=gpt-6-sol"],
    ["mcp", "list", "--json", "--extra"],
    ["debug", "app-server", "send-message-v2", "hi"],
    ["debug", "models", "--extra"],
    ["debug"],
    ["app-server", "daemon"],
    ["app-server", "proxy"],
    ["app-server", "generate-json-schema"],
    ["app-server", "-c", "model=gpt-6-sol"],
    ["app-server", "-c", "features.memories=true"],
    ["app-server", "--enable", "multi_agent"],
    ["app-server", "--config", "features.goals=false"],
    ["app-server", "--listen", "ws://127.0.0.1:1"],
    ["app-server", "--listen"],
    ["exec", "hi"],
    ["resume"],
    [],
    ["--version", "extra"],
  ])
    assert.throws(() => classifyCodexLaunch(bad), undefined, bad.join(" "));
});

// Global personal-config isolation (2026-09-26): the product app-server
// launch carries non-boolean isolation switches and per-name MCP disables;
// the gate admits exactly those, never a re-enable or another value.
test("the product's isolation switches pass the gate's argv fence; re-enabling them does not", async () => {
  const { providerLaunchSwitches } =
    await import("../../packages/agent-host/src/provider-launch-arguments.js");
  const product = [
    "app-server",
    ...providerLaunchSwitches("codex").args,
    "-c",
    "mcp_servers.user_mcp.enabled=false",
    "--listen",
    "stdio://",
  ];
  assert.equal(classifyCodexLaunch(product).kind, "app-server");
  for (const bad of [
    ["app-server", "-c", "notify=['/x']"],
    ["app-server", "-c", 'web_search="live"'],
    ["app-server", "-c", "features.plugins=true"],
    ["app-server", "-c", "skills.include_instructions=true"],
    ["app-server", "-c", "mcp_servers.user_mcp.enabled=true"],
    ["app-server", "-c", "mcp_servers.user_mcp.command=/bin/sh"],
  ])
    assert.throws(() => classifyCodexLaunch(bad), undefined, bad.join(" "));
});

test("warm --listen unix:// is fenced by a proxy on the driver's socket path", () => {
  assert.equal(listenPlan(["app-server", "--config", "x"]), null);
  assert.deepEqual(
    listenPlan([
      "app-server",
      "-c",
      "a=1",
      "--listen",
      "unix:///s/d/app-server.sock",
    ]),
    {
      args: ["app-server", "-c", "a=1", "--listen", "unix:///s/d/u.sock"],
      listenPath: "/s/d/app-server.sock",
      upstreamPath: "/s/d/u.sock",
    },
  );
  for (const bad of [
    ["app-server", "--listen", "ws://127.0.0.1:1"],
    ["app-server", "--listen=unix:///s/a.sock"],
    ["app-server", "--listen"],
  ])
    assert.throws(() => listenPlan(bad), /listen/);
});

test("stdio listen (the per-turn Codex driver) passes through without a proxy", () => {
  assert.equal(listenPlan(["app-server", "--listen", "stdio://"]), null);
  assert.equal(listenPlan(["app-server"]), null);
  assert.throws(() =>
    listenPlan(["app-server", "--listen", "ws://127.0.0.1:1"]),
  );
});

test("the guard needs an explicit approved pair (no implicit default)", () => {
  assert.throws(() => createCodexRequestGuard({}), /model and effort/);
  assert.throws(() => createCodexRequestGuard(undefined), /model and effort/);
});

// Channel attached directories (evo status §39): the product sends
// `runtimeWorkspaceRoots = [cwd, ...attached]` on thread/start|resume.
test("channel attached directories: runtimeWorkspaceRoots of absolute paths pass on thread/start|resume", () => {
  const roots = ["/tmp/w", "/tmp/attached"];
  assert.doesNotThrow(() =>
    guard({
      id: 1,
      method: "thread/start",
      params: { ...threadStart, runtimeWorkspaceRoots: roots },
    }),
  );
  assert.doesNotThrow(() =>
    guard({
      id: 2,
      method: "thread/resume",
      params: {
        threadId: "t",
        ...threadStart,
        excludeTurns: true,
        runtimeWorkspaceRoots: roots,
      },
    }),
  );
  for (const bad of [
    [],
    "/tmp/w",
    ["relative/dir"],
    ["/tmp/w", ""],
    ["/tmp/w", 3],
  ])
    assert.throws(
      () =>
        guard({
          id: 3,
          method: "thread/start",
          params: { ...threadStart, runtimeWorkspaceRoots: bad },
        }),
      /runtimeWorkspaceRoots/,
      JSON.stringify(bad),
    );
  // Still refused on turns.
  assert.throws(
    () =>
      guard({
        id: 4,
        method: "turn/start",
        params: { input: text, threadId: "t", runtimeWorkspaceRoots: roots },
      }),
    /Unsupported gate request/,
  );
});

test("thread record: cwd and runtimeWorkspaceRoots of thread/start|resume only", () => {
  assert.deepEqual(
    codexThreadRecord(
      {
        id: 1,
        method: "thread/start",
        params: { ...threadStart, runtimeWorkspaceRoots: ["/tmp/w", "/a"] },
      },
      "t0",
    ),
    {
      kind: "thread",
      at: "t0",
      method: "thread/start",
      cwd: "/tmp/w",
      runtimeWorkspaceRoots: ["/tmp/w", "/a"],
    },
  );
  assert.deepEqual(
    codexThreadRecord(
      { id: 2, method: "thread/resume", params: { threadId: "t" } },
      "t1",
    ),
    {
      kind: "thread",
      at: "t1",
      method: "thread/resume",
      cwd: null,
      runtimeWorkspaceRoots: null,
    },
  );
  assert.equal(codexThreadRecord(productMessages[5], "t2"), null);
  assert.equal(codexThreadRecord({ id: 1, result: {} }, "t3"), null);
});

test("guarded codex (stdio): admitted thread requests are recorded; nothing else is", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loom-codex-record-"));
  try {
    const fake = join(dir, "fake-codex.mjs");
    // FAKE Codex app-server (no model): echoes each stdin line as a result.
    writeFileSync(
      fake,
      `#!/usr/bin/env node
import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (l) => {
  const m = JSON.parse(l);
  if (m.id !== undefined) process.stdout.write(JSON.stringify({ id: m.id, result: {} }) + "\\n");
});
`,
      { mode: 0o700 },
    );
    const requestRecordPath = join(dir, "requests.jsonl");
    const shim = writeGuardedShim({
      provider: "codex",
      path: join(dir, "guarded-codex.mjs"),
      realCli: fake,
      model: approved.model,
      effort: approved.effort,
      options: { requestRecordPath },
    });
    const child = spawn(shim, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    const exited = new Promise((r) => child.once("close", r));
    child.stdin.write(
      JSON.stringify({
        id: 1,
        method: "thread/start",
        params: { ...threadStart, runtimeWorkspaceRoots: ["/tmp/w", "/a"] },
      }) + "\n",
    );
    child.stdin.write(JSON.stringify(productMessages[5]) + "\n");
    await new Promise((r) => {
      const t = setInterval(() => {
        if (out.split("\n").filter(Boolean).length >= 2) {
          clearInterval(t);
          r();
        }
      }, 20);
    });
    child.stdin.end();
    await exited;
    const lines = readFileSync(requestRecordPath, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].method, "thread/start");
    assert.deepEqual(lines[0].runtimeWorkspaceRoots, ["/tmp/w", "/a"]);
    assert.equal(lines[0].cwd, "/tmp/w");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Codex gate admits only the complete exact internal Worker MCP launch group", async () => {
  const { codexWorkerMcpConfig } =
    await import("../../packages/agent-host/src/codex-worker-mcp-config.mjs");
  const group = codexWorkerMcpConfig({
    LOOM_WORKER_MCP_SOCKET: "/tmp/gate-fixture.sock",
    LOOM_WORKER_MCP_SECRET: "not-an-argv-value",
  }).args;
  const launch = ["app-server", ...group, "--listen", "stdio://"];
  assert.equal(classifyCodexLaunch(launch).kind, "app-server");
  for (let i = 0; i < group.length; i += 2) {
    assert.throws(() =>
      classifyCodexLaunch([
        "app-server",
        ...group.slice(0, i),
        ...group.slice(i + 2),
      ]),
    );
    assert.throws(() =>
      classifyCodexLaunch(["app-server", ...group, ...group.slice(i, i + 2)]),
    );
  }
  for (const extra of [
    "mcp_servers.other.enabled=true",
    "mcp_servers.loom_worker.enabled=false",
    'mcp_servers.loom_worker.url="http://127.0.0.1:1"',
    'mcp_servers.loom_worker.env={LOOM_WORKER_MCP_SECRET="secret-in-argv"}',
  ])
    assert.throws(() =>
      classifyCodexLaunch(["app-server", ...group, "-c", extra]),
    );
  for (const [key, value] of [
    ["command", '"/bin/sh"'],
    ["args", '["/tmp/other-entry.ts"]'],
    ["env_vars", '["LOOM_WORKER_MCP_SECRET"]'],
    ["omit_tools_from", "[]"],
    ["enabled", "false"],
  ]) {
    const changed = group.map((x) =>
      x.startsWith(`mcp_servers.loom_worker.${key}=`)
        ? `mcp_servers.loom_worker.${key}=${value}`
        : x,
    );
    assert.throws(() => classifyCodexLaunch(["app-server", ...changed]));
  }
  assert.throws(() => classifyCodexLaunch(["mcp", "list", "--json", ...group]));
  assert.throws(() =>
    classifyCodexLaunch([
      "app-server",
      ...group,
      "-c",
      "features.memories=true",
    ]),
  );
});
test("Codex gate admits only thread-scoped internal Worker MCP readiness reads", () => {
  const guard = createCodexRequestGuard(approved);
  assert.doesNotThrow(() =>
    guard({
      id: 1,
      method: "mcpServerStatus/list",
      params: { threadId: "original-thread", serverName: "loom_worker" },
    }),
  );
  for (const params of [
    {},
    { threadId: "t" },
    { serverName: "loom_worker" },
    { threadId: "", serverName: "loom_worker" },
    { threadId: "t", serverName: "other" },
    { threadId: "t", serverName: "loom_worker", detail: "full" },
    { threadId: "t", serverName: "loom_worker", cursor: "x" },
  ])
    assert.throws(() =>
      guard({ id: 1, method: "mcpServerStatus/list", params }),
    );
  for (const method of [
    "config/mcpServer/reload",
    "mcpServer/tool/call",
    "mcpServer/oauth/login",
  ])
    assert.throws(() =>
      guard({
        id: 1,
        method,
        params: { threadId: "t", serverName: "loom_worker" },
      }),
    );
});

const finalOutputSchema = WorkerFinalOutputEnvelopeSchema.toJSONSchema({
  target: "draft-7",
});
function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, item]) => [key, reverseObjectKeys(item)]),
    );
  return value;
}
function outputTurn(outputSchema) {
  return {
    id: 991,
    method: "turn/start",
    params: {
      ...productMessages.find((message) => message.method === "turn/start")
        .params,
      outputSchema,
    },
  };
}
test("Codex outputSchema admits only the exact Protocol shape independent of object key order", () => {
  assert.doesNotThrow(() => guard(outputTurn(finalOutputSchema)));
  assert.doesNotThrow(() =>
    guard(outputTurn(reverseObjectKeys(finalOutputSchema))),
  );
  for (const bad of [
    null,
    {},
    { type: "object" },
    { ...finalOutputSchema, additionalProperties: true },
    { ...finalOutputSchema, extra: true },
    { ...finalOutputSchema, required: ["body"] },
    {
      ...finalOutputSchema,
      properties: {
        ...finalOutputSchema.properties,
        basedOnRoomSeq: { type: "number" },
      },
    },
  ]) {
    assert.throws(() => guard(outputTurn(bad)), /outputSchema/);
  }
  for (const extra of [
    { model: "gpt-6-sol" },
    { effort: "high" },
    { unknown: true },
  ]) {
    const value = outputTurn(finalOutputSchema);
    Object.assign(value.params, extra);
    assert.throws(() => guard(value));
  }
});
test(
  "real guarded shim forwards exact final schema and blocks broad schema before the fake provider",
  { timeout: 10000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-output-schema-guard-"));
    try {
      const fake = join(dir, "fake.mjs");
      writeFileSync(
        fake,
        `#!/usr/bin/env node
import {createInterface} from 'node:readline';createInterface({input:process.stdin}).on('line',line=>console.log(line));
`,
        { mode: 0o700 },
      );
      const shim = writeGuardedShim({
        provider: "codex",
        path: join(dir, "shim.mjs"),
        realCli: fake,
        ...approved,
      });
      for (const [schema, pass] of [
        [reverseObjectKeys(finalOutputSchema), true],
        [{ type: "object" }, false],
      ]) {
        const child = spawn(shim, ["app-server", "--listen", "stdio://"], {
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (data) => (stdout += data));
        child.stderr.on("data", (data) => (stderr += data));
        const done = new Promise((resolve) => child.once("close", resolve));
        child.stdin.end(JSON.stringify(outputTurn(schema)) + "\n");
        const code = await done;
        if (pass) {
          assert.equal(code, 0, stderr);
          assert.deepEqual(JSON.parse(stdout).params.outputSchema, schema);
        } else {
          assert.equal(code, 1);
          assert.equal(stdout, "");
          assert.match(stderr, /PAID_GATE_MODEL_DENIED.*outputSchema/);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
