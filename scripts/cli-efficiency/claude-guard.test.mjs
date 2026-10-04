import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyClaudeLaunch,
  createClaudeInjectionGate,
  createClaudeOutputWatcher,
  createClaudeStdinGuard,
} from "./claude-guard.mjs";

const approved = { model: "sonnet", effort: "low" };
// The product's per-turn/warm launch (claude-stream-json-driver.mjs,
// claude-warm-driver.mjs): transport defaults + model + effort + session.
const product = [
  "--print",
  "--verbose",
  "--allow-dangerously-skip-permissions",
  "--dangerously-skip-permissions",
  "--permission-mode",
  "bypassPermissions",
  "--output-format",
  "stream-json",
  "--input-format",
  "stream-json",
  "--include-partial-messages",
  "--replay-user-messages",
  "--disallowed-tools",
  "EnterPlanMode,ExitPlanMode",
  "--append-system-prompt-file",
  "/tmp/p/room-worker.md",
  "--model",
  "sonnet",
  "--effort",
  "low",
  "--resume",
  "s-1",
];
// The product's catalog probe (model-catalog-probe.ts).
const catalog = [
  "--output-format",
  "stream-json",
  "--verbose",
  "--input-format",
  "stream-json",
  "--tools",
  "",
  "--setting-sources=",
  "--no-session-persistence",
  "--safe-mode",
];

test("launch: the product turn with the exact model and effort is a turn", () => {
  assert.equal(classifyClaudeLaunch(product, approved), "turn");
  assert.equal(classifyClaudeLaunch(["--version"], approved), "version");
  assert.equal(classifyClaudeLaunch(catalog, approved), "catalog");
  assert.equal(
    classifyClaudeLaunch(
      ["-p", "/compact", "--model=sonnet", "--effort=low", "--resume", "s"],
      approved,
    ),
    "turn",
  );
});

test("launch: missing, duplicate or other model/effort is denied", () => {
  const without = (flag) => {
    const i = product.indexOf(flag);
    return [...product.slice(0, i), ...product.slice(i + 2)];
  };
  const swap = (flag, value) =>
    product.map((a, i) => (product[i - 1] === flag ? value : a));
  for (const args of [
    without("--model"),
    without("--effort"),
    swap("--model", "opus"),
    swap("--effort", "high"),
    [...product, "--model", "sonnet"],
    [...product, "--effort=high"],
    [...product, "--fallback-model", "haiku"],
    [...product, "--fork-session"],
    product.filter((a) => a !== "--print"),
    [...catalog, "--model", "opus"],
  ])
    assert.throws(
      () => classifyClaudeLaunch(args, approved),
      /Unapproved|Unsupported/,
      JSON.stringify(args.slice(-3)),
    );
});

test("stdin: turns accept user input and interrupts only", () => {
  const guard = createClaudeStdinGuard("turn");
  guard(
    JSON.stringify({ type: "user", message: { role: "user", content: [] } }),
  );
  guard(
    JSON.stringify({
      type: "control_request",
      request_id: "r",
      request: { subtype: "interrupt", cancel_queued: true },
    }),
  );
  guard(JSON.stringify({ type: "control_response", response: {} }));
  for (const subtype of [
    "set_model",
    "set_max_thinking_tokens",
    "apply_flag_settings",
    "set_permission_mode",
  ])
    assert.throws(
      () =>
        guard(
          JSON.stringify({
            type: "control_request",
            request_id: "r",
            request: { subtype, model: "opus" },
          }),
        ),
      /Unapproved control/,
    );
  assert.throws(() => guard("not json"), /JSON/);
  assert.throws(
    () => guard(JSON.stringify({ type: "mystery" })),
    /Unsupported/,
  );
});

test("stdin: the catalog probe may only initialize, never start a turn", () => {
  const guard = createClaudeStdinGuard("catalog");
  guard(
    JSON.stringify({
      type: "control_request",
      request_id: "c",
      request: { subtype: "initialize" },
    }),
  );
  assert.throws(
    () => guard(JSON.stringify({ type: "user", message: {} })),
    /catalog/,
  );
});

function harness() {
  const child = [];
  const driver = [];
  let clock = 0;
  const timers = [];
  const gate = createClaudeInjectionGate({
    toChild: (line) => child.push(JSON.parse(line)),
    toDriver: (line) => driver.push(JSON.parse(line)),
    validate: createClaudeStdinGuard("turn"),
    now: () => clock,
    setTimer: (fn, ms) => {
      const t = { fn, at: clock + ms, done: false };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      if (t) t.done = true;
    },
  });
  const advance = (ms) => {
    clock += ms;
    for (const t of timers)
      if (!t.done && t.at <= clock) {
        t.done = true;
        t.fn();
      }
  };
  const fromDriver = (o) => gate.fromDriver(JSON.stringify(o));
  const fromChild = (o) => gate.fromChild(JSON.stringify(o));
  return { gate, child, driver, advance, fromDriver, fromChild };
}

