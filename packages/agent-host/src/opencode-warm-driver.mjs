import {
  finalOutputInstructions,
  nativeFinalTextInstructions,
} from "./final-output-instructions.js";
// S2-c3 warm OpenCode driver (S2 spec §2/§4/§11, contract §6a): one
// long-lived `opencode serve` per Role instance with one persistent `/event`
// subscription. The driver is the process-group leader and speaks the same
// Host protocol as the other warm drivers:
//
//   Host -> driver (stdin, one JSON object per line)
//     {op:"turn.begin", runAttemptId, runtimeRunId, text, model?, effort?}
//     {op:"turn.notice", runAttemptId, line}   busy Human input (refused)
//     {op:"turn.interrupt", runAttemptId}
//     {op:"turn.final", runAttemptId, nativeTurnId}
//     {op:"shutdown"}                          (stdin EOF means the same)
//   driver -> Host (fd3)
//     {loom:"warm-runtime/v1", seq, runtimeId, hostGeneration, type, ...}
//     type ready | turn.accepted | turn.failed | frame | progress |
//          turn.drained | unattributed | fatal
//
// Correlation (verified from the installed OpenCode 1.18.32 bundle, no model
// call): every Activation is one `POST /session/:id/message` carrying a
// `messageID` chosen here, which the server persists as the user message id
// (`SessionPrompt.createUserMessage`). Its session loop creates each step's
// assistant with `parentID` = the current last user message BEFORE the
// step's model request, so the first assistant whose parent is our id proves
// the loop took THIS input (admission and the bodied-wake acceptance) before
// any tool ran.
//
// Boundary: the answer of that same HTTP request. `SessionPrompt.loop`
// resolves only when the session runner's fiber for this run has exited
// (after every step, including an auto-compaction and its autocontinue step,
// whose assistants have the synthetic continue message as parent, so "the
// assistant whose parent is our input" is NOT a sufficient boundary), or
// after an abort interrupted it. It is correlated by the connection itself,
// independent of the lossy live bus, so an SSE reconnect never confuses the
// boundary and never needs a resend. A bare `session.idle` is never used as
// the boundary; one observed after acceptance only bounds the wait for the
// trailing stream events (usage) before the drain.
//
// SSE reconnect: `/event` has no replay. After a reconnect the driver lists
// `GET /session/:id/message` and re-derives, from the persisted messages
// only, what it may have missed: the acceptance (assistant whose parent is
// our id) and terminal tool states for the final-reply boundary. The prompt
// is never resent. A gap makes `preemptedFollowUp` unknown.
//
// Abort barrier (seventh review P2-2, eighth review P1-1/P2-3):
// `POST /session/:id/abort` names only the session, so an abort still in
// flight could land on the NEXT turn. Every abort of this server/session
// (a turn's cancel or final abort, and the idle abort of an unprompted run)
// goes through one admission barrier: no turn is admitted while any abort is
// unanswered (each bounded by the request timeout); an abort whose outcome
// stays unknown (timeout, lost connection) keeps admission closed until that
// `opencode serve` is retired with an exit proof, and the same session
// continues on a fresh server inside this runtime. The prompt is never
// resent. A retirement without an exit proof (or a failed restart) ends the
// whole warm runtime; the Host/janitor termination proof takes over.
//
// Turn status: a Host stop is `interrupted`; otherwise any independent error
// (a non-abort `session.error`, a failed answer) makes it `failed` with the
// text kept for the Host, even after the final abort (seventh review P1-3).
//
// Busy input is refused in this slice (a prompt while the loop runs is
// appended to the running loop, which would move its exit condition; not
// verified). An unprompted run while idle (for example a background task) is
// aborted and never attributed; a turn.begin arriving meanwhile is held (not
// sent) until that abort passes the barrier. Not done: the per-turn handle is not restated
// after a native compaction; a turn that lost it cannot post, stays
// unacknowledged and is retried with a new handle (S2 spec §3).
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { writeSync } from "node:fs";
import { createServer } from "node:net";
import { createInterface } from "node:readline";

