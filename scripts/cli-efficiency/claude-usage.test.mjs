import test from "node:test";
import assert from "node:assert/strict";
import {
  claudeModelMatches,
  claudeNativeArgs,
  claudeToolCalls,
  claudeTranscriptRound,
  parseClaudeStreamRound,
} from "./claude-usage.mjs";

// Recorded shape of `claude -p --output-format stream-json --verbose
// --include-partial-messages` (Claude Code 2.1.x SDK message types).
const S = "11111111-2222-4333-8444-555555555555";
const ev = (event, parent = null) => ({
  type: "stream_event",
  event,
  session_id: S,
  parent_tool_use_id: parent,
});
const generation = (id, usage, output) => [
  ev({ type: "message_start", message: { id, usage } }),
  ev({ type: "content_block_start", index: 0 }),
  ev({ type: "message_delta", usage: { output_tokens: output } }),
  ev({ type: "message_stop" }),
];
const answer =
  "审查结论：函数级只保证写入前后 PID 一致，整个重启流程仍需回归测试覆盖网络配置保留，本轮撤回上一轮过强结论并补充两条测试。";
const frames = [
  {
    type: "system",
    subtype: "init",
    session_id: S,
    model: "claude-sonnet-5",
    cwd: "/w",
  },
  ...generation(
    "msg_1",
    {
      input_tokens: 5,
      cache_creation_input_tokens: 1000,
      cache_read_input_tokens: 20000,
      output_tokens: 1,
    },
    40,
  ),
  {
    type: "assistant",
    session_id: S,
    message: {
      id: "msg_1",
      model: "claude-sonnet-5",
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "Read",
          input: { file_path: "scripts/workbench-launch-receipt.mjs" },
        },
      ],
    },
  },
  {
    type: "user",
    session_id: S,
    message: { content: [{ type: "tool_result", tool_use_id: "t1" }] },
  },
  ...generation(
    "msg_2",
    {
      input_tokens: 7,
      cache_creation_input_tokens: 300,
      cache_read_input_tokens: 21000,
      output_tokens: 2,
    },
    220,
  ),
  {
    type: "assistant",
    session_id: S,
    message: {
      id: "msg_2",
      model: "claude-sonnet-5",
      content: [{ type: "text", text: answer }],
    },
  },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: answer,
    session_id: S,
    num_turns: 2,
  },
];

test("stream-json round: session, answer, per-response usage like the product tracker", () => {
  const entries = frames.map((frame, i) => ({
    line: JSON.stringify(frame),
    at: 1_000 + i * 100,
  }));
  entries.splice(3, 0, { line: "not json", at: 1_250 });
  const r = parseClaudeStreamRound(entries);
  assert.equal(r.sessionId, S);
  assert.deepEqual(r.sessionIds, [S]);
  assert.equal(r.initModel, "claude-sonnet-5");
  assert.equal(r.answer, answer);
  assert.equal(r.result.subtype, "success");
  assert.equal(r.result.isError, false);
  // The final text frame, not the later result frame, is the reply time.
  assert.equal(r.finalAt, 1_000 + (frames.length - 2) * 100);
  assert.deepEqual(
    r.generations.map((g) => [
      g.responseId,
      g.inputTokens,
      g.cachedInputTokens,
      g.outputTokens,
    ]),
    [
      ["msg_1", 21005, 20000, 40],
      ["msg_2", 21307, 21000, 220],
    ],
  );
  assert.deepEqual(r.gaps, []);
  assert.deepEqual(
    r.toolCalls.map((c) => [c.name, c.kind]),
    [["Read", "other"]],
  );
  assert.deepEqual(r.models, ["claude-sonnet-5"]);
});

test("stream-json round: a changed session id is visible, a lost stop is a gap", () => {
  const other = { ...frames[0], session_id: "other" };
  const r = parseClaudeStreamRound(
    [
      frames[0],
      other,
      ev({ type: "message_start", message: { id: "m", usage: {} } }),
      ev({ type: "message_stop" }),
    ].map((frame, i) => ({ line: JSON.stringify(frame), at: i })),
  );
  assert.deepEqual(r.sessionIds, [S, "other"]);
  assert.equal(r.generations.length, 0);
  assert.equal(r.gaps.length, 1);
  assert.equal(r.answer, undefined);
});

test("compact_boundary frames are reported with their metadata", () => {
  const r = parseClaudeStreamRound(
    [
      frames[0],
      {
        type: "system",
        subtype: "compact_boundary",
        session_id: S,
        compact_metadata: { trigger: "manual", pre_tokens: 54321 },
      },
      { type: "result", subtype: "success", is_error: false, session_id: S },
    ].map((frame, i) => ({ line: JSON.stringify(frame), at: i })),
  );
  assert.deepEqual(r.compactBoundaries, [
    { trigger: "manual", preTokens: 54321 },
  ]);
});

