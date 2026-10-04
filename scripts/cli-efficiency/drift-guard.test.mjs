import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertKimiGateArgs,
  createKimiRequestGuard,
} from "./drift-kimi-guard.mjs";
import { createCodexRequestGuard } from "./model-guard.mjs";
import {
  parseKimiCompaction,
  parseKimiContextTokens,
} from "./drift-compaction.mjs";

const approved = { model: "kimi-code/k3", effort: "high" };

test("kimi guard: prompt only after the exact model and thinking were set", () => {
  const guard = createKimiRequestGuard(approved);
  guard({ method: "initialize", params: { protocolVersion: 1 } });
  guard({ method: "session/resume", params: { sessionId: "s1", cwd: "/w" } });
  assert.throws(
    () =>
      guard({
        method: "session/prompt",
        params: { sessionId: "s1", prompt: [] },
      }),
    /model/,
  );
  guard({
    method: "session/set_model",
    params: { sessionId: "s1", modelId: "kimi-code/k3" },
  });
  assert.throws(
    () =>
      guard({
        method: "session/prompt",
        params: { sessionId: "s1", prompt: [] },
      }),
    /thinking/,
  );
  guard({
    method: "session/set_config_option",
    params: { sessionId: "s1", configId: "thinking", value: "high" },
  });
  guard({ method: "session/prompt", params: { sessionId: "s1", prompt: [] } });
  // A second session starts unapproved.
  assert.throws(() =>
    guard({
      method: "session/prompt",
      params: { sessionId: "s2", prompt: [] },
    }),
  );
});

test("kimi guard: other models, thinking values, options and env are denied", () => {
  const guard = createKimiRequestGuard(approved);
  assert.throws(
    () =>
      guard({
        method: "session/set_model",
        params: { sessionId: "s", modelId: "kimi-code/k2" },
      }),
    /Unapproved model/,
  );
  assert.throws(
    () =>
      guard({
        method: "session/set_config_option",
        params: { sessionId: "s", configId: "thinking", value: "low" },
      }),
    /Unapproved thinking/,
  );
  assert.throws(
    () =>
      guard({
        method: "session/set_config_option",
        params: { sessionId: "s", configId: "model", value: "x" },
      }),
    /config option/,
  );
  assert.throws(() =>
    guard({ method: "session/set_mode", params: { sessionId: "s" } }),
  );
  assert.throws(() => guard({ method: "session/new", params: { model: "x" } }));
  assert.throws(
    () =>
      createKimiRequestGuard(approved, { KIMI_MODEL_THINKING_EFFORT: "low" }),
    /thinking environment/,
  );
  assert.doesNotThrow(() =>
    createKimiRequestGuard(approved, { KIMI_MODEL_THINKING_EFFORT: "high" }),
  );
});

// Real regression (Kimi efficiency gate, 2026-09-25): the product driver pins
// every session to the ACP `default` mode (manual permission) with
// `session/set_config_option {configId:"mode"}`; the guard denied it and the
// real kimi-code 0.39.1 never saw it. `default` is the safe mode, not a model
// choice; any other mode is still denied.
test("kimi guard: only the safe `default` mode may be pinned", () => {
  const guard = createKimiRequestGuard(approved);
  guard({
    method: "session/set_config_option",
    params: { sessionId: "s", configId: "mode", value: "default" },
  });
  for (const value of ["auto", "yolo", "plan"])
    assert.throws(
      () =>
        guard({
          method: "session/set_config_option",
          params: { sessionId: "s", configId: "mode", value },
        }),
      /Unapproved mode/,
    );
});

// The denial killed kimi but the wrapper stayed alive until its stdin
// closed, so the driver waited its full request timeout (30 s) instead of
// seeing the CLI exit.
test("kimi guard process: a denied request exits the wrapper while stdin stays open", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kimi-guard-test-"));
  const fakeCli = join(dir, "fake-kimi");
  writeFileSync(
    fakeCli,
    `#!${process.execPath}\nprocess.stdin.resume();\nsetInterval(() => {}, 1000);\n`,
  );
  chmodSync(fakeCli, 0o755);
  const guardUrl = new URL("./drift-kimi-guard.mjs", import.meta.url).href;
  const wrapper = join(dir, "guarded-kimi.mjs");
  writeFileSync(
    wrapper,
    `import { runGuardedKimi } from ${JSON.stringify(guardUrl)};\nawait runGuardedKimi(${JSON.stringify(fakeCli)}, ${JSON.stringify(approved)});\n`,
  );
  const child = spawn(process.execPath, [wrapper, "acp"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const started = Date.now();
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session/set_config_option", params: { sessionId: "s", configId: "mode", value: "yolo" } })}\n`,
  );
  const exited = new Promise((resolve) => child.once("close", resolve));
  let timer;
  const code = await Promise.race([
    exited,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve("still running"), 5000);
    }),
  ]);
  clearTimeout(timer);
  child.stdin.destroy();
  if (code === "still running") {
    child.kill("SIGKILL");
    await exited;
  }
  assert.match(stderr, /PAID_GATE_MODEL_DENIED/);
  assert.equal(code, 1, "the wrapper exits promptly with the denial");
  assert.ok(Date.now() - started < 5000);
});

