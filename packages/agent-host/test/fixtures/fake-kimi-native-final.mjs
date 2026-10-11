#!/usr/bin/env node
// FAKE ACP process. No provider, tools or external network calls.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
const args = process.argv.slice(2),
  env = process.env;
if (args.includes("--version")) {
  console.log("kimi-code 0.39.1 FAKE");
  process.exit(0);
}
if (args.join(" ") === "provider list --json") {
  console.log(
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
const record = (x) =>
  appendFileSync(
    env.FAKE_KIMI_NATIVE_RECORD_PATH,
    JSON.stringify({ pid: process.pid, ...x }) + "\n",
  );
const send = (x) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...x }) + "\n");
let sessionId = "fake-kimi-native-session",
  wire,
  turn = 0,
  pending,
  model = "kimi-code/k3",
  effort = "low";
const update = (update) =>
  send({ method: "session/update", params: { sessionId, update } });
const append = (x) =>
  appendFileSync(
    wire,
    JSON.stringify({ agentId: "main", time: Date.now(), ...x }) + "\n",
  );
function establish() {
  const dir = join(env.KIMI_CODE_HOME, "sessions", "fake", sessionId);
  mkdirSync(join(dir, "agents", "main"), { recursive: true });
  wire = join(dir, "agents", "main", "wire.jsonl");
  if (!existsSync(wire)) {
    writeFileSync(
      wire,
      JSON.stringify({ type: "metadata", protocol_version: "1.5" }) + "\n",
    );
    appendFileSync(
      join(env.KIMI_CODE_HOME, "session_index.jsonl"),
      JSON.stringify({ sessionId, sessionDir: dir }) + "\n",
    );
  }
  turn = readFileSync(wire, "utf8")
    .split("\n")
    .filter((l) => l.includes('"turn.ended"')).length;
  update({
    sessionUpdate: "available_commands_update",
    availableCommands: [{ name: "mcp", description: "FAKE local readiness" }],
  });
}
record({ event: "launch", args, disableCron: env.KIMI_DISABLE_CRON });
process.on("SIGTERM", () => {
  record({ event: "terminated" });
  if (env.FAKE_KIMI_IGNORE_TERM !== "1") process.exit(0);
});
const lines = createInterface({ input: process.stdin });
lines.on("close", () => {
  record({ event: "eof" });
  setTimeout(
    () => {
      record({
        event: "native-exit",
        code: Number(env.FAKE_KIMI_EXIT_CODE ?? 0),
      });
      process.exit(Number(env.FAKE_KIMI_EXIT_CODE ?? 0));
    },
    Number(env.FAKE_KIMI_EOF_DELAY_MS ?? 0),
  );
});
lines.on("line", (line) => {
  const f = JSON.parse(line);
  if (f.method === "initialize")
    return send({
      id: f.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          sessionCapabilities: { resume: {} },
          mcpCapabilities: { http: true, sse: true },
        },
      },
    });
  if (f.method === "session/new" || f.method === "session/resume") {
    if (f.params.sessionId) sessionId = f.params.sessionId;
    record({ event: "session", method: f.method, session: sessionId });
    establish();
    return send({
      id: f.id,
      result: {
        sessionId,
        configOptions: [{ id: "mode", currentValue: "default" }],
      },
    });
  }
  if (f.method === "session/set_config_option") {
    if (f.params.configId === "model") model = f.params.value;
    if (f.params.configId === "thinking") effort = f.params.value;
    return send({
      id: f.id,
      result: {
        configOptions: [
          { id: f.params.configId, currentValue: f.params.value },
        ],
      },
    });
  }
  if (f.method === "session/cancel") {
    if (pending) {
      send({ id: pending, result: { stopReason: "cancelled" } });
      pending = undefined;
    }
    return;
  }
  if (f.method !== "session/prompt")
    return f.id === undefined ? undefined : send({ id: f.id, result: {} });
  const text = f.params.prompt.map((p) => p.text ?? "").join("");
  if (text === "/mcp") {
    update({
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: "MCP servers (1):\n- loom_worker (stdio): connected, 1 tools",
      },
    });
    return send({ id: f.id, result: { stopReason: "end_turn" } });
  }
  record({ event: "prompt", session: sessionId, text, turn });
  const content = [{ type: "text", text }];
  append({ type: "prompt.accepted", promptId: "fake-input-" + turn, content });
  append({ type: "turn.prompt", input: content, origin: { kind: "user" } });
  append({
    type: "context.append_loop_event",
    event: {
      type: "step.begin",
      uuid: "begin-" + turn,
      turnId: String(turn),
      step: 1,
    },
  });
  update({
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: "FAKE thinking" },
  });
  if (text.includes("[fake:hang]")) {
    pending = f.id;
    return;
  }
  if (env.FAKE_KIMI_PENDING_TOOL === "1")
    update({
      sessionUpdate: "tool_call",
      toolCallId: "unfinished",
      status: "in_progress",
      title: "FAKE unfinished",
    });
  const body = "FAKE KIMI NATIVE ANSWER " + (turn + 1),
    messageId = "fake-message-" + turn;
  const usage = {
    inputOther: 100,
    inputCacheRead: 0,
    inputCacheCreation: 0,
    output: 10,
  };
  append({
    type: "llm.request",
    kind: "loop",
    turnStep: turn + ".1",
    modelAlias: model,
    thinkingEffort: effort,
  });
  append({
    type: "context.append_loop_event",
    event: {
      type: "content.part",
      turnId: String(turn),
      step: 1,
      stepUuid: "begin-" + turn,
      part: { type: "text", text: body },
    },
  });
  append({ type: "usage.record", usageScope: "turn", usage });
  append({
    type: "context.append_loop_event",
    event: {
      type: "step.end",
      uuid: "begin-" + turn,
      turnId: String(turn),
      step: 1,
      finishReason: "end_turn",
      providerFinishReason: "completed",
      rawFinishReason: "stop",
      messageId,
      usage,
    },
  });
  append({ type: "turn.ended", turnId: turn, reason: "completed" });
  update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: body },
  });
  record({ event: "completed", session: sessionId, body });
  send({ id: f.id, result: { stopReason: "end_turn" } });
});
