import {
  providerLaunchArguments,
  providerLaunchPolicy,
} from "./provider-launch-arguments.js";
import {
  assertSessionReplacementAllowed,
  providerActivationInput,
} from "./provider-activation-input.js";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { writeSync } from "node:fs";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { createOpenCodeFinalInterrupt } from "./opencode-final-interrupt.js";
import { fetchOpenCodePrompt } from "./opencode-prompt-transport.mjs";
import {
  openCodeConfigContentWithInstructions,
  openCodeMessageId,
  prepareOpenCodeInstructionsFile,
} from "./opencode-standing-instructions.js";
import { readProviderPromptFile } from "./provider-prompt-file.js";
import { prepareOpenCodeUserMcpIsolation } from "./opencode-user-mcp.js";
import {
  isContextOverflowEvent,
  OpenCodeChildSessions,
  OpenCodeEventIdentityFilter,
  scopedOpenCodeEvent,
} from "./opencode-event-identity.js";
import {
  abortedByInterrupt,
  boundedServerOutput,
  extractSseData,
  isRecord,
  OPENCODE_SESSION_PERMISSION,
  ensureOpenCodeSessionPermission,
  openCodeEventError,
  openCodeStepFinishPart,
  preloadOpenCodeChildSessions,
  record,
  safeResponseText,
  serverAuthHeader,
  stringField,
  verifyOpenCodeChildSession,
} from "./opencode-server-client.js";

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

const STARTUP_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 2_000;
// `GET /mcp` answers after the MCP connections settled.
const MCP_STATUS_REQUEST_TIMEOUT_MS = 10_000;
const ABORT_CONFIRM_TIMEOUT_MS = 750;
const SERVER_TERM_TIMEOUT_MS = 300;
const TERMINAL_EVENT_TIMEOUT_MS = 5_000;
const MAX_SERVER_OUTPUT_BYTES = 64 * 1024;
const MAX_SSE_BUFFER_BYTES = 1024 * 1024;
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

const PROVIDER = "opencode-server/v1";
const options = parseArguments(driverArguments(process.argv.slice(2)));
// S2-c3: the Host-prepared wake file verbatim when present (the Host already
// appended the notice lines, so the acceptance digest covers them); otherwise
// the fixed startup wake plus the env notices.
const TURN_INPUT = options.wakeInput ?? providerActivationInput();
const trajectoryWriter = new RuntimeTrajectoryWriter();
const usageWriter = new ProviderUsageWriter();
const eventIdentity = new OpenCodeEventIdentityFilter();
const childSessions = new OpenCodeChildSessions();
const partTypes = new Map();
const partTexts = new Map();
const toolStates = new Map();
let server;
let activeSessionId;
// The native session this run already reported as bound (reported once).
let boundProviderSessionId;
let eventController;
let eventFailureReject;
let stopping = false;
let cancelRequested = false;
let promptSettlement;
let idleSettlement;
let resolveIdle;
let observedToolActivity = false;
let serverOutputTail = Buffer.alloc(0);
// Per prompt: our caller-chosen user messageID, whether this run's loop took
// it (an assistant whose parent it is), and the final-reply abort.
let activePrompt;

const eventFailure = new Promise((_, reject) => {
  eventFailureReject = reject;
});

const terminate = async (signal) => {
  if (stopping) return;
  stopping = true;
  cancelRequested = true;
  if (activeSessionId !== undefined && server !== undefined) {
    await Promise.race([
      requestJson(`/session/${encodeURIComponent(activeSessionId)}/abort`, {
        body: "{}",
        method: "POST",
      }).catch(() => undefined),
      delay(ABORT_CONFIRM_TIMEOUT_MS),
    ]);
  }
  if (promptSettlement !== undefined) {
    await Promise.race([
      promptSettlement.catch(() => undefined),
      delay(ABORT_CONFIRM_TIMEOUT_MS),
    ]);
  }
  eventController?.abort();
  await stopServer(signal);
};

