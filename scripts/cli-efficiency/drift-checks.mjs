// Long-session drift gate evaluators. Pure: the runner collects ledger
// evidence (Room messages, Activations, RunAttempts, final-reply markers,
// Tasks, product usage) and these functions judge it. Model prose is never a
// source of truth; the format check reads the committed Room message body.
import { runSucceeded, replyTurnHandle } from "./warm.mjs";

export const DRIFT_CRITERIA = {
  finalMinRate: 0.95,
  degradationWindow: 3,
};

const codePoints = (s) => [...s].length;

export function checkFormat(body, format) {
  if (!format) return null;
  const text = String(body ?? "").trim();
  const prefixOk = format.prefix ? text.startsWith(format.prefix) : true;
  const chars = codePoints(text);
  const lengthOk = format.maxChars == null ? true : chars <= format.maxChars;
  const lower = text.toLowerCase();
  const includeOk = (format.mustInclude ?? []).every((t) =>
    lower.includes(t.toLowerCase()),
  );
  const anyList = format.mustIncludeAny ?? [];
  const includeAnyOk =
    anyList.length === 0 ||
    anyList.some((t) => lower.includes(t.toLowerCase()));
  return {
    ok: prefixOk && lengthOk && includeOk && includeAnyOk,
    prefixOk,
    lengthOk,
    includeOk: includeOk && includeAnyOk,
    chars,
  };
}

// Codex rollout function calls → Worker call kinds (boolean handle flag only;
// the handle itself is never recorded). Mirrors common.mjs `measure`.
export function codexToolCalls(events) {
  return events
    .filter((e) =>
      ["function_call", "custom_tool_call"].includes(e.payload?.type),
    )
    .map((e) => {
      const args = String(e.payload.arguments ?? e.payload.input ?? "");
      const kind = /message-post/.test(args)
        ? "box-post"
        : /message-check/.test(args)
          ? "box-check"
          : /task-(create|claim|update)|tasks?\s+create/.test(args)
            ? "task-command"
            : "other";
      return {
        kind,
        ...(kind === "box-post" || kind === "box-check"
          ? {
              turnHandle: /--turn\b/.test(args),
              final: kind === "box-post" ? /--final\b/.test(args) : undefined,
            }
          : {}),
      };
    });
}

export function countCodexCompactions(events) {
  return events.filter(
    (e) =>
      e.type === "compacted" ||
      (e.type === "event_msg" && /compact/i.test(String(e.payload?.type))),
  ).length;
}

// spec: a drift-scenario round. evidence (all from the ledger unless noted):
//   replies: [{messageId, threadId, body, roomSeq, eventId}] participant posts
//   activations: [{activationId, state, attemptCount}]
//   runs: [{runAttemptId, activationId, state, exitCode, executionMode}]
//   finalReplies: [{runAttemptId, eventId, roomSeq}]
//   newTasks: [{taskId, creatorId}]
//   toolCalls: codex rollout calls (diagnostic) or null
//   usage: {generations, input, cached, completeness} or null
// context: {threadId, roomId, provider, mode}
export function evaluateRound(spec, evidence, context) {
  const { expect } = spec;
  const replies = evidence.replies ?? [];
  // A post in another Room (DM, other channel) is always a wrong target.
  const inRoom = (m) =>
    context.roomId === undefined ||
    m.roomId === undefined ||
    m.roomId === context.roomId;
  const onTarget = (m) =>
    inRoom(m) &&
    (expect.target === "thread"
      ? m.threadId === context.threadId
      : !m.threadId);
  const activations = evidence.activations ?? [];
  const runs = evidence.runs ?? [];
  const checks = {};
  const failures = [];
  const fail = (name) => failures.push(name);

  checks.activationCount = activations.length;
  checks.quarantined = activations.filter(
    (a) => a.state === "quarantined",
  ).length;
  const runsPer = new Map();
  for (const r of runs)
    runsPer.set(r.activationId, (runsPer.get(r.activationId) ?? 0) + 1);
  checks.retries = activations.filter(
    (a) => (a.attemptCount ?? 0) > 1 || (runsPer.get(a.activationId) ?? 0) > 1,
  ).length;
  checks.ackCompleted =
    activations.length > 0 && activations.every((a) => a.state === "completed");
  checks.runsSucceeded =
    runs.length > 0 &&
    runs.every((r) =>
      runSucceeded(r, r.executionMode ? { mode: r.executionMode } : null),
    );
  if (activations.length === 0) fail("activationMissing");
  if (checks.quarantined) fail("quarantined");
  if (checks.retries) fail("retried");
  if (!checks.ackCompleted) fail("ackIncomplete");
  if (!checks.runsSucceeded) fail("runFailed");

  checks.replyCount = replies.length;
  if (expect.reply) {
    checks.delivered = replies.some(onTarget);
    checks.wrongTarget = replies.filter((m) => !onTarget(m)).length;
    checks.silenceViolation = null;
    if (!checks.delivered) fail("notDelivered");
    if (checks.wrongTarget) fail("wrongTarget");
  } else {
    checks.delivered = null;
    checks.wrongTarget = 0;
    checks.silenceViolation = replies.length > 0;
    // Silent and still acknowledged: the Activation completed without a post,
    // which requires the delivery ACK (message-check) through its toSeq.
    checks.silentAcked = replies.length === 0 && checks.ackCompleted;
    if (checks.silenceViolation) fail("silenceViolation");
  }

  // `--final` on the final post: the RunAttempt's first final marker is the
  // round's last reply (ledger: run_attempt_final_replies.event_id).
  const last = replies.at(-1);
  if (expect.reply && last) {
    const markers = evidence.finalReplies ?? [];
    checks.finalMarker = markers.length > 0;
    checks.finalOnLastPost = markers.some((f) => f.eventId === last.eventId);
  } else {
    checks.finalMarker = null;
    checks.finalOnLastPost = null;
  }

  checks.forbiddenTasks = (evidence.newTasks ?? []).length;
  if (checks.forbiddenTasks) fail("forbiddenTask");

  checks.format =
    expect.reply && expect.format
      ? last
        ? checkFormat(last.body, expect.format)
        : { ok: false, missing: true }
      : null;
  if (checks.format && !checks.format.ok) fail("format");

  const warmCodex = context.provider === "codex" && context.mode === "warm";
  checks.turnHandle = warmCodex ? replyTurnHandle(evidence.toolCalls) : null;
  if (warmCodex && checks.turnHandle === false) fail("turnHandleMissing");
  checks.warmExecution = warmCodex
    ? runs.map((r) => r.executionMode ?? null)
    : null;

  const u = evidence.usage;
  checks.usage = u
    ? {
        generations: u.generations ?? null,
        input: u.input ?? null,
        uncached:
          u.input == null || u.cached == null ? null : u.input - u.cached,
        completeness: u.completeness ?? null,
      }
    : null;
  checks.compactionsInRound = evidence.compactionsInRound ?? null;
  return { round: spec.round, template: spec.template, checks, failures };
}

