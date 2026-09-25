import assert from "node:assert/strict";
import { countToolCalls } from "./tool-calls.mjs";
// Budgets of docs/evo/target-contract.zh-CN.md §6 as revised by the owner on
// 2026-09-24 (the earlier "≤2 before reply, total input ≤2×" was unreachable).
// Generation limits are relative to the native arm's whole-turn count, so
// native tool rounds are business work, not protocol overhead. The uncached
// ratio is reported only; §6 signs no budget for it.
export const budgets = {
  maxExtraGenerations: 1, // rah total − native total
  maxExtraGenerationsBeforeReply: 0, // rah before-reply − native total
  // Fixed overhead: first generation input of the fresh session (round 1,
  // generation 1), rah − native. Judged once per arm, never per follow-up.
  fixedOverheadTokens: 3000,
  inputRatio: 2, // rah total input ≤ 2 × (native total input + 3k)
  inputAllowanceTokens: 3000,
  replyAllowanceSeconds: 5, // extra latency ≤ max(5 s, 15% of native)
  replyAllowanceRatio: 0.15,
};
// Evidence failures make the comparison "missing-evidence", never a pass.
const EVIDENCE_FAILURES = new Set([
  "usageEvidenceMissing",
  "usageEvidenceMismatch",
]);
const isEvidenceFailure = (f) =>
  f.endsWith("Missing") || EVIDENCE_FAILURES.has(f);
