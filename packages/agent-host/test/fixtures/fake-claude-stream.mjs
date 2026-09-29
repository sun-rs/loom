#!/usr/bin/env node
// FAKE Claude Code `--print --input-format stream-json --output-format
// stream-json --replay-user-messages` process. No model: every turn is a
// scripted sequence. Shapes follow the installed Claude Code 2.1.282 stream
// protocol (SDK types `SDKUserMessageReplay`, `SDKControlInterruptRequest`,
// interrupt receipt `still_queued`/`cancelled`, result `terminal_reason`):
//
// - every stdin `user` message is queued; when it drains into a turn its
//   replay echo `{type:"user", isReplay:true, uuid:<inbound uuid>}` is
//   written, then (first turn only) `system/init` with `capabilities`;
// - one `result` per turn, after that turn's frames;
// - `control_request` `interrupt` aborts the running turn (result
//   `error_during_execution`, `terminal_reason` aborted_tools/streaming) and,
//   with `cancel_queued:true`, cancels queued inputs, listed on the receipt.
//
// Env: FAKE_RECORD (jsonl), FAKE_RELEASE (file that ends the posting tool),
// FAKE_TOOL=final|plain|none, FAKE_FOLLOW_UP_FIRST=1, FAKE_REJECT_INTERRUPT=1,
// FAKE_NO_RECEIPT=1 (older CLI: empty interrupt success), FAKE_REPLAY_UUID=
// mismatch|absent, FAKE_HISTORY_REPLAY=1 (a resumed session first re-emits an
// earlier user message with the same text and its own uuid), FAKE_SESSION,
// FAKE_TURN_DELAY_MS, FAKE_IGNORE_CANCEL_QUEUED=1 (receipt lists survivors),
// FAKE_NO_LIFECYCLE=1 (an older CLI without `msg_lifecycle_v1`),
// FAKE_NO_TERMINAL_REASON=1 (an older CLI: an interrupted result carries no
// `terminal_reason`), FAKE_SILENT_INTERRUPT=1 (the interrupt ends the turn but
// its control_response never arrives), FAKE_RECEIPT_AFTER_RESULT=1 (the
// interrupt's success control_response is written right after the aborted
// result instead of before it), FAKE_INTERRUPT_TERMINAL_REASON (the
// interrupted turn's result carries this `terminal_reason` instead, e.g. a
// provider failure that lands while the interrupt is in flight),
// FAKE_RESULT_ERRORS (JSON array: the interrupted result's `errors[]`, the
// only error text a real error result carries), FAKE_BACKGROUND_TASK=
// success|error (a background task the wake started finishes after stdin
// closed: the CLI runs one more native turn nobody asked for, see below).
//
// Background task (real 2.1.282 against a local fake Messages API, no model;
// full review batch 3 P1-4): after the wake's result and its `completed`
// lifecycle, stdin EOF does not exit while a `run_in_background` Bash task
// runs. When it finishes the CLI writes `system/task_notification`, a new
// `system/init`, the assistant frames and a `result` WITHOUT
// `user_message_uuid`/`user_message_uuids` and no lifecycle, then exits (1
// only when that last result had `is_error`).
//
// Exit code (real 2.1.282 `runHeadless`, read from the installed binary's
// embedded source: `go(en?.type==="result"&&en?.is_error||io?1:0)`): when
// stdin closes and the queue drains the process exits 1 if the last result it
// wrote had `is_error: true` (an interrupted turn's `error_during_execution`
// included), otherwise 0.
//
// Verified against the real 2.1.282 binary without any model call (API base
// URL pointed at a local server that never answers): `command_lifecycle`
// frames queued -> started -> completed|cancelled per inbound uuid, one
// `system/init` per turn, the replay echo carries the inbound uuid, a busy
// input stays queued until the running turn ends, and `result` carries
// `user_message_uuid` (the turn's inbound uuid) and `result_index`.
import { appendFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("2.1.282 (Claude Code)\n");
  process.exit(0);
}
const env = process.env;
const record = (value) =>
  env.FAKE_RECORD &&
  appendFileSync(
    env.FAKE_RECORD,
    `${JSON.stringify({ pid: process.pid, ...value })}\n`,
  );
const resumeAt = args.indexOf("--resume");
const sessionAt = args.indexOf("--session-id");
const sessionId =
  resumeAt >= 0
    ? args[resumeAt + 1]
    : sessionAt >= 0
      ? args[sessionAt + 1]
      : (env.FAKE_SESSION ?? "claude-session-1");
const send = (value) =>
  process.stdout.write(
    `${JSON.stringify({ session_id: sessionId, ...value })}\n`,
  );
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
record({ kind: "spawn", args });
process.on("SIGINT", () => {
  record({ kind: "signal", signal: "SIGINT" });
  process.exit(0);
});
process.on("SIGTERM", () => {
  record({ kind: "signal", signal: "SIGTERM" });
  process.exit(0);
});

