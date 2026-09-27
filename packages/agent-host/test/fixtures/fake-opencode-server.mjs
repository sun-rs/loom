#!/usr/bin/env node
// FAKE `opencode serve` (no model). Wire shapes follow the installed OpenCode
// 1.18.32 bundle (read-only, `opencode-ai/bin/opencode.exe`):
//
// - `POST /session/:id/message` takes an optional caller-chosen `messageID`
//   (`SessionPrompt.createUserMessage`: `id: t.messageID ?? ascending()`),
//   persists the user message, then runs the session loop and answers with the
//   loop's last assistant message; `prompt_async` answers 204 at once;
// - every loop step creates an assistant message whose `parentID` is the
//   current last user message, BEFORE its model request (so before any tool);
// - every model request's system is rebuilt: the agent prompt (or the
//   provider default), the environment, every configured `instructions` file
//   read fresh ("Instructions from: <path>\n<content>"), then the last user
//   message's own `system` (`LLMRequestPrep.prepare`);
// - auto-compaction adds a user message with a `compaction` part, a summary
//   assistant, publishes `session.compacted`, then (autocontinue) a synthetic
//   "Continue if you have next steps…" user message WITHOUT `system`; the
//   following steps' parent is that synthetic message;
// - `POST /session/:id/abort` cancels the run: the in-flight assistant gets
//   `MessageAbortedError`, `session.error` is published, the prompt answers
//   with that last assistant; the session goes idle;
// - `/event` is a live bus (no replay).
//
// FAKE_SCENARIO tokens joined by "+": reply (default), hang (the posting tool
// waits for FAKE_RELEASE), check (message-check only), nofinal, compact
// (auto-compaction with autocontinue after the tool step), stale (an old
// idle and a foreign-parent assistant precede this prompt's user message),
// noassistant (the loop fails before any assistant), error (the assistant
// fails with an API error), ssedrop (every `/event` stream is closed just
// before the first assistant, so a client misses it and must reconcile from
// `GET /session/:id/message`), lagtool (the bus delivers everything from the
// tool start on only after FAKE_LAG_MS, in order, while the persisted
// messages are already current), listfail (`GET /session/:id/message`
// answers 500 while the prompt runs), sideerror (a non-abort `session.error`
// is published during the run, which then goes on), autonomous (after the
// prompt answered, the session goes busy on its own once per FAKE_RECORD
// directory, as a background task would, after FAKE_AUTONOMOUS_MS, default
// 300), overflow (after the tool step the provider reports a context
// overflow: `session.error` ContextOverflowError is published, then — as
// 1.18.32 `SessionProcessor.halt` does with auto-compaction on — the session
// compacts and the run goes on; only `compaction.auto === false` would put
// the error on the assistant), childperm (the tool step starts a subagent:
// `session.created` of a child session whose `parentID` is this session,
// then that child's `permission.asked`; the tool waits up to
// FAKE_PERMISSION_WAIT_MS, default 2000, for the reply and fails the step
// with an error when none arrives; once answered, the child reports one
// `step-finish` usage part under its own session id), childnocreated (as
// childperm, but the child's `session.created` is never published, so a
// client learns the child only from `GET /session/:id` — its `parentID`),
// childpermdrop (as childperm, but every `/event` stream is closed first, so
// both the child's `session.created` and its `permission.asked` are lost and
// the request is only visible in `GET /permission` — the installed 1.18.32
// "List pending permissions … across all sessions"), overflowfatal (as
// overflow, but auto-compaction is off: the next assistant carries the
// ContextOverflowError and the run ends failed). FAKE_EXISTING_CHILD=1: a
// resumed (`GET /session/:id`) session already has one child session,
// listed by `GET /session/:id/children`; oldchildperm (that existing child,
// never announced on this bus, asks a permission). FAKE_SCRIPT (comma separated) gives one scenario
// per prompt. FAKE_RECORD (jsonl) records requests and model steps.
// FAKE_TOOL_COMMAND replaces the derived Worker command. FAKE_FOLLOW_UP_MS
// bounds the wait for an abort before the post-reply generation (default 300).
// FAKE_ABORT_DELAY_MS delays the abort's HTTP answer (the run is cancelled at
// once); FAKE_ABORT_DROP=1 cancels the run and drops the connection without
// any answer (an abort whose outcome the client cannot know).
// FAKE_TERM_DELAY_MS delays the exit after SIGTERM (default 0).
//
// evo §57 (Loom Worker tool facade), shapes from the installed 1.18.32 and a
// free probe of the real `opencode serve`:
// - `debug config --pure` prints the resolved config: FAKE_USER_CONFIG (the
//   user's/project's files, JSON) deep-merged with OPENCODE_CONFIG_CONTENT;
// - `serve` resolves the same merge; every enabled `type: "local"` MCP entry
//   is started as a child (stdio JSON-RPC: initialize, initialized,
//   tools/list), an enabled non-local entry counts as connected, and
//   `enabled: false` is `disabled`; `GET /mcp` answers `{name: {status}}`
//   after the connections settled. FAKE_SERVE_EXTRA_MCP=1 adds an enabled
//   `pluginmarker` that `debug config` does not show (a server the launch
//   could not have switched off);
// - scenario token `tool`: the model calls the Loom tool named by the wake's
//   `Reply: loom_message_post target=... based_on_room_seq=N final=true`
//   line (else `loom_message_check`) through that MCP connection, as tool
//   part `loom_message_post` with the structured input; `wrongtarget` posts
//   to `#elsewhere` instead of the wake's target.
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";

