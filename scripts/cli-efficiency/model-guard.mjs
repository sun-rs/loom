import {
  classifyCodexExecLaunch,
  observeGuardedCodexExec,
} from "./codex-exec-guard.mjs";
import { isDeepStrictEqual } from "node:util";
import { WorkerFinalOutputEnvelopeSchema } from "@rah-os/protocol";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { providerLaunchSwitches } from "../../packages/agent-host/src/provider-launch-arguments.js";
import { codexWorkerMcpConfig } from "../../packages/agent-host/src/codex-worker-mcp-config.mjs";
import { startGuardedUnixProxy } from "./ws-guard.mjs";

// The product's process-only Codex switches (memory, multi_agent, goals,
// global personal-config isolation), exactly as the product passes them.
// Per-name user MCP disables are admitted only as `enabled=false`.
const FINAL_OUTPUT_SCHEMA = WorkerFinalOutputEnvelopeSchema.toJSONSchema({
  target: "draft-7",
});
const PRODUCT_CONFIG = new Set(
  providerLaunchSwitches("codex").args.filter((a) => a !== "-c"),
);
// Only the product helper's complete local internal server configuration.
// Socket and runtime secret are inherited env; neither is copied into argv.
const WORKER_MCP_CONFIG = new Set(
  codexWorkerMcpConfig({
    LOOM_WORKER_MCP_SOCKET: "/unused-gate-config.sock",
    LOOM_WORKER_MCP_SECRET: "validation-only",
  }).args.filter((value) => value !== "-c"),
);
const WORKER_MCP_PREFIX = "mcp_servers.loom_worker.";
const MCP_DISABLE = /^mcp_servers\.[^.=]+\.enabled=false$/u;
// Thread-level config keys besides the approved effort, only as `false`.
const PRODUCT_FALSE_KEYS = new Set(
  [...PRODUCT_CONFIG]
    .filter((a) => a.endsWith("=false"))
    .map((a) => a.split("=")[0]),
);
const SANDBOXES = new Set([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
const isRecord = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const refuse = (why) => {
  throw new Error(`Unsupported gate request: ${why}`);
};
function onlyKeys(value, allowed, where) {
  if (value === undefined) return {};
  if (!isRecord(value)) refuse(`${where} is not an object`);
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) refuse(`${where}.${key}`);
  return value;
}
const str = (v, where) => {
  if (typeof v !== "string" || v === "") refuse(`${where} must be a string`);
};
function textInput(input, where) {
  if (!Array.isArray(input) || input.length === 0)
    refuse(`${where}.input must be text items`);
  for (const item of input) {
    onlyKeys(item, ["type", "text"], `${where}.input[]`);
    if (item.type !== "text" || typeof item.text !== "string")
      refuse(`${where}.input[] must be text`);
  }
}
const THREAD_KEYS = [
  "model",
  "config",
  "approvalPolicy",
  "cwd",
  "developerInstructions",
  "experimentalRawEvents",
  "sandbox",
  // Channel attached directories (evo status §39): [cwd, ...attached].
  "runtimeWorkspaceRoots",
];
function threadParams(p, approved, where, extra) {
  onlyKeys(p, [...THREAD_KEYS, ...extra], where);
  assert.equal(p.model, approved.model, "Unapproved model");
  const config = onlyKeys(
    p.config,
    [...PRODUCT_FALSE_KEYS, "model_reasoning_effort"],
    `${where}.config`,
  );
  assert.equal(
    config.model_reasoning_effort,
    approved.effort,
    "Unapproved effort",
  );
  for (const key of PRODUCT_FALSE_KEYS)
    if (config[key] !== undefined && config[key] !== false)
      refuse(`${where}.config.${key} must be false`);
  if (p.approvalPolicy !== undefined && p.approvalPolicy !== "never")
    refuse(`${where}.approvalPolicy`);
  if (p.sandbox !== undefined && !SANDBOXES.has(p.sandbox))
    refuse(`${where}.sandbox`);
  if (p.cwd !== undefined) str(p.cwd, `${where}.cwd`);
  if (
    p.runtimeWorkspaceRoots !== undefined &&
    (!Array.isArray(p.runtimeWorkspaceRoots) ||
      p.runtimeWorkspaceRoots.length === 0 ||
      !p.runtimeWorkspaceRoots.every(
        (r) => typeof r === "string" && r.startsWith("/"),
      ))
  )
    refuse(`${where}.runtimeWorkspaceRoots must be absolute paths`);
  if (
    p.developerInstructions !== undefined &&
    typeof p.developerInstructions !== "string"
  )
    refuse(`${where}.developerInstructions`);
  if (
    p.experimentalRawEvents !== undefined &&
    typeof p.experimentalRawEvents !== "boolean"
  )
    refuse(`${where}.experimentalRawEvents`);
}

// Whitelist validator for one exact model/effort pair: only the JSON-RPC
// methods and parameters the product drivers (and the drift compaction
// client) actually send pass; everything else fails closed.
export function createCodexRequestGuard(approved) {
  assert.ok(
    approved?.model && approved?.effort,
    "Guard needs model and effort",
  );
  return (message) => {
    if (!isRecord(message)) refuse("frame is not an object");
    if (message.method === undefined) {
      // A response to a server request (approval decision or error).
      onlyKeys(message, ["id", "jsonrpc", "result", "error"], "response");
      if (message.id === undefined) refuse("response without id");
      if ((message.result === undefined) === (message.error === undefined))
        refuse("response needs exactly one of result/error");
      return;
    }
    onlyKeys(message, ["id", "jsonrpc", "method", "params"], "frame");
    const p = message.params ?? {};
    const where = String(message.method);
    switch (message.method) {
      case "initialize": {
        onlyKeys(p, ["capabilities", "clientInfo"], where);
        onlyKeys(p.capabilities, ["experimentalApi"], `${where}.capabilities`);
        onlyKeys(
          p.clientInfo,
          ["name", "title", "version"],
          `${where}.clientInfo`,
        );
        return;
      }
      case "initialized":
        onlyKeys(p, [], where);
        return;
      case "thread/start":
        return threadParams(p, approved, where, []);
      case "thread/resume":
        threadParams(p, approved, where, ["threadId", "excludeTurns"]);
        str(p.threadId, `${where}.threadId`);
        if (p.excludeTurns !== undefined && p.excludeTurns !== true)
          refuse(`${where}.excludeTurns`);
        return;
      case "mcpServerStatus/list":
        onlyKeys(p, ["threadId", "serverName"], where);
        str(p.threadId, `${where}.threadId`);
        if (p.serverName !== "loom_worker") refuse(`${where}.serverName`);
        return;
      case "thread/compact/start":
        onlyKeys(p, ["threadId"], where);
        str(p.threadId, `${where}.threadId`);
        return;
      case "turn/start":
        onlyKeys(
          p,
          [
            "threadId",
            "input",
            "clientUserMessageId",
            "model",
            "effort",
            "outputSchema",
          ],
          where,
        );
        if (
          Object.hasOwn(p, "outputSchema") &&
          !isDeepStrictEqual(p.outputSchema, FINAL_OUTPUT_SCHEMA)
        )
          refuse(`${where}.outputSchema`);
        if (p.model !== undefined)
          assert.equal(p.model, approved.model, "Unapproved turn model");
        if (p.effort !== undefined)
          assert.equal(p.effort, approved.effort, "Unapproved turn effort");
        str(p.threadId, `${where}.threadId`);
        textInput(p.input, where);
        return;
      case "turn/steer":
        onlyKeys(p, ["threadId", "expectedTurnId", "input"], where);
        str(p.threadId, `${where}.threadId`);
        str(p.expectedTurnId, `${where}.expectedTurnId`);
        textInput(p.input, where);
        return;
      case "turn/interrupt":
        onlyKeys(p, ["threadId", "turnId"], where);
        str(p.threadId, `${where}.threadId`);
        str(p.turnId, `${where}.turnId`);
        return;
      default:
        refuse(`method ${where}`);
    }
  };
}

// Drift attach evidence: the cwd and workspace roots of an admitted
// thread/start|resume (null for every other frame). Never the instructions.
export function codexThreadRecord(message, at = new Date().toISOString()) {
  if (!["thread/start", "thread/resume"].includes(message?.method)) return null;
  const p = message.params ?? {};
  return {
    kind: "thread",
    at,
    method: message.method,
    cwd: typeof p.cwd === "string" ? p.cwd : null,
    runtimeWorkspaceRoots: Array.isArray(p.runtimeWorkspaceRoots)
      ? p.runtimeWorkspaceRoots
      : null,
  };
}

// argv whitelist: `--version`, the catalog probe `debug models [--bundled]`,
// and `app-server` with only the product's own `-c` pairs and one
// `--listen`. Every other subcommand (`debug app-server send-message-v2`,
// `app-server daemon|proxy`, ...) could start or reach a model turn outside
// this fence and is refused. Ordinary exec has a separate opt-in argv fence;
// selecting it refuses app-server instead of silently substituting transports.
export function classifyCodexLaunch(args, options) {
  if (args[0] === "exec") return classifyCodexExecLaunch(args, options);
  if (args[0] === "app-server" && options?.execTransport !== undefined)
    throw new Error("Ordinary exec gate cannot substitute app-server");
  if (args.length === 1 && args[0] === "--version") return { kind: "version" };
  if (
    args[0] === "debug" &&
    args[1] === "models" &&
    (args.length === 2 || (args.length === 3 && args[2] === "--bundled"))
  )
    return { kind: "catalog" };
  // `mcp list --json` (read-only, no model) runs before every product launch
  // to resolve the user's MCP servers; only the product's `-c` pairs follow.
  if (args[0] === "mcp" && args[1] === "list" && args[2] === "--json") {
    for (let i = 3; i < args.length; i++) {
      if (args[i] !== "-c")
        throw new Error(`Unsupported gate CLI argument ${args[i]}`);
      const entry = String(args[++i] ?? "");
      if (!PRODUCT_CONFIG.has(entry) && !MCP_DISABLE.test(entry))
        throw new Error(`Unsupported gate config override ${args[i]}`);
    }
    return { kind: "mcp-list" };
  }
  if (args[0] !== "app-server") throw new Error("Unsupported gate CLI command");
  let listens = 0;
  const workerMcpEntries = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "-c") {
      const entry = String(args[++i] ?? "");
      if (entry.startsWith(WORKER_MCP_PREFIX)) {
        workerMcpEntries.push(entry);
        if (!WORKER_MCP_CONFIG.has(entry) && !MCP_DISABLE.test(entry))
          refuse("internal Worker MCP config");
      } else if (!PRODUCT_CONFIG.has(entry) && !MCP_DISABLE.test(entry))
        throw new Error(`Unsupported gate config override ${args[i]}`);
    } else if (a === "--listen") {
      listens += 1;
      if (listens > 1 || typeof args[++i] !== "string")
        throw new Error("Unsupported gate --listen transport");
    } else throw new Error(`Unsupported gate CLI argument ${a}`);
  }
  if (workerMcpEntries.some((entry) => WORKER_MCP_CONFIG.has(entry))) {
    if (
      workerMcpEntries.length !== WORKER_MCP_CONFIG.size ||
      new Set(workerMcpEntries).size !== WORKER_MCP_CONFIG.size ||
      workerMcpEntries.some((entry) => !WORKER_MCP_CONFIG.has(entry))
    )
      refuse("incomplete or duplicate internal Worker MCP config");
  }
  listenPlan(args);
  return { kind: "app-server" };
}
// S2-a warm driver: `--listen unix://PATH`. The real CLI moves to a short
// sibling socket (macOS caps socket paths at 104 bytes) and the shim's proxy
// takes PATH, so every request still crosses this fence. Any other listen
// form is refused rather than left unguarded.
export function listenPlan(args) {
  const i = args.findIndex(
    (a) => a === "--listen" || a.startsWith("--listen="),
  );
  if (i < 0) return null;
  const value = args[i] === "--listen" ? args[i + 1] : undefined;
  // The per-turn driver speaks stdio; the stdin line guard below covers it.
  if (value === "stdio://") return null;
  if (typeof value !== "string" || !value.startsWith("unix:///"))
    throw new Error("Unsupported gate --listen transport");
  const listenPath = value.slice("unix://".length);
  const upstreamPath = join(dirname(listenPath), "u.sock");
  const rewritten = [...args];
  rewritten[i + 1] = "unix://" + upstreamPath;
  return { args: rewritten, listenPath, upstreamPath };
}
// Test-only stdio fence: unsupported model requests never reach the provider CLI.
// options.model/effort: the approved pair (required);
// options.socketRecordPath appends each guarded warm socket path (JSON line)
// so a gate harness can reach the runtime only through this same fence;
// options.requestRecordPath appends each admitted thread request's cwd and
// workspace roots (codexThreadRecord) for the drift attach evidence.
export async function runGuardedCodex(executable, options = {}) {
  const validateOnly = createCodexRequestGuard(options);
  const validateRequest = (message) => {
    validateOnly(message);
    const record = options.requestRecordPath && codexThreadRecord(message);
    if (record)
      appendFileSync(options.requestRecordPath, JSON.stringify(record) + "\n", {
        mode: 0o600,
      });
  };
  const args = process.argv.slice(2);
  let launch;
  try {
    launch = classifyCodexLaunch(args, options);
  } catch (e) {
    process.stderr.write("PAID_GATE_MODEL_DENIED " + String(e) + "\n");
    process.exitCode = 1;
    return;
  }
  const plan = launch.kind === "app-server" ? listenPlan(args) : null;
  const child = spawn(executable, plan ? plan.args : args, {
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  let rejected = false;
  const deny = (e) => {
    if (rejected) return;
    rejected = true;
    process.stderr.write("PAID_GATE_MODEL_DENIED " + String(e) + "\n");
    child.kill("SIGTERM");
  };
  if (launch.kind === "exec")
    observeGuardedCodexExec(child, launch, options, deny);
  let proxy;
  if (plan) {
    proxy = await startGuardedUnixProxy({
      listenPath: plan.listenPath,
      upstreamPath: plan.upstreamPath,
      validate: (text) => validateRequest(JSON.parse(text)),
      onDenied: deny,
    });
    proxy.ready.catch((e) => deny(e));
    if (options.socketRecordPath)
      void proxy.ready.then(
        () =>
          appendFileSync(
            options.socketRecordPath,
            JSON.stringify({
              listenPath: plan.listenPath,
              pid: process.pid,
              at: new Date().toISOString(),
            }) + "\n",
            { mode: 0o600 },
          ),
        () => {},
      );
  }
  if (launch.kind === "app-server") {
    const lines = createInterface({ input: process.stdin });
    lines.on("line", (line) => {
      if (rejected) return;
      try {
        validateRequest(JSON.parse(line));
        child.stdin.write(line + "\n");
      } catch (e) {
        rejected = true;
        process.stderr.write("PAID_GATE_MODEL_DENIED " + String(e) + "\n");
        child.kill("SIGTERM");
        lines.close();
      }
    });
    process.stdin.on("end", () => child.stdin.end());
  } else process.stdin.pipe(child.stdin);
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => child.kill(signal));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  proxy?.close();
  process.exitCode = rejected ? 1 : (code ?? 1);
}