test("injection: refused while the driver's turn is running", async () => {
  const h = harness();
  h.fromDriver({ type: "user", uuid: "u1", message: { content: [] } });
  const r = await h.gate.inject("/compact", { sessionId: "s" });
  assert.equal(r.refused, "busy");
  h.fromChild({ type: "result", subtype: "success" });
  assert.equal(h.driver.length, 1);
});

test("injection: compaction frames stay out of the driver, its input waits", async () => {
  const h = harness();
  h.fromDriver({ type: "user", uuid: "u1", message: { content: [] } });
  h.fromChild({ type: "result", subtype: "success", session_id: "s" });
  h.fromDriver({
    type: "control_request",
    request_id: "d1",
    request: { subtype: "interrupt" },
  });
  const pending = h.gate.inject("/compact", {
    sessionId: "s",
    timeoutMs: 1000,
  });
  const injected = h.child.at(-1);
  assert.equal(injected.type, "user");
  assert.equal(injected.message.content, "/compact");
  assert.equal(injected.session_id, "s");
  // Driver input during compaction is held back, not lost.
  h.fromDriver({ type: "user", uuid: "u2", message: { content: [] } });
  assert.equal(h.child.at(-1), injected);
  h.fromChild({ type: "user", uuid: injected.uuid, message: {} });
  h.fromChild({ type: "control_response", response: { request_id: "d1" } });
  h.fromChild({
    type: "system",
    subtype: "compact_boundary",
    compact_metadata: { trigger: "manual", pre_tokens: 4321 },
  });
  h.fromChild({ type: "result", subtype: "success", is_error: false });
  const r = await pending;
  assert.deepEqual(r.compactBoundary, { trigger: "manual", preTokens: 4321 });
  assert.equal(r.result.subtype, "success");
  assert.equal(r.timedOut, false);
  assert.equal(r.framesDropped, 3);
  // The driver saw only its own frames (first result + its control reply).
  assert.deepEqual(
    h.driver.map((f) => f.type),
    ["result", "control_response"],
  );
  // The held driver input was flushed after the compaction.
  assert.equal(h.child.at(-1).uuid, "u2");
});

test("injection: a boundary without a result finishes after the quiet window", async () => {
  const h = harness();
  const pending = h.gate.inject("/compact", {
    sessionId: "s",
    timeoutMs: 60_000,
    quietMs: 5_000,
  });
  h.fromChild({
    type: "system",
    subtype: "compact_boundary",
    compact_metadata: { trigger: "manual", pre_tokens: 1 },
  });
  h.advance(5_000);
  const r = await pending;
  assert.equal(r.result, null);
  assert.equal(r.timedOut, false);
  assert.ok(r.compactBoundary);
});

test("injection: timeout without a boundary is reported, input flushed", async () => {
  const h = harness();
  const pending = h.gate.inject("/compact", { sessionId: "s", timeoutMs: 100 });
  h.fromDriver({ type: "user", uuid: "u9", message: { content: [] } });
  h.advance(100);
  const r = await pending;
  assert.equal(r.timedOut, true);
  assert.equal(r.compactBoundary, null);
  assert.equal(h.child.at(-1).uuid, "u9");
  const again = await h.gate.inject("/compact", { sessionId: "s" });
  assert.equal(again.refused, "busy");
});

test("launch: an effortless (Haiku) approval needs exactly one --model and zero --effort", () => {
  const haiku = { model: "haiku", effort: null };
  const i = product.indexOf("--model");
  // The product omits --effort for a binding without effort levels.
  const haikuTurn = [
    ...product.slice(0, i),
    "--model",
    "haiku",
    ...product.slice(i + 4),
  ];
  assert.ok(!haikuTurn.includes("--effort"));
  assert.equal(classifyClaudeLaunch(haikuTurn, haiku), "turn");
  assert.equal(classifyClaudeLaunch(catalog, haiku), "catalog");
  assert.equal(classifyClaudeLaunch(["--version"], haiku), "version");
  for (const args of [
    [...haikuTurn, "--effort", "low"],
    [...haikuTurn, "--effort=low"],
    [...haikuTurn, "--effort", ""],
    [...haikuTurn, "--model", "haiku"],
    haikuTurn.map((a) => (a === "haiku" ? "sonnet" : a)),
    haikuTurn.filter((a) => a !== "--model" && a !== "haiku"),
    [...haikuTurn, "--fallback-model", "sonnet"],
  ])
    assert.throws(
      () => classifyClaudeLaunch(args, haiku),
      /Unapproved|Unsupported/,
      JSON.stringify(args.slice(-3)),
    );
});

