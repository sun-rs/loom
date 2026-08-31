import { spawn } from "node:child_process";
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
  normalizeClaudeTrajectoryEvent,
  RuntimeTrajectoryWriter,
  runtimeStatusTrajectory,
} from "./provider-trajectory-normalizer.js";

const INTERRUPT_TIMEOUT_MS = 750;
const TERM_TIMEOUT_MS = 300;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_FRAME_BYTES = 1024 * 1024;
const ACTIVATION_PROMPT =
  "Start this RAH OS Activation now. Pull the canonical Room range through the Worker interface, perform only that work, publish the explicit canonical result, and acknowledge delivery.";
const DISALLOWED_TOOLS = [
  "EnterPlanMode",
  "ExitPlanMode",
  "ScheduleWakeup",
  "CronCreate",
  "CronList",
  "CronDelete",
].join(",");

const options = parseArguments(driverArguments(process.argv.slice(2)));
const trajectoryWriter = new RuntimeTrajectoryWriter();
const promptDirectory = mkdtempSync(join(tmpdir(), "rah-os-claude-prompt-"));
chmodSync(promptDirectory, 0o700);
const promptPath = join(promptDirectory, "room-worker.md");
writeFileSync(promptPath, options.prompt, { mode: 0o600 });

let activeChild;
let stopping = false;
let terminationPromise;
const providerSessionIds = new Set(
  options.resumeSession === undefined ? [] : [options.resumeSession],
);

process.once("SIGTERM", () => void terminate());
process.once("SIGINT", () => void terminate());

try {
  trajectoryWriter.emit(
    runtimeStatusTrajectory(
      "working",
      "starting",
      "正在启动 Claude Runtime",
      "claude:driver:starting",
    ),
  );
  let turn = await runTurn(options.resumeSession);
  if (
    options.resumeSession !== undefined &&
    !turn.succeeded &&
    !turn.inputAccepted &&
    !turn.toolActivity &&
    isMissingSessionError(turn.error)
  ) {
    trajectoryWriter.emit(
      runtimeStatusTrajectory(
        "working",
        "other",
        "此前 Claude 会话无法恢复，已自动启用新会话",
        "claude:resume:session-not-found",
      ),
    );
    turn = await runTurn(undefined);
  }
  if (stopping) {
    trajectoryWriter.emit(
      runtimeStatusTrajectory(
        "offline",
        "stopped",
        "工作轮次结束：interrupted",
        "claude:result:interrupted",
      ),
    );
  } else {
    if (!turn.succeeded) throw new Error(turn.error ?? "Claude turn failed");
    if (!turn.inputAccepted) {
      throw new Error("Claude completed without replaying the submitted input");
    }
    if (turn.sessionId === undefined) {
      throw new Error("Claude completed without a Provider session id");
    }
    writeProviderSessionEvidence(turn.sessionId);
  }
} catch (error) {
  if (stopping) {
    trajectoryWriter.emit(
      runtimeStatusTrajectory(
        "offline",
        "stopped",
        "工作轮次结束：interrupted",
        "claude:result:interrupted",
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
        "claude:driver:error",
      ),
    );
    process.stderr.write(`[rah-os claude-stream-json] ${safe}\n`);
    await terminate();
    process.exitCode = 1;
  }
} finally {
  rmSync(promptDirectory, { force: true, recursive: true });
}

