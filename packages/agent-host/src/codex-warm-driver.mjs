// S2-a warm Codex driver (S2 spec §2/§4, contract §6a): one long-lived
// `codex app-server --listen unix://<0700 dir>/app-server.sock` per Role
// instance. The driver is the process-group leader and the Host's only
// channel to it:
//
//   Host -> driver (stdin, one JSON object per line)
//     {op:"turn.begin", runAttemptId, runtimeRunId, text, model?, effort?}
//     {op:"turn.notice", runAttemptId, line}   busy Human input -> turn/steer
//     {op:"turn.interrupt", runAttemptId}
//     {op:"turn.final", runAttemptId, nativeTurnId}   final reply committed:
//                                              interrupt at the tool boundary
//     {op:"shutdown"}                          (stdin EOF means the same)
//   driver -> Host (fd3, one envelope per line)
//     {loom:"warm-runtime/v1", seq, runtimeId, hostGeneration, type, ...}
//     type ready | turn.accepted | turn.failed | frame | progress |
//          turn.drained | unattributed | fatal
//
// S2-b `progress` (turn identity, `toolsInFlight`, `awaitingApproval`) is
// native turn progress that yields no frame: item deltas (throttled) and
// every tool item start/completion. The Host's stall clock counts only
// frames and progress, never transport liveness. Approvals are decided
// unattended here, so `awaitingApproval` is always false for Codex.
//
// Every business frame of a turn (trajectory, usage, delivery acceptance,
// busy-input receipts) travels as `frame` with that turn's
// runAttemptId and native turn id, assigned from the Codex notification's own
// thread/turn identity, never from "the current turn". A notification whose
// turn is unknown is reported as `unattributed` and dropped. `turn.drained`
// follows the matching `turn/completed` and names the last frame sequence of
// the turn; anything later for that turn is late (the Host records it as a
// usage gap). The thread is started or resumed once, at process start; the
// Host persists that session binding from `ready`, before any turn input.
// `turn.drained` waits for an in-flight `turn/steer` response, so an accepted
// steer's receipt is always inside its turn.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, writeSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";

import { attachCodexBusyInput } from "./codex-busy-input.js";
import { createCodexFinalInterrupt } from "./codex-final-interrupt.js";
import {
  CodexApprovalPolicyError,
  CodexUnattendedApprovalPolicy,
} from "./codex-unattended-approval.js";
import { assertSessionReplacementAllowed } from "./provider-activation-input.js";
import {
  providerLaunchArguments,
  providerLaunchPolicy,
  providerMemoryConfig as memoryConfig,
} from "./provider-launch-arguments.js";
import { readProviderPromptFile } from "./provider-prompt-file.js";
import {
  codexWorkspaceRoots,
  parseAttachedDirectory,
} from "./channel-attached-directories.js";
import {
  normalizeCodexTrajectoryNotification,
  RuntimeTrajectoryWriter,
} from "./provider-trajectory-normalizer.js";
import {
  CodexTokenUsageTracker,
  ProviderUsageWriter,
} from "./provider-usage.js";
import { connectUnixWebSocket } from "./unix-websocket.mjs";

const HANDSHAKE_TIMEOUT_MS = 30_000;
const SOCKET_WAIT_MS = 30_000;
const PROVIDER_TERM_TIMEOUT_MS = 1_000;
const RECENT_TURN_LIMIT = 32;
const FINAL_INTERRUPT_TIMEOUT_MS = 5_000;
const PROGRESS_THROTTLE_MS = 5_000;
const TOOL_ITEM_TYPES = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "collabAgentToolCall",
  "webSearch",
]);

const options = parseArguments(
  process.argv[2] === "__codex-warm-driver"
    ? process.argv.slice(3)
    : process.argv.slice(2),
);
const socketPath = join(options.socketDirectory, "app-server.sock");
const approvalPolicy = new CodexUnattendedApprovalPolicy();
const pending = new Map();
const turns = new Map();
let requestSequence = 0;
let frameSequence = 0;
let threadId;
let active;
let starting;
let usageTracker;
let connection;
let shuttingDown = false;
// The long connection does not guarantee Codex keeps the thread loaded; a
// `thread/closed` (or an unloaded-thread rejection) resumes the same id
// before the next turn. Never a new thread.
let threadLoaded = false;
let threadResumeParams;

