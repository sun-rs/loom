// S2-a warm vs cold (per-turn) Role instance comparison. Pure helpers; the
// paid runner (test-cli-efficiency.mjs / rah.mjs) supplies the evidence.
// role-prewarm (owner 2026-09-27): the warm Role instance whose runtime was
// prewarmed at instance creation, reported beside role-warm (cold first
// round), never instead of it.
export const ARMS = ["native", "legacy", "role", "role-warm", "role-prewarm"];
const DEFAULT_ORDER = ["native", "legacy", "role"];

// RAH_EFFICIENCY_ORDER wins; otherwise the historical order, with role-warm
// appended only for RAH_EFFICIENCY_WARM=1 so earlier runs stay reproducible.
// options (per provider, see efficiency-config.mjs): the supported arms, the
// default order and whether RAH_EFFICIENCY_WARM=1 may append role-warm.
export function parseArmOrder(
  env,
  { arms = ARMS, defaults = DEFAULT_ORDER, warmAppend = true } = {},
) {
  const fail = (why) => {
    throw new Error(`Invalid RAH_EFFICIENCY_ORDER order (${why})`);
  };
  if (env.RAH_EFFICIENCY_ORDER === undefined) {
    if (env.RAH_EFFICIENCY_WARM !== "1") return [...defaults];
    if (defaults.includes("role-warm")) return [...defaults];
    if (!warmAppend || !arms.includes("role-warm"))
      fail("role-warm is not supported for this provider");
    return [...defaults, "role-warm"];
  }
  const order = env.RAH_EFFICIENCY_ORDER.split(",").map((s) => s.trim());
  for (const kind of order) if (!ARMS.includes(kind)) fail(`unknown ${kind}`);
  for (const kind of order)
    if (!arms.includes(kind))
      fail(`${kind} is not supported for this provider`);
  if (new Set(order).size !== order.length) fail("duplicate arm");
  if (!order.includes("native")) fail("native arm required");
  if (order.length < 2) fail("at least one RAH arm required");
  if (order.includes("role-prewarm") && !order.includes("role-warm"))
    fail(
      "role-prewarm requires role-warm: a prewarmed first round never replaces the cold one",
    );
  return order;
}

// An instance-runtime turn ends with a `turn_quiesced` proof: the Kernel maps
// it to `exited` and never fabricates an exit code. Per-turn runs keep the
// process exit rule.
export function runSucceeded(run, execution) {
  if (execution)
    return (
      run.state === "exited" &&
      (run.exitCode === undefined || run.exitCode === 0)
    );
  return run.exitCode === 0;
}

// rounds: [{ round, execution, sessionId, replyTurnHandle }] of the role-warm
// arm. replyTurnHandle: true/false whether every transcript box-post carried
// `--turn`; null when no box-post was observed (the arm separately asserts the
// effective Room reply). A new runtime is expected only at round 1 and at the
// optional restart round, which must be a measured cold resume.
// prewarmedRuntimeId (role-prewarm): round 1 must run warm on the runtime the
// instance's creation prewarmed; the cold arm keeps requiring a cold round 1.
export function warmExecutionFailures(
  rounds,
  { restartBeforeRound, runtimeCount, prewarmedRuntimeId } = {},
) {
  const failures = [];
  const thread = rounds[0]?.sessionId;
  let previous;
  for (const r of rounds) {
    const tag = `:r${r.round}`;
    const e = r.execution;
    const prewarmed = r.round === 1 && prewarmedRuntimeId !== undefined;
    const segmentStart =
      (r.round === 1 && !prewarmed) || r.round === restartBeforeRound;
    if (!e) {
      failures.push("executionMissing" + tag);
      previous = undefined;
    } else {
      if (prewarmed && e.mode !== "warm") failures.push("notPrewarmed" + tag);
      else if (prewarmed && e.instanceRuntimeId !== prewarmedRuntimeId)
        failures.push("prewarmedRuntimeChanged" + tag);
      else if (
        !prewarmed &&
        (segmentStart ? e.mode !== "cold" : e.mode !== "warm")
      )
        failures.push((segmentStart ? "notCold" : "notWarm") + tag);
      if (r.round === restartBeforeRound && !Number.isFinite(e.sessionResumeMs))
        failures.push("resumeMsMissing" + tag);
      if (
        !segmentStart &&
        previous !== undefined &&
        e.instanceRuntimeId !== previous
      )
        failures.push("runtimeChanged" + tag);
      previous = e.instanceRuntimeId;
    }
    if (r.sessionId !== thread) failures.push("threadChanged" + tag);
    if (r.replyTurnHandle === false) failures.push("turnHandleMissing" + tag);
  }
  const expected = restartBeforeRound ? 2 : 1;
  if (runtimeCount !== undefined && runtimeCount !== expected)
    failures.push("runtimeCount");
  return failures;
}

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const pair = (cold, warm) => ({
  cold: finite(cold) ? cold : null,
  warm: finite(warm) ? warm : null,
  delta: finite(cold) && finite(warm) ? warm - cold : null,
});
const sum = (values) =>
  values.every(finite) ? values.reduce((a, b) => a + b, 0) : null;