process.once("SIGTERM", () => void terminate("SIGTERM"));
process.once("SIGINT", () => void terminate("SIGINT"));
// S2-c3: the Host's final-reply signal (`rah-final-reply/v1`) on the private
// input pipe. Absent (stdin ignored) the driver behaves as before.
const hostInput = createInterface({ input: process.stdin });
hostInput.on("line", (line) => {
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    return;
  }
  if (frame?.protocol === "rah-final-reply/v1") armFinalReply(frame);
});
process.stdin.on("error", () => undefined);

try {
  trajectoryWriter.emit(
    runtimeStatusTrajectory(
      "working",
      "starting",
      "正在启动 OpenCode Runtime",
      "opencode:driver:starting",
    ),
  );
  server = await startServer();
  await subscribeEvents();
  let resumed = false;
  if (options.resumeSession !== undefined) {
    try {
      await requestJson(
        `/session/${encodeURIComponent(options.resumeSession)}`,
      );
      activeSessionId = options.resumeSession;
      resumed = true;
      // Its existing subagent sessions, so their requests need no live
      // announcement (full review batch 3).
      await preloadOpenCodeChildSessions({
        childSessions,
        parentSessionId: activeSessionId,
        requestJson,
      });
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 404) throw error;
      assertSessionReplacementAllowed();
      trajectoryWriter.emit(
        runtimeStatusTrajectory(
          "working",
          "other",
          "此前 OpenCode 会话无法恢复，已自动启用新会话",
          "opencode:resume:session_not_found",
        ),
      );
    }
  }
  if (resumed) {
    // Review 2026-09-26 P1-1: the resumed session's own rules may predate
    // the denies; install and verify them before any input (fail: no prompt,
    // no replacement session).
    await ensureOpenCodeSessionPermission({
      requestJson,
      sessionId: activeSessionId,
    });
  }
  if (activeSessionId === undefined) {
    activeSessionId = await createSession();
  }
  prepareIdleSettlement();
  promptSettlement = submitPrompt(resumed);
  let response;
  try {
    response = await Promise.race([promptSettlement, eventFailure]);
  } catch (error) {
    if (
      !stopping &&
      error instanceof HttpError &&
      error.status === 404 &&
      !observedToolActivity
    ) {
      assertSessionReplacementAllowed();
      trajectoryWriter.emit(
        runtimeStatusTrajectory(
          "working",
          "other",
          "此前 OpenCode 会话在提交前失效，已自动启用新会话",
          "opencode:resume:prompt_session_not_found",
        ),
      );
      activeSessionId = await createSession();
      resetTurnProjection();
      prepareIdleSettlement();
      promptSettlement = submitPrompt(false);
      response = await Promise.race([promptSettlement, eventFailure]);
    } else {
      throw error;
    }
  }
  const { finalInterrupt } = activePrompt;
  const aborted = abortedByInterrupt(response);
  finalInterrupt.settle(aborted);
  // Ended by the Host after the final reply committed: the reply is done, so
  // the aborted run is this turn's success.
  const endedAfterFinalReply =
    !cancelRequested && finalInterrupt.issued && aborted;
  if (!endedAfterFinalReply) assertCompletedAssistantResponse(response);
  await waitForIdleEvidence();
  if (endedAfterFinalReply)
    trajectoryWriter.emit(
      runtimeStatusTrajectory(
        "online",
        "stopped",
        "工作轮次已完成",
        "opencode:prompt:final-reply-abort",
      ),
    );
  if (finalInterrupt.armed)
    writeHostFrame({
      protocol: "rah-final-interrupt/v1",
      ...finalInterrupt.report(),
    });
  if (!stopping) {
    writeProviderSessionEvidence(activeSessionId);
  }
  eventController?.abort();
  await stopServer("SIGTERM");
} catch (error) {
  if (stopping) {
    trajectoryWriter.emit(
      runtimeStatusTrajectory(
        "offline",
        "stopped",
        "工作轮次结束：interrupted",
        "opencode:prompt:interrupted",
      ),
    );
    process.exitCode = 0;
  } else {
    const safe = redactProviderSessionIds(errorMessage(error));
    trajectoryWriter.emit(
      runtimeStatusTrajectory(
        "error",
        "runtime_error",
        safe,
        "opencode:driver:error",
      ),
    );
    const diagnostics = redactProviderSessionIds(
      serverOutputTail.toString("utf8"),
    ).trim();
    process.stderr.write(
      `[rah-os opencode-server] ${safe}${diagnostics === "" ? "" : `\n${diagnostics}`}\n`,
    );
    await terminate("SIGTERM");
    process.exitCode = 1;
  }
} finally {
  // The Host keeps the input pipe open; it must not keep this driver alive.
  hostInput.close();
  process.stdin.destroy();
}

