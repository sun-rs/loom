import { readProviderPromptFile } from "./provider-prompt-file.js";
import {
  providerLaunchArguments,
  providerLaunchPolicy,
  providerMemoryConfig as memoryConfig,
} from "./provider-launch-arguments.js";
import { attachCodexBusyInput } from "./codex-busy-input.js";
import { createCodexFinalInterrupt } from "./codex-final-interrupt.js";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { writeSync } from "node:fs";
import { createInterface } from "node:readline";

import {
  CodexApprovalPolicyError,
  CodexUnattendedApprovalPolicy,
} from "./codex-unattended-approval.js";
import {
  normalizeCodexTrajectoryNotification,
  RuntimeTrajectoryWriter,
  runtimeStatusTrajectory,
} from "./provider-trajectory-normalizer.js";
import {
  CodexTokenUsageTracker,
  ProviderUsageWriter,
} from "./provider-usage.js";

const HANDSHAKE_TIMEOUT_MS = 30_000;
const INTERRUPT_CONFIRM_TIMEOUT_MS = 600;
const INTERRUPT_EXIT_TIMEOUT_MS = 150;
const PROVIDER_TERM_TIMEOUT_MS = 150;
const FINAL_INTERRUPT_TIMEOUT_MS = 5_000;

// RAH policy; Multica uses the same three switches. No user config writes.
const providerMemoryConfig = memoryConfig("codex");

const options = parseArguments(driverArguments(process.argv.slice(2)));
const codex = spawn(
  options.executable,
  [
    ...providerLaunchArguments("codex"),
    ...options.codexConfigArgs,
    ...providerLaunchPolicy("codex").args,
    "--listen",
    "stdio://",
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  },
);
codex.stderr.pipe(process.stderr);

const pending = new Map();
const approvalPolicy = new CodexUnattendedApprovalPolicy();
const trajectoryWriter = new RuntimeTrajectoryWriter();
const usageWriter = new ProviderUsageWriter();
let usageTracker;
let requestSequence = 0;
let activeThreadId;
let activeTurnId;
let startingTurn = false;
let earlyStartedTurnId;
let driverCompleted = false;
let stopping = false;
let terminationPromise;
// Final-reply turn end: the Host's signal that a `final` post committed.
const finalInterrupt = createCodexFinalInterrupt({
  interrupt: () =>
    request(
      "turn/interrupt",
      { threadId: activeThreadId, turnId: activeTurnId },
      FINAL_INTERRUPT_TIMEOUT_MS,
    ),
});
const busyInput = attachCodexBusyInput({
  input: process.stdin,
  state: () => ({
    threadId: activeThreadId,
    turnId: activeTurnId,
    // An armed turn is ending: busy input waits for the follow-up Activation.
    stopping: stopping || driverCompleted || finalInterrupt.armed,
  }),
  request,
  control: armFinalInterrupt,
});
let resolveProcessExit;
const processExited = new Promise((resolve) => {
  resolveProcessExit = resolve;
});
let resolveTurnCompletion;
let rejectTurnCompletion;
const turnCompleted = new Promise((resolve, reject) => {
  resolveTurnCompletion = resolve;
  rejectTurnCompletion = reject;
});

codex.once("error", (error) => {
  failPending(error);
  rejectTurnCompletion(error);
});
codex.once("close", (code, signal) => {
  const result = { code, signal };
  if (!driverCompleted) {
    const error = new Error(
      `codex app-server exited before the driver completed (code=${String(code)}, signal=${String(signal)})`,
    );
    failPending(error);
    rejectTurnCompletion(error);
  }
  resolveProcessExit(result);
});

const lines = createInterface({ input: codex.stdout });
lines.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed === "") return;
  let frame;
  try {
    frame = JSON.parse(trimmed);
  } catch {
    process.stderr.write(
      "[rah-os codex-app-server] ignored non-JSON stdout frame\n",
    );
    return;
  }
  void handleFrame(frame).catch((error) => {
    process.stderr.write(`[rah-os codex-app-server] ${errorMessage(error)}\n`);
  });
});

process.once("SIGTERM", () => void terminate("SIGTERM"));
process.once("SIGINT", () => void terminate("SIGINT"));

