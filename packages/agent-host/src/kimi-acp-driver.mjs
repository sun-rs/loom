import {
  parseAttachedDirectory,
  writeKimiWorkspaceConfig,
} from "./channel-attached-directories.js";
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
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

import {
  isKimiTurnModelUpdate,
  kimiCompactionCompleted,
} from "./kimi-acp-events.js";
import { createKimiFinalInterrupt } from "./kimi-final-interrupt.js";
import {
  assertKimiResumeSafe,
  assertKimiSafeMode,
  inspectKimiSession,
  isKimiGoalMutationTool,
  KIMI_SAFE_MODE_ID,
  kimiModeFailure,
} from "./kimi-native-autonomy.js";
import { readProviderPromptFile } from "./provider-prompt-file.js";
import { providerUsageGap, ProviderUsageWriter } from "./provider-usage.js";
import {
  kimiPromptCompletionTrajectory,
  normalizeKimiTrajectoryNotification,
  RuntimeTrajectoryWriter,
  runtimeStatusTrajectory,
} from "./provider-trajectory-normalizer.js";

const HANDSHAKE_TIMEOUT_MS = 30_000;
// Model/thinking/mode control requests answer in milliseconds on kimi-code
// 0.39.1 (in-process state changes); a hung one must fail well before the
// Host's runtime start deadline instead of consuming it.
const CONTROL_REQUEST_TIMEOUT_MS = 5_000;
const CANCEL_CONFIRM_TIMEOUT_MS = 600;
const CANCEL_EXIT_TIMEOUT_MS = 150;
const PROVIDER_TERM_TIMEOUT_MS = 150;
const MAX_MCP_CONFIG_BYTES = 256 * 1024;
const MAX_TERMINAL_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_TERMINAL_OUTPUT_BYTES = 50_000;

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class AcpRpcError extends Error {
  constructor(method, code, providerMessage, data) {
    super(
      `${method}: ${providerMessage} (code=${String(code ?? "unknown")})${data === undefined ? "" : ` data=${jsonText(data)}`}`,
    );
    this.code = code;
    this.data = data;
    this.providerMessage = providerMessage;
  }
}

const PROVIDER = "kimi-acp/v1";

const options = parseArguments(driverArguments(process.argv.slice(2)));
// S2-c2: the Host-prepared wake file verbatim when present (the Host already
// appended the notice lines and any rules card, so the acceptance digest
// covers them); otherwise the fixed startup wake plus the env notices.
const TURN_INPUT = options.wakeInput ?? providerActivationInput();
const promptDirectory = mkdtempSync(join(tmpdir(), "rah-os-kimi-prompt-"));
chmodSync(promptDirectory, 0o700);
const promptPath = join(promptDirectory, "standing-instructions.md");
writeFileSync(promptPath, options.prompt, { mode: 0o600 });
const terminals = new Map();
const trajectoryWriter = new RuntimeTrajectoryWriter();
let terminalSequence = 0;
let stopping = false;
let usageGapReported = false;
// The native session this run already reported as bound (reported once).
let boundProviderSessionId;
let activeSessionId;
let acceptCurrentTurnUpdates = false;
let observedToolActivity = false;
let cancelRequested = false;
let activePromptSettlement;
// Per prompt: its identity, whether its acceptance was reported, and the
// final-reply cancel. Per process: the compaction ordinal.
let activePrompt;
let compactionOrdinal = 0;

// Process-only: no native cron turn outside this instance's lane.
const kimiEnvironment = {
  ...process.env,
  ...providerLaunchPolicy("kimi").environment,
};
// Owner 2026-09-26: the Channel's attached directories reach Kimi through its
// persistent project config, read at every process start (ACP
// additionalDirectories would be dropped on session/resume).
writeKimiWorkspaceConfig(process.cwd(), options.additionalDirectories);
const kimi = spawn(options.executable, providerLaunchArguments("kimi"), {
  cwd: process.cwd(),
  env: kimiEnvironment,
  shell: false,
  stdio: ["pipe", "pipe", "pipe"],
});
kimi.stderr.pipe(process.stderr);

const pending = new Map();
let requestSequence = 0;
let processExit;
const processExited = new Promise((resolve) => {
  processExit = resolve;
});

