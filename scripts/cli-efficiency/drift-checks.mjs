// Long-session drift gate evaluators. Pure: the runner collects ledger
// evidence (Room messages, Activations, RunAttempts, final-reply markers,
// Tasks, product usage) and these functions judge it. Model prose is never a
// source of truth; the format check reads the committed Room message body.
import { runSucceeded, replyTurnHandle } from "./warm.mjs";
import {
  countToolCalls,
  toolCallCategory,
  workerCallKind,
  mcpCliTurnHandle,
} from "./tool-calls.mjs";

export const DRIFT_CRITERIA = {
  finalMinRate: 0.95,
  degradationWindow: 3,
  // Default of RAH_DRIFT_OVERHEAD_RISE (drift-config.mjs).
  compactionOverheadRise: 0.25,
};

// Per-round failures that are statistics, not hard gate failures. Format is
// reported as a rate (and judged per compaction window), never as a hard
// failure of the whole run. Every other per-round failure is hard.
export const SOFT_ROUND_FAILURES = new Set(["format"]);
// Hard failures that mean the ledger evidence itself is missing: reported as
// evidence gaps (status `missing-evidence`), not as violations.
const EVIDENCE_GAP_FAILURES = [
  "activationMissing",
  "runFailed",
  "roundTimeout",
  "sessionChanged",
  // Post-hoc model check could not run (unreadable transcript/db/wire, or no
  // model record in the round window): unverified, never a pass.
  "modelEvidenceMissing",
];

// read: returns the number of approved model records in the round window
// and throws `Unapproved ...` on any other model/effort (a violation, which
// propagates). Any other read failure or zero records is missing evidence.
export function checkRoundModels(read) {
  if (typeof read !== "function")
    return { status: "missing", reason: "no native session to check" };
  try {
    const records = read();
    return records > 0
      ? { status: "verified", records }
      : { status: "missing", reason: "no model record in the round window" };
  } catch (error) {
    const reason = String(error?.message ?? error).slice(0, 200);
    if (/Unapproved/.test(reason)) throw error;
    return { status: "missing", reason };
  }
}

// Codex rollout `turn_context` records (one per native turn): each must carry
// exactly the approved model and effort. Returns how many were checked.
export function assertCodexTurnContexts(events, approved) {
  let records = 0;
  for (const e of events) {
    if (e?.type !== "turn_context") continue;
    records += 1;
    if (e.payload?.model !== approved.model)
      throw new Error(`Unapproved model ${e.payload?.model}`);
    if (e.payload?.effort !== approved.effort)
      throw new Error(`Unapproved effort ${e.payload?.effort}`);
  }
  return records;
}

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
      const raw = e.payload.arguments ?? e.payload.input;
      const args = typeof raw === "string" ? raw : "";
      const kind = workerCallKind(raw, e.payload.name);
      const cliTurnHandle =
        kind === "worker-mcp-reply"
          ? mcpCliTurnHandle(raw, e.payload.name)
          : undefined;
      return {
        kind,
        ...(cliTurnHandle === undefined ? {} : { cliTurnHandle }),
        ...(kind === "box-post" || kind === "box-check"
          ? {
              turnHandle: /--turn\b/.test(args),
              final: kind === "box-post" ? /--final\b/.test(args) : undefined,
            }
          : {}),
      };
    });
}

