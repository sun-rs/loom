import assert from "node:assert/strict";
import test from "node:test";

import { ProviderUsageFrameSchema } from "@rah-os/protocol";

import {
  ClaudeStreamUsageTracker,
  CodexTokenUsageTracker,
  openCodeStepFinishUsage,
  ProviderUsageWriter,
} from "../src/provider-usage.js";

const at = () => Date.parse("2026-09-24T01:00:00.000Z");

// Shape from `codex app-server generate-json-schema` (codex-cli 0.156.1):
// v2/ThreadTokenUsageUpdatedNotification.json.
function codexUsage(
  turnId: string,
  last: Record<string, number>,
  total: Record<string, number>,
) {
  return {
    jsonrpc: "2.0",
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thread-1",
      turnId,
      tokenUsage: { last, total, modelContextWindow: 258400 },
    },
  };
}

function breakdown(
  input: number,
  cached: number,
  output: number,
  reasoning: number,
) {
  return {
    inputTokens: input,
    cachedInputTokens: cached,
    outputTokens: output,
    reasoningOutputTokens: reasoning,
    totalTokens: input + output,
  };
}

test("Codex usage reports each generation from `last` and skips repeated totals", () => {
  const tracker = new CodexTokenUsageTracker({ freshThread: true, now: at });
  const first = tracker.observe(
    codexUsage(
      "turn-1",
      breakdown(1000, 800, 50, 10),
      breakdown(1000, 800, 50, 10),
    ),
  );
  assert.deepEqual(first, {
    provider: "codex-app-server/v1",
    responseId: "turn-1:1050",
    inputTokens: 1000,
    cachedInputTokens: 800,
    outputTokens: 50,
    reasoningOutputTokens: 10,
    contextWindow: 258400,
    contextUsedTokens: 1050,
    observedAt: "2026-09-24T01:00:00.000Z",
  });
  // A repeated TokenCount (e.g. a rate-limit refresh) carries the same total.
  assert.equal(
    tracker.observe(
      codexUsage(
        "turn-1",
        breakdown(1000, 800, 50, 10),
        breakdown(1000, 800, 50, 10),
      ),
    ),
    undefined,
  );
  const second = tracker.observe(
    codexUsage(
      "turn-1",
      breakdown(1200, 1000, 30, 0),
      breakdown(2200, 1800, 80, 10),
    ),
  );
  assert.equal(second?.responseId, "turn-1:2280");
  assert.equal(second?.inputTokens, 1200);
});

test("Codex usage never turns an inconsistent cumulative jump into a generation", () => {
  const tracker = new CodexTokenUsageTracker({ freshThread: true, now: at });
  // Total moved by more than `last`: a generation was missed or recomputed.
  assert.equal(
    tracker.observe(
      codexUsage(
        "turn-1",
        breakdown(100, 0, 10, 0),
        breakdown(5000, 0, 400, 0),
      ),
    ),
    undefined,
  );
  assert.equal(
    tracker.observe(
      codexUsage("turn-1", breakdown(0, 0, 0, 0), breakdown(0, 0, 0, 0)),
    ),
    undefined,
  );
  assert.equal(
    tracker.observe({ method: "turn/completed", params: {} }),
    undefined,
  );
});

test("Codex usage on a resumed thread accepts the first consistent generation", () => {
  const tracker = new CodexTokenUsageTracker({ freshThread: false, now: at });
  const usage = tracker.observe(
    codexUsage(
      "turn-9",
      breakdown(900, 700, 20, 5),
      breakdown(50000, 40000, 900, 100),
    ),
  );
  assert.equal(usage?.responseId, "turn-9:50900");
  assert.equal(usage?.inputTokens, 900);
});

// Claude Code 2.1.x `--include-partial-messages` stream_event frames carry the
// Anthropic Messages streaming events verbatim.
function claudeStream(
  event: Record<string, unknown>,
  parent: string | null = null,
) {
  return {
    type: "stream_event",
    event,
    parent_tool_use_id: parent,
    session_id: "claude-session-1",
    uuid: "uuid",
  };
}

