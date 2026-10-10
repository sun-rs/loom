import assert from "node:assert/strict";
import test from "node:test";
import { inspectPiTurn } from "../src/pi-final-output.mjs";
import { ProviderUsageFrameSchema } from "../../protocol/src/runtime-usage.ts";
import { piUsageFrames } from "../src/pi-usage.mjs";
const lines = (rows) => rows.map(JSON.stringify).join("\n") + "\n";
function fixture() {
  const message = {
    role: "assistant",
    provider: "fake-local",
    model: "fake-final",
    thinkingLevel: "low",
    responseId: "response-1",
    stopReason: "stop",
    rawStopReason: "stop",
    content: [{ type: "text", text: "done" }],
    usage: { input: 100, output: 10, cacheRead: 20, cacheWrite: 3 },
  };
  const user = { role: "user", content: [{ type: "text", text: "wake" }] };
  const entries = [
    { type: "session", id: "session-1" },
    {
      type: "model_change",
      id: "model",
      parentId: null,
      provider: "fake-local",
      modelId: "fake-final",
    },
    {
      type: "thinking_level_change",
      id: "thinking",
      parentId: "model",
      thinkingLevel: "low",
    },
    { type: "message", id: "user", parentId: "thinking", message: user },
    { type: "message", id: "final", parentId: "user", message },
  ];
  const frames = [
    entries[0],
    { type: "agent_start" },
    { type: "message_end", message: user },
    { type: "message_end", message },
    { type: "agent_end", willRetry: false },
    { type: "agent_settled", aborted: false },
  ];
  return {
    frames,
    entries,
    input: {
      sessionBefore: "",
      prompt: "wake",
      expectedSessionId: undefined,
      provider: "fake-local",
      model: "fake-final",
      reasoning: "low",
      exit: { code: 0, signal: null },
    },
    e() {
      return {
        ...this.input,
        stdout: lines(this.frames),
        sessionAfter: lines(this.entries),
      };
    },
  };
}
test("Pi current native input/final and per-response reported usage have one owner", () => {
  const f = fixture(),
    p = inspectPiTurn(f.e());
  assert.equal(p.input.turnId, "user");
  assert.equal(p.final.text, "done");
  const u = piUsageFrames(p.messages, {
    sessionId: p.input.sessionId,
    turnId: p.input.turnId,
  });
  assert.equal(u.generations[0].inputTokens, 123);
  assert.equal(u.generations[0].outputTokens, 10);
  assert.equal(u.generations[0].reasoningOutputTokens, null);
  assert.deepEqual(u.gaps, []);
});
test("Pi session/prompt/model/effort/branch and complete stream are mandatory", () => {
  for (const mutate of [
    (f) => (f.input.expectedSessionId = "foreign"),
    (f) => (f.input.prompt = "other"),
    (f) => (f.input.model = "other"),
    (f) => (f.input.reasoning = "high"),
    (f) => (f.entries.at(-1).parentId = "old"),
    (f) =>
      f.frames.push({ type: "message_end", message: f.entries.at(-1).message }),
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => inspectPiTurn(f.e()));
  }
  const f = fixture();
  assert.throws(() =>
    inspectPiTurn({ ...f.e(), stdout: f.e().stdout.trimEnd() }),
  );
});
test("Pi exit0 is insufficient: error/aborted/retry/unfinished tool cannot publish", () => {
  for (const mutate of [
    (f) => (f.frames.at(-1).aborted = true),
    (f) => (f.frames.at(-2).willRetry = true),
    (f) => (f.entries.at(-1).message.stopReason = "error"),
    (f) =>
      f.entries.at(-1).message.content.push({
        type: "toolCall",
        id: "pending",
        name: "bash",
        arguments: {},
      }),
    (f) => (f.input.exit.code = 1),
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(inspectPiTurn(f.e()).final, undefined);
  }
});
test("Pi failed but completed tool permits a recovered normal final", () => {
  const f = fixture();
  const tool = {
    role: "assistant",
    provider: "fake-local",
    model: "fake-final",
    thinkingLevel: "low",
    responseId: "tool-response",
    stopReason: "toolUse",
    content: [
      {
        type: "toolCall",
        id: "tool",
        name: "bash",
        arguments: { command: "false" },
      },
    ],
    usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 },
  };
  const result = {
    role: "toolResult",
    toolCallId: "tool",
    isError: true,
    content: [{ type: "text", text: "exit 1" }],
  };
  f.entries.splice(
    4,
    0,
    { type: "message", id: "tool-msg", parentId: "user", message: tool },
    { type: "message", id: "result", parentId: "tool-msg", message: result },
  );
  f.entries.at(-1).parentId = "result";
  f.frames.splice(
    3,
    0,
    { type: "message_end", message: tool },
    { type: "message_end", message: result },
  );
  assert.equal(inspectPiTurn(f.e()).final.text, "done");
});
test("Pi reports known failed usage, deduplicates exact IDs, never fills absent fields", () => {
  const f = fixture(),
    m = f.entries.at(-1).message;
  const u = piUsageFrames([m, structuredClone(m)], {
    sessionId: "s",
    turnId: "t",
  });
  assert.equal(u.generations.length, 1);
  const conflict = structuredClone(m);
  conflict.usage.output++;
  assert.equal(
    piUsageFrames([m, conflict], { sessionId: "s", turnId: "t" }).generations
      .length,
    0,
  );
  const missing = structuredClone(m);
  delete missing.usage.input;
  assert.equal(
    piUsageFrames([missing], { sessionId: "s", turnId: "t" }).gaps.length,
    1,
  );
  m.stopReason = "error";
  assert.equal(
    piUsageFrames([m], { sessionId: "s", turnId: "t" }).generations.length,
    1,
  );
});

test("Pi usage uses the existing strict Host fd3 frame contract", () => {
  const f = fixture(),
    u = piUsageFrames([f.entries.at(-1).message], {
      sessionId: "s",
      turnId: "t",
    });
  assert.doesNotThrow(() =>
    ProviderUsageFrameSchema.parse({
      protocol: "rah-provider-usage/v1",
      ...u.generations[0],
    }),
  );
});

test("Pi a dangling assistant generation cannot be hidden by settled trailer", () => {
  const f = fixture();
  f.frames.splice(-2, 0, {
    type: "message_start",
    message: { role: "assistant", content: [] },
  });
  assert.equal(inspectPiTurn(f.e()).final, undefined);
});