const args = process.argv.slice(2);
const env = process.env;
if (args[0] === "models") {
  process.stdout.write(
    'deepseek/deepseek-v4-flash\n{"name":"DeepSeek V4 Flash","variants":{"low":{},"high":{},"max":{}}}\n',
  );
  process.exit(0);
}
const record = (value) =>
  env.FAKE_RECORD &&
  appendFileSync(
    env.FAKE_RECORD,
    `${JSON.stringify({ pid: process.pid, activationId: env.RAH_ACTIVATION_ID, at: Date.now(), ...value })}\n`,
  );
const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const deepMerge = (base, over) => {
  const out = { ...base };
  for (const [key, value] of Object.entries(over))
    out[key] =
      isObject(value) && isObject(out[key])
        ? deepMerge(out[key], value)
        : value;
  return out;
};
const parseConfig = (text, name) => {
  try {
    return text === undefined ? {} : JSON.parse(text);
  } catch {
    process.stderr.write(`invalid ${name}\n`);
    process.exit(1);
  }
};
const userConfig = parseConfig(env.FAKE_USER_CONFIG, "FAKE_USER_CONFIG");
const launchConfig = parseConfig(
  env.OPENCODE_CONFIG_CONTENT,
  "OPENCODE_CONFIG_CONTENT",
);
if (args[0] === "debug" && args[1] === "config") {
  record({ event: "debug-config", args });
  process.stdout.write(
    `${JSON.stringify(deepMerge(userConfig, launchConfig), null, 2)}\n`,
  );
  process.exit(0);
}
if (args[0] !== "serve") process.exit(64);
const DEFAULT_PROMPT = "FAKE OPENCODE PROVIDER DEFAULT PROMPT";
const config = launchConfig;
record({ event: "spawn", args, config });
/** MCP servers of the resolved config (user files + launch content). */
const mcpStatus = {};
const mcpClients = new Map();
const mcpEntries = {
  ...deepMerge(userConfig, launchConfig).mcp,
  ...(env.FAKE_SERVE_EXTRA_MCP === "1"
    ? { pluginmarker: { type: "remote", url: "http://127.0.0.1:9/plugin" } }
    : {}),
};
function connectMcp(name, entry) {
  const child = spawn(entry.command[0], entry.command.slice(1), {
    env: { ...process.env, ...(entry.environment ?? {}) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let nextId = 0;
  const waiting = new Map();
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim() === "") continue;
      const message = JSON.parse(line);
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
    }
  });
  child.stderr.resume();
  let gone;
  const exited = new Promise((resolve) => {
    child.once("error", (error) => resolve((gone = error)));
    child.once("exit", (code) => resolve((gone = new Error(`exited ${code}`))));
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      if (gone !== undefined) return reject(gone);
      void exited.then(reject);
      const id = (nextId += 1);
      waiting.set(id, (message) =>
        message.error
          ? reject(new Error(message.error.message))
          : resolve(message.result),
      );
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  const client = { child, request };
  mcpClients.set(name, client);
  return (async () => {
    await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "fake-opencode", version: "1.18.32" },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    const listed = await request("tools/list", {});
    record({
      event: "mcp-connected",
      name,
      tools: listed.tools.map((tool) => tool.name),
    });
    mcpStatus[name] = { status: "connected" };
  })().catch((error) => {
    mcpStatus[name] = {
      status: "failed",
      error: String(error.message ?? error),
    };
  });
}
const mcpReady = Promise.all(
  Object.entries(mcpEntries ?? {}).map(([name, entry]) => {
    if (entry?.enabled === false) {
      mcpStatus[name] = { status: "disabled" };
      return undefined;
    }
    if (entry?.type === "local" && Array.isArray(entry.command))
      return connectMcp(name, entry);
    mcpStatus[name] = { status: "connected" };
    return undefined;
  }),
);
async function callLoomTool(call) {
  const client = mcpClients.get("loom");
  if (client === undefined) return { exitCode: 1, output: "no loom MCP" };
  const result = await client.request("tools/call", {
    name: call.tool,
    arguments: call.args,
  });
  const output = result.content.map((part) => part.text).join("");
  record({
    event: "mcp-call",
    tool: call.name,
    args: call.args,
    isError: result.isError,
    output,
  });
  return { exitCode: result.isError ? 1 : 0, output };
}
function loomToolCall(text, tokens) {
  const reply =
    /Reply: loom_message_post target=("[^"]*"|\S+) based_on_room_seq=(\d+)( final=true)?/u.exec(
      text,
    );
  if (tokens.has("check") || !reply)
    return { name: "loom_message_check", tool: "message_check", args: {} };
  const target = reply[1].startsWith('"') ? JSON.parse(reply[1]) : reply[1];
  return {
    name: "loom_message_post",
    tool: "message_post",
    args: {
      target: tokens.has("wrongtarget") ? "#elsewhere" : target,
      body: "FAKE OPENCODE reply",
      based_on_room_seq: Number(reply[2]),
      ...(reply[3] !== undefined && !tokens.has("nofinal")
        ? { final: true }
        : {}),
    },
  };
}
// FAKE_FAIL_RESPAWN=1: every server after the first (per FAKE_RECORD) fails
// at startup.
if (env.FAKE_FAIL_RESPAWN === "1") {
  const mark = `${env.FAKE_RECORD ?? ""}.spawned`;
  if (existsSync(mark)) {
    record({ event: "respawn-failed" });
    process.exit(1);
  }
  writeFileSync(mark, "");
}
const script = (env.FAKE_SCRIPT ?? "").split(",").filter(Boolean);
let promptIndex = 0;
let idSequence = 0;
const streams = new Set();
const sessions = new Map();
const permissionReplies = new Map();
/** Pending requests (`GET /permission`, `GET /question`) until answered. */
const pendingPermissions = new Map();
/** Child session id -> parent session id (`Session.Info.parentID`). */
const childParents = new Map();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextId = (prefix) =>
  `${prefix}_fake${String((idSequence += 1)).padStart(6, "0")}`;
