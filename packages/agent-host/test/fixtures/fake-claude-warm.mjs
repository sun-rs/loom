#!/usr/bin/env node
// FAKE long-lived Claude Code `-p --input-format stream-json --output-format
// stream-json --replay-user-messages` process for S2-c1 warm-runtime tests.
// Not a model. Frame shapes and ordering follow what the installed Claude
// Code 2.1.282 emitted locally with no model call (its API base URL pointed at
// a local server that never answers or refuses):
//
// - each stdin `user` message gets `command_lifecycle` `queued`; one message
//   at a time drains into a native turn: `started`, `system/init` (with
//   `capabilities`), the replay echo `{isReplay:true, uuid:<inbound uuid>}`;
// - a message written while a turn runs is folded into it at the next tool
//   boundary (after the tool_result: its replay, then `started`), and its
//   `completed`/`cancelled` comes BEFORE that turn's result (full review
//   batch 3 P1-5, real 2.1.282 against a local fake Messages API; the
//   binary's schema: "a command folded into an already-in-flight turn emits
//   'completed' BEFORE that turn's result frame"). One written with no tool
//   boundary left stays queued for its own turn;
// - exactly one `result` per native turn, carrying `user_message_uuid` (its
//   first input), `user_message_uuids` (every input it ran) and
//   `result_index`, then `command_lifecycle` `completed`/`cancelled`;
// - `control_request` `interrupt` aborts the running turn (`result`
//   `error_during_execution`, `terminal_reason` aborted_*); with
//   `cancel_queued:true` it cancels queued messages (lifecycle `cancelled`,
//   listed on the receipt `{still_queued:[], cancelled:[...]}`).
//
// A turn's behaviour is chosen by `[fake:<directive>]` tokens in its text.
// Directives for the final interrupt: `no-reason` (an older CLI: the aborted
// result carries no `terminal_reason`), `receipt-after-result` (the interrupt
// receipt is written right after the aborted result instead of before it).
// Env: FAKE_CLAUDE_RECORD_PATH, FAKE_CLAUDE_STATE_DIR, FAKE_NO_LIFECYCLE=1,
// FAKE_IGNORE_CANCEL_QUEUED=1.
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("2.1.282 (Claude Code)\n");
  process.exit(0);
}
const env = process.env;
const stateDirectory = env.FAKE_CLAUDE_STATE_DIR;
if (stateDirectory) mkdirSync(stateDirectory, { recursive: true });
const record = (event) =>
  env.FAKE_CLAUDE_RECORD_PATH &&
  appendFileSync(
    env.FAKE_CLAUDE_RECORD_PATH,
    `${JSON.stringify({ pid: process.pid, at: Date.now(), ...event })}\n`,
  );
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const sessionsPath = stateDirectory
  ? join(stateDirectory, "sessions.json")
  : "";
const knownSessions = () =>
  sessionsPath && existsSync(sessionsPath)
    ? JSON.parse(readFileSync(sessionsPath, "utf8"))
    : [];
const resumed = flag("--resume");
const sessionId = resumed ?? flag("--session-id") ?? `fake-${process.pid}`;
const missingSession =
  resumed !== undefined && !knownSessions().includes(resumed);
record({
  event: "start",
  argv: args,
  sessionId,
  runtimeTag: env.LOOM_RUNTIME_ID,
});
const lifecycleOn = env.FAKE_NO_LIFECYCLE !== "1";
const send = (value) =>
  process.stdout.write(
    `${JSON.stringify({ session_id: sessionId, ...value })}\n`,
  );
const lifecycle = (uuid, state) => {
  if (lifecycleOn && typeof uuid === "string")
    send({
      type: "command_lifecycle",
      command_uuid: uuid,
      state,
      uuid: `lc-${String(Math.random()).slice(2, 10)}`,
    });
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const textOf = (message) =>
  (message?.content ?? [])
    .filter((part) => part?.type === "text")
    .map((part) => part.text)
    .join("");

const queue = [];
let running;
let resultIndex = 0;
let inputClosed = false;
let turnCounter = 0;
// Like the model, a later input (a busy notice) uses the handle of the
// latest wake in its context.
let lastHandle;

createInterface({ input: process.stdin })
  .on("line", (line) => {
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      return;
    }
    if (frame.type === "control_request") return control(frame);
    if (frame.type !== "user") return;
    record({ event: "input", uuid: frame.uuid, text: textOf(frame.message) });
    lifecycle(frame.uuid, "queued");
    queue.push(frame);
    void drain();
  })
  .on("close", () => {
    inputClosed = true;
    if (running === undefined) process.exit(0);
  });

async function drain() {
  if (running !== undefined) return;
  const next = queue.shift();
  if (next === undefined) {
    if (inputClosed) process.exit(0);
    return;
  }
  const turn = {
    input: next,
    uuid: next.uuid,
    text: textOf(next.message),
    interrupted: false,
    folded: [],
    wake: () => undefined,
  };
  running = turn;
  try {
    await runTurn(turn);
  } finally {
    running = undefined;
  }
  void drain();
}

