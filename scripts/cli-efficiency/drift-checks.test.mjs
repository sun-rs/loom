import test from "node:test";
import assert from "node:assert/strict";
import {
  checkFormat,
  codexToolCalls,
  countCodexCompactions,
  countCodexTargetRejections,
  evaluateRound,
  exitCodeFor,
  formatDriftTable,
  summarizeDrift,
} from "./drift-checks.mjs";
import { buildDriftScenario } from "./drift-scenario.mjs";

const scenario = buildDriftScenario({ rounds: 20, compactAt: [8, 15] });
const ctx = {
  threadId: "thread-1",
  roomId: "room-1",
  provider: "codex",
  mode: "cold",
};
const specOf = (template) => scenario.find((r) => r.template === template);

// Evidence as the runner reads it from room.db, for a well-behaved round.
function evidenceFor(spec, overrides = {}) {
  const replies = [];
  if (spec.expect.reply) {
    const f = spec.expect.format;
    const body = f
      ? `${f.prefix}${(f.mustInclude ?? []).join(" ")} ${(f.mustIncludeAny ?? [])[0] ?? ""} 好的`.trim()
      : "好的";
    replies.push({
      messageId: `m${spec.round}`,
      roomId: "room-1",
      threadId: spec.expect.target === "thread" ? "thread-1" : null,
      body,
      roomSeq: spec.round * 10,
      eventId: `e${spec.round}`,
    });
  }
  return {
    replies,
    activations: [
      { activationId: `a${spec.round}`, state: "completed", attemptCount: 1 },
    ],
    runs: [
      {
        runAttemptId: `r${spec.round}`,
        activationId: `a${spec.round}`,
        state: "exited",
        exitCode: 0,
        executionMode: null,
      },
    ],
    finalReplies: replies.length
      ? [
          {
            runAttemptId: `r${spec.round}`,
            eventId: `e${spec.round}`,
            roomSeq: spec.round * 10,
          },
        ]
      : [],
    newTasks: [],
    toolCalls: null,
    usage: {
      generations: 2,
      input: 1000,
      cached: 800,
      completeness: "complete",
    },
    compactionsInRound: 0,
    ...overrides,
  };
}
const passAll = () =>
  scenario.map((s) => evaluateRound(s, evidenceFor(s), ctx));
const compactions = [
  { afterRound: 8, forced: true, observed: true, mechanism: "x" },
  { afterRound: 15, forced: true, observed: true, mechanism: "x" },
];

test("format: prefix, code-point length and required tokens", () => {
  const f = {
    prefix: "R01答：",
    maxChars: 10,
    mustInclude: [],
    mustIncludeAny: [],
  };
  assert.equal(checkFormat("R01答：一二三四五", f).ok, true);
  assert.equal(checkFormat("R01答：一二三四五六", f).lengthOk, false);
  assert.equal(checkFormat("答：一二", f).prefixOk, false);
  const r = {
    prefix: "【规则】",
    maxChars: null,
    mustInclude: ["LOOM-7Q"],
    mustIncludeAny: ["message-check", "based-on-room-seq"],
  };
  assert.equal(
    checkFormat("【规则】loom-7q，靠 Message-Check 确认", r).ok,
    true,
  );
  assert.equal(checkFormat("【规则】LOOM-7Q，靠回复确认", r).includeOk, false);
  assert.equal(checkFormat("  R01答：ok  ", f).ok, true);
});

test("a well-behaved run passes every criterion", () => {
  const s = summarizeDrift(passAll(), { compactAt: [8, 15], compactions });
  assert.equal(s.status, "pass");
  assert.deepEqual(s.evidenceGaps, []);
  assert.equal(s.totals.finalRate, 1);
  assert.equal(s.totals.expectedReplies, s.totals.delivered);
  assert.ok(s.totals.silentRounds >= 6);
  assert.equal(s.windows.length, 2);
  assert.ok(s.windows.every((w) => !w.degraded));
  assert.equal(exitCodeFor(s.status), 0);
});