kimi.once("error", (error) => {
  failPending(error);
});
kimi.once("close", (code, signal) => {
  const error = new Error(
    `kimi acp exited before the driver completed (code=${String(code)}, signal=${String(signal)})`,
  );
  failPending(error);
  processExit({ code, signal });
});

const lines = createInterface({ input: kimi.stdout });
lines.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed === "") return;
  let frame;
  try {
    frame = JSON.parse(trimmed);
  } catch {
    process.stderr.write("[rah-os kimi-acp] ignored non-JSON stdout frame\n");
    return;
  }
  void handleFrame(frame).catch((error) => {
    process.stderr.write(`[rah-os kimi-acp] ${errorMessage(error)}\n`);
  });
});

const terminate = async (signal) => {
  if (stopping) return;
  stopping = true;
  const promptSettlement = activePromptSettlement;
  let nativeCancellationConfirmed = false;
  if (
    promptSettlement !== undefined &&
    acceptCurrentTurnUpdates &&
    activeSessionId !== undefined &&
    kimi.stdin.writable
  ) {
    cancelRequested = true;
    try {
      notify("session/cancel", { sessionId: activeSessionId });
    } catch {
      // The outer process supervisor remains the terminal-proof fallback.
    }
  }
  await stopTerminals();
  if (cancelRequested && promptSettlement !== undefined) {
    const promptResult = await Promise.race([
      promptSettlement,
      delay(CANCEL_CONFIRM_TIMEOUT_MS).then(() => undefined),
    ]);
    nativeCancellationConfirmed =
      stringField(promptResult, "stopReason") === "cancelled";
  }
  if (nativeCancellationConfirmed) {
    await Promise.race([processExited, delay(CANCEL_EXIT_TIMEOUT_MS)]);
  }
  if (kimi.exitCode === null && kimi.signalCode === null) {
    kimi.kill(signal);
    const terminated = await Promise.race([
      processExited.then(() => true),
      delay(PROVIDER_TERM_TIMEOUT_MS).then(() => false),
    ]);
    if (!terminated && kimi.exitCode === null && kimi.signalCode === null) {
      kimi.kill("SIGKILL");
      await Promise.race([processExited, delay(PROVIDER_TERM_TIMEOUT_MS)]);
    }
  }
};
process.once("SIGTERM", () => void terminate("SIGTERM"));
process.once("SIGINT", () => void terminate("SIGINT"));
// S2-c2: the Host's final-reply signal (`rah-final-reply/v1`) on the private
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
      "正在启动 Kimi Runtime",
      "kimi:driver:starting",
    ),
  );
  const initialize = await request(
    "initialize",
    {
      clientCapabilities: { terminal: true },
      clientInfo: { name: "rah-os-kimi-acp", version: "1.0.0" },
      protocolVersion: 1,
    },
    HANDSHAKE_TIMEOUT_MS,
  );
  const mcpServers = filterMcpServers(
    await loadMcpServers(options.mcpConfigFile),
    initialize,
  );
  let requestedResume = options.resumeSession;
  if (requestedResume !== undefined && !supportsSessionResume(initialize)) {
    assertSessionReplacementAllowed();
    requestedResume = undefined;
    trajectoryWriter.emit(
      runtimeStatusTrajectory(
        "working",
        "other",
        "当前 Kimi Runtime 不支持恢复，已自动启用新会话",
        "kimi:resume:unsupported",
      ),
    );
  }
  let turn;
  try {
    turn = await runTurn(requestedResume, mcpServers);
  } catch (error) {
    if (
      requestedResume === undefined ||
      observedToolActivity ||
      !isAcpSessionNotFound(error)
    ) {
      throw error;
    }
    assertSessionReplacementAllowed();
    acceptCurrentTurnUpdates = false;
    trajectoryWriter.emit(
      runtimeStatusTrajectory(
        "working",
        "other",
        "此前 Kimi 会话无法恢复，已自动启用新会话",
        "kimi:resume:session_not_found",
      ),
    );
    turn = await runTurn(undefined, mcpServers);
  }
  const { promptResult, sessionId, finalInterrupt } = turn;
  const stopReason = stringField(promptResult, "stopReason");
  // Ended by the Host after the final reply committed: the reply is done, so
  // the cancelled prompt is this run's success.
  const endedAfterFinalReply =
    !cancelRequested && finalInterrupt.issued && stopReason === "cancelled";
  trajectoryWriter.emit(
    endedAfterFinalReply
      ? runtimeStatusTrajectory(
          "online",
          "stopped",
          "工作轮次已完成",
          "kimi:prompt:final-reply-cancel",
        )
      : kimiPromptCompletionTrajectory(stopReason),
  );
  if (finalInterrupt.armed)
    writeHostFrame({
      protocol: "rah-final-interrupt/v1",
      ...finalInterrupt.report(),
    });
  if (!cancelRequested && (stopReason === "end_turn" || endedAfterFinalReply)) {
    writeProviderSessionEvidence(sessionId);
  } else if (!cancelRequested) {
    // A refusal, a length limit or a cancel nobody here asked for is not a
    // completed turn: never report it as success.
    throw new Error(
      `Kimi turn ended with stopReason ${stopReason ?? "unknown"}`,
    );
  }
  kimi.stdin.end();
  const graceful = await Promise.race([
    processExited.then(() => true),
    delay(500).then(() => false),
  ]);
  if (!graceful && kimi.exitCode === null && kimi.signalCode === null) {
    kimi.kill("SIGTERM");
    await processExited;
  }
  await cleanupTerminals();
} catch (error) {
  if (stopping) {
    await cleanupTerminals();
    await Promise.race([processExited, delay(1_000)]);
    process.exitCode = 0;
  } else {
    const safeError = redactProviderSessionIds(errorMessage(error));
    trajectoryWriter.emit(
      runtimeStatusTrajectory(
        "error",
        "runtime_error",
        safeError,
        "kimi:driver:error",
      ),
    );
    process.stderr.write(`[rah-os kimi-acp] ${safeError}\n`);
    await terminate("SIGTERM");
    await Promise.race([processExited, delay(1_000)]);
    process.exitCode = 1;
  }
} finally {
  rmSync(promptDirectory, { recursive: true, force: true });
  // The Host keeps the input pipe open; it must not keep this driver alive.
  hostInput.close();
  process.stdin.destroy();
}

