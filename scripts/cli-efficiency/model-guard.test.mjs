import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCodexLaunch,
  createCodexRequestGuard,
  listenPlan,
} from "./model-guard.mjs";

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
  for (const bad of [
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