// replyAt: ISO time the effective Room reply landed. The generation whose tool
// call posted it finished (and recorded usage) before that time, so it counts
// as before-reply; later generations are after-reply. Omitted = native arm,
// where the final answer generation is the reply. null = no effective reply,
// so the split is unknown.
export function summarizeUsage(events, { replyAt } = {}) {
  const byResponse = new Map();
  for (const e of events)
    if (
      e.type === "token_usage_record" &&
      !byResponse.has(e.payload.response_id)
    )
      byResponse.set(e.payload.response_id, e);
  const records = [...byResponse.values()];
  const rows = records.map((e) => e.payload.usage);
  assert.ok(rows.length, "Missing native per-response usage evidence");
  let before = rows.length;
  if (replyAt === null) before = null;
  else if (replyAt !== undefined) {
    const cut = Date.parse(replyAt);
    assert.ok(Number.isFinite(cut), "Invalid effective reply timestamp");
    before = records.filter((e) => {
      const at = Date.parse(e.timestamp);
      assert.ok(Number.isFinite(at), "Invalid usage timestamp");
      return at <= cut;
    }).length;
  }
  const out = {
    generations: rows.length,
    generationsTotal: rows.length,
    generationsBeforeReply: before,
    generationsAfterReply: before === null ? null : rows.length - before,
    input: 0,
    cached: 0,
    uncached: 0,
    output: 0,
    reasoning: 0,
    firstInput: rows[0].input_tokens,
    peakInput: 0,
  };
  for (const u of rows) {
    for (const k of [
      "input_tokens",
      "cached_input_tokens",
      "output_tokens",
      "reasoning_output_tokens",
    ])
      assert.ok(Number.isFinite(u[k]) && u[k] >= 0, "Invalid usage " + k);
    assert.ok(u.cached_input_tokens <= u.input_tokens);
    out.input += u.input_tokens;
    out.cached += u.cached_input_tokens;
    out.output += u.output_tokens;
    out.reasoning += u.reasoning_output_tokens;
    out.peakInput = Math.max(out.peakInput, u.input_tokens);
  }
  out.uncached = out.input - out.cached;
  return out;
}
// Per-generation records in the product's normalized shape
// (`{responseId, observedAt, inputTokens, cachedInputTokens, outputTokens,
// reasoningOutputTokens}`: input includes cache reads/writes, output includes
// reasoning) → the summarizeUsage shape. Used for Claude (product tracker /
// native stream-json / transcript) and Kimi (session wire). `replyAt` as in
// summarizeUsage; reasoning is null unless every generation reports it.
export function summarizeGenerations(records, { replyAt } = {}) {
  const byResponse = new Map();
  for (const r of records ?? [])
    if (!byResponse.has(r.responseId)) byResponse.set(r.responseId, r);
  const rows = [...byResponse.values()];
  assert.ok(rows.length, "Missing per-generation usage evidence");
  let before = rows.length;
  if (replyAt === null) before = null;
  else if (replyAt !== undefined) {
    const cut = Date.parse(replyAt);
    assert.ok(Number.isFinite(cut), "Invalid effective reply timestamp");
    before = rows.filter((r) => {
      const at = Date.parse(r.observedAt);
      assert.ok(Number.isFinite(at), "Invalid usage timestamp");
      return at <= cut;
    }).length;
  }
  const out = {
    generations: rows.length,
    generationsTotal: rows.length,
    generationsBeforeReply: before,
    generationsAfterReply: before === null ? null : rows.length - before,
    input: 0,
    cached: 0,
    uncached: 0,
    output: 0,
    reasoning: rows.every((r) => finite(r.reasoningOutputTokens)) ? 0 : null,
    firstInput: rows[0].inputTokens,
    peakInput: 0,
  };
  for (const r of rows) {
    for (const k of ["inputTokens", "cachedInputTokens", "outputTokens"])
      assert.ok(Number.isFinite(r[k]) && r[k] >= 0, "Invalid usage " + k);
    assert.ok(
      r.cachedInputTokens <= r.inputTokens,
      "cached input exceeds input",
    );
    out.input += r.inputTokens;
    out.cached += r.cachedInputTokens;
    out.output += r.outputTokens;
    if (out.reasoning !== null) out.reasoning += r.reasoningOutputTokens;
    out.peakInput = Math.max(out.peakInput, r.inputTokens);
  }
  out.uncached = out.input - out.cached;
  return out;
}
const generationCounts = (m) => ({
  total: m.generationsTotal ?? m.generations,
  beforeReply: m.generationsBeforeReply ?? null,
  afterReply: m.generationsAfterReply ?? null,
});
const finite = (v) => typeof v === "number" && Number.isFinite(v);
// Product-recorded RAH usage (agent.run.usage.get) must be complete, and when
// both exist it must agree with the transcript-derived RAH usage.
// `rah.transcriptUsage` (Claude): an independent transcript count checked
// against the product record when the metrics themselves come from it.
function usageEvidence(rah, productRequired = true) {
  const product = rah.productUsage;
  const recordedCompleteness = product?.completeness ?? "unavailable";
  const completeness =
    !productRequired && recordedCompleteness !== "complete"
      ? "not-recorded"
      : recordedCompleteness;
  const mismatches = [];
  if (completeness === "complete")
    for (const [field, transcript] of [
      ["generations", rah.generationsTotal ?? rah.generations],
      ["inputTokens", rah.input],
      ["cachedInputTokens", rah.cached],
      ["outputTokens", rah.output],
    ]) {
      const recorded = product.totals?.[field];
      if (finite(transcript) && recorded !== transcript)
        mismatches.push({ field, product: recorded ?? null, transcript });
    }
  if (completeness === "complete")
    for (const [field, transcript] of Object.entries(
      rah.transcriptUsage ?? {},
    )) {
      const recorded = product.totals?.[field];
      if (finite(transcript) && recorded !== transcript)
        mismatches.push({
          field,
          product: recorded ?? null,
          transcript,
          source: "transcript",
        });
    }
  return { completeness, gaps: product?.gaps ?? [], mismatches };
}
// Final-reply turn end (product usage `finalInterrupt`), reported per round
// and never budgeted. `null` from the product means no `final` post
// committed; an absent field means the evidence was not collected. The
// interrupt is three facts: requested, accepted (the runtime answered) and
// terminal (the turn ended interrupted); older product reads carry only
// `sent`, so requested follows it and the other two stay unknown.
function finalInterruptOf(rah) {
  if (rah.finalInterrupt === undefined) return null;
  const f = rah.finalInterrupt;
  if (f === null)
    return {
      committed: false,
      requested: false,
      accepted: null,
      terminal: null,
      sent: false,
      preemptedFollowUp: null,
    };
  const fact = (v) => (typeof v === "boolean" ? v : "unknown");
  return {
    committed: true,
    requested: typeof f.requested === "boolean" ? f.requested : f.sent === true,
    accepted: fact(f.accepted),
    terminal: fact(f.terminal),
    sent: f.sent === true,
    preemptedFollowUp: f.preemptedFollowUp,
  };
}
function summarizeFinalInterrupts(rahRounds) {
  const out = {
    rounds: rahRounds.length,
    committed: 0,
    requested: 0,
    accepted: 0,
    terminal: 0,
    sent: 0,
    preempted: 0,
    notPreempted: 0,
    unknown: 0,
    noFinalPost: 0,
    evidenceMissing: 0,
  };
  for (const r of rahRounds) {
    const f = finalInterruptOf(r);
    if (f === null) out.evidenceMissing += 1;
    else if (!f.committed) out.noFinalPost += 1;
    else {
      out.committed += 1;
      if (f.requested) out.requested += 1;
      if (f.accepted === true) out.accepted += 1;
      if (f.terminal === true) out.terminal += 1;
      if (f.sent) out.sent += 1;
      if (f.preemptedFollowUp === true) out.preempted += 1;
      else if (f.preemptedFollowUp === false) out.notPreempted += 1;
      else out.unknown += 1;
    }
  }
  return out;
}
const statusOf = (failures) =>
  failures.length && failures.every(isEvidenceFailure)
    ? "missing-evidence"
    : failures.length
      ? "over-budget"
      : "within-budget";