const codex = spawn(
  options.executable,
  [
    ...providerLaunchArguments("codex"),
    ...options.codexConfigArgs,
    ...providerLaunchPolicy("codex").args,
    "--listen",
    `unix://${socketPath}`,
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
codex.stdout.pipe(process.stderr);
codex.stderr.pipe(process.stderr);
const codexExited = new Promise((resolve) => {
  codex.once("close", (code, signal) => resolve({ code, signal }));
});
codex.once("error", (error) =>
  fatal(`codex app-server failed: ${error.message}`),
);
void codexExited.then(({ code, signal }) => {
  if (!shuttingDown)
    fatal(
      `codex app-server exited (code=${String(code)}, signal=${String(signal)})`,
    );
});

createInterface({ input: process.stdin }).on("line", (line) => {
  let command;
  try {
    command = JSON.parse(line);
  } catch {
    return;
  }
  void handleCommand(command).catch((error) => {
    process.stderr.write(`[loom codex-warm] ${errorMessage(error)}\n`);
  });
});
process.stdin.once("end", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));
process.once("SIGINT", () => void shutdown(0));

try {
  await waitForSocket();
  connection = await connectUnixWebSocket(socketPath, {
    timeoutMs: HANDSHAKE_TIMEOUT_MS,
  });
  connection.onMessage = (text) => {
    let frame;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    handleFrame(frame);
  };
  connection.onClose = (error) => {
    failPending(new Error("codex app-server connection closed"));
    if (!shuttingDown)
      fatal(
        `codex app-server connection closed${error ? `: ${error.message}` : ""}`,
      );
  };
  const initialized = await request(
    "initialize",
    {
      capabilities: { experimentalApi: true },
      clientInfo: {
        name: "loom-codex-warm",
        title: "Loom",
        version: "1.0.0",
      },
    },
    HANDSHAKE_TIMEOUT_MS,
  );
  if (typeof initialized?.userAgent !== "string")
    throw new Error("initialize returned no userAgent");
  notify("initialized", {});
  const threadStart = {
    config: { ...memoryConfig("codex") },
    approvalPolicy: "never",
    cwd: process.cwd(),
    developerInstructions: options.prompt,
    experimentalRawEvents: true,
    ...codexWorkspaceRoots(process.cwd(), options.additionalDirectories),
    sandbox: "danger-full-access",
  };
  if (options.model !== undefined) threadStart.model = options.model;
  if (options.reasoning !== undefined)
    threadStart.config.model_reasoning_effort = options.reasoning;
  let resumed = false;
  let sessionResumeMs = null;
  let resumeRecovery;
  let started;
  if (options.resumeSession === undefined) {
    started = await request("thread/start", threadStart, HANDSHAKE_TIMEOUT_MS);
  } else {
    const resumeStarted = Date.now();
    try {
      started = await request(
        "thread/resume",
        // Metadata only: only thread.id is read, and full turn hydration of
        // a never-rotated session outgrows the 16 MiB frame limit.
        { threadId: options.resumeSession, ...threadStart, excludeTurns: true },
        HANDSHAKE_TIMEOUT_MS,
      );
      resumed = true;
      sessionResumeMs = Date.now() - resumeStarted;
    } catch (error) {
      resumeRecovery = classifyResumeError(errorMessage(error));
      if (resumeRecovery === undefined) throw error;
      assertSessionReplacementAllowed();
      started = await request(
        "thread/start",
        threadStart,
        HANDSHAKE_TIMEOUT_MS,
      );
    }
  }
  threadId = started?.thread?.id;
  if (typeof threadId !== "string" || threadId === "")
    throw new Error("Codex thread request returned no thread.id");
  threadLoaded = true;
  threadResumeParams = { ...threadStart, excludeTurns: true };
  usageTracker = new CodexTokenUsageTracker({ freshThread: !resumed });
  emit("ready", {
    resumed,
    sessionResumeMs,
    threadId,
    ...(resumeRecovery === undefined ? {} : { resumeRecovery }),
  });
} catch (error) {
  fatal(errorMessage(error));
}

async function handleCommand(command) {
  if (command?.op === "shutdown") return await shutdown(0);
  if (command?.op === "turn.begin") return await beginTurn(command);
  if (command?.op === "turn.notice") return steerTurn(command);
  if (command?.op === "turn.interrupt") return interruptTurn(command);
  if (command?.op === "turn.final") return finalTurn(command);
}

async function beginTurn(command) {
  const runAttemptId = command.runAttemptId;
  if (typeof runAttemptId !== "string" || typeof command.text !== "string")
    return;
  if (
    threadId === undefined ||
    active !== undefined ||
    starting !== undefined
  ) {
    emit("turn.failed", {
      error: "warm runtime is not idle",
      rejected: true,
      runAttemptId,
    });
    return;
  }
  starting = { buffered: [], runAttemptId };
  const params = {
    clientUserMessageId: runAttemptId,
    input: [{ text: command.text, type: "text" }],
    threadId,
  };
  if (typeof command.model === "string") params.model = command.model;
  if (typeof command.effort === "string") params.effort = command.effort;
  let result;
  try {
    if (!threadLoaded) await reloadThread();
    try {
      result = await request("turn/start", params, HANDSHAKE_TIMEOUT_MS);
    } catch (error) {
      if (
        error?.providerRejected !== true ||
        !/\bthread\b.*\b(not loaded|unloaded|closed|not found)\b/iu.test(
          errorMessage(error),
        )
      )
        throw error;
      // Rejected because the thread was unloaded: nothing started. Resume
      // the same thread id once and retry this turn.
      await reloadThread();
      result = await request("turn/start", params, HANDSHAKE_TIMEOUT_MS);
    }
  } catch (error) {
    starting = undefined;
    // A provider rejection proves no turn exists; a timeout is ambiguous and
    // the Host must not assume the input was not accepted.
    emit("turn.failed", {
      error: errorMessage(error),
      rejected: error?.providerRejected === true,
      runAttemptId,
    });
    return;
  }
  const nativeTurnId = result?.turn?.id;
  const buffered = starting.buffered;
  starting = undefined;
  if (typeof nativeTurnId !== "string" || nativeTurnId === "") {
    emit("turn.failed", {
      error: "turn/start returned no turn.id",
      rejected: false,
      runAttemptId,
    });
    return;
  }
  const turn = createTurn(runAttemptId, nativeTurnId);
  if (typeof command.restate === "string") turn.restate = command.restate;
  active = turn;
  emit("turn.accepted", { nativeTurnId, runAttemptId });
  emitTurnFrame(turn, {
    inputSha256: createHash("sha256")
      .update(command.text, "utf8")
      .digest("hex"),
    protocol: "rah-delivery-accepted/v1",
    provider: "codex-app-server/v1",
    signal: "turn/start.response",
    threadId,
    turnId: nativeTurnId,
  });
  for (const frame of buffered) handleNotification(frame);
}

function createTurn(runAttemptId, nativeTurnId) {
  const turn = {
    closed: false,
    closing: false,
    lastFrameSeq: 0,
    nativeTurnId,
    runAttemptId,
    stopRequested: false,
    tools: new Set(),
  };
  const writeFrame = (line) => {
    for (const part of String(line).split("\n")) {
      if (part.trim() === "") continue;
      try {
        emitTurnFrame(turn, JSON.parse(part));
      } catch {
        // Writers only produce JSON lines.
      }
    }
  };
  turn.writer = new RuntimeTrajectoryWriter(writeFrame);
  turn.usageWriter = new ProviderUsageWriter(writeFrame);
  turn.noticeInput = new PassThrough();
  // Final-reply turn end: this native turn only, never "the current turn".
  turn.finalInterrupt = createCodexFinalInterrupt({
    interrupt: () =>
      request(
        "turn/interrupt",
        { threadId, turnId: nativeTurnId },
        FINAL_INTERRUPT_TIMEOUT_MS,
      ),
  });
  turn.busyInput = attachCodexBusyInput({
    input: turn.noticeInput,
    receipt: (frame) => emitTurnFrame(turn, frame),
    request,
    state: () => ({
      stopping:
        turn.closing ||
        turn.stopRequested ||
        turn.finalInterrupt.armed ||
        shuttingDown,
      threadId,
      turnId: turn.nativeTurnId,
    }),
  });
  turns.set(nativeTurnId, turn);
  while (turns.size > RECENT_TURN_LIMIT) {
    const oldest = turns.keys().next().value;
    if (turns.get(oldest) === active) break;
    turns.delete(oldest);
  }
  return turn;
}

async function reloadThread() {
  const resumed = await request(
    "thread/resume",
    { threadId, ...threadResumeParams },
    HANDSHAKE_TIMEOUT_MS,
  );
  if (resumed?.thread?.id !== threadId)
    throw new Error("thread/resume returned a different thread id");
  threadLoaded = true;
}

function steerTurn(command) {
  const turn = active;
  if (
    turn === undefined ||
    turn.runAttemptId !== command.runAttemptId ||
    turn.closing ||
    typeof command.line !== "string"
  ) {
    // Refuse visibly so the Host transport never waits on a silent drop.
    let id;
    try {
      id = JSON.parse(command.line).id;
    } catch {
      return;
    }
    if (typeof id !== "string") return;
    const owner = [...turns.values()].find(
      (candidate) => candidate.runAttemptId === command.runAttemptId,
    );
    const receipt = {
      accepted: false,
      id,
      protocol: "rah-runtime-notice-result/v1",
    };
    if (owner !== undefined) emitTurnFrame(owner, receipt);
    return;
  }
  turn.noticeInput.write(`${command.line.replace(/\n+$/u, "")}\n`);
}

// S2 spec §3: a native compaction may drop the handle from the model's
// context. Restate it inside the same native turn (never via any command a
// tool could call); a rejected steer only means the turn already moved on.
function restateAfterCompaction(turn) {
  void request(
    "turn/steer",
    {
      expectedTurnId: turn.nativeTurnId,
      input: [{ text: turn.restate, type: "text" }],
      threadId,
    },
    1_000,
  ).catch((error) =>
    process.stderr.write(
      `[loom codex-warm] handle restatement after compaction failed: ${errorMessage(error)}\n`,
    ),
  );
}

function interruptTurn(command) {
  const turn = active;
  if (turn === undefined || turn.runAttemptId !== command.runAttemptId) return;
  turn.stopRequested = true;
  turn.busyInput.close();
  void request(
    "turn/interrupt",
    { threadId, turnId: turn.nativeTurnId },
    0,
  ).catch(() => undefined);
}

// The Host read a committed `final` post of this RunAttempt. Only the named
// native turn, and only while it is the active, unclosed turn, is ended.
function finalTurn(command) {
  const turn = active;
  if (
    turn === undefined ||
    turn.runAttemptId !== command.runAttemptId ||
    turn.nativeTurnId !== command.nativeTurnId ||
    turn.closing ||
    turn.stopRequested
  )
    return;
  turn.finalInterrupt.arm();
}

function handleFrame(frame) {
  if (typeof frame !== "object" || frame === null) return;
  if (Object.hasOwn(frame, "id") && Object.hasOwn(frame, "method")) {
    handleServerRequest(frame);
    return;
  }
  if (Object.hasOwn(frame, "id")) {
    const state = pending.get(String(frame.id));
    if (state === undefined) return;
    pending.delete(String(frame.id));
    clearTimeout(state.timer);
    if (frame.error && typeof frame.error === "object") {
      state.reject(
        Object.assign(
          new Error(
            `${state.method}: ${String(frame.error.message ?? "app-server error")} (code=${String(frame.error.code ?? "unknown")})`,
          ),
          { providerRejected: true },
        ),
      );
    } else state.resolve(frame.result);
    return;
  }
  handleNotification(frame);
}

function handleNotification(frame) {
  const params =
    frame.params && typeof frame.params === "object" ? frame.params : {};
  const frameThreadId =
    typeof params.threadId === "string" ? params.threadId : undefined;
  const turnId =
    typeof params.turnId === "string"
      ? params.turnId
      : typeof params.turn?.id === "string"
        ? params.turn.id
        : undefined;
  if (frameThreadId !== undefined && frameThreadId !== threadId) {
    unattributed(frame, turnId, "foreign_thread");
    return;
  }
  if (frame.method === "thread/closed" && active === undefined) {
    threadLoaded = false;
    return;
  }
  const turn = turnId === undefined ? undefined : turns.get(turnId);
  if (turn === undefined) {
    // Until turn/start answers, its own early notifications have no known id.
    if (starting !== undefined && turnId !== undefined) {
      starting.buffered.push(frame);
      return;
    }
    unattributed(
      frame,
      turnId,
      turnId === undefined ? "no_turn_id" : "unknown_turn",
    );
    return;
  }
  turn.busyInput.observe(frame);
  turn.finalInterrupt.observe(frame);
  const item = params.item;
  if (item && typeof item === "object" && TOOL_ITEM_TYPES.has(item.type)) {
    const itemId = typeof item.id === "string" ? item.id : JSON.stringify(item);
    if (frame.method === "item/started") turn.tools.add(itemId);
    if (frame.method === "item/completed") turn.tools.delete(itemId);
  }
  const framesBefore = turn.lastFrameSeq;
  turn.writer.emit(normalizeCodexTrajectoryNotification(frame));
  turn.usageWriter.emit(usageTracker?.observe(frame));
  if (item && typeof item === "object" && TOOL_ITEM_TYPES.has(item.type))
    reportProgress(turn, true);
  else if (
    turn.lastFrameSeq === framesBefore &&
    typeof frame.method === "string" &&
    frame.method.startsWith("item/")
  )
    reportProgress(turn, false);
  if (
    frame.method === "item/completed" &&
    item?.type === "contextCompaction" &&
    turn === active &&
    !turn.closing &&
    typeof turn.restate === "string"
  )
    restateAfterCompaction(turn);
  if (frame.method === "turn/completed" && !turn.closing)
    void closeTurn(turn, params);
}

async function closeTurn(turn, params) {
  turn.closing = true;
  turn.busyInput.close();
  // S2 spec §2 step 2: a steer sent before closing belongs to this turn only
  // if Codex accepted it; wait for that answer so its receipt is a frame of
  // this turn (accepted: covered by the proof; refused: stays in the Inbox).
  await turn.busyInput.settled();
  turn.writer.flush();
  const status =
    typeof params.turn?.status === "string" ? params.turn.status : "failed";
  let endedAfterFinalReply = false;
  if (turn.finalInterrupt.armed) {
    const report = await turn.finalInterrupt.report();
    endedAfterFinalReply =
      !turn.stopRequested &&
      turn.finalInterrupt.issued &&
      status === "interrupted";
    emitTurnFrame(turn, { protocol: "rah-final-interrupt/v1", ...report });
  }
  const errorText =
    typeof params.turn?.error?.message === "string"
      ? params.turn.error.message.slice(0, 2048)
      : undefined;
  emit("turn.drained", {
    inFlightToolCount: turn.tools.size,
    lastFrameSeq: turn.lastFrameSeq,
    nativeTurnId: turn.nativeTurnId,
    runAttemptId: turn.runAttemptId,
    status,
    stopRequested: turn.stopRequested,
    ...(errorText === undefined ? {} : { errorMessage: errorText }),
    ...(endedAfterFinalReply ? { endedAfterFinalReply: true } : {}),
  });
  turn.closed = true;
  if (active === turn) active = undefined;
}

function handleServerRequest(frame) {
  try {
    const decision = approvalPolicy.decide(
      frame,
      { threadId, turnId: active?.nativeTurnId },
      active?.stopRequested === true || shuttingDown,
    );
    if (decision.duplicate) return;
    send({ id: frame.id, jsonrpc: "2.0", result: decision.result });
  } catch (error) {
    const rpcError =
      error instanceof CodexApprovalPolicyError
        ? error
        : { code: -32602, message: errorMessage(error) };
    send({
      error: { code: rpcError.code, message: rpcError.message },
      id: frame.id,
      jsonrpc: "2.0",
    });
  }
}

function unattributed(frame, turnId, reason) {
  emit("unattributed", {
    method: typeof frame.method === "string" ? frame.method.slice(0, 200) : "",
    reason,
    ...(turnId === undefined ? {} : { nativeTurnId: turnId }),
  });
}

function reportProgress(turn, force) {
  const now = Date.now();
  if (!force && now - (turn.progressAt ?? 0) < PROGRESS_THROTTLE_MS) return;
  turn.progressAt = now;
  emit("progress", {
    awaitingApproval: false,
    nativeTurnId: turn.nativeTurnId,
    runAttemptId: turn.runAttemptId,
    toolsInFlight: turn.tools.size,
  });
}

function emitTurnFrame(turn, frame) {
  turn.lastFrameSeq = emit("frame", {
    frame,
    nativeTurnId: turn.nativeTurnId,
    runAttemptId: turn.runAttemptId,
  });
}

function emit(type, fields) {
  frameSequence += 1;
  try {
    writeSync(
      3,
      `${JSON.stringify({
        loom: "warm-runtime/v1",
        seq: frameSequence,
        runtimeId: options.runtimeId,
        hostGeneration: options.hostGeneration,
        type,
        ...fields,
      })}\n`,
    );
  } catch {
    // The Host is gone; stdin EOF shuts the runtime down.
  }
  return frameSequence;
}

function request(method, params, timeoutMs) {
  requestSequence += 1;
  const id = requestSequence;
  return new Promise((resolve, reject) => {
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            pending.delete(String(id));
            reject(new Error(`${method} timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        : undefined;
    pending.set(String(id), { method, reject, resolve, timer });
    try {
      send({ id, jsonrpc: "2.0", method, params });
    } catch (error) {
      pending.delete(String(id));
      clearTimeout(timer);
      reject(error);
    }
  });
}

function notify(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

function send(frame) {
  if (connection === undefined || !connection.open)
    throw new Error("codex app-server connection is closed");
  connection.send(JSON.stringify(frame));
}

function failPending(error) {
  for (const state of pending.values()) {
    clearTimeout(state.timer);
    state.reject(error);
  }
  pending.clear();
}

async function waitForSocket() {
  const deadline = Date.now() + SOCKET_WAIT_MS;
  while (!existsSync(socketPath)) {
    if (codex.exitCode !== null || codex.signalCode !== null)
      throw new Error("codex app-server exited before listening");
    if (Date.now() > deadline)
      throw new Error("codex app-server did not open its socket");
    await delay(20);
  }
}

function fatal(message) {
  if (shuttingDown) return;
  emit("fatal", { error: String(message).slice(0, 2048) });
  process.stderr.write(`[loom codex-warm] ${message}\n`);
  void shutdown(1);
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  const turn = active;
  if (turn !== undefined && connection?.open) {
    void request(
      "turn/interrupt",
      { threadId, turnId: turn.nativeTurnId },
      0,
    ).catch(() => undefined);
    await delay(200);
  }
  try {
    connection?.close();
  } catch {
    // Already closed.
  }
  if (codex.exitCode === null && codex.signalCode === null) {
    codex.kill("SIGTERM");
    const exited = await Promise.race([
      codexExited.then(() => true),
      delay(PROVIDER_TERM_TIMEOUT_MS).then(() => false),
    ]);
    if (!exited && codex.exitCode === null && codex.signalCode === null) {
      codex.kill("SIGKILL");
      await Promise.race([codexExited, delay(PROVIDER_TERM_TIMEOUT_MS)]);
    }
  }
  process.exit(exitCode);
}

function classifyResumeError(message) {
  if (
    /\bno\s+rollout\s+found\b/iu.test(message) ||
    /\bmissing\s+rollout\b/iu.test(message) ||
    /\brollout\b.*\b(not found|missing)\b/iu.test(message) ||
    /\bthread\b.*\b(not found|missing)\b/iu.test(message) ||
    /\bmissing\s+thread\b/iu.test(message)
  )
    return "missing_rollout";
  if (/\balready\s+has\s+an\s+active\s+writer\b/iu.test(message))
    return "thread_writer_busy";
  return undefined;
}

function parseArguments(args) {
  const parsed = { additionalDirectories: [], codexConfigArgs: [] };
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    const value = args[index + 1];
    if (value === undefined) throw new Error(`missing value for ${name}`);
    if (name === "--executable") parsed.executable = value;
    else if (name === "--tool-access-mode") parsed.toolAccessMode = value;
    else if (name === "--prompt") parsed.prompt = value;
    else if (name === "--prompt-file")
      parsed.prompt = readProviderPromptFile(value);
    else if (name === "--model") parsed.model = value;
    else if (name === "--reasoning") parsed.reasoning = value;
    else if (name === "--resume-session") parsed.resumeSession = value;
    else if (name === "--runtime-id") parsed.runtimeId = value;
    else if (name === "--host-generation") parsed.hostGeneration = value;
    else if (name === "--socket-dir") parsed.socketDirectory = value;
    else if (name === "-c") parsed.codexConfigArgs.push(name, value);
    else if (name === "--additional-dir")
      parsed.additionalDirectories.push(parseAttachedDirectory(value));
    else throw new Error(`unsupported codex warm driver option: ${name}`);
    index += 1;
  }
  for (const required of [
    "executable",
    "prompt",
    "runtimeId",
    "hostGeneration",
    "socketDirectory",
  ])
    if (typeof parsed[required] !== "string" || parsed[required] === "")
      throw new Error(`--${required} is required`);
  if (parsed.toolAccessMode !== "full_access")
    throw new Error("--tool-access-mode must be full_access");
  return parsed;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