function result(turn, fields) {
  const folded = turn.folded ?? [];
  // Folded inputs end before the turn's result.
  for (const uuid of folded)
    lifecycle(uuid, turn.interrupted ? "cancelled" : "completed");
  send({
    type: "result",
    num_turns: 1,
    usage: { input_tokens: 100, output_tokens: 10 },
    user_message_uuid: turn.uuid,
    user_message_uuids: [turn.uuid, ...folded],
    result_index: resultIndex++,
    ...fields,
  });
}

// The real CLI takes every queued input into the running turn at a tool
// boundary.
function foldQueued(turn) {
  while (queue.length > 0 && !turn.interrupted) {
    const input = queue.shift();
    send({
      type: "user",
      isReplay: true,
      parent_tool_use_id: null,
      uuid: input.uuid,
      message: { role: "user", content: input.message.content },
    });
    lifecycle(input.uuid, "started");
    turn.folded.push(input.uuid);
    record({ event: "folded", uuid: input.uuid, into: turn.uuid });
  }
}

async function runTurn(turn) {
  turnCounter += 1;
  const has = (name) => turn.text.includes(`[fake:${name}]`);
  if (missingSession) {
    result(turn, {
      subtype: "error_during_execution",
      is_error: true,
      errors: [`No conversation found with session ID: ${sessionId}`],
    });
    lifecycle(turn.uuid, "cancelled");
    return;
  }
  lifecycle(turn.uuid, "started");
  send({
    type: "system",
    subtype: "init",
    capabilities: [
      "interrupt_receipt_v1",
      "interrupt_cancel_queued_v1",
      ...(lifecycleOn ? ["msg_lifecycle_v1"] : []),
    ],
  });
  send({
    type: "user",
    isReplay: true,
    parent_tool_use_id: null,
    uuid: turn.uuid,
    message: { role: "user", content: turn.input.message.content },
  });
  if (sessionsPath && !knownSessions().includes(sessionId))
    writeFileSync(
      sessionsPath,
      JSON.stringify([...knownSessions(), sessionId]),
    );
  const ownHandle = /--turn ([A-Za-z0-9_-]{22})/u.exec(turn.text)?.[1];
  if (ownHandle !== undefined) lastHandle = ownHandle;
  const handle = ownHandle ?? lastHandle;
  record({ event: "turn", uuid: turn.uuid, handle, text: turn.text });
  send({ type: "stream_event", event: { type: "message_start" } });
  const crashMarker = stateDirectory ? join(stateDirectory, "crashed") : "";
  if (has("crash-during") && crashMarker && !existsSync(crashMarker)) {
    writeFileSync(crashMarker, "1");
    await delay(100);
    process.exit(4);
  }
  if (has("final") || has("final-reject") || has("post-nofinal")) {
    await tool(turn, handle, ["worker", "message-check"]);
    await tool(turn, handle, [
      "worker",
      "message-post",
      ...(has("post-nofinal") ? [] : ["--final"]),
      "--body",
      `FAKE final answer for ${turn.uuid}`,
    ]);
    record({ event: "final-window", uuid: turn.uuid });
    await wait(turn, 1_000);
  } else {
    const hangMarker = stateDirectory ? join(stateDirectory, "hung-once") : "";
    const hangOnce = has("hang-once") && hangMarker && !existsSync(hangMarker);
    if (hangOnce) writeFileSync(hangMarker, "1");
    if (hangOnce || has("hang")) await wait(turn, 60_000);
    if (has("busy-wait")) {
      const deadline = Date.now() + 5_000;
      while (queue.length === 0 && Date.now() < deadline && !turn.interrupted)
        await delay(20);
    }
    if (has("slow")) await wait(turn, 1_500);
    // A busy notice (no directive, no handle of its own): the model reads.
    const notice = ownHandle === undefined && !/\[fake:/u.test(turn.text);
    if (notice) await wait(turn, 300);
    if (
      !turn.interrupted &&
      (has("ack") || has("busy-wait") || has("slow") || notice)
    )
      await tool(turn, handle, ["worker", "message-check"]);
  }
  if (turn.interrupted) {
    result(turn, {
      subtype: "error_during_execution",
      is_error: true,
      errors: [],
      ...(has("no-reason") ? {} : { terminal_reason: "aborted_streaming" }),
    });
    // A receipt held back by `receipt-after-result`.
    if (turn.receipt !== undefined) setTimeout(turn.receipt, 0);
    lifecycle(turn.uuid, "cancelled");
    record({ event: "turn-completed", uuid: turn.uuid, interrupted: true });
    return;
  }
  send({
    type: "assistant",
    message: {
      id: `msg-${process.pid}-${turnCounter}`,
      role: "assistant",
      content: [{ type: "text", text: "sent" }],
      usage: { input_tokens: 100, output_tokens: 10 },
    },
  });
  record({ event: "follow-up-generation", uuid: turn.uuid });
  result(turn, {
    subtype: "success",
    is_error: false,
    result: "sent",
    terminal_reason: "completed",
  });
  lifecycle(turn.uuid, "completed");
  record({ event: "turn-completed", uuid: turn.uuid, interrupted: false });
  if (has("crash-after")) setTimeout(() => process.exit(3), 300);
  if (has("autonomous-after")) setTimeout(() => void autonomous(), 200);
}

// A native turn nobody asked for: real 2.1.282 (local fake Messages API) runs
// it when a background task finishes — `system/task_notification`, a fresh
// `system/init`, the model frames and a result naming no input, and no
// `command_lifecycle` at all.
async function autonomous() {
  const uuid = `auto-${process.pid}`;
  const turn = {
    uuid,
    text: "",
    interrupted: false,
    folded: [],
    wake: () => undefined,
  };
  running = turn;
  record({ event: "autonomous-started", uuid });
  send({
    type: "system",
    subtype: "task_notification",
    task_id: "bfake0001",
    status: "completed",
  });
  send({
    type: "system",
    subtype: "init",
    capabilities: [
      "interrupt_receipt_v1",
      "interrupt_cancel_queued_v1",
      ...(lifecycleOn ? ["msg_lifecycle_v1"] : []),
    ],
  });
  send({ type: "stream_event", event: { type: "message_start" } });
  await wait(turn, 5_000);
  send({
    type: "result",
    num_turns: 1,
    usage: { input_tokens: 100, output_tokens: 10 },
    result_index: resultIndex++,
    ...(turn.interrupted
      ? {
          subtype: "error_during_execution",
          is_error: true,
          errors: [],
          terminal_reason: "aborted_streaming",
        }
      : {
          subtype: "success",
          is_error: false,
          result: "",
          terminal_reason: "completed",
        }),
  });
  record({ event: "autonomous-ended", uuid, interrupted: turn.interrupted });
  running = undefined;
  void drain();
}

async function wait(turn, ms) {
  if (turn.interrupted) return;
  await new Promise((resolve) => {
    turn.wake = resolve;
    setTimeout(resolve, ms);
  });
}

async function tool(turn, handle, command) {
  const id = `tool-${String(Math.random()).slice(2, 10)}`;
  send({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id,
          name: "Bash",
          input: { command: `rah ${command.join(" ")}` },
        },
      ],
    },
  });
  const cli = env.RAH_WORKER_CLI;
  if (!cli || !handle) {
    record({ event: "worker", uuid: turn.uuid, skipped: true });
  } else {
    const outcome = await execute(cli, [...command, "--turn", handle]);
    record({ event: "worker", uuid: turn.uuid, command, ...outcome });
  }
  send({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: "ok" }],
    },
  });
  foldQueued(turn);
}