// Contract §6: a dimension neither side can measure is a gap in the evidence,
// so the verdict is missing-evidence however the measured sub-items fared
// (`measuredStatus` keeps latency/delivery visible on their own). Seventh
// review P1-4.
const verdictOf = (measuredStatus, unmeasured) =>
  unmeasured.length > 0 ? "missing-evidence" : measuredStatus;
/**
 * The gate's overall result: `failed` when an arm is incomplete or a measured
 * dimension lacks evidence; `missing-evidence` when every measured dimension
 * has evidence but some dimension is unmeasured; else `over-budget` or
 * `needs-quality-review`. `measuredStatus` summarizes the measured sub-items
 * only (reported, never the verdict).
 */
export function gateStatus({ arms, comparisons }) {
  const list = Object.values(comparisons);
  const measured = list.flatMap((c) => [
    c.measuredStatus ?? c.status,
    ...(c.rounds ?? []).map((r) => r.measuredStatus ?? r.status),
    ...((c.failures ?? []).some((f) => f.endsWith("Missing"))
      ? ["missing-evidence"]
      : []),
  ]);
  const unmeasured = list.some((c) => (c.unmeasured ?? []).length > 0);
  const measuredStatus = measured.includes("missing-evidence")
    ? "missing-evidence"
    : measured.includes("over-budget")
      ? "over-budget"
      : "within-budget";
  const status =
    Object.values(arms).some((a) => a.status !== "complete") ||
    measuredStatus === "missing-evidence"
      ? "failed"
      : unmeasured
        ? "missing-evidence"
        : measuredStatus === "over-budget"
          ? "over-budget"
          : "needs-quality-review";
  return { status, measuredStatus };
}
const diff = (a, b) => (finite(a) && finite(b) ? a - b : null);
// Owner 2026-09-25 A: generations a different work path costs (re-reading a
// file, another read command) are business, reported but not judged as
// platform overhead. Business calls: RAH `other` calls (tool-calls.mjs; an
// unknown category counts as protocol); native has no Worker CLI, so every
// native call is business. Delta = RAH − native, signed: RAH doing less
// business work never hides a protocol generation. Before-reply counts only
// RAH business calls at or before the effective reply (`replyAt`), when every
// business call carries a timestamp; otherwise the whole round.
function workPathOf(native, rah) {
  const rahCounts = countToolCalls(rah.toolCalls);
  const nativeCounts = countToolCalls(native.toolCalls);
  const rahBusiness = rahCounts?.business ?? null;
  const nativeBusiness = nativeCounts?.total ?? null;
  const delta = diff(rahBusiness, nativeBusiness);
  const cut = Date.parse(rah.replyAt ?? "");
  const business = (rah.toolCalls ?? []).filter((c) => c?.kind === "other");
  const timed =
    Number.isFinite(cut) && business.every((c) => finite(Date.parse(c.at)));
  const rahBefore = timed
    ? business.filter((c) => Date.parse(c.at) <= cut).length
    : rahBusiness;
  const deltaBefore = diff(rahBefore, nativeBusiness);
  return {
    businessToolCalls: { rah: rahBusiness, native: nativeBusiness, delta },
    businessToolCallsBeforeReply: {
      rah: rahBefore,
      native: nativeBusiness,
      delta: deltaBefore,
      basis: timed ? "reply-time" : "whole-round",
    },
    toolCalls: { rah: rahCounts, native: nativeCounts },
    unknownCountedAsProtocol: rahCounts?.unknown ?? null,
    extraGenerations: delta,
    extraGenerationsBeforeReply: deltaBefore,
  };
}
// Context growth of round i = first request of i − first request of i−1.
const growth = (rounds, i) =>
  diff(rounds[i]?.firstInput, rounds[i - 1]?.firstInput);
