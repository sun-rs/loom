import { claudeConnectionEnvironment } from "./claude-connection-environment.js";
// S2-c1 warm Claude driver (S2 spec §2/§4, contract §6a): one long-lived
// `claude -p --input-format stream-json --output-format stream-json
// --replay-user-messages` per Role instance, `--resume <id>` or, for a fresh
// session, `--session-id <uuid>` chosen here. The driver is the process-group
// leader and speaks the same Host protocol as the warm Codex driver:
//
//   Host -> driver (stdin, one JSON object per line)
//     {op:"turn.begin", runAttemptId, runtimeRunId, text, model?, effort?}
//     {op:"turn.notice", runAttemptId, line}   busy Human input
//     {op:"turn.interrupt", runAttemptId}
//     {op:"turn.final", runAttemptId, nativeTurnId}
//     {op:"shutdown"}                          (stdin EOF means the same)
//   driver -> Host (fd3)
//     {loom:"warm-runtime/v1", seq, runtimeId, hostGeneration, type, ...}
//     type ready | turn.accepted | turn.failed | frame | progress |
//          turn.drained | unattributed | fatal
//
// Correlation (verified on the installed Claude Code 2.1.282 without a model
// call): every stdin `user` message carries a uuid chosen here; the CLI
// reports `command_lifecycle` queued/started/completed|cancelled|discarded|
// refused per uuid (capability `msg_lifecycle_v1`), echoes the message as a
// replay carrying the same uuid, and ends each native turn with exactly one
// `result` whose `user_message_uuid` names the input it ran. A message written
// while a turn runs is folded into it at the next tool boundary (its replay,
// `started`, and `completed`/`cancelled` all BEFORE that turn's result), and
// the one result lists every input it ran in `user_message_uuids` (full
// review batch 3 P1-5, real 2.1.282 against a local fake Messages API). One
// written with no tool boundary left stays queued for its own turn. The
// interrupt receipt lists `still_queued` (and, with `cancel_queued:true`,
// `cancelled`) uuids.
//
// One Activation is one Host turn whose native work is the wake input plus
// the busy inputs admitted before admission closed. It is admitted when the
// CLI starts the wake (`started`, or its exact replay). Admission for busy
// input closes at the first result (or an interrupt / final arm), atomically
// in this single-threaded handler. The turn is drained only when EVERY input
// it wrote is settled, so no queued input of this Activation can run in the
// next one. An input that started (lifecycle `started` or its replay) settles
// only through a `result` that names it — a terminal lifecycle that outruns
// the result does not end it (seventh review P2-1), and a folded input
// settles through the result of the turn it joined. An input that never started
// settles through a terminal lifecycle or a `cancelled` receipt entry; one the
// CLI cancelled, discarded or refused without this driver asking is an error.
// With `msg_lifecycle_v1` a `result` without `user_message_uuid` is never
// guessed onto an input. After a Host interrupt or a final-reply arm, any of
// its inputs that still starts is interrupted again. Without
// `msg_lifecycle_v1` no busy input is written and the wake's own result is
// the boundary.
//
// Turn status: a Host stop is `interrupted`; otherwise any independent error
// (another input's failure, an unrequested cancel) makes it `failed` with the
// text kept for the Host, even after the final reply ended the wake. Only an
// abort this driver's own interrupt caused is exempt (seventh review P1-3).
//
// Frames are attributed to the open turn only between its acceptance and its
// drain (the CLI runs one native turn at a time and, by the rule above, only
// this Activation's inputs in that window). Anything else is `unattributed`;
// an unprompted native turn while idle (for example a background task
// notification) is interrupted at once.
//
// Not done here (unverified in-turn injection): the per-turn handle is not
// restated after a native compaction; a turn that lost it cannot post, stays
// unacknowledged and is retried with a new handle (S2 spec §3).
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import {
  createClaudeFinalInterrupt,
  isAbortedClaudeResult,
} from "./claude-final-interrupt.js";
import {
  CLAUDE_DISALLOWED_TOOLS,
  claudeResultError as resultError,
  claudeResultInputUuids,
  isMissingClaudeSessionError,
  settleClaudeControlResponse,
  withoutNestedClaudeCode,
} from "./claude-stream-launch.js";
import { assertSessionReplacementAllowed } from "./provider-activation-input.js";
import {
  providerLaunchArguments,
  providerLaunchPolicy,
} from "./provider-launch-arguments.js";
import { readProviderPromptFile } from "./provider-prompt-file.js";
import {
  claudeAttachedDirectoryArgs,
  parseAttachedDirectory,
} from "./channel-attached-directories.js";
import {
  normalizeClaudeTrajectoryEvent,
  RuntimeTrajectoryWriter,
  runtimeStatusTrajectory,
} from "./provider-trajectory-normalizer.js";
import {
  ClaudeResultCostTracker,
  ClaudeStreamUsageTracker,
  ProviderUsageWriter,
} from "./provider-usage.js";

