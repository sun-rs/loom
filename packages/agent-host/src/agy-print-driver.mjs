import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { createHash } from "node:crypto";
import { writeSync, writeFileSync, existsSync, lstatSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { readProviderPromptFile } from "./provider-prompt-file.js";
import { nativeFinalTextInstructions } from "./final-output-instructions.js";
import { ProviderUsageWriter } from "./provider-usage.js";
import { AgyStream } from "./agy-stream.mjs";
const PROVIDER = "agy-print-json/v1",
  LIMIT = 32 * 1024 * 1024;
const emit = (f) => {
  writeSync(3, JSON.stringify(f) + "\n");
};
function options(args) {
  const envelope = JSON.parse(
    process.env.RAH_PROVIDER_LAUNCH_ARGS_JSON || "{}",
  );
  if (
    envelope.runtimeId === "agy" &&
    (envelope.overrideArgs != null || envelope.additionalArgs?.length)
  )
    throw Error("AGY launch overrides unsupported");
  const o = { directories: [] };
  const keys = {
    "--executable": "executable",
    "--model": "model",
    "--reasoning": "reasoning",
    "--resume-session": "resumeSession",
    "--launch-id": "launchId",
    "--final-proof-file": "proofPath",
    "--tool-access-mode": "access",
    "--prompt": "prompt",
  };
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    if (k === "--native-final-text") {
      o.nativeFinal = true;
      continue;
    }
    const v = args[++i];
    if (v === undefined) throw Error("missing option");
    if (keys[k]) o[keys[k]] = v;
    else if (k === "--add-dir") {
      if (!isAbsolute(v)) throw Error("attached directory must be absolute");
      o.directories.push(v);
    } else if (k === "--prompt-file") o.prompt = readProviderPromptFile(v);
    else if (k === "--wake-input-file") o.wake = readProviderPromptFile(v);
    else throw Error("unknown option");
  }
  for (const k of ["executable", "model", "reasoning", "launchId", "proofPath"])
    if (!o[k]?.trim()) throw Error("missing option");
  if (o.access !== "full_access" || !isAbsolute(o.proofPath))
    throw Error("invalid launch");
  const d = lstatSync(dirname(o.proofPath));
  if (
    !d.isDirectory() ||
    d.isSymbolicLink() ||
    d.uid !== process.getuid?.() ||
    d.mode & 0o077 ||
    existsSync(o.proofPath)
  )
    throw Error("proof must be fresh and private");
  return o;
}
try {
  await main();
} catch {
  process.stderr.write(
    "AGY launch or native evidence failed; no final reply was published.\n",
  );
  process.exitCode = 1;
}
async function main() {
  const o = options(process.argv.slice(2));
  let wake = o.wake;
  if (wake === undefined) {
    wake = "";
    const dec = new StringDecoder("utf8");
    for await (const b of process.stdin) {
      wake += dec.write(b);
      if (Buffer.byteLength(wake) > LIMIT) throw Error("input limit");
    }
    wake += dec.end();
  }
  if (!wake.trim()) throw Error("empty input");
  // AGY has no system-prompt flag. Seed the frozen Role on the first turn only;
  // later protocol/identity notices are already in the host-owned wake delta.
  const prompt = o.resumeSession
    ? wake
    : `[Loom standing instructions]\n${nativeFinalTextInstructions(o.prompt ?? "", o.nativeFinal)}\n\n[Current delivery]\n${wake}`;
  if (Buffer.byteLength(prompt) > 128 * 1024)
    throw Error("AGY argv input exceeds supported bound");
  const args = [
    "-p",
    prompt,
    "--model",
    o.model,
    "--effort",
    o.reasoning,
    "--output-format",
    "stream-json",
    "--dangerously-skip-permissions",
    "--print-timeout",
    "0s",
    ...o.directories.flatMap((directory) => ["--add-dir", directory]),
    ...(o.resumeSession ? ["--conversation", o.resumeSession] : []),
  ];
  const parser = new AgyStream(o),
    usage = new ProviderUsageWriter(),
    decoder = new StringDecoder("utf8");
  const child = spawn(o.executable, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  let buffer = "",
    bytes = 0,
    invalid = false,
    stopping = false,
    timer;
  const stop = () => {
    stopping = true;
    child.kill("SIGTERM");
    timer = setTimeout(() => child.kill("SIGKILL"), 500);
    timer.unref();
  };
  const gap = () =>
    usage.emit({
      provider: PROVIDER,
      reason: "parse_error",
      observedAt: new Date().toISOString(),
    });
  const line = (l) => {
    if (invalid) return;
    try {
      const r = parser.push(JSON.parse(l));
      if (r.sessionId)
        emit({
          protocol: "rah-provider-session/v1",
          provider: PROVIDER,
          providerSessionId: r.sessionId,
          state: "ready",
        });
      if (r.turnId)
        emit({
          protocol: "rah-delivery-accepted/v1",
          provider: PROVIDER,
          signal: "session.user-input",
          threadId: parser.session,
          turnId: r.turnId,
          inputSha256: createHash("sha256").update(wake).digest("hex"),
        });
      if (r.usage) usage.emit(r.usage);
      if (r.usageGap) gap();
    } catch {
      invalid = true;
      gap();
      stop();
    }
  };
  child.stderr.pipe(process.stderr);
  child.stdout.on("data", (b) => {
    process.stdout.write(b);
    bytes += b.length;
    if (bytes > LIMIT) {
      invalid = true;
      stop();
      return;
    }
    buffer += decoder.write(b);
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const l = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (l.trim()) line(l);
    }
  });
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  process.removeListener("SIGTERM", stop);
  process.removeListener("SIGINT", stop);
  buffer += decoder.end();
  if (buffer.trim() || invalid || stopping || exit.code !== 0 || exit.signal) {
    gap();
    throw Error("incomplete invocation");
  }
  let final;
  try {
    final = parser.finish();
  } catch (error) {
    gap();
    throw error;
  }
  if (o.nativeFinal)
    writeFileSync(
      o.proofPath,
      JSON.stringify({ ...final, launchId: o.launchId }) + "\n",
      { flag: "wx", mode: 0o600 },
    );
}
