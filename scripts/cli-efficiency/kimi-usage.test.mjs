import test from "node:test";
import assert from "node:assert/strict";
import {
  assertKimiRequests,
  checkKimiPrintLaunch,
  kimiNativeArgs,
  kimiWireRound,
  parseKimiPrintRound,
} from "./kimi-usage.mjs";

const approved = { model: "kimi-code/k3", effort: "high" };
const answer =
  "审查结论：函数级只保证写入前后 PID 一致，整个重启流程仍需回归测试覆盖网络配置保留，本轮撤回上一轮过强结论并补充两条测试。";

test("native args: print mode, stream-json, exact model, resume after round 1", () => {
  const first = kimiNativeArgs({ model: "kimi-code/k3", prompt: "q1" });
  assert.deepEqual(first, [
    "-p",
    "q1",
    "--output-format",
    "stream-json",
    "-m",
    "kimi-code/k3",
  ]);
  const next = kimiNativeArgs({
    model: "kimi-code/k3",
    prompt: "q2",
    sessionId: "s-1",
  });
  assert.deepEqual(next.slice(-2), ["--session", "s-1"]);
  assert.throws(() => kimiNativeArgs({ prompt: "q" }));
});

test("print launch guard: exact model flag and thinking environment, fail closed", () => {
  const env = { KIMI_MODEL_THINKING_EFFORT: "high" };
  const args = kimiNativeArgs({ model: "kimi-code/k3", prompt: "q" });
  assert.doesNotThrow(() => checkKimiPrintLaunch(args, env, approved));
  assert.throws(
    () =>
      checkKimiPrintLaunch(
        kimiNativeArgs({ model: "kimi-code/k2", prompt: "q" }),
        env,
        approved,
      ),
    /model/,
  );
  assert.throws(
    () =>
      checkKimiPrintLaunch(
        args,
        { KIMI_MODEL_THINKING_EFFORT: "low" },
        approved,
      ),
    /thinking/,
  );
  assert.throws(() => checkKimiPrintLaunch(args, {}, approved), /thinking/);
  assert.throws(
    () => checkKimiPrintLaunch([...args, "-m", "kimi-code/k3"], env, approved),
    /model/,
  );
  for (const extra of [["--continue"], ["--agent", "x"], ["--plan"]])
    assert.throws(
      () => checkKimiPrintLaunch([...args, ...extra], env, approved),
      /Unsupported/,
    );
  assert.throws(
    () => checkKimiPrintLaunch(["acp"], env, approved),
    /print mode/,
  );
});

// Recorded shape of `kimi -p --output-format stream-json` (kimi-code 0.39
// PromptJsonWriter): one JSON message per line, no usage.
test("print round: session id from the resume hint, last assistant text is the answer", () => {
  const lines = [
    {
      role: "assistant",
      content: "先读取文件。",
      tool_calls: [
        {
          type: "function",
          id: "c1",
          function: { name: "Read", arguments: '{"path":"scripts/x.mjs"}' },
        },
      ],
    },
    { role: "tool", tool_call_id: "c1", content: "..." },
    { role: "meta", type: "turn.step.retrying", failed_attempt: 1 },
    { role: "assistant", content: answer },
    {
      role: "meta",
      type: "session.resume_hint",
      session_id: "s-1",
      command: "kimi -r s-1",
    },
  ];
  const r = parseKimiPrintRound([
    ...lines.map((o, i) => ({ line: JSON.stringify(o), at: 100 + i })),
    { line: "garbage", at: 999 },
  ]);
  assert.equal(r.sessionId, "s-1");
  assert.equal(r.answer, answer);
  assert.equal(r.finalAt, 103);
  assert.equal(r.retries, 1);
  assert.deepEqual(
    r.toolCalls.map((c) => [c.name, c.kind]),
    [["Read", "other"]],
  );
});

// Recorded shape of the kimi-code session wire
// (~/.kimi-code/sessions/<wd>/session_<id>/agents/main/wire.jsonl).
const loop = (event, time) =>
  JSON.stringify({
    type: "context.append_loop_event",
    agentId: "main",
    event,
    time,
  });