try {
  trajectoryWriter.emit(
    runtimeStatusTrajectory(
      "working",
      "starting",
      "正在启动 Codex Runtime",
      "codex:driver:starting",
    ),
  );
  const initialized = await request(
    "initialize",
    {
      capabilities: { experimentalApi: true },
      clientInfo: {
        name: "rah-os-codex-app-server",
        title: "RAH OS",
        version: "1.0.0",
      },
    },
    HANDSHAKE_TIMEOUT_MS,
  );
  if (stringField(initialized, "userAgent") === undefined) {
    throw new Error("initialize returned no userAgent");
  }
  notify("initialized", {});

  const threadStart = {
    config: { ...providerMemoryConfig },
    approvalPolicy: "never",
    cwd: process.cwd(),
    developerInstructions: options.prompt,
    experimentalRawEvents: true,
    sandbox: sandboxMode(options.toolAccessMode),
  };
  if (options.model !== undefined) threadStart.model = options.model;
  if (options.reasoning !== undefined) {
    threadStart.config.model_reasoning_effort = options.reasoning;
  }
  let resumeRecovery;
  let startedThread;
  if (options.resumeSession === undefined) {
    startedThread = await request(
      "thread/start",
      threadStart,
      HANDSHAKE_TIMEOUT_MS,
    );
  } else {
    try {
      startedThread = await request(
        "thread/resume",
        { threadId: options.resumeSession, ...threadStart },
        HANDSHAKE_TIMEOUT_MS,
      );
    } catch (error) {
      resumeRecovery = classifyCodexResumeError(errorMessage(error));
      if (resumeRecovery === undefined) throw error;
      assertSessionReplacementAllowed();
      trajectoryWriter.emit(
        runtimeStatusTrajectory(
          "working",
          "other",
          resumeRecovery === "thread_writer_busy"
            ? "此前 Codex 会话已有活动写入者，已自动启用新会话"
            : "此前 Codex 会话无法恢复，已自动启用新会话",
          `codex:resume:${resumeRecovery}`,
        ),
      );
      startedThread = await request(
        "thread/start",
        threadStart,
        HANDSHAKE_TIMEOUT_MS,
      );
    }
  }
  activeThreadId = nestedStringField(startedThread, "thread", "id");
  if (activeThreadId === undefined) {
    throw new Error("Codex thread request returned no thread.id");
  }
  usageTracker = new CodexTokenUsageTracker({
    freshThread:
      options.resumeSession === undefined || resumeRecovery !== undefined,
  });

  const turnStart = {
    input: [
      {
        text:
          (resumeRecovery === undefined
            ? ""
            : "The previous Provider thread was not recovered. Use canonical Room history and workspace memory as the recovery point.\n") +
          // S1-d: the Host-prepared wake file when present, verbatim (the
          // Host already appended the S2-0 notice line, so the digest below
          // covers it); otherwise the fixed startup wake plus the env notice.
          // The driver never composes Room content itself.
          (options.wakeInput === undefined
            ? providerActivationInput()
            : options.wakeInput),
        type: "text",
      },
    ],
    threadId: activeThreadId,
  };
  if (options.reasoning !== undefined) turnStart.effort = options.reasoning;
  startingTurn = true;
  const startedTurn = await request(
    "turn/start",
    turnStart,
    HANDSHAKE_TIMEOUT_MS,
  );
  activeTurnId = nestedStringField(startedTurn, "turn", "id");
  if (activeTurnId === undefined) {
    throw new Error("turn/start returned no turn.id");
  }
  // ACCEPTANCE SIGNAL (Codex only). The JSON-RPC *response* to the very
  // `turn/start` request that carried this wake text, correlated two ways: the
  // request id is matched by `pending` before `requestState.resolve` runs
  // (`handleFrame`), and `turnStart.threadId === activeThreadId` was verified
  // from `thread/start`/`thread/resume`. `result.turn.id` is the turn the
  // input now belongs to, so this is an acknowledgement of THIS injection and
  // not merely "the process is alive". It is emitted only here: a stdin write
  // returning, or the process starting, never reaches this line.
  // Digest scope: the Host-prepared wake file verbatim, which is the whole
  // turn input (bodied or startup wake plus the notice line) except the
  // fixed recovery line this driver prepends on a replaced session; the Host
  // then fails to match and registers nothing. The Host decides what a match
  // proves: a presented window (bodied wake) and/or the notice line.
  if (options.wakeInput !== undefined)
    writeDeliveryAcceptance(
      activeThreadId,
      activeTurnId,
      createHash("sha256").update(options.wakeInput, "utf8").digest("hex"),
    );

  const completedTurn = await turnCompleted;
  if (
    completedTurn.threadId !== activeThreadId ||
    completedTurn.turnId !== activeTurnId
  ) {
    throw new Error("turn/completed identity did not match the started turn");
  }
  const interruptedByHost = stopping && completedTurn.status === "interrupted";
  const finalReport = finalInterrupt.armed
    ? await finalInterrupt.report()
    : undefined;
  // The Host ended this turn after the final reply committed: the reply is
  // done, so the interrupted turn is a success (never a cancellation).
  const endedAfterFinalReply =
    !stopping &&
    finalInterrupt.issued &&
    completedTurn.status === "interrupted";
  if (
    completedTurn.status !== "completed" &&
    !interruptedByHost &&
    !endedAfterFinalReply
  ) {
    throw new Error(
      `Codex turn ended with status ${completedTurn.status}${completedTurn.errorMessage ? `: ${completedTurn.errorMessage}` : ""}`,
    );
  }
  if (!stopping) writeProviderSessionEvidence(activeThreadId);
  if (finalReport !== undefined) writeFinalInterruptReport(finalReport);

  driverCompleted = true;
  busyInput.close();
  codex.stdin.end();
  const graceful = await Promise.race([
    processExited.then(() => true),
    delay(stopping ? INTERRUPT_EXIT_TIMEOUT_MS : 500).then(() => false),
  ]);
  if (!graceful && codex.exitCode === null && codex.signalCode === null) {
    codex.kill("SIGTERM");
    const terminated = await Promise.race([
      processExited.then(() => true),
      delay(PROVIDER_TERM_TIMEOUT_MS).then(() => false),
    ]);
    if (!terminated && codex.exitCode === null && codex.signalCode === null) {
      codex.kill("SIGKILL");
      await Promise.race([processExited, delay(PROVIDER_TERM_TIMEOUT_MS)]);
    }
  }
} catch (error) {
  const interruptedByHost = stopping;
  if (!interruptedByHost) {
    trajectoryWriter.emit(
      runtimeStatusTrajectory(
        "error",
        "runtime_error",
        errorMessage(error),
        "codex:driver:error",
      ),
    );
    process.stderr.write(`[rah-os codex-app-server] ${errorMessage(error)}\n`);
  }
  await terminate("SIGTERM");
  await Promise.race([processExited, delay(1_000)]);
  process.exitCode = interruptedByHost ? 0 : 1;
}