import { createOpenCodeFinalInterrupt } from "./opencode-final-interrupt.js";
import {
  isContextOverflowEvent,
  OpenCodeChildSessions,
  OpenCodeEventIdentityFilter,
} from "./opencode-event-identity.js";
import {
  abortedByInterrupt,
  boundedServerOutput,
  extractSseData,
  isRecord,
  openCodeEventError,
  OPENCODE_SESSION_PERMISSION,
  ensureOpenCodeSessionPermission,
  openCodeStepFinishPart,
  pendingOpenCodeRequests,
  record,
  safeResponseText,
  serverAuthHeader,
  stringField,
  verifyOpenCodeChildSession,
} from "./opencode-server-client.js";
import { stopOpenCodeServer } from "./opencode-server-process.js";
import { fetchOpenCodePrompt } from "./opencode-prompt-transport.mjs";
import { openCodeFinalOutputCandidate } from "./opencode-final-output.js";
import {
  openCodeConfigContentWithInstructions,
  openCodeMessageId,
  prepareOpenCodeInstructionsFile,
} from "./opencode-standing-instructions.js";
import { assertSessionReplacementAllowed } from "./provider-activation-input.js";
import {
  providerLaunchArguments,
  providerLaunchPolicy,
} from "./provider-launch-arguments.js";
import { readProviderPromptFile } from "./provider-prompt-file.js";
import { prepareOpenCodeUserMcpIsolation } from "./opencode-user-mcp.js";
import {
  normalizeOpenCodeTrajectoryEvent,
  RuntimeTrajectoryWriter,
  runtimeStatusTrajectory,
} from "./provider-trajectory-normalizer.js";
import {
  openCodeStepFinishCost,
  openCodeStepFinishUsage,
  ProviderUsageWriter,
} from "./provider-usage.js";

const PROVIDER = "opencode-server/v1";
const STARTUP_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 5_000;
// `GET /mcp` answers after the MCP connections settled.
const MCP_STATUS_REQUEST_TIMEOUT_MS = 10_000;
const TAIL_IDLE_TIMEOUT_MS = 5_000;
const SERVER_TERM_TIMEOUT_MS = 1_000;
const PROGRESS_THROTTLE_MS = 5_000;
const MAX_SSE_BUFFER_BYTES = 1024 * 1024;
const SSE_RECONNECT_DELAYS_MS = [100, 500, 2_000];
const MAX_SERVER_OUTPUT_BYTES = 64 * 1024;
const RECENT_MESSAGE_LIMIT = 64;

class HttpError extends Error {
  constructor(path, status, body) {
    super(
      `OpenCode API ${path} failed with HTTP ${status}${body === "" ? "" : `: ${body}`}`,
    );
    this.path = path;
    this.status = status;
  }
}

const options = parseArguments(
  process.argv[2] === "__opencode-warm-driver"
    ? process.argv.slice(3)
    : process.argv.slice(2),
);
let frameSequence = 0;
let server;
let sessionId;
const childSessions = new OpenCodeChildSessions();
const answeredRequests = new Set();
let active;
let autonomous = false;
/** One turn.begin held while the abort barrier is closed. */
let deferredBegin;
/** The one abort admission barrier (see the header). */
const abortBarrier = {
  pending: new Set(),
  retiring: undefined,
  unknown: false,
};
let shuttingDown = false;
let eventController;
let serverOutputTail = Buffer.alloc(0);

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
    process.stderr.write(`[loom opencode-warm] ${errorMessage(error)}\n`);
  }
});
process.stdin.once("end", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));
process.once("SIGINT", () => void shutdown(0));

try {
  server = await startServer();
  await subscribeEvents();
  const started = Date.now();
  let resumed = false;
  if (options.resumeSession !== undefined) {
    try {
      await requestJson(
        `/session/${encodeURIComponent(options.resumeSession)}`,
      );
      sessionId = options.resumeSession;
      resumed = true;
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 404) throw error;
      // A bound instance never silently replaces its session.
      assertSessionReplacementAllowed();
    }
  }
  // Review 2026-09-26 P1-1: before ready (so before any turn input), the
  // resumed session carries the verified denies; failure is fatal here and
  // never replaces the session.
  if (resumed)
    await ensureOpenCodeSessionPermission({ requestJson, sessionId });
  sessionId ??= await createSession();
  emit("ready", {
    resumed,
    sessionResumeMs: resumed ? Date.now() - started : null,
    threadId: sessionId,
  });
} catch (error) {
  fatal(redact(errorMessage(error)));
}

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
  if (sessionId === undefined) return refuse("warm runtime is not ready");
  if (active !== undefined || shuttingDown)
    return refuse("warm runtime is not idle");
  if (autonomous || abortBarrierClosed()) {
    // Eighth review P1-1: held, never sent to a server that may still
    // receive an unknown abort. The barrier passing sends it; a failed
    // retirement ends the runtime (the Host's admission timeout and cancel
    // prove termination either way).
    if (deferredBegin !== undefined) return refuse("warm runtime is not idle");
    deferredBegin = command;
    return;
  }
  let model;
  try {
    model = parseModel(command.model ?? options.model);
  } catch (error) {
    return refuse(errorMessage(error));
  }
  const turn = createTurn(runAttemptId, command.text);
  active = turn;
  const body = {
    messageID: turn.messageId,
    parts: [{ text: command.text, type: "text" }],
    ...(model === undefined ? {} : { model }),
  };
  const variant = command.effort ?? options.effort;
  if (variant !== undefined) body.variant = variant;
  turn.response = requestJson(
    `/session/${encodeURIComponent(sessionId)}/message`,
    { body: JSON.stringify(body), method: "POST" },
    0,
  ).then(
    (response) => void settleTurn(turn, response, undefined),
    (error) => void settleTurn(turn, undefined, error),
  );
}