async function runTurn(resumeSessionId, mcpServers) {
  acceptCurrentTurnUpdates = false;
  observedToolActivity = false;
  const method =
    resumeSessionId === undefined ? "session/new" : "session/resume";
  // Review P1-1: a persisted active native goal would drive turns outside
  // this lane; refuse before resuming (never a silent new session).
  if (resumeSessionId !== undefined)
    assertKimiResumeSafe(inspectKimiSession(resumeSessionId, kimiEnvironment));
  const established = await request(
    method,
    {
      cwd: process.cwd(),
      mcpServers,
      ...(resumeSessionId === undefined ? {} : { sessionId: resumeSessionId }),
    },
    HANDSHAKE_TIMEOUT_MS,
  );
  const sessionId = stringField(established, "sessionId") ?? resumeSessionId;
  if (sessionId === undefined) {
    throw new Error(`${method} returned no sessionId`);
  }
  activeSessionId = sessionId;
  await configureSession(sessionId);
  trajectoryWriter.emit(
    runtimeStatusTrajectory(
      "working",
      "model_request_started",
      "模型请求已开始",
      `kimi:prompt:started:${resumeSessionId === undefined ? "fresh" : "resumed"}`,
    ),
  );
  const prompt = {
    deliveryReported: false,
    finalInterrupt: createKimiFinalInterrupt({
      interrupt: () => notify("session/cancel", { sessionId }),
    }),
    requestId: undefined,
    sessionId,
  };
  activePrompt = prompt;
  acceptCurrentTurnUpdates = true;
  let settlePrompt;
  const promptSettlement = new Promise((resolve) => {
    settlePrompt = resolve;
  });
  activePromptSettlement = promptSettlement;
  try {
    const promptResult = await request(
      "session/prompt",
      {
        prompt: [
          {
            // Full review batch 3 P2-7: only a fresh session's first prompt
            // carries the rules and the Run-scoped file pointer; a resumed
            // wake is the body alone — after a compaction the Host's rules
            // card restates the rules (session-rules-card).
            text: [
              ...(resumeSessionId === undefined
                ? [
                    options.prompt,
                    `Current standing instructions file: ${JSON.stringify(promptPath)}. On a resumed session follow the previously delivered instructions; if compaction or context loss removed them, read this complete file before acting. It is scoped to this Run and contains no Worker credential.`,
                  ]
                : []),
              TURN_INPUT,
            ].join("\n\n"),
            type: "text",
          },
        ],
        sessionId,
      },
      0,
      (id) => {
        prompt.requestId = id;
      },
    );
    prompt.finalInterrupt.settle(stringField(promptResult, "stopReason"));
    settlePrompt(promptResult);
    return { finalInterrupt: prompt.finalInterrupt, promptResult, sessionId };
  } catch (error) {
    prompt.finalInterrupt.settle(undefined);
    settlePrompt(undefined);
    throw error;
  } finally {
    acceptCurrentTurnUpdates = false;
    if (activePrompt === prompt) activePrompt = undefined;
    if (activePromptSettlement === promptSettlement) {
      activePromptSettlement = undefined;
    }
  }
}