async function handleFrame(frame) {
  if (!isRecord(frame)) return;
  if (Object.hasOwn(frame, "id") && Object.hasOwn(frame, "method")) {
    handleServerRequest(frame);
    return;
  }
  if (Object.hasOwn(frame, "id")) {
    handleResponse(frame);
    return;
  }
  handleNotification(frame);
}

function handleResponse(frame) {
  const key = String(frame.id);
  const requestState = pending.get(key);
  if (requestState === undefined) return;
  pending.delete(key);
  clearTimeout(requestState.timer);
  if (requestState.method === "turn/start") startingTurn = false;
  if (isRecord(frame.error)) {
    requestState.reject(
      Object.assign(
        new Error(
          `${requestState.method}: ${String(frame.error.message ?? "app-server error")} (code=${String(frame.error.code ?? "unknown")})`,
        ),
        { providerRejected: true },
      ),
    );
  } else {
    if (requestState.method === "thread/start") {
      activeThreadId = nestedStringField(frame.result, "thread", "id");
    } else if (requestState.method === "turn/start") {
      activeTurnId = nestedStringField(frame.result, "turn", "id");
      // An early event is only readiness evidence after the actual RPC result
      // confirms exactly the same turn in the already verified thread.
      if (activeTurnId !== undefined && earlyStartedTurnId === activeTurnId) {
        busyInput.observe({ method: "turn/started" });
      }
      earlyStartedTurnId = undefined;
    }
    requestState.resolve(frame.result);
  }
}

function handleNotification(frame) {
  if (
    startingTurn &&
    activeTurnId === undefined &&
    frame.method === "turn/started" &&
    stringField(frame.params, "threadId") === activeThreadId &&
    activeThreadId !== undefined
  ) {
    earlyStartedTurnId = nestedStringField(frame.params, "turn", "id");
    return;
  }
  if (!isRecord(frame.params) || !belongsToActiveCodexTurn(frame)) return;
  busyInput.observe(frame);
  finalInterrupt.observe(frame);
  trajectoryWriter.emit(normalizeCodexTrajectoryNotification(frame));
  usageWriter.emit(usageTracker?.observe(frame));
  if (frame.method !== "turn/completed") return;
  const threadId = stringField(frame.params, "threadId");
  const turn = recordField(frame.params, "turn");
  const turnId = stringField(turn, "id");
  const status = stringField(turn, "status");
  if (threadId === undefined || turnId === undefined || status === undefined) {
    rejectTurnCompletion(
      new Error("turn/completed is missing identity or status"),
    );
    return;
  }
  const errorMessage = stringField(recordField(turn, "error"), "message");
  resolveTurnCompletion({
    status,
    threadId,
    turnId,
    errorMessage: errorMessage?.slice(0, 2048),
  });
}

