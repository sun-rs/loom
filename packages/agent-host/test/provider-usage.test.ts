import assert from "node:assert/strict";
import test from "node:test";

import {
  ProviderCostFrameSchema,
  ProviderUsageFrameSchema,
  ProviderUsageGapFrameSchema,
} from "@rah-os/protocol";

import {
  ClaudeResultCostTracker,
  ClaudeStreamUsageTracker,
  openCodeStepFinishCost,
  CodexTokenUsageTracker,
  openCodeStepFinishUsage,
  providerUsageGap,
  ProviderUsageWriter,
} from "../src/provider-usage.js";
import type { ProviderUsage, ProviderUsageGap } from "../src/provider-usage.js";

const at = () => Date.parse("2026-09-24T01:00:00.000Z");

/** Narrows a tracker result to a recorded generation (not a gap). */
function generation(value: ProviderUsage | ProviderUsageGap | undefined) {
  assert.ok(value !== undefined && "responseId" in value, "expected usage");
  return value;
}

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
  const second = generation(
    tracker.observe(
      codexUsage(
        "turn-1",
        breakdown(1200, 1000, 30, 0),
        breakdown(2200, 1800, 80, 10),
      ),
    ),
  );
  assert.equal(second?.responseId, "turn-1:2280");
  assert.equal(second?.inputTokens, 1200);
});

const gap = (provider: string, reason: string) => ({
  provider,
  reason,
  observedAt: "2026-09-24T01:00:00.000Z",
});

test("Codex usage never turns an inconsistent cumulative jump into a generation, but reports the gap", () => {
  const tracker = new CodexTokenUsageTracker({ freshThread: true, now: at });
  // Total moved by more than `last`: a generation was missed or recomputed.
  assert.deepEqual(
    tracker.observe(
      codexUsage(
        "turn-1",
        breakdown(100, 0, 10, 0),
        breakdown(5000, 0, 400, 0),
      ),
    ),
    gap("codex-app-server/v1", "inconsistent_total"),
  );
  assert.equal(
    tracker.observe({ method: "turn/completed", params: {} }),
    undefined,
  );
  assert.deepEqual(
    tracker.observe({
      method: "thread/tokenUsage/updated",
      params: { turnId: "turn-1", tokenUsage: { last: {}, total: {} } },
    }),
    gap("codex-app-server/v1", "parse_error"),
  );
});

test("review sequence: an inconsistent middle frame leaves a gap, never a silent undercount", () => {
  const tracker = new CodexTokenUsageTracker({ freshThread: true, now: at });
  const frames = [
    [breakdown(100, 0, 10, 0), breakdown(100, 0, 10, 0)],
    [breakdown(100, 0, 10, 0), breakdown(300, 0, 30, 0)],
    [breakdown(100, 0, 10, 0), breakdown(400, 0, 40, 0)],
  ].map(([last, total]) =>
    tracker.observe(codexUsage("turn-1", last!, total!)),
  );
  assert.equal((frames[0] as { inputTokens: number }).inputTokens, 100);
  assert.deepEqual(frames[1], gap("codex-app-server/v1", "inconsistent_total"));
  // The baseline follows the observed total, so the next frame is exact.
  assert.equal((frames[2] as { inputTokens: number }).inputTokens, 100);
});

test("Codex same-total correction frames are explicit gaps; exact repeats stay silent", () => {
  const tracker = new CodexTokenUsageTracker({ freshThread: true, now: at });
  tracker.observe(
    codexUsage(
      "turn-1",
      breakdown(1000, 800, 50, 10),
      breakdown(1000, 800, 50, 10),
    ),
  );
  // Exact repeat (rate-limit refresh): nothing new, nothing missing.
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
  // Same cumulative total, revised `last`: the recorded fact may be wrong.
  assert.deepEqual(
    tracker.observe(
      codexUsage(
        "turn-1",
        breakdown(990, 800, 60, 10),
        breakdown(1000, 800, 50, 10),
      ),
    ),
    gap("codex-app-server/v1", "correction_frame"),
  );
  // Same totalTokens with a different split, or a lower total: corrections.
  assert.deepEqual(
    tracker.observe(
      codexUsage(
        "turn-1",
        breakdown(1000, 700, 50, 10),
        breakdown(1000, 700, 50, 10),
      ),
    ),
    gap("codex-app-server/v1", "correction_frame"),
  );
  assert.deepEqual(
    tracker.observe(
      codexUsage(
        "turn-1",
        breakdown(900, 700, 50, 10),
        breakdown(900, 700, 50, 10),
      ),
    ),
    gap("codex-app-server/v1", "correction_frame"),
  );
  // The corrected total becomes the baseline for the next generation.
  const next = tracker.observe(
    codexUsage(
      "turn-1",
      breakdown(100, 0, 10, 0),
      breakdown(1000, 700, 60, 10),
    ),
  );
  assert.equal((next as { inputTokens: number }).inputTokens, 100);
});

