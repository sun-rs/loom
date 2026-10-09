import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import {
  createCodexExecFinalOutput,
  proveCodexExecInput,
} from "./codex-exec-final-output.js";
import { parseAttachedDirectory } from "./channel-attached-directories.js";
import { nativeFinalTextInstructions } from "./final-output-instructions.js";
import { providerActivationInput } from "./provider-activation-input.js";
import { providerLaunchPolicy } from "./provider-launch-arguments.js";
import { readProviderPromptFile } from "./provider-prompt-file.js";
import { ProviderUsageWriter } from "./provider-usage.js";
import {
  RuntimeTrajectoryWriter,
  runtimeStatusTrajectory,
} from "./provider-trajectory-normalizer.js";

const PROVIDER = "codex-exec/v1";
const MAX_STDOUT = 16 * 1024 * 1024;
const MAX_ROLLOUT = 256 * 1024 * 1024;
try {
  await main();
} catch (error) {
  const writer = new RuntimeTrajectoryWriter();
  writer.emit(
    runtimeStatusTrajectory(
      "error",
      "runtime_error",
      String(error.message),
      "exec:launch-failed",
    ),
  );
  writer.flush();
  process.stderr.write(String(error.message) + "\n");
  process.exitCode = 1;
}

async function main() {
  const options = parseArguments(
    process.argv.slice(process.argv[2] === "__codex-exec-driver" ? 3 : 2),
  );
  const wake = options.wakeInput ?? providerActivationInput();
  const inputSha256 = sha(Buffer.from(wake));
  const root = join(
    process.env.CODEX_HOME || join(homedir(), ".codex"),
    "sessions",
  );
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const rolloutRoot = realpathSync(root);
  const before = inventory(rolloutRoot);
  const prior =
    options.resumeSession === undefined
      ? undefined
      : findRollout(before, options.resumeSession);
  if (options.resumeSession !== undefined && prior === undefined)
    throw new Error(
      "RAH_SESSION_CONTINUITY_REQUIRED: bound Codex rollout is missing; no replacement session was started",
    );
  if (existsSync(options.proofPath))
    throw new Error("final proof path must be fresh");
  const parent = lstatSync(dirname(options.proofPath));
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    (parent.mode & 0o077) !== 0 ||
    parent.uid !== process.getuid?.()
  )
    throw new Error("final proof parent must be an owner-private directory");
  const previous =
    prior === undefined ? undefined : snapshot(prior, MAX_ROLLOUT);
  const directory = mkdtempSync(
    join(dirname(options.proofPath), "exec-final-"),
  );
  const outputPath = join(directory, "last-message.txt");

  const binding = {
    launchId: options.launchId,
    expectedSessionId: options.resumeSession,
    model: options.model,
    effort: options.reasoning,
    inputSha256,
    outputPath,
    outputExistedBefore: false,
    rollout: {
      root: rolloutRoot,
      byteOffset: previous?.bytes.length ?? 0,
      prefixSha256: sha(previous?.bytes ?? Buffer.alloc(0)),
      ...(previous
        ? {
            path: previous.path,
            device: previous.device,
            inode: previous.inode,
          }
        : { existingPaths: before }),
    },
  };
  const collector = createCodexExecFinalOutput(binding);
  const usage = new ProviderUsageWriter();
  const trajectory = new RuntimeTrajectoryWriter();
  let child;
  let stopping = false;
  let continuityFailure;
  let terminateTimer;
  try {
    const policy = providerLaunchPolicy("codex", process.env, {
      codexExecutable: options.executable,
    });
    const args = [
      "exec",
      ...(options.resumeSession ? ["resume"] : []),
      ...options.configArgs,
      ...policy.args,
      "-c",
      `developer_instructions=${JSON.stringify(nativeFinalTextInstructions(options.prompt, options.nativeFinal))}`,
      "-c",
      `model_reasoning_effort=${JSON.stringify(options.reasoning)}`,
      "--json",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      options.model,
      "--output-last-message",
      outputPath,
      ...(options.resumeSession ? [options.resumeSession] : []),
      "-",
    ];
    child = spawn(options.executable, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...policy.environment },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.pipe(process.stderr);
    let stdout = Buffer.alloc(0),
      complete = true,
      lineBuffer = "",
      sessionId;
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      if (stdout.length + chunk.length > MAX_STDOUT) complete = false;
      else if (complete) stdout = Buffer.concat([stdout, chunk]);
      lineBuffer += chunk.toString("utf8");
      if (Buffer.byteLength(lineBuffer) > MAX_STDOUT) {
        complete = false;
        lineBuffer = "";
        return;
      }
      let i;
      while ((i = lineBuffer.indexOf("\n")) >= 0) {
        const line = lineBuffer.slice(0, i);
        lineBuffer = lineBuffer.slice(i + 1);
        try {
          const frame = JSON.parse(line);
          if (frame.type === "thread.started") {
            const id = frame.thread_id;
            if (
              typeof id !== "string" ||
              id.trim() === "" ||
              sessionId !== undefined ||
              (options.resumeSession !== undefined &&
                id !== options.resumeSession)
            ) {
              complete = false;
              continuityFailure =
                "RAH_SESSION_CONTINUITY_REQUIRED: native exec reported an inconsistent session";
              continue;
            }
            sessionId = id;
            emit({
              protocol: "rah-provider-session/v1",
              provider: PROVIDER,
              providerSessionId: id,
              state: "ready",
            });
          }
          if (frame.type === "turn.started")
            trajectory.emit(
              runtimeStatusTrajectory(
                "working",
                "model_request_started",
                "模型请求已开始",
                `exec:${options.launchId}:started`,
              ),
            );
        } catch {
          complete = false;
        }
      }
    });
    const stop = () => {
      stopping = true;
      child.kill("SIGTERM");
      terminateTimer = setTimeout(() => child.kill("SIGKILL"), 500);
      terminateTimer.unref();
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    child.stdin.on("error", () => undefined);
    child.stdin.end(wake);
    const outcome = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    if (terminateTimer) clearTimeout(terminateTimer);
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    if (lineBuffer.length !== 0) complete = false;
    try {
      const path =
        prior ??
        (sessionId === undefined
          ? undefined
          : findRollout(inventory(rolloutRoot), sessionId));
      if (path === undefined) throw new Error("no current rollout evidence");
      const rollout = snapshot(path, MAX_ROLLOUT);
      const common = {
        launchId: options.launchId,
        stdoutComplete: complete,
        stdout,
        rollout,
      };
      const input = proveCodexExecInput(binding, common);
      if (input === undefined)
        throw new Error("current input proof is unavailable");
      emit({
        protocol: "rah-delivery-accepted/v1",
        provider: PROVIDER,
        signal: "rollout.user-input",
        threadId: input.sessionId,
        turnId: input.turnId,
        inputSha256: input.inputSha256,
      });
      try {
        reportUsage(
          rollout.bytes.subarray(binding.rollout.byteOffset),
          input,
          usage,
        );
      } catch {
        usage.emit({
          provider: PROVIDER,
          reason: "parse_error",
          observedAt: new Date().toISOString(),
        });
      }
      if (!stopping && options.nativeFinal && existsSync(outputPath)) {
        const candidate = collector.settle({
          ...common,
          exitCode: outcome.code,
          signal: outcome.signal,
          output: snapshot(outputPath, 65538),
        });
        if (candidate !== undefined)
          writeFileSync(options.proofPath, JSON.stringify(candidate) + "\n", {
            flag: "wx",
            mode: 0o600,
          });
      }
    } catch (error) {
      continuityFailure ??=
        "RAH_SESSION_CONTINUITY_REQUIRED: ordinary exec current input could not be verified";
      usage.emit({
        provider: PROVIDER,
        reason: "parse_error",
        observedAt: new Date().toISOString(),
      });
      process.stderr.write(
        `[loom codex exec] Native evidence unavailable: ${error.message}\n`,
      );
    }
    trajectory.emit(
      runtimeStatusTrajectory(
        outcome.code === 0 && !continuityFailure ? "online" : "error",
        outcome.code === 0 && !continuityFailure ? "stopped" : "runtime_error",
        continuityFailure ??
          `原生 exec 已结束：${String(outcome.code ?? outcome.signal)}`,
        `exec:${options.launchId}:ended`,
      ),
    );
    trajectory.flush();
    process.exitCode =
      outcome.code ?? (outcome.signal === "SIGINT" ? 130 : 143);
  } finally {
    if (terminateTimer) clearTimeout(terminateTimer);
    rmSync(directory, { recursive: true, force: true });
  }
}

