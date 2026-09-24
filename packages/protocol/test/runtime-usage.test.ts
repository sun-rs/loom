import assert from "node:assert/strict";
import test from "node:test";

import {
  ClientRunAttemptUsageGetRequestSchema,
  ClientRunAttemptUsageGetResponseSchema,
  RuntimeProcessCleanupRecordInputSchema,
  ProviderUsageFrameSchema,
  ProviderUsageGapFrameSchema,
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
    completeness: "complete",
    gaps: [],
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
    processCleanups: [],
  });
  assert.equal(response.totals.generations, 1);
  // Unknown is not zero: an unavailable read carries null totals and reasons.
  const unavailable = ClientRunAttemptUsageGetResponseSchema.parse({
    runAttemptId: "run-2",
    completeness: "unavailable",
    gaps: [
      {
        reason: "unsupported_provider",
        provider: "kimi-acp/v1",
        occurrences: 1,
        firstObservedAt: "2026-09-24T01:00:00.000Z",
        lastObservedAt: "2026-09-24T01:00:00.000Z",
      },
    ],
    generations: [],
    totals: {
      generations: null,
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningOutputTokens: null,
    },
    truncated: false,
    processCleanups: [],
  });
  assert.equal(unavailable.totals.inputTokens, null);
  assert.throws(() =>
    ClientRunAttemptUsageGetResponseSchema.parse({
      ...unavailable,
      completeness: undefined,
    }),
  );
  assert.throws(() =>
    ProviderUsageGapFrameSchema.parse({
      protocol: "rah-provider-usage-gap/v1",
      provider: "codex-app-server/v1",
      reason: "estimated",
      observedAt: "2026-09-24T01:00:00.000Z",
    }),
  );
});

test("S2-0 cleanup record input is bounded and strict", () => {
  const valid = {
    cleanupId: "cleanup-1",
    participantId: "agent-1",
    runtimeRunId: "process:runtime-1",
    trigger: "janitor",
    foundCount: 1,
    killedCount: 1,
    remainingCount: 0,
    releasedPorts: [3000],
    remainingPorts: [],
    capExceeded: [],
    observedAt: "2026-09-24T01:00:00.000Z",
  };
  assert.equal(
    RuntimeProcessCleanupRecordInputSchema.parse(valid).trigger,
    "janitor",
  );
  for (const invalid of [
    { ...valid, trigger: "guess" },
    { ...valid, releasedPorts: [70_000] },
    { ...valid, capExceeded: ["cpu"] },
    { ...valid, extra: true },
    // Every record names its runtime (no participant-wide "all clear").
    { ...valid, runtimeRunId: undefined },
    { ...valid, unknownCount: -1 },
  ])
    assert.throws(() => RuntimeProcessCleanupRecordInputSchema.parse(invalid));
  const parsed = RuntimeProcessCleanupRecordInputSchema.parse(valid);
  assert.equal(parsed.unknownCount, 0);
  assert.equal(parsed.portsObserved, true);
});