test("tool calls classify Worker box posts and the per-turn handle", () => {
  const calls = claudeToolCalls(
    [
      {
        type: "tool_use",
        name: "Bash",
        input: { command: "rah message-post --turn T --final 审查结论：…" },
      },
      {
        type: "tool_use",
        name: "Bash",
        input: { command: "rah message-check" },
      },
      { type: "text", text: "x" },
      { type: "tool_use", name: "Grep", input: { pattern: "pid" } },
    ],
    "2026-09-25T00:00:00.000Z",
  );
  assert.deepEqual(
    calls.map((c) => [c.name, c.kind, c.turnHandle]),
    [
      ["Bash", "box-post", true],
      ["Bash", "box-check", false],
      ["Grep", "other", undefined],
    ],
  );
});

// Recorded shape of a Claude Code session transcript
// (~/.claude/projects/<cwd>/<session>.jsonl): one line per content block,
// the message usage repeated on each line of the same message id.
const line = (o) => JSON.stringify(o);
const transcript = [
  line({
    type: "user",
    timestamp: "2026-09-25T00:00:01.000Z",
    sessionId: S,
    cwd: "/w",
    message: { role: "user", content: "q" },
  }),
  ...["a", "b"].map((uuid) =>
    line({
      type: "assistant",
      timestamp: "2026-09-25T00:00:02.000Z",
      sessionId: S,
      cwd: "/w",
      effort: "low",
      isSidechain: false,
      uuid,
      message: {
        id: "msg_1",
        model: "claude-sonnet-5",
        content: [
          uuid === "a"
            ? { type: "text", text: "reading" }
            : {
                type: "tool_use",
                name: "Bash",
                input: { command: "rah message-post --turn T x" },
              },
        ],
        usage: {
          input_tokens: 5,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 20000,
          output_tokens: 40,
        },
      },
    }),
  ),
  line({
    type: "assistant",
    timestamp: "2026-09-25T00:00:05.000Z",
    sessionId: S,
    effort: "low",
    message: {
      id: "msg_2",
      model: "claude-sonnet-5",
      content: [{ type: "text", text: "done" }],
      usage: {
        input_tokens: 7,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 21000,
        output_tokens: 9,
      },
    },
  }),
  line({
    type: "assistant",
    timestamp: "2026-09-25T00:00:05.500Z",
    sessionId: S,
    message: {
      id: "synthetic",
      model: "<synthetic>",
      content: [],
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  }),
  line({
    type: "assistant",
    timestamp: "2026-09-25T00:00:06.000Z",
    sessionId: S,
    isSidechain: true,
    message: {
      id: "side",
      model: "claude-haiku-4",
      content: [],
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  }),
  line({
    type: "system",
    subtype: "compact_boundary",
    timestamp: "2026-09-25T00:00:07.000Z",
    compactMetadata: { trigger: "manual", preTokens: 999 },
  }),
  line({
    type: "assistant",
    timestamp: "2026-09-25T00:10:00.000Z",
    sessionId: S,
    message: {
      id: "later",
      model: "claude-sonnet-5",
      content: [],
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  }),
  "{broken",
].join("\n");

test("transcript round: unique main-chain generations inside the window", () => {
  const r = claudeTranscriptRound(transcript, {
    from: "2026-09-25T00:00:00.000Z",
    to: "2026-09-25T00:01:00.000Z",
  });
  assert.equal(r.cwd, "/w");
  assert.deepEqual(
    r.generations.map((g) => [
      g.responseId,
      g.inputTokens,
      g.cachedInputTokens,
    ]),
    [
      ["msg_1", 21005, 20000],
      ["msg_2", 21007, 21000],
    ],
  );
  assert.deepEqual(r.totals, {
    generations: 2,
    inputTokens: 42012,
    cachedInputTokens: 41000,
    outputTokens: 49,
  });
  assert.deepEqual(r.models, ["claude-sonnet-5"]);
  assert.deepEqual(r.efforts, ["low"]);
  assert.equal(r.sidechainGenerations, 1);
  // Sub-agent (sidechain) generations are model-checked too.
  assert.deepEqual(r.sidechainModels, ["claude-haiku-4"]);
  assert.equal(r.compactBoundaries, 1);
  assert.deepEqual(
    r.toolCalls.map((c) => [c.kind, c.turnHandle]),
    [["box-post", true]],
  );
});

test("alias bindings match only their own model family", () => {
  assert.ok(claudeModelMatches("sonnet", "claude-sonnet-5"));
  assert.ok(claudeModelMatches("sonnet", "claude-sonnet-4-5-20250929"));
  assert.ok(claudeModelMatches("claude-sonnet-5", "claude-sonnet-5"));
  assert.ok(!claudeModelMatches("sonnet", "claude-opus-5-5"));
  assert.ok(!claudeModelMatches("sonnet", "claude-fable-5-1"));
  assert.ok(!claudeModelMatches("sonnet", undefined));
  assert.ok(!claudeModelMatches("sonnet", "sonnetx"));
});

test("native args pin model and effort, resume only after round 1", () => {
  const first = claudeNativeArgs({
    model: "sonnet",
    effort: "low",
    prompt: "q1",
  });
  assert.deepEqual(first.slice(0, 2), ["-p", "q1"]);
  for (const flag of [
    "--output-format",
    "--verbose",
    "--include-partial-messages",
  ])
    assert.ok(first.includes(flag), flag);
  assert.equal(first[first.indexOf("--model") + 1], "sonnet");
  assert.equal(first[first.indexOf("--effort") + 1], "low");
  assert.ok(!first.includes("--resume"));
  const next = claudeNativeArgs({
    model: "sonnet",
    effort: "low",
    prompt: "q2",
    sessionId: S,
  });
  assert.equal(next[next.indexOf("--resume") + 1], S);
  assert.ok(!next.includes("--fork-session"));
  assert.throws(() => claudeNativeArgs({ model: "sonnet", prompt: "q" }));
  // Effortless (haiku) approval: exactly no --effort.
  const haiku = claudeNativeArgs({ model: "haiku", effort: null, prompt: "q" });
  assert.ok(!haiku.includes("--effort"));
  assert.equal(haiku[haiku.indexOf("--model") + 1], "haiku");
});

test("stream-json round: sub-agent models and result modelUsage are collected", () => {
  const at = 1;
  const r = parseClaudeStreamRound(
    [
      {
        type: "assistant",
        session_id: S,
        message: { model: "claude-sonnet-5", content: [] },
      },
      {
        type: "assistant",
        session_id: S,
        parent_tool_use_id: "toolu_1",
        message: { model: "claude-haiku-4", content: [] },
      },
      {
        type: "result",
        session_id: S,
        subtype: "success",
        result: "ok",
        modelUsage: { "claude-sonnet-5": {}, "claude-haiku-4": {} },
      },
    ].map((o) => ({ line: JSON.stringify(o), at })),
  );
  assert.deepEqual(r.models, ["claude-sonnet-5"]);
  assert.deepEqual(r.subagentModels, ["claude-haiku-4"]);
  assert.deepEqual(r.resultModels, ["claude-sonnet-5", "claude-haiku-4"]);
});

test("drift diagnostics: task commands and refused reply-target sends", () => {
  const calls = claudeToolCalls([
    { type: "tool_use", name: "Bash", input: { command: "rah task-create x" } },
  ]);
  assert.equal(calls[0].kind, "task-command");
  const t = [
    JSON.stringify({
      type: "user",
      timestamp: "2026-09-25T00:00:01.000Z",
      message: {
        content: [
          {
            type: "tool_result",
            content: [
              { type: "text", text: "error reply_target_mismatch not sent" },
            ],
          },
        ],
      },
    }),
    JSON.stringify({
      type: "user",
      timestamp: "2026-09-25T00:00:02.000Z",
      message: {
        content: [{ type: "tool_result", content: "reply_target_mismatch" }],
      },
    }),
    JSON.stringify({
      type: "user",
      timestamp: "2026-09-25T00:00:03.000Z",
      message: { content: "reply_target_mismatch in a human message" },
    }),
  ].join("\n");
  assert.equal(claudeTranscriptRound(t).targetRejections, 2);
});

test("direct Worker MCP is protocol without CLI proof; quoted symbol cannot hide Bash missing turn", () => {
  const [mcp, missing, present] = claudeToolCalls(
    [
      {
        type: "tool_use",
        name: "mcp__loom_worker__loom_reply",
        input: { body: "message-post --turn forged", final: true },
      },
      {
        type: "tool_use",
        name: "Bash",
        input: {
          command:
            "loom-worker message-post --body 'mcp__loom_worker__loom_reply'",
        },
      },
      {
        type: "tool_use",
        name: "Bash",
        input: {
          command:
            "loom-worker message-post --turn native-handle --body 'mcp__loom_worker__loom_reply'",
        },
      },
    ],
    "2026-10-04T00:00:00Z",
  );
  assert.equal(mcp.kind, "worker-mcp-reply");
  assert.equal(mcp.turnHandle, undefined);
  assert.equal(mcp.cliTurnHandle, undefined);
  assert.equal(mcp.final, undefined);
  assert.equal(missing.kind, "worker-mcp-reply");
  assert.equal(missing.cliTurnHandle, false);
  assert.equal(present.cliTurnHandle, true);
});