// Worker call outputs carrying the Kernel's definite reply-target refusal
// (`reply_target_mismatch`, not sent). Diagnostic: a refused send never reaches
// the ledger, so a corrected resend in the same round still counts as
// delivered-correct; the refusals are reported, not failed.
export function countCodexTargetRejections(events) {
  const text = (output) =>
    typeof output === "string"
      ? output
      : Array.isArray(output)
        ? output.map((part) => String(part?.text ?? "")).join("\n")
        : "";
  return events.filter(
    (e) =>
      ["function_call_output", "custom_tool_call_output"].includes(
        e.payload?.type,
      ) && /\breply_target_mismatch\b/.test(text(e.payload.output)),
  ).length;
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
//   targetRejections: refused reply-target sends in the rollout (diagnostic)
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

  // Reported only: the refused send committed nothing, and `delivered` /
  // `wrongTarget` above already judge the committed replies.
  checks.targetRejections = evidence.targetRejections ?? null;

  checks.forbiddenTasks = (evidence.newTasks ?? []).length;
  if (checks.forbiddenTasks) fail("forbiddenTask");

  checks.format =
    expect.reply && expect.format
      ? last
        ? checkFormat(last.body, expect.format)
        : { ok: false, missing: true }
      : null;
  if (checks.format && !checks.format.ok) fail("format");

  // Opt-in attached-directory check: an on-target reply (committed Room
  // message body) carries the random passphrase of the attached file.
  checks.attachedRead =
    typeof expect.attachedSecret === "string"
      ? replies.some(
          (m) => onTarget(m) && String(m.body).includes(expect.attachedSecret),
        )
      : null;
  if (checks.attachedRead === false) fail("attachedRead");

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
  // Owner B: Worker (protocol) calls per round; an unknown category counts
  // as protocol. null when the round's tool calls were not collected.
  checks.toolCalls = countToolCalls(evidence.toolCalls);
  checks.protocolCalls = checks.toolCalls
    ? checks.toolCalls.protocol + checks.toolCalls.unknown
    : null;
  checks.compactionsInRound = evidence.compactionsInRound ?? null;
  // Fail closed: absent post-hoc model evidence is never treated as verified.
  checks.modelEvidence = evidence.modelEvidence ?? null;
  if (checks.modelEvidence?.status !== "verified") fail("modelEvidenceMissing");
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
    // Unobservable (null) rounds keep the total unknown; never summed as 0.
    targetRejections: evaluated.some((e) => e.checks.targetRejections == null)
      ? null
      : evaluated.reduce((a, e) => a + e.checks.targetRejections, 0),
    targetRejectionsObserved: evaluated.reduce(
      (a, e) => a + (e.checks.targetRejections ?? 0),
      0,
    ),
    targetRejectionsUnobservedRounds: evaluated.filter(
      (e) => e.checks.targetRejections == null,
    ).length,
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
    attachedReadChecked: evaluated.filter(
      (e) => typeof e.checks.attachedRead === "boolean",
    ).length,
    attachedReadOk: evaluated.filter((e) => e.checks.attachedRead === true)
      .length,
    quarantined: evaluated.reduce((a, e) => a + e.checks.quarantined, 0),
    retries: evaluated.reduce((a, e) => a + e.checks.retries, 0),
    ackIncomplete: evaluated.filter((e) => e.failures.includes("ackIncomplete"))
      .length,
    turnHandleMissing: evaluated.filter((e) =>
      e.failures.includes("turnHandleMissing"),
    ).length,
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

const exactMean = (values) => {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const round3 = (x) => (x === null ? null : Math.round(x * 1000) / 1000);
const ratioOf = (value, base) =>
  value === null || base === null || base === 0 ? null : round3(value / base);
function overheadWindow(evaluated, fromRound, toRound) {
  const rounds = evaluated.filter(
    (e) => e.round >= fromRound && e.round <= toRound,
  );
  const pick = (f) => exactMean(rounds.map(f));
  return {
    fromRound,
    toRound,
    rounds: rounds.length,
    meanInput: pick((e) => e.checks.usage?.input),
    meanUncached: pick((e) => e.checks.usage?.uncached),
    meanGenerations: pick((e) => e.checks.usage?.generations),
    meanProtocolCalls: pick((e) => e.checks.protocolCalls),
  };
}
const OVERHEAD_KEYS = [
  ["input", "meanInput"],
  ["uncached", "meanUncached"],
  ["generations", "meanGenerations"],
  ["protocolCalls", "meanProtocolCalls"],
];
const ratios = (w, base) =>
  Object.fromEntries(
    OVERHEAD_KEYS.map(([k, m]) => [k, ratioOf(w[m], base[m])]),
  );
/**
 * Owner 2026-09-25 B: platform overhead after repeated compactions. The
 * baseline is the first pre-compaction window (rounds 1..first compaction);
 * each compaction opens a window up to the next compaction (or the last
 * round). Per window: mean input, uncached input, generations and protocol
 * (Worker) calls per round, the ratio to the baseline and the step change to
 * the previous window. A window whose mean input or protocol calls exceed
 * the baseline by more than `riseRatio` is rising (uncached input and
 * generations are reported only). Protocol calls from a zero baseline to a
 * positive mean also rise. Missing usage yields `insufficient-data`, never a
 * trend.
 */
export function summarizeCompactionOverhead(
  evaluated,
  compactAt,
  { riseRatio = DRIFT_CRITERIA.compactionOverheadRise } = {},
) {
  if (!compactAt.length)
    return {
      status: "no-compaction",
      riseThreshold: riseRatio,
      baseline: null,
      windows: [],
      compactionOverheadRising: false,
    };
  const last = Math.max(0, ...evaluated.map((e) => e.round));
  const baseline = overheadWindow(evaluated, 1, compactAt[0]);
  let previous = baseline;
  let insufficient = false;
  const windows = compactAt.map((c, i) => {
    const w = overheadWindow(evaluated, c + 1, compactAt[i + 1] ?? last);
    const ratio = ratios(w, baseline);
    const step = ratios(w, previous);
    previous = w;
    const reasons = [];
    if (ratio.input !== null && ratio.input > 1 + riseRatio)
      reasons.push("input");
    if (
      (ratio.protocolCalls !== null && ratio.protocolCalls > 1 + riseRatio) ||
      (baseline.meanProtocolCalls === 0 && w.meanProtocolCalls > 0)
    )
      reasons.push("protocolCalls");
    if (ratio.input === null) insufficient = true;
    const { fromRound, toRound, ...means } = w;
    return {
      afterCompaction: c,
      range: { fromRound, toRound },
      ...means,
      ratio,
      step,
      rising: reasons.length > 0,
      reasons,
    };
  });
  const rising = windows.some((w) => w.rising);
  return {
    status: rising ? "rising" : insufficient ? "insufficient-data" : "stable",
    riseThreshold: riseRatio,
    baseline,
    windows,
    compactionOverheadRising: rising,
  };
}

// compactions: [{afterRound, forced, observed}]. Rates compare the three
// rounds after each compaction with every earlier round; any absolute
// failure (delivery, target, Task, silence, quarantine) inside the window is
// degradation too.
export function summarizeDrift(
  evaluated,
  { compactAt, compactions = [], extras = [], overheadRise },
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
    if (post.quarantined || post.retries || post.ackIncomplete)
      reasons.push("ack");
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
  const compactionOverhead = summarizeCompactionOverhead(
    evaluated,
    compactAt,
    overheadRise === undefined ? {} : { riseRatio: overheadRise },
  );
  // noDegradation has two independent sub-items: behavior after each
  // compaction (windows) and platform overhead after compactions (owner B).
  const degradation = {
    behavior: windows.every((x) => !x.degraded),
    compactionOverhead: !compactionOverhead.compactionOverheadRising,
  };
  const criteria = {
    delivery100: totals.delivered === totals.expectedReplies,
    wrongTarget0: totals.wrongTarget === 0,
    forbiddenTask0: totals.forbiddenTasks === 0,
    silence0: totals.silenceViolations === 0,
    final95:
      totals.finalRate !== null &&
      totals.finalRate >= DRIFT_CRITERIA.finalMinRate,
    noDegradation: degradation.behavior && degradation.compactionOverhead,
    noQuarantine: totals.quarantined === 0,
    ack100: totals.ackIncomplete === 0,
    noRetry: totals.retries === 0,
    turnHandle100: totals.turnHandleMissing === 0,
    // Any other hard per-round failure (format is a reported statistic).
    noHardRoundFailure: true,
  };
  const hardFailures = [];
  for (const e of evaluated)
    for (const f of e.failures)
      if (!SOFT_ROUND_FAILURES.has(f) && !EVIDENCE_GAP_FAILURES.includes(f))
        hardFailures.push(`round${e.round}:${f}`);
  criteria.noHardRoundFailure = hardFailures.length === 0;
  const evidenceGaps = [];
  for (const c of compactAt) {
    const x = compactions.find((y) => y.afterRound === c);
    if (!x) evidenceGaps.push(`compaction${c}Missing`);
    else if (x.forced && !x.observed)
      evidenceGaps.push(`compaction${c}NotObserved`);
  }
  for (const e of evaluated)
    for (const f of EVIDENCE_GAP_FAILURES)
      if (e.failures.includes(f)) evidenceGaps.push(`round${e.round}:${f}`);
  // Full review 2 B-P2-4: a post-compaction overhead trend that cannot be
  // computed proves nothing about it (owner B), so it is an evidence gap.
  if (compactionOverhead.status === "insufficient-data")
    evidenceGaps.push("compactionOverheadInsufficient");
  const status = evidenceGaps.length
    ? "missing-evidence"
    : Object.values(criteria).every(Boolean)
      ? "pass"
      : "violated";
  return {
    totals,
    windows,
    compactionOverhead,
    degradation,
    criteria,
    hardFailures,
    evidenceGaps,
    status,
  };
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
    "rej",
    "silent",
    "final",
    "fmt",
    "task",
    "ack",
    "turn",
    "gen",
    "proto",
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
      cell(c.targetRejections),
      c.silenceViolation === null ? "-" : c.silenceViolation ? "NO" : "ok",
      cell(c.finalOnLastPost),
      c.format ? cell(c.format.ok) : "-",
      c.forbiddenTasks ? `x${c.forbiddenTasks}` : "ok",
      cell(c.ackCompleted && !c.quarantined && !c.retries),
      cell(c.turnHandle),
      cell(c.usage?.generations),
      cell(c.protocolCalls),
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