const mean = (values) => {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x));
  return v.length
    ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10
    : null;
};
const rate = (num, den) => (den ? num / den : null);

export function summarizeRounds(evaluated, extras = []) {
  const withReply = evaluated.filter((e) => e.checks.delivered !== null);
  const silent = evaluated.filter((e) => e.checks.silenceViolation !== null);
  const finals = withReply.filter((e) => e.checks.finalOnLastPost !== null);
  const formats = evaluated.filter((e) => e.checks.format);
  const handles = evaluated.filter((e) => e.checks.turnHandle !== null);
  const byRound = new Map(extras.map((x) => [x.round, x]));
  const pick = (key) => evaluated.map((e) => byRound.get(e.round)?.[key]);
  return {
    rounds: evaluated.map((e) => e.round),
    expectedReplies: withReply.length,
    delivered: withReply.filter((e) => e.checks.delivered).length,
    wrongTarget: evaluated.reduce((a, e) => a + (e.checks.wrongTarget ?? 0), 0),
    silentRounds: silent.length,
    silenceViolations: silent.filter((e) => e.checks.silenceViolation).length,
    forbiddenTasks: evaluated.reduce((a, e) => a + e.checks.forbiddenTasks, 0),
    finalPosts: finals.length,
    finalOnLastPost: finals.filter((e) => e.checks.finalOnLastPost).length,
    finalRate: rate(
      finals.filter((e) => e.checks.finalOnLastPost).length,
      finals.length,
    ),
    formatChecked: formats.length,
    formatOk: formats.filter((e) => e.checks.format.ok).length,
    formatRate: rate(
      formats.filter((e) => e.checks.format.ok).length,
      formats.length,
    ),
    turnHandleChecked: handles.length,
    turnHandleOk: handles.filter((e) => e.checks.turnHandle).length,
    turnHandleRate: rate(
      handles.filter((e) => e.checks.turnHandle).length,
      handles.length,
    ),
    quarantined: evaluated.reduce((a, e) => a + e.checks.quarantined, 0),
    retries: evaluated.reduce((a, e) => a + e.checks.retries, 0),
    failedRounds: evaluated
      .filter((e) => e.failures.length)
      .map((e) => e.round),
    meanGenerations: mean(evaluated.map((e) => e.checks.usage?.generations)),
    meanInput: mean(evaluated.map((e) => e.checks.usage?.input)),
    meanUncached: mean(evaluated.map((e) => e.checks.usage?.uncached)),
    meanFirstReplySeconds: mean(pick("firstReplySeconds")),
    meanSettledSeconds: mean(pick("settledSeconds")),
  };
}

