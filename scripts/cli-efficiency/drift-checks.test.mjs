import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCodexTurnContexts,
  checkFormat,
  checkRoundModels,
  codexToolCalls,
  countCodexCompactions,
  countCodexTargetRejections,
  evaluateRound,
  exitCodeFor,
  formatDriftTable,
  summarizeCompactionOverhead,
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
    modelEvidence: { status: "verified", records: 1 },
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
  // Codex rollouts observe refusals on every round (0 when none).
  const rounds = scenario.map((s) =>
    evaluateRound(s, evidenceFor(s, { targetRejections: 0 }), ctx),
  );
  const index = rounds.findIndex((r) => r.round === spec.round);
  rounds[index] = round;
  const sum = summarizeDrift(rounds, { compactAt: [8, 15], compactions });
  assert.equal(sum.totals.targetRejections, 2);
  assert.equal(sum.totals.targetRejectionsUnobservedRounds, 0);
  assert.equal(sum.status, "pass");
  assert.match(formatDriftTable(rounds).split("\n")[0], /\brej\b/u);
});

/**
 * P1-2 (2026-09-25 review): every hard per-round failure reaches the summary
 * even when no compaction window covers it; format stays a reported rate.
 */
test("a single hard per-round failure with everything else fine violates the gate", () => {
  const spec = specOf("qa");
  const variants = {
    ackIncomplete: evidenceFor(spec, {
      activations: [
        { activationId: `a${spec.round}`, state: "running", attemptCount: 1 },
      ],
    }),
    retried: (() => {
      const ev = evidenceFor(spec);
      ev.runs.push({ ...ev.runs[0], runAttemptId: "r-retry" });
      return ev;
    })(),
    forbiddenTask: evidenceFor(spec, {
      newTasks: [{ taskId: "t", creatorId: "agent" }],
    }),
  };
  for (const [failure, evidence] of Object.entries(variants)) {
    const rounds = passAll();
    const index = rounds.findIndex((r) => r.round === spec.round);
    rounds[index] = evaluateRound(spec, evidence, ctx);
    assert.deepEqual(rounds[index].failures, [failure]);
    const sum = summarizeDrift(rounds, { compactAt: [], compactions: [] });
    assert.equal(sum.status, "violated", failure);
    assert.equal(sum.criteria.noHardRoundFailure, false, failure);
    assert.deepEqual(sum.hardFailures, [`round${spec.round}:${failure}`]);
  }
  const acks = passAll();
  acks[0] = evaluateRound(
    scenario[0],
    evidenceFor(scenario[0], {
      activations: [{ activationId: "a1", state: "running", attemptCount: 1 }],
    }),
    ctx,
  );
  const ackSum = summarizeDrift(acks, { compactAt: [], compactions: [] });
  assert.equal(ackSum.criteria.ack100, false);
  assert.equal(ackSum.totals.ackIncomplete, 1);
});

test("warm Codex: a missing turn handle outside any window violates the gate", () => {
  const warm = { ...ctx, mode: "warm" };
  const good = codexToolCalls([
    {
      payload: {
        type: "function_call",
        arguments: '{"cmd":"worker message-post --final --turn T"}',
      },
    },
  ]);
  const bad = codexToolCalls([
    {
      payload: {
        type: "function_call",
        arguments: '{"cmd":"worker message-post --final"}',
      },
    },
  ]);
  const rounds = scenario.map((s) =>
    evaluateRound(
      s,
      evidenceFor(s, {
        toolCalls: s.expect.reply ? (s.round === 2 ? bad : good) : [],
      }),
      warm,
    ),
  );
  const sum = summarizeDrift(rounds, { compactAt: [], compactions: [] });
  assert.equal(sum.criteria.turnHandle100, false);
  assert.equal(sum.status, "violated");
});

test("a format miss alone stays a reported statistic, not a hard failure", () => {
  const rounds = scenario.map((s) => {
    const ev = evidenceFor(s);
    if (s.round === 2 && ev.replies[0]) ev.replies[0].body = "无前缀";
    return evaluateRound(s, ev, ctx);
  });
  const sum = summarizeDrift(rounds, { compactAt: [], compactions: [] });
  assert.equal(sum.criteria.noHardRoundFailure, true);
  assert.ok(sum.totals.formatRate < 1);
  assert.equal(sum.status, "pass");
});

test("unobservable target rejections stay unknown, never summed as zero", () => {
  const sum = summarizeDrift(passAll(), { compactAt: [], compactions: [] });
  assert.equal(sum.totals.targetRejections, null);
  assert.equal(sum.totals.targetRejectionsUnobservedRounds, scenario.length);
  const mixed = passAll();
  mixed[0] = evaluateRound(
    scenario[0],
    evidenceFor(scenario[0], { targetRejections: 1 }),
    ctx,
  );
  const partial = summarizeDrift(mixed, { compactAt: [], compactions: [] });
  assert.equal(partial.totals.targetRejections, null);
  assert.equal(partial.totals.targetRejectionsObserved, 1);
  assert.equal(
    partial.totals.targetRejectionsUnobservedRounds,
    scenario.length - 1,
  );
});