test("Claude usage combines message_start input with the final message_delta output", () => {
  const tracker = new ClaudeStreamUsageTracker({ now: at });
  assert.equal(
    tracker.observe(
      claudeStream({
        type: "message_start",
        message: {
          id: "msg_01",
          model: "claude-sonnet",
          usage: {
            input_tokens: 12,
            cache_creation_input_tokens: 300,
            cache_read_input_tokens: 9000,
            output_tokens: 1,
          },
        },
      }),
    ),
    undefined,
  );
  assert.equal(
    tracker.observe(
      claudeStream({
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 87 },
      }),
    ),
    undefined,
  );
  // The whole-message assistant frame repeats stale usage; it is ignored.
  assert.equal(
    tracker.observe({
      type: "assistant",
      message: { id: "msg_01", usage: { input_tokens: 12, output_tokens: 1 } },
    }),
    undefined,
  );
  assert.deepEqual(tracker.observe(claudeStream({ type: "message_stop" })), {
    provider: "claude-stream-json/v1",
    responseId: "msg_01",
    inputTokens: 9312,
    cachedInputTokens: 9000,
    outputTokens: 87,
    reasoningOutputTokens: null,
    contextWindow: null,
    contextUsedTokens: null,
    observedAt: "2026-09-24T01:00:00.000Z",
  });
  // The cumulative `result.usage` would double count; it never emits.
  assert.equal(
    tracker.observe({
      type: "result",
      subtype: "success",
      usage: { input_tokens: 99, output_tokens: 99 },
    }),
    undefined,
  );
});

test("Claude usage keeps interleaved subagent streams apart and drops unfinished messages", () => {
  const tracker = new ClaudeStreamUsageTracker({ now: at });
  tracker.observe(
    claudeStream({
      type: "message_start",
      message: {
        id: "msg_main",
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    }),
  );
  tracker.observe(
    claudeStream(
      {
        type: "message_start",
        message: {
          id: "msg_sub",
          usage: { input_tokens: 5, output_tokens: 1 },
        },
      },
      "toolu_1",
    ),
  );
  tracker.observe(
    claudeStream(
      { type: "message_delta", usage: { output_tokens: 3 } },
      "toolu_1",
    ),
  );
  const sub = tracker.observe(
    claudeStream({ type: "message_stop" }, "toolu_1"),
  );
  assert.equal(sub?.responseId, "msg_sub");
  assert.equal(sub?.outputTokens, 3);
  // msg_main never reached message_stop (interrupted): no record.
  assert.equal(
    tracker.observe(claudeStream({ type: "message_stop" }, "toolu_2")),
    undefined,
  );
});

// OpenCode 1.18 `message.part.updated` step-finish part: tokens.input excludes
// cache reads/writes and tokens.output excludes reasoning (SessionUsage).
test("OpenCode usage normalizes one step-finish part into one generation", () => {
  assert.deepEqual(
    openCodeStepFinishUsage(
      {
        id: "prt_step_1",
        messageID: "msg_assistant_1",
        sessionID: "ses_1",
        type: "step-finish",
        reason: "tool-calls",
        cost: 0,
        tokens: {
          total: 1510,
          input: 200,
          output: 60,
          reasoning: 40,
          cache: { read: 1000, write: 210 },
        },
      },
      at,
    ),
    {
      provider: "opencode-server/v1",
      responseId: "prt_step_1",
      inputTokens: 1410,
      cachedInputTokens: 1000,
      outputTokens: 100,
      reasoningOutputTokens: 40,
      contextWindow: null,
      contextUsedTokens: null,
      observedAt: "2026-09-24T01:00:00.000Z",
    },
  );
  assert.equal(
    openCodeStepFinishUsage({ id: "prt_text", type: "text", text: "x" }, at),
    undefined,
  );
  assert.equal(
    openCodeStepFinishUsage(
      { id: "prt_bad", type: "step-finish", tokens: { input: -1, output: 1 } },
      at,
    ),
    undefined,
  );
});

test("usage writer emits one valid fd3 frame per response id", () => {
  const written: string[] = [];
  const writer = new ProviderUsageWriter((value) => written.push(value));
  const usage = {
    provider: "opencode-server/v1",
    responseId: "prt_step_1",
    inputTokens: 10,
    cachedInputTokens: 0,
    outputTokens: 2,
    reasoningOutputTokens: 0,
    contextWindow: null,
    contextUsedTokens: null,
    observedAt: "2026-09-24T01:00:00.000Z",
  };
  writer.emit(usage);
  writer.emit(usage);
  writer.emit(undefined);
  assert.equal(written.length, 1);
  assert.ok(written[0]!.endsWith("\n"));
  assert.deepEqual(ProviderUsageFrameSchema.parse(JSON.parse(written[0]!)), {
    protocol: "rah-provider-usage/v1",
    ...usage,
  });
  const failing = new ProviderUsageWriter(() => {
    throw new Error("fd3 closed");
  });
  assert.doesNotThrow(() => failing.emit({ ...usage, responseId: "other" }));
});
