import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertOpenCodeAssistants,
  assertOpenCodeServerConfig,
  classifyOpenCodeLaunch,
  createOpenCodeRequestGuard,
  createSseSessionFilter,
  openCodeCompactionEvidence,
  openCodeRequestRecord,
  openCodeVariantOptions,
  requestOpenCodeCompaction,
  withCompactionOptions,
} from "./drift-opencode-guard.mjs";
import { writeGuardedShim } from "./guarded-shim.mjs";

const approved = { model: "deepseek/deepseek-v4-flash", effort: "low" };
const model = { providerID: "deepseek", modelID: "deepseek-v4-flash" };
// The product's prompt (opencode-server-driver.mjs / opencode-warm-driver.mjs).
const prompt = {
  messageID: "msg_1",
  parts: [{ text: "wake", type: "text" }],
  model,
  variant: "low",
};
const post = (guard, path, body) =>
  guard("POST", path, body === undefined ? undefined : JSON.stringify(body));

test("request guard: prompts need the exact provider/model and variant", () => {
  const guard = createOpenCodeRequestGuard(approved);
  post(guard, "/session/ses_1/message", prompt);
  post(guard, "/session/ses_1/prompt_async", prompt);
  for (const body of [
    { ...prompt, model: undefined },
    { ...prompt, variant: undefined },
    { ...prompt, variant: "high" },
    { ...prompt, model: { ...model, modelID: "deepseek-v4-pro" } },
    { ...prompt, model: { ...model, providerID: "aihubmix" } },
    { ...prompt, model: "deepseek/deepseek-v4-flash" },
    { ...prompt, agent: "plan" },
    {
      ...prompt,
      parts: [{ type: "subtask", prompt: "x", agent: "general" }],
    },
  ])
    assert.throws(
      () => post(guard, "/session/ses_1/message", body),
      /Unapproved|Unsupported/,
      JSON.stringify(body),
    );
  assert.throws(
    () => guard("POST", "/session/ses_1/message", "not json"),
    /Unsupported/,
  );
});

test("request guard: native compaction only with the exact model; other model routes are denied", () => {
  const guard = createOpenCodeRequestGuard(approved);
  post(guard, "/session/ses_1/summarize", model);
  for (const body of [
    { providerID: "deepseek", modelID: "deepseek-v4-pro" },
    { modelID: "deepseek-v4-flash" },
    { ...model, variant: "low" },
  ])
    assert.throws(
      () => post(guard, "/session/ses_1/summarize", body),
      /Unapproved|Unsupported/,
    );
  // Reads, session create, abort, permission and question replies pass.
  guard("GET", "/event", undefined);
  guard("GET", "/session/ses_1/message", undefined);
  post(guard, "/session", { title: "RAH OS Agent Activation", permission: [] });
  post(guard, "/session/ses_1/abort", {});
  post(guard, "/permission/per_1/reply", { reply: "always" });
  post(guard, "/question/que_1/reject", {});
  assert.throws(
    () => post(guard, "/session", { model, title: "RAH OS Agent Activation" }),
    /Unapproved model field/,
  );
  for (const [method, path] of [
    ["POST", "/session/ses_1/command"],
    ["POST", "/session/ses_1/shell"],
    ["POST", "/session/ses_1/init"],
    ["POST", "/session/ses_1/fork"],
    ["PATCH", "/config"],
    ["POST", "/tui/submit-prompt"],
    ["DELETE", "/session/ses_1"],
  ])
    assert.throws(
      () => guard(method, path, "{}"),
      /Unsupported gate request/,
      `${method} ${path}`,
    );
  assert.throws(
    () =>
      createOpenCodeRequestGuard({ model: "deepseek-v4-flash", effort: "low" }),
    /provider\/model/,
  );
  assert.throws(
    () => createOpenCodeRequestGuard({ model: approved.model, effort: null }),
    /Guard needs/,
  );
});