test("Codex usage on a resumed thread accepts the first consistent generation", () => {
  const tracker = new CodexTokenUsageTracker({ freshThread: false, now: at });
  const usage = generation(
    tracker.observe(
      codexUsage(
        "turn-9",
        breakdown(900, 700, 20, 5),
        breakdown(50000, 40000, 900, 100),
      ),
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
  const sub = generation(
    tracker.observe(claudeStream({ type: "message_stop" }, "toolu_1")),
  );
  assert.equal(sub?.responseId, "msg_sub");
  assert.equal(sub?.outputTokens, 3);
  // msg_main never reached message_stop (interrupted): no record.
  assert.equal(
    tracker.observe(claudeStream({ type: "message_stop" }, "toolu_2")),
    undefined,
  );
});

test("Claude generations whose usage cannot be parsed are reported as gaps", () => {
  const tracker = new ClaudeStreamUsageTracker({ now: at });
  tracker.observe(
    claudeStream({
      type: "message_start",
      message: { id: "msg_no_usage", usage: { output_tokens: 1 } },
    }),
  );
  assert.deepEqual(
    tracker.observe(claudeStream({ type: "message_stop" })),
    gap("claude-stream-json/v1", "parse_error"),
  );
  tracker.observe(
    claudeStream({
      type: "message_start",
      message: { usage: { input_tokens: 1, output_tokens: 1 } },
    }),
  );
  assert.deepEqual(
    tracker.observe(claudeStream({ type: "message_stop" })),
    gap("claude-stream-json/v1", "parse_error"),
    "a generation without a message id is still a lost generation",
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
  assert.deepEqual(
    openCodeStepFinishUsage(
      { id: "prt_bad", type: "step-finish", tokens: { input: -1, output: 1 } },
      at,
    ),
    gap("opencode-server/v1", "parse_error"),
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
  // Gap frames are never deduplicated away and validate as their own frame.
  const unsupported = providerUsageGap(
    "kimi-acp/v1",
    "unsupported_provider",
    at,
  );
  writer.emit(unsupported);
  assert.deepEqual(ProviderUsageGapFrameSchema.parse(JSON.parse(written[1]!)), {
    protocol: "rah-provider-usage-gap/v1",
    ...unsupported,
  });
  const failing = new ProviderUsageWriter(() => {
    throw new Error("fd3 closed");
  });
  assert.doesNotThrow(() => failing.emit({ ...usage, responseId: "other" }));
});

// evo §40: Claude Code 2.1.282 `result.total_cost_usd` is the CLI's own
// list-price estimate, cumulative for the session (restored on resume), so it
// is never summed: the tracker records the raw value and the increase since
// the previous result of the same process; a fresh session starts at 0; the
// first result of a resumed process has no baseline and stays unknown.
const claudeResult = (uuid: string, total: unknown) => ({
  type: "result",
  subtype: "success",
  session_id: "claude-session",
  uuid,
  total_cost_usd: total,
});

test("Claude cost: a fresh session's results become per-result increases of the cumulative total", () => {
  const tracker = new ClaudeResultCostTracker({ freshSession: true, now: at });
  assert.equal(tracker.observe({ type: "assistant" }), undefined);
  assert.deepEqual(tracker.observe(claudeResult("r1", 0.12)), {
    provider: "claude-stream-json/v1",
    costId: "r1",
    source: "claude_result_total_cost_usd",
    reportedTotalUsd: 0.12,
    costUsd: 0.12,
    observedAt: "2026-09-24T01:00:00.000Z",
  });
  const second = tracker.observe(claudeResult("r2", 0.3));
  assert.equal(second?.reportedTotalUsd, 0.3);
  assert.equal(second?.costUsd, 0.18);
});

test("Claude cost: the first result of a resumed process is unknown; later ones are increases", () => {
  const tracker = new ClaudeResultCostTracker({ freshSession: false, now: at });
  const first = tracker.observe(claudeResult("r1", 1.5));
  assert.equal(first?.reportedTotalUsd, 1.5);
  assert.equal(first?.costUsd, null, "no baseline: never the whole total");
  assert.equal(tracker.observe(claudeResult("r2", 1.75))?.costUsd, 0.25);
  // A total that went down proves nothing about this result.
  assert.equal(tracker.observe(claudeResult("r3", 1.0))?.costUsd, null);
  assert.equal(tracker.observe(claudeResult("r4", 1.1))?.costUsd, 0.1);
  // No CLI value: no cost fact at all (unknown, never 0).
  assert.equal(tracker.observe(claudeResult("r5", undefined)), undefined);
  assert.equal(tracker.observe(claudeResult("r6", -1)), undefined);
});

test("OpenCode cost: each step-finish cost is copied as reported, including 0", () => {
  const step = (cost: unknown) => ({
    id: "prt_1",
    type: "step-finish",
    cost,
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
  });
  assert.deepEqual(openCodeStepFinishCost(step(0.0123), at), {
    provider: "opencode-server/v1",
    costId: "prt_1",
    source: "opencode_step_finish_cost",
    reportedTotalUsd: null,
    costUsd: 0.0123,
    observedAt: "2026-09-24T01:00:00.000Z",
  });
  assert.equal(openCodeStepFinishCost(step(0), at)?.costUsd, 0);
  assert.equal(openCodeStepFinishCost(step(undefined), at), undefined);
  assert.equal(openCodeStepFinishCost(step(-0.1), at), undefined);
  assert.equal(
    openCodeStepFinishCost({ ...step(0.1), type: "text" }, at),
    undefined,
  );
});

test("usage writer emits one valid cost frame per cost id", () => {
  const written: string[] = [];
  const writer = new ProviderUsageWriter((value) => written.push(value));
  const fact = new ClaudeResultCostTracker({
    freshSession: true,
    now: at,
  }).observe(claudeResult("r1", 0.2));
  writer.emit(fact);
  writer.emit(fact);
  assert.equal(written.length, 1);
  assert.deepEqual(ProviderCostFrameSchema.parse(JSON.parse(written[0]!)), {
    protocol: "rah-provider-cost/v1",
    ...fact,
  });
});

test("P90: unfinished Claude generation marks a gap at the turn boundary without inventing usage or leaking into next turn", () => {
  const tracker = new ClaudeStreamUsageTracker({ now: at });
  tracker.observe(
    claudeStream({
      type: "message_start",
      message: {
        id: "interrupted",
        usage: { input_tokens: 64650, output_tokens: 1 },
      },
    }),
  );
  assert.deepEqual(
    tracker.finish(),
    gap("claude-stream-json/v1", "parse_error"),
  );
  assert.equal(tracker.finish(), undefined);
  assert.equal(
    tracker.observe(claudeStream({ type: "message_stop" })),
    undefined,
  );
  tracker.observe(
    claudeStream({
      type: "message_start",
      message: { id: "next", usage: { input_tokens: 10, output_tokens: 2 } },
    }),
  );
  assert.equal(
    generation(tracker.observe(claudeStream({ type: "message_stop" })))
      ?.responseId,
    "next",
  );
  assert.equal(tracker.finish(), undefined);
});

test("aggregate writer preserves separate identity and conflicting evidence for Kernel validation", () => {
  const written: string[] = [];
  const writer = new ProviderUsageWriter((value) => written.push(value));
  const aggregate = {
    provider: "pi-print-json/v1",
    kind: "compaction" as const,
    nativeSessionId: "session",
    entryId: "entry",
    inputTokens: 10,
    outputTokens: 2,
    cachedInputTokens: 0,
    reasoningOutputTokens: null,
    observedAt: "2026-10-11T00:00:00.000Z",
  };
  writer.emit(aggregate);
  writer.emit({ ...aggregate, inputTokens: 11 });
  assert.deepEqual(
    written.map((line) => JSON.parse(line).protocol),
    ["rah-provider-usage-aggregate/v1", "rah-provider-usage-aggregate/v1"],
  );
  assert.deepEqual(
    written.map((line) => JSON.parse(line).inputTokens),
    [10, 11],
  );
});