function createTurn(runAttemptId, text) {
  const turn = {
    accepted: false,
    deliveryReported: false,
    errors: [],
    finalEnded: false,
    idle: false,
    identity: new OpenCodeEventIdentityFilter(),
    lastFrameSeq: 0,
    messageId: openCodeMessageId(),
    partTexts: new Map(),
    partTypes: new Map(),
    runAttemptId,
    settled: false,
    stopRequested: false,
    text,
    toolStates: new Map(),
    wakeIdle: () => undefined,
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
  turn.finalInterrupt = createOpenCodeFinalInterrupt({
    interrupt: async () => await barrierAbort(),
    inFlightTools: async () =>
      runToolParts(
        trustedMessageList(await recentMessages()),
        turn.messageId,
      ).filter((part) => !toolPartSettled(part)),
  });
  return turn;
}

// Busy Human input: refused (see the header). The receipt is a transport
// answer only; the Kernel keeps delivery/ACK ownership.
function noticeTurn(command) {
  let notice;
  try {
    notice = JSON.parse(command.line);
  } catch {
    return;
  }
  const turn = active;
  if (
    typeof notice?.id !== "string" ||
    notice.id.length > 64 ||
    turn === undefined ||
    turn.runAttemptId !== command.runAttemptId
  )
    return;
  emitTurnFrame(turn, {
    accepted: false,
    id: notice.id,
    protocol: "rah-runtime-notice-result/v1",
  });
}

function interruptTurn(command) {
  const turn = active;
  if (turn === undefined || turn.runAttemptId !== command.runAttemptId) return;
  turn.stopRequested = true;
  void barrierAbort().catch(() => undefined);
}

/**
 * An abort of the session's run, held by the admission barrier until
 * answered: an HTTP answer (even an error status) is a known outcome; a
 * timeout or a lost connection is not, and keeps the barrier closed until
 * the server is retired.
 */
function barrierAbort() {
  const request = abortSession();
  const tracked = request.then(
    () => "answered",
    (error) => {
      if (error instanceof HttpError) return "answered";
      abortBarrier.unknown = true;
      return "unknown";
    },
  );
  abortBarrier.pending.add(tracked);
  void tracked.then(() => abortBarrier.pending.delete(tracked));
  return request;
}

function abortBarrierClosed() {
  return (
    abortBarrier.pending.size > 0 ||
    abortBarrier.unknown ||
    abortBarrier.retiring !== undefined
  );
}

/**
 * Waits until every abort is answered; after an unknown outcome retires the
 * old server (exit proof) and resumes the session on a fresh one. Throws when
 * that is impossible: the barrier then stays closed and the caller ends the
 * runtime.
 */
async function passAbortBarrier() {
  while (abortBarrier.pending.size > 0)
    await Promise.all([...abortBarrier.pending]);
  if (!abortBarrier.unknown) return;
  abortBarrier.retiring ??= replaceServer().then(
    () => {
      abortBarrier.unknown = false;
      abortBarrier.retiring = undefined;
    },
    (error) => {
      abortBarrier.retiring = undefined;
      throw error;
    },
  );
  await abortBarrier.retiring;
}

function finalTurn(command) {
  const turn = active;
  if (
    turn === undefined ||
    turn.runAttemptId !== command.runAttemptId ||
    turn.messageId !== command.nativeTurnId ||
    turn.settled ||
    turn.stopRequested
  )
    return;
  turn.finalInterrupt.arm();
}

async function abortSession() {
  return await requestJson(`/session/${encodeURIComponent(sessionId)}/abort`, {
    body: "{}",
    method: "POST",
  });
}

// ---------------------------------------------------------------- events

async function subscribeEvents() {
  eventController = new AbortController();
  const controller = eventController;
  const response = await openCodeFetch("/event", {
    headers: { Accept: "text/event-stream" },
    signal: controller.signal,
  });
  if (!response.ok || response.body === null)
    throw new HttpError(
      "/event",
      response.status,
      await safeResponseText(response),
    );
  void consumeSse(response.body, controller).then(
    () => void eventsEnded(controller, "SSE ended"),
    (error) => void eventsEnded(controller, errorMessage(error)),
  );
}

async function eventsEnded(controller, reason) {
  if (shuttingDown || controller.signal.aborted) return;
  const turn = active;
  if (turn !== undefined) turn.finalInterrupt.observeGap();
  for (const wait of SSE_RECONNECT_DELAYS_MS) {
    await delay(wait);
    if (shuttingDown) return;
    try {
      await subscribeEvents();
      emit("unattributed", { method: "event", reason: "sse_reconnected" });
      await reconcileFromMessages();
      await reconcilePendingRequests();
      return;
    } catch {
      // Try again.
    }
  }
  fatal(`OpenCode event stream lost and not recovered: ${reason}`);
}

/**
 * After a gap in the live bus: re-derive from persisted messages only what
 * this driver may have missed. Never resends the prompt.
 */
async function reconcileFromMessages() {
  const turn = active;
  if (turn === undefined || sessionId === undefined) return;
  const messages = await recentMessages();
  if (!Array.isArray(messages) || active !== turn) return;
  if (
    messages.some(
      (message) =>
        message?.info?.role === "assistant" &&
        message.info.parentID === turn.messageId,
    )
  )
    acceptTurn(turn);
  if (!turn.accepted) return;
  for (const part of runToolParts(messages, turn.messageId))
    turn.finalInterrupt.observePart(part);
}

/**
 * Full review batch 3 (Codex re-review P2-1): a request asked during the gap
 * is lost with the bus, while the server still waits for it. The pending
 * requests are re-read and answered with the same rule, only for this
 * session's tree. A listing failure is a diagnostic; the stall supervisor
 * still bounds a request that stays unanswered.
 */
async function reconcilePendingRequests() {
  let pending;
  try {
    pending = await pendingOpenCodeRequests(requestJson);
  } catch {
    emit("unattributed", { method: "request", reason: "pending_unreadable" });
    return;
  }
  for (const event of pending) {
    try {
      await handleRequest(event);
    } catch (error) {
      const turn = active;
      if (turn !== undefined) turn.errors.push(errorMessage(error));
    }
  }
}

/**
 * A permission or question of this session or of its (proven) subagent
 * tree, answered by the turn's rule; any other session's is not ours.
 * Returns whether the request was this session's tree.
 */
async function handleRequest(event) {
  const asking = record(event.properties).sessionID;
  if (
    asking !== sessionId &&
    !childSessions.has(asking) &&
    !(await verifyOpenCodeChildSession({
      childSessions,
      parentSessionId: sessionId,
      requestJson,
      sessionId: asking,
    }))
  )
    return false;
  await answerRequest(event, active);
  return true;
}

async function recentMessages() {
  return await requestJson(
    `/session/${encodeURIComponent(sessionId)}/message?limit=${RECENT_MESSAGE_LIMIT}`,
  );
}

/** The final-abort check fails closed on a listing that is not a list. */
function trustedMessageList(messages) {
  if (!Array.isArray(messages))
    throw new Error("OpenCode message listing is not a list");
  return messages;
}

/**
 * Tool parts of the run that `messageId` started, from the latest persisted
 * messages (ascending). When our user message is older than the page, every
 * listed message is newer, so of this run.
 */
function runToolParts(messages, messageId) {
  if (!Array.isArray(messages)) return [];
  let ours = !messages.some((message) => message?.info?.id === messageId);
  const parts = [];
  for (const message of messages) {
    const info = record(message?.info);
    if (info.role === "user" && info.id === messageId) ours = true;
    if (!ours || info.role !== "assistant") continue;
    for (const part of Array.isArray(message.parts) ? message.parts : [])
      if (record(part).type === "tool") parts.push(part);
  }
  return parts;
}

function toolPartSettled(part) {
  const status = record(record(part).state).status;
  return status === "completed" || status === "error";
}

async function consumeSse(body, controller) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    if (controller.signal.aborted) return;
    buffer += decoder.decode(chunk, { stream: true });
    if (Buffer.byteLength(buffer, "utf8") > MAX_SSE_BUFFER_BYTES)
      throw new Error("OpenCode SSE frame exceeded the safe buffer limit");
    const extracted = extractSseData(buffer);
    buffer = extracted.remainder;
    for (const data of extracted.items) {
      let event;
      try {
        event = JSON.parse(data);
      } catch {
        throw new Error("OpenCode SSE returned malformed JSON");
      }
      try {
        await handleEvent(event);
      } catch (error) {
        const turn = active;
        if (turn !== undefined) turn.errors.push(errorMessage(error));
        else
          process.stderr.write(
            `[loom opencode-warm] ${redact(errorMessage(error))}\n`,
          );
      }
    }
  }
}

