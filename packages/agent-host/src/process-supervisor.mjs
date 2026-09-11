import { spawn } from "node:child_process";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  constants,
  createReadStream,
  chmodSync,
  closeSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { createServer } from "node:net";

const protocol = "rah-process-supervisor-v1";
let readinessOpen = true;

function sendReadiness(value) {
  if (!readinessOpen) return;
  readinessOpen = false;
  writeSync(3, `${JSON.stringify(value)}\n`);
  closeSync(3);
}

function failStartup(message) {
  sendReadiness({ error: message, status: "error" });
  process.exitCode = 1;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

let config;
let controlToken;
try {
  config = JSON.parse(
    requiredString(
      process.env.RAH_PROCESS_SUPERVISOR_CONFIG,
      "RAH_PROCESS_SUPERVISOR_CONFIG",
    ),
  );
  controlToken = requiredString(
    process.env.RAH_PROCESS_SUPERVISOR_TOKEN,
    "RAH_PROCESS_SUPERVISOR_TOKEN",
  );
  requiredString(config.command, "command");
  requiredString(config.cwd, "cwd");
  requiredString(config.resultPath, "resultPath");
  requiredString(config.runAttemptId, "runAttemptId");
  requiredString(config.runtimeRunId, "runtimeRunId");
  requiredString(config.socketPath, "socketPath");
  requiredString(config.supervisorId, "supervisorId");
  if (!Array.isArray(config.args)) throw new Error("args must be an array");
  if (config.expectedExecutableIdentity !== undefined) {
    const identity = config.expectedExecutableIdentity;
    requiredString(identity.requestedExecutable, "requestedExecutable");
    requiredString(identity.resolvedExecutablePath, "resolvedExecutablePath");
    if (!/^sha256:[a-f0-9]{64}$/.test(identity.contentDigest)) {
      throw new Error("contentDigest must be a SHA-256 digest");
    }
    if (!Number.isInteger(identity.byteLength) || identity.byteLength < 0) {
      throw new Error("byteLength must be a non-negative integer");
    }
  }
  for (const [name, value] of [
    ["controlRequestTimeoutMs", config.controlRequestTimeoutMs],
    ["startupTimeoutMs", config.startupTimeoutMs],
  ]) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
  if (
    !Number.isInteger(config.terminationGraceMs) ||
    config.terminationGraceMs < 0
  ) {
    throw new Error("terminationGraceMs must be a non-negative integer");
  }
} catch (error) {
  failStartup(error instanceof Error ? error.message : String(error));
  process.exit();
}

delete process.env.RAH_PROCESS_SUPERVISOR_CONFIG;
delete process.env.RAH_PROCESS_SUPERVISOR_TOKEN;

let child;
let groupCheckTimer;
let launchTimer;
let leaderExit;
let phase = "prepared";
let terminalExit;
let terminationStarted = false;
let terminationTimer;
const connections = new Set();
const terminalWaiters = new Set();

function sameToken(candidate) {
  if (typeof candidate !== "string") return false;
  const expected = Buffer.from(controlToken, "utf8");
  const provided = Buffer.from(candidate, "utf8");
  return (
    expected.byteLength === provided.byteLength &&
    timingSafeEqual(expected, provided)
  );
}

function response(socket, value) {
  if (!socket.destroyed) socket.end(`${JSON.stringify(value)}\n`);
}

function signalChildGroup(signal) {
  const pid = child?.pid;
  if (pid === undefined || pid <= 0) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    )) {
      throw error;
    }
  }
}

function signalChildLeader(signal) {
  const pid = child?.pid;
  if (pid === undefined || pid <= 0) return;
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    )) {
      throw error;
    }
  }
}

function requestTermination() {
  if (terminalExit || phase !== "running" || terminationStarted) return;
  terminationStarted = true;
  // The supervised leader may be a structured Provider adapter. Give it the
  // first graceful signal so it can translate cancellation into the native
  // protocol (for example ACP session/cancel or Codex turn/interrupt). Sending
  // SIGTERM to the whole group here would race that protocol message by also
  // terminating the Provider child. The hard deadline still targets the full
  // process group, preserving the no-orphan terminal proof.
  signalChildLeader("SIGTERM");
  terminationTimer = setTimeout(() => {
    if (!terminalExit) signalChildGroup("SIGKILL");
  }, config.terminationGraceMs);
}