async function startServer() {
  const port = await allocatePort();
  // evo §57/§59: the user's MCP servers, switched off by name.
  const userMcp = await prepareOpenCodeUserMcpIsolation({
    executable: options.executable,
    env: { ...process.env, ...providerLaunchPolicy("opencode").environment },
    cwd: process.cwd(),
  });
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
      env: serverEnvironment(userMcp),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", rememberServerOutput);
  child.stderr.on("data", rememberServerOutput);
  const exited = new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const failed = new Promise((_, reject) => child.once("error", reject));
  const handle = {
    authHeader: serverAuthHeader(),
    baseUrl: `http://127.0.0.1:${port}`,
    child,
    exited,
  };
  server = handle;
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await Promise.race([
        requestJson("/path", {}, REQUEST_TIMEOUT_MS),
        failed,
        exited.then(({ code, signal }) => {
          throw new Error(
            `OpenCode server exited during startup (code=${String(code)}, signal=${String(signal)})`,
          );
        }),
      ]);
      // Fail closed before any input: no user MCP server may run.
      await userMcp.verify((path) =>
        requestJson(path, {}, MCP_STATUS_REQUEST_TIMEOUT_MS),
      );
      return handle;
    } catch (error) {
      if (error?.userMcp === true) throw error;
      lastError = error;
      if (child.exitCode !== null || child.signalCode !== null) throw error;
      await delay(100);
    }
  }
  throw new Error(
    `OpenCode server startup timed out: ${errorMessage(lastError)}`,
  );
}

async function stopServer(signal) {
  const handle = server;
  if (handle === undefined) return;
  eventController?.abort();
  if (handle.child.exitCode !== null || handle.child.signalCode !== null) {
    await handle.exited;
    return;
  }
  handle.child.kill(signal);
  const terminated = await Promise.race([
    handle.exited.then(() => true),
    delay(SERVER_TERM_TIMEOUT_MS).then(() => false),
  ]);
  if (
    !terminated &&
    handle.child.exitCode === null &&
    handle.child.signalCode === null
  ) {
    handle.child.kill("SIGKILL");
    await Promise.race([handle.exited, delay(SERVER_TERM_TIMEOUT_MS)]);
  }
}

async function subscribeEvents() {
  eventController = new AbortController();
  const response = await openCodeFetch("/event", {
    headers: { Accept: "text/event-stream" },
    signal: eventController.signal,
  });
  if (!response.ok || response.body === null) {
    throw new HttpError(
      "/event",
      response.status,
      await safeResponseText(response),
    );
  }
  void consumeSse(response.body).catch((error) => {
    if (!eventController.signal.aborted && !stopping) {
      eventFailureReject(error);
    }
  });
}

async function consumeSse(body) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    if (Buffer.byteLength(buffer, "utf8") > MAX_SSE_BUFFER_BYTES) {
      throw new Error("OpenCode SSE frame exceeded the safe buffer limit");
    }
    const extracted = extractSseData(buffer);
    buffer = extracted.remainder;
    for (const data of extracted.items) {
      let event;
      try {
        event = JSON.parse(data);
      } catch {
        throw new Error("OpenCode SSE returned malformed JSON");
      }
      await handleEvent(event);
    }
  }
  if (!eventController.signal.aborted && !stopping) {
    throw new Error("OpenCode SSE ended before the Provider turn completed");
  }
}

