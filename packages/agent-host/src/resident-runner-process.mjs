import { spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname } from "node:path";

const protocol = "rah-resident-runner-control-v1";
let readinessOpen = true;

function sendReadiness(value) {
  if (!readinessOpen) return;
  readinessOpen = false;
  writeSync(3, `${JSON.stringify(value)}\n`);
  closeSync(3);
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
      process.env.RAH_RESIDENT_RUNNER_CONFIG,
      "RAH_RESIDENT_RUNNER_CONFIG",
    ),
  );
  controlToken = requiredString(
    process.env.RAH_RESIDENT_RUNNER_TOKEN,
    "RAH_RESIDENT_RUNNER_TOKEN",
  );
  if (config.protocol !== protocol) throw new Error("protocol is invalid");
  requiredString(config.command, "command");
  requiredString(config.cwd, "cwd");
  requiredString(config.instanceId, "instanceId");
  requiredString(config.resultPath, "resultPath");
  requiredString(config.socketPath, "socketPath");
  if (!Array.isArray(config.args)) throw new Error("args must be an array");
  if (
    typeof config.targetEnv !== "object" ||
    config.targetEnv === null ||
    Array.isArray(config.targetEnv)
  ) {
    throw new Error("targetEnv must be an object");
  }
  for (const name of [
    "controlRequestTimeoutMs",
    "launchTimeoutMs",
    "processGeneration",
    "terminationGraceMs",
  ]) {
    if (!Number.isSafeInteger(config[name]) || config[name] <= 0) {
      throw new Error(`${name} must be a positive safe integer`);
    }
  }
  if (process.platform === "win32") {
    throw new Error("resident control wrapper requires a POSIX platform");
  }
  try {
    lstatSync(config.socketPath);
    throw new Error("control socket path already exists");
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    )) {
      throw error;
    }
  }
} catch (error) {
  sendReadiness({
    error: error instanceof Error ? error.message : String(error),
    status: "error",
  });
  process.exit(1);
}

delete process.env.RAH_RESIDENT_RUNNER_CONFIG;
delete process.env.RAH_RESIDENT_RUNNER_TOKEN;

let child;
let connected = false;
let leaderExit;
let launchTimer;
let terminalObservation;
let terminalReason;
let terminationStarted = false;
let terminationTimer;
let groupCheckTimer;
let phase = "prepared";
const connections = new Set();

