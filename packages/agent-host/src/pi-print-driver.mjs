import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { createHash } from "node:crypto";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  writeFileSync,
  writeSync,
  existsSync,
  lstatSync,
  mkdirSync,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { inspectPiTurn } from "./pi-final-output.mjs";
import { piUsageFrames } from "./pi-usage.mjs";
import { ProviderUsageWriter } from "./provider-usage.js";
import {
  providerLaunchArguments,
  providerLaunchPolicy,
} from "./provider-launch-arguments.js";
import { readProviderPromptFile } from "./provider-prompt-file.js";
import { nativeFinalTextInstructions } from "./final-output-instructions.js";
const PROVIDER = "pi-print-json/v1",
  LIMIT = 32 * 1024 * 1024;
const emit = (f) => {
  try {
    writeSync(3, JSON.stringify(f) + "\n");
  } catch {}
};
function snapshot(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.size > LIMIT || s.uid !== process.getuid?.())
      throw Error("invalid Pi native session file");
    const text = readFileSync(fd, "utf8"),
      after = fstatSync(fd);
    if (s.size !== after.size || Buffer.byteLength(text) !== s.size)
      throw Error("Pi native session changed during read");
    return { text, dev: s.dev, ino: s.ino };
  } finally {
    closeSync(fd);
  }
}
function options(args) {
  const launch = JSON.parse(process.env.RAH_PROVIDER_LAUNCH_ARGS_JSON || "{}");
  if (
    launch.runtimeId === "pi" &&
    (launch.overrideArgs != null || (launch.additionalArgs?.length ?? 0) > 0)
  )
    throw Error("Pi launch overrides are not supported by print transport");
  const out = { nativeFinal: false };
  const fields = {
    "--executable": "executable",
    "--prompt": "prompt",
    "--model": "model",
    "--reasoning": "reasoning",
    "--session-file": "sessionFile",
    "--resume-session": "resumeSession",
    "--launch-id": "launchId",
    "--final-proof-file": "proofPath",
    "--tool-access-mode": "access",
  };
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    if (k === "--native-final-text") {
      out.nativeFinal = true;
      continue;
    }
    const v = args[++i];
    if (v === undefined) throw Error("missing " + k);
    if (fields[k]) out[fields[k]] = v;
    else if (k === "--prompt-file") out.prompt = readProviderPromptFile(v);
    else if (k === "--wake-input-file") out.wake = readProviderPromptFile(v);
    else throw Error("unsupported Pi driver argument " + k);
  }
  for (const k of [
    "executable",
    "model",
    "reasoning",
    "sessionFile",
    "launchId",
    "proofPath",
  ])
    if (!out[k]?.trim()) throw Error("missing " + k);
  if (
    !isAbsolute(out.sessionFile) ||
    !isAbsolute(out.proofPath) ||
    out.access !== "full_access"
  )
    throw Error("Pi requires absolute native files and full_access");
  if (!out.model.includes("/")) throw Error("Pi exact provider/model required");
  return out;
}
try {
  await main();
} catch (e) {
  process.stderr.write(
    e.message === "Pi launch overrides are not supported by print transport"
      ? e.message + "\n"
      : "Pi launch or native evidence failed; no final proof was created.\n",
  );
  process.exitCode = 1;
}
async function main() {
  const o = options(process.argv.slice(2));
  let wake = o.wake;
  if (wake === undefined) {
    wake = "";
    const inputDecoder = new StringDecoder("utf8");
    for await (const b of process.stdin) {
      wake += inputDecoder.write(b);
      if (Buffer.byteLength(wake) > LIMIT)
        throw Error("Pi input limit exceeded");
    }
    wake += inputDecoder.end();
  }
  if (!wake.trim()) throw Error("empty Pi input");
  mkdirSync(dirname(o.sessionFile), { recursive: true, mode: 0o700 });
  for (const dir of [dirname(o.sessionFile), dirname(o.proofPath)]) {
    const s = lstatSync(dir);
    if (
      !s.isDirectory() ||
      s.isSymbolicLink() ||
      s.uid !== process.getuid?.() ||
      (s.mode & 0o077) !== 0
    )
      throw Error("Pi evidence directory must be owner-private");
  }
  if (existsSync(o.proofPath)) throw Error("Pi proof path must be fresh");
  const before = existsSync(o.sessionFile) ? snapshot(o.sessionFile) : null;
  if (o.resumeSession) {
    if (
      !before ||
      JSON.parse(before.text.split("\n")[0]).id !== o.resumeSession
    )
      throw Error(
        "RAH_SESSION_CONTINUITY_REQUIRED: bound Pi session missing or wrong",
      );
  } else if (before)
    throw Error(
      "RAH_SESSION_CONTINUITY_REQUIRED: refusing to adopt unbound Pi session",
    );
  const split = o.model.indexOf("/"),
    provider = o.model.slice(0, split),
    model = o.model.slice(split + 1);
  const policy = providerLaunchPolicy("pi", process.env);
  const standing =
    "[Loom standing instructions]\n" +
    nativeFinalTextInstructions(o.prompt ?? "", o.nativeFinal);
  const args = [
    ...providerLaunchArguments("pi", process.env),
    ...policy.args,
    "--provider",
    provider,
    "--model",
    model,
    "--thinking",
    o.reasoning,
    "--session",
    o.sessionFile,
    "--append-system-prompt",
    standing,
  ];
  const usage = new ProviderUsageWriter(),
    decoder = new StringDecoder("utf8");
  const child = spawn(o.executable, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...policy.environment },
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
  let compactionGap = false;
  const markCompactionGap = () => {
    if (compactionGap) return;
    compactionGap = true;
    // Native compaction usage is aggregate, not a proven response generation.
    usage.emit({
      provider: PROVIDER,
      reason: "parse_error",
      observedAt: new Date().toISOString(),
    });
  };
  let stdout = "",
    complete = true,
    stopping = false,
    timer,
    sessionId;
  child.stderr.pipe(process.stderr);
  let buffer = "";
  child.stdout.on("data", (b) => {
    process.stdout.write(b);
    const chunk = decoder.write(b);
    if (Buffer.byteLength(stdout) + b.length > LIMIT) complete = false;
    else if (complete) stdout += chunk;
    buffer += chunk;
    if (Buffer.byteLength(buffer) > LIMIT) {
      buffer = "";
      complete = false;
    }
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const l = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      try {
        const f = JSON.parse(l);
        if (f.type === "compaction_start" || f.type === "compaction_end")
          markCompactionGap();
        if (f.type === "message_end" && f.message?.role === "assistant") {
          const current = piUsageFrames([f.message], {});
          for (const u of [...current.generations, ...current.gaps])
            usage.emit(
              u.reason ? { ...u, observedAt: new Date().toISOString() } : u,
            );
        }
        if (f.type === "session") {
          if (
            sessionId ||
            typeof f.id !== "string" ||
            !f.id.trim() ||
            (o.resumeSession && f.id !== o.resumeSession)
          ) {
            complete = false;
            child.kill("SIGTERM");
            continue;
          }
          sessionId = f.id;
          emit({
            protocol: "rah-provider-session/v1",
            provider: PROVIDER,
            providerSessionId: sessionId,
            state: "ready",
          });
        }
      } catch {
        complete = false;
      }
    }
  });
  const stop = () => {
    stopping = true;
    child.kill("SIGTERM");
    timer = setTimeout(() => child.kill("SIGKILL"), 500);
    timer.unref();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  child.stdin.on("error", () => {});
  child.stdin.end(wake);
  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  process.removeListener("SIGTERM", stop);
  process.removeListener("SIGINT", stop);
  const tail = decoder.end();
  if (complete) stdout += tail;
  buffer += tail;
  try {
    const parsedFrames = stdout
      .trim()
      .split("\n")
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
    let openAssistant = false;
    for (const frame of parsedFrames) {
      if (frame.type === "message_start" && frame.message?.role === "assistant")
        openAssistant = true;
      if (frame.type === "message_end" && frame.message?.role === "assistant")
        openAssistant = false;
    }
    const settled =
      parsedFrames.at(-1)?.type === "agent_settled" &&
      parsedFrames.at(-1)?.aborted === false &&
      parsedFrames.at(-2)?.type === "agent_end" &&
      parsedFrames.at(-2)?.willRetry === false;
    const messages = stdout
      .trim()
      .split("\n")
      .flatMap((l) => {
        try {
          const f = JSON.parse(l);
          return f.type === "message_end" && f.message?.role === "assistant"
            ? [f.message]
            : [];
        } catch {
          return [];
        }
      });
    const u = piUsageFrames(messages, {});
    for (const f of [...u.generations, ...u.gaps])
      usage.emit(f.reason ? { ...f, observedAt: new Date().toISOString() } : f);
    if (!messages.length || !complete || buffer || !settled || openAssistant)
      usage.emit({
        provider: PROVIDER,
        reason: "parse_error",
        observedAt: new Date().toISOString(),
      });
    const after = snapshot(o.sessionFile);
    if (before && (before.ino !== after.ino || before.dev !== after.dev))
      throw Error("Pi session file replaced");
    if (!complete || buffer) throw Error("incomplete Pi stream");
    const p = inspectPiTurn({
      stdout,
      sessionBefore: before?.text ?? "",
      sessionAfter: after.text,
      prompt: wake,
      expectedSessionId: o.resumeSession,
      provider,
      model,
      reasoning: o.reasoning,
      exit,
    });
    // inspectPiTurn has verified the exact prefix, session, and current branch.
    if (
      after.text
        .slice(before?.text.length ?? 0)
        .trim()
        .split("\n")
        .some((line) => JSON.parse(line).type === "compaction")
    )
      markCompactionGap();
    emit({
      protocol: "rah-delivery-accepted/v1",
      provider: PROVIDER,
      signal: "session.user-input",
      threadId: p.input.sessionId,
      turnId: p.input.turnId,
      inputSha256: createHash("sha256").update(wake).digest("hex"),
    });
    if (!stopping && o.nativeFinal && p.final)
      writeFileSync(
        o.proofPath,
        JSON.stringify({ ...p.final, launchId: o.launchId }) + "\n",
        { flag: "wx", mode: 0o600 },
      );
  } catch (e) {
    usage.emit({
      provider: PROVIDER,
      reason: "parse_error",
      observedAt: new Date().toISOString(),
    });
    process.stderr.write(
      "Pi native evidence unavailable; no final proof was created.\n",
    );
  }
  process.exitCode = exit.code ?? 143;
}
