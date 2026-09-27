import assert from "node:assert/strict";
import test from "node:test";
import {
  parseArmOrder,
  runSucceeded,
  warmExecutionFailures,
  compareWarmCold,
  replyTurnHandle,
  firstRoundReport,
} from "./warm.mjs";

test("arm order defaults to native and role, appends role-warm only on opt-in, and has no legacy persona arm", () => {
  assert.deepEqual(parseArmOrder({}), ["native", "role"]);
  assert.deepEqual(parseArmOrder({ RAH_EFFICIENCY_WARM: "0" }), [
    "native",
    "role",
  ]);
  assert.deepEqual(parseArmOrder({ RAH_EFFICIENCY_WARM: "1" }), [
    "native",
    "role",
    "role-warm",
  ]);
  assert.throws(
    () => parseArmOrder({ RAH_EFFICIENCY_ORDER: "native,legacy" }),
    /unknown legacy/,
  );
  assert.deepEqual(
    parseArmOrder({ RAH_EFFICIENCY_ORDER: "native,role,role-warm" }),
    ["native", "role", "role-warm"],
  );
  assert.deepEqual(parseArmOrder({ RAH_EFFICIENCY_ORDER: "role,native" }), [
    "role",
    "native",
  ]);
  for (const bad of [
    "native,role,role",
    "role,role-warm",
    "native",
    "native,warm",
    "native,,role",
  ])
    assert.throws(() => parseArmOrder({ RAH_EFFICIENCY_ORDER: bad }), /order/);
});

test("a warm/cold instance turn succeeds on a quiesced exit without a fabricated exit code", () => {
  const execution = { mode: "warm" };
  assert.equal(runSucceeded({ state: "exited" }, execution), true);
  assert.equal(runSucceeded({ state: "exited", exitCode: 0 }, execution), true);
  assert.equal(runSucceeded({ state: "failed" }, execution), false);
  assert.equal(
    runSucceeded({ state: "exited", exitCode: 1 }, execution),
    false,
  );
  // Per-turn runs keep the process exit rule.
  assert.equal(runSucceeded({ state: "exited", exitCode: 0 }, null), true);
  assert.equal(runSucceeded({ state: "exited" }, null), false);
});

const exec = (mode, id = "rt1", sessionResumeMs = null) => ({
  instanceRuntimeId: id,
  mode,
  sessionResumeMs,
  lateFrameCount: 0,
});
const r = (round, execution, extra = {}) => ({
  round,
  execution,
  sessionId: "thread-1",
  replyTurnHandle: true,
  ...extra,
});

test("role-warm: cold first round, then warm on the same runtime and native thread", () => {
  const ok = [r(1, exec("cold")), r(2, exec("warm")), r(3, exec("warm"))];
  assert.deepEqual(warmExecutionFailures(ok, { runtimeCount: 1 }), []);
  assert.deepEqual(
    warmExecutionFailures(
      [r(1, exec("cold")), r(2, exec("cold", "rt2")), r(3, exec("warm"))],
      { runtimeCount: 2 },
    ),
    ["notWarm:r2", "runtimeChanged:r2", "runtimeChanged:r3", "runtimeCount"],
  );
  assert.deepEqual(
    warmExecutionFailures(
      [
        r(1, null),
        r(2, exec("warm"), { sessionId: "thread-2" }),
        r(3, exec("warm"), { replyTurnHandle: false }),
      ],
      { runtimeCount: 1 },
    ),
    ["executionMissing:r1", "threadChanged:r2", "turnHandleMissing:r3"],
  );
  // No box-post observed in the transcript is not a handle failure: the
  // effective Room reply itself is asserted by the arm.
  assert.deepEqual(
    warmExecutionFailures(
      [r(1, exec("cold")), r(2, exec("warm"), { replyTurnHandle: null })],
      { runtimeCount: 1 },
    ),
    [],
  );
});

test("role-warm with a daemon restart expects one measured cold resume", () => {
  const rounds = [
    r(1, exec("cold")),
    r(2, exec("warm")),
    r(3, exec("cold", "rt2", 412)),
  ];
  assert.deepEqual(
    warmExecutionFailures(rounds, { restartBeforeRound: 3, runtimeCount: 2 }),
    [],
  );
  assert.deepEqual(
    warmExecutionFailures(
      [r(1, exec("cold")), r(2, exec("warm")), r(3, exec("cold", "rt2"))],
      { restartBeforeRound: 3, runtimeCount: 2 },
    ),
    ["resumeMsMissing:r3"],
  );
});

const round = (replySeconds, input, generationsTotal, execution, q = 1) => ({
  replySeconds,
  queueSeconds: q,
  execution,
  metrics: { input, generationsTotal },
});