test("codex guard is parametrized by the drift model/effort", () => {
  const guard = createCodexRequestGuard({
    model: "gpt-5.6-luna",
    effort: "medium",
  });
  assert.throws(
    () =>
      guard({
        method: "thread/resume",
        params: {
          model: "gpt-5.6-luna",
          config: { model_reasoning_effort: "low" },
        },
      }),
    /effort/,
  );
  assert.throws(() => guard({ method: "thread/start", params: {} }), /model/);
  assert.throws(
    () => guard({ method: "turn/start", params: { model: "other" } }),
    /model/,
  );
  guard({
    method: "thread/resume",
    params: {
      threadId: "t",
      model: "gpt-5.6-luna",
      config: { model_reasoning_effort: "medium" },
    },
  });
  guard({ method: "thread/compact/start", params: { threadId: "t" } });
  assert.throws(() => createCodexRequestGuard({ model: "x" }));
});

test("kimi compaction evidence parsing", () => {
  assert.equal(
    parseKimiContextTokens(
      "Context: 12,345 / 256,000 tokens (5%)\nSession total: 1 input",
    ),
    12345,
  );
  assert.equal(parseKimiContextTokens("Context: 900 tokens"), 900);
  assert.equal(parseKimiContextTokens("nothing"), null);
  const done = parseKimiCompaction(
    "Compacting conversation context…Compaction completed.\n- Messages compacted: 12\n- Tokens before: 40,000\n- Tokens after: 3,100",
  );
  assert.deepEqual(
    { c: done.completed, b: done.tokensBefore, a: done.tokensAfter },
    { c: true, b: 40000, a: 3100 },
  );
  const bg = parseKimiCompaction(
    "Context compaction started — it runs in the background and the compacted context applies once it finishes.",
  );
  assert.equal(bg.background, true);
  assert.equal(bg.completed, false);
});

test("claude per-turn compaction: /compact through a guarded resumed print run", async () => {
  const { claudeCompactArgs } = await import("./drift-compaction.mjs");
  const { classifyClaudeLaunch } = await import("./claude-guard.mjs");
  const args = claudeCompactArgs({
    model: "sonnet",
    effort: "low",
    sessionId: "s-1",
  });
  assert.deepEqual(args.slice(0, 2), ["-p", "/compact"]);
  assert.equal(args[args.indexOf("--resume") + 1], "s-1");
  assert.equal(args[args.indexOf("--output-format") + 1], "stream-json");
  assert.ok(!args.includes("--fork-session"));
  assert.equal(
    classifyClaudeLaunch(args, { model: "sonnet", effort: "low" }),
    "turn",
  );
  assert.throws(() =>
    classifyClaudeLaunch(args, { model: "sonnet", effort: "high" }),
  );
});

test("claude compaction evidence: compact_boundary or transcript growth, same session", async () => {
  const { claudeCompactionOutcome } = await import("./drift-compaction.mjs");
  const boundary = { trigger: "manual", preTokens: 50000 };
  const ok = claudeCompactionOutcome({
    sessionId: "s",
    sessionIds: ["s"],
    boundaries: [boundary],
    before: 0,
    after: 1,
  });
  assert.deepEqual(ok, {
    observed: true,
    boundary,
    transcriptBefore: 0,
    transcriptAfter: 1,
    sessionChanged: false,
  });
  assert.equal(
    claudeCompactionOutcome({
      sessionId: "s",
      sessionIds: ["s"],
      boundaries: [],
      before: 1,
      after: 2,
    }).observed,
    true,
  );
  const none = claudeCompactionOutcome({
    sessionId: "s",
    sessionIds: ["s", "t"],
    boundaries: [],
    before: 1,
    after: 1,
  });
  assert.equal(none.observed, false);
  assert.equal(none.sessionChanged, true);
  assert.equal(
    claudeCompactionOutcome({
      sessionId: "s",
      sessionIds: [],
      boundaries: [],
      before: null,
      after: null,
    }).observed,
    false,
  );
});

