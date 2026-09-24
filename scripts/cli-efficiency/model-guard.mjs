import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { model, effort } from "./common.mjs";
import { startGuardedUnixProxy } from "./ws-guard.mjs";
export function assertAuthorizedRequest(message) {
  const p = message.params ?? {};
  if (
    ["thread/start", "thread/resume", "thread/fork"].includes(message.method)
  ) {
    assert.equal(p.model, model, "Unapproved model");
    assert.equal(p.config?.model_reasoning_effort, effort, "Unapproved effort");
  }
  if (message.method === "turn/start" || message.method === "turn/steer") {
    if (p.model !== undefined)
      assert.equal(p.model, model, "Unapproved turn model");
    if (p.effort !== undefined)
      assert.equal(p.effort, effort, "Unapproved turn effort");
  }
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
export async function runGuardedCodex(executable) {
  const args = process.argv.slice(2);
  assert.ok(
    ["app-server", "debug", "--version"].includes(args[0]),
    "Unsupported gate CLI command",
  );
  const plan = args[0] === "app-server" ? listenPlan(args) : null;
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
  let proxy;
  if (plan) {
    proxy = await startGuardedUnixProxy({
      listenPath: plan.listenPath,
      upstreamPath: plan.upstreamPath,
      validate: (text) => assertAuthorizedRequest(JSON.parse(text)),
      onDenied: deny,
    });
    proxy.ready.catch((e) => deny(e));
  }
  if (args[0] === "app-server") {
    const lines = createInterface({ input: process.stdin });
    lines.on("line", (line) => {
      if (rejected) return;
      try {
        assertAuthorizedRequest(JSON.parse(line));
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
