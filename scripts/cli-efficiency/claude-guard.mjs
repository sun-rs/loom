// Test-only model fence for Claude Code, used by the paid efficiency and
// drift gates. It fails closed: a launch that could run a model turn must
// carry exactly one `--model` and one `--effort` with the approved values,
// and the stream-json stdin may carry only user input, interrupts and
// control responses (no set_model / thinking / flag-settings requests).
//
// Warm drift runs additionally get an injection gate: the drift runner asks
// the shim (over a private Unix socket) to send `/compact` as a user message
// into the warm runtime's stdin while the runtime idles. The compaction's own
// frames never reach the product driver, and driver input that arrives
// meanwhile is held back and flushed afterwards, so the product sees an
// unchanged idle runtime whose native session was compacted.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, rmSync } from "node:fs";
import { createServer, createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const FORBIDDEN = new Set([
  "--fallback-model",
  "--fork-session",
  "--continue",
  "-c",
  "--settings",
  "--agents",
  "--agent",
]);

function flagValues(args, long, short) {
  const values = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === long || (short && a === short)) values.push(args[++i]);
    else if (a.startsWith(long + "=")) values.push(a.slice(long.length + 1));
  }
  return values;
}

// "version" | "catalog" | "turn"; throws for anything else.
export function classifyClaudeLaunch(args, approved) {
  assert.ok(
    approved?.model && approved?.effort,
    "Guard needs model and effort",
  );
  if (args.length === 1 && ["--version", "-v"].includes(args[0]))
    return "version";
  for (const a of args)
    if (FORBIDDEN.has(a.split("=")[0]))
      throw new Error(`Unsupported gate argument ${a}`);
  const models = flagValues(args, "--model");
  const efforts = flagValues(args, "--effort");
  const print = args.includes("--print") || args.includes("-p");
  // The product's model catalog probe: no tools, no persistence, and its
  // stdin guard below admits only the initialize control request.
  const toolsAt = args.indexOf("--tools");
  if (
    !print &&
    args.includes("--no-session-persistence") &&
    toolsAt >= 0 &&
    args[toolsAt + 1] === "" &&
    models.length === 0 &&
    efforts.length === 0
  )
    return "catalog";
  if (!print) throw new Error("Unsupported gate CLI command");
  if (models.length !== 1 || models[0] !== approved.model)
    throw new Error("Unapproved model (exactly one approved --model required)");
  if (efforts.length !== 1 || efforts[0] !== approved.effort)
    throw new Error(
      "Unapproved effort (exactly one approved --effort required)",
    );
  return "turn";
}

const TURN_CONTROLS = new Set(["interrupt"]);
const CATALOG_CONTROLS = new Set(["initialize"]);

export function createClaudeStdinGuard(mode) {
  return (line) => {
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      throw new Error("Unsupported gate stdin (not JSON)");
    }
    const type = frame?.type;
    if (type === "control_response") return frame;
    if (type === "control_request") {
      const subtype = frame.request?.subtype;
      const allowed = mode === "catalog" ? CATALOG_CONTROLS : TURN_CONTROLS;
      if (!allowed.has(subtype))
        throw new Error(`Unapproved control request ${subtype}`);
      return frame;
    }
    if (type === "user") {
      if (mode === "catalog")
        throw new Error("Unapproved user input to the catalog probe");
      return frame;
    }
    throw new Error(`Unsupported gate stdin frame ${type}`);
  };
}

const parse = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
};

