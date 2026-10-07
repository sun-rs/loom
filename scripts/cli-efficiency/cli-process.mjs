// One native CLI process per round: stdout lines with arrival times, a
// bounded stderr tail, and a hard timeout (the native arms of the gates).
import { spawn } from "node:child_process";

// Environment without gate/runtime variables or a nested Claude Code marker.
export function nativeEnvironment(extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.startsWith("RAH_") && !k.startsWith("LOOM_"),
    ),
  );
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return { ...env, ...extra };
}

export async function runLines({
  executable,
  args,
  cwd,
  env,
  onSpawn,
  input,
  timeoutMs = 240_000,
}) {
  if (input !== undefined && typeof input !== "string")
    throw new TypeError("CLI input must be text");
  const entries = [];
  let buffer = "";
  let stderr = "";
  const child = spawn(executable, args, {
    cwd,
    // OpenCode resolves its root from PWD before process.cwd(). A parent's
    // stale PWD must never redirect the native arm away from its fixture.
    env: { ...env, PWD: cwd },
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  let inputError;
  if (input !== undefined) {
    child.stdin.on("error", (error) => {
      inputError = String(error);
    });
    child.stdin.end(input);
  }
  onSpawn?.(child.pid);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, timeoutMs);
  const killTimer = setTimeout(() => child.kill("SIGKILL"), timeoutMs + 10_000);
  child.stderr.on("data", (b) => (stderr = (stderr + b).slice(-1500)));
  child.stdout.on("data", (b) => {
    buffer += b;
    let n;
    while ((n = buffer.indexOf("\n")) >= 0) {
      entries.push({ line: buffer.slice(0, n), at: Date.now() });
      buffer = buffer.slice(n + 1);
    }
  });
  try {
    const exit = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code));
    });
    if (buffer) entries.push({ line: buffer, at: Date.now() });
    return {
      entries,
      exit,
      stderr,
      timedOut,
      ...(inputError ? { inputError } : {}),
    };
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
  }
}