async function runTurn(resumeSession) {
  const args = [
    "--print",
    "--verbose",
    "--allow-dangerously-skip-permissions",
    "--dangerously-skip-permissions",
    "--permission-mode",
    "bypassPermissions",
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--include-partial-messages",
    "--replay-user-messages",
    "--disallowed-tools",
    DISALLOWED_TOOLS,
    "--append-system-prompt-file",
    promptPath,
  ];
  if (options.model !== undefined) args.push("--model", options.model);
  if (options.effort !== undefined) args.push("--effort", options.effort);
  if (resumeSession !== undefined) args.push("--resume", resumeSession);
  args.push(...options.providerArgs);

  const child = spawn(options.executable, args, {
    cwd: process.cwd(),
    env: withoutNestedClaudeCode(process.env),
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  activeChild = child;
  let sessionId;
  let inputAccepted = false;
  let toolActivity = false;
  let toolActivityBeforeInput = false;
  let resultFrame;
  let protocolError;
  const toolNames = new Map();
  let stderrTail = Buffer.alloc(0);
  child.stderr.on("data", (chunk) => {
    stderrTail = appendBounded(stderrTail, chunk, MAX_STDERR_BYTES);
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (Buffer.byteLength(line, "utf8") > MAX_FRAME_BYTES) {
      protocolError = "Claude stream-json frame exceeded the safe byte limit";
      return;
    }
    const trimmed = line.trim();
    if (trimmed === "") return;
    let frame;
    try {
      frame = JSON.parse(trimmed);
    } catch {
      process.stderr.write(
        "[rah-os claude-stream-json] ignored non-JSON stdout frame\n",
      );
      return;
    }
    if (!isRecord(frame)) return;
    const observedSessionId = stringField(frame, "session_id");
    if (observedSessionId !== undefined) {
      if (
        (sessionId !== undefined && sessionId !== observedSessionId) ||
        (resumeSession !== undefined && resumeSession !== observedSessionId)
      ) {
        protocolError = "Claude stream-json changed Provider session identity";
      } else {
        sessionId = observedSessionId;
      }
      providerSessionIds.add(observedSessionId);
    }
    if (isActivationReplay(frame)) inputAccepted = true;
    if (hasToolActivity(frame)) {
      toolActivity = true;
      if (!inputAccepted) toolActivityBeforeInput = true;
    }
    rememberToolNames(frame, toolNames);
    if (frame.type === "result") {
      if (resultFrame !== undefined) {
        protocolError = "Claude stream-json returned multiple terminal results";
      }
      resultFrame = frame;
    } else {
      trajectoryWriter.emit(
        normalizeClaudeTrajectoryEvent(withKnownToolName(frame, toolNames)),
      );
    }
  });

  const input = {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: ACTIVATION_PROMPT }],
    },
    ...(resumeSession === undefined ? {} : { session_id: resumeSession }),
  };
  child.stdin.end(`${JSON.stringify(input)}\n`);
  const terminal = await exited;
  if (activeChild === child) activeChild = undefined;
  lines.close();
  if (stopping) {
    return {
      error: "interrupted",
      inputAccepted,
      sessionId,
      succeeded: false,
      toolActivity,
    };
  }
  if (protocolError !== undefined) {
    return {
      error: protocolError,
      inputAccepted,
      sessionId,
      succeeded: false,
      toolActivity,
    };
  }
  if (resultFrame === undefined) {
    return {
      error: diagnosticError(
        `Claude exited without a terminal result (code=${String(terminal.code)}, signal=${String(terminal.signal)})`,
        stderrTail,
      ),
      inputAccepted,
      sessionId,
      succeeded: false,
      toolActivity,
    };
  }
  trajectoryWriter.emit(normalizeClaudeTrajectoryEvent(resultFrame));
  const succeeded =
    resultFrame.subtype === "success" &&
    resultFrame.is_error !== true &&
    terminal.code === 0 &&
    terminal.signal === null &&
    !toolActivityBeforeInput;
  return {
    error: succeeded
      ? undefined
      : diagnosticError(
          toolActivityBeforeInput
            ? "Claude produced tool activity before exact input acceptance"
            : resultFrame.subtype === "success" && resultFrame.is_error !== true
              ? `Claude exited abnormally after success (code=${String(terminal.code)}, signal=${String(terminal.signal)})`
              : resultError(resultFrame),
          stderrTail,
        ),
    inputAccepted,
    sessionId,
    succeeded,
    toolActivity,
  };
}

function rememberToolNames(frame, toolNames) {
  if (frame.type !== "assistant") return;
  const content = record(frame.message).content;
  if (!Array.isArray(content)) return;
  for (const candidate of content) {
    if (!isRecord(candidate) || candidate.type !== "tool_use") continue;
    const id = stringField(candidate, "id");
    const name = stringField(candidate, "name");
    if (id !== undefined && name !== undefined) toolNames.set(id, name);
  }
}

