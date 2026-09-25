import { readProviderPromptFile } from "./provider-prompt-file.js";
import {
  providerLaunchArguments,
  providerLaunchPolicy,
} from "./provider-launch-arguments.js";
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
  normalizeClaudeTrajectoryEvent,
  RuntimeTrajectoryWriter,
  runtimeStatusTrajectory,
} from "./provider-trajectory-normalizer.js";

import { attachClaudeBusyInput } from "./claude-busy-input.js";
import {
  CLAUDE_DISALLOWED_TOOLS,
  claudeResultError as resultError,
  claudeResultInputUuids,
  isMissingClaudeSessionError as isMissingSessionError,
  settleClaudeControlResponse as settleControlResponse,
  withoutNestedClaudeCode,
} from "./claude-stream-launch.js";
import { createClaudeFinalInterrupt } from "./claude-final-interrupt.js";
import {
  ClaudeStreamUsageTracker,
  ProviderUsageWriter,
} from "./provider-usage.js";
import {
  assertSessionReplacementAllowed,
  providerActivationInput,
} from "./provider-activation-input.js";

const INTERRUPT_TIMEOUT_MS = 750;
const TERM_TIMEOUT_MS = 300;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_FRAME_BYTES = 1024 * 1024;
const FINAL_INTERRUPT_TIMEOUT_MS = 5_000;
const DISALLOWED_TOOLS = CLAUDE_DISALLOWED_TOOLS;

const options = parseArguments(driverArguments(process.argv.slice(2)));
// S1-d/S2-c1: the Host-prepared wake file verbatim when present (the Host
// already appended the notice lines, so the acceptance digest covers them);
// otherwise the fixed startup wake plus the env notices.
const TURN_INPUT = options.wakeInput ?? providerActivationInput();
const trajectoryWriter = new RuntimeTrajectoryWriter();
const usageTracker = new ClaudeStreamUsageTracker();
const usageWriter = new ProviderUsageWriter();
const promptDirectory = mkdtempSync(join(tmpdir(), "rah-os-claude-prompt-"));
chmodSync(promptDirectory, 0o700);
const promptPath = join(promptDirectory, "room-worker.md");
writeFileSync(promptPath, options.prompt, { mode: 0o600 });

