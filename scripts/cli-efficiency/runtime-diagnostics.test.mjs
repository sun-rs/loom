import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeDiagnostics } from "./runtime-diagnostics.mjs";
const usage = (input, total, turn = "t", thread = "s") => ({
  method: "thread/tokenUsage/updated",
  params: {
    threadId: thread,
    turnId: turn,
    tokenUsage: {
      last: {
        inputTokens: input,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: input,
      },
      total: {
        inputTokens: total,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: total,
      },
    },
  },
});
const compact = (id, turn = "t", thread = "s") => ({
  method: "item/completed",
  params: {
    threadId: thread,
    turnId: turn,
    item: { type: "contextCompaction", id },
  },
});
const run = (frames) => {
  const d = new RuntimeDiagnostics();
  frames.forEach((f) => d.observe(f));
  return d.finish();
};

test("compares each compaction pre/post, never successive post values or cumulative totals", () => {
  const r = run([
    usage(100, 100),
    compact("a"),
    usage(20, 120),
    usage(110, 230),
    compact("b"),
    usage(21, 251),
  ]);
  assert.deepEqual(
    r.compactions.map((c) => [c.pre, c.post, c.classification]),
    [
      [100, 20, "observed-reduction"],
      [110, 21, "observed-reduction"],
    ],
  );
  assert.equal(r.wastedTokens, null);
});
test("same turn zero markers are bounded and exact notification replays do not double count", () => {
  const u = usage(100, 100),
    c = compact("a");
  const r = run([u, u, c, c, usage(0, 100), usage(105, 205)]);
  assert.equal(r.compactions.length, 1);
  assert.equal(r.compactions[0].classification, "no-observed-reduction");
  assert.equal(r.compactions[0].post, 105);
});
test("missing post, turn end, different sessions and usage corrections cannot manufacture a comparison", () => {
  for (const tail of [
    [],
    [usage(20, 120, "other")],
    [usage(20, 120, "t", "other")],
    [
      {
        method: "turn/completed",
        params: { threadId: "s", turn: { id: "t" } },
      },
      usage(20, 120),
    ],
    [usage(20, 90)],
  ]) {
    const r = run([usage(100, 100), compact("a"), ...tail]);
    assert.equal(r.compactions[0].classification, "unknown");
  }
});
test("intervening tool results or too many zero markers make the post boundary ambiguous", () => {
  for (const tail of [
    [
      {
        method: "item/completed",
        params: {
          threadId: "s",
          turnId: "t",
          item: { type: "commandExecution", id: "tool" },
        },
      },
      usage(20, 120),
    ],
    [...Array.from({ length: 6 }, () => usage(0, 100)), usage(20, 120)],
  ])
    assert.equal(
      run([usage(100, 100), compact("a"), ...tail]).compactions[0]
        .classification,
      "unknown",
    );
});
test("Pi estimates and compaction request usage are not exact post context or wasted expense", () => {
  const r = run([
    { type: "session", id: "pi-s" },
    { type: "compaction_start", reason: "threshold" },
    {
      type: "compaction_end",
      aborted: false,
      willRetry: false,
      result: {
        tokensBefore: 112091,
        estimatedTokensAfter: 25888,
        usage: { input: 82296, output: 3108 },
      },
    },
  ]);
  assert.equal(r.compactions[0].pre, 112091);
  assert.equal(r.compactions[0].post, null);
  assert.equal(r.compactions[0].estimatedPost, 25888);
  assert.equal(r.compactions[0].classification, "unknown");
  assert.equal(r.retryObservations.length, 0);
  assert.equal(r.wastedTokens, null);
});
test("Pi willRetry is only intent and absent start is incomplete evidence", () => {
  const r = run([
    { type: "session", id: "pi-s" },
    { type: "compaction_end", aborted: true, willRetry: true },
  ]);
  assert.equal(r.compactions[0].reason, "missing-start-or-session");
  assert.equal(r.retryObservations[0].kind, "retry-intent");
});
test("OpenCode explicit retry attempts are deduplicated by session and attempt, not inferred from tool failures", () => {
  const retry = (attempt) => ({
    type: "session.status",
    properties: {
      sessionID: "s",
      status: { type: "retry", attempt, message: "sensitive error", next: 100 },
    },
  });
  const r = run([
    retry(1),
    retry(1),
    retry(2),
    { type: "tool_execution_end", isError: true },
    { type: "message_end" },
  ]);
  assert.equal(r.retryObservations.length, 2);
  assert.ok(!JSON.stringify(r).includes("sensitive error"));
  assert.equal(r.retryWasteVerdict, "unknown");
});
test("unknown frames cannot establish absence of waste or provider coverage", () => {
  const r = run([{ type: "foo" }]);
  assert.equal(r.recognizedFrames, 0);
  assert.equal(r.coverage, "partial-or-unknown");
  assert.deepEqual(r.compactions, []);
});

test("file reader preserves physical line references, rejects corrupt input and emits no raw message text", async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { inspectRuntimeFile } = await import("./runtime-diagnostics.mjs");
  const root = await mkdtemp(join(tmpdir(), "loom-offline-diagnostic-"));
  try {
    const path = join(root, "trace.jsonl");
    const source = [
      JSON.stringify(usage(100, 100)),
      "",
      JSON.stringify(compact("a")),
      JSON.stringify(usage(20, 120)),
      JSON.stringify({ type: "message_update", secret: "private text" }),
    ].join("\n");
    await writeFile(path, source);
    const report = await inspectRuntimeFile(path);
    assert.equal(report.compactions[0].line, 3);
    assert.equal(report.compactions[0].postLine, 4);
    assert.ok(!JSON.stringify(report).includes("private text"));
    assert.equal(await readFile(path, "utf8"), source);
    await writeFile(path, source + "\nnot-json");
    await assert.rejects(inspectRuntimeFile(path), /Invalid JSON at line 6/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCode attempt numbers may restart after idle; later retry cycles must not disappear", () => {
  const retry = {
    type: "session.status",
    properties: {
      sessionID: "s",
      status: { type: "retry", attempt: 1, next: 100 },
    },
  };
  const r = run([
    retry,
    retry,
    { type: "session.idle", properties: { sessionID: "s" } },
    retry,
  ]);
  assert.equal(r.retryObservations.length, 2);
});