// `lagtool`: the bus falls behind (in order) while persisted state is current.
let lagQueue;
const publish = (type, properties) => {
  const frame = `data: ${JSON.stringify({ type, properties })}\n\n`;
  if (lagQueue !== undefined) return void lagQueue.push(frame);
  for (const stream of streams) stream.write(frame);
};
const lagBus = (ms) => {
  lagQueue ??= [];
  setTimeout(() => {
    const frames = lagQueue ?? [];
    lagQueue = undefined;
    for (const frame of frames)
      for (const stream of streams) stream.write(frame);
  }, ms);
};
const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const readBody = async (req) => {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text === "" ? undefined : JSON.parse(text);
};

// Session permission rules survive a server restart like OpenCode's own
// storage. A session this fake never created is a pre-evo-§40 session: its
// rules are the old allow-all (FAKE_RESUMED_PERMISSION=current: the current
// rules). `PATCH /session/:id` merges like 1.18.32's `session.update`
// (`Permission.merge(existing, payload)` appends); FAKE_PATCH_FAIL=1 answers
// 500, FAKE_PATCH_IGNORE=1 answers 200 without changing the rules.
const permissionStore = `${env.FAKE_RECORD ?? "/nonexistent"}.permissions.json`;
function storedPermissions() {
  try {
    return JSON.parse(readFileSync(permissionStore, "utf8"));
  } catch {
    return {};
  }
}
function sessionPermission(id) {
  const stored = storedPermissions()[id];
  if (stored !== undefined) return stored;
  const allowAll = [{ permission: "*", pattern: "*", action: "allow" }];
  return env.FAKE_RESUMED_PERMISSION === "current"
    ? [
        ...allowAll,
        { permission: "question", pattern: "*", action: "deny" },
        { permission: "plan_enter", pattern: "*", action: "deny" },
        { permission: "plan_exit", pattern: "*", action: "deny" },
      ]
    : allowAll;
}
function storePermission(id, permission) {
  if (env.FAKE_RECORD === undefined) return;
  writeFileSync(
    permissionStore,
    JSON.stringify({ ...storedPermissions(), [id]: permission }),
  );
}

