import test from "node:test";
import assert from "node:assert/strict";
import { piCompactionUsage } from "../src/pi-compaction-usage.mjs";
const entry = () => ({
  type: "compaction",
  id: "compact-1",
  fromHook: false,
  summary: "s",
  firstKeptEntryId: "u",
  tokensBefore: 999999,
  details: {},
  usage: { input: 100, output: 10, cacheRead: 20, cacheWrite: 3, reasoning: 4 },
});
const frame = (e) => ({
  type: "compaction_end",
  aborted: false,
  result: structuredClone(e),
});
test("only matched default native aggregate is counted, optional reasoning remains unknown", () => {
  const e = entry();
  const [a] = piCompactionUsage([e], [frame(e)], "s1");
  assert.equal(a.inputTokens, 123);
  assert.equal(a.outputTokens, 10);
  assert.equal(a.cachedInputTokens, 20);
  assert.equal(a.reasoningOutputTokens, null);
  assert.equal(a.responseId, undefined);
  assert.equal(a.entryId, "compact-1");
});
test("unknown provenance, incomplete counters, mismatches and ambiguous records are not invented usage", () => {
  const e = entry();
  for (const mutate of [
    (x) => delete x.fromHook,
    (x) => (x.fromHook = true),
    (x) => delete x.usage.cacheWrite,
    (x) => (x.usage.input = -1),
    (x) => (x.usage.input = Number.MAX_SAFE_INTEGER),
    (x) => (x.id = ""),
  ]) {
    const candidate = structuredClone(e);
    mutate(candidate);
    assert.deepEqual(
      piCompactionUsage([candidate], [frame(candidate)], "s1"),
      [],
    );
  }
  assert.deepEqual(piCompactionUsage([e], [], "s1"), []);
  assert.deepEqual(
    piCompactionUsage([e], [{ ...frame(e), aborted: true }], "s1"),
    [],
  );
  const wrong = frame(e);
  wrong.result.usage.input++;
  assert.deepEqual(piCompactionUsage([e], [wrong], "s1"), []);
  assert.deepEqual(piCompactionUsage([e], [frame(e), frame(e)], "s1"), []);
  assert.deepEqual(
    piCompactionUsage([e, { ...e, id: "compact-2" }], [frame(e)], "s1"),
    [],
  );
});
