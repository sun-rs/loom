#!/usr/bin/env node
// Free, no-model probe: time `codex app-server` (stdio JSON-RPC) initialize
// and `thread/resume` for an existing thread id, then exit without starting a
// turn. Documents cold resume cost versus session shape (rollout size/lines)
// for S2 warm runtime decisions. Each repeat spawns a fresh app-server.
//
//   node scripts/cli-efficiency/resume-probe.mjs --thread <id> \
//     [--codex <path>] [--cwd <dir>] [--repeat N] [--timeout-ms MS] [--json]
//
// Do not probe a thread another live process is currently driving. The
// rollout file's size and mtime are compared before/after and reported.
import { spawn } from "node:child_process";
import { globSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const USAGE =
  "usage: resume-probe --thread <id> [--codex <path>] [--cwd <dir>] [--repeat 1-20] [--timeout-ms MS] [--json]";

export function parseProbeArgs(argv) {
  const out = {
    thread: undefined,
    codex: "codex",
    cwd: undefined,
    repeat: 1,
    timeoutMs: 60000,
    json: false,
  };
  const fail = (why) => {
    throw new Error(`resume-probe: ${why}\n${USAGE}`);
  };
  for (let i = 0; i < argv.length; i++) {
    let [flag, value] = argv[i].split(/=(.*)/su, 2);
    if (flag === "--json" && value === undefined) {
      out.json = true;
      continue;
    }
    if (
      !["--thread", "--codex", "--cwd", "--repeat", "--timeout-ms"].includes(
        flag,
      )
    )
      fail(`unknown argument ${argv[i]}`);
    if (value === undefined) {
      value = argv[++i];
      if (value === undefined || value.startsWith("--"))
        fail(`${flag} needs a value`);
    }
    if (flag === "--thread") {
      if (!/^[A-Za-z0-9_-]{1,200}$/u.test(value)) fail("invalid thread id");
      out.thread = value;
    } else if (flag === "--codex") out.codex = value;
    else if (flag === "--cwd") out.cwd = value;
    else {
      const n = Number(value);
      const [min, max] = flag === "--repeat" ? [1, 20] : [1000, 600000];
      if (!Number.isInteger(n) || n < min || n > max)
        fail(`${flag} must be an integer in ${min}..${max}`);
      out[flag === "--repeat" ? "repeat" : "timeoutMs"] = n;
    }
  }
  if (!out.thread) fail("--thread is required");
  return out;
}

function rolloutShape(thread) {
  const home = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const paths = globSync(join(home, "sessions/**/*" + thread + "*.jsonl"));
  if (paths.length !== 1) return { found: paths.length };
  const stat = statSync(paths[0]);
  const text = readFileSync(paths[0], "utf8");
  return {
    found: 1,
    bytes: stat.size,
    lines: text.split("\n").filter(Boolean).length,
    mtimeMs: stat.mtimeMs,
  };
}

function probeOnce({ codex, cwd, thread, timeoutMs }) {
  return new Promise((resolve) => {
    const started = performance.now();
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) => !k.startsWith("RAH_") && !k.startsWith("LOOM_"),
      ),
    );
    const child = spawn(codex, ["app-server"], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const result = {};
    let buffer = "";
    let stderr = "";
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) result.error = String(error).slice(0, 500);
      if (error && stderr) result.stderr = stderr.slice(-500);
      child.stdin.end();
      child.kill("SIGTERM");
      const kill = setTimeout(() => child.kill("SIGKILL"), 2000);
      child.once("close", () => {
        clearTimeout(kill);
        resolve(result);
      });
      if (child.exitCode !== null || child.signalCode !== null) {
        clearTimeout(kill);
        resolve(result);
      }
    };
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
    let resumeSent;
    child.once("error", (e) => finish(e.message));
    child.stdin.on("error", () => {});
    child.once("close", (code, signal) =>
      finish(`codex app-server exited (code=${code}, signal=${signal})`),
    );
    child.stderr.on("data", (b) => (stderr = (stderr + b).slice(-2000)));
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let n;
      while ((n = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, n);
        buffer = buffer.slice(n + 1);
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.id === 1) {
          if (m.error) return finish("initialize: " + JSON.stringify(m.error));
          result.initializeMs = Math.round(performance.now() - started);
          send({ jsonrpc: "2.0", method: "initialized", params: {} });
          resumeSent = performance.now();
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "thread/resume",
            params: { threadId: thread },
          });
        } else if (m.id === 2) {
          if (m.error)
            return finish("thread/resume: " + JSON.stringify(m.error));
          result.resumeMs = Math.round(performance.now() - resumeSent);
          result.totalMs = Math.round(performance.now() - started);
          result.resumeResponseBytes = Buffer.byteLength(line);
          if (m.result?.thread?.id !== thread)
            return finish("thread/resume returned a different thread id");
          if (Array.isArray(m.result.thread.turns))
            result.turns = m.result.thread.turns.length;
          return finish();
        }
      }
    });
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "loom-resume-probe", title: "Loom", version: "1" },
        capabilities: { experimentalApi: true },
      },
    });
  });
}

async function main() {
  let options;
  try {
    options = parseProbeArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 64;
    return;
  }
  const tempCwd = options.cwd
    ? undefined
    : mkdtempSync(join(tmpdir(), "rah-resume-probe-"));
  const cwd = options.cwd ?? tempCwd;
  const before = rolloutShape(options.thread);
  const attempts = [];
  try {
    for (let i = 0; i < options.repeat; i++)
      attempts.push(await probeOnce({ ...options, cwd }));
  } finally {
    if (tempCwd) rmSync(tempCwd, { recursive: true, force: true });
  }
  const after = rolloutShape(options.thread);
  const report = {
    thread: options.thread,
    rollout: { ...before, mtimeMs: undefined },
    rolloutModified:
      before.found === 1 &&
      (after.bytes !== before.bytes || after.mtimeMs !== before.mtimeMs),
    attempts,
  };
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(
      `thread ${report.thread}: rollout ${before.bytes ?? "?"} bytes, ${before.lines ?? "?"} lines` +
        (report.rolloutModified ? " (MODIFIED during probe)" : ""),
    );
    for (const [i, a] of attempts.entries())
      console.log(
        a.error
          ? `#${i + 1} error: ${a.error}`
          : `#${i + 1} initialize ${a.initializeMs} ms, thread/resume ${a.resumeMs} ms, total ${a.totalMs} ms`,
      );
  }
  if (attempts.some((a) => a.error)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