test("warm-vs-cold block reports per-round deltas and the avoided cold resume cost", () => {
  const cold = [
    round(20, 30000, 3, null, 2),
    round(18, 40000, 3, null, 2),
    round(19, 50000, 3, null, 3),
  ];
  const warm = [
    round(21, 31000, 3, exec("cold")),
    round(12, 38000, 2, exec("warm")),
    round(11, 47000, 2, exec("warm")),
  ];
  const c = compareWarmCold(cold, warm);
  assert.deepEqual(c.rounds[1], {
    round: 2,
    mode: "warm",
    replySeconds: { cold: 18, warm: 12, delta: -6 },
    queueSeconds: { cold: 2, warm: 1, delta: -1 },
    input: { cold: 40000, warm: 38000, delta: -2000 },
    generations: { cold: 3, warm: 2, delta: -1 },
    sessionResumeMs: { cold: null, warm: null },
    lateFrameCount: 0,
  });
  assert.equal(c.rounds[0].mode, "cold");
  // Only follow-up rounds that ran warm count as avoided cold-resume cost.
  assert.deepEqual(c.coldResumeCostAvoided, {
    rounds: [2, 3],
    replySeconds: 14,
    queueSeconds: 3,
    input: 5000,
    generations: 2,
    measuredColdResumeMs: [],
  });
  const restarted = compareWarmCold(cold, [
    warm[0],
    warm[1],
    round(25, 52000, 3, exec("cold", "rt2", 640)),
  ]);
  assert.deepEqual(restarted.coldResumeCostAvoided.rounds, [2]);
  assert.deepEqual(restarted.coldResumeCostAvoided.measuredColdResumeMs, [640]);
  // Missing evidence stays null, never zero.
  const missing = compareWarmCold(cold, [
    warm[0],
    { ...warm[1], replySeconds: null },
    warm[2],
  ]);
  assert.equal(missing.rounds[1].replySeconds.delta, null);
  assert.equal(missing.coldResumeCostAvoided.replySeconds, null);
});

test("S2-b: per-turn (cold arm) rounds report their product-measured session resume", () => {
  const cold = [
    { ...round(20, 30000, 3, null), sessionResumeMs: null },
    { ...round(18, 40000, 3, null), sessionResumeMs: 1_850 },
  ];
  const warm = [
    round(21, 31000, 3, exec("cold", "rt1", 700)),
    round(12, 38000, 2, exec("warm")),
  ];
  const c = compareWarmCold(cold, warm);
  assert.deepEqual(c.rounds[0].sessionResumeMs, { cold: null, warm: 700 });
  assert.deepEqual(c.rounds[1].sessionResumeMs, { cold: 1_850, warm: null });
});

test("reply turn-handle evidence: every box-post carries --turn, unknown without one", () => {
  const post = (turnHandle) => ({ kind: "box-post", turnHandle });
  assert.equal(replyTurnHandle([post(true), { kind: "other" }]), true);
  assert.equal(replyTurnHandle([post(true), post(false)]), false);
  assert.equal(
    replyTurnHandle([{ kind: "box-check", turnHandle: true }]),
    null,
  );
  assert.equal(replyTurnHandle(undefined), null);
});

// Owner 2026-09-27: instances are prewarmed at creation. The prewarmed first
// round is its own arm and never stands in for the cold first round.
test("role-prewarm is reported beside role-warm, never instead of it", () => {
  assert.deepEqual(
    parseArmOrder(
      { RAH_EFFICIENCY_ORDER: "native,role-warm,role-prewarm" },
      { arms: ["native", "role", "role-warm", "role-prewarm"] },
    ),
    ["native", "role-warm", "role-prewarm"],
  );
  for (const order of ["native,role-prewarm", "native,role,role-prewarm"])
    assert.throws(
      () =>
        parseArmOrder(
          { RAH_EFFICIENCY_ORDER: order },
          { arms: ["native", "role", "role-warm", "role-prewarm"] },
        ),
      /role-prewarm requires role-warm/,
      order,
    );
  assert.throws(
    () =>
      parseArmOrder(
        { RAH_EFFICIENCY_ORDER: "native,role-warm,role-prewarm" },
        { arms: ["native", "role"] },
      ),
    /not supported/,
  );
});

test("role-prewarm: the first round runs warm on the runtime prewarmed before it", () => {
  const ok = [r(1, exec("warm")), r(2, exec("warm")), r(3, exec("warm"))];
  assert.deepEqual(
    warmExecutionFailures(ok, { prewarmedRuntimeId: "rt1", runtimeCount: 1 }),
    [],
  );
  assert.deepEqual(
    warmExecutionFailures([r(1, exec("cold")), r(2, exec("warm"))], {
      prewarmedRuntimeId: "rt1",
      runtimeCount: 1,
    }),
    ["notPrewarmed:r1"],
    "a cold first round means the prewarm was not used",
  );
  assert.deepEqual(
    warmExecutionFailures(
      [r(1, exec("warm", "rt9")), r(2, exec("warm", "rt9"))],
      { prewarmedRuntimeId: "rt1", runtimeCount: 1 },
    ),
    ["prewarmedRuntimeChanged:r1"],
  );
  // The cold arm keeps requiring a cold first round.
  assert.deepEqual(warmExecutionFailures([r(1, exec("warm"))], {}), [
    "notCold:r1",
  ]);
});

test("the first-round block labels the cold and the prewarmed first round separately", () => {
  const cold = [round(20, 30000, 3, exec("cold"), 2), round(9, 31000, 2)];
  const prewarmed = [round(11, 30500, 3, exec("warm"), 1)];
  assert.deepEqual(firstRoundReport(cold, prewarmed, { readyAfterMs: 2400 }), {
    cold: { mode: "cold", replySeconds: 20, queueSeconds: 2, input: 30000 },
    prewarmed: {
      mode: "warm",
      replySeconds: 11,
      queueSeconds: 1,
      input: 30500,
      readyAfterMs: 2400,
    },
    replySecondsDelta: -9,
  });
  assert.equal(firstRoundReport([], prewarmed, {}).cold, null);
});