async function handleEvent(event) {
  if (!isRecord(event) || typeof event.type !== "string") {
    throw new Error("OpenCode SSE returned an invalid event envelope");
  }
  childSessions.observe(event, activeSessionId);
  const askingSession = record(event.properties).sessionID;
  let child = childSessions.has(askingSession);
  // A request of a session never announced here (its `session.created`
  // lost): answered only once the native lineage proves it is ours.
  if (
    !child &&
    (event.type === "permission.asked" || event.type === "question.asked") &&
    askingSession !== activeSessionId
  )
    child = await verifyOpenCodeChildSession({
      childSessions,
      parentSessionId: activeSessionId,
      requestJson,
      sessionId: askingSession,
    });
  if (!child) event = scopedOpenCodeEvent(event, activeSessionId);
  if (!event) return;
  // A subagent's (child session's) event matters only as a request, which
  // is answered by the parent session's rule below, and as its model steps'
  // usage, which is this run's cost (drivers P2-4).
  if (child) {
    const step = openCodeStepFinishPart(event);
    if (step !== undefined) {
      usageWriter.emit(openCodeStepFinishUsage(step));
      usageWriter.emit(openCodeStepFinishCost(step));
    }
    if (event.type !== "permission.asked" && event.type !== "question.asked")
      return;
  }
  const properties = record(event.properties);
  // Retry safety is independent of lossy telemetry/role arrival order.
  if (
    event.type === "message.part.updated" &&
    record(properties.part).type === "tool"
  )
    observedToolActivity = true;
  if (event.type === "permission.asked") {
    const requestId = stringField(properties, "id");
    if (requestId === undefined) {
      throw new Error("OpenCode permission event returned no request id");
    }
    const turnCancelled =
      cancelRequested || activePrompt?.finalInterrupt.issued === true;
    await requestJson(`/permission/${encodeURIComponent(requestId)}/reply`, {
      body: JSON.stringify({ reply: turnCancelled ? "reject" : "always" }),
      method: "POST",
    });
  } else if (event.type === "question.asked") {
    const requestId = stringField(properties, "id");
    if (requestId === undefined) {
      throw new Error("OpenCode question event returned no request id");
    }
    await requestJson(`/question/${encodeURIComponent(requestId)}/reject`, {
      method: "POST",
    });
  } else if (event.type === "session.error") {
    const providerError = openCodeEventError(properties);
    const abortError = providerError.includes("MessageAbortedError");
    // The abort this driver sent after the final reply: expected, not an error.
    if (abortError && activePrompt?.finalInterrupt.issued === true) return;
    trajectoryWriter.emit(
      normalizeOpenCodeTrajectoryEvent(event, activeSessionId),
    );
    // Recovered by auto-compaction; a real failure reaches the answer.
    if (isContextOverflowEvent(properties)) return;
    if (!(stopping && abortError)) {
      throw new Error(providerError);
    }
    return;
  }
  if (event.type === "message.updated") observePromptMessage(properties.info);
  projectEvent(event);
  // A bare idle proves nothing about this prompt: an old run's late idle on
  // the live bus precedes our input. Only an idle after the loop took our
  // message settles.
  if (event.type === "session.idle" && activePrompt?.observed === true)
    resolveIdle?.();
}

/**
 * ACCEPTANCE SIGNAL: the first assistant message whose `parentID` is our
 * caller-chosen user messageID. The session loop creates each step's
 * assistant (parent = the current last user message) before that step's
 * model request, so before any tool of the turn (any post). Only a
 * Host-prepared wake is reported; its digest is what the Host prepared.
 */