async function configureSession(sessionId) {
  if (options.model !== undefined) {
    await request(
      "session/set_model",
      { modelId: options.model, sessionId },
      CONTROL_REQUEST_TIMEOUT_MS,
    );
  }
  if (options.thinkingLevel !== undefined) {
    const configured = await request(
      "session/set_config_option",
      {
        configId: "thinking",
        sessionId,
        value: options.thinkingLevel,
      },
      CONTROL_REQUEST_TIMEOUT_MS,
    );
    const effective = configOptionValue(configured, "thinking");
    if (effective !== options.thinkingLevel) {
      throw new Error(
        `Kimi did not confirm thinking=${options.thinkingLevel} (effective=${effective ?? "unknown"})`,
      );
    }
  }
  // Review P1-1: `auto` (and `yolo`) approve native goal tools without
  // asking; pin this session to `default` (manual) so every goal mutation
  // reaches the permission answer below, and refuse an unconfirmed mode.
  let moded;
  try {
    moded = await request(
      "session/set_config_option",
      { configId: "mode", sessionId, value: KIMI_SAFE_MODE_ID },
      CONTROL_REQUEST_TIMEOUT_MS,
    );
  } catch (error) {
    throw kimiModeFailure(error);
  }
  assertKimiSafeMode(configOptionValue(moded, "mode"));
}

async function handleFrame(frame) {
  if (!isRecord(frame)) return;
  if (Object.hasOwn(frame, "id") && Object.hasOwn(frame, "method")) {
    await handleAgentRequest(frame);
    return;
  }
  if (!Object.hasOwn(frame, "id")) {
    if (!acceptCurrentTurnUpdates) return;
    if (isKimiToolActivity(frame)) observedToolActivity = true;
    observePromptUpdate(frame);
    trajectoryWriter.emit(
      normalizeKimiTrajectoryNotification(frame, activeSessionId),
    );
    return;
  }
  const key = String(frame.id);
  const requestState = pending.get(key);
  if (requestState === undefined) return;
  pending.delete(key);
  clearTimeout(requestState.timer);
  if (isRecord(frame.error)) {
    requestState.reject(
      new AcpRpcError(
        requestState.method,
        Number.isInteger(frame.error.code) ? frame.error.code : undefined,
        String(frame.error.message ?? "ACP error"),
        frame.error.data,
      ),
    );
  } else {
    if (requestState.method === "session/new") {
      activeSessionId = stringField(frame.result, "sessionId");
    }
    requestState.resolve(frame.result);
  }
}

