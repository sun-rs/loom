import { spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
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

function requestTermination() {
  if (terminalExit || phase !== "running" || terminationStarted) return;
  terminationStarted = true;
  signalChildGroup("SIGTERM");
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

function launchTarget(socket) {
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
    child = spawn(config.command, config.args, {
      cwd: config.cwd,
      detached: true,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    response(socket, {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    });
    finishWithoutLaunch("RAH_START_FAILED");
    return;
  }

  forwardDiagnostics(child.stdout, process.stdout);
  forwardDiagnostics(child.stderr, process.stderr);
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
      launchTarget(socket);
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