function observePromptMessage(info) {
  const prompt = activePrompt;
  if (prompt === undefined || !isRecord(info)) return;
  if (info.sessionID !== undefined && info.sessionID !== prompt.sessionId)
    return;
  if (info.role === "user" && info.id === prompt.messageId) {
    prompt.observed = true;
    return;
  }
  if (info.role !== "assistant" || info.parentID !== prompt.messageId) return;
  prompt.observed = true;
  if (prompt.deliveryReported) return;
  prompt.deliveryReported = true;
  // Contract §3: the session loop now holds this input, so the session is
  // bound before anything else (a later cancel, crash or error resumes it,
  // never a silently new session). Reported once; success reports it again
  // idempotently.
  writeProviderSessionEvidence(prompt.sessionId);
  if (options.wakeInput !== undefined)
    writeHostFrame({
      protocol: "rah-delivery-accepted/v1",
      provider: PROVIDER,
      signal: "opencode-assistant-parent",
      threadId: prompt.sessionId,
      turnId: prompt.messageId,
      inputSha256: createHash("sha256")
        .update(options.wakeInput, "utf8")
        .digest("hex"),
    });
}

/** The Host's signal: end THIS run at its next tool boundary. */
function armFinalReply(frame) {
  const prompt = activePrompt;
  if (
    prompt === undefined ||
    stopping ||
    cancelRequested ||
    typeof frame.runAttemptId !== "string" ||
    (process.env.RAH_RUN_ATTEMPT_ID !== undefined &&
      frame.runAttemptId !== process.env.RAH_RUN_ATTEMPT_ID) ||
    (frame.turnId !== undefined && frame.turnId !== prompt.messageId)
  )
    return;
  prompt.finalInterrupt.arm();
}