test("post-hoc model evidence: missing or absent evidence is an evidence gap", () => {
  const spec = specOf("qa");
  for (const modelEvidence of [
    { status: "missing", reason: "transcript unreadable" },
    undefined,
  ]) {
    const e = evaluateRound(spec, evidenceFor(spec, { modelEvidence }), ctx);
    assert.ok(
      e.failures.includes("modelEvidenceMissing"),
      String(modelEvidence),
    );
    assert.deepEqual(e.checks.modelEvidence, modelEvidence ?? null);
  }
  const evaluated = scenario.map((s) =>
    evaluateRound(
      s,
      evidenceFor(
        s,
        s.round === 3
          ? { modelEvidence: { status: "missing", reason: "no model record" } }
          : {},
      ),
      ctx,
    ),
  );
  const sum = summarizeDrift(evaluated, { compactAt: [8, 15], compactions });
  assert.equal(sum.status, "missing-evidence");
  assert.deepEqual(sum.evidenceGaps, ["round3:modelEvidenceMissing"]);
  assert.deepEqual(sum.hardFailures, []);
});

test("checkRoundModels: verified only with at least one approved record", () => {
  assert.deepEqual(
    checkRoundModels(() => 2),
    { status: "verified", records: 2 },
  );
  assert.deepEqual(
    checkRoundModels(() => 0),
    {
      status: "missing",
      reason: "no model record in the round window",
    },
  );
  const read = checkRoundModels(() => {
    throw new Error("Exactly one native transcript");
  });
  assert.equal(read.status, "missing");
  assert.match(read.reason, /Exactly one native transcript/);
  assert.equal(checkRoundModels(null).status, "missing");
  // An unapproved model is a violation, never downgraded to a gap.
  assert.throws(
    () =>
      checkRoundModels(() => {
        throw new Error("Unapproved model gpt-6-sol");
      }),
    /Unapproved model gpt-6-sol/,
  );
});

test("codex rollout turn contexts: exact model and effort, counted", () => {
  const approved = { model: "gpt-6-luna", effort: "low" };
  const ctxEvent = (model, effort) => ({
    type: "turn_context",
    payload: { model, effort },
  });
  assert.equal(
    assertCodexTurnContexts(
      [ctxEvent("gpt-6-luna", "low"), { type: "event_msg" }],
      approved,
    ),
    1,
  );
  assert.equal(assertCodexTurnContexts([{ type: "event_msg" }], approved), 0);
  assert.throws(
    () => assertCodexTurnContexts([ctxEvent("gpt-6-sol", "low")], approved),
    /Unapproved model gpt-6-sol/,
  );
  assert.throws(
    () => assertCodexTurnContexts([ctxEvent("gpt-6-luna", "ultra")], approved),
    /Unapproved effort ultra/,
  );
});

// Owner B (2026-09-25): platform overhead after repeated compactions.
// Synthetic rounds: usage and Worker (protocol) calls per round.
const overheadRounds = (rounds, of) =>
  Array.from({ length: rounds }, (_, i) => {
    const round = i + 1;
    const {
      input,
      uncached = input / 5,
      generations = 2,
      protocol = 1,
    } = of(round);
    return {
      round,
      template: "qa",
      failures: [],
      checks: {
        usage: { generations, input, uncached, completeness: "complete" },
        protocolCalls: protocol,
      },
    };
  });