const queue = [];
let running;
let initialized = false;
let inputClosed = false;
let turnIndex = 0;
let resultIndex = 0;
let lastResultIsError = false;
let backgroundRan = false;
const lifecycle = (uuid, state) => {
  if (env.FAKE_NO_LIFECYCLE === "1" || typeof uuid !== "string") return;
  send({
    type: "command_lifecycle",
    command_uuid: uuid,
    state,
    uuid: `lc-${String(Math.random()).slice(2)}`,
  });
};

const textOf = (message) =>
  Array.isArray(message?.content)
    ? message.content
        .filter((part) => part?.type === "text")
        .map((part) => part.text)
        .join("")
    : String(message?.content ?? "");

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
    record({ kind: "input", uuid: frame.uuid, text: textOf(frame.message) });
    lifecycle(frame.uuid, "queued");
    queue.push(frame);
    void drain();
  })
  .on("close", () => {
    inputClosed = true;
    record({ kind: "stdin-closed" });
    void drain();
  });

async function drain() {
  if (running !== undefined) return;
  const next = queue.shift();
  if (next === undefined) {
    if (inputClosed) {
      if (env.FAKE_BACKGROUND_TASK && !backgroundRan) {
        backgroundRan = true;
        running = { background: true };
        await backgroundTurn();
        running = undefined;
      }
      process.exit(lastResultIsError ? 1 : 0);
    }
    return;
  }
  running = { input: next, interrupted: false, wake: () => undefined };
  try {
    await runTurn(running);
  } finally {
    running = undefined;
  }
  void drain();
}

function replayOf(frame) {
  const replay = {
    type: "user",
    isReplay: true,
    parent_tool_use_id: null,
    message: { role: "user", content: frame.message.content },
    uuid: frame.uuid,
  };
  if (env.FAKE_REPLAY_UUID === "mismatch")
    replay.uuid = "00000000-0000-4000-8000-000000000000";
  if (env.FAKE_REPLAY_UUID === "absent") delete replay.uuid;
  return replay;
}

async function runTurn(turn) {
  turnIndex += 1;
  const { input } = turn;
  if (env.FAKE_HISTORY_REPLAY === "1" && resumeAt >= 0 && turnIndex === 1) {
    // A resumed session's earlier message: same text, its own uuid.
    send({
      type: "user",
      isReplay: true,
      parent_tool_use_id: null,
      message: { role: "user", content: input.message.content },
      uuid: "11111111-1111-4111-8111-111111111111",
    });
  }
  lifecycle(input.uuid, "started");
  if (!initialized || env.FAKE_INIT_EVERY_TURN !== "0") {
    initialized = true;
    send({
      type: "system",
      subtype: "init",
      capabilities: [
        "interrupt_receipt_v1",
        "interrupt_cancel_queued_v1",
        ...(env.FAKE_NO_LIFECYCLE === "1" ? [] : ["msg_lifecycle_v1"]),
      ],
    });
  }
  send(replayOf(input));
  record({ kind: "turn-started", uuid: input.uuid, turn: turnIndex });
  const tool = env.FAKE_TOOL ?? "final";
  if (tool !== "none") {
    const command =
      tool === "final"
        ? `loom-worker message-post --target "#main" --final <<'EOF'\nreply --final quoted\nEOF`
        : "loom-worker message-check";
    const id = `tool-${String(turnIndex)}`;
    send({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id, name: "Bash", input: { command } }],
      },
    });
    record({ kind: "tool-running", turn: turnIndex });
    if (env.FAKE_FOLLOW_UP_FIRST !== "1" && env.FAKE_RELEASE)
      while (!existsSync(env.FAKE_RELEASE) && !turn.interrupted)
        await delay(10);
    send({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: id, content: "posted" }],
      },
    });
    record({ kind: "tool-completed", turn: turnIndex });
  }
  if (env.FAKE_FOLLOW_UP_FIRST === "1") {
    send({ type: "stream_event", event: { type: "message_start" } });
    record({ kind: "follow-up-started", turn: turnIndex });
    await new Promise((resolve) => {
      turn.wake = resolve;
      setTimeout(resolve, 3_000);
    });
  } else if (!turn.interrupted) {
    await new Promise((resolve) => {
      turn.wake = resolve;
      setTimeout(resolve, Number(env.FAKE_TURN_DELAY_MS ?? 400));
    });
  }
  if (turn.interrupted) {
    send({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      num_turns: 1,
      errors: JSON.parse(env.FAKE_RESULT_ERRORS || "[]"),
      ...(env.FAKE_NO_TERMINAL_REASON === "1"
        ? {}
        : {
            terminal_reason:
              env.FAKE_INTERRUPT_TERMINAL_REASON ||
              (env.FAKE_FOLLOW_UP_FIRST === "1"
                ? "aborted_streaming"
                : "aborted_tools"),
          }),
      usage: { input_tokens: 10, output_tokens: 1 },
      user_message_uuid: input.uuid,
      user_message_uuids: [input.uuid],
      result_index: resultIndex++,
    });
    lastResultIsError = true;
    turn.receipt?.();
    lifecycle(input.uuid, "cancelled");
    record({ kind: "turn-interrupted", turn: turnIndex });
    return;
  }
  send({ type: "stream_event", event: { type: "message_start" } });
  send({
    type: "assistant",
    message: {
      id: `msg-${String(turnIndex)}`,
      role: "assistant",
      content: [{ type: "text", text: "sent" }],
      usage: { input_tokens: 100, output_tokens: 2 },
    },
  });
  record({ kind: "follow-up-generation", turn: turnIndex });
  send({
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 2,
    result: "sent",
    terminal_reason: "completed",
    usage: { input_tokens: 100, output_tokens: 2 },
    user_message_uuid: input.uuid,
    user_message_uuids: [input.uuid],
    result_index: resultIndex++,
  });
  lastResultIsError = false;
  lifecycle(input.uuid, "completed");
  record({ kind: "turn-completed", turn: turnIndex });
}