function reportUsage(bytes, input, writer) {
  const seen = new Map();
  for (const line of Buffer.from(bytes).toString("utf8").trim().split("\n")) {
    const event = JSON.parse(line),
      p = event.payload;
    if (
      event.type !== "token_usage_record" ||
      p?.turn_id !== input.turnId ||
      (p.thread_id ?? p.session_id) !== input.sessionId
    )
      continue;
    const u = p.usage;
    if (
      typeof p.response_id !== "string" ||
      !u ||
      ![u.input_tokens, u.cached_input_tokens, u.output_tokens].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ) ||
      u.cached_input_tokens > u.input_tokens ||
      (u.reasoning_output_tokens != null &&
        (!Number.isSafeInteger(u.reasoning_output_tokens) ||
          u.reasoning_output_tokens < 0 ||
          u.reasoning_output_tokens > u.output_tokens)) ||
      typeof event.timestamp !== "string" ||
      !Number.isFinite(Date.parse(event.timestamp))
    )
      throw new Error("invalid per-response usage");
    const record = {
      provider: PROVIDER,
      responseId: p.response_id,
      inputTokens: u.input_tokens,
      cachedInputTokens: u.cached_input_tokens,
      outputTokens: u.output_tokens,
      reasoningOutputTokens: u.reasoning_output_tokens ?? null,
      contextWindow: null,
      contextUsedTokens: null,
      observedAt: event.timestamp,
    };
    if (seen.has(p.response_id)) {
      const previous = seen.get(p.response_id);
      if (
        [
          "inputTokens",
          "cachedInputTokens",
          "outputTokens",
          "reasoningOutputTokens",
        ].some((key) => previous[key] !== record[key])
      )
        throw new Error("conflicting per-response usage");
    } else seen.set(p.response_id, record);
  }
  if (seen.size === 0)
    writer.emit({
      provider: PROVIDER,
      reason: "parse_error",
      observedAt: new Date().toISOString(),
    });
  for (const record of seen.values()) writer.emit(record);
}
function emit(frame) {
  try {
    writeSync(3, JSON.stringify(frame) + "\n");
  } catch {}
}
function sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function inventory(path) {
  const files = [];
  function walk(directory, depth) {
    if (depth > 8) throw new Error("rollout directory depth exceeded");
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".jsonl"))
        files.push(full);
      if (files.length > 100000)
        throw new Error("rollout inventory limit exceeded");
    }
  }
  walk(path, 0);
  return files;
}
function findRollout(files, id) {
  const matches = files.filter((path) => path.endsWith(`-${id}.jsonl`));
  if (matches.length > 1) throw new Error("ambiguous native rollout identity");
  return matches[0];
}
function snapshot(path, limit) {
  const link = lstatSync(path);
  if (!link.isFile() || link.isSymbolicLink() || link.size > limit)
    throw new Error("invalid or oversized native evidence file");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd),
      bytes = readFileSync(fd),
      after = fstatSync(fd);
    if (
      before.ino !== link.ino ||
      before.dev !== link.dev ||
      after.size !== bytes.length ||
      before.size !== after.size
    )
      throw new Error("native file changed while reading");
    return {
      path,
      device: String(before.dev),
      inode: String(before.ino),
      regular: true,
      symlink: false,
      bytes,
    };
  } finally {
    closeSync(fd);
  }
}
function parseArguments(args) {
  const launchOverride = JSON.parse(
    process.env.RAH_PROVIDER_LAUNCH_ARGS_JSON || "{}",
  );
  if (
    launchOverride.runtimeId === "codex" &&
    (launchOverride.overrideArgs !== undefined ||
      (launchOverride.additionalArgs?.length ?? 0) > 0)
  )
    throw new Error(
      "Codex launch override is not compatible with ordinary exec",
    );
  const parsed = { configArgs: [], directories: [], nativeFinal: false };
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === "--native-final-text") {
      parsed.nativeFinal = true;
      continue;
    }
    const value = args[++i];
    if (value === undefined) throw new Error(`missing value for ${name}`);
    const fields = {
      "--executable": "executable",
      "--prompt": "prompt",
      "--model": "model",
      "--reasoning": "reasoning",
      "--resume-session": "resumeSession",
      "--launch-id": "launchId",
      "--final-proof-file": "proofPath",
      "--tool-access-mode": "toolAccessMode",
    };
    if (fields[name]) parsed[fields[name]] = value;
    else if (name === "--prompt-file")
      parsed.prompt = readProviderPromptFile(value);
    else if (name === "--wake-input-file")
      parsed.wakeInput = readProviderPromptFile(value);
    else if (name === "-c") parsed.configArgs.push(name, value);
    else if (name === "--additional-dir")
      parsed.directories.push(parseAttachedDirectory(value));
    else throw new Error(`unsupported ordinary Codex option ${name}`);
  }
  for (const name of [
    "executable",
    "prompt",
    "model",
    "reasoning",
    "launchId",
    "proofPath",
  ])
    if (typeof parsed[name] !== "string" || parsed[name].trim() === "")
      throw new Error(`${name} is required`);
  if (!isAbsolute(parsed.proofPath) || parsed.toolAccessMode !== "full_access")
    throw new Error("absolute proof path and full_access required");
  if (
    parsed.resumeSession !== undefined &&
    (!/^[A-Za-z0-9_-]+$/.test(parsed.resumeSession) ||
      parsed.resumeSession.length > 4096)
  )
    throw new Error("invalid resume session identity");
  if (parsed.directories.length)
    throw new Error(
      "ordinary exec attached-directory support has not been verified; launch refused",
    );
  return parsed;
}