async function handleEvent(event) {
  if (!isRecord(event) || typeof event.type !== "string") return;
  const properties = record(event.properties);
  childSessions.observe(event, sessionId);
  // A request is answered by the parent session's rule, for the parent and
  // its subagent (child session) tree only — a child never announced here
  // is first proven by its native lineage.
  if (event.type === "permission.asked" || event.type === "question.asked")
    return void (await handleRequest(event));
  // A subagent's model step is this turn's cost (drivers P2-4).
  if (childSessions.has(properties.sessionID)) {
    const step = openCodeStepFinishPart(event);
    const turn = active;
    if (step !== undefined && turn?.accepted === true && !turn.settled) {
      turn.usageWriter.emit(openCodeStepFinishUsage(step));
      turn.usageWriter.emit(openCodeStepFinishCost(step));
    }
    return;
  }
  const ids = [
    properties.sessionID,
    record(properties.info).sessionID,
    record(properties.part).sessionID,
  ].filter((id) => id !== undefined);
  if (ids.length === 0 || ids.some((id) => id !== sessionId)) return;
  const turn = active;
  if (turn === undefined || turn.settled) return idleEvent(event);
  if (event.type === "message.updated") {
    const info = record(properties.info);
    if (info.role === "assistant" && info.parentID === turn.messageId)
      acceptTurn(turn);
  }
  if (!turn.accepted) {
    // Our own user message echo precedes acceptance; anything else is not
    // this Activation's.
    const info = record(properties.info);
    if (!(event.type === "message.updated" && info.id === turn.messageId))
      emit("unattributed", {
        method: event.type.slice(0, 200),
        reason: "before_acceptance",
      });
    return;
  }
  if (event.type === "session.error") {
    const message = openCodeEventError(properties);
    const abortError = message.includes("MessageAbortedError");
    if (abortError && (turn.stopRequested || turn.finalInterrupt.issued))
      return;
    turn.writer.emit(normalizeOpenCodeTrajectoryEvent(event, sessionId));
    // Recovered by auto-compaction; a real failure reaches the answer.
    if (isContextOverflowEvent(properties)) return;
    turn.errors.push(message);
    return;
  }
  if (event.type === "session.idle") {
    turn.idle = true;
    turn.wakeIdle();
  }
  const toolsBefore = turn.finalInterrupt.toolsInFlight;
  for (const accepted of turn.identity.accept(event, sessionId))
    projectEvent(turn, accepted);
  if (turn.finalInterrupt.toolsInFlight !== toolsBefore)
    reportProgress(turn, true);
  else if (
    event.type === "message.part.delta" ||
    event.type === "message.part.updated"
  )
    reportProgress(turn, false);
}