test("wrong target: a thread question answered at room level", () => {
  const spec = specOf("thread-recall");
  const ev = evidenceFor(spec);
  ev.replies[0].threadId = null;
  const e = evaluateRound(spec, ev, ctx);
  assert.equal(e.checks.delivered, false);
  assert.equal(e.checks.wrongTarget, 1);
  assert.deepEqual(e.failures.sort(), ["notDelivered", "wrongTarget"]);
  // A post in another Room is a wrong target too.
  const other = evidenceFor(specOf("qa"));
  other.replies.push({ ...other.replies[0], roomId: "dm-1", eventId: "x" });
  assert.equal(evaluateRound(specOf("qa"), other, ctx).checks.wrongTarget, 1);
});

test("silence: FYI or @other posts are violations; silent + completed is acknowledged", () => {
  for (const t of ["fyi", "other"]) {
    const spec = specOf(t);
    const ok = evaluateRound(spec, evidenceFor(spec), ctx);
    assert.equal(ok.checks.silenceViolation, false);
    assert.equal(ok.checks.silentAcked, true);
    assert.deepEqual(ok.failures, []);
    const noisy = evidenceFor(spec, {
      replies: [
        {
          messageId: "m",
          roomId: "room-1",
          threadId: null,
          body: "收到",
          roomSeq: 1,
          eventId: "e",
        },
      ],
    });
    assert.ok(
      evaluateRound(spec, noisy, ctx).failures.includes("silenceViolation"),
    );
  }
});

test("forbidden Task and unacknowledged or retried Activations fail", () => {
  const spec = specOf("task-window");
  assert.ok(
    evaluateRound(
      spec,
      evidenceFor(spec, { newTasks: [{ taskId: "t1", creatorId: "agent" }] }),
      ctx,
    ).failures.includes("forbiddenTask"),
  );
  const q = evaluateRound(
    spec,
    evidenceFor(spec, {
      activations: [
        { activationId: "a", state: "quarantined", attemptCount: 3 },
      ],
    }),
    ctx,
  );
  assert.ok(q.failures.includes("quarantined"));
  assert.ok(q.failures.includes("retried"));
  assert.ok(q.failures.includes("ackIncomplete"));
  const twoRuns = evidenceFor(spec);
  twoRuns.runs.push({ ...twoRuns.runs[0], runAttemptId: "r2" });
  assert.ok(evaluateRound(spec, twoRuns, ctx).failures.includes("retried"));
});

test("--final must mark the round's last post", () => {
  const spec = specOf("qa");
  const none = evaluateRound(
    spec,
    evidenceFor(spec, { finalReplies: [] }),
    ctx,
  );
  assert.equal(none.checks.finalOnLastPost, false);
  const ev = evidenceFor(spec);
  ev.replies.unshift({ ...ev.replies[0], eventId: "progress", body: "处理中" });
  ev.finalReplies = [{ runAttemptId: "r", eventId: "progress", roomSeq: 1 }];
  assert.equal(evaluateRound(spec, ev, ctx).checks.finalOnLastPost, false);
  // Final rate below 95% violates the gate (exit 2).
  const rounds = scenario.map((s) =>
    evaluateRound(
      s,
      evidenceFor(s, s.round === 1 ? { finalReplies: [] } : {}),
      ctx,
    ),
  );
  const sum = summarizeDrift(rounds, { compactAt: [8, 15], compactions });
  assert.ok(sum.totals.finalRate < 0.95);
  assert.equal(sum.criteria.final95, false);
  assert.equal(sum.status, "violated");
  assert.equal(exitCodeFor(sum.status), 2);
});

test("degradation: a format miss right after a compaction is reported", () => {
  const rounds = scenario.map((s) => {
    const ev = evidenceFor(s);
    if (s.round === 9) ev.replies[0].body = "没有前缀的回答";
    return evaluateRound(s, ev, ctx);
  });
  const sum = summarizeDrift(rounds, { compactAt: [8, 15], compactions });
  const w = sum.windows.find((x) => x.afterRound === 8);
  assert.equal(w.degraded, true);
  assert.deepEqual(w.reasons, ["formatRate"]);
  assert.equal(sum.windows.find((x) => x.afterRound === 15).degraded, false);
  assert.equal(sum.criteria.noDegradation, false);
  assert.equal(sum.status, "violated");
});