const PROVIDER = "claude-stream-json/v1";
const CONTROL_TIMEOUT_MS = 5_000;
const PROVIDER_TERM_TIMEOUT_MS = 1_000;
const PROGRESS_THROTTLE_MS = 5_000;
const MAX_FRAME_BYTES = 1024 * 1024;
const RECENT_INPUT_LIMIT = 256;
const TERMINAL_LIFECYCLE = new Set([
  "completed",
  "cancelled",
  "discarded",
  "refused",
]);

const options = parseArguments(
  process.argv[2] === "__claude-warm-driver"
    ? process.argv.slice(3)
    : process.argv.slice(2),
);
const promptDirectory = mkdtempSync(join(tmpdir(), "loom-claude-warm-"));
chmodSync(promptDirectory, 0o700);
const promptPath = join(promptDirectory, "room-worker.md");
writeFileSync(promptPath, options.prompt, { mode: 0o600 });

const resumed = options.resumeSession !== undefined;
const sessionId = options.resumeSession ?? randomUUID();
const usageTracker = new ClaudeStreamUsageTracker();
// evo §40: the process's cumulative cost starts at 0 only for a fresh session.
const costTracker = new ClaudeResultCostTracker({ freshSession: !resumed });
const controlRequests = new Map();
/** Inputs of closed turns: their late lifecycle frames are expected noise. */
const recentInputs = new Set();
let frameSequence = 0;
let active;
let autonomous;
let shuttingDown = false;

const args = [
  ...providerLaunchArguments("claude"),
  ...providerLaunchPolicy("claude").args,
  "--disallowed-tools",
  CLAUDE_DISALLOWED_TOOLS,
  "--append-system-prompt-file",
  promptPath,
  ...(options.model === undefined ? [] : ["--model", options.model]),
  ...(options.effort === undefined ? [] : ["--effort", options.effort]),
  ...(resumed ? ["--resume", sessionId] : ["--session-id", sessionId]),
  ...claudeAttachedDirectoryArgs(options.additionalDirectories),
  ...options.providerArgs,
];
const claude = spawn(options.executable, args, {
  cwd: process.cwd(),
  env: {
    ...claudeConnectionEnvironment(withoutNestedClaudeCode(process.env)),
    ...providerLaunchPolicy("claude").environment,
  },
  shell: false,
  stdio: ["pipe", "pipe", "pipe"],
});
claude.stderr.pipe(process.stderr);
claude.stdin.on("error", () => undefined);
const claudeExited = new Promise((resolve) => {
  claude.once("close", (code, signal) => resolve({ code, signal }));
});
claude.once("error", (error) => fatal(`claude failed: ${error.message}`));
void claudeExited.then(({ code, signal }) => {
  if (!shuttingDown)
    fatal(`claude exited (code=${String(code)}, signal=${String(signal)})`);
});
createInterface({ input: claude.stdout }).on("line", handleLine);

