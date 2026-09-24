import { providerLaunchArguments } from "./provider-launch-arguments.js";
import {
  assertSessionReplacementAllowed,
  providerActivationInput,
} from "./provider-activation-input.js";
import { spawn } from "node:child_process";
import { writeSync } from "node:fs";
import { createServer } from "node:net";
import { fetchOpenCodePrompt } from "./opencode-prompt-transport.mjs";
import {
  OpenCodeEventIdentityFilter,
  scopedOpenCodeEvent,
} from "./opencode-event-identity.js";

import {
  normalizeOpenCodeTrajectoryEvent,
  RuntimeTrajectoryWriter,
  runtimeStatusTrajectory,
} from "./provider-trajectory-normalizer.js";
import {
  openCodeStepFinishUsage,
  ProviderUsageWriter,
} from "./provider-usage.js";

const STARTUP_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 2_000;
const ABORT_CONFIRM_TIMEOUT_MS = 750;
const SERVER_TERM_TIMEOUT_MS = 300;
const TERMINAL_EVENT_TIMEOUT_MS = 5_000;
const MAX_SERVER_OUTPUT_BYTES = 64 * 1024;
const MAX_SSE_BUFFER_BYTES = 1024 * 1024;

class HttpError extends Error {
  constructor(path, status, body) {
    super(
      `OpenCode API ${path} failed with HTTP ${status}${body === "" ? "" : `: ${body}`}`,
    );
    this.path = path;
    this.status = status;
  }
}

const options = parseArguments(driverArguments(process.argv.slice(2)));
const trajectoryWriter = new RuntimeTrajectoryWriter();
const usageWriter = new ProviderUsageWriter();
const eventIdentity = new OpenCodeEventIdentityFilter();
const partTypes = new Map();
const partTexts = new Map();
const toolStates = new Map();
let server;
let activeSessionId;
let eventController;
let eventFailureReject;
let stopping = false;
let cancelRequested = false;
let promptSettlement;
let idleSettlement;
let resolveIdle;
let observedToolActivity = false;
let serverOutputTail = Buffer.alloc(0);

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
  assertCompletedAssistantResponse(response);
  await waitForIdleEvidence();
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
}

async function startServer() {
  const port = await allocatePort();
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
      env: process.env,
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
      return handle;
    } catch (error) {
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
  event = scopedOpenCodeEvent(event, activeSessionId);
  if (!event) return;
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
    await requestJson(`/permission/${encodeURIComponent(requestId)}/reply`, {
      body: JSON.stringify({ reply: cancelRequested ? "reject" : "always" }),
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
    trajectoryWriter.emit(
      normalizeOpenCodeTrajectoryEvent(event, activeSessionId),
    );
    if (!(stopping && providerError.includes("MessageAbortedError"))) {
      throw new Error(providerError);
    }
    return;
  }
  projectEvent(event);
  if (event.type === "session.idle") resolveIdle?.();
}

function projectEvent(event) {
  for (const accepted of eventIdentity.accept(event, activeSessionId)) {
    projectIdentifiedEvent(accepted);
  }
}

function projectIdentifiedEvent(event) {
  const properties = record(event.properties);
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
      permission: [{ action: "allow", pattern: "*", permission: "*" }],
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
  const body = {
    parts: [
      {
        text: providerActivationInput(),
        type: "text",
      },
    ],
    system: options.prompt,
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

function serverAuthHeader() {
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  if (password === undefined || password === "") return undefined;
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
}

function rememberServerOutput(chunk) {
  const next = Buffer.concat([serverOutputTail, Buffer.from(chunk)]);
  serverOutputTail =
    next.byteLength <= MAX_SERVER_OUTPUT_BYTES
      ? next
      : next.subarray(next.byteLength - MAX_SERVER_OUTPUT_BYTES);
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

function extractSseData(buffer) {
  const normalized = buffer.replaceAll("\r\n", "\n");
  const blocks = normalized.split("\n\n");
  const remainder = blocks.pop() ?? "";
  const items = blocks
    .map((block) =>
      block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim(),
    )
    .filter((value) => value !== "");
  return { items, remainder };
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

function openCodeEventError(properties) {
  const error = record(properties.error);
  const data = record(error.data);
  return (
    [
      stringField(error, "name"),
      stringField(data, "message"),
      stringField(error, "message"),
    ]
      .filter((value) => value !== undefined)
      .join(": ") || "OpenCode session error"
  );
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

async function safeResponseText(response) {
  return (await response.text().catch(() => "")).slice(0, 2_048);
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

function stringField(value, name) {
  return isRecord(value) &&
    typeof value[name] === "string" &&
    value[name] !== ""
    ? value[name]
    : undefined;
}

function record(value) {
  return isRecord(value) ? value : {};
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