async function answerRequest(event, turn) {
  const properties = record(event.properties);
  const requestId = stringField(properties, "id");
  // Answered once: a reconnect may list a request the bus also delivered.
  if (requestId === undefined || answeredRequests.has(requestId)) return;
  answeredRequests.add(requestId);
  if (answeredRequests.size > 1024)
    answeredRequests.delete(answeredRequests.values().next().value);
  if (event.type === "question.asked") {
    await requestJson(`/question/${encodeURIComponent(requestId)}/reject`, {
      method: "POST",
    });
    return;
  }
  const allow =
    turn !== undefined &&
    turn.accepted &&
    !turn.settled &&
    !turn.stopRequested &&
    !turn.finalInterrupt.issued;
  await requestJson(`/permission/${encodeURIComponent(requestId)}/reply`, {
    body: JSON.stringify({ reply: allow ? "always" : "reject" }),
    method: "POST",
  });
}

function acceptTurn(turn) {
  if (turn.accepted) return;
  turn.accepted = true;
  emit("turn.accepted", {
    nativeTurnId: turn.messageId,
    runAttemptId: turn.runAttemptId,
  });
  // ACCEPTANCE SIGNAL: the first assistant whose parent is THIS input's id;
  // the digest covers the whole Host-composed turn text.
  if (!turn.deliveryReported) {
    turn.deliveryReported = true;
    emitTurnFrame(turn, {
      inputSha256: createHash("sha256").update(turn.text, "utf8").digest("hex"),
      protocol: "rah-delivery-accepted/v1",
      provider: PROVIDER,
      signal: "opencode-assistant-parent",
      threadId: sessionId,
      turnId: turn.messageId,
    });
  }
}

function projectEvent(turn, event) {
  const properties = record(event.properties);
  if (event.type === "message.part.delta") {
    turn.finalInterrupt.observeDelta();
    const partId = stringField(properties, "partID");
    const delta = stringField(properties, "delta");
    const partType =
      partId === undefined ? undefined : turn.partTypes.get(partId);
    if (
      partId === undefined ||
      delta === undefined ||
      properties.field !== "text" ||
      (partType !== "text" && partType !== "reasoning")
    )
      return;
    turn.partTexts.set(partId, `${turn.partTexts.get(partId) ?? ""}${delta}`);
    turn.writer.emit(
      normalizeOpenCodeTrajectoryEvent(
        {
          properties: {
            part: { id: partId, text: delta, type: partType },
            sessionID: sessionId,
            time: properties.time,
          },
          type: "message.part.updated",
        },
        sessionId,
      ),
    );
    return;
  }
  if (event.type === "message.part.updated") {
    const part = record(properties.part);
    turn.finalInterrupt.observePart(part);
    turn.usageWriter.emit(openCodeStepFinishUsage(part));
    turn.usageWriter.emit(openCodeStepFinishCost(part));
    const partId = stringField(part, "id");
    const partType = stringField(part, "type");
    if (partId !== undefined && partType !== undefined)
      turn.partTypes.set(partId, partType);
    if (
      partId !== undefined &&
      (partType === "text" || partType === "reasoning")
    ) {
      const text = stringField(part, "text") ?? "";
      const previous = turn.partTexts.get(partId) ?? "";
      const delta = text.startsWith(previous)
        ? text.slice(previous.length)
        : previous.startsWith(text)
          ? ""
          : text;
      turn.partTexts.set(partId, text);
      if (delta === "") return;
      event = {
        ...event,
        properties: { ...properties, part: { ...part, text: delta } },
      };
    } else if (partType === "tool") {
      const status = stringField(record(part.state), "status");
      const callId = stringField(part, "callID") ?? partId;
      if (callId === undefined || status === undefined || status === "pending")
        return;
      const previous = turn.toolStates.get(callId);
      if (previous === status) return;
      turn.toolStates.set(callId, status);
      if (status === "running" && previous !== undefined) return;
    }
  }
  turn.writer.emit(normalizeOpenCodeTrajectoryEvent(event, sessionId));
}