let activeChild;
let finalReportForRun;
let stopping = false;
let terminationPromise;
// The native session this run already reported as bound (reported once).
let boundProviderSessionId;
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
    assertSessionReplacementAllowed();
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
    if (finalReportForRun !== undefined)
      writeFinalInterruptReport(finalReportForRun);
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
    ...providerLaunchArguments("claude"),
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
    // Process-only override: preserve user auth/config and RAH-owned memory.
    env: {
      ...withoutNestedClaudeCode(process.env),
      ...providerLaunchPolicy("claude").environment,
    },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  activeChild = child;
  let sessionId;
  let inputAccepted = false;
  let toolActivity = false;
  let toolActivityBeforeInput = false;
  let initObserved = false;
  // `msg_lifecycle_v1` (announced on `system/init`): every result names the
  // stdin inputs it ran, so one naming none of this run's is not this run's.
  let lifecycleCapability = false;
  /**
   * Contract §3: once the session holds this input (its replay echo) and its
   * identity is confirmed (`system/init` agrees with it), it is bound, so a
   * later cancel, crash or error resumes it instead of a silently new
   * session. Never while the identity or the input order is in doubt.
   * Reported once; success reports it idempotently.
   */
  const bindAcceptedSession = () => {
    const id = sessionId ?? resumeSession;
    if (
      inputAccepted &&
      initObserved &&
      protocolError === undefined &&
      !toolActivityBeforeInput &&
      id !== undefined
    )
      writeProviderSessionEvidence(id);
  };
  let resultFrame;
  let resultCount = 0;
  // The last result the CLI wrote, attributed or not: its `is_error` decides
  // the headless exit code.
  let lastResult;
  let failedResult;
  let protocolError;
  let endedAfterFinalReply = false;
  let finalInterruptResult;
  const toolNames = new Map();
  // A fresh uuid per turn input: the replay echo of exactly this uuid and
  // text is the only acceptance of this turn (never a resumed session's
  // earlier message, which carries its own uuid, never a stdin write).
  const inputUuid = randomUUID();
  const controlRequests = new Map();
  const controlRequest = (request, timeoutMs) =>
    new Promise((resolve, reject) => {
      const requestId = `rah-${randomUUID()}`;
      const timer = setTimeout(() => {
        controlRequests.delete(requestId);
        reject(new Error(`control_request ${request.subtype} timed out`));
      }, timeoutMs);
      controlRequests.set(requestId, { reject, resolve, timer });
      try {
        child.stdin.write(
          `${JSON.stringify({ type: "control_request", request_id: requestId, request })}\n`,
        );
      } catch (error) {
        clearTimeout(timer);
        controlRequests.delete(requestId);
        reject(error);
      }
    });
  // Final-reply turn end: this turn only, at the first tool boundary.
  const finalInterrupt = createClaudeFinalInterrupt({
    interrupt: () =>
      controlRequest({ subtype: "interrupt" }, FINAL_INTERRUPT_TIMEOUT_MS),
  });
  const busyInput = attachClaudeBusyInput({
    input: process.stdin,
    resumedSession: resumeSession !== undefined,
    session: () =>
      inputAccepted && !protocolError && !stopping && !finalInterrupt.armed
        ? sessionId
        : undefined,
    write: (text, done) => child.stdin.write(text, done),
    control: (frame) => {
      if (
        stopping ||
        !inputAccepted ||
        resultFrame !== undefined ||
        typeof frame.runAttemptId !== "string" ||
        (process.env.RAH_RUN_ATTEMPT_ID !== undefined &&
          frame.runAttemptId !== process.env.RAH_RUN_ATTEMPT_ID) ||
        (frame.turnId !== undefined && frame.turnId !== inputUuid)
      )
        return;
      finalInterrupt.arm();
    },
  });
  child.stdin.on("error", () => busyInput.close());
  // Whether a result ran this run's wake or a busy input it wrote.
  const isOwnResult = (frame) =>
    claudeResultInputUuids(frame).some(
      (uuid) => uuid === inputUuid || busyInput.writtenUuids.has(uuid),
    );
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
    if (frame.type === "control_response") {
      settleControlResponse(frame, controlRequests);
      return;
    }
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
    if (frame.type === "system" && frame.subtype === "init") {
      initObserved = true;
      if (
        Array.isArray(frame.capabilities) &&
        frame.capabilities.includes("msg_lifecycle_v1")
      )
        lifecycleCapability = true;
      bindAcceptedSession();
    }
    if (!inputAccepted) {
      const replay = activationReplay(frame, inputUuid);
      if (replay !== undefined) {
        inputAccepted = true;
        bindAcceptedSession();
        const threadId = observedSessionId ?? sessionId ?? resumeSession;
        // ACCEPTANCE SIGNAL: the replay echo of THIS turn's uuid with exactly
        // this text (`--replay-user-messages`). Only a Host-prepared wake is
        // reported; its digest is what the Host prepared.
        if (
          replay === "exact" &&
          options.wakeInput !== undefined &&
          threadId !== undefined
        )
          writeDeliveryAcceptance(threadId, inputUuid, options.wakeInput);
      }
    } else finalInterrupt.observe(frame);
    if (hasToolActivity(frame)) {
      toolActivity = true;
      if (!inputAccepted) toolActivityBeforeInput = true;
    }
    busyInput.observe(frame);
    usageWriter.emit(usageTracker.observe(frame));
    rememberToolNames(frame, toolNames);
    if (frame.type === "result") {
      lastResult = frame;
      // Full review batch 3 P1-4 (real 2.1.282): a background task this
      // turn started that finishes after admission closed makes the CLI run
      // one more native turn whose result names no stdin input. It is not
      // this run's: a diagnostic only, never counted, never its failure.
      if (lifecycleCapability && !isOwnResult(frame)) {
        trajectoryWriter.emit(
          runtimeStatusTrajectory(
            "online",
            "other",
            "Claude 自发轮次已结束（不属于本次输入）",
            "claude:result:unattributed",
          ),
        );
        return;
      }
      resultCount += 1;
      if (resultCount > 1 + busyInput.writtenCount) {
        protocolError =
          "Claude stream-json returned unexpected terminal results";
      }
      // Ended by the Host after the final reply committed: the reply is
      // done, so the aborted turn is this run's success.
      if (resultCount === 1 && finalInterrupt.endedByInterrupt(frame)) {
        endedAfterFinalReply = true;
        finalInterruptResult = frame;
      } else if (frame.subtype !== "success" || frame.is_error === true)
        failedResult = frame;
      resultFrame = frame;
      // Close admission at the first result; already written user inputs remain
      // in the CLI pipe and may produce further results before process exit.
      // This bounded Run lifecycle is RAH glue, not Raft's idle resident process.
      child.stdin.end();
    } else {
      trajectoryWriter.emit(
        normalizeClaudeTrajectoryEvent(withKnownToolName(frame, toolNames)),
      );
    }
  });

  const input = {
    type: "user",
    uuid: inputUuid,
    message: {
      role: "user",
      content: [{ type: "text", text: TURN_INPUT }],
    },
    ...(resumeSession === undefined ? {} : { session_id: resumeSession }),
  };
  child.stdin.write(`${JSON.stringify(input)}\n`);
  const terminal = await exited.finally(() => busyInput.close());
  if (activeChild === child) activeChild = undefined;
  lines.close();
  for (const pending of controlRequests.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error("Claude exited"));
  }
  controlRequests.clear();
  finalReportForRun = finalInterrupt.armed
    ? await finalInterrupt.report()
    : undefined;
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
  trajectoryWriter.emit(
    endedAfterFinalReply
      ? // The aborted result is this run's success, never a runtime error.
        runtimeStatusTrajectory(
          "online",
          "stopped",
          "工作轮次已完成",
          "claude:result:final-reply-interrupt",
        )
      : normalizeClaudeTrajectoryEvent(resultFrame),
  );
  // Claude Code headless exits 1 when the last result it wrote had
  // `is_error` (2.1.282 `runHeadless`), which the interrupted turn's
  // `error_during_execution` does. That exit is explained only when this
  // driver's own final interrupt produced that last result.
  const exitedAsExpected =
    terminal.signal === null &&
    (terminal.code === 0 ||
      (terminal.code === 1 &&
        lastResult?.is_error === true &&
        ((endedAfterFinalReply &&
          lastResult === resultFrame &&
          resultFrame === finalInterruptResult) ||
          // The unattributed native turn after this run's result failed.
          lastResult !== resultFrame)));
  const succeeded =
    failedResult === undefined &&
    ((resultFrame.subtype === "success" && resultFrame.is_error !== true) ||
      endedAfterFinalReply) &&
    exitedAsExpected &&
    !toolActivityBeforeInput;
  return {
    error: succeeded
      ? undefined
      : diagnosticError(
          toolActivityBeforeInput
            ? "Claude produced tool activity before exact input acceptance"
            : failedResult !== undefined
              ? resultError(failedResult)
              : resultFrame.subtype === "success" &&
                  resultFrame.is_error !== true
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

/**
 * This turn's replay echo (`--replay-user-messages`): a `user` frame carrying
 * exactly the submitted text. "exact" when it also carries the submitted
 * uuid — the Claude Code replay echo carries the host-supplied uuid of the
 * inbound message — and "legacy" when an older CLI echoes no uuid at all
 * (liveness only, never a delivery acceptance). A frame with any other uuid
 * is a different message (for example a resumed session's earlier one).
 */
function activationReplay(frame, inputUuid) {
  if (frame.type !== "user") return undefined;
  const message = record(frame.message);
  if (message.role !== "user" || !Array.isArray(message.content))
    return undefined;
  const text = message.content
    .filter((candidate) => isRecord(candidate) && candidate.type === "text")
    .map((candidate) => candidate.text)
    .join("");
  if (text !== TURN_INPUT) return undefined;
  if (frame.uuid === inputUuid) return "exact";
  return frame.uuid === undefined ? "legacy" : undefined;
}

/**
 * Host-private frame on fd3, intercepted before trajectory parsing. The
 * digest covers the Host-prepared wake file verbatim, which is the whole
 * turn input. `turnId` is this input's uuid.
 */
function writeDeliveryAcceptance(threadId, inputUuid, text) {
  try {
    writeSync(
      3,
      `${JSON.stringify({
        protocol: "rah-delivery-accepted/v1",
        provider: "claude-stream-json/v1",
        signal: "replay-user-message",
        threadId,
        turnId: inputUuid,
        inputSha256: createHash("sha256").update(text, "utf8").digest("hex"),
      })}\n`,
    );
  } catch {
    // No Host listening: nothing is registered as sent.
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
  if (boundProviderSessionId === providerSessionId) return;
  boundProviderSessionId = providerSessionId;
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
    else if (flag === "--prompt-file")
      parsed.prompt = readProviderPromptFile(value);
    else if (flag === "--resume-session") parsed.resumeSession = value;
    else if (flag === "--wake-input-file")
      parsed.wakeInput = readProviderPromptFile(value);
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