const t0 = Date.parse("2026-09-25T00:00:00.000Z");
const request = (time, over = {}) =>
  JSON.stringify({
    type: "llm.request",
    agentId: "main",
    kind: "loop",
    model: "k3",
    modelAlias: "kimi-code/k3",
    thinkingEffort: "high",
    time,
    ...over,
  });
const wire = [
  JSON.stringify({ type: "metadata", protocol_version: "1.5" }),
  request(t0 + 1000),
  loop(
    {
      type: "tool.call",
      toolCallId: "c1",
      name: "Bash",
      args: { command: "rah message-post --final 审查结论" },
    },
    t0 + 2000,
  ),
  loop(
    {
      type: "step.end",
      finishReason: "tool_use",
      messageId: "chatcmpl-1",
      usage: {
        inputOther: 2037,
        output: 386,
        inputCacheRead: 19456,
        inputCacheCreation: 0,
      },
    },
    t0 + 2000,
  ),
  JSON.stringify({
    type: "usage.record",
    model: "kimi-code/k3",
    usage: '{"inputOther":2037}',
    time: t0 + 2000,
  }),
  request(t0 + 2100),
  loop(
    {
      type: "step.end",
      finishReason: "end_turn",
      messageId: "chatcmpl-2",
      usage: {
        inputOther: 667,
        output: 69,
        inputCacheRead: 21248,
        inputCacheCreation: 10,
      },
    },
    t0 + 5000,
  ),
  loop(
    {
      type: "step.end",
      messageId: "chatcmpl-2",
      usage: {
        inputOther: 667,
        output: 69,
        inputCacheRead: 21248,
        inputCacheCreation: 10,
      },
    },
    t0 + 5001,
  ),
  request(t0 + 99_000),
  loop(
    {
      type: "step.end",
      messageId: "later",
      usage: {
        inputOther: 1,
        output: 1,
        inputCacheRead: 0,
        inputCacheCreation: 0,
      },
    },
    t0 + 99_000,
  ),
  "{broken",
].join("\n");

test("wire round: one generation per step.end message inside the window", () => {
  const r = kimiWireRound(wire, {
    from: "2026-09-25T00:00:00.000Z",
    to: "2026-09-25T00:01:00.000Z",
  });
  assert.deepEqual(
    r.generations.map((g) => [
      g.responseId,
      g.inputTokens,
      g.cachedInputTokens,
      g.outputTokens,
      g.observedAt,
    ]),
    [
      ["chatcmpl-1", 21493, 19456, 386, "2026-09-25T00:00:02.000Z"],
      ["chatcmpl-2", 21925, 21248, 69, "2026-09-25T00:00:05.000Z"],
    ],
  );
  assert.equal(r.requests.length, 2);
  assert.equal(r.usageRecords, 1);
  assert.deepEqual(
    r.toolCalls.map((c) => [c.name, c.kind, c.final]),
    [["Bash", "box-post", true]],
  );
});

test("wire request guard: every request used the approved alias and thinking", () => {
  const ok = kimiWireRound(wire, {
    from: "2026-09-25T00:00:00.000Z",
    to: "2026-09-25T00:01:00.000Z",
  });
  assert.doesNotThrow(() => assertKimiRequests(ok.requests, approved));
  assert.throws(() => assertKimiRequests([], approved), /no model request/);
  const bad = (over) => kimiWireRound(request(t0, over), {}).requests;
  assert.throws(
    () => assertKimiRequests(bad({ modelAlias: "kimi-code/k2" }), approved),
    /Unapproved model/,
  );
  assert.throws(
    () => assertKimiRequests(bad({ thinkingEffort: "low" }), approved),
    /Unapproved thinking/,
  );
  assert.throws(
    () => assertKimiRequests(bad({ thinkingEffort: undefined }), approved),
    /Unapproved thinking/,
  );
});