function idleEvent(event) {
  // A late tail of a drained turn is expected noise; new model work while no
  // Activation runs is an unprompted run: abort it, never attribute it.
  const info = record(record(event.properties).info);
  const unprompted =
    event.type === "session.status" &&
    record(record(event.properties).status).type === "busy";
  if (
    (unprompted ||
      (event.type === "message.updated" &&
        info.role === "assistant" &&
        info.time?.completed === undefined)) &&
    active === undefined &&
    !autonomous
  ) {
    autonomous = true;
    emit("unattributed", {
      method: event.type.slice(0, 200),
      reason: "autonomous_turn",
    });
    // Eighth review P1-1: the same barrier as a turn's aborts; admission
    // stays closed until the outcome is known or the server is retired.
    void barrierAbort().catch(() => undefined);
    void passAbortBarrier().then(
      () => {
        autonomous = false;
        const held = deferredBegin;
        deferredBegin = undefined;
        if (held !== undefined) beginTurn(held);
      },
      (error) =>
        fatal(
          `an abort of an unprompted run has an unknown outcome and the server could not be retired: ${redact(errorMessage(error))}`,
        ),
    );
    return;
  }
  emit("unattributed", {
    method: event.type.slice(0, 200),
    reason: active === undefined ? "no_turn" : "after_boundary",
  });
}

// -------------------------------------------------------------- boundary

async function settleTurn(turn, response, error) {
  if (turn.settled) return;
  if (error !== undefined && !turn.accepted) {
    turn.settled = true;
    if (active === turn) active = undefined;
    // Nothing of this input ran: a 4xx is an explicit refusal.
    emit("turn.failed", {
      error: redact(errorMessage(error)).slice(0, 2048),
      rejected: error instanceof HttpError && error.status < 500,
      runAttemptId: turn.runAttemptId,
    });
    return;
  }
  if (!turn.accepted && response !== undefined) {
    // The loop answered: its assistant may have been lost on the bus.
    try {
      await reconcileFromMessages();
    } catch {
      // Judged below.
    }
    if (!turn.accepted) {
      turn.settled = true;
      if (active === turn) active = undefined;
      emit("turn.failed", {
        error: "OpenCode answered the prompt without an assistant of it",
        rejected: false,
        runAttemptId: turn.runAttemptId,
      });
      return;
    }
  }
  const aborted = abortedByInterrupt(response);
  turn.finalInterrupt.settle(error === undefined ? aborted : undefined);
  turn.finalEnded =
    !turn.stopRequested && turn.finalInterrupt.issued && aborted;
  if (error !== undefined) turn.errors.push(redact(errorMessage(error)));
  else if (!turn.finalEnded && !(turn.stopRequested && aborted)) {
    const failure = responseError(response);
    if (failure !== undefined) turn.errors.push(failure);
  }
  // The answer is the boundary; the idle only bounds the trailing events.
  if (!turn.idle)
    await Promise.race([
      new Promise((resolve) => {
        turn.wakeIdle = resolve;
      }),
      delay(TAIL_IDLE_TIMEOUT_MS),
    ]);
  if (!turn.idle)
    emit("unattributed", { method: "session.idle", reason: "missing_idle" });
  // The next turn is admitted only after every abort is answered; an
  // unknown outcome retires the server (with an exit proof) before the drain.
  let replaceError;
  await passAbortBarrier().catch((error) => {
    replaceError = error;
  });
  turn.settled = true;
  if (turn.finalEnded)
    turn.writer.emit(
      runtimeStatusTrajectory(
        "online",
        "stopped",
        "工作轮次已完成",
        "opencode:prompt:final-reply-abort",
      ),
    );
  else if (turn.stopRequested)
    turn.writer.emit(
      runtimeStatusTrajectory(
        "offline",
        "stopped",
        "工作轮次结束：interrupted",
        "opencode:prompt:interrupted",
      ),
    );
  turn.writer.flush();
  if (turn.finalInterrupt.armed)
    emitTurnFrame(turn, {
      protocol: "rah-final-interrupt/v1",
      ...turn.finalInterrupt.report(),
    });
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
    ...(status === "completed" &&
    replaceError === undefined &&
    turn.finalInterrupt.toolsInFlight === 0
      ? {
          finalOutputCandidate: openCodeFinalOutputCandidate(response, {
            sessionId,
            parentId: turn.messageId,
            nativeText: options.finalOutputMode === "native-text",
          }),
        }
      : {}),
    inFlightToolCount: turn.finalInterrupt.toolsInFlight,
    lastFrameSeq: turn.lastFrameSeq,
    nativeTurnId: turn.messageId,
    runAttemptId: turn.runAttemptId,
    status,
    stopRequested: turn.stopRequested,
    ...(failed
      ? { errorMessage: redact(turn.errors.join("; ")).slice(0, 2048) }
      : {}),
    ...(turn.finalEnded && !failed ? { endedAfterFinalReply: true } : {}),
  });
  if (active === turn) active = undefined;
  if (replaceError !== undefined)
    fatal(
      `an abort of the last turn has an unknown outcome and the server could not be replaced: ${redact(errorMessage(replaceError))}`,
    );
}