// The uuid-less native turn a finished background task starts (order above).
async function backgroundTurn() {
  await delay(50);
  record({ kind: "background-turn" });
  send({
    type: "system",
    subtype: "task_notification",
    task_id: "bfake0001",
    tool_use_id: "tool-1",
    status: "completed",
    summary: 'Background command "FAKE" completed (exit code 0)',
  });
  send({
    type: "system",
    subtype: "init",
    capabilities: [
      "interrupt_receipt_v1",
      "interrupt_cancel_queued_v1",
      ...(env.FAKE_NO_LIFECYCLE === "1" ? [] : ["msg_lifecycle_v1"]),
    ],
  });
  send({
    type: "assistant",
    message: {
      id: "msg-background",
      role: "assistant",
      content: [{ type: "text", text: "FAKE background follow-up" }],
      usage: { input_tokens: 50, output_tokens: 3 },
    },
  });
  const failed = env.FAKE_BACKGROUND_TASK === "error";
  send({
    type: "result",
    subtype: failed ? "error_during_execution" : "success",
    is_error: failed,
    num_turns: 1,
    ...(failed
      ? { errors: ["FAKE background turn failure"] }
      : { result: "FAKE background follow-up" }),
    terminal_reason: failed ? "model_error" : "completed",
    usage: { input_tokens: 50, output_tokens: 3 },
    result_index: resultIndex++,
  });
  lastResultIsError = failed;
}

function control(frame) {
  const subtype = frame.request?.subtype;
  record({ kind: "control", subtype, request: frame.request });
  if (subtype === "initialize") {
    // The model catalog probe (no model call).
    send({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: frame.request_id,
        response: {
          models: [
            {
              value: "sonnet",
              displayName: "Sonnet",
              description: "FAKE",
              supportsEffort: true,
              supportedEffortLevels: ["low", "high"],
            },
          ],
        },
      },
    });
    return;
  }
  if (subtype !== "interrupt") {
    send({
      type: "control_response",
      response: {
        subtype: "error",
        request_id: frame.request_id,
        error: `unsupported ${String(subtype)}`,
      },
    });
    return;
  }
  if (env.FAKE_REJECT_INTERRUPT === "1") {
    send({
      type: "control_response",
      response: {
        subtype: "error",
        request_id: frame.request_id,
        error: "interrupt unsupported",
      },
    });
    return;
  }
  const cancelQueued =
    frame.request.cancel_queued === true &&
    env.FAKE_IGNORE_CANCEL_QUEUED !== "1";
  const survivors = queue.filter((input) => typeof input.uuid === "string");
  let response = {};
  if (env.FAKE_NO_RECEIPT !== "1") {
    if (cancelQueued) {
      queue.splice(0, queue.length);
      for (const input of survivors) lifecycle(input.uuid, "cancelled");
      response = { still_queued: [], cancelled: survivors.map((i) => i.uuid) };
    } else response = { still_queued: survivors.map((i) => i.uuid) };
  }
  const receipt = () =>
    send({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: frame.request_id,
        response,
      },
    });
  if (env.FAKE_SILENT_INTERRUPT === "1") {
    // No receipt at all.
  } else if (env.FAKE_RECEIPT_AFTER_RESULT === "1" && running !== undefined)
    running.receipt = receipt;
  else receipt();
  if (running !== undefined) {
    running.interrupted = true;
    running.wake();
  }
}