async function handleAgentRequest(frame) {
  const method = String(frame.method);
  try {
    const requestSessionId = stringField(frame.params, "sessionId");
    if (
      !acceptCurrentTurnUpdates ||
      (requestSessionId !== undefined && requestSessionId !== activeSessionId)
    ) {
      throw new RpcError(
        -32602,
        "request does not belong to the active Kimi turn",
      );
    }
    let result;
    const turnCancelled =
      cancelRequested || activePrompt?.finalInterrupt.issued === true;
    if (method === "session/request_permission") {
      if (turnCancelled) {
        result = { outcome: { outcome: "cancelled" } };
      } else {
        // Full review batch 3 P1-6 / review P1-1: a native goal drives
        // continuation turns outside this instance's lane. In the pinned
        // `default` mode kimi-code asks for CreateGoal, UpdateGoal (resume)
        // and SetGoalBudget; all are rejected.
        const optionId = selectPermissionOption(
          frame.params,
          isNativeGoalMutation(frame.params)
            ? "reject"
            : options.toolAccessMode,
        );
        if (optionId === undefined) {
          throw new RpcError(
            -32603,
            "no safely selectable permission option offered",
          );
        }
        result = { outcome: { optionId, outcome: "selected" } };
      }
    } else if (method === "terminal/create") {
      if (turnCancelled) {
        throw new RpcError(-32800, "turn was cancelled");
      }
      observedToolActivity = true;
      result = createTerminal(frame.params);
    } else if (method === "terminal/output") {
      result = terminalOutput(frame.params);
    } else if (method === "terminal/wait_for_exit") {
      result = await terminalWait(frame.params);
    } else if (method === "terminal/kill") {
      result = await terminalKill(frame.params);
    } else if (method === "terminal/release") {
      result = await terminalRelease(frame.params);
    } else {
      throw new RpcError(-32601, `method not found: ${method}`);
    }
    writeFrame({ id: frame.id, jsonrpc: "2.0", result });
  } catch (error) {
    const rpcError =
      error instanceof RpcError
        ? error
        : new RpcError(-32602, errorMessage(error));
    writeFrame({
      error: { code: rpcError.code, message: rpcError.message },
      id: frame.id,
      jsonrpc: "2.0",
    });
  }
}