function withKnownToolName(frame, toolNames) {
  if (frame.type !== "user") return frame;
  const message = record(frame.message);
  if (!Array.isArray(message.content)) return frame;
  let changed = false;
  const content = message.content.map((candidate) => {
    if (!isRecord(candidate) || candidate.type !== "tool_result") {
      return candidate;
    }
    const id = stringField(candidate, "tool_use_id");
    const name = id === undefined ? undefined : toolNames.get(id);
    if (name === undefined || candidate.name !== undefined) return candidate;
    changed = true;
    return { ...candidate, name };
  });
  return changed ? { ...frame, message: { ...message, content } } : frame;
}

async function terminate() {
  if (terminationPromise !== undefined) return terminationPromise;
  stopping = true;
  terminationPromise = (async () => {
    const child = activeChild;
    if (
      child === undefined ||
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      return;
    }
    child.kill("SIGINT");
    if (await waitForChildExit(child, INTERRUPT_TIMEOUT_MS)) return;
    child.kill("SIGTERM");
    if (await waitForChildExit(child, TERM_TIMEOUT_MS)) return;
    child.kill("SIGKILL");
    await waitForChildExit(child, TERM_TIMEOUT_MS);
  })();
  return terminationPromise;
}

function isActivationReplay(frame) {
  if (frame.type !== "user") return false;
  const message = record(frame.message);
  if (message.role !== "user" || !Array.isArray(message.content)) return false;
  return message.content.some(
    (candidate) =>
      isRecord(candidate) &&
      candidate.type === "text" &&
      candidate.text === ACTIVATION_PROMPT,
  );
}

function hasToolActivity(frame) {
  const content = record(frame.message).content;
  return (
    Array.isArray(content) &&
    content.some(
      (candidate) =>
        isRecord(candidate) &&
        (candidate.type === "tool_use" || candidate.type === "tool_result"),
    )
  );
}

function isMissingSessionError(message) {
  return /(?:no (?:conversation|session) found|(?:session|conversation).*(?:not found|does not exist|missing)|(?:not found|missing).*(?:session|conversation))/iu.test(
    message ?? "",
  );
}

function resultError(frame) {
  return (
    stringField(frame, "result") ??
    stringField(frame, "error") ??
    `Claude turn ended with ${String(frame.subtype ?? "unknown")}`
  );
}

function diagnosticError(prefix, stderr) {
  const tail = stderr.toString("utf8").trim();
  return redactProviderSessionIds(
    tail === "" ? prefix : `${prefix}: ${tail.slice(-2_048)}`,
  );
}

function redactProviderSessionIds(message) {
  let redacted = message;
  for (const sessionId of providerSessionIds) {
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
        provider: "claude-stream-json/v1",
        providerSessionId,
        state: "ready",
      })}\n`,
    );
  } catch {
    process.stderr.write(
      "[rah-os claude-stream-json] Provider session evidence was not persisted\n",
    );
  }
}

function parseArguments(args) {
  const parsed = {
    effort: undefined,
    executable: undefined,
    model: undefined,
    prompt: undefined,
    providerArgs: [],
    resumeSession: undefined,
    toolAccessMode: undefined,
  };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    if (flag === "--effort") parsed.effort = value;
    else if (flag === "--executable") parsed.executable = value;
    else if (flag === "--model") parsed.model = value;
    else if (flag === "--prompt") parsed.prompt = value;
    else if (flag === "--resume-session") parsed.resumeSession = value;
    else if (flag === "--tool-access-mode") parsed.toolAccessMode = value;
    else if (flag === "--mcp-config") {
      parsed.providerArgs.push(flag, value);
    } else throw new Error(`unknown Claude driver argument: ${flag}`);
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
      "claude-stream-json/v1 requires full_access for the standard Raft policy",
    );
  }
  for (const field of ["resumeSession", "model", "effort"]) {
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
  return args[0] === "__claude-stream-json-driver" ? args.slice(1) : args;
}

function withoutNestedClaudeCode(environment) {
  const next = { ...environment };
  delete next.CLAUDECODE;
  return next;
}

function appendBounded(existing, chunk, maximum) {
  const next = Buffer.concat([existing, Buffer.from(chunk)]);
  return next.byteLength <= maximum
    ? next
    : next.subarray(next.byteLength - maximum);
}

function waitForChildExit(child, milliseconds) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("close", onClose);
      resolve(value);
    };
    const onClose = () => finish(true);
    child.once("close", onClose);
    const timer = setTimeout(() => finish(false), milliseconds);
    timer.unref?.();
  });
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