function session(id) {
  let value = sessions.get(id);
  if (value === undefined) {
    value = { id, messages: [], run: undefined };
    sessions.set(id, value);
  }
  return value;
}

function updateMessage(s, info) {
  const existing = s.messages.find((m) => m.info.id === info.id);
  if (existing) existing.info = info;
  else s.messages.push({ info, parts: [] });
  publish("message.updated", { info: { ...info } });
}

function updatePart(s, part) {
  const message = s.messages.find((m) => m.info.id === part.messageID);
  if (message) {
    const index = message.parts.findIndex((p) => p.id === part.id);
    if (index >= 0) message.parts[index] = part;
    else message.parts.push(part);
  }
  publish("message.part.updated", {
    sessionID: s.id,
    part: { ...part, sessionID: s.id },
  });
}

function status(s, type) {
  publish("session.status", { sessionID: s.id, status: { type } });
  if (type === "idle") publish("session.idle", { sessionID: s.id });
}

/** One model request: the system exactly as OpenCode assembles it. */
function modelRequest(s, lastUser, kind) {
  const instructions = (config.instructions ?? []).flatMap((path) => {
    try {
      return [`Instructions from: ${path}\n${readFileSync(path, "utf8")}`];
    } catch {
      return [];
    }
  });
  const system =
    kind === "compaction"
      ? []
      : [
          DEFAULT_PROMPT,
          ...instructions,
          ...(lastUser.system ? [lastUser.system] : []),
        ];
  record({ event: "model-request", kind, parentID: lastUser.id, system });
}

function newAssistant(s, parent, extra = {}) {
  const info = {
    id: nextId("msg"),
    parentID: parent.id,
    role: "assistant",
    sessionID: s.id,
    mode: "build",
    agent: "build",
    time: { created: Date.now() },
    ...extra,
  };
  updateMessage(s, info);
  return info;
}

function workerCommand(text, tokens) {
  if (env.FAKE_TOOL_COMMAND) return env.FAKE_TOOL_COMMAND;
  const turnMatch = /--turn (\S+)/u.exec(text);
  const turnArg = turnMatch ? ` --turn ${turnMatch[1]}` : "";
  const reply =
    /Reply: message-post --target "[^"]+"(?: --turn \S+)? --based-on-room-seq (\d+)( --final)?/u.exec(
      text,
    );
  const cli = '"$RAH_WORKER_CLI" worker';
  if (tokens.has("check") || !reply || /message-check --startup/u.test(text))
    return `${cli} message-check${/message-check --startup/u.test(text) ? " --startup" : ""}${turnArg}`;
  const final = reply[2] !== undefined && !tokens.has("nofinal");
  return `${cli} message-post${turnArg} --based-on-room-seq ${reply[1]}${final ? " --final" : ""} <<'EOF'\nFAKE OPENCODE reply\nEOF`;
}

function runShell(command, run) {
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", command], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    run.shell = child;
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.once("close", (exitCode) => {
      run.shell = undefined;
      resolve({ exitCode, output });
    });
  });
}

