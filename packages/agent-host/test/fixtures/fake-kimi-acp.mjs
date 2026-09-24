#!/usr/bin/env node
// FAKE `kimi acp` server (no model). Wire shapes follow the installed Kimi
// Code 0.39.1 ACP server read from its published bundle
// (`packages/acp-server/src/{server,session,events-map}.ts`):
//
// - `initialize` advertises `sessionCapabilities.resume`;
// - one prompt at a time; model output is turn-scoped: thought/text chunks,
//   a lazily created `tool_call` (status pending, no rawInput) upgraded by a
//   `tool_call_update` carrying `rawInput`, then the terminal update
//   (`completed`); a live prompt is never echoed back;
// - a Bash tool runs in a CLIENT terminal: `terminal/create` with
//   `/bin/sh -c <command>` and `NO_COLOR=1`/`TERM=dumb`, then
//   `terminal/wait_for_exit`, `terminal/output`, `terminal/release`;
// - compaction is ONE whole local `agent_message_chunk` per fact
//   ("Compacting conversation context…", then `formatCompactionCompleted`);
// - `session/cancel` is a notification; the prompt settles `cancelled`;
// - `usage_update` follows a settled turn (not turn-scoped).
//
// Per-prompt scenario: the next entry of FAKE_SCRIPT (comma separated) or
// FAKE_SCENARIO, tokens joined by "+": compactN, silent, refusal, reply,
// hang (the posting tool waits for FAKE_RELEASE), bgterm (a terminal is left
// running when the turn ends), check (message-check only), nofinal.
// FAKE_RECORD (jsonl) records every frame and event. FAKE_TOOL_COMMAND
// replaces the derived Worker command. FAKE_FOLLOW_UP_MS bounds the wait for
// a cancel before the post-reply generation (default 300).
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
if (args.join(" ") === "provider list --json") {
  process.stdout.write(
    JSON.stringify({
      models: {
        "kimi-code/k3": {
          defaultEffort: "high",
          displayName: "K3",
          provider: "managed:kimi-code",
          supportEfforts: ["low", "high", "max"],
        },
      },
      providers: {},
    }),
  );
  process.exit(0);
}
if (args[0] !== "acp") process.exit(64);
const env = process.env;
const record = (value) =>
  env.FAKE_RECORD &&
  appendFileSync(
    env.FAKE_RECORD,
    `${JSON.stringify({ pid: process.pid, activationId: env.RAH_ACTIVATION_ID, ...value })}\n`,
  );