function responseError(response) {
  if (!isRecord(response) || !isRecord(response.info))
    return "OpenCode prompt returned no assistant response";
  if (response.info.role !== "assistant")
    return "OpenCode prompt returned a non-assistant response";
  if (response.info.error === undefined) return undefined;
  const error = record(response.info.error);
  const data = record(error.data);
  return (
    stringField(data, "message") ??
    stringField(error, "message") ??
    stringField(error, "name") ??
    "OpenCode assistant response failed"
  );
}

// ---------------------------------------------------------------- server

async function startServer() {
  const port = await allocatePort();
  const rules = prepareOpenCodeInstructionsFile(
    finalOutputInstructions(
      nativeFinalTextInstructions(
        options.prompt,
        options.finalOutputMode === "native-text",
      ),
      options.finalOutputMode === "enabled",
    ),
  );
  // evo §57/§59: the user's MCP servers, switched off by name.
  const userMcp = await prepareOpenCodeUserMcpIsolation({
    executable: options.executable,
    env: { ...process.env, ...providerLaunchPolicy("opencode").environment },
    cwd: process.cwd(),
  });
  const content = openCodeConfigContentWithInstructions(
    process.env.OPENCODE_CONFIG_CONTENT,
    rules,
  );
  const child = spawn(
    options.executable,
    [
      ...providerLaunchArguments("opencode"),
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...providerLaunchPolicy("opencode").environment,
        OPENCODE_CONFIG_CONTENT: userMcp.configContent(content),
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", rememberServerOutput);
  child.stderr.on("data", rememberServerOutput);
  const exited = new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  child.once("error", (error) => fatal(`opencode failed: ${error.message}`));
  void exited.then(({ code, signal }) => {
    if (!shuttingDown && handle.retired !== true)
      fatal(
        `opencode serve exited (code=${String(code)}, signal=${String(signal)})${serverDiagnostics()}`,
      );
  });
  const handle = {
    retired: false,
    authHeader: serverAuthHeader(),
    baseUrl: `http://127.0.0.1:${port}`,
    child,
    exited,
  };
  server = handle;
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("OpenCode server exited during startup");
    try {
      await requestJson("/path", {}, 2_000);
      // Fail closed before ready: no user MCP server may run.
      await userMcp.verify((path) =>
        requestJson(path, {}, MCP_STATUS_REQUEST_TIMEOUT_MS),
      );
      return handle;
    } catch (error) {
      if (error?.userMcp === true) throw error;
      lastError = error;
      await delay(100);
    }
  }
  throw new Error(
    `OpenCode server startup timed out: ${errorMessage(lastError)}`,
  );
}

async function createSession() {
  const created = await requestJson("/session", {
    body: JSON.stringify({
      permission: OPENCODE_SESSION_PERMISSION,
      title: "RAH OS Role instance",
    }),
    method: "POST",
  });
  const id = stringField(created, "id");
  if (id === undefined)
    throw new Error("OpenCode session/create returned no id");
  return id;
}

async function requestJson(path, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = timeoutMs > 0 ? new AbortController() : undefined;
  const timer =
    controller === undefined
      ? undefined
      : setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await openCodeFetch(
      path,
      {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
          ...(init.headers ?? {}),
        },
        ...(controller === undefined ? {} : { signal: controller.signal }),
      },
      timeoutMs === 0,
    );
    if (!response.ok)
      throw new HttpError(
        path,
        response.status,
        await safeResponseText(response),
      );
    if (response.status === 204) return undefined;
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function openCodeFetch(path, init = {}, longPrompt = false) {
  if (server === undefined) throw new Error("OpenCode server is not running");
  const url = new URL(path, server.baseUrl);
  if (!url.searchParams.has("directory"))
    url.searchParams.set("directory", process.cwd());
  const headers = new Headers(init.headers);
  if (server.authHeader !== undefined && !headers.has("Authorization"))
    headers.set("Authorization", server.authHeader);
  return await (longPrompt ? fetchOpenCodePrompt : fetch)(url, {
    ...init,
    headers,
  });
}

async function allocatePort() {
  return await new Promise((resolve, reject) => {
    const socket = createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      socket.close(() => {
        if (isRecord(address) && typeof address.port === "number")
          resolve(address.port);
        else reject(new Error("failed to allocate an OpenCode server port"));
      });
    });
  });
}