function request(method, params, timeoutMs, onId) {
  requestSequence += 1;
  const id = requestSequence;
  onId?.(id);
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

/**
 * One `session/update` of the in-flight prompt's session (kimi-code runs one
 * prompt at a time and dispatches model output only for that prompt's turn).
 */
function observePromptUpdate(frame) {
  const prompt = activePrompt;
  if (
    prompt === undefined ||
    frame.method !== "session/update" ||
    !isRecord(frame.params) ||
    frame.params.sessionId !== prompt.sessionId ||
    !isRecord(frame.params.update)
  )
    return;
  const update = frame.params.update;
  const compaction = kimiCompactionCompleted(update);
  if (compaction !== undefined) {
    // No compaction id exists on the wire: the Host keys it by this run and
    // the ordinal, and dedupes on that identity.
    compactionOrdinal += 1;
    writeHostFrame({
      protocol: "rah-provider-compaction/v1",
      provider: PROVIDER,
      providerSessionId: prompt.sessionId,
      ordinal: compactionOrdinal,
      ...compaction,
    });
  }
  if (
    !prompt.deliveryReported &&
    prompt.requestId !== undefined &&
    isKimiTurnModelUpdate(update)
  ) {
    prompt.deliveryReported = true;
    // Contract §3: the session now holds this input, so it is bound before
    // anything else (a later cancel, crash or error resumes it, never a
    // silently new session). Reported once; success reports it idempotently.
    writeProviderSessionEvidence(prompt.sessionId);
    // ACCEPTANCE SIGNAL: the first model update of the only prompt in flight,
    // which precedes any tool of this turn (so any post). Only a
    // Host-prepared wake is reported; its digest is what the Host prepared.
    if (options.wakeInput !== undefined)
      writeHostFrame({
        protocol: "rah-delivery-accepted/v1",
        provider: PROVIDER,
        signal: "acp-turn-update",
        threadId: prompt.sessionId,
        turnId: promptTurnId(prompt),
        inputSha256: createHash("sha256")
          .update(options.wakeInput, "utf8")
          .digest("hex"),
      });
  }
  prompt.finalInterrupt.observe(update);
}

function promptTurnId(prompt) {
  return `session/prompt#${String(prompt.requestId)}`;
}

/** The Host's signal: end THIS prompt at its next tool boundary. */
function armFinalReply(frame) {
  const prompt = activePrompt;
  if (
    prompt === undefined ||
    stopping ||
    cancelRequested ||
    typeof frame.runAttemptId !== "string" ||
    (process.env.RAH_RUN_ATTEMPT_ID !== undefined &&
      frame.runAttemptId !== process.env.RAH_RUN_ATTEMPT_ID) ||
    (frame.turnId !== undefined &&
      (prompt.requestId === undefined || frame.turnId !== promptTurnId(prompt)))
  )
    return;
  prompt.finalInterrupt.arm();
}

/** Host-private fd3 frame, intercepted before trajectory parsing. */
function writeHostFrame(frame) {
  try {
    writeSync(3, `${JSON.stringify(frame)}\n`);
  } catch {
    // No Host listening: nothing is registered.
  }
}

function notify(method, params) {
  writeFrame({ jsonrpc: "2.0", method, params });
}

function writeFrame(frame) {
  if (!kimi.stdin.writable) throw new Error("kimi acp stdin is closed");
  kimi.stdin.write(`${JSON.stringify(frame)}\n`);
}

function failPending(error) {
  for (const state of pending.values()) {
    clearTimeout(state.timer);
    state.reject(error);
  }
  pending.clear();
}

/** kimi-code 0.39.1 ACP: a permission's `toolCall.title` is the tool name. */
function isNativeGoalMutation(params) {
  return isRecord(params) && isRecord(params.toolCall)
    ? isKimiGoalMutationTool(params.toolCall.title)
    : false;
}

function selectPermissionOption(params, mode) {
  const optionsList =
    isRecord(params) && Array.isArray(params.options) ? params.options : [];
  const offered = optionsList.filter(isRecord);
  if (mode === "full_access") {
    for (const wanted of ["allow_session", "approve_for_session"]) {
      const match = offered.find(
        (entry) =>
          entry.optionId === wanted &&
          ["allow_once", "allow_always"].includes(normalizeKind(entry.kind)),
      );
      if (typeof match?.optionId === "string") return match.optionId;
    }
    const once = offered.find(
      (entry) =>
        typeof entry.optionId === "string" &&
        normalizeKind(entry.kind) === "allow_once",
    );
    if (typeof once?.optionId === "string") return once.optionId;
  }
  const reject = offered.find(
    (entry) =>
      typeof entry.optionId === "string" &&
      normalizeKind(entry.kind) === "reject_once",
  );
  return typeof reject?.optionId === "string" ? reject.optionId : undefined;
}

function createTerminal(params) {
  if (
    !isRecord(params) ||
    typeof params.command !== "string" ||
    params.command.trim() === ""
  ) {
    throw new Error("terminal/create requires command");
  }
  const args = Array.isArray(params.args)
    ? params.args.map((value) => {
        if (typeof value !== "string" || value.includes("\0"))
          throw new Error("terminal args must be strings");
        return value;
      })
    : undefined;
  const env = { ...process.env };
  if (Array.isArray(params.env)) {
    for (const entry of params.env) {
      if (
        !isRecord(entry) ||
        typeof entry.name !== "string" ||
        typeof entry.value !== "string"
      )
        continue;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(entry.name))
        throw new Error("terminal env name is invalid");
      // S2-0: the Host's leftover-process tags cannot be replaced.
      if (entry.name.startsWith("LOOM_")) continue;
      env[entry.name] = entry.value;
    }
  }
  const cwd =
    typeof params.cwd === "string" && params.cwd !== ""
      ? params.cwd
      : process.cwd();
  const command = args === undefined ? "/bin/sh" : params.command;
  const commandArgs = args === undefined ? ["-c", params.command] : args;
  const child = spawn(command, commandArgs, {
    cwd,
    env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  terminalSequence += 1;
  const terminalId = `rah-acp-terminal-${terminalSequence}`;
  const terminal = {
    child,
    done: undefined,
    exit: undefined,
    limit: terminalOutputLimit(params.outputByteLimit),
    output: Buffer.alloc(0),
    truncated: false,
  };
  terminal.done = new Promise((resolve) => {
    child.once("error", (error) => {
      terminal.exit = { exitCode: null, signal: null };
      appendTerminalOutput(terminal, Buffer.from(errorMessage(error)));
      resolve();
    });
    child.once("close", (code, signal) => {
      terminal.exit = { exitCode: code, signal };
      resolve();
    });
  });
  child.stdout.on("data", (chunk) => appendTerminalOutput(terminal, chunk));
  child.stderr.on("data", (chunk) => appendTerminalOutput(terminal, chunk));
  terminals.set(terminalId, terminal);
  return { terminalId };
}

function terminalOutput(params) {
  const terminal = requireTerminal(params);
  return {
    ...(terminal.exit === undefined ? {} : { exitStatus: terminal.exit }),
    output: terminal.output.toString("utf8"),
    truncated: terminal.truncated,
  };
}

async function terminalWait(params) {
  const terminal = requireTerminal(params);
  await terminal.done;
  return terminal.exit ?? { exitCode: null, signal: null };
}

async function terminalKill(params) {
  const terminal = requireTerminal(params);
  if (terminal.exit === undefined) terminal.child.kill("SIGKILL");
  await terminal.done;
  return {};
}

async function terminalRelease(params) {
  const terminalId = terminalIdFrom(params);
  const terminal = requireTerminal(params);
  if (terminal.exit === undefined) terminal.child.kill("SIGKILL");
  await terminal.done;
  terminals.delete(terminalId);
  return {};
}

function requireTerminal(params) {
  const terminalId = terminalIdFrom(params);
  const terminal = terminals.get(terminalId);
  if (terminal === undefined) throw new Error(`unknown terminal ${terminalId}`);
  return terminal;
}

function terminalIdFrom(params) {
  if (
    !isRecord(params) ||
    typeof params.terminalId !== "string" ||
    params.terminalId === ""
  ) {
    throw new Error("terminalId is required");
  }
  return params.terminalId;
}

function appendTerminalOutput(terminal, chunk) {
  const next = Buffer.concat([terminal.output, Buffer.from(chunk)]);
  if (next.byteLength <= terminal.limit) {
    terminal.output = next;
    return;
  }
  terminal.output = next.subarray(next.byteLength - terminal.limit);
  terminal.truncated = true;
}

async function cleanupTerminals() {
  await Promise.allSettled(
    [...terminals.keys()].map((terminalId) => terminalRelease({ terminalId })),
  );
}

async function stopTerminals() {
  await Promise.allSettled(
    [...terminals.values()].map(async (terminal) => {
      if (terminal.exit === undefined) terminal.child.kill("SIGKILL");
      await terminal.done;
    }),
  );
}

async function loadMcpServers(path) {
  if (path === undefined) return [];
  const raw = await readFile(path);
  if (raw.byteLength > MAX_MCP_CONFIG_BYTES)
    throw new Error("MCP config exceeds safe byte limit");
  const parsed = JSON.parse(raw.toString("utf8"));
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) return [];
  return Object.keys(parsed.mcpServers)
    .sort()
    .flatMap((name) => {
      const entry = parsed.mcpServers[name];
      if (!isRecord(entry)) return [];
      if (typeof entry.command === "string" && entry.command.trim() !== "") {
        return [
          {
            args: Array.isArray(entry.args)
              ? entry.args.filter((value) => typeof value === "string")
              : [],
            command: entry.command,
            env: recordEntries(entry.env),
            name,
          },
        ];
      }
      if (typeof entry.url === "string" && entry.url.trim() !== "") {
        const rawType =
          typeof entry.transport === "string" ? entry.transport : entry.type;
        const type = rawType === "sse" ? "sse" : "http";
        return [
          { headers: recordEntries(entry.headers), name, type, url: entry.url },
        ];
      }
      return [];
    });
}

function filterMcpServers(servers, initialize) {
  const capabilities =
    isRecord(initialize) &&
    isRecord(initialize.agentCapabilities) &&
    isRecord(initialize.agentCapabilities.mcpCapabilities)
      ? initialize.agentCapabilities.mcpCapabilities
      : {};
  return servers.filter(
    (entry) =>
      entry.type === undefined ||
      (entry.type === "http" && capabilities.http === true) ||
      (entry.type === "sse" && capabilities.sse === true),
  );
}

function supportsSessionResume(initialize) {
  if (!isRecord(initialize) || !isRecord(initialize.agentCapabilities)) {
    return false;
  }
  const capabilities = initialize.agentCapabilities.sessionCapabilities;
  return isRecord(capabilities) && Object.hasOwn(capabilities, "resume");
}

function isKimiToolActivity(frame) {
  if (
    !isRecord(frame) ||
    frame.method !== "session/update" ||
    !isRecord(frame.params) ||
    frame.params.sessionId !== activeSessionId ||
    !isRecord(frame.params.update)
  ) {
    return false;
  }
  const kind = frame.params.update.sessionUpdate;
  return kind === "tool_call" || kind === "tool_call_update";
}

function isAcpSessionNotFound(error) {
  if (!(error instanceof AcpRpcError)) return false;
  if (![-32603, -32602, -32002, -32000].includes(error.code)) return false;
  const text = `${error.providerMessage} ${jsonText(error.data)}`.toLowerCase();
  return (
    text.includes("session not found") ||
    text.includes("no session found") ||
    text.includes("unknown session")
  );
}

function jsonText(value) {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value).slice(0, 2_048);
  } catch {
    return "";
  }
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
  // Kimi ACP exposes no native per-generation usage: say so once per run, so
  // the Kernel reports this RunAttempt's usage as unavailable, never as zero.
  if (!usageGapReported) {
    usageGapReported = true;
    new ProviderUsageWriter().emit(
      providerUsageGap("kimi-acp/v1", "unsupported_provider"),
    );
  }
  try {
    writeSync(
      3,
      `${JSON.stringify({
        protocol: "rah-provider-session/v1",
        provider: "kimi-acp/v1",
        providerSessionId,
        state: "ready",
      })}\n`,
    );
  } catch {
    process.stderr.write(
      "[rah-os kimi-acp] Provider session evidence was not persisted\n",
    );
  }
}