const send = (value) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...value })}\n`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const script = (env.FAKE_SCRIPT ?? "").split(",").filter(Boolean);
let promptIndex = 0;
let sessionId = "";
let turn;
let turnSequence = 0;
let requestSequence = 0;
const pending = new Map();
record({ event: "spawn", args });
process.on("SIGTERM", () => {
  record({ event: "signal", signal: "SIGTERM" });
  process.exit(0);
});

function request(method, params) {
  requestSequence += 1;
  const id = `fake-${requestSequence}`;
  send({ id, method, params });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function update(value) {
  send({ method: "session/update", params: { sessionId, update: value } });
}

const input = createInterface({ input: process.stdin });
input.on("close", () => {
  record({ event: "stdin-closed" });
  process.exit(0);
});
input.on("line", (line) => {
  const frame = JSON.parse(line);
  record({ frame });
  if (frame.id !== undefined && frame.method === undefined) {
    const waiter = pending.get(String(frame.id));
    pending.delete(String(frame.id));
    if (frame.error) waiter?.reject(new Error(frame.error.message));
    else waiter?.resolve(frame.result);
    return;
  }
  if (frame.method === "initialize") {
    send({
      id: frame.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { resume: {} },
          mcpCapabilities: { http: true, sse: true },
        },
      },
    });
  } else if (frame.method === "session/new") {
    sessionId = env.FAKE_SESSION ?? "kimi-session-new";
    send({ id: frame.id, result: { sessionId } });
  } else if (frame.method === "session/resume") {
    sessionId = frame.params.sessionId;
    send({ id: frame.id, result: {} });
  } else if (frame.method === "session/prompt") {
    if (turn !== undefined && !turn.settled) {
      send({
        id: frame.id,
        error: {
          code: -32600,
          message: "another turn is already in progress",
          data: { code: "turn.agent_busy" },
        },
      });
      return;
    }
    void runPrompt(frame);
  } else if (frame.method === "session/cancel") {
    if (turn !== undefined && !turn.settled) {
      turn.cancelled = true;
      turn.wake?.();
    }
  } else if (frame.id !== undefined) {
    send({ id: frame.id, result: {} });
  }
});

function scenarioTokens() {
  const scenario =
    script[promptIndex] ?? env.FAKE_SCENARIO ?? script.at(-1) ?? "reply";
  promptIndex += 1;
  return new Set(scenario.split("+"));
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
  return `${cli} message-post${turnArg} --based-on-room-seq ${reply[1]}${final ? " --final" : ""} <<'EOF'\nFAKE KIMI reply\nEOF`;
}

async function runPrompt(frame) {
  const tokens = scenarioTokens();
  turnSequence += 1;
  const turnId = `kimi-turn-${turnSequence}`;
  turn = { cancelled: false, id: frame.id, settled: false, turnId };
  const current = turn;
  const text = frame.params.prompt
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  record({ event: "prompt", text, tokens: [...tokens] });
  const settle = (stopReason) => {
    if (current.settled) return;
    current.settled = true;
    record({ event: "settled", stopReason });
    send({ id: frame.id, result: { stopReason } });
    // Not turn-scoped: pushed after the turn settled.
    setTimeout(
      () => update({ sessionUpdate: "usage_update", used: 1234, size: 262144 }),
      5,
    );
  };
  for (const token of tokens) {
    const compactions = /^compact(\d+)$/u.exec(token);
    if (compactions === null) continue;
    for (let index = 0; index < Number(compactions[1]); index += 1) {
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Compacting conversation context…" },
      });
      update({
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: `Compaction completed.\n- Messages compacted: ${(12 + index).toLocaleString("en-US")}\n- Tokens before: ${(220000 + index).toLocaleString("en-US")}\n- Tokens after: 1,500`,
        },
      });
      record({ event: "compacted", index });
    }
  }
  if (tokens.has("silent")) return settle("end_turn");
  if (tokens.has("refusal")) return settle("refusal");
  update({
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: "FAKE KIMI thinking" },
  });
  await delay(Number(env.FAKE_ACCEPT_GAP_MS ?? 0));
  const command = tokens.has("hang")
    ? `: message-post --based-on-room-seq 7 --final; while [ ! -f "$FAKE_RELEASE" ]; do sleep 0.02; done`
    : workerCommand(text, tokens);
  const toolCallId = `${turnId}:call-1`;
  update({
    sessionUpdate: "tool_call",
    toolCallId,
    title: "Bash",
    kind: "other",
    status: "pending",
    content: [{ type: "content", content: { type: "text", text: "" } }],
  });
  update({
    sessionUpdate: "tool_call_update",
    toolCallId,
    title: "Bash",
    kind: "execute",
    status: "in_progress",
    rawInput: { command },
  });
  record({ event: "tool-running", command });
  const created = await request("terminal/create", {
    sessionId,
    command: "/bin/sh",
    args: ["-c", `cd ${process.cwd()} && ${command}`],
    env: [
      { name: "NO_COLOR", value: "1" },
      { name: "TERM", value: "dumb" },
    ],
    cwd: process.cwd(),
    outputByteLimit: 4 * 1024 * 1024,
  });
  const exit = await request("terminal/wait_for_exit", {
    sessionId,
    terminalId: created.terminalId,
  });
  const output = await request("terminal/output", {
    sessionId,
    terminalId: created.terminalId,
  });
  await request("terminal/release", {
    sessionId,
    terminalId: created.terminalId,
  });
  record({ event: "command", command, exit, output: output.output });
  if (tokens.has("bgterm")) {
    const background = await request("terminal/create", {
      sessionId,
      command: "/bin/sh",
      args: ["-c", "sleep 30"],
      env: [
        { name: "NO_COLOR", value: "1" },
        { name: "TERM", value: "dumb" },
      ],
      cwd: process.cwd(),
    });
    record({ event: "background-terminal", terminalId: background.terminalId });
  }
  update({
    sessionUpdate: "tool_call_update",
    toolCallId,
    status: exit.exitCode === 0 ? "completed" : "failed",
    rawOutput: output.output,
  });
  record({ event: "tool-completed" });
  if (current.cancelled) {
    record({ event: "cancelled" });
    return settle("cancelled");
  }
  await new Promise((resolve) => {
    current.wake = resolve;
    setTimeout(resolve, Number(env.FAKE_FOLLOW_UP_MS ?? 300));
  });
  if (current.cancelled) {
    record({ event: "cancelled" });
    return settle("cancelled");
  }
  update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "sent" },
  });
  record({ event: "follow-up-generation" });
  settle("end_turn");
}
