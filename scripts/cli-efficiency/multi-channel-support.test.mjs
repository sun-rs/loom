import assert from "node:assert/strict";
import test from "node:test";
import {
  channelPrompt,
  compareParticipants,
  runNativeChannel,
} from "./multi-channel-support.mjs";

test("native relay uses each participant position and never resends its own last answer", async () => {
  const arm = { rounds: [], messages: [] },
    calls = [];
  const steps = ["a", "b", "c", "a", "b", "c"].map((speaker, i) => ({
    speaker,
    body: `question ${i + 1}`,
  }));
  await runNativeChannel({
    arm,
    steps,
    cwd: "/fixture",
    config: {},
    save() {},
    beforeRound() {},
    invoke: async ({ round, prompt, sessionId }) => {
      calls.push({ speaker: round.speaker, prompt, sessionId });
      Object.assign(round, {
        answer: `answer ${round.round}`,
        metrics: { input: 1 },
      });
      return sessionId ?? `session-${round.speaker}`;
    },
  });
  assert.equal(arm.rounds.length, 6);
  assert.equal(
    calls[0].prompt,
    channelPrompt([{ author: "Human", body: "@multi-a question 1" }]),
  );
  assert.ok(calls[1].prompt.includes("answer 1"));
  assert.ok(calls[2].prompt.includes("question 1"));
  assert.ok(calls[3].prompt.includes("answer 2"));
  assert.ok(calls[3].prompt.includes("answer 3"));
  assert.ok(!calls[3].prompt.includes("answer 1"));
  assert.ok(!calls[3].prompt.includes("question 1"));
  assert.equal(calls[3].sessionId, "session-a");
  assert.equal(new Set(arm.rounds.map((r) => r.sessionId)).size, 3);
});

test("failed native execution retains admitted question and charges, and stops further speakers", async () => {
  const arm = { rounds: [], messages: [] };
  await assert.rejects(
    runNativeChannel({
      arm,
      steps: [
        { speaker: "a", body: "q" },
        { speaker: "b", body: "next" },
      ],
      cwd: "/fixture",
      config: {},
      save() {},
      beforeRound() {},
      invoke: async ({ round }) => {
        round.metrics = { input: 37 };
        throw Error("provider failure");
      },
    }),
    /provider failure/,
  );
  assert.equal(arm.rounds.length, 1);
  assert.equal(arm.rounds[0].metrics.input, 37);
  assert.equal(arm.messages.length, 1);
});

test("each participant is compared as a fresh session, missing/extra work cannot pass", () => {
  const rounds = ["a", "b", "c", "a", "b", "c"].map((speaker, i) => ({
    speaker,
    round: i + 1,
    longStageSucceeded: true,
    actualIdentityVerified: true,
    actualMemoryOff: true,
    metrics: { firstInput: i + 1 },
  }));
  const seen = [];
  const comparison = compareParticipants(
    { status: "complete", rounds },
    { status: "complete", rounds },
    2,
    (n, r) => {
      seen.push(n.map((x) => x.firstInput));
      return { status: "within-budget" };
    },
  );
  assert.equal(comparison.status, "within-budget");
  assert.deepEqual(seen, [
    [1, 4],
    [2, 5],
    [3, 6],
  ]);
  assert.equal(
    compareParticipants({ rounds }, { rounds: rounds.slice(1) }, 2).status,
    "missing-evidence",
  );
  assert.equal(
    compareParticipants(
      { rounds },
      { rounds: [...rounds, { speaker: "d", metrics: {} }] },
      2,
    ).status,
    "missing-evidence",
  );
});

test("failed postflight cannot certify cost, and missing evidence is not over-budget", () => {
  const rounds = ["a", "b", "c"].map((speaker) => ({
    speaker,
    longStageSucceeded: true,
    actualMemoryOff: true,
    actualIdentityVerified: true,
    metrics: { input: 1 },
  }));
  const complete = { status: "complete", rounds };
  assert.equal(
    compareParticipants(complete, { ...complete, status: "failed" }, 1, () => ({
      status: "within-budget",
    })).status,
    "missing-evidence",
  );
  assert.equal(
    compareParticipants(complete, complete, 1, () => ({
      status: "missing-evidence",
    })).status,
    "missing-evidence",
  );
});