function exactKeys(value, expected) {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

function sameToken(candidate) {
  if (typeof candidate !== "string") return false;
  const expected = Buffer.from(controlToken, "utf8");
  const actual = Buffer.from(candidate, "utf8");
  return (
    expected.byteLength === actual.byteLength &&
    timingSafeEqual(expected, actual)
  );
}

function response(socket, value) {
  if (!socket.destroyed) socket.end(`${JSON.stringify(value)}\n`);
}

function signalTargetGroup(signal) {
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

function targetGroupExists() {
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

function requestTermination() {
  if (terminalObservation || terminationStarted) return;
  terminationStarted = true;
  if (phase === "prepared") {
    leaderExit = { code: null, signal: "SIGTERM" };
    finalizeTerminal();
    return;
  }
  signalTargetGroup("SIGTERM");
  terminationTimer = setTimeout(() => {
    if (!terminalObservation) signalTargetGroup("SIGKILL");
  }, config.terminationGraceMs);
}

function verifyTargetGroupTermination() {
  if (!leaderExit || terminalObservation) return;
  if (!targetGroupExists()) {
    finalizeTerminal();
    return;
  }
  requestTermination();
  groupCheckTimer = setTimeout(verifyTargetGroupTermination, 5);
}

function writeTerminalResult(observation) {
  const payload = {
    instanceId: config.instanceId,
    observation,
    processGeneration: config.processGeneration,
    protocol,
  };
  const result = {
    mac: createHmac("sha256", controlToken)
      .update(JSON.stringify(payload))
      .digest("hex"),
    payload,
  };
  const temporaryPath = `${config.resultPath}.tmp-${String(process.pid)}`;
  const descriptor = openSync(
    temporaryPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    writeFileSync(descriptor, JSON.stringify(result), "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporaryPath, config.resultPath);
  const directory = openSync(dirname(config.resultPath), constants.O_RDONLY);
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

function finalizeTerminal() {
  if (terminalObservation || !leaderExit) return;
  if (launchTimer) clearTimeout(launchTimer);
  if (terminationTimer) clearTimeout(terminationTimer);
  if (groupCheckTimer) clearTimeout(groupCheckTimer);
  terminalObservation = {
    ...leaderExit,
    ...(terminalReason === undefined ? {} : { reason: terminalReason }),
  };
  phase = "terminal";
  writeTerminalResult(terminalObservation);
  for (const socket of connections) {
    if (!socket.destroyed) socket.destroy();
  }
  server.close(() => {
    rmSync(config.socketPath, { force: true });
    process.exit(0);
  });
}

function launchTarget(socket) {
  if (phase === "launching" || phase === "starting" || phase === "running") {
    response(socket, { ok: true, status: phase });
    return;
  }
  if (phase !== "prepared") {
    response(socket, { error: "resident runner is terminal", ok: false });
    return;
  }
  clearTimeout(launchTimer);
  try {
    child = spawn(config.command, config.args, {
      cwd: config.cwd,
      detached: true,
      env: {
        ...config.targetEnv,
        RAH_RESIDENT_PROCESS_GENERATION: String(config.processGeneration),
      },
      shell: false,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    });
    phase = "launching";
  } catch (error) {
    response(socket, {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    });
    leaderExit = { code: null, signal: "RAH_START_FAILED" };
    finalizeTerminal();
    return;
  }
  child.once("error", (error) => {
    if (phase !== "launching") return;
    response(socket, { error: error.message, ok: false });
    leaderExit = { code: null, signal: "RAH_START_FAILED" };
    finalizeTerminal();
  });
  child.once("spawn", () => {
    if (terminalObservation) return;
    phase = "starting";
    response(socket, { ok: true, status: phase });
  });
  child.on("message", (message) => {
    if (
      typeof message !== "object" ||
      message === null ||
      Array.isArray(message)
    ) {
      return;
    }
    if (
      message.kind === "resident-runner-connected" &&
      exactKeys(message, ["kind", "processGeneration"]) &&
      message.processGeneration === config.processGeneration &&
      phase === "starting"
    ) {
      connected = true;
      phase = "running";
      return;
    }
    if (
      message.kind === "resident-runner-terminal" &&
      exactKeys(message, ["kind", "processGeneration", "reason"]) &&
      message.processGeneration === config.processGeneration &&
      (message.reason === "configuration" ||
        message.reason === "attachment_revoked")
    ) {
      terminalReason ??= message.reason;
    }
  });
  child.once("close", (code, signal) => {
    leaderExit =
      signal === null ? { code, signal: null } : { code: null, signal };
    verifyTargetGroupTermination();
  });
}

function authenticated(command) {
  return (
    command.protocol === protocol &&
    command.instanceId === config.instanceId &&
    command.processGeneration === config.processGeneration &&
    sameToken(command.controlToken)
  );
}

const server = createServer((socket) => {
  connections.add(socket);
  socket.once("close", () => connections.delete(socket));
  socket.setEncoding("utf8");
  socket.setTimeout(config.controlRequestTimeoutMs, () => {
    response(socket, { error: "control request timed out", ok: false });
  });
  let request = "";
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
      typeof command !== "object" ||
      command === null ||
      Array.isArray(command) ||
      !authenticated(command)
    ) {
      response(socket, {
        error: "resident runner identity authentication failed",
        ok: false,
      });
      return;
    }
    if (command.command === "inspect") {
      response(socket, {
        connected,
        ok: true,
        processId: process.pid,
        status: phase,
      });
      return;
    }
    if (command.command === "launch") {
      launchTarget(socket);
      return;
    }
    if (command.command === "stop") {
      response(socket, { ok: true, status: "stopping" });
      requestTermination();
      return;
    }
    response(socket, { error: "unsupported control command", ok: false });
  });
});

server.on("error", (error) => {
  if (readinessOpen) {
    sendReadiness({ error: error.message, status: "error" });
    rmSync(config.socketPath, { force: true });
    process.exit(1);
  }
  requestTermination();
});

for (const signal of ["SIGINT", "SIGHUP", "SIGTERM"]) {
  process.on(signal, requestTermination);
}

server.listen(config.socketPath, () => {
  chmodSync(config.socketPath, 0o600);
  launchTimer = setTimeout(() => {
    leaderExit = { code: null, signal: "RAH_LAUNCH_TIMEOUT" };
    finalizeTerminal();
  }, config.launchTimeoutMs);
  sendReadiness({
    instanceId: config.instanceId,
    processGeneration: config.processGeneration,
    processId: process.pid,
    status: "prepared",
  });
});
