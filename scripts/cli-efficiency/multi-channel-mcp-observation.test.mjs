import assert from "node:assert/strict";
import test from "node:test";
import {
  validateMcpObservationRound,
  summarizeMcpObservation,
} from "./multi-channel-mcp-observation.mjs";
import { multiMcpObservationPlan } from "../test-cli-multi-channel-mcp-observation.mjs";
import { multiMcpPlan } from "../test-cli-multi-channel-mcp.mjs";
const fixture = (rejections = 1) => {
  const row = (payload) => ({
    type: "response_item",
    timestamp: "2026-10-06T00:00:02Z",
    payload,
  });
  const receipt = {
    state: "published",
    eventId: "e",
    roomId: "r",
    roomSeq: 12,
    actorId: "a",
    messageId: "m",
    threadId: null,
    deduplicated: false,
  };
  const events = [
    row({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "source" }],
    }),
  ];
  for (let i = 0; i <= rejections; i++) {
    const rejected = i < rejections;
    events.push(
      row({
        type: "function_call",
        name: "mcp__loom_worker__loom_reply",
        call_id: `c${i}`,
        arguments: JSON.stringify({
          body: "answer",
          final: true,
          basedOnRoomSeq: 8,
          ...(rejected ? { threadId: "#channel" } : {}),
        }),
      }),
    );
    events.push(
      row({
        type: "function_call_output",
        call_id: `c${i}`,
        output: JSON.stringify({
          isError: rejected,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                rejected
                  ? {
                      error: {
                        code: "forbidden",
                        message:
                          "Thread is outside this Worker execution scope",
                      },
                    }
                  : receipt,
              ),
            },
          ],
        }),
      }),
    );
  }
  return {
    armKind: "worker-mcp",
    events,
    evidenceText: "source",
    expectedAnswer: "answer",
    previousRounds: [],
    round: {
      round: 1,
      speaker: "a",
      sessionId: "s",
      startedAt: "2026-10-06T00:00:01Z",
      finishedAt: "2026-10-06T00:00:03Z",
      humanRoomSeq: 8,
      participantId: "a",
      answer: "answer",
      metrics: {
        generations: rejections + 1,
        input: 200,
        cached: 50,
        uncached: 150,
        output: 20,
      },
      runs: [{ runAttemptId: "run" }],
      replies: [{ ...receipt, body: "answer" }],
      finalMarker: {
        submission_kind: null,
        run_attempt_id: "run",
        room_id: "r",
        room_seq: 12,
        event_id: "e",
      },
    },
  };
};
test("registered rejected target calls may recover without discarding any cost", () => {
  for (const rejected of [0, 1, 3]) {
    const o = fixture(rejected),
      before = structuredClone(o);
    const v = validateMcpObservationRound(o);
    assert.equal(v.replyProof, "observed-mcp-final-reply");
    assert.deepEqual(v.reliability, {
      calls: rejected + 1,
      rejectedTargetCalls: rejected,
      firstCallSucceeded: rejected === 0,
      finallyDelivered: true,
    });
    assert.deepEqual(o, before);
  }
});
test("unknown outcomes, extra writes, reordered and uncorrelated receipts remain stops", () => {
  for (const mutate of [
    (o) => (o.events[2].payload.output = o.events[4].payload.output),
    (o) =>
      (o.events[2].payload.output = o.events[2].payload.output.replace(
        "forbidden",
        "unknown",
      )),
    (o) => (o.events[2].payload.call_id = "other"),
    (o) => ([o.events[1], o.events[2]] = [o.events[2], o.events[1]]),
    (o) => (o.events[3].payload.call_id = "c0"),
    (o) => (o.events[1].payload.name = "exec_command"),
    (o) => o.round.replies.push({ ...o.round.replies[0], messageId: "extra" }),
    (o) => (o.round.answer = "wrong"),
    (o) =>
      (o.events[1].payload.arguments = o.events[1].payload.arguments.replace(
        '"final":true',
        '"final":false',
      )),
  ]) {
    const o = fixture();
    mutate(o);
    assert.throws(() => validateMcpObservationRound(o));
  }
});
test("variable generation counts are observed, never an exactly-once requirement", () => {
  const o = fixture(0);
  o.round.metrics.generations = 3;
  assert.equal(
    validateMcpObservationRound(o).reliability.firstCallSucceeded,
    true,
  );
  assert.equal(o.round.metrics.generations, 3);
});
test("recovered stage can be followed in the same session without repeating source", () => {
  const first = fixture();
  first.round.validation = validateMcpObservationRound(first);
  const next = fixture(0);
  next.previousRounds = [first.round];
  next.round.startedAt = "2026-10-06T00:00:04Z";
  next.round.finishedAt = "2026-10-06T00:00:06Z";
  for (const e of next.events) e.timestamp = "2026-10-06T00:00:05Z";
  next.events[0].payload.content[0].text = "next question";
  assert.equal(
    validateMcpObservationRound(next).readProof,
    "previous-turn-only",
  );
});
test("observation summary keeps failed cost and does not claim statistical stability", () => {
  const o = fixture();
  o.round.validation = validateMcpObservationRound(o);
  const summary = summarizeMcpObservation({
    "worker-mcp": { status: "failed", rounds: [o.round] },
  });
  assert.equal(
    summary.observedTotals["worker-mcp"].roundMetrics.knownTotals.input,
    200,
  );
  assert.equal(summary.reliability.validatedStages, 1);
  assert.equal(summary.reliability.firstCallSuccesses, 0);
  assert.equal(summary.reliability.recoveredStages, 1);
  assert.equal(summary.reliability.rejectedTargetCalls, 1);
  assert.equal(summary.stabilityVerdict, "not-established");
  assert.equal(summary.budgetVerdict, "not-assessed");
  assert.equal(summary.checkpoints[0].total.ratios, null);
});
test("new profile does not change P119 identity and never requests repeats", () => {
  const p = multiMcpObservationPlan(["--plan"], "codex-cli 0.160.0");
  assert.notEqual(
    p.baselineIdentity,
    multiMcpPlan(["--plan"], "codex-cli 0.160.0").baselineIdentity,
  );
  assert.equal(
    multiMcpPlan(["--plan"], "codex-cli 0.160.0").baselineIdentity,
    "25c57119ac664b208e06f270cf76b4a1119fe82dd8bf00cff7f7236a792527f3",
  );
  assert.equal(
    p.validationPolicy.repeatPolicy,
    "one authorized pair; no automatic reruns; no stability claim",
  );
  assert.equal(p.providerStarted, false);
});

