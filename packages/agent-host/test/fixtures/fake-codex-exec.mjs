#!/usr/bin/env node
// FAKE ordinary Codex exec/resume CLI. No provider calls or accounts.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("codex-cli FAKE-exec");
  process.exit(0);
}
if (args[0] === "debug" && args[1] === "models") {
  console.log(
    JSON.stringify({
      models: [
        {
          slug: "fake-model",
          visibility: "list",
          supported_in_api: true,
          supported_reasoning_levels: [{ effort: "low" }],
          service_tiers: [],
        },
      ],
    }),
  );
  process.exit(0);
}
if (args[0] === "mcp") {
  console.log("[]");
  process.exit(0);
}
if (args[0] !== "exec" || args.includes("app-server"))
  throw Error("FAKE accepts ordinary exec only");
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const wake = Buffer.concat(chunks).toString("utf8");
const option = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const resume = args.indexOf("resume");
const session =
  resume < 0
    ? "11111111-1111-4111-8111-111111111111"
    : args.slice(resume + 1).find((a) => /^[0-9a-f-]{36}$/u.test(a));
if (!session) throw Error("missing resume session");
const root = join(process.env.CODEX_HOME, "sessions");
mkdirSync(root, { recursive: true });
const path = join(root, `rollout-fake-${session}.jsonl`);
const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
const index = (previous.match(/"type":"task_started"/gu) || []).length + 1;
const turn = `fake-turn-${index}`;
const text = `FAKE ORDINARY CODEX ANSWER ${index}`;
const model = option("--model") ?? option("-m") ?? "fake-model";
const effort =
  args
    .find((a) => a.startsWith("model_reasoning_effort="))
    ?.split("=")[1]
    ?.replaceAll('"', "") ?? "low";
const row = (type, payload) =>
  appendFileSync(
    path,
    JSON.stringify({ timestamp: new Date().toISOString(), type, payload }) +
      "\n",
  );
const frame = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const record = (event) =>
  process.env.FAKE_CODEX_EXEC_RECORD_PATH &&
  appendFileSync(
    process.env.FAKE_CODEX_EXEC_RECORD_PATH,
    JSON.stringify({ pid: process.pid, ...event }) + "\n",
  );
record({
  event: "launch",
  args,
  wake,
  session,
  turn,
  codeHome: process.env.CODEX_HOME,
});
if (!previous) row("session_meta", { id: session, memory_mode: "disabled" });
row("event_msg", { type: "task_started", turn_id: turn });
row("response_item", {
  type: "message",
  role: "user",
  content: [{ type: "input_text", text: wake }],
  internal_chat_message_metadata_passthrough: {
    turn_id: turn,
    content_item_kinds: ["user.text"],
  },
});
row("turn_context", { turn_id: turn, model, effort });
frame({
  type: "thread.started",
  thread_id: wake.includes("[fake:wrong-session]")
    ? "22222222-2222-4222-8222-222222222222"
    : session,
});
frame({ type: "turn.started" });
if (wake.includes("[fake:hang]"))
  await new Promise(() => {
    setInterval(() => {}, 1000);
  });
if (wake.includes("[fake:ack]")) {
  const result = spawnSync(
    process.env.RAH_WORKER_CLI,
    ["worker", "message-check"],
    { encoding: "utf8" },
  );
  record({ event: "worker", command: "message-check", status: result.status });
}
if (!wake.includes("[fake:missing-final]")) {
  row("response_item", {
    type: "message",
    role: "assistant",
    phase: "final_answer",
    id: `native-final-${index}`,
    content: [{ type: "output_text", text }],
    internal_chat_message_metadata_passthrough: { turn_id: turn },
  });
  frame({
    type: "item.completed",
    item: { id: `final-${index}`, type: "agent_message", text },
  });
  const output = option("--output-last-message") ?? option("-o");
  if (output) writeFileSync(output, text + "\n");
}
row("token_usage_record", {
  thread_id: session,
  turn_id: turn,
  response_id: `response-${index}`,
  usage: {
    input_tokens: 100,
    cached_input_tokens: wake.includes("[fake:bad-usage]") ? 101 : 0,
    output_tokens: 10,
    reasoning_output_tokens: 0,
  },
});
if (
  wake.includes("[fake:duplicate-usage]") ||
  wake.includes("[fake:conflicting-usage]")
) {
  appendFileSync(
    path,
    JSON.stringify({
      timestamp: new Date(Date.now() + 1000).toISOString(),
      type: "token_usage_record",
      payload: {
        thread_id: session,
        turn_id: turn,
        response_id: `response-${index}`,
        usage: {
          input_tokens: wake.includes("[fake:conflicting-usage]") ? 101 : 100,
          cached_input_tokens: 0,
          output_tokens: 10,
          reasoning_output_tokens: 0,
        },
      },
    }) + "\n",
  );
}
row("event_msg", {
  type: "task_complete",
  turn_id: turn,
  last_agent_message: text,
});
frame({
  type: "turn.completed",
  usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10 },
});
record({ event: "completed", session, turn });
