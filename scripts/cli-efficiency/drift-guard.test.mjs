import test from "node:test";
import assert from "node:assert/strict";
import { createKimiRequestGuard } from "./drift-kimi-guard.mjs";
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