test("claude haiku compaction: /compact with --model only, and the guard admits it", async () => {
  const { claudeCompactArgs } = await import("./drift-compaction.mjs");
  const { classifyClaudeLaunch } = await import("./claude-guard.mjs");
  const args = claudeCompactArgs({
    model: "haiku",
    effort: null,
    sessionId: "s-1",
  });
  assert.equal(args[args.indexOf("--model") + 1], "haiku");
  assert.ok(!args.includes("--effort"));
  assert.equal(
    classifyClaudeLaunch(args, { model: "haiku", effort: null }),
    "turn",
  );
  assert.throws(
    () => claudeCompactArgs({ model: "sonnet", sessionId: "s" }),
    /effort/,
  );
});

test("claude transcript fence: an effortless approval admits no recorded effort", async () => {
  const { assertClaudeTranscriptModel } = await import("./native-claude.mjs");
  const haiku = { model: "haiku", effort: null };
  assertClaudeTranscriptModel(
    { models: ["claude-haiku-4-5-20251001"], efforts: [] },
    haiku,
  );
  assert.throws(
    () =>
      assertClaudeTranscriptModel(
        { models: ["claude-haiku-4-5-20251001"], efforts: ["medium"] },
        haiku,
      ),
    /Unapproved effort/,
  );
  assert.throws(
    () =>
      assertClaudeTranscriptModel(
        { models: ["claude-sonnet-5"], efforts: [] },
        haiku,
      ),
    /Unapproved model/,
  );
});

test("claude transcript fence: sub-agent (sidechain) models must match too", async () => {
  const { assertClaudeTranscriptModel } = await import("./native-claude.mjs");
  const sonnet = { model: "sonnet", effort: "low" };
  assert.equal(
    assertClaudeTranscriptModel(
      {
        models: ["claude-sonnet-5"],
        sidechainModels: ["claude-sonnet-5"],
        efforts: [],
      },
      sonnet,
    ),
    2,
  );
  assert.throws(
    () =>
      assertClaudeTranscriptModel(
        {
          models: ["claude-sonnet-5"],
          sidechainModels: ["claude-opus-5-5"],
          efforts: [],
        },
        sonnet,
      ),
    /Unapproved model claude-opus-5-5/,
  );
  // No model record at all: zero observed models (the caller judges it as
  // missing evidence, never as a pass).
  assert.equal(
    assertClaudeTranscriptModel({ models: [], efforts: [] }, sonnet),
    0,
  );
});

// Full review 2 B-P2-5: the Kimi shim admits exactly the product's three
// invocations (model-catalog-probe.ts, provider-launch-arguments.js), never
// a configuration-changing subcommand or extra arguments.
test("kimi shim: exact argv allowlist", () => {
  for (const args of [["acp"], ["provider", "list", "--json"], ["--version"]])
    assert.doesNotThrow(() => assertKimiGateArgs(args), JSON.stringify(args));
  for (const args of [
    [],
    ["provider", "add", "x"],
    ["provider", "remove", "kimi-code"],
    ["provider", "list"],
    ["provider", "list", "--json", "--all"],
    ["acp", "--yolo"],
    ["acp", "-m", "other"],
    ["--version", "extra"],
    ["-p", "hello"],
  ])
    assert.throws(
      () => assertKimiGateArgs(args),
      /Unsupported gate CLI command/,
      JSON.stringify(args),
    );
});

test("Kimi gate admits exact local MCP readiness only after model fences and rejects other slash commands", () => {
  const guard = createKimiRequestGuard(
    { model: "kimi-code/k3-256k", effort: "low" },
    { LOOM_WORKER_MCP_IDENTITY: "cold-stdio/v1" },
  );
  const prompt = (text) => ({
    method: "session/prompt",
    params: { sessionId: "local", prompt: [{ type: "text", text }] },
  });
  assert.throws(() => guard(prompt("/mcp")), /model/);
  guard({
    method: "session/set_model",
    params: { sessionId: "local", modelId: "kimi-code/k3-256k" },
  });
  guard({
    method: "session/set_config_option",
    params: { sessionId: "local", configId: "thinking", value: "low" },
  });
  assert.doesNotThrow(() => guard(prompt("/mcp")));
  for (const text of [
    "/model other",
    "/compact",
    "/mcp extra",
    "/mcp\nnew instructions",
  ])
    assert.throws(() => guard(prompt(text)), /slash/);
});