function recordEntries(value) {
  if (!isRecord(value)) return [];
  return Object.keys(value)
    .sort()
    .flatMap((name) =>
      typeof value[name] === "string" ? [{ name, value: value[name] }] : [],
    );
}

function configOptionValue(result, configId) {
  if (!isRecord(result) || !Array.isArray(result.configOptions))
    return undefined;
  const option = result.configOptions.find(
    (entry) => isRecord(entry) && entry.id === configId,
  );
  return isRecord(option) && typeof option.currentValue === "string"
    ? option.currentValue
    : undefined;
}

function parseArguments(args) {
  const parsed = {
    additionalDirectories: [],
    mcpConfigFile: undefined,
    model: undefined,
    resumeSession: undefined,
    thinkingLevel: undefined,
  };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (value === undefined)
      throw new Error(`missing value for ${String(flag)}`);
    if (flag === "--executable") parsed.executable = value;
    else if (flag === "--additional-dir")
      parsed.additionalDirectories.push(parseAttachedDirectory(value));
    else if (flag === "--mcp-config-file") parsed.mcpConfigFile = value;
    else if (flag === "--model") parsed.model = value;
    else if (flag === "--prompt") parsed.prompt = value;
    else if (flag === "--resume-session") parsed.resumeSession = value;
    else if (flag === "--thinking-level") parsed.thinkingLevel = value;
    else if (flag === "--tool-access-mode") parsed.toolAccessMode = value;
    else if (flag === "--wake-input-file")
      parsed.wakeInput = readProviderPromptFile(value);
    else
      throw new Error(`unsupported Kimi ACP driver argument ${String(flag)}`);
  }
  if (typeof parsed.executable !== "string" || parsed.executable === "")
    throw new Error("--executable is required");
  if (typeof parsed.prompt !== "string" || parsed.prompt === "")
    throw new Error("--prompt is required");
  if (
    parsed.resumeSession !== undefined &&
    (parsed.resumeSession === "" ||
      parsed.resumeSession.length > 4_096 ||
      parsed.resumeSession.includes("\0"))
  ) {
    throw new Error("--resume-session is invalid");
  }
  if (parsed.toolAccessMode !== "full_access") {
    throw new Error(
      "Kimi ACP currently supports only truthful full_access execution",
    );
  }
  return parsed;
}

function driverArguments(args) {
  return args[0] === "__kimi-acp-driver" ? args.slice(1) : args;
}

function terminalOutputLimit(value) {
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, MAX_TERMINAL_OUTPUT_BYTES)
    : DEFAULT_TERMINAL_OUTPUT_BYTES;
}

function normalizeKind(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function stringField(value, field) {
  return isRecord(value) &&
    typeof value[field] === "string" &&
    value[field] !== ""
    ? value[field]
    : undefined;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