createInterface({ input: process.stdin }).on("line", (line) => {
  let command;
  try {
    command = JSON.parse(line);
  } catch {
    return;
  }
  try {
    handleCommand(command);
  } catch (error) {
    process.stderr.write(`[loom claude-warm] ${errorMessage(error)}\n`);
  }
});
process.stdin.once("end", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));
process.once("SIGINT", () => void shutdown(0));

// The session id is known before any input (chosen here or resumed); Claude
// writes a fresh session when it takes the first input, so the Host binds it
// after this runtime's first accepted turn (adapter `bindSession: accepted`).
emit("ready", { resumed, sessionResumeMs: null, threadId: sessionId });

function handleCommand(command) {
  if (command?.op === "shutdown") return void shutdown(0);
  if (command?.op === "turn.begin") return beginTurn(command);
  if (command?.op === "turn.notice") return noticeTurn(command);
  if (command?.op === "turn.interrupt") return interruptTurn(command);
  if (command?.op === "turn.final") return finalTurn(command);
}

function beginTurn(command) {
  const runAttemptId = command.runAttemptId;
  if (typeof runAttemptId !== "string" || typeof command.text !== "string")
    return;
  const refuse = (error) =>
    emit("turn.failed", { error, rejected: true, runAttemptId });
  if (active !== undefined || shuttingDown)
    return refuse("warm runtime is not idle");
  if (autonomous !== undefined)
    return refuse("warm runtime is ending an unattributed native turn");
  // Model and effort are launch arguments for Claude: a different frozen
  // choice needs a new process (the Host restarts it at an idle boundary).
  if (
    (command.model !== undefined && command.model !== options.model) ||
    (command.effort !== undefined && command.effort !== options.effort)
  )
    return refuse("the turn's model or effort differs from this process");
  const turn = createTurn(runAttemptId, command.text);
  active = turn;
  if (!writeInput(turn, turn.wakeUuid, command.text, "wake")) {
    active = undefined;
    emit("turn.failed", {
      error: "claude stdin is closed",
      rejected: true,
      runAttemptId,
    });
  }
}