function control(frame) {
  const subtype = frame.request?.subtype;
  record({ event: "control", request: frame.request });
  const respond = (response) =>
    send({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: frame.request_id,
        response,
      },
    });
  if (subtype === "initialize")
    return respond({
      models: [
        {
          value: "sonnet",
          displayName: "Sonnet",
          description: "FAKE",
          supportsEffort: true,
          supportedEffortLevels: ["low", "high"],
        },
      ],
    });
  if (subtype !== "interrupt")
    return send({
      type: "control_response",
      response: {
        subtype: "error",
        request_id: frame.request_id,
        error: `unsupported ${String(subtype)}`,
      },
    });
  if (running?.text.includes("[fake:final-reject]"))
    return send({
      type: "control_response",
      response: {
        subtype: "error",
        request_id: frame.request_id,
        error: "interrupt refused",
      },
    });
  const cancelQueued =
    frame.request.cancel_queued === true &&
    env.FAKE_IGNORE_CANCEL_QUEUED !== "1";
  const survivors = queue.map((input) => input.uuid);
  let receipt;
  if (cancelQueued) {
    queue.splice(0, queue.length);
    for (const uuid of survivors) {
      lifecycle(uuid, "cancelled");
      record({ event: "cancelled", uuid });
    }
    receipt = { still_queued: [], cancelled: survivors };
  } else receipt = { still_queued: survivors };
  if (running?.text.includes("[fake:receipt-after-result]"))
    running.receipt = () => respond(receipt);
  else respond(receipt);
  if (running !== undefined) {
    running.interrupted = true;
    running.wake();
  }
}

function execute(command, commandArgs) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("close", (status) =>
      resolve({
        status,
        stdout: stdout.slice(0, 4000),
        stderr: stderr.slice(0, 4000),
      }),
    );
  });
}

for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    record({ event: "stop", signal });
    process.exit(0);
  });