test("launch: an approval must state its effort; only null means none", () => {
  const turn = product;
  for (const approval of [
    { model: "sonnet" },
    { model: "sonnet", effort: "" },
    { model: "sonnet", effort: undefined },
    { effort: null },
  ])
    assert.throws(
      () => classifyClaudeLaunch(turn, approval),
      /Guard needs/,
      JSON.stringify(approval),
    );
  // A non-effortless approval still refuses a launch without --effort.
  const i = product.indexOf("--effort");
  assert.throws(
    () =>
      classifyClaudeLaunch(
        [...product.slice(0, i), ...product.slice(i + 2)],
        approved,
      ),
    /Unapproved effort/,
  );
});

test("stdin: user input that starts with a slash command is refused", () => {
  const guard = createClaudeStdinGuard("turn");
  const user = (content) =>
    JSON.stringify({ type: "user", message: { role: "user", content } });
  for (const content of [
    "/model opus",
    "/effort max",
    "/fast",
    "  /model opus",
    "\n/compact",
    [{ type: "text", text: "/model opus" }],
    [
      { type: "text", text: "hello" },
      { type: "text", text: " /effort max" },
    ],
  ])
    assert.throws(
      () => guard(user(content)),
      /slash command/,
      JSON.stringify(content),
    );
  // Ordinary text, including a slash later in the text, passes.
  guard(user("read scripts/a.mjs and /tmp is fine"));
  guard(user([{ type: "text", text: "path a/b" }]));
  guard(user([{ type: "tool_result", tool_use_id: "t", content: "/x" }]));
});

test("injection: the gate's own /compact passes; the driver's /compact does not", async () => {
  const h = harness();
  assert.throws(
    () =>
      h.fromDriver({
        type: "user",
        message: { role: "user", content: "/compact" },
      }),
    /slash command/,
  );
  const pending = h.gate.inject("/compact", { sessionId: "s" });
  assert.equal(h.child.at(-1).message.content, "/compact");
  h.fromChild({ type: "result", subtype: "success" });
  assert.equal((await pending).result.subtype, "success");
});

test("output watcher: any model outside the approved family is a violation", () => {
  const watch = createClaudeOutputWatcher({ model: "haiku", effort: null });
  const line = (o) => JSON.stringify(o);
  assert.equal(
    watch(
      line({
        type: "assistant",
        message: { model: "claude-haiku-4-5-20251001", content: [] },
      }),
    ),
    undefined,
  );
  assert.equal(
    watch(
      line({
        type: "result",
        modelUsage: { "claude-haiku-4-5-20251001": { inputTokens: 1 } },
      }),
    ),
    undefined,
  );
  assert.equal(watch("not json"), undefined);
  // A sub-agent generation (parent_tool_use_id) is checked like the main one.
  assert.match(
    watch(
      line({
        type: "assistant",
        parent_tool_use_id: "toolu_1",
        message: { model: "claude-sonnet-5", content: [] },
      }),
    ),
    /Unapproved model claude-sonnet-5/,
  );
  // result.modelUsage covers background and sub-agent calls.
  assert.match(
    watch(
      line({
        type: "result",
        modelUsage: {
          "claude-haiku-4-5-20251001": {},
          "claude-opus-5-5": {},
        },
      }),
    ),
    /Unapproved model claude-opus-5-5/,
  );
  // <synthetic> assistant frames carry no generation.
  assert.equal(
    watch(line({ type: "assistant", message: { model: "<synthetic>" } })),
    undefined,
  );
});

test("MCP launch only admits the fixed internal worker entry and strict isolation", async () => {
  const { fileURLToPath } = await import("node:url");
  const config = {
    mcpServers: {
      loom_worker: {
        command: process.execPath,
        args: [
          fileURLToPath(
            new URL(
              "../../packages/agent-host/src/worker-mcp-entry.ts",
              import.meta.url,
            ),
          ),
        ],
      },
    },
  };
  const args = [
    ...product,
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify(config),
  ];
  assert.equal(classifyClaudeLaunch(args, approved), "turn");
  for (const invalid of [
    [...product, "--mcp-config", JSON.stringify(config)],
    [...args, "--mcp-config", JSON.stringify(config)],
    [...args, "--strict-mcp-config"],
    [...product, "--strict-mcp-config", "--mcp-config", "/tmp/user.json"],
    [
      ...product,
      "--strict-mcp-config",
      "--mcp-config",
      JSON.stringify({ mcpServers: { other: { command: "evil" } } }),
    ],
    ...[
      { ...config.mcpServers.loom_worker, command: "node" },
      { ...config.mcpServers.loom_worker, args: ["/tmp/evil.ts"] },
      { ...config.mcpServers.loom_worker, env: { TOKEN: "FAKE_SECRET" } },
      { ...config.mcpServers.loom_worker, type: "stdio" },
    ].map((server) => [
      ...product,
      "--strict-mcp-config",
      "--mcp-config",
      JSON.stringify({ mcpServers: { loom_worker: server } }),
    ]),
  ])
    assert.throws(() => classifyClaudeLaunch(invalid, approved), /MCP/);
});