function createTurn(runAttemptId, text) {
  const turn = {
    accepted: false,
    admissionOpen: true,
    closing: false,
    deliveryReported: false,
    errors: [],
    finalEnded: false,
    inputs: new Map(),
    lastFrameSeq: 0,
    lifecycle: undefined,
    noticeInFlight: false,
    noticeFingerprints: new Set(),
    order: [],
    runAttemptId,
    stopRequested: false,
    text,
    tools: new Set(),
    wakeUuid: randomUUID(),
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
  turn.finalInterrupt = createClaudeFinalInterrupt({
    interrupt: () => interruptRequest(turn),
  });
  return turn;
}

function writeInput(turn, uuid, text, kind, done) {
  if (!claude.stdin.writable) return false;
  turn.inputs.set(uuid, {
    cancelRequested: false,
    interruptAcknowledged: false,
    interruptRequested: false,
    kind,
    settled: false,
    started: false,
  });
  turn.order.push(uuid);
  claude.stdin.write(
    `${JSON.stringify({
      type: "user",
      uuid,
      session_id: sessionId,
      message: { role: "user", content: [{ type: "text", text }] },
    })}\n`,
    done,
  );
  return true;
}

// Busy Human input (a `rah-runtime-notice/v1` line). The receipt answers the
// stdin write only (written, awaiting the CLI's own lifecycle/replay); it is
// not proof the CLI took the input, and the Kernel keeps delivery/ACK
// ownership.
function noticeTurn(command) {
  let notice;
  try {
    notice = JSON.parse(command.line);
  } catch {
    return;
  }
  if (typeof notice?.id !== "string" || notice.id.length > 64) return;
  const turn = active;
  const owner = turn?.runAttemptId === command.runAttemptId ? turn : undefined;
  const receipt = (accepted) => {
    const frame = {
      accepted,
      id: notice.id,
      protocol: "rah-runtime-notice-result/v1",
    };
    if (owner !== undefined) emitTurnFrame(owner, frame);
  };
  if (
    owner === undefined ||
    !owner.accepted ||
    !owner.admissionOpen ||
    owner.closing ||
    owner.stopRequested ||
    owner.finalInterrupt.armed ||
    owner.lifecycle !== true ||
    owner.noticeInFlight ||
    notice.protocol !== "rah-runtime-notice/v1" ||
    typeof notice.text !== "string" ||
    notice.text === "" ||
    typeof notice.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/u.test(notice.fingerprint) ||
    Buffer.byteLength(notice.text) > 5_000
  )
    return receipt(false);
  if (owner.noticeFingerprints.has(notice.fingerprint)) return receipt(true);
  owner.noticeInFlight = true;
  const written = writeInput(
    owner,
    randomUUID(),
    notice.text,
    "notice",
    (error) => {
      owner.noticeInFlight = false;
      if (!error) owner.noticeFingerprints.add(notice.fingerprint);
      receipt(!error);
    },
  );
  if (!written) {
    owner.noticeInFlight = false;
    receipt(false);
  }
}

function interruptTurn(command) {
  const turn = active;
  if (turn === undefined || turn.runAttemptId !== command.runAttemptId) return;
  turn.stopRequested = true;
  turn.admissionOpen = false;
  void interruptRequest(turn).catch(() => undefined);
}

function finalTurn(command) {
  const turn = active;
  if (
    turn === undefined ||
    turn.runAttemptId !== command.runAttemptId ||
    turn.wakeUuid !== command.nativeTurnId ||
    turn.closing ||
    turn.stopRequested
  )
    return;
  // Arming closes busy admission: later input waits for the next Activation.
  turn.admissionOpen = false;
  turn.finalInterrupt.arm();
}

/**
 * The native interrupt of the running native turn, cancelling this turn's
 * queued inputs. Receipt uuids listed as cancelled are settled; survivors
 * stay open and are interrupted again when they start.
 */
async function interruptRequest(turn) {
  // The inputs running now: an abort result of theirs is this interrupt's.
  const running = [];
  for (const [uuid, input] of turn.inputs)
    if (
      !input.settled &&
      (input.started ||
        input.replayed ||
        (uuid === turn.wakeUuid && turn.accepted))
    ) {
      input.interruptRequested = true;
      running.push(input);
    }
  const response = await controlRequest(
    { subtype: "interrupt", cancel_queued: true },
    CONTROL_TIMEOUT_MS,
  );
  for (const input of running) input.interruptAcknowledged = true;
  for (const uuid of Array.isArray(response?.cancelled)
    ? response.cancelled
    : []) {
    const input = turn.inputs.get(uuid);
    // A receipt cancels queued inputs; a started one still owes its result.
    if (input === undefined || input.started || input.replayed) continue;
    input.cancelRequested = true;
    settleInput(turn, uuid);
  }
  maybeClose(turn);
  return response;
}

function controlRequest(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const requestId = `loom-${randomUUID()}`;
    const timer = setTimeout(() => {
      controlRequests.delete(requestId);
      reject(new Error(`control_request ${request.subtype} timed out`));
    }, timeoutMs);
    controlRequests.set(requestId, { reject, resolve, timer });
    if (!claude.stdin.writable) {
      clearTimeout(timer);
      controlRequests.delete(requestId);
      reject(new Error("claude stdin is closed"));
      return;
    }
    claude.stdin.write(
      `${JSON.stringify({ type: "control_request", request_id: requestId, request })}\n`,
    );
  });
}