// compactions: [{afterRound, forced, observed}]. Rates compare the three
// rounds after each compaction with every earlier round; any absolute
// failure (delivery, target, Task, silence, quarantine) inside the window is
// degradation too.
export function summarizeDrift(
  evaluated,
  { compactAt, compactions = [], extras = [] },
) {
  const totals = summarizeRounds(evaluated, extras);
  const w = DRIFT_CRITERIA.degradationWindow;
  const windows = compactAt.map((c) => {
    const before = evaluated.filter((e) => e.round <= c);
    const after = evaluated.filter((e) => e.round > c && e.round <= c + w);
    const pre = summarizeRounds(before, extras);
    const post = summarizeRounds(after, extras);
    const reasons = [];
    for (const key of ["formatRate", "finalRate", "turnHandleRate"])
      if (pre[key] !== null && post[key] !== null && post[key] < pre[key])
        reasons.push(key);
    if (post.delivered < post.expectedReplies) reasons.push("delivery");
    if (post.wrongTarget) reasons.push("wrongTarget");
    if (post.forbiddenTasks) reasons.push("forbiddenTask");
    if (post.silenceViolations) reasons.push("silence");
    if (post.quarantined || post.retries) reasons.push("ack");
    if (after.length < w) reasons.push("windowIncomplete");
    const compaction = compactions.find((x) => x.afterRound === c) ?? null;
    return {
      afterRound: c,
      compaction: compaction && {
        forced: compaction.forced,
        observed: compaction.observed,
        mechanism: compaction.mechanism,
      },
      before: pre,
      after: post,
      degraded: reasons.length > 0,
      reasons,
    };
  });
  const criteria = {
    delivery100: totals.delivered === totals.expectedReplies,
    wrongTarget0: totals.wrongTarget === 0,
    forbiddenTask0: totals.forbiddenTasks === 0,
    silence0: totals.silenceViolations === 0,
    final95:
      totals.finalRate !== null &&
      totals.finalRate >= DRIFT_CRITERIA.finalMinRate,
    noDegradation: windows.every((x) => !x.degraded),
    noQuarantine: totals.quarantined === 0,
  };
  const evidenceGaps = [];
  for (const c of compactAt) {
    const x = compactions.find((y) => y.afterRound === c);
    if (!x) evidenceGaps.push(`compaction${c}Missing`);
    else if (x.forced && !x.observed)
      evidenceGaps.push(`compaction${c}NotObserved`);
  }
  for (const e of evaluated)
    for (const f of [
      "activationMissing",
      "runFailed",
      "roundTimeout",
      "sessionChanged",
    ])
      if (e.failures.includes(f)) evidenceGaps.push(`round${e.round}:${f}`);
  const status = evidenceGaps.length
    ? "missing-evidence"
    : Object.values(criteria).every(Boolean)
      ? "pass"
      : "violated";
  return { totals, windows, criteria, evidenceGaps, status };
}

export function exitCodeFor(status) {
  if (status === "pass") return 0;
  if (status === "violated") return 2;
  return 1;
}

export function formatDriftTable(evaluated, extras = []) {
  const byRound = new Map(extras.map((x) => [x.round, x]));
  const cell = (v) =>
    v === null || v === undefined
      ? "-"
      : v === true
        ? "ok"
        : v === false
          ? "NO"
          : String(v);
  const header = [
    "rnd",
    "template",
    "cmp",
    "deliv",
    "target",
    "silent",
    "final",
    "fmt",
    "task",
    "ack",
    "turn",
    "gen",
    "input",
    "uncached",
    "reply_s",
    "fail",
  ];
  const rows = evaluated.map((e) => {
    const c = e.checks;
    const x = byRound.get(e.round) ?? {};
    return [
      e.round,
      e.template,
      x.compactedBefore ? "C" : "",
      cell(c.delivered),
      c.wrongTarget ? `x${c.wrongTarget}` : "ok",
      c.silenceViolation === null ? "-" : c.silenceViolation ? "NO" : "ok",
      cell(c.finalOnLastPost),
      c.format ? cell(c.format.ok) : "-",
      c.forbiddenTasks ? `x${c.forbiddenTasks}` : "ok",
      cell(c.ackCompleted && !c.quarantined && !c.retries),
      cell(c.turnHandle),
      cell(c.usage?.generations),
      cell(c.usage?.input),
      cell(c.usage?.uncached),
      cell(x.firstReplySeconds ?? x.settledSeconds),
      e.failures.join(",") || "",
    ].map(String);
  });
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const line = (r) => r.map((v, i) => v.padEnd(widths[i])).join("  ");
  return [line(header), ...rows.map(line)].join("\n");
}