// Contract §6 decomposition over both arms of one gate run.
// - fixedOverhead: fresh session, round 1 generation 1 (budgeted).
// - perRoundResidue: RAH growth − native growth between consecutive
//   follow-up rounds (reported).
// - workPathVariance: business tool calls/generations per round and the
//   round 1 → 2 history difference (reported; it holds round 1's work path
//   and round 1's protocol history, which usage alone cannot separate).
// Each round's total-input delta is split exactly into
//   G_rah·(fixed + round1History + cumulative residue)
//   + (G_rah − G_native)·native first request + intra-round growth delta.
// options.unmeasured: dimensions this runtime cannot measure on both sides
// ("tokens", "generations", "productUsage"); they are reported in
// `unmeasured` instead of failing. Default: none (Codex/Claude fail closed).
export function compareArm(nativeRounds, rahRounds, options = {}) {
  const unmeasured = [...(options.unmeasured ?? [])];
  const failures = [];
  const fixedTokens = diff(
    rahRounds[0]?.firstInput,
    nativeRounds[0]?.firstInput,
  );
  const fixedOverhead = {
    rah: rahRounds[0]?.firstInput ?? null,
    native: nativeRounds[0]?.firstInput ?? null,
    tokens: fixedTokens,
    budget: budgets.fixedOverheadTokens,
  };
  if (!unmeasured.includes("tokens")) {
    if (fixedTokens === null) failures.push("fixedOverheadMissing");
    else if (fixedTokens > budgets.fixedOverheadTokens)
      failures.push("fixedOverhead");
  }
  const n = Math.min(nativeRounds.length, rahRounds.length);
  const history1 =
    n >= 2
      ? {
          rahGrowth: growth(rahRounds, 1),
          nativeGrowth: growth(nativeRounds, 1),
          tokens: diff(growth(rahRounds, 1), growth(nativeRounds, 1)),
        }
      : null;
  const perRoundResidue = [];
  for (let i = 2; i < n; i++) {
    const rahGrowth = growth(rahRounds, i);
    const nativeGrowth = growth(nativeRounds, i);
    perRoundResidue.push({
      fromRound: i,
      toRound: i + 1,
      rahGrowth,
      nativeGrowth,
      tokens: diff(rahGrowth, nativeGrowth),
    });
  }
  const workRounds = [];
  const rounds = [];
  let residueSum = 0;
  for (let i = 0; i < n; i++) {
    const nat = nativeRounds[i];
    const rah = rahRounds[i];
    const gRah = generationCounts(rah).total;
    const gNat = generationCounts(nat).total;
    const compared = compareRounds(nat, rah, options);
    workRounds.push({
      round: i + 1,
      businessToolCalls: compared.workPath.businessToolCalls,
      generations: {
        rah: gRah ?? null,
        native: gNat ?? null,
        delta: diff(gRah, gNat),
      },
      extraGenerations: {
        raw: compared.extraGenerations,
        workPath: compared.workPathExtraGenerations,
        protocol: compared.extraProtocolGenerations,
      },
      toolCalls: compared.workPath.toolCalls,
    });
    // Residue accumulates: round i's context carries every earlier residue.
    if (i >= 2) {
      const step = perRoundResidue[i - 2].tokens;
      residueSum =
        finite(residueSum) && finite(step) ? residueSum + step : null;
    }
    const h = i >= 1 ? (history1?.tokens ?? null) : 0;
    const r = i >= 2 ? residueSum : 0;
    const parts = [
      fixedTokens,
      h,
      r,
      gRah,
      gNat,
      nat.firstInput,
      nat.input,
      rah.input,
      rah.firstInput,
    ];
    const w = compared.workPathExtraGenerations;
    const inputDecomposition = parts.every(finite)
      ? {
          rah: rah.input,
          native: nat.input,
          budget:
            budgets.inputRatio * (nat.input + budgets.inputAllowanceTokens),
          delta: rah.input - nat.input,
          fixedOverhead: gRah * fixedTokens,
          round1History: gRah * h,
          residue: gRah * r,
          extraGenerations: (gRah - gNat) * nat.firstInput,
          // Split of extraGenerations (owner A): work-path generations are
          // business, reported; null when tool calls were not collected.
          workPathGenerations: finite(w) ? w * nat.firstInput : null,
          protocolGenerations:
            (gRah - gNat - (finite(w) ? w : 0)) * nat.firstInput,
          intraRound:
            rah.input -
            gRah * rah.firstInput -
            (nat.input - gNat * nat.firstInput),
        }
      : null;
    rounds.push({ ...compared, inputDecomposition });
  }
  const all = [...failures, ...rounds.flatMap((x) => x.failures)];
  const measuredStatus = statusOf(all);
  return {
    status: verdictOf(measuredStatus, unmeasured),
    measuredStatus,
    failures,
    unmeasured,
    finalInterrupt: summarizeFinalInterrupts(rahRounds.slice(0, n)),
    retriedRounds: rahRounds
      .slice(0, n)
      .flatMap((r, i) => (r.retried === true ? [i + 1] : [])),
    fixedOverhead,
    perRoundResidue,
    workPathVariance: { round1HistoryDelta: history1, rounds: workRounds },
    rounds,
  };
}
export function compareRounds(native, rah, options = {}) {
  const unmeasured = [...(options.unmeasured ?? [])];
  const tokens = !unmeasured.includes("tokens");
  const counts = !unmeasured.includes("generations");
  const failures = [];
  const notes = [];
  const workPath = workPathOf(native, rah);
  if (workPath.extraGenerations === null) notes.push("workPathUnavailable");
  if (workPath.unknownCountedAsProtocol > 0) notes.push("toolCategoryUnknown");
  // Contract §6 line 64: input a different work path costs is business. Its
  // estimate is the work-path generations × native first request; the rest
  // (the re-read's tool output in later generations) stays on RAH.
  const workPathInput =
    finite(workPath.extraGenerations) && finite(native.firstInput)
      ? workPath.extraGenerations * native.firstInput
      : null;
  const input = {
    raw: finite(rah.input) ? rah.input : null,
    workPath: workPathInput,
    judged: finite(rah.input) ? rah.input - (workPathInput ?? 0) : null,
    budget: finite(native.input)
      ? budgets.inputRatio * (native.input + budgets.inputAllowanceTokens)
      : null,
  };
  if (tokens) {
    if (input.judged === null || input.budget === null)
      failures.push("inputMissing");
    else if (input.judged > input.budget) failures.push("input");
  }
  // A follow-up's first request is reported (and decomposed by compareArm),
  // not budgeted; the decomposition still needs it on both sides.
  if (tokens && (!finite(native.firstInput) || !finite(rah.firstInput)))
    failures.push("firstInputMissing");
  const generations = {
    native: generationCounts(native),
    rah: generationCounts(rah),
  };
  const nativeTotal = generations.native.total;
  // Raw extras are reported; the budgets judge the protocol extras (raw −
  // work-path business delta; no credit without tool-call evidence).
  const extraGenerations =
    finite(nativeTotal) && finite(generations.rah.total)
      ? generations.rah.total - nativeTotal
      : null;
  const extraGenerationsBeforeReply =
    finite(nativeTotal) && finite(generations.rah.beforeReply)
      ? generations.rah.beforeReply - nativeTotal
      : null;
  const credit = (v) => (finite(v) ? v : 0);
  const extraProtocolGenerations =
    extraGenerations === null
      ? null
      : extraGenerations - credit(workPath.extraGenerations);
  const extraProtocolGenerationsBeforeReply =
    extraGenerationsBeforeReply === null
      ? null
      : extraGenerationsBeforeReply -
        credit(workPath.extraGenerationsBeforeReply);
  if (counts) {
    if (extraProtocolGenerations === null) failures.push("generationsMissing");
    else if (extraProtocolGenerations > budgets.maxExtraGenerations)
      failures.push("generations");
    if (extraProtocolGenerationsBeforeReply === null)
      failures.push("generationsBeforeReplyMissing");
    else if (
      extraProtocolGenerationsBeforeReply >
      budgets.maxExtraGenerationsBeforeReply
    )
      failures.push("generationsBeforeReply");
  }
  // Short tasks are judged in seconds, long tasks by percentage.
  if (!finite(native.replySeconds) || !finite(rah.replySeconds))
    failures.push("replySecondsMissing");
  else if (
    rah.replySeconds >
    native.replySeconds +
      Math.max(
        budgets.replyAllowanceSeconds,
        native.replySeconds * budgets.replyAllowanceRatio,
      )
  )
    failures.push("replySeconds");
  // A round the Kernel retried (round-retry.mjs) is a counted soft item:
  // over budget however its summed cost fared, never within budget.
  if (rah.retried === true) failures.push("retried");
  const evidence = usageEvidence(rah, !unmeasured.includes("productUsage"));
  if (!["complete", "not-recorded"].includes(evidence.completeness))
    failures.push("usageEvidenceMissing");
  else if (evidence.mismatches.length) failures.push("usageEvidenceMismatch");
  const measuredStatus = statusOf(failures);
  return {
    status: verdictOf(measuredStatus, unmeasured),
    measuredStatus,
    failures,
    unmeasured,
    notes,
    generations,
    extraGenerations,
    extraGenerationsBeforeReply,
    workPathExtraGenerations: workPath.extraGenerations,
    workPathExtraGenerationsBeforeReply: workPath.extraGenerationsBeforeReply,
    extraProtocolGenerations,
    extraProtocolGenerationsBeforeReply,
    workPath,
    input,
    usageEvidence: evidence,
    finalInterrupt: finalInterruptOf(rah),
    inputRatio: rah.input / native.input,
    inputRatioJudged:
      input.judged === null ? null : input.judged / native.input,
    uncachedRatio: native.uncached ? rah.uncached / native.uncached : null,
    replyRatio: rah.replySeconds / native.replySeconds,
  };
}
// The shared workload explicitly requests this marker. Still needs human quality review.
export function isEffectiveAnswer(body) {
  return (
    typeof body === "string" &&
    /^审查结论[:：]/u.test(body.trim()) &&
    body.trim().length >= 80
  );
}
const signed = (v) => (finite(v) ? (v >= 0 ? `+${v}` : String(v)) : "?");
// One terminal line per compared round: raw, work-path and protocol extras,
// business call counts by kind, and raw/judged input (owner A: everything is
// reported, only the protocol values are judged).
export function formatComparisonRound(kind, round, r) {
  const w = r.workPath ?? {};
  const b = w.businessToolCalls ?? {};
  return (
    `${kind} round ${round}: extra raw ${signed(r.extraGenerations)} ` +
    `(before-reply ${signed(r.extraGenerationsBeforeReply)}), ` +
    `work-path ${signed(r.workPathExtraGenerations)} ` +
    `(before-reply ${signed(r.workPathExtraGenerationsBeforeReply)}), ` +
    `protocol ${signed(r.extraProtocolGenerations)} ` +
    `(before-reply ${signed(r.extraProtocolGenerationsBeforeReply)}); ` +
    `business calls rah ${b.rah ?? "?"} / native ${b.native ?? "?"}; ` +
    `kinds rah ${JSON.stringify(w.toolCalls?.rah?.byKind ?? null)} ` +
    `native ${JSON.stringify(w.toolCalls?.native?.byKind ?? null)}; ` +
    `input raw ${r.input?.raw ?? "?"} work-path ${r.input?.workPath ?? "-"} ` +
    `judged ${r.input?.judged ?? "?"} budget ${r.input?.budget ?? "?"}` +
    ((r.notes ?? []).length ? `; notes ${r.notes.join(",")}` : "") +
    ((r.failures ?? []).length ? `; FAIL ${r.failures.join(",")}` : "")
  );
}