// Owner 2026-09-27: the first round of the cold role-warm arm and of the
// role-prewarm arm, side by side and labelled; each arm is still judged
// against native on its own, so a prewarmed pass never stands in for the
// cold first round. readyAfterMs: instance creation to prewarmed readiness.
export function firstRoundReport(
  coldRounds,
  prewarmedRounds,
  { readyAfterMs },
) {
  const view = (r) =>
    r === undefined
      ? null
      : {
          mode: r.execution?.mode ?? null,
          replySeconds: finite(r.replySeconds) ? r.replySeconds : null,
          queueSeconds: finite(r.queueSeconds) ? r.queueSeconds : null,
          input: finite(r.metrics?.input) ? r.metrics.input : null,
        };
  const cold = view(coldRounds[0]);
  const warm = view(prewarmedRounds[0]);
  return {
    cold,
    prewarmed:
      warm === null
        ? null
        : { ...warm, readyAfterMs: finite(readyAfterMs) ? readyAfterMs : null },
    replySecondsDelta:
      finite(cold?.replySeconds) && finite(warm?.replySeconds)
        ? warm.replySeconds - cold.replySeconds
        : null,
  };
}

// Per round: warm − cold (negative = warm cheaper). "Cold resume cost
// avoided" sums cold − warm over follow-up rounds that actually ran warm. It
// is a whole-turn difference (resume, process start and any work-path
// variance together), not an isolated resume measurement; measured cold
// resumes of the warm arm (after a restart) are listed separately.
export function compareWarmCold(coldRounds, warmRounds) {
  const n = Math.min(coldRounds.length, warmRounds.length);
  const rounds = [];
  for (let i = 0; i < n; i++) {
    const c = coldRounds[i];
    const w = warmRounds[i];
    rounds.push({
      round: i + 1,
      mode: w.execution?.mode ?? null,
      replySeconds: pair(c.replySeconds, w.replySeconds),
      queueSeconds: pair(c.queueSeconds, w.queueSeconds),
      input: pair(c.metrics?.input, w.metrics?.input),
      generations: pair(
        c.metrics?.generationsTotal ?? c.metrics?.generations,
        w.metrics?.generationsTotal ?? w.metrics?.generations,
      ),
      // Per-turn rounds have no execution record; S2-b records their
      // measured thread/resume on the product usage read instead.
      sessionResumeMs: {
        cold: c.sessionResumeMs ?? c.execution?.sessionResumeMs ?? null,
        warm: w.sessionResumeMs ?? w.execution?.sessionResumeMs ?? null,
      },
      lateFrameCount: w.execution?.lateFrameCount ?? null,
    });
  }
  const warmFollowUps = rounds.filter((r) => r.round > 1 && r.mode === "warm");
  const avoided = (key) =>
    sum(
      warmFollowUps.map((r) => (r[key].delta === null ? null : -r[key].delta)),
    );
  return {
    rounds,
    coldResumeCostAvoided: {
      rounds: warmFollowUps.map((r) => r.round),
      replySeconds: avoided("replySeconds"),
      queueSeconds: avoided("queueSeconds"),
      input: avoided("input"),
      generations: avoided("generations"),
      measuredColdResumeMs: rounds
        .filter((r) => r.round > 1 && r.mode === "cold")
        .map((r) => r.sessionResumeMs.warm)
        .filter(finite),
    },
  };
}

// true/false: every transcript box-post carried `--turn`; null: none observed.
export function replyTurnHandle(toolCalls) {
  const posts = (toolCalls ?? []).filter((c) => c.kind === "box-post");
  return posts.length ? posts.every((c) => c.turnHandle === true) : null;
}