/**
 * Host frame `{protocol:"rah-final-reply/v1", runAttemptId, turnId?}`: a
 * `final` post of this RunAttempt committed. Only this process's own
 * RunAttempt and its own active turn are ever interrupted.
 */
function armFinalInterrupt(frame) {
  if (
    stopping ||
    driverCompleted ||
    activeThreadId === undefined ||
    activeTurnId === undefined ||
    typeof frame.runAttemptId !== "string" ||
    (process.env.RAH_RUN_ATTEMPT_ID !== undefined &&
      frame.runAttemptId !== process.env.RAH_RUN_ATTEMPT_ID) ||
    (frame.turnId !== undefined && frame.turnId !== activeTurnId)
  )
    return;
  finalInterrupt.arm();
}

function belongsToActiveCodexTurn(frame) {
  const params = recordField(frame, "params");
  const threadId = stringField(params, "threadId");
  const turn = recordField(params, "turn");
  const turnId = stringField(params, "turnId") ?? stringField(turn, "id");
  if (threadId !== undefined && threadId !== activeThreadId) return false;
  if (turnId !== undefined && turnId !== activeTurnId) return false;
  return threadId !== undefined || turnId !== undefined;
}

function handleServerRequest(frame) {
  try {
    const decision = approvalPolicy.decide(
      frame,
      {
        threadId: activeThreadId,
        turnId: activeTurnId,
      },
      stopping,
    );
    if (decision.duplicate) return;
    writeFrame({ id: frame.id, jsonrpc: "2.0", result: decision.result });
  } catch (error) {
    const rpcError =
      error instanceof CodexApprovalPolicyError
        ? error
        : new RpcError(-32602, errorMessage(error));
    writeFrame({
      error: { code: rpcError.code, message: rpcError.message },
      id: frame.id,
      jsonrpc: "2.0",
    });
  }
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
      writeFrame({ id, jsonrpc: "2.0", method, params });
    } catch (error) {
      pending.delete(String(id));
      clearTimeout(timer);
      reject(error);
    }
  });
}

function notify(method, params) {
  writeFrame({ jsonrpc: "2.0", method, params });
}

function writeFrame(frame) {
  if (!codex.stdin.writable) {
    throw new Error("codex app-server stdin is closed");
  }
  codex.stdin.write(`${JSON.stringify(frame)}\n`);
}

function failPending(error) {
  for (const state of pending.values()) {
    clearTimeout(state.timer);
    state.reject(error);
  }
  pending.clear();
}

function terminate(signal) {
  if (terminationPromise !== undefined) return terminationPromise;
  stopping = true;
  busyInput.close();
  terminationPromise = performTermination(signal);
  return terminationPromise;
}

async function performTermination(signal) {
  let nativeInterruptionConfirmed = false;
  if (
    activeThreadId !== undefined &&
    activeTurnId !== undefined &&
    codex.stdin.writable
  ) {
    try {
      void request(
        "turn/interrupt",
        { threadId: activeThreadId, turnId: activeTurnId },
        0,
      ).catch(() => undefined);
    } catch {
      // The outer process supervisor remains the terminal-proof fallback.
    }
    const completedTurn = await Promise.race([
      turnCompleted.catch(() => undefined),
      delay(INTERRUPT_CONFIRM_TIMEOUT_MS).then(() => undefined),
    ]);
    nativeInterruptionConfirmed =
      completedTurn?.threadId === activeThreadId &&
      completedTurn?.turnId === activeTurnId &&
      completedTurn?.status === "interrupted";
  }
  if (nativeInterruptionConfirmed) {
    await Promise.race([processExited, delay(INTERRUPT_EXIT_TIMEOUT_MS)]);
  }
  if (codex.exitCode === null && codex.signalCode === null) {
    codex.kill(signal);
    const terminated = await Promise.race([
      processExited.then(() => true),
      delay(PROVIDER_TERM_TIMEOUT_MS).then(() => false),
    ]);
    if (!terminated && codex.exitCode === null && codex.signalCode === null) {
      codex.kill("SIGKILL");
      await Promise.race([processExited, delay(PROVIDER_TERM_TIMEOUT_MS)]);
    }
  }
}