function rememberServerOutput(chunk) {
  serverOutputTail = boundedServerOutput(
    serverOutputTail,
    chunk,
    MAX_SERVER_OUTPUT_BYTES,
  );
}

function serverDiagnostics() {
  const text = redact(serverOutputTail.toString("utf8")).trim();
  return text === "" ? "" : `\n${text.slice(-2048)}`;
}

// ------------------------------------------------------------------ host

function reportProgress(turn, force) {
  const now = Date.now();
  if (!force && now - (turn.progressAt ?? 0) < PROGRESS_THROTTLE_MS) return;
  turn.progressAt = now;
  emit("progress", {
    awaitingApproval: false,
    nativeTurnId: turn.messageId,
    runAttemptId: turn.runAttemptId,
    toolsInFlight: turn.finalInterrupt.toolsInFlight,
  });
}

function emitTurnFrame(turn, frame) {
  turn.lastFrameSeq = emit("frame", {
    frame,
    nativeTurnId: turn.messageId,
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
  process.stderr.write(`[loom opencode-warm] ${message}\n`);
  void shutdown(1);
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (active !== undefined && sessionId !== undefined && server !== undefined)
    await Promise.race([abortSession().catch(() => undefined), delay(500)]);
  eventController?.abort();
  let code = exitCode;
  if (server !== undefined)
    await stopOpenCodeServer(server, {
      termTimeoutMs: SERVER_TERM_TIMEOUT_MS,
    }).catch((error) => {
      // The process group stays for the Host/janitor termination proof.
      process.stderr.write(`[loom opencode-warm] ${errorMessage(error)}\n`);
      code = 1;
    });
  process.exit(code);
}

/**
 * P2-2: an abort whose outcome is unknown may still land on the old server.
 * Retire that server (and its live bus) and continue the same session on a
 * fresh one before the next turn can be admitted; a missing session is never
 * replaced silently. Eighth review P2-3: no fresh server without the old
 * one's exit proof (`stopOpenCodeServer` throws instead).
 */
async function replaceServer() {
  const old = server;
  if (old !== undefined) old.retired = true;
  eventController?.abort();
  if (old !== undefined)
    await stopOpenCodeServer(old, { termTimeoutMs: SERVER_TERM_TIMEOUT_MS });
  server = await startServer();
  await subscribeEvents();
  await ensureOpenCodeSessionPermission({ requestJson, sessionId });
}

// ---------------------------------------------------------------- helpers

function parseModel(value) {
  if (value === undefined) return undefined;
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1)
    throw new Error("OpenCode model must use provider/model");
  return {
    modelID: value.slice(separator + 1),
    providerID: value.slice(0, separator),
  };
}

function redact(message) {
  let redacted = String(message);
  for (const id of [options.resumeSession, sessionId])
    if (typeof id === "string" && id !== "")
      redacted = redacted.split(id).join("[provider-session]");
  return redacted;
}

function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`missing value for ${name}`);
    if (name === "--executable") parsed.executable = value;
    else if (name === "--tool-access-mode") parsed.toolAccessMode = value;
    else if (
      name === "--final-output-mode" &&
      (value === "enabled" || value === "native-text")
    )
      parsed.finalOutputMode = value;
    else if (name === "--prompt") parsed.prompt = value;
    else if (name === "--prompt-file")
      parsed.prompt = readProviderPromptFile(value);
    else if (name === "--model") parsed.model = value;
    else if (name === "--effort" || name === "--reasoning")
      parsed.effort = value;
    else if (name === "--resume-session") parsed.resumeSession = value;
    else if (name === "--runtime-id") parsed.runtimeId = value;
    else if (name === "--host-generation") parsed.hostGeneration = value;
    // The Codex transport's socket directory; OpenCode speaks local HTTP.
    else if (name === "--socket-dir") parsed.socketDirectory = value;
    else throw new Error(`unsupported opencode warm driver option: ${name}`);
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
