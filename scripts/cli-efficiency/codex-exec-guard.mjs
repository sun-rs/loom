import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
import { assertApprovedGateModel } from "./approved-models.mjs";
import { providerLaunchSwitches } from "../../packages/agent-host/src/provider-launch-arguments.js";
const CONFIG = new Set(
  providerLaunchSwitches("codex").args.filter((x) => x !== "-c"),
);
const MCP_DISABLE = /^mcp_servers\.[^.=]+\.enabled=false$/u;
const validSession = (id) =>
  typeof id === "string" &&
  /^[A-Za-z0-9_-]{1,4096}$/.test(id) &&
  !id.startsWith("-");
/** Exact ordinary CLI argv only; a separate explicit mode cannot become app-server. */
export function classifyCodexExecLaunch(args, approved) {
  assert.equal(
    approved?.execTransport,
    "codex-exec/v1",
    "Ordinary exec transport must be explicit",
  );
  assertApprovedGateModel({
    provider: "codex",
    model: approved.model,
    effort: approved.effort,
  });
  assert.ok(
    ["gpt-6-luna", "gpt-5.6-luna"].includes(approved.model),
    "Ordinary exec gates require an explicitly approved Luna binding",
  );
  assert.equal(
    approved.effort,
    "low",
    "This exec gate batch is bound to low effort",
  );
  assert.equal(args[0], "exec");
  const resumed = args[1] === "resume";
  const tail = resumed ? 2 : 1;
  assert.equal(args.at(-1), "-", "Exec wake must be provided on stdin");
  const sessionId = resumed ? args.at(-2) : undefined;
  if (resumed)
    assert.ok(validSession(sessionId), "An exact original session is required");
  const seen = new Set(),
    config = new Set();
  let model, effort;
  for (let i = resumed ? 2 : 1; i < args.length - tail; i++) {
    const arg = args[i];
    if (arg === "-c") {
      const entry = args[++i];
      assert.ok(
        i < args.length - tail && typeof entry === "string",
        "Missing config value",
      );
      const key = entry.split("=", 1)[0];
      assert.ok(!config.has(key), "Duplicate configuration");
      config.add(key);
      if (CONFIG.has(entry) || MCP_DISABLE.test(entry)) continue;
      if (key === "model_reasoning_effort") {
        effort = JSON.parse(entry.slice(key.length + 1));
        assert.equal(effort, approved.effort, "Unapproved effort");
      } else if (key === "developer_instructions") {
        const prompt = JSON.parse(entry.slice(key.length + 1));
        assert.equal(typeof prompt, "string");
        assert.ok(Buffer.byteLength(prompt) <= 1024 * 1024);
      } else throw new Error("Unsupported exec configuration");
    } else {
      const canonical = arg === "-m" ? "--model" : arg;
      assert.ok(!seen.has(canonical), "Duplicate exec argument");
      seen.add(canonical);
      if (
        [
          "--json",
          "--skip-git-repo-check",
          "--dangerously-bypass-approvals-and-sandbox",
        ].includes(arg)
      )
        continue;
      assert.ok(
        ["--model", "--output-last-message"].includes(canonical),
        "Unsupported exec argument",
      );
      const value = args[++i];
      assert.ok(
        i < args.length - tail && typeof value === "string",
        "Missing exec value",
      );
      if (canonical === "--model") {
        model = value;
        assert.equal(model, approved.model, "Unapproved model");
      } else
        assert.ok(
          isAbsolute(value) && !/[\0\r\n]/.test(value),
          "Absolute output path required",
        );
    }
  }
  assert.equal(model, approved.model, "Explicit model required");
  assert.equal(effort, approved.effort, "Explicit effort required");
  for (const required of [
    "--json",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
  ])
    assert.ok(seen.has(required), "Missing required exec flag");
  for (const entry of CONFIG)
    assert.ok(
      config.has(entry.split("=", 1)[0]),
      "Missing memory/autonomy/isolation configuration",
    );
  return { kind: "exec", sessionId };
}
/** Observe native identity without rewriting the byte stream or interpreting wake text as RPC. */
export function observeGuardedCodexExec(child, launch, options, deny) {
  let bytes = 0,
    threads = 0,
    closed = false;
  const record = (why) => {
    if (closed) return;
    closed = true;
    if (options.violationRecordPath)
      appendFileSync(
        options.violationRecordPath,
        JSON.stringify({
          at: new Date().toISOString(),
          kind: "codex-exec",
          reason: why,
        }) + "\n",
        { mode: 0o600 },
      );
    deny(new Error(why));
  };
  child.stdout.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > 16 * 1024 * 1024)
      record("Exec stdout exceeded bounded evidence capture");
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (closed) return;
    try {
      const frame = JSON.parse(line);
      if (frame.type === "thread.started") {
        threads++;
        assert.equal(threads, 1);
        assert.ok(validSession(frame.thread_id));
        if (launch.sessionId !== undefined)
          assert.equal(frame.thread_id, launch.sessionId);
      }
    } catch {
      record("Malformed exec output or unexpected original session identity");
    }
  });
  child.once("close", (code) => {
    if (code === 0 && threads !== 1)
      record("Successful exec had no unique session identity");
    lines.close();
  });
}
