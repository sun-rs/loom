// Test-only model fence for `kimi acp` (stdio JSON-RPC, one message per
// line), used by the paid drift gate. It is stateful and fails closed: a
// `session/prompt` is forwarded only after this process saw the exact
// approved `session/set_model` and `thinking` config for that session. The
// safe `mode=default` pin is admitted; any other model, thinking value, mode
// or config option closes the CLI and exits the wrapper.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export const KIMI_THINKING_ENV = "KIMI_MODEL_THINKING_EFFORT";

export function createKimiRequestGuard(approved, env = {}) {
  assert.ok(
    approved?.model && approved?.effort,
    "Guard needs model and effort",
  );
  if (env[KIMI_THINKING_ENV] !== undefined)
    assert.equal(
      env[KIMI_THINKING_ENV],
      approved.effort,
      "Unapproved thinking environment",
    );
  const sessions = new Map();
  const state = (id) => {
    assert.equal(typeof id, "string", "Kimi request without sessionId");
    if (!sessions.has(id)) sessions.set(id, { model: false, thinking: false });
    return sessions.get(id);
  };
  return (message) => {
    const p = message.params ?? {};
    switch (message.method) {
      case "session/set_model":
        assert.equal(p.modelId, approved.model, "Unapproved model");
        state(p.sessionId).model = true;
        return;
      case "session/set_config_option":
        // The product driver pins every session to the ACP `default` mode
        // (manual permission, the native-goal fence); it is not a model
        // choice. Any other mode stays denied.
        if (p.configId === "mode") {
          assert.equal(p.value, "default", "Unapproved mode");
          return;
        }
        assert.equal(p.configId, "thinking", "Unapproved config option");
        assert.equal(p.value, approved.effort, "Unapproved thinking");
        state(p.sessionId).thinking = true;
        return;
      case "session/prompt": {
        const s = state(p.sessionId);
        assert.ok(s.model, "Prompt before the approved model was set");
        assert.ok(s.thinking, "Prompt before the approved thinking was set");
        return;
      }
      case "session/set_mode":
      case "session/fork":
        throw new Error(`Unsupported gate request ${message.method}`);
      default:
        // initialize, session/new|resume|load|cancel, responses to agent
        // requests: carry no model choice; a new session starts unapproved.
        if (p.model !== undefined || p.modelId !== undefined)
          throw new Error("Unapproved model field");
    }
  };
}

export async function runGuardedKimi(executable, approved) {
  const args = process.argv.slice(2);
  assert.ok(
    ["acp", "provider", "--version"].includes(args[0]),
    "Unsupported gate CLI command",
  );
  const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  let rejected = false;
  if (args[0] === "acp") {
    let validate;
    try {
      validate = createKimiRequestGuard(approved, process.env);
    } catch (e) {
      rejected = true;
      process.stderr.write("PAID_GATE_MODEL_DENIED " + String(e) + "\n");
      child.kill("SIGTERM");
    }
    const lines = createInterface({ input: process.stdin });
    lines.on("line", (line) => {
      if (rejected) return;
      try {
        validate(JSON.parse(line));
        child.stdin.write(line + "\n");
      } catch (e) {
        rejected = true;
        process.stderr.write("PAID_GATE_MODEL_DENIED " + String(e) + "\n");
        child.kill("SIGTERM");
        lines.close();
        // Release stdin so the wrapper exits with the CLI instead of waiting
        // for the driver to close it (the driver would only see a timeout).
        process.stdin.destroy();
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