test("warm Codex: box-post without --turn fails; unobserved forced compaction is missing evidence", () => {
  const warm = { ...ctx, mode: "warm" };
  const spec = specOf("qa");
  const calls = codexToolCalls([
    {
      payload: {
        type: "function_call",
        arguments:
          '{"cmd":"worker message-post --final --based-on-room-seq 3"}',
      },
    },
  ]);
  const e = evaluateRound(spec, evidenceFor(spec, { toolCalls: calls }), warm);
  assert.equal(e.checks.turnHandle, false);
  assert.ok(e.failures.includes("turnHandleMissing"));
  const sum = summarizeDrift(passAll(), {
    compactAt: [8, 15],
    compactions: [compactions[0], { ...compactions[1], observed: false }],
  });
  assert.equal(sum.status, "missing-evidence");
  assert.deepEqual(sum.evidenceGaps, ["compaction15NotObserved"]);
  assert.equal(exitCodeFor(sum.status), 1);
  const unforced = summarizeDrift(passAll(), {
    compactAt: [8, 15],
    compactions: [
      compactions[0],
      { afterRound: 15, forced: false, observed: false },
    ],
  });
  assert.equal(unforced.status, "pass");
});

test("codex rollout parsing: Worker call kinds and compaction records", () => {
  const calls = codexToolCalls([
    {
      payload: {
        type: "function_call",
        arguments: "worker message-check --turn abc",
      },
    },
    {
      payload: {
        type: "custom_tool_call",
        input: "worker message-post --turn abc --final",
      },
    },
    { payload: { type: "function_call", arguments: "sed -n 1,5p x" } },
    { payload: { type: "message" } },
  ]);
  assert.deepEqual(calls, [
    { kind: "box-check", turnHandle: true, final: undefined },
    { kind: "box-post", turnHandle: true, final: true },
    { kind: "other" },
  ]);
  assert.equal(
    countCodexCompactions([
      { type: "compacted" },
      { type: "event_msg", payload: { type: "context_compacted" } },
      { type: "event_msg", payload: { type: "token_count" } },
    ]),
    2,
  );
});

test("session change and timeouts are evidence gaps; table renders every round", () => {
  const rounds = passAll();
  rounds[4].failures.push("sessionChanged");
  const sum = summarizeDrift(rounds, { compactAt: [8, 15], compactions });
  assert.equal(sum.status, "missing-evidence");
  assert.deepEqual(sum.evidenceGaps, ["round5:sessionChanged"]);
  const table = formatDriftTable(passAll(), [
    { round: 9, compactedBefore: true, firstReplySeconds: 4.2 },
  ]);
  assert.equal(table.split("\n").length, 21);
  assert.match(table.split("\n")[9], /^9\s+qa\s+C/);
});

test("a definite target rejection then a corrected post counts as delivered-correct, and the rejection is reported", () => {
  const spec = specOf("qa") ?? scenario.find((r) => r.expect.reply);
  const rejections = countCodexTargetRejections([
    {
      payload: {
        type: "custom_tool_call_output",
        output: [
          {
            type: "input_text",
            text: "Error: Worker API HTTP 409\nCode: reply_target_mismatch\n",
          },
        ],
      },
    },
    {
      payload: {
        type: "function_call_output",
        output: "Code: reply_target_mismatch",
      },
    },
    { payload: { type: "custom_tool_call_output", output: "posted seq 12" } },
    { payload: { type: "function_call", arguments: "reply_target_mismatch" } },
  ]);
  assert.equal(rejections, 2);
  const round = evaluateRound(
    spec,
    evidenceFor(spec, { targetRejections: rejections }),
    ctx,
  );
  assert.equal(round.checks.delivered, true);
  assert.equal(round.checks.wrongTarget, 0);
  assert.equal(round.checks.targetRejections, 2);
  assert.deepEqual(round.failures, []);
  const rounds = passAll();
  const index = rounds.findIndex((r) => r.round === spec.round);
  rounds[index] = round;
  const sum = summarizeDrift(rounds, { compactAt: [8, 15], compactions });
  assert.equal(sum.totals.targetRejections, 2);
  assert.equal(sum.status, "pass");
  assert.match(formatDriftTable(rounds).split("\n")[0], /\brej\b/u);
});