test("twelve-stage prefixes retain varied thinking and recovery cost across all participants", () => {
  const arms = {
    native: { status: "complete", rounds: [] },
    "worker-mcp": { status: "complete", rounds: [] },
  };
  for (let local = 0; local < 12; local++)
    for (const speaker of ["a", "b", "c"]) {
      const options = fixture(local === 0 ? 1 : 0),
        r = options.round;
      r.round = local * 3 + ["a", "b", "c"].indexOf(speaker) + 1;
      r.speaker = speaker;
      r.sessionId = speaker;
      r.validation = validateMcpObservationRound(options);
      r.validation.readProof =
        local === 0 ? "complete-inline-input" : "previous-turn-only";
      Object.assign(r, {
        longStageSucceeded: true,
        actualIdentityVerified: true,
        actualWorkspaceVerified: true,
        actualMemoryOff: true,
      });
      r.metrics.generations = local % 2 === 0 ? 3 : 1;
      r.metrics.input = local === 0 ? 400 : 200;
      r.metrics.uncached = r.metrics.input - r.metrics.cached;
      const native = structuredClone(r);
      delete native.validation.replyProof;
      delete native.validation.reliability;
      native.sessionId = "native-" + speaker;
      native.metrics = {
        input: 100,
        cached: 50,
        uncached: 50,
        output: 10,
        generations: 1,
      };
      arms.native.rounds.push(native);
      r.metrics.productUsage = {
        completeness: "complete",
        gaps: [],
        totals: {
          inputTokens: r.metrics.input,
          cachedInputTokens: r.metrics.cached,
          outputTokens: r.metrics.output,
          generations: r.metrics.generations,
        },
      };
      arms["worker-mcp"].rounds.push(r);
    }
  const original = structuredClone(arms),
    s = summarizeMcpObservation(arms);
  assert.deepEqual(arms, original);
  assert.equal(s.status, "complete");
  assert.equal(s.stabilityVerdict, "not-established");
  assert.deepEqual(
    s.checkpoints.map((c) => c.total.product.totals.input),
    [1200, 3000, 5400, 7800],
  );
  assert.equal(s.checkpoints.at(-1).total.ratios.input, 7800 / 3600);
  assert.equal(s.checkpoints.at(-1).total.product.totals.generations, 72);
  assert.equal(s.reliability.firstCallSuccesses, 33);
  assert.equal(s.reliability.recoveredStages, 3);
});

test("observation never treats an old strict proof as new reliability evidence", () => {
  const o = fixture(0);
  o.round.validation = {
    answer: "exact",
    readProof: "complete-inline-input",
    replyProof: "single-mcp-final-reply",
  };
  Object.assign(o.round, {
    longStageSucceeded: true,
    actualIdentityVerified: true,
    actualWorkspaceVerified: true,
    actualMemoryOff: true,
  });
  o.round.metrics.productUsage = {
    completeness: "complete",
    gaps: [],
    totals: {
      inputTokens: 200,
      cachedInputTokens: 50,
      outputTokens: 20,
      generations: 1,
    },
  };
  const s = summarizeMcpObservation({
    "worker-mcp": { status: "complete", rounds: [o.round] },
  });
  assert.ok(
    s.checkpoints[0].participants.a.product.issues.includes(
      "reply-proof-incomplete",
    ),
  );
});