function processGroupExists() {
  const pid = child?.pid;
  if (pid === undefined || pid <= 0) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return false;
    }
    if (error instanceof Error && "code" in error && error.code === "EPERM") {
      return true;
    }
    throw error;
  }
}

function finalizeTerminalResult() {
  if (terminalExit || !leaderExit) return;
  if (launchTimer) clearTimeout(launchTimer);
  if (terminationTimer) clearTimeout(terminationTimer);
  if (groupCheckTimer) clearTimeout(groupCheckTimer);
  terminalExit = leaderExit;
  phase = "terminal";
  const payload = {
    exit: terminalExit,
    protocol,
    runAttemptId: config.runAttemptId,
    runtimeRunId: config.runtimeRunId,
    supervisorId: config.supervisorId,
  };
  const result = {
    mac: createHmac("sha256", controlToken)
      .update(JSON.stringify(payload))
      .digest("hex"),
    payload,
  };
  const temporaryResultPath = `${config.resultPath}.tmp-${process.pid}`;
  writeFileSync(temporaryResultPath, JSON.stringify(result), { mode: 0o600 });
  renameSync(temporaryResultPath, config.resultPath);
  for (const socket of terminalWaiters) {
    response(socket, { exit: terminalExit, ok: true });
  }
  terminalWaiters.clear();
  for (const socket of connections) {
    if (!socket.writableEnded && !socket.destroyed) socket.destroy();
  }
  server.close(() => rmSync(config.socketPath, { force: true }));
}

function finishWithoutLaunch(signal) {
  if (phase !== "prepared" || terminalExit) return;
  leaderExit = { code: null, signal };
  finalizeTerminalResult();
}

function verifyProcessGroupTermination() {
  if (!leaderExit || terminalExit) return;
  if (!processGroupExists()) {
    finalizeTerminalResult();
    return;
  }
  requestTermination();
  groupCheckTimer = setTimeout(verifyProcessGroupTermination, 5);
}

function forwardDiagnostics(source, destination) {
  let available = true;
  let writable = true;
  destination.on("drain", () => {
    writable = true;
  });
  destination.on("error", () => {
    available = false;
  });
  source?.on("data", (chunk) => {
    if (available && writable && !destination.destroyed) {
      writable = destination.write(chunk);
    }
  });
}

function forwardActivity(source) {
  let available = true;
  source?.on("data", (chunk) => {
    if (!available) return;
    try {
      writeSync(4, chunk);
    } catch {
      available = false;
    }
  });
}

async function launchTarget(socket) {
  if (phase === "running") {
    response(socket, { ok: true, status: "running" });
    return;
  }
  if (phase !== "prepared") {
    response(socket, { error: "runtime is already terminal", ok: false });
    return;
  }
  if (launchTimer) clearTimeout(launchTimer);
  try {
    await verifyExecutableIdentity();
  } catch {
    response(socket, {
      error: "executable identity changed after probe",
      ok: false,
    });
    finishWithoutLaunch("RAH_START_FAILED");
    return;
  }
  try {
    child = spawn(config.command, config.args, {
      cwd: config.cwd,
      detached: true,
      env: process.env,
      shell: false,
      stdio: [
        config.nativeBusyInput === true ? "pipe" : "ignore",
        "pipe",
        "pipe",
        "pipe",
      ],
    });
  } catch (error) {
    response(socket, {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    });
    finishWithoutLaunch("RAH_START_FAILED");
    return;
  }

  child.stdin?.on("error", () => {
    /* failed input leaves durable follow-up pending */
  });
  forwardDiagnostics(child.stdout, process.stdout);
  forwardDiagnostics(child.stderr, process.stderr);
  forwardActivity(child.stdio[3]);
  child.once("error", (error) => {
    if (phase === "prepared") {
      response(socket, {
        error: `target process failed: ${error.message}`,
        ok: false,
      });
      finishWithoutLaunch("RAH_START_FAILED");
    }
  });
  child.once("spawn", () => {
    phase = "running";
    response(socket, { ok: true, status: "running" });
  });
  child.once("close", (code, signal) => {
    if (phase === "prepared") return;
    leaderExit = signal === null ? { code } : { code, signal };
    verifyProcessGroupTermination();
  });
}