test("owner B: evaluateRound counts protocol calls, unknown conservatively included", () => {
  const spec = specOf("qa");
  const e = evaluateRound(
    spec,
    evidenceFor(spec, {
      toolCalls: [
        { kind: "other" },
        { kind: "box-check" },
        { kind: "box-post", turnHandle: true, final: true },
        { kind: "unknown" },
      ],
    }),
    ctx,
  );
  assert.equal(e.checks.protocolCalls, 3);
  assert.deepEqual(e.checks.toolCalls, {
    total: 4,
    business: 1,
    protocol: 2,
    unknown: 1,
    byKind: { other: 1, "box-check": 1, "box-post": 1, unknown: 1 },
  });
  // No tool-call evidence: unknown, never zero.
  assert.equal(
    evaluateRound(spec, evidenceFor(spec), ctx).checks.protocolCalls,
    null,
  );
});
test("owner B: a single compaction with flat overhead is stable", () => {
  const rounds = overheadRounds(10, () => ({ input: 1000 }));
  const o = summarizeCompactionOverhead(rounds, [5]);
  assert.equal(o.status, "stable");
  assert.equal(o.compactionOverheadRising, false);
  assert.equal(o.riseThreshold, 0.25);
  assert.deepEqual(o.baseline, {
    fromRound: 1,
    toRound: 5,
    rounds: 5,
    meanInput: 1000,
    meanUncached: 200,
    meanGenerations: 2,
    meanProtocolCalls: 1,
  });
  assert.equal(o.windows.length, 1);
  assert.deepEqual(o.windows[0].range, { fromRound: 6, toRound: 10 });
  assert.deepEqual(o.windows[0].ratio, {
    input: 1,
    uncached: 1,
    generations: 1,
    protocolCalls: 1,
  });
  assert.deepEqual(o.windows[0].reasons, []);
});
test("owner B: overhead rising only after the second compaction is flagged with step changes", () => {
  const rounds = overheadRounds(20, (r) => ({
    input: r <= 8 ? 1000 : r <= 15 ? 1100 : 1300,
  }));
  const o = summarizeCompactionOverhead(rounds, [8, 15]);
  assert.equal(o.windows.length, 2);
  assert.deepEqual(o.windows[0].range, { fromRound: 9, toRound: 15 });
  assert.deepEqual(o.windows[1].range, { fromRound: 16, toRound: 20 });
  assert.equal(o.windows[0].ratio.input, 1.1);
  assert.equal(o.windows[0].rising, false);
  assert.equal(o.windows[1].ratio.input, 1.3);
  // Change against the previous (post-compaction) window.
  assert.equal(o.windows[1].step.input, 1.182);
  assert.equal(o.windows[1].rising, true);
  assert.deepEqual(o.windows[1].reasons, ["input"]);
  assert.equal(o.compactionOverheadRising, true);
  assert.equal(o.status, "rising");
});
test("owner B: rising protocol calls are flagged; exactly the threshold is not", () => {
  const protocol = summarizeCompactionOverhead(
    overheadRounds(12, (r) => ({ input: 1000, protocol: r <= 6 ? 1 : 2 })),
    [6],
  );
  assert.deepEqual(protocol.windows[0].reasons, ["protocolCalls"]);
  assert.equal(protocol.compactionOverheadRising, true);
  const edge = summarizeCompactionOverhead(
    overheadRounds(12, (r) => ({ input: r <= 6 ? 1000 : 1250 })),
    [6],
  );
  assert.equal(edge.compactionOverheadRising, false);
  // The threshold is adjustable.
  const strict = summarizeCompactionOverhead(
    overheadRounds(12, (r) => ({ input: r <= 6 ? 1000 : 1250 })),
    [6],
    { riseRatio: 0.2 },
  );
  assert.equal(strict.compactionOverheadRising, true);
  // Uncached input and generations are reported, not judged.
  const uncached = summarizeCompactionOverhead(
    overheadRounds(12, (r) => ({
      input: 1000,
      uncached: r <= 6 ? 100 : 900,
      generations: r <= 6 ? 2 : 5,
    })),
    [6],
  );
  assert.equal(uncached.windows[0].ratio.uncached, 9);
  assert.equal(uncached.windows[0].ratio.generations, 2.5);
  assert.equal(uncached.compactionOverheadRising, false);
});
test("owner B: no compaction or missing usage never claims a trend", () => {
  assert.equal(
    summarizeCompactionOverhead(
      overheadRounds(8, () => ({ input: 1 })),
      [],
    ).status,
    "no-compaction",
  );
  const missing = overheadRounds(10, () => ({ input: 1000 })).map((e) => ({
    ...e,
    checks: { usage: null, protocolCalls: null },
  }));
  const o = summarizeCompactionOverhead(missing, [5]);
  assert.equal(o.status, "insufficient-data");
  assert.equal(o.compactionOverheadRising, false);
  assert.equal(o.windows[0].ratio.input, null);
});
// Full review 2 B-P2-4: an unmeasurable post-compaction trend is a gap in
// the evidence (missing-evidence), never a pass; no compaction stays as is.
test("owner B: insufficient post-compaction overhead data is missing evidence, not a pass", () => {
  const base = passAll();
  const noUsage = base.map((e) =>
    e.round > 15 ? { ...e, checks: { ...e.checks, usage: null } } : e,
  );
  const sum = summarizeDrift(noUsage, { compactAt: [8, 15], compactions });
  assert.equal(sum.compactionOverhead.status, "insufficient-data");
  assert.ok(sum.evidenceGaps.includes("compactionOverheadInsufficient"));
  assert.equal(sum.status, "missing-evidence");
  const none = summarizeDrift(
    base.filter((e) => e.round <= 8),
    { compactAt: [] },
  );
  assert.equal(none.compactionOverhead.status, "no-compaction");
  assert.ok(!none.evidenceGaps.includes("compactionOverheadInsufficient"));
});
test("owner B: rising overhead is an independent sub-item of noDegradation", () => {
  const base = passAll();
  const rising = base.map((e) =>
    e.round > 15
      ? {
          ...e,
          checks: { ...e.checks, usage: { ...e.checks.usage, input: 2000 } },
        }
      : e,
  );
  const ok = summarizeDrift(base, { compactAt: [8, 15], compactions });
  assert.equal(ok.compactionOverhead.status, "stable");
  assert.deepEqual(ok.degradation, {
    behavior: true,
    compactionOverhead: true,
  });
  assert.equal(ok.status, "pass");
  const sum = summarizeDrift(rising, { compactAt: [8, 15], compactions });
  assert.equal(sum.compactionOverhead.compactionOverheadRising, true);
  assert.deepEqual(sum.degradation, {
    behavior: true,
    compactionOverhead: false,
  });
  assert.equal(sum.criteria.noDegradation, false);
  assert.equal(sum.status, "violated");
});

