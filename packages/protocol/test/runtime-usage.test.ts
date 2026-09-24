import assert from "node:assert/strict";
import test from "node:test";

import {
  ClientRunAttemptUsageGetRequestSchema,
  ClientRunAttemptUsageGetResponseSchema,
  ProviderUsageFrameSchema,
  RunAttemptUsageRecordInputSchema,
} from "../src/index.ts";

const frame = {
  protocol: "rah-provider-usage/v1",
  provider: "codex-app-server/v1",
  responseId: "turn-1:1200",
  inputTokens: 1000,
  cachedInputTokens: 800,
  outputTokens: 200,
  reasoningOutputTokens: 50,
  contextWindow: 258400,
  contextUsedTokens: 1200,
  observedAt: "2026-09-24T01:00:00.000Z",
} as const;

test("provider usage frame accepts one native generation with nullable unknowns", () => {
  assert.deepEqual(ProviderUsageFrameSchema.parse(frame), frame);
  assert.deepEqual(
    ProviderUsageFrameSchema.parse({
      ...frame,
      reasoningOutputTokens: null,
      contextWindow: null,
      contextUsedTokens: null,
    }).reasoningOutputTokens,
    null,
  );
});

test("provider usage frame rejects impossible or estimated-looking counts", () => {
  for (const invalid of [
    { ...frame, inputTokens: -1 },
    { ...frame, outputTokens: 1.5 },
    { ...frame, inputTokens: Number.POSITIVE_INFINITY },
    { ...frame, inputTokens: Number.MAX_SAFE_INTEGER + 1 },
    { ...frame, cachedInputTokens: 1001 },
    { ...frame, reasoningOutputTokens: 201 },
    { ...frame, contextWindow: 0 },
    { ...frame, responseId: "" },
    { ...frame, protocol: "rah-provider-usage/v2" },
    { ...frame, extra: true },
  ]) {
    assert.throws(() => ProviderUsageFrameSchema.parse(invalid));
  }
  const { reasoningOutputTokens: _omitted, ...missing } = frame;
  assert.throws(() => ProviderUsageFrameSchema.parse(missing));
});

test("Host usage record input binds the frame to one RunAttempt runtime", () => {
  const { protocol: _protocol, ...fields } = frame;
  const input = RunAttemptUsageRecordInputSchema.parse({
    ...fields,
    runAttemptId: "run-1",
    runtimeRunId: "runtime-1",
  });
  assert.equal(input.runAttemptId, "run-1");
  assert.throws(() =>
    RunAttemptUsageRecordInputSchema.parse({ ...fields, runAttemptId: "run" }),
  );
  assert.throws(() =>
    RunAttemptUsageRecordInputSchema.parse({
      ...fields,
      cachedInputTokens: 5000,
      runAttemptId: "run-1",
      runtimeRunId: "runtime-1",
    }),
  );
});

test("client run usage read is a strict per-RunAttempt summary", () => {
  assert.deepEqual(
    ClientRunAttemptUsageGetRequestSchema.parse({
      agentId: "agent-1",
      runAttemptId: "run-1",
    }),
    { agentId: "agent-1", runAttemptId: "run-1" },
  );
  assert.throws(() =>
    ClientRunAttemptUsageGetRequestSchema.parse({ agentId: "agent-1" }),
  );
  const response = ClientRunAttemptUsageGetResponseSchema.parse({
    runAttemptId: "run-1",
    generations: [
      {
        responseId: "turn-1:1200",
        provider: "codex-app-server/v1",
        inputTokens: 1000,
        cachedInputTokens: 800,
        outputTokens: 200,
        reasoningOutputTokens: 50,
        contextWindow: 258400,
        contextUsedTokens: 1200,
        observedAt: "2026-09-24T01:00:00.000Z",
        recordedAt: "2026-09-24T01:00:00.100Z",
      },
    ],
    totals: {
      generations: 1,
      inputTokens: 1000,
      cachedInputTokens: 800,
      outputTokens: 200,
      reasoningOutputTokens: 50,
    },
    truncated: false,
  });
  assert.equal(response.totals.generations, 1);
});