async function verifyExecutableIdentity() {
  const expected = config.expectedExecutableIdentity;
  if (expected === undefined) return;
  const resolvedPath = await realpath(config.command);
  const metadata = await stat(resolvedPath);
  await access(resolvedPath, constants.X_OK);
  if (
    resolvedPath !== expected.resolvedExecutablePath ||
    !metadata.isFile() ||
    metadata.size !== expected.byteLength
  ) {
    throw new Error("executable identity changed after probe");
  }
  const digest = await hashFile(resolvedPath);
  if (digest !== expected.contentDigest) {
    throw new Error("executable identity changed after probe");
  }
}

async function hashFile(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", resolvePromise);
    stream.once("error", reject);
  });
  return `sha256:${hash.digest("hex")}`;
}

const server = createServer((socket) => {
  connections.add(socket);
  socket.once("close", () => {
    connections.delete(socket);
    terminalWaiters.delete(socket);
  });
  socket.setTimeout(config.controlRequestTimeoutMs, () => {
    response(socket, { error: "control request timed out", ok: false });
  });
  let request = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    request += chunk;
    if (Buffer.byteLength(request) > 8_192) {
      response(socket, { error: "control request is too large", ok: false });
      return;
    }
    const newline = request.indexOf("\n");
    if (newline < 0) return;
    socket.pause();
    let command;
    try {
      command = JSON.parse(request.slice(0, newline));
    } catch {
      response(socket, { error: "invalid control request", ok: false });
      return;
    }
    if (
      command.protocol !== protocol ||
      command.runAttemptId !== config.runAttemptId ||
      command.runtimeRunId !== config.runtimeRunId ||
      command.supervisorId !== config.supervisorId ||
      !sameToken(command.controlToken)
    ) {
      response(socket, {
        error: "supervisor identity authentication failed",
        ok: false,
      });
      return;
    }
    if (command.command === "launch") {
      void launchTarget(socket);
      return;
    }
    if (command.command === "notify") {
      const input = command.input;
      if (
        config.nativeBusyInput !== true ||
        phase !== "running" ||
        terminalExit ||
        leaderExit ||
        typeof input !== "string" ||
        Buffer.byteLength(input) > 6000 ||
        !child?.stdin?.writable ||
        child.stdin.writableLength > 8192
      ) {
        response(socket, { error: "runtime input unavailable", ok: false });
        return;
      }
      child.stdin.write(input, (error) =>
        response(
          socket,
          error
            ? { error: "runtime input write failed", ok: false }
            : { ok: true },
        ),
      );
      return;
    }
    if (command.command !== "terminate") {
      response(socket, { error: "unsupported control command", ok: false });
      return;
    }
    if (terminalExit) {
      response(socket, { exit: terminalExit, ok: true });
      return;
    }
    if (phase === "prepared") {
      terminalWaiters.add(socket);
      finishWithoutLaunch("RAH_NOT_STARTED");
      return;
    }
    terminalWaiters.add(socket);
    requestTermination();
  });
});

server.on("error", (error) => {
  if (readinessOpen) {
    failStartup(`control server failed: ${error.message}`);
    rmSync(config.socketPath, { force: true });
    return;
  }
  if (phase === "prepared") finishWithoutLaunch("RAH_CONTROL_FAILED");
  else requestTermination();
});

for (const signal of ["SIGINT", "SIGHUP", "SIGTERM"]) {
  process.on(signal, () => {
    if (phase === "prepared") finishWithoutLaunch(`RAH_${signal}`);
    else requestTermination();
  });
}

server.listen(config.socketPath, () => {
  chmodSync(config.socketPath, 0o600);
  launchTimer = setTimeout(
    () => finishWithoutLaunch("RAH_LAUNCH_TIMEOUT"),
    config.startupTimeoutMs,
  );
  sendReadiness({ status: "prepared", supervisorId: config.supervisorId });
});