export function createClaudeInjectionGate({
  toChild,
  toDriver,
  validate,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let busy = false;
  let injection;
  const held = [];
  const driverControls = new Set();
  const writeDriverInput = (line) => {
    const frame = validate(line);
    if (frame?.type === "user") busy = true;
    if (frame?.type === "control_request" && frame.request_id)
      driverControls.add(frame.request_id);
    toChild(line);
  };
  const finish = (fields) => {
    const current = injection;
    if (!current) return;
    injection = undefined;
    clearTimer(current.timer);
    clearTimer(current.quiet);
    const record = {
      compactBoundary: current.compactBoundary,
      result: current.result,
      timedOut: false,
      framesDropped: current.dropped,
      durationMs: now() - current.startedAt,
      ...fields,
    };
    for (const line of held.splice(0)) writeDriverInput(line);
    current.resolve(record);
  };
  return {
    get busy() {
      return busy;
    },
    fromDriver(line) {
      if (injection) held.push(line);
      else writeDriverInput(line);
    },
    fromChild(line) {
      const frame = parse(line);
      if (injection) {
        const id = frame?.response?.request_id;
        if (frame?.type === "control_response" && driverControls.has(id)) {
          driverControls.delete(id);
          toDriver(line);
          return;
        }
        injection.dropped += 1;
        if (frame?.type === "system" && frame.subtype === "compact_boundary") {
          injection.compactBoundary = {
            trigger: frame.compact_metadata?.trigger ?? null,
            preTokens: frame.compact_metadata?.pre_tokens ?? null,
          };
          injection.quiet = setTimer(() => finish({}), injection.quietMs);
        }
        if (frame?.type === "result") {
          injection.result = {
            subtype: frame.subtype ?? null,
            isError: frame.is_error === true,
          };
          finish({});
        }
        return;
      }
      if (frame?.type === "result") busy = false;
      if (frame?.type === "control_response")
        driverControls.delete(frame.response?.request_id);
      toDriver(line);
    },
    inject(text, { sessionId, timeoutMs = 240_000, quietMs = 15_000 } = {}) {
      if (busy || injection) return Promise.resolve({ refused: "busy" });
      const frame = {
        type: "user",
        uuid: randomUUID(),
        session_id: sessionId,
        message: { role: "user", content: text },
      };
      const line = JSON.stringify(frame);
      validate(line);
      return new Promise((resolve) => {
        injection = {
          resolve,
          startedAt: now(),
          dropped: 0,
          compactBoundary: null,
          result: null,
          quietMs,
        };
        injection.timer = setTimer(() => finish({ timedOut: true }), timeoutMs);
        toChild(line);
      });
    },
  };
}

// Shim entry: `#!/usr/bin/env node` + runGuardedClaude(real, approved, opts).
// options.injectRecordPath: warm drift only; appends {socketPath, pid,
// sessionId} for every stream-json turn process so the drift runner can ask
// for a compaction through this same fence.
export async function runGuardedClaude(executable, approved, options = {}) {
  const args = process.argv.slice(2);
  let mode;
  try {
    mode = classifyClaudeLaunch(args, approved);
  } catch (e) {
    process.stderr.write("PAID_GATE_MODEL_DENIED " + String(e) + "\n");
    process.exitCode = 1;
    return;
  }
  const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.pipe(process.stderr);
  child.stdin.on("error", () => {});
  let rejected = false;
  const deny = (e) => {
    if (rejected) return;
    rejected = true;
    process.stderr.write("PAID_GATE_MODEL_DENIED " + String(e) + "\n");
    child.kill("SIGTERM");
  };
  let server;
  let socketPath;
  if (mode === "version") {
    child.stdout.pipe(process.stdout);
    process.stdin.pipe(child.stdin);
  } else {
    const gate = createClaudeInjectionGate({
      toChild: (line) => child.stdin.write(line + "\n"),
      toDriver: (line) => process.stdout.write(line + "\n"),
      validate: createClaudeStdinGuard(mode),
    });
    const input = createInterface({ input: process.stdin });
    input.on("line", (line) => {
      if (rejected) return;
      try {
        gate.fromDriver(line);
      } catch (e) {
        deny(e);
        input.close();
      }
    });
    process.stdin.on("end", () => child.stdin.end());
    createInterface({ input: child.stdout }).on("line", (line) =>
      gate.fromChild(line),
    );
    const sessionId =
      flagValues(args, "--resume")[0] ?? flagValues(args, "--session-id")[0];
    if (
      options.injectRecordPath &&
      mode === "turn" &&
      flagValues(args, "--input-format")[0] === "stream-json"
    ) {
      socketPath = join(tmpdir(), `loom-cg-${process.pid}.sock`);
      rmSync(socketPath, { force: true });
      server = createServer((socket) => {
        let buffer = "";
        socket.on("data", async (chunk) => {
          buffer += chunk;
          const n = buffer.indexOf("\n");
          if (n < 0) return;
          const request = parse(buffer.slice(0, n)) ?? {};
          buffer = "";
          let record;
          try {
            if (request.command !== "compact")
              throw new Error("Unsupported injection command");
            record = await gate.inject("/compact", {
              sessionId,
              timeoutMs: request.timeoutMs,
            });
          } catch (e) {
            record = { error: String(e.message ?? e) };
          }
          socket.end(JSON.stringify(record) + "\n");
        });
        socket.on("error", () => {});
      });
      server.listen(socketPath, () =>
        appendFileSync(
          options.injectRecordPath,
          JSON.stringify({
            socketPath,
            pid: process.pid,
            sessionId: sessionId ?? null,
            at: new Date().toISOString(),
          }) + "\n",
          { mode: 0o600 },
        ),
      );
    }
  }
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => child.kill(signal));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  server?.close();
  if (socketPath) rmSync(socketPath, { force: true });
  // The driver's stdin may stay open; the CLI is gone, so is this fence.
  process.stdin.destroy();
  process.exitCode = rejected ? 1 : (code ?? 1);
}

// Drift runner side of the injection socket.
export function requestClaudeInjection(
  socketPath,
  command,
  timeoutMs = 240_000,
) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    socket.setTimeout(timeoutMs + 30_000, () => {
      socket.destroy();
      reject(new Error("Injection socket timed out"));
    });
    let buffer = "";
    socket.on("connect", () =>
      socket.write(JSON.stringify({ command, timeoutMs }) + "\n"),
    );
    socket.on("data", (chunk) => (buffer += chunk));
    socket.on("end", () => {
      const record = parse(buffer.trim());
      if (record) resolve(record);
      else reject(new Error("Injection socket returned no record"));
    });
    socket.on("error", reject);
  });
}
