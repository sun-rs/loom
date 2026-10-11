import assert from "node:assert/strict";
import test from "node:test";
import { ProviderUsageAggregateFrameSchema } from "../src/index.ts";
const frame = {
  protocol: "rah-provider-usage-aggregate/v1",
  provider: "native-cli",
  kind: "compaction",
  nativeSessionId: "session-a",
  entryId: "entry-a",
  inputTokens: 100,
  outputTokens: 20,
  cachedInputTokens: null,
  reasoningOutputTokens: null,
  observedAt: "2026-10-11T00:00:00.000Z",
};
test("native aggregate admits only explicit safe counts and native identity", () => {
  assert.deepEqual(ProviderUsageAggregateFrameSchema.parse(frame), frame);
  for (const extra of [
    { responseId: "fake" },
    { generations: 1 },
    { httpAttempts: 1 },
    { inputTokens: Number.MAX_SAFE_INTEGER + 1 },
    { cachedInputTokens: 101 },
    { reasoningOutputTokens: 21 },
    { entryId: "" },
    { nativeSessionId: "" },
  ])
    assert.throws(() =>
      ProviderUsageAggregateFrameSchema.parse({ ...frame, ...extra }),
    );
});
