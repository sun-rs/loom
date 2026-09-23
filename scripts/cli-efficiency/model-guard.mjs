import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { model, effort } from "./common.mjs";
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
// Test-only stdio fence: unsupported model requests never reach the provider CLI.
export async function runGuardedCodex(executable) {
  const args = process.argv.slice(2);
  assert.ok(
    ["app-server", "debug", "--version"].includes(args[0]),
    "Unsupported gate CLI command",
  );
  const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  let rejected = false;
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
  process.exitCode = rejected ? 1 : (code ?? 1);
}