function handleLine(line) {
  if (Buffer.byteLength(line, "utf8") > MAX_FRAME_BYTES) {
    const turn = active;
    if (turn !== undefined) turn.errors.push("oversized Claude frame dropped");
    emit("unattributed", { method: "oversized", reason: "frame_limit" });
    return;
  }
  const trimmed = line.trim();
  if (trimmed === "") return;
  let frame;
  try {
    frame = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (typeof frame !== "object" || frame === null) return;
  if (frame.type === "control_response") return settleControl(frame);
  if (frame.type === "keep_alive") return;
  if (typeof frame.session_id === "string" && frame.session_id !== sessionId) {
    fatal("Claude stream-json changed its session identity");
    return;
  }
  const turn = active;
  if (frame.type === "command_lifecycle") return lifecycle(turn, frame);
  if (turn === undefined || turn.closing) return idleFrame(frame);
  if (!turn.accepted) {
    if (frame.type === "system" && frame.subtype === "init") {
      observeCapabilities(turn, frame);
      turn.initBeforeAcceptance = true;
    }
    if (isExactReplay(turn, frame)) accept(turn);
    else if (frame.type === "result")
      return resultBeforeAcceptance(turn, frame);
    else return idleFrame(frame);
  }
  observe(turn, frame);
}

function lifecycle(turn, frame) {
  const uuid = frame.command_uuid;
  if (turn !== undefined && turn.inputs.has(uuid)) {
    // A closing turn's own lifecycle tail (it settled through its result).
    if (turn.closing) return;
    const input = turn.inputs.get(uuid);
    if (input.settled) return;
    if (frame.state === "started") {
      input.started = true;
      if (uuid === turn.wakeUuid && !turn.accepted) accept(turn);
      // A Host interrupt or an armed final reply ends every input of this
      // turn, however late it runs.
      if (
        (turn.stopRequested || turn.finalInterrupt.armed) &&
        uuid !== turn.wakeUuid
      )
        void interruptRequest(turn).catch(() => undefined);
    }
    if (TERMINAL_LIFECYCLE.has(frame.state)) {
      // A started input (or one that reports completion) settles only
      // through its own result: the lifecycle can outrun it.
      if (input.started || input.replayed || frame.state === "completed")
        return;
      const requested =
        input.cancelRequested ||
        (frame.state !== "refused" &&
          (turn.stopRequested || turn.finalInterrupt.issued));
      if (!requested)
        turn.errors.push(
          `Claude ${String(frame.state)} an admitted ${input.kind} input before it ran`,
        );
      settleInput(turn, uuid);
      maybeClose(turn);
    }
    return;
  }
  if (recentInputs.has(uuid)) return;
  if (frame.state === "started") startAutonomous(`lifecycle ${String(uuid)}`);
  emit("unattributed", {
    method: "command_lifecycle",
    reason: "unknown_input",
  });
}

function accept(turn) {
  if (turn.accepted) return;
  turn.accepted = true;
  emit("turn.accepted", {
    nativeTurnId: turn.wakeUuid,
    runAttemptId: turn.runAttemptId,
  });
}

function isExactReplay(turn, frame) {
  return (
    frame.type === "user" &&
    frame.uuid === turn.wakeUuid &&
    textOf(frame.message) === turn.text
  );
}

function observe(turn, frame) {
  if (frame.type === "system" && frame.subtype === "init")
    observeCapabilities(turn, frame);
  // ACCEPTANCE SIGNAL: the replay echo of THIS wake's uuid with exactly its
  // text; the digest covers the whole Host-composed turn text.
  if (!turn.deliveryReported && isExactReplay(turn, frame)) {
    turn.deliveryReported = true;
    turn.inputs.get(turn.wakeUuid).replayed = true;
    emitTurnFrame(turn, {
      inputSha256: createHash("sha256").update(turn.text, "utf8").digest("hex"),
      protocol: "rah-delivery-accepted/v1",
      provider: PROVIDER,
      signal: "replay-user-message",
      threadId: sessionId,
      turnId: turn.wakeUuid,
    });
  }
  turn.finalInterrupt.observe(frame);
  const toolsBefore = turn.tools.size;
  trackTools(turn, frame);
  const framesBefore = turn.lastFrameSeq;
  if (frame.type === "result") {
    observeResult(turn, frame);
  } else {
    turn.writer.emit(normalizeClaudeTrajectoryEvent(frame));
  }
  turn.usageWriter.emit(usageTracker.observe(frame));
  turn.usageWriter.emit(costTracker.observe(frame));
  if (turn.tools.size !== toolsBefore) reportProgress(turn, true);
  else if (
    turn.lastFrameSeq === framesBefore &&
    (frame.type === "stream_event" || frame.type === "assistant")
  )
    reportProgress(turn, false);
  maybeClose(turn);
}

function observeCapabilities(turn, frame) {
  if (!Array.isArray(frame.capabilities)) {
    turn.lifecycle ??= false;
    return;
  }
  turn.lifecycle = frame.capabilities.includes("msg_lifecycle_v1");
}

function trackTools(turn, frame) {
  const content = Array.isArray(frame.message?.content)
    ? frame.message.content
    : [];
  for (const block of content) {
    if (frame.type === "assistant" && block?.type === "tool_use")
      turn.tools.add(String(block.id));
    if (frame.type === "user" && block?.type === "tool_result")
      turn.tools.delete(String(block.tool_use_id));
  }
}

function observeResult(turn, frame) {
  const named = claudeResultInputUuids(frame);
  // Without the uuid on the result, only an older CLI without lifecycle may
  // fall back to its single wake input (the only one such a turn writes).
  if (named.length === 0 && turn.lifecycle === true) {
    turn.errors.push("a result without user_message_uuid was not attributed");
    emit("unattributed", { method: "result", reason: "missing_input_uuid" });
    return;
  }
  const uuid =
    named[0] ??
    turn.order.find((candidate) => !turn.inputs.get(candidate)?.settled);
  const input = uuid === undefined ? undefined : turn.inputs.get(uuid);
  if (input === undefined) {
    turn.errors.push("a result named an input of no open turn");
    emit("unattributed", { method: "result", reason: "unknown_input" });
    return;
  }
  // Busy admission closes at the first result of the Activation.
  turn.admissionOpen = false;
  // An abort this driver's own interrupt caused while the input ran.
  const ownAbort =
    input.interruptRequested &&
    isAbortedClaudeResult(frame, {
      interruptAcknowledged: input.interruptAcknowledged,
    });
  const finalEnd =
    uuid === turn.wakeUuid && turn.finalInterrupt.endedByInterrupt(frame);
  if (finalEnd) turn.finalEnded = true;
  const failed = frame.subtype !== "success" || frame.is_error === true;
  if (
    uuid === turn.wakeUuid &&
    !finalEnd &&
    !ownAbort &&
    turn.finalInterrupt.awaitsReceipt(frame)
  ) {
    // A reason-less result read before this interrupt's receipt settled:
    // decided within the bounded receipt wait; `closeTurn` awaits it.
    turn.finalDecision = turn.finalInterrupt
      .endedByInterruptAfterReceipt(frame)
      .then((ended) => {
        if (ended) turn.finalEnded = true;
        emitResult(turn, frame, { failed, finalEnd: ended, ownAbort });
      });
  } else emitResult(turn, frame, { failed, finalEnd, ownAbort });
  settleInput(turn, uuid);
  // Batch 3 P1-5: every input folded into this native turn ends with it.
  for (const folded of named.slice(1))
    if (turn.inputs.has(folded)) settleInput(turn, folded);
}

function emitResult(turn, frame, { failed, finalEnd, ownAbort }) {
  if (failed && !finalEnd && !ownAbort) turn.errors.push(resultError(frame));
  const aborted = ownAbort;
  turn.writer.emit(
    finalEnd
      ? runtimeStatusTrajectory(
          "online",
          "stopped",
          "工作轮次已完成",
          "claude:result:final-reply-interrupt",
        )
      : turn.stopRequested && aborted
        ? runtimeStatusTrajectory(
            "offline",
            "stopped",
            "工作轮次结束：interrupted",
            "claude:result:interrupted",
          )
        : normalizeClaudeTrajectoryEvent(frame),
  );
}

function resultBeforeAcceptance(turn, frame) {
  // Batch 3 P2-3 (real 2.1.282): a background-task native turn can run
  // while the wake is still queued — a fresh `system/init`, the assistant
  // frames and a result naming no stdin input, no lifecycle. That result is
  // not the wake's; the wake still starts after it. A result is the wake's
  // failure when it names the wake, or when no native turn started at all
  // (a missing session answers with a bare `num_turns: 0` result).
  const named = claudeResultInputUuids(frame);
  if (
    !named.includes(turn.wakeUuid) &&
    turn.initBeforeAcceptance === true &&
    turn.lifecycle === true
  ) {
    emit("unattributed", { method: "result", reason: "autonomous_turn" });
    return;
  }
  const error = resultError(frame);
  // Nothing of this wake ran. A resumed session that cannot be found is a
  // continuity failure: never replaced silently.
  emit("turn.failed", {
    error,
    rejected: false,
    runAttemptId: turn.runAttemptId,
  });
  active = undefined;
  rememberInputs(turn);
  if (resumed && isMissingClaudeSessionError(error)) {
    try {
      assertSessionReplacementAllowed();
    } catch (continuity) {
      fatal(errorMessage(continuity));
      return;
    }
    fatal(`the resumed Claude session was not found: ${error}`);
  }
}

function settleInput(turn, uuid) {
  const input = turn.inputs.get(uuid);
  if (input !== undefined) input.settled = true;
}

function maybeClose(turn) {
  if (turn !== active || turn.closing || !turn.accepted) return;
  const wake = turn.inputs.get(turn.wakeUuid);
  if (!wake.settled) return;
  turn.admissionOpen = false;
  if (turn.noticeInFlight) return;
  for (const input of turn.inputs.values()) if (!input.settled) return;
  void closeTurn(turn);
}

async function closeTurn(turn) {
  turn.closing = true;
  await turn.finalDecision;
  turn.writer.flush();
  if (turn.finalInterrupt.armed) {
    const report = await turn.finalInterrupt.report();
    emitTurnFrame(turn, { protocol: "rah-final-interrupt/v1", ...report });
  }
  // A Host stop wins; then any independent error; only then the final end.
  const failed = turn.errors.length > 0;
  const status = turn.stopRequested
    ? "interrupted"
    : failed
      ? "failed"
      : turn.finalEnded
        ? "interrupted"
        : "completed";
  emit("turn.drained", {
    inFlightToolCount: turn.tools.size,
    lastFrameSeq: turn.lastFrameSeq,
    nativeTurnId: turn.wakeUuid,
    runAttemptId: turn.runAttemptId,
    status,
    stopRequested: turn.stopRequested,
    ...(failed ? { errorMessage: turn.errors.join("; ").slice(0, 2048) } : {}),
    ...(turn.finalEnded && !turn.stopRequested && !failed
      ? { endedAfterFinalReply: true }
      : {}),
  });
  rememberInputs(turn);
  if (active === turn) active = undefined;
}

function rememberInputs(turn) {
  for (const uuid of turn.inputs.keys()) recentInputs.add(uuid);
  while (recentInputs.size > RECENT_INPUT_LIMIT)
    recentInputs.delete(recentInputs.values().next().value);
}

function idleFrame(frame) {
  if (frame.type === "result") {
    if (autonomous !== undefined) {
      emit("unattributed", { method: "result", reason: "autonomous_turn" });
      autonomous = undefined;
      return;
    }
  } else if (
    active === undefined &&
    (frame.type === "assistant" ||
      frame.type === "stream_event" ||
      (frame.type === "system" && frame.subtype === "init"))
  )
    startAutonomous(String(frame.type));
  emit("unattributed", {
    method: String(frame.type ?? "unknown").slice(0, 200),
    reason: active === undefined ? "no_turn" : "before_acceptance",
  });
}

// A native turn no Activation asked for: end it, never attribute it.
function startAutonomous(reason) {
  if (autonomous !== undefined || active !== undefined) return;
  autonomous = { reason };
  emit("unattributed", { method: reason, reason: "autonomous_turn" });
  void controlRequest(
    { subtype: "interrupt", cancel_queued: true },
    CONTROL_TIMEOUT_MS,
  ).catch(() => undefined);
}

function settleControl(frame) {
  settleClaudeControlResponse(frame, controlRequests);
}

function reportProgress(turn, force) {
  const now = Date.now();
  if (!force && now - (turn.progressAt ?? 0) < PROGRESS_THROTTLE_MS) return;
  turn.progressAt = now;
  emit("progress", {
    awaitingApproval: false,
    nativeTurnId: turn.wakeUuid,
    runAttemptId: turn.runAttemptId,
    toolsInFlight: turn.tools.size,
  });
}

function emitTurnFrame(turn, frame) {
  turn.lastFrameSeq = emit("frame", {
    frame,
    nativeTurnId: turn.wakeUuid,
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

function fatal(message) {
  if (shuttingDown) return;
  emit("fatal", { error: String(message).slice(0, 2048) });
  process.stderr.write(`[loom claude-warm] ${message}\n`);
  void shutdown(1);
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (active !== undefined && claude.stdin.writable) {
    void controlRequest(
      { subtype: "interrupt", cancel_queued: true },
      200,
    ).catch(() => undefined);
    await delay(200);
  }
  try {
    claude.stdin.end();
  } catch {
    // Already closed.
  }
  if (claude.exitCode === null && claude.signalCode === null) {
    const exited = await Promise.race([
      claudeExited.then(() => true),
      delay(PROVIDER_TERM_TIMEOUT_MS).then(() => false),
    ]);
    if (!exited && claude.exitCode === null && claude.signalCode === null) {
      claude.kill("SIGTERM");
      const terminated = await Promise.race([
        claudeExited.then(() => true),
        delay(PROVIDER_TERM_TIMEOUT_MS).then(() => false),
      ]);
      if (
        !terminated &&
        claude.exitCode === null &&
        claude.signalCode === null
      ) {
        claude.kill("SIGKILL");
        await Promise.race([claudeExited, delay(PROVIDER_TERM_TIMEOUT_MS)]);
      }
    }
  }
  rmSync(promptDirectory, { force: true, recursive: true });
  process.exit(exitCode);
}

function textOf(message) {
  return Array.isArray(message?.content)
    ? message.content
        .filter((part) => part?.type === "text")
        .map((part) => part.text)
        .join("")
    : undefined;
}

function parseArguments(argv) {
  const parsed = { additionalDirectories: [], providerArgs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`missing value for ${name}`);
    if (name === "--executable") parsed.executable = value;
    else if (name === "--tool-access-mode") parsed.toolAccessMode = value;
    else if (name === "--prompt") parsed.prompt = value;
    else if (name === "--prompt-file")
      parsed.prompt = readProviderPromptFile(value);
    else if (name === "--model") parsed.model = value;
    else if (name === "--effort" || name === "--reasoning")
      parsed.effort = value;
    else if (name === "--resume-session") parsed.resumeSession = value;
    else if (name === "--runtime-id") parsed.runtimeId = value;
    else if (name === "--host-generation") parsed.hostGeneration = value;
    // The Codex transport's socket directory; Claude speaks over stdio.
    else if (name === "--socket-dir") parsed.socketDirectory = value;
    else if (name === "--mcp-config") parsed.providerArgs.push(name, value);
    else if (name === "--additional-dir")
      parsed.additionalDirectories.push(parseAttachedDirectory(value));
    else throw new Error(`unsupported claude warm driver option: ${name}`);
    index += 1;
  }
  for (const required of [
    "executable",
    "prompt",
    "runtimeId",
    "hostGeneration",
  ])
    if (typeof parsed[required] !== "string" || parsed[required] === "")
      throw new Error(`--${required} is required`);
  if (parsed.toolAccessMode !== "full_access")
    throw new Error("--tool-access-mode must be full_access");
  for (const field of ["resumeSession", "model", "effort"]) {
    const value = parsed[field];
    if (
      value !== undefined &&
      (value.trim() === "" ||
        value.length > 4_096 ||
        /[\u0000-\u001f\u007f]/u.test(value))
    )
      throw new Error(`--${field} is invalid`);
  }
  return parsed;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