/**
 * Eighth review P2-1: OpenCode titles a session with a default title on its
 * first user message through the small model (`SessionPrompt.ensureTitle` ->
 * `Provider.getSmallModel`, an internal call that never crosses the guarded
 * prompt route). The gate only lets sessions be created with an explicit,
 * non-default title, and both product drivers create them that way.
 */
test("request guard: session create needs an explicit non-default title (no internal title generation)", () => {
  const guard = createOpenCodeRequestGuard(approved);
  for (const body of [
    undefined,
    {},
    { permission: [] },
    { title: "" },
    { title: "   " },
    { title: "New session - 2026-09-25T10:00:00.000Z" },
    { title: "Child session - 2026-09-25T10:00:00.000Z" },
    { title: 42 },
  ])
    assert.throws(
      () => post(guard, "/session", body),
      /Unsupported session title/,
      JSON.stringify(body),
    );
  const here = new URL(".", import.meta.url);
  for (const driver of [
    "../../packages/agent-host/src/opencode-server-driver.mjs",
    "../../packages/agent-host/src/opencode-warm-driver.mjs",
  ]) {
    const source = readFileSync(new URL(driver, here), "utf8");
    const titles = [
      ...source.matchAll(
        /requestJson\("\/session", \{[\s\S]*?title: ("[^"]+")/gu,
      ),
    ].map((match) => JSON.parse(match[1]));
    assert.equal(titles.length, 1, driver);
    post(guard, "/session", { permission: [], title: titles[0] });
  }
});

test("launch: product serve, catalog and version only", () => {
  assert.equal(classifyOpenCodeLaunch(["--version"]).kind, "version");
  assert.equal(
    classifyOpenCodeLaunch(["models", "--verbose", "--pure"]).kind,
    "catalog",
  );
  assert.equal(classifyOpenCodeLaunch(["models", "--pure"]).kind, "catalog");
  // evo §57: the drivers resolve the user's MCP server names with OpenCode's
  // own read-only resolution before `serve` (no model call).
  assert.equal(
    classifyOpenCodeLaunch(["debug", "config", "--pure"]).kind,
    "config",
  );
  const serve = classifyOpenCodeLaunch([
    "serve",
    "--pure",
    "--hostname",
    "127.0.0.1",
    "--port",
    "4100",
  ]);
  assert.equal(serve.kind, "serve");
  assert.equal(serve.port, 4100);
  assert.deepEqual(serve.upstreamArgs(4200), [
    "serve",
    "--pure",
    "--hostname",
    "127.0.0.1",
    "--port",
    "4200",
  ]);
  for (const args of [
    ["run", "hello"],
    ["serve", "--pure", "--hostname", "0.0.0.0", "--port", "1"],
    ["serve", "--pure", "--hostname", "127.0.0.1"],
    ["serve", "--hostname", "127.0.0.1", "--port", "1", "--model", "x/y"],
    ["models", "deepseek", "--refresh"],
    ["debug", "config"],
    ["debug", "agent", "build", "--pure"],
    ["debug", "config", "--pure", "--print-logs"],
    [],
  ])
    assert.throws(
      () => classifyOpenCodeLaunch(args),
      /Unsupported/,
      JSON.stringify(args),
    );
});

test("server config: no agent may pin another model; the compaction override must be present", () => {
  const options = { reasoningEffort: "low" };
  const good = {
    model: "deepseek/deepseek-v4-flash",
    small_model: "deepseek/deepseek-v4-flash",
    agent: {
      compaction: { options: { reasoningEffort: "low" } },
      build: { model: "deepseek/deepseek-v4-flash", variant: "low" },
    },
  };
  assertOpenCodeServerConfig(good, { ...approved, compactionOptions: options });
  // Eighth review P2-1: internal small-model calls, the default model and
  // agent reasoning are pinned to the approval too.
  for (const [config, pattern] of [
    [
      { ...good, small_model: "unapproved/expensive" },
      /Unapproved small_model/,
    ],
    [{ ...good, small_model: undefined }, /Unapproved small_model/],
    [{ ...good, model: "unapproved/expensive" }, /Unapproved default model/],
    [
      { ...good, agent: { ...good.agent, title: { variant: "high" } } },
      /Unapproved agent variant \(title\)/,
    ],
    [
      {
        ...good,
        agent: {
          ...good.agent,
          summary: { options: { reasoningEffort: "high" } },
        },
      },
      /Unapproved agent options \(summary\)/,
    ],
  ])
    assert.throws(
      () =>
        assertOpenCodeServerConfig(config, {
          ...approved,
          compactionOptions: options,
        }),
      pattern,
    );
  assert.throws(
    () =>
      assertOpenCodeServerConfig(
        {
          agent: {
            ...good.agent,
            compaction: { ...good.agent.compaction, model: "x/y" },
          },
          model: good.model,
          small_model: good.small_model,
        },
        { ...approved, compactionOptions: options },
      ),
    /Unapproved agent model \(compaction\)/,
  );
  assert.throws(
    () =>
      assertOpenCodeServerConfig(
        { ...good, agent: { general: { model: "anthropic/claude" } } },
        { ...approved, compactionOptions: options },
      ),
    /Unapproved agent model/,
  );
  assert.throws(
    () =>
      assertOpenCodeServerConfig(
        { ...good, agent: {} },
        { ...approved, compactionOptions: options },
      ),
    /compaction reasoning/,
  );
});

test("compaction reasoning: the approved variant's options, merged into the config content", () => {
  const verbose = [
    "deepseek/deepseek-flash",
    "{",
    '  "id": "deepseek-flash",',
    '  "variants": { "low": { "reasoningEffort": "low" } }',
    "}",
    "deepseek/deepseek-v4-flash",
    "{",
    '  "id": "deepseek-v4-flash",',
    '  "variants": {',
    '    "low": { "reasoningEffort": "low" },',
    '    "high": { "reasoningEffort": "high" }',
    "  }",
    "}",
  ].join("\n");
  assert.deepEqual(
    openCodeVariantOptions(verbose, "deepseek/deepseek-v4-flash", "high"),
    { reasoningEffort: "high" },
  );
  assert.throws(
    () => openCodeVariantOptions(verbose, "deepseek/deepseek-v4-pro", "low"),
    /not in the OpenCode catalog/,
  );
  assert.throws(
    () => openCodeVariantOptions(verbose, "deepseek/deepseek-v4-flash", "max"),
    /no variant max/,
  );
  const merged = JSON.parse(
    withCompactionOptions(
      JSON.stringify({
        instructions: ["/r.md"],
        small_model: "unapproved/expensive",
        model: "unapproved/other",
        agent: { build: { steps: 3 } },
      }),
      { reasoningEffort: "low" },
      approved.model,
    ),
  );
  // The approved model replaces any configured default and small model.
  assert.deepEqual(merged, {
    instructions: ["/r.md"],
    small_model: approved.model,
    model: approved.model,
    agent: {
      build: { steps: 3 },
      compaction: { options: { reasoningEffort: "low" } },
    },
  });
  assert.deepEqual(
    JSON.parse(
      withCompactionOptions(
        undefined,
        { reasoningEffort: "low" },
        approved.model,
      ),
    ),
    {
      model: approved.model,
      small_model: approved.model,
      agent: { compaction: { options: { reasoningEffort: "low" } } },
    },
  );
  assert.throws(
    () => withCompactionOptions(undefined, {}, approved.model),
    /options/,
  );
  assert.throws(
    () => withCompactionOptions(undefined, { reasoningEffort: "low" }),
    /approved model/,
  );
});

const assistant = (fields) => ({
  info: {
    role: "assistant",
    providerID: "deepseek",
    modelID: "deepseek-v4-flash",
    time: { created: 2000, completed: 2500 },
    ...fields,
  },
  parts: [],
});

test("compaction evidence: a finished compaction assistant after the request, exact model", () => {
  const ok = openCodeCompactionEvidence(
    [
      assistant({ summary: true, mode: "compaction", time: { created: 500 } }),
      assistant({ variant: "low", mode: "build" }),
      assistant({
        summary: true,
        mode: "compaction",
        finish: "stop",
        tokens: { input: 900, output: 80 },
      }),
    ],
    { startedAtMs: 1000, approved },
  );
  assert.equal(ok.observed, true);
  assert.equal(ok.compactionsAfter, 1);
  assert.deepEqual(ok.compaction, {
    providerID: "deepseek",
    modelID: "deepseek-v4-flash",
    variant: null,
    finish: "stop",
    error: null,
    tokens: { input: 900, output: 80 },
  });
  assert.equal(
    openCodeCompactionEvidence(
      [
        assistant({
          summary: true,
          mode: "compaction",
          time: { created: 2000 },
        }),
      ],
      { startedAtMs: 1000, approved },
    ).observed,
    false,
    "unfinished",
  );
  assert.equal(
    openCodeCompactionEvidence([], { startedAtMs: 1000, approved }).observed,
    false,
  );
  assert.throws(
    () =>
      openCodeCompactionEvidence(
        [
          assistant({
            summary: true,
            mode: "compaction",
            finish: "stop",
            modelID: "other",
          }),
        ],
        { startedAtMs: 1000, approved },
      ),
    /Unapproved compaction model/,
  );
});

test("round fence: every stored assistant used the approved model and variant", () => {
  const rows = [
    { role: "user", model: { ...model, variant: "low" } },
    { ...assistant({ variant: "low", mode: "build" }).info },
    {
      ...assistant({ variant: "low", mode: "compaction", summary: true }).info,
    },
  ];
  assert.deepEqual(assertOpenCodeAssistants(rows, approved), {
    assistants: 2,
    compactions: 1,
  });
  assert.throws(
    () =>
      assertOpenCodeAssistants(
        [{ ...assistant({ variant: undefined }).info }],
        approved,
      ),
    /Unapproved variant none/,
  );
  assert.throws(
    () =>
      assertOpenCodeAssistants(
        [{ ...assistant({ variant: "low", modelID: "deepseek-v4-pro" }).info }],
        approved,
      ),
    /Unapproved model deepseek\/deepseek-v4-pro/,
  );
});

test("sse filter: suppressed session events never reach the driver; others pass whole", () => {
  let hide = "ses_1";
  const filter = createSseSessionFilter((id) => id === hide);
  const ev = (value) => `data: ${JSON.stringify(value)}\n\n`;
  const a = ev({ type: "session.status", properties: { sessionID: "ses_1" } });
  const b = ev({
    type: "message.updated",
    properties: { info: { sessionID: "ses_2" } },
  });
  const c = ev({
    type: "message.part.updated",
    properties: { part: { sessionID: "ses_1" } },
  });
  const whole = a + b + c;
  const out =
    filter.push(whole.slice(0, 10)) +
    filter.push(whole.slice(10, 70)) +
    filter.push(whole.slice(70));
  assert.equal(out, b);
  hide = undefined;
  assert.equal(filter.push(a), a);
  assert.equal(filter.push(": heartbeat\n\n"), ": heartbeat\n\n");
});

// ------------------------------------------------------------ shim e2e

const FAKE_OPENCODE = `#!/usr/bin/env node
// FAKE OpenCode serve for the drift-guard test (no model, no network).
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const record = (v) => appendFileSync(process.env.FAKE_OC_RECORD, JSON.stringify(v) + "\\n");
if (args[0] === "--version") { console.log("1.18.32"); process.exit(0); }
const port = Number(args[args.indexOf("--port") + 1]);
record({ kind: "start", pid: process.pid, args, config: process.env.OPENCODE_CONFIG_CONTENT ?? null });
const clients = new Set();
const emit = (v) => { for (const c of clients) c.write("data: " + JSON.stringify(v) + "\\n\\n"); };
let compaction;
const body = (req) => new Promise((r) => { let s = ""; req.on("data", (d) => (s += d)); req.on("end", () => r(s)); });
createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const text = await body(req);
  record({ kind: "request", method: req.method, path: url.pathname, directory: url.searchParams.get("directory"), body: text });
  const json = (v) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
  if (url.pathname === "/path") return json({});
  if (url.pathname === "/config") {
    const cfg = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "{}");
    if (process.env.FAKE_AGENT_MODEL) cfg.agent = { ...cfg.agent, general: { model: process.env.FAKE_AGENT_MODEL } };
    return json(cfg);
  }
  if (url.pathname === "/event") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    clients.add(res);
    res.write("data: " + JSON.stringify({ type: "server.connected", properties: {} }) + "\\n\\n");
    req.on("close", () => clients.delete(res));
    return;
  }
  const m = /^\\/session\\/([^/]+)\\/(message|summarize)$/.exec(url.pathname);
  if (m && req.method === "POST" && m[2] === "message") {
    emit({ type: "session.status", properties: { sessionID: m[1], status: { type: "busy" }, from: "prompt" } });
    return json({ info: { role: "assistant" }, parts: [] });
  }
  if (m && req.method === "POST" && m[2] === "summarize") {
    emit({ type: "session.status", properties: { sessionID: m[1], status: { type: "busy" }, from: "summarize" } });
    emit({ type: "message.updated", properties: { info: { sessionID: m[1], role: "assistant" }, from: "summarize" } });
    const b = JSON.parse(text);
    compaction = { info: { role: "assistant", summary: true, mode: "compaction", providerID: b.providerID, modelID: b.modelID, finish: "stop", time: { created: Date.now(), completed: Date.now() + 1 }, tokens: { input: 10, output: 2 } }, parts: [] };
    await new Promise((r) => setTimeout(r, 50));
    return json(true);
  }
  if (m && req.method === "GET") return json(compaction ? [compaction] : []);
  json({});
}).listen(port, "127.0.0.1");
`;

async function freePort() {
  return await new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function until(probe, label, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      const v = await probe();
      if (v) return v;
    } catch {
      // not yet
    }
    if (Date.now() > end) throw new Error(`timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

// Full review 2 B-P2-1: the fake serve is the shim's child. SIGKILL on the
// shim alone cannot be forwarded and left one orphaned fake serve per run;
// the shim runs in its own process group and the whole group is killed, and
// every fake serve the record names must be gone before the test ends.
const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
function fakeServePids(record) {
  if (!existsSync(record)) return [];
  return readFileSync(record, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.kind === "start" && Number.isInteger(r.pid))
    .map((r) => r.pid);
}
async function stopShim(child, record) {
  if (child?.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // the group is already gone
    }
  }
  const pids = fakeServePids(record);
  await until(
    () => pids.every((pid) => !pidAlive(pid)),
    `fake opencode serve reaped (${pids.join(", ")})`,
    5000,
  );
}

function startShim(directory, env = {}) {
  const fake = join(directory, "fake-opencode.mjs");
  writeFileSync(fake, FAKE_OPENCODE, { mode: 0o700 });
  const controlRecordPath = join(directory, "control.jsonl");
  const shim = writeGuardedShim({
    provider: "opencode",
    path: join(directory, "guarded-opencode.mjs"),
    realCli: fake,
    model: approved.model,
    effort: approved.effort,
    options: {
      compactionOptions: { reasoningEffort: "low" },
      controlRecordPath,
    },
  });
  return { shim, controlRecordPath, record: join(directory, "record.jsonl") };
}

test("guarded opencode serve: fenced proxy, hidden compaction, fail-closed denial", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loom-og-test-"));
  let child;
  try {
    const { shim, controlRecordPath, record } = startShim(directory);
    const port = await freePort();
    child = spawn(
      shim,
      ["serve", "--pure", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: directory,
        env: { ...process.env, FAKE_OC_RECORD: record },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (b) => (stderr += b));
    const exited = new Promise((r) => child.once("close", (code) => r(code)));
    const base = `http://127.0.0.1:${port}`;
    const q = `?directory=${encodeURIComponent(directory)}`;
    await until(async () => (await fetch(base + "/path" + q)).ok, "proxy");
    // The real serve got the compaction reasoning override.
    const start = readFileSync(record, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .find((r) => r.kind === "start");
    assert.notEqual(start.args.at(-1), String(port), "upstream port differs");
    assert.deepEqual(JSON.parse(start.config).agent.compaction.options, {
      reasoningEffort: "low",
    });
    // Driver SSE subscription through the proxy.
    const events = [];
    const sse = await fetch(base + "/event" + q);
    const reader = sse.body.getReader();
    void (async () => {
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader
          .read()
          .catch(() => ({ done: true }));
        if (done) return;
        events.push(decoder.decode(value));
      }
    })();
    const ok = await fetch(base + "/session/ses_1/message" + q, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(prompt),
    });
    assert.equal(ok.status, 200);
    await until(
      () => events.join("").includes('"from":"prompt"'),
      "prompt event",
    );
    // Gate compaction through the shim's private socket: same fence, events
    // of the compacted session hidden from the product driver.
    await until(() => existsSync(controlRecordPath), "control record");
    const { socketPath } = JSON.parse(
      readFileSync(controlRecordPath, "utf8").trim().split("\n").at(-1),
    );
    const compacted = await requestOpenCodeCompaction(
      socketPath,
      "ses_1",
      5000,
    );
    assert.equal(compacted.observed, true, JSON.stringify(compacted));
    assert.equal(compacted.compaction.modelID, "deepseek-v4-flash");
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(!events.join("").includes('"from":"summarize"'));
    const summarize = readFileSync(record, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .find((r) => r.path === "/session/ses_1/summarize");
    assert.deepEqual(JSON.parse(summarize.body), model);
    assert.equal(summarize.directory, realpathSync(directory));
    // A wrong variant is refused before it reaches OpenCode and closes it.
    const denied = await fetch(base + "/session/ses_1/message" + q, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...prompt, variant: "high" }),
    });
    assert.equal(denied.status, 403);
    assert.equal(await exited, 1);
    assert.match(stderr, /PAID_GATE_MODEL_DENIED/);
    const forwarded = readFileSync(record, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter(
        (r) => r.path === "/session/ses_1/message" && r.method === "POST",
      );
    assert.equal(
      forwarded.length,
      1,
      "the denied prompt never reached OpenCode",
    );
  } finally {
    await stopShim(child, join(directory, "record.jsonl"));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("guarded opencode serve: an agent pinned to another model is denied at startup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loom-og-test-"));
  let child;
  try {
    const { shim, record } = startShim(directory);
    const port = await freePort();
    child = spawn(
      shim,
      ["serve", "--pure", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: directory,
        env: {
          ...process.env,
          FAKE_OC_RECORD: record,
          FAKE_AGENT_MODEL: "anthropic/claude-opus",
        },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (b) => (stderr += b));
    const code = await new Promise((r) => child.once("close", r));
    assert.equal(code, 1);
    assert.match(stderr, /Unapproved agent model \(general\)/);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/path`));
  } finally {
    await stopShim(child, join(directory, "record.jsonl"));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("guarded opencode: unsupported commands never start the CLI", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loom-og-test-"));
  try {
    const { shim, record } = startShim(directory);
    const child = spawn(shim, ["run", "hello"], {
      cwd: directory,
      env: { ...process.env, FAKE_OC_RECORD: record },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (b) => (stderr += b));
    assert.equal(await new Promise((r) => child.once("close", r)), 1);
    assert.match(stderr, /PAID_GATE_MODEL_DENIED/);
    assert.equal(existsSync(record), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("opencode per-turn compaction: a short-lived serve, the fenced summarize, then it is gone", async () => {
  const { compactOpenCodePerTurn } = await import("./drift-compaction.mjs");
  const directory = mkdtempSync(join(tmpdir(), "loom-og-test-"));
  const previous = process.env.FAKE_OC_RECORD;
  try {
    const fake = join(directory, "fake-opencode.mjs");
    writeFileSync(fake, FAKE_OPENCODE, { mode: 0o700 });
    const record = join(directory, "record.jsonl");
    process.env.FAKE_OC_RECORD = record;
    const result = await compactOpenCodePerTurn({
      opencode: fake,
      cwd: directory,
      sessionId: "ses_9",
      ...approved,
      compactionOptions: { reasoningEffort: "low" },
      validate: createOpenCodeRequestGuard(approved),
      dbPath: join(directory, "missing.db"),
      timeoutMs: 5000,
    });
    assert.equal(result.observed, true, JSON.stringify(result));
    assert.equal(result.forced, true);
    assert.equal(result.compaction.modelID, "deepseek-v4-flash");
    const rows = readFileSync(record, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const start = rows.find((r) => r.kind === "start");
    assert.deepEqual(start.args.slice(0, 4), [
      "serve",
      "--pure",
      "--hostname",
      "127.0.0.1",
    ]);
    assert.deepEqual(JSON.parse(start.config).agent.compaction.options, {
      reasoningEffort: "low",
    });
    const summarize = rows.find((r) => r.path === "/session/ses_9/summarize");
    assert.deepEqual(JSON.parse(summarize.body), model);
    const port = Number(start.args.at(-1));
    await assert.rejects(fetch(`http://127.0.0.1:${port}/path`));
    // A wrong approval never sends the request and fails the gate.
    await assert.rejects(
      compactOpenCodePerTurn({
        opencode: fake,
        cwd: directory,
        sessionId: "ses_9",
        ...approved,
        compactionOptions: { reasoningEffort: "low" },
        validate: createOpenCodeRequestGuard({
          model: "deepseek/deepseek-v4-pro",
          effort: "low",
        }),
        dbPath: join(directory, "missing.db"),
        timeoutMs: 5000,
      }),
      /Unapproved compaction model/,
    );
  } finally {
    if (previous === undefined) delete process.env.FAKE_OC_RECORD;
    else process.env.FAKE_OC_RECORD = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

// Review 2026-09-26 P1-1 (evo status §41): both drivers install the deny
// rules on a resumed session with `PATCH /session/:id {permission}` before
// prompting. The gate admits exactly that shape.
const DENIES = [
  { action: "deny", pattern: "*", permission: "question" },
  { action: "deny", pattern: "*", permission: "plan_enter" },
  { action: "deny", pattern: "*", permission: "plan_exit" },
];
test("request guard: PATCH /session/:id carries only permission rules", () => {
  const guard = createOpenCodeRequestGuard(approved);
  const patch = (path, body) => guard("PATCH", path, JSON.stringify(body));
  assert.doesNotThrow(() => patch("/session/ses_1", { permission: DENIES }));
  for (const body of [
    {},
    { permission: [] },
    { permission: DENIES, title: "x" },
    { permission: DENIES, model },
    { permission: [{ action: "allow", pattern: "*" }] },
    { permission: [{ ...DENIES[0], extra: 1 }] },
    { permission: "deny" },
  ])
    assert.throws(
      () => patch("/session/ses_1", body),
      /Unsupported gate request/,
      JSON.stringify(body),
    );
  for (const path of ["/session", "/session/ses_1/message", "/config"])
    assert.throws(
      () => patch(path, { permission: DENIES }),
      /Unsupported gate request PATCH/,
      path,
    );
  assert.throws(
    () => guard("DELETE", "/session/ses_1", undefined),
    /Unsupported gate request DELETE/,
  );
  // The product helper sends exactly this body.
  const here = new URL(".", import.meta.url);
  const source = readFileSync(
    new URL("../../packages/agent-host/src/opencode-server-client.js", here),
    "utf8",
  );
  assert.match(source, /method: "PATCH"/);
});

test("request record: session create and permission patch rules, prompt attached lines", () => {
  const create = {
    title: "Loom",
    permission: [{ action: "allow", pattern: "*", permission: "*" }, ...DENIES],
  };
  assert.deepEqual(
    openCodeRequestRecord("POST", "/session", JSON.stringify(create), "t0"),
    { kind: "session-create", at: "t0", permission: create.permission },
  );
  assert.deepEqual(
    openCodeRequestRecord(
      "PATCH",
      "/session/ses_1",
      JSON.stringify({ permission: DENIES }),
      "t1",
    ),
    {
      kind: "session-permission",
      at: "t1",
      sessionId: "ses_1",
      permission: DENIES,
    },
  );
  assert.equal(
    openCodeRequestRecord(
      "POST",
      "/session/ses_1/message",
      JSON.stringify(prompt),
      "t2",
    ),
    null,
  );
  assert.equal(openCodeRequestRecord("GET", "/session", undefined, "t3"), null);
});

test("guarded opencode serve: records session permission requests and the standing-prompt attached line", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loom-og-record-"));
  let child;
  try {
    const { record } = startShim(directory);
    const requestRecordPath = join(directory, "requests.jsonl");
    const shim = writeGuardedShim({
      provider: "opencode",
      path: join(directory, "guarded-opencode-record.mjs"),
      realCli: join(directory, "fake-opencode.mjs"),
      model: approved.model,
      effort: approved.effort,
      options: {
        compactionOptions: { reasoningEffort: "low" },
        requestRecordPath,
      },
    });
    const rules = join(directory, "rules.md");
    writeFileSync(
      rules,
      "## Current Runtime Context\n- Attached directory: /tmp/attached-x\n",
    );
    const port = await freePort();
    child = spawn(
      shim,
      ["serve", "--pure", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: directory,
        env: {
          ...process.env,
          FAKE_OC_RECORD: record,
          OPENCODE_CONFIG_CONTENT: JSON.stringify({ instructions: [rules] }),
        },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const base = `http://127.0.0.1:${port}`;
    const q = `?directory=${encodeURIComponent(directory)}`;
    await until(async () => (await fetch(base + "/path" + q)).ok, "proxy");
    const created = await fetch(base + "/session" + q, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Loom",
        permission: [
          { action: "allow", pattern: "*", permission: "*" },
          ...DENIES,
        ],
      }),
    });
    assert.equal(created.status, 200);
    const patched = await fetch(base + "/session/ses_1" + q, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permission: DENIES }),
    });
    assert.equal(patched.status, 200);
    const lines = readFileSync(requestRecordPath, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.deepEqual(
      lines.map((l) => l.kind),
      ["serve-launch", "session-create", "session-permission"],
    );
    assert.deepEqual(lines[0].instructions, {
      status: "read",
      directories: ["/tmp/attached-x"],
    });
    assert.equal(lines[1].permission.length, 4);
    assert.equal(lines[2].sessionId, "ses_1");
    // The PATCH reached the real serve.
    assert.ok(
      readFileSync(record, "utf8").includes('"method":"PATCH"'),
      "forwarded",
    );
  } finally {
    await stopShim(child, join(directory, "record.jsonl"));
    rmSync(directory, { recursive: true, force: true });
  }
});