function sandboxMode(mode) {
  if (mode === "read_only") return "read-only";
  if (mode === "workspace_write") return "workspace-write";
  return "danger-full-access";
}

function parseArguments(args) {
  const parsed = { codexConfigArgs: [] };
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
    else if (name === "--wake-input-file")
      parsed.wakeInput = readProviderPromptFile(value);
    else if (name === "-c") parsed.codexConfigArgs.push(name, value);
    else throw new Error(`unsupported codex app-server driver option: ${name}`);
    index += 1;
  }
  if (typeof parsed.executable !== "string" || parsed.executable === "") {
    throw new Error("--executable is required");
  }
  if (typeof parsed.prompt !== "string" || parsed.prompt === "") {
    throw new Error("--prompt is required");
  }
  if (parsed.toolAccessMode !== "full_access") {
    throw new Error(
      "--tool-access-mode must be full_access for the standard Raft policy",
    );
  }
  if (
    parsed.resumeSession !== undefined &&
    (parsed.resumeSession.trim() === "" ||
      parsed.resumeSession.length > 4_096 ||
      /[\u0000-\u001f\u007f]/u.test(parsed.resumeSession))
  ) {
    throw new Error("--resume-session is invalid");
  }
  return parsed;
}

function classifyCodexResumeError(message) {
  if (
    /\bno\s+rollout\s+found\b/iu.test(message) ||
    /\bmissing\s+rollout\b/iu.test(message) ||
    /\brollout\b.*\b(not found|missing)\b/iu.test(message) ||
    /\bthread\b.*\b(not found|missing)\b/iu.test(message) ||
    /\bmissing\s+thread\b/iu.test(message)
  ) {
    return "missing_rollout";
  }
  if (
    /\bthread\b.*\balready\s+has\s+an\s+active\s+writer\b/iu.test(message) ||
    /\balready\s+has\s+an\s+active\s+writer\b/iu.test(message)
  ) {
    return "thread_writer_busy";
  }
  return undefined;
}

/**
 * Host-private frame on the same fd3 transport as the Provider session
 * evidence, intercepted before canonical trajectory parsing so a runtime turn
 * id never becomes Room or UI truth. The Host turns it into a Host-credential
 * `delivery.presented.sent`; the driver itself has no Kernel authority.
 */
function writeDeliveryAcceptance(threadId, turnId, inputSha256) {
  try {
    writeSync(
      3,
      `${JSON.stringify({
        protocol: "rah-delivery-accepted/v1",
        provider: "codex-app-server/v1",
        signal: "turn/start.response",
        threadId,
        turnId,
        inputSha256,
      })}\n`,
    );
  } catch {
    // A missing fd3 means no Host is listening; the Activation then simply
    // never registers a send and falls back to the explicit message-check.
  }
}

/** Host-private: whether the final-reply interrupt landed and beat the follow-up. */
function writeFinalInterruptReport(report) {
  try {
    writeSync(
      3,
      `${JSON.stringify({ protocol: "rah-final-interrupt/v1", ...report })}\n`,
    );
  } catch {
    // No Host listening: the usage read shows the interrupt as unreported.
  }
}

function writeProviderSessionEvidence(providerSessionId) {
  try {
    writeSync(
      3,
      `${JSON.stringify({
        protocol: "rah-provider-session/v1",
        provider: "codex-app-server/v1",
        providerSessionId,
        state: "ready",
      })}\n`,
    );
  } catch {
    process.stderr.write(
      "[rah-os codex-app-server] Provider session evidence was not persisted\n",
    );
  }
}

function driverArguments(args) {
  return args[0] === "__codex-app-server-driver" ? args.slice(1) : args;
}

function nestedStringField(value, recordName, fieldName) {
  return stringField(recordField(value, recordName), fieldName);
}

function recordField(value, name) {
  return isRecord(value) && isRecord(value[name]) ? value[name] : {};
}

function stringField(value, name) {
  return isRecord(value) && typeof value[name] === "string"
    ? value[name]
    : undefined;
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

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
import {
  assertSessionReplacementAllowed,
  providerActivationInput,
} from "./provider-activation-input.js";