const attachScenario = buildDriftScenario({
  rounds: 6,
  compactAt: [],
  attach: {
    relativeFile: "facts/attached-secret.txt",
    passphrase: "LOOM-ATT-feedface",
  },
});
const attachedRead = attachScenario[5];
const attachedReply = (body, extra = {}) => ({
  messageId: "m6",
  roomId: "room-1",
  threadId: null,
  body,
  roomSeq: 60,
  eventId: "e6",
  ...extra,
});

test("attached-read: a reply containing the passphrase passes", () => {
  const e = evaluateRound(
    attachedRead,
    evidenceFor(attachedRead, {
      replies: [attachedReply("口令是 LOOM-ATT-feedface")],
    }),
    ctx,
  );
  assert.equal(e.checks.attachedRead, true);
  assert.deepEqual(e.failures, []);
  // Other rounds do not carry the check.
  const qa = evaluateRound(specOf("qa"), evidenceFor(specOf("qa")), ctx);
  assert.equal(qa.checks.attachedRead, null);
});

test("attached-read: no passphrase, no reply or a reply elsewhere fails attachedRead", () => {
  const wrong = evaluateRound(
    attachedRead,
    evidenceFor(attachedRead, {
      replies: [attachedReply("找不到附加目录")],
    }),
    ctx,
  );
  assert.equal(wrong.checks.attachedRead, false);
  assert.deepEqual(wrong.failures, ["attachedRead"]);
  const none = evaluateRound(
    attachedRead,
    evidenceFor(attachedRead, { replies: [], finalReplies: [] }),
    ctx,
  );
  assert.ok(none.failures.includes("attachedRead"));
  assert.ok(none.failures.includes("notDelivered"));
  const elsewhere = evaluateRound(
    attachedRead,
    evidenceFor(attachedRead, {
      replies: [attachedReply("LOOM-ATT-feedface", { roomId: "dm-1" })],
    }),
    ctx,
  );
  assert.ok(elsewhere.failures.includes("attachedRead"));
  assert.ok(elsewhere.failures.includes("wrongTarget"));
});

test("attached-read: a failed read is a hard violation counted in the totals", () => {
  const evaluated = attachScenario.map((spec) =>
    evaluateRound(
      spec,
      spec.template === "attached-read"
        ? evidenceFor(spec, { replies: [attachedReply("不知道")] })
        : evidenceFor(spec),
      ctx,
    ),
  );
  const s = summarizeDrift(evaluated, { compactAt: [] });
  assert.equal(s.totals.attachedReadChecked, 1);
  assert.equal(s.totals.attachedReadOk, 0);
  assert.equal(s.criteria.noHardRoundFailure, false);
  assert.ok(s.hardFailures.includes("round6:attachedRead"));
  assert.equal(s.status, "violated");
  const ok = summarizeDrift(
    attachScenario.map((spec) =>
      evaluateRound(
        spec,
        spec.template === "attached-read"
          ? evidenceFor(spec, {
              replies: [attachedReply("LOOM-ATT-feedface")],
            })
          : evidenceFor(spec),
        ctx,
      ),
    ),
    { compactAt: [] },
  );
  assert.equal(ok.totals.attachedReadOk, 1);
  assert.equal(ok.status, "pass");
  assert.equal(ok.compactionOverhead.status, "no-compaction");
});

test("Codex direct MCP namespace is included in protocol cost without CLI handle proof", () => {
  const mk = (namespace) => ({
    payload: {
      type: "function_call",
      namespace,
      name: "loom_reply",
      arguments: '{"body":"message-post --turn fake"}',
    },
  });
  assert.deepEqual(codexToolCalls([mk("mcp__loom_worker")]), [
    { kind: "worker-mcp-reply" },
  ]);
  assert.deepEqual(codexToolCalls([mk("foreign")]), [{ kind: "unknown" }]);
});