function serverEnvironment(userMcp) {
  const rules = prepareOpenCodeInstructionsFile(options.prompt);
  const content = openCodeConfigContentWithInstructions(
    process.env.OPENCODE_CONFIG_CONTENT,
    rules,
  );
  return {
    ...process.env,
    ...providerLaunchPolicy("opencode").environment,
    OPENCODE_CONFIG_CONTENT: userMcp.configContent(content),
  };
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

/** Host-private fd3 frame, intercepted before trajectory parsing. */
function writeHostFrame(frame) {
  try {
    writeSync(3, `${JSON.stringify(frame)}\n`);
  } catch {
    // No Host listening: nothing is registered.
  }
}

function projectEvent(event) {
  for (const accepted of eventIdentity.accept(event, activeSessionId)) {
    projectIdentifiedEvent(accepted);
  }
}

function projectIdentifiedEvent(event) {
  const properties = record(event.properties);
  // Assistant-owned only (the identity filter dropped user parts).
  if (event.type === "message.part.updated")
    activePrompt?.finalInterrupt.observePart(properties.part);
  else if (event.type === "message.part.delta")
    activePrompt?.finalInterrupt.observeDelta();
  if (event.type === "message.part.delta") {
    const partId = stringField(properties, "partID");
    const delta = stringField(properties, "delta");
    const partType = partId === undefined ? undefined : partTypes.get(partId);
    if (
      partId === undefined ||
      delta === undefined ||
      properties.field !== "text" ||
      (partType !== "text" && partType !== "reasoning")
    ) {
      return;
    }
    partTexts.set(partId, `${partTexts.get(partId) ?? ""}${delta}`);
    trajectoryWriter.emit(
      normalizeOpenCodeTrajectoryEvent(
        {
          properties: {
            part: { id: partId, text: delta, type: partType },
            sessionID: activeSessionId,
            time: properties.time,
          },
          type: "message.part.updated",
        },
        activeSessionId,
      ),
    );
    return;
  }
  if (event.type === "message.part.updated") {
    const part = record(properties.part);
    const partId = stringField(part, "id");
    const partType = stringField(part, "type");
    // Assistant-owned only: the identity filter has already dropped user parts.
    usageWriter.emit(openCodeStepFinishUsage(part));
    usageWriter.emit(openCodeStepFinishCost(part));
    if (partId !== undefined && partType !== undefined) {
      partTypes.set(partId, partType);
    }
    if (
      partId !== undefined &&
      (partType === "text" || partType === "reasoning")
    ) {
      const text = stringField(part, "text") ?? "";
      const previous = partTexts.get(partId) ?? "";
      const delta = text.startsWith(previous)
        ? text.slice(previous.length)
        : previous.startsWith(text)
          ? ""
          : text;
      partTexts.set(partId, text);
      if (delta === "") return;
      event = {
        ...event,
        properties: { ...properties, part: { ...part, text: delta } },
      };
    } else if (partType === "tool") {
      const state = record(part.state);
      const status = stringField(state, "status");
      const callId = stringField(part, "callID") ?? partId;
      if (callId === undefined || status === undefined) return;
      // A pending part contains no finalized input. Publish the running part
      // instead so the one tool-start fact retains commands and file paths.
      if (status === "pending") return;
      const previous = toolStates.get(callId);
      if (previous === status) return;
      if (status === "running" && previous !== undefined) {
        toolStates.set(callId, status);
        return;
      }
      toolStates.set(callId, status);
      observedToolActivity = true;
    }
  }
  trajectoryWriter.emit(
    normalizeOpenCodeTrajectoryEvent(event, activeSessionId),
  );
}

async function createSession() {
  const created = await requestJson("/session", {
    body: JSON.stringify({
      permission: OPENCODE_SESSION_PERMISSION,
      title: "RAH OS Agent Activation",
    }),
    method: "POST",
  });
  const sessionId = stringField(created, "id");
  if (sessionId === undefined) {
    throw new Error("OpenCode session/create returned no id");
  }
  return sessionId;
}

async function submitPrompt(resumed) {
  if (activeSessionId === undefined) {
    throw new Error("OpenCode prompt has no active session");
  }
  const sessionId = activeSessionId;
  const messageId = openCodeMessageId();
  activePrompt = {
    deliveryReported: false,
    finalInterrupt: createOpenCodeFinalInterrupt({
      interrupt: async () =>
        await requestJson(`/session/${encodeURIComponent(sessionId)}/abort`, {
          body: "{}",
          method: "POST",
        }),
      inFlightTools: async () =>
        runToolParts(
          trustedMessageList(
            await requestJson(
              `/session/${encodeURIComponent(sessionId)}/message?limit=${RECENT_MESSAGE_LIMIT}`,
            ),
          ),
          messageId,
        ).filter((part) => !toolPartSettled(part)),
    }),
    messageId,
    observed: false,
    sessionId,
  };
  // The standing rules are the server's `instructions` (system layer of
  // every request); no per-message `system`, which compaction's synthetic
  // continue step would drop.
  const body = {
    messageID: messageId,
    parts: [
      {
        text: TURN_INPUT,
        type: "text",
      },
    ],
  };
  if (options.model !== undefined) body.model = parseModel(options.model);
  if (options.variant !== undefined) body.variant = options.variant;
  return await requestJson(
    `/session/${encodeURIComponent(activeSessionId)}/message`,
    { body: JSON.stringify(body), method: "POST" },
    0,
  );
}

function assertCompletedAssistantResponse(response) {
  if (!isRecord(response) || !isRecord(response.info)) {
    throw new Error("OpenCode prompt returned no assistant response");
  }
  if (response.info.role !== "assistant") {
    throw new Error("OpenCode prompt returned a non-assistant response");
  }
  if (response.info.error !== undefined) {
    throw new Error(openCodeMessageError(response.info.error));
  }
  if (!Array.isArray(response.parts)) {
    throw new Error("OpenCode prompt returned no parts array");
  }
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
    if (!response.ok) {
      throw new HttpError(
        path,
        response.status,
        await safeResponseText(response),
      );
    }
    if (response.status === 204) return undefined;
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function openCodeFetch(path, init = {}, longPrompt = false) {
  if (server === undefined) throw new Error("OpenCode server is not running");
  const url = new URL(path, server.baseUrl);
  if (!url.searchParams.has("directory")) {
    url.searchParams.set("directory", process.cwd());
  }
  const headers = new Headers(init.headers);
  if (server.authHeader !== undefined && !headers.has("Authorization")) {
    headers.set("Authorization", server.authHeader);
  }
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
        if (isRecord(address) && typeof address.port === "number") {
          resolve(address.port);
        } else {
          reject(new Error("failed to allocate an OpenCode server port"));
        }
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

function resetTurnProjection() {
  partTypes.clear();
  partTexts.clear();
  toolStates.clear();
  observedToolActivity = false;
}

function prepareIdleSettlement() {
  idleSettlement = new Promise((resolve) => {
    resolveIdle = resolve;
  });
}

async function waitForIdleEvidence() {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error("OpenCode prompt completed without session.idle evidence"),
        ),
      TERMINAL_EVENT_TIMEOUT_MS,
    );
    timer.unref?.();
  });
  try {
    await Promise.race([idleSettlement, eventFailure, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function parseModel(value) {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error("OpenCode model must use provider/model");
  }
  return {
    modelID: value.slice(separator + 1),
    providerID: value.slice(0, separator),
  };
}

function openCodeMessageError(value) {
  const error = record(value);
  const data = record(error.data);
  return (
    stringField(data, "message") ??
    stringField(error, "message") ??
    stringField(error, "name") ??
    "OpenCode assistant response failed"
  );
}

function redactProviderSessionIds(message) {
  let redacted = message;
  for (const sessionId of [options.resumeSession, activeSessionId]) {
    if (typeof sessionId === "string" && sessionId !== "") {
      redacted = redacted.split(sessionId).join("[provider-session]");
    }
  }
  return redacted;
}

function writeProviderSessionEvidence(providerSessionId) {
  if (boundProviderSessionId === providerSessionId) return;
  boundProviderSessionId = providerSessionId;
  try {
    writeSync(
      3,
      `${JSON.stringify({
        protocol: "rah-provider-session/v1",
        provider: "opencode-server/v1",
        providerSessionId,
        state: "ready",
      })}\n`,
    );
  } catch {
    process.stderr.write(
      "[rah-os opencode-server] Provider session evidence was not persisted\n",
    );
  }
}

function parseArguments(args) {
  const parsed = {
    executable: undefined,
    model: undefined,
    prompt: undefined,
    resumeSession: undefined,
    toolAccessMode: undefined,
    variant: undefined,
    wakeInput: undefined,
  };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    if (flag === "--executable") parsed.executable = value;
    else if (flag === "--model") parsed.model = value;
    else if (flag === "--prompt") parsed.prompt = value;
    else if (flag === "--resume-session") parsed.resumeSession = value;
    else if (flag === "--tool-access-mode") parsed.toolAccessMode = value;
    else if (flag === "--variant") parsed.variant = value;
    else if (flag === "--wake-input-file")
      parsed.wakeInput = readProviderPromptFile(value);
    else throw new Error(`unknown OpenCode driver argument: ${flag}`);
  }
  for (const field of ["executable", "prompt", "toolAccessMode"]) {
    if (typeof parsed[field] !== "string" || parsed[field].trim() === "") {
      throw new Error(
        `--${field.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)} is required`,
      );
    }
  }
  if (parsed.toolAccessMode !== "full_access") {
    throw new Error(
      "opencode-server/v1 requires full_access for the standard Raft policy",
    );
  }
  for (const field of ["resumeSession", "model", "variant"]) {
    const value = parsed[field];
    if (
      value !== undefined &&
      (value.trim() === "" ||
        value.length > 4_096 ||
        /[\u0000-\u001f\u007f]/u.test(value))
    ) {
      throw new Error(`--${field} is invalid`);
    }
  }
  return parsed;
}

function driverArguments(args) {
  return args[0] === "__opencode-server-driver" ? args.slice(1) : args;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