function scenarioTokens() {
  const scenario =
    script[promptIndex] ?? env.FAKE_SCENARIO ?? script.at(-1) ?? "reply";
  promptIndex += 1;
  return new Set(scenario.split("+"));
}

async function runPrompt(s, body, res) {
  const tokens = scenarioTokens();
  const text = body.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  if (body.messageID !== undefined && !String(body.messageID).startsWith("msg"))
    return send(res, 400, { name: "BadRequest", data: { message: "id" } });
  record({
    event: "prompt",
    text,
    messageID: body.messageID,
    system: body.system,
    agent: body.agent,
    tokens: [...tokens],
  });
  if (tokens.has("stale")) {
    // A previous turn's tail arriving late on the live bus.
    status(s, "idle");
    publish("message.updated", {
      info: {
        id: "msg_stale000001",
        parentID: "msg_old000001",
        role: "assistant",
        sessionID: s.id,
      },
    });
  }
  const user = {
    id: body.messageID ?? nextId("msg"),
    role: "user",
    sessionID: s.id,
    time: { created: Date.now() },
    agent: body.agent ?? "build",
    ...(body.system === undefined ? {} : { system: body.system }),
  };
  updateMessage(s, user);
  updatePart(s, {
    id: nextId("prt"),
    messageID: user.id,
    type: "text",
    text,
  });
  const run = {
    cancelled: false,
    current: undefined,
    listFail: tokens.has("listfail"),
    wake: undefined,
  };
  s.run = run;
  status(s, "busy");
  const finish = (info) => {
    if (s.run === run) s.run = undefined;
    status(s, "idle");
    send(res, 200, { info, parts: [] });
    const mark = `${env.FAKE_RECORD ?? ""}.autonomous`;
    if (tokens.has("autonomous") && !existsSync(mark)) {
      writeFileSync(mark, "");
      setTimeout(
        () => {
          record({ event: "autonomous-run" });
          status(s, "busy");
        },
        Number(env.FAKE_AUTONOMOUS_MS ?? 300),
      );
    }
  };
  if (tokens.has("noassistant")) {
    if (s.run === run) s.run = undefined;
    status(s, "idle");
    return send(res, 500, { name: "UnknownError", data: { message: "boom" } });
  }
  let lastUser = user;
  if (tokens.has("ssedrop")) {
    // The live bus loses everything published while the client reconnects.
    for (const stream of streams) stream.end();
    streams.clear();
    record({ event: "sse-dropped" });
  }
  const first = newAssistant(s, lastUser);
  run.current = first;
  modelRequest(s, lastUser, "step");
  updatePart(s, { id: nextId("prt"), messageID: first.id, type: "step-start" });
  if (tokens.has("error")) {
    first.error = {
      name: "APIError",
      data: { message: "FAKE provider failure", isRetryable: false },
    };
    updateMessage(s, first);
    publish("session.error", { sessionID: s.id, error: first.error });
    return finish(first);
  }
  if (tokens.has("sideerror"))
    publish("session.error", {
      sessionID: s.id,
      error: {
        name: "UnknownError",
        data: { message: "FAKE independent session failure" },
      },
    });
  updatePart(s, {
    id: nextId("prt"),
    messageID: first.id,
    type: "reasoning",
    text: "FAKE OPENCODE thinking",
  });
  const loomCall = tokens.has("tool") ? loomToolCall(text, tokens) : undefined;
  const command =
    loomCall !== undefined
      ? undefined
      : tokens.has("hang")
        ? `: message-post --based-on-room-seq 7 --final; while [ ! -f "$FAKE_RELEASE" ]; do sleep 0.02; done`
        : workerCommand(text, tokens);
  const toolInput = loomCall === undefined ? { command } : loomCall.args;
  const toolPart = {
    id: nextId("prt"),
    messageID: first.id,
    type: "tool",
    callID: "call-1",
    tool: loomCall === undefined ? "bash" : loomCall.name,
    state: { status: "pending", input: {} },
  };
  if (tokens.has("lagtool")) lagBus(Number(env.FAKE_LAG_MS ?? 400));
  updatePart(s, toolPart);
  const childScenario = [
    "childperm",
    "childnocreated",
    "childpermdrop",
    "oldchildperm",
  ].find((token) => tokens.has(token));
  if (childScenario !== undefined) {
    if (childScenario === "childpermdrop") {
      for (const stream of streams) stream.end();
      streams.clear();
      record({ event: "sse-dropped" });
    }
    const existing = [...childParents].find(([, parent]) => parent === s.id);
    const child =
      childScenario === "oldchildperm" && existing !== undefined
        ? existing[0]
        : `ses_fakechild${String((idSequence += 1)).padStart(4, "0")}`;
    // FAKE_FOREIGN_PARENT=1: the asking session belongs to another tree.
    childParents.set(
      child,
      env.FAKE_FOREIGN_PARENT === "1" ? "ses_fakeforeign" : s.id,
    );
    if (childScenario !== "childnocreated" && childScenario !== "oldchildperm")
      publish("session.created", {
        sessionID: child,
        info: { id: child, parentID: s.id, title: "FAKE subagent" },
      });
    const requestId = nextId("per");
    const request = {
      id: requestId,
      sessionID: child,
      permission: "external_directory",
      patterns: ["/fake/outside/*"],
      metadata: {},
      always: ["/fake/outside/*"],
    };
    pendingPermissions.set(requestId, request);
    publish("permission.asked", request);
    const deadline = Date.now() + Number(env.FAKE_PERMISSION_WAIT_MS ?? 2000);
    while (!permissionReplies.has(requestId) && Date.now() < deadline)
      await delay(10);
    const reply = permissionReplies.get(requestId);
    record({ event: "child-permission", child, reply: reply ?? null });
    if (reply === undefined || reply === "reject") {
      first.error = {
        name: "UnknownError",
        data: { message: `FAKE subagent permission ${reply ?? "unanswered"}` },
      };
      updateMessage(s, first);
      publish("session.error", { sessionID: s.id, error: first.error });
      return finish(first);
    }
    // The subagent's own model step: usage under the child session id.
    const childStep = nextId("prt");
    publish("message.part.updated", {
      sessionID: child,
      part: {
        id: childStep,
        messageID: nextId("msg"),
        sessionID: child,
        type: "step-finish",
        reason: "stop",
        cost: 0,
        tokens: {
          input: 40,
          output: 5,
          reasoning: 0,
          cache: { read: 10, write: 0 },
        },
      },
    });
    record({ event: "child-usage", child, partId: childStep });
  }
  updatePart(s, {
    ...toolPart,
    state: { status: "running", input: toolInput, time: { start: 1 } },
  });
  record({ event: "tool-running", command, tool: toolPart.tool });
  let exit;
  if (loomCall !== undefined) exit = await callLoomTool(loomCall);
  else {
    exit = await runShell(command, run);
    record({
      event: "command",
      command,
      exit: { exitCode: exit.exitCode },
      output: exit.output,
    });
  }
  if (run.cancelled) {
    // The abort interrupted the running tool (`SessionProcessor.cleanup`
    // marks it `error` "Tool execution aborted"); the step's assistant is
    // aborted.
    updatePart(s, {
      ...toolPart,
      state: {
        status: "error",
        input: toolInput,
        error: "Tool execution aborted",
        metadata: { interrupted: true },
        time: { start: 1, end: 2 },
      },
    });
    record({ event: "aborted", during: "tool" });
    first.error = {
      name: "MessageAbortedError",
      data: { message: "The operation was aborted." },
    };
    first.time = { ...first.time, completed: Date.now() };
    updateMessage(s, first);
    publish("session.error", { sessionID: s.id, error: first.error });
    return finish(first);
  }
  updatePart(s, {
    ...toolPart,
    state: {
      status: exit.exitCode === 0 ? "completed" : "error",
      input: toolInput,
      output: exit.output,
      title: toolPart.tool,
      metadata: {},
      time: { start: 1, end: 2 },
    },
  });
  record({ event: "tool-completed" });
  first.finish = "tool-calls";
  first.time = { ...first.time, completed: Date.now() };
  updateMessage(s, first);
  if (tokens.has("overflow") || tokens.has("overflowfatal")) {
    publish("session.error", {
      sessionID: s.id,
      error: {
        name: "ContextOverflowError",
        data: { message: "FAKE prompt is too long for the context window" },
      },
    });
    record({ event: "context-overflow" });
  }
  if (tokens.has("overflowfatal")) {
    // `compaction.auto === false`: the halted step's assistant keeps the error.
    const failed = newAssistant(s, lastUser);
    failed.error = {
      name: "ContextOverflowError",
      data: { message: "FAKE prompt is too long for the context window" },
    };
    failed.time = { ...failed.time, completed: Date.now() };
    updateMessage(s, failed);
    record({ event: "overflow-unrecovered" });
    return finish(failed);
  }
  if (tokens.has("compact") || tokens.has("overflow")) {
    const compactionUser = {
      id: nextId("msg"),
      role: "user",
      sessionID: s.id,
      time: { created: Date.now() },
      agent: user.agent,
    };
    updateMessage(s, compactionUser);
    updatePart(s, {
      id: nextId("prt"),
      messageID: compactionUser.id,
      type: "compaction",
      auto: true,
    });
    const summary = newAssistant(s, compactionUser, {
      mode: "compaction",
      agent: "compaction",
      summary: true,
    });
    modelRequest(s, compactionUser, "compaction");
    summary.finish = "stop";
    updateMessage(s, summary);
    publish("session.compacted", { sessionID: s.id });
    const synthetic = {
      id: nextId("msg"),
      role: "user",
      sessionID: s.id,
      time: { created: Date.now() },
      agent: user.agent,
    };
    updateMessage(s, synthetic);
    updatePart(s, {
      id: nextId("prt"),
      messageID: synthetic.id,
      type: "text",
      synthetic: true,
      metadata: { compaction_continue: true },
      text: "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.",
    });
    lastUser = synthetic;
    record({ event: "compacted" });
  }
  // The next loop step exists before its model request answers.
  const follow = newAssistant(s, lastUser);
  run.current = follow;
  const aborted = () => {
    record({ event: "aborted" });
    follow.error = {
      name: "MessageAbortedError",
      data: { message: "The operation was aborted." },
    };
    follow.time = { ...follow.time, completed: Date.now() };
    updateMessage(s, follow);
    publish("session.error", { sessionID: s.id, error: follow.error });
    finish(follow);
  };
  if (run.cancelled) return aborted();
  await new Promise((resolve) => {
    run.wake = resolve;
    setTimeout(resolve, Number(env.FAKE_FOLLOW_UP_MS ?? 300));
  });
  if (run.cancelled) return aborted();
  modelRequest(
    s,
    lastUser,
    tokens.has("compact") || tokens.has("overflow") ? "autocontinue" : "step",
  );
  updatePart(s, {
    id: nextId("prt"),
    messageID: follow.id,
    type: "step-start",
  });
  updatePart(s, {
    id: nextId("prt"),
    messageID: follow.id,
    type: "text",
    text: "sent",
  });
  record({ event: "follow-up-generation" });
  follow.finish = "stop";
  follow.time = { ...follow.time, completed: Date.now() };
  updateMessage(s, follow);
  finish(follow);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const body = await readBody(req);
  record({ event: "request", method: req.method, path: url.pathname, body });
  if (req.method === "GET" && url.pathname === "/path")
    return send(res, 200, { directory: process.cwd() });
  if (req.method === "GET" && url.pathname === "/mcp") {
    await mcpReady;
    return send(res, 200, mcpStatus);
  }
  if (req.method === "GET" && url.pathname === "/event") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    res.write(
      `data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`,
    );
    streams.add(res);
    req.once("close", () => streams.delete(res));
    return;
  }
  if (req.method === "POST" && url.pathname === "/session") {
    const id = env.FAKE_SESSION ?? "ses_fakenew";
    session(id);
    storePermission(id, Array.isArray(body?.permission) ? body.permission : []);
    return send(res, 200, { id, directory: process.cwd(), title: "created" });
  }
  const match = /^\/session\/([^/]+)(\/[a-z_]+)?$/u.exec(url.pathname);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (id.includes("missing"))
      return send(res, 404, { name: "NotFoundError" });
    const s = session(id);
    const tail = match[2];
    if (req.method === "GET" && tail === undefined) {
      if (
        env.FAKE_EXISTING_CHILD === "1" &&
        !childParents.has(id) &&
        ![...childParents.values()].includes(id)
      )
        childParents.set(`ses_fakeoldchild${id.length}`, id);
      return send(res, 200, {
        id,
        directory: process.cwd(),
        title: "existing",
        permission: sessionPermission(id),
        ...(childParents.has(id) ? { parentID: childParents.get(id) } : {}),
      });
    }
    if (req.method === "PATCH" && tail === undefined) {
      record({ event: "permission-patch", permission: body?.permission });
      if (env.FAKE_PATCH_FAIL === "1")
        return send(res, 500, {
          name: "UnknownError",
          data: { message: "FAKE session update failure" },
        });
      if (Array.isArray(body?.permission) && env.FAKE_PATCH_IGNORE !== "1")
        storePermission(id, [...sessionPermission(id), ...body.permission]);
      return send(res, 200, {
        id,
        directory: process.cwd(),
        title: "existing",
        permission: sessionPermission(id),
      });
    }
    if (req.method === "GET" && tail === "/children")
      return send(
        res,
        200,
        [...childParents]
          .filter(([, parent]) => parent === id)
          .map(([child]) => ({
            id: child,
            parentID: id,
            directory: process.cwd(),
            title: "FAKE subagent",
          })),
      );
    if (req.method === "GET" && tail === "/message") {
      if (s.run?.listFail === true)
        return send(res, 500, {
          name: "UnknownError",
          data: { message: "FAKE listing failure" },
        });
      // `limit`: the latest N messages, ascending (`Session.messages`).
      const limit = Number(url.searchParams.get("limit") ?? 0);
      return send(res, 200, limit > 0 ? s.messages.slice(-limit) : s.messages);
    }
    if (req.method === "POST" && tail === "/message") {
      if (s.run !== undefined)
        return send(res, 409, { name: "BusyError", data: { sessionID: id } });
      void runPrompt(s, body, res);
      return;
    }
    if (req.method === "POST" && tail === "/abort") {
      record({
        event: "abort",
        running: s.run !== undefined,
        toolRunning: s.run?.shell !== undefined,
      });
      if (s.run !== undefined) {
        s.run.cancelled = true;
        s.run.shell?.kill("SIGTERM");
        s.run.wake?.();
      }
      if (env.FAKE_ABORT_DROP === "1") {
        record({ event: "abort-dropped" });
        return req.socket.destroy();
      }
      if (env.FAKE_ABORT_DELAY_MS)
        await new Promise((resolve) =>
          setTimeout(resolve, Number(env.FAKE_ABORT_DELAY_MS)),
        );
      record({ event: "abort-answered" });
      return send(res, 200, true);
    }
  }
  if (req.method === "GET" && url.pathname === "/permission")
    return send(res, 200, [...pendingPermissions.values()]);
  if (req.method === "GET" && url.pathname === "/question")
    return send(res, 200, []);
  if (req.method === "POST" && url.pathname.startsWith("/permission/")) {
    const requestId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
    // 1.18.32 answers an unknown (already answered) request with 404
    // PermissionNotFoundError.
    if (!pendingPermissions.delete(requestId))
      return send(res, 404, {
        _tag: "PermissionNotFoundError",
        requestID: requestId,
        message: `Permission request not found: ${requestId}`,
      });
    permissionReplies.set(requestId, body?.reply);
    return send(res, 200, true);
  }
  if (req.method === "POST" && url.pathname.startsWith("/question/"))
    return send(res, 200, true);
  send(res, 404, { name: "NotFoundError" });
});
process.on("SIGTERM", () => {
  record({ event: "signal", signal: "SIGTERM" });
  // OpenCode closes its MCP clients; the Loom entry exits on stdin EOF.
  for (const client of mcpClients.values()) client.child.stdin.end();
  const termDelay = Number(env.FAKE_TERM_DELAY_MS ?? 0);
  setTimeout(() => {
    for (const stream of streams) stream.end();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 200).unref();
  }, termDelay);
});
server.listen(
  Number(args[args.indexOf("--port") + 1]),
  args[args.indexOf("--hostname") + 1],
);
