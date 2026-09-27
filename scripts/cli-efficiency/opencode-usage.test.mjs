import test from "node:test";
import assert from "node:assert/strict";
import {
  checkOpenCodeNativeLaunch,
  openCodeNativeArgs,
  openCodeNativeEnv,
  parseOpenCodeRunRound,
} from "./opencode-usage.mjs";

const approved = { model: "deepseek/deepseek-flash", effort: "low" };

test("native args: run --pure json, exact model and variant, resume by session id", () => {
  const first = openCodeNativeArgs({ ...approved, prompt: "q1" });
  assert.deepEqual(first.slice(0, 4), ["run", "--pure", "--format", "json"]);
  assert.equal(first[first.indexOf("-m") + 1], "deepseek/deepseek-flash");
  assert.equal(first[first.indexOf("--variant") + 1], "low");
  // An explicit title: a default title triggers an internal small-model call.
  assert.ok(first.includes("--title"));
  assert.ok(!first.includes("--session"));
  assert.equal(first.at(-1), "q1");
  const next = openCodeNativeArgs({
    ...approved,
    prompt: "q2",
    sessionId: "ses_1",
  });
  assert.equal(next[next.indexOf("--session") + 1], "ses_1");
  assert.ok(!next.includes("--fork"));
  assert.doesNotThrow(() =>
    checkOpenCodeNativeLaunch(first, openCodeNativeEnv(approved, {}), approved),
  );
  assert.doesNotThrow(() =>
    checkOpenCodeNativeLaunch(next, openCodeNativeEnv(approved, {}), approved),
  );
});

test("native launch fence: other model, variant, fork or config are refused", () => {
  const env = openCodeNativeEnv(approved, {});
  const args = openCodeNativeArgs({ ...approved, prompt: "q", sessionId: "s" });
  const bad = [
    [args.map((a) => (a === "low" ? "max" : a)), env],
    [
      args.map((a) =>
        a === "deepseek/deepseek-flash" ? "deepseek/deepseek-v4-pro" : a,
      ),
      env,
    ],
    [[...args.slice(0, -1), "-m", "deepseek/deepseek-flash", "q"], env],
    [[...args.slice(0, -1), "--fork", "q"], env],
    [[...args.slice(0, -1), "--agent", "build", "q"], env],
    [[...args.slice(0, -1), "--attach", "http://x", "q"], env],
    [["serve"], env],
    [
      args,
      {
        ...env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          model: "deepseek/deepseek-flash",
        }),
      },
    ],
    [args, { ...env, OPENCODE_CONFIG_CONTENT: "{" }],
  ];
  for (const [a, e] of bad)
    assert.throws(
      () => checkOpenCodeNativeLaunch(a, e, approved),
      undefined,
      a.join(" "),
    );
});

// Full review 2 B-P2-6: the native arm switches the user's MCP servers off by
// name exactly like the product (opencode-user-mcp.js), so a user MCP config
// cannot inflate the native input and flatter the platform.
test("native env: user MCP servers disabled by name like the product; the fence checks it", () => {
  const names = ["github", "fixture-db"];
  const env = openCodeNativeEnv(approved, { PATH: "/bin" }, names);
  const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.model, approved.model);
  assert.equal(config.small_model, approved.model);
  assert.deepEqual(config.mcp, {
    github: { enabled: false },
    "fixture-db": { enabled: false },
  });
  const args = openCodeNativeArgs({ ...approved, prompt: "q" });
  assert.doesNotThrow(() =>
    checkOpenCodeNativeLaunch(args, env, approved, names),
  );
  // No names resolved: no mcp section, as in the product.
  assert.equal(
    "mcp" in
      JSON.parse(openCodeNativeEnv(approved, {}, []).OPENCODE_CONFIG_CONTENT),
    false,
  );
  // A resolved server left enabled is refused before launch.
  assert.throws(
    () =>
      checkOpenCodeNativeLaunch(
        args,
        openCodeNativeEnv(approved, {}, ["github"]),
        approved,
        names,
      ),
    /MCP server fixture-db is not disabled/u,
  );
});

test("run json round: session, answer, per-step usage like the product, tool calls", () => {
  const ev = (type, fields, at) => ({
    line: JSON.stringify({
      type,
      timestamp: at,
      sessionID: "ses_1",
      ...fields,
    }),
    at,
  });
  const r = parseOpenCodeRunRound([
    ev("step_start", { part: { id: "p0", type: "step-start" } }, 1000),
    ev(
      "tool_use",
      {
        part: {
          id: "p1",
          type: "tool",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "loom message-post --turn t" },
          },
        },
      },
      1100,
    ),
    ev(
      "step_finish",
      {
        part: {
          id: "p2",
          type: "step-finish",
          tokens: {
            input: 100,
            output: 10,
            reasoning: 5,
            cache: { read: 900, write: 0 },
          },
        },
      },
      1200,
    ),
    ev(
      "text",
      {
        part: {
          id: "p3",
          type: "text",
          text: "审查结论：好",
          time: { end: 1300 },
        },
      },
      1300,
    ),
    ev(
      "step_finish",
      {
        part: {
          id: "p4",
          type: "step-finish",
          tokens: {
            input: 20,
            output: 30,
            reasoning: 0,
            cache: { read: 1000, write: 0 },
          },
        },
      },
      1400,
    ),
  ]);
  assert.deepEqual(r.sessionIds, ["ses_1"]);
  assert.equal(r.answer, "审查结论：好");
  assert.equal(r.finalAt, 1300);
  assert.deepEqual(
    r.generations.map((g) => [
      g.responseId,
      g.inputTokens,
      g.cachedInputTokens,
      g.outputTokens,
    ]),
    [
      ["p2", 1000, 900, 15],
      ["p4", 1020, 1000, 30],
    ],
  );
  assert.deepEqual(r.gaps, []);
  assert.deepEqual(
    r.toolCalls.map((c) => [c.kind, c.turnHandle]),
    [["box-post", true]],
  );
  // A malformed step-finish is a usage gap, never zero.
  const gap = parseOpenCodeRunRound([
    ev(
      "step_finish",
      { part: { id: "p", type: "step-finish", tokens: {} } },
      1,
    ),
  ]);
  assert.equal(gap.generations.length, 0);
  assert.equal(gap.gaps.length, 1);
  const err = parseOpenCodeRunRound([ev("error", { error: { name: "X" } }, 1)]);
  assert.equal(err.errors.length, 1);
});
