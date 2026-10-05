import assert from "node:assert/strict";
import test from "node:test";
import { multiLongPlan } from "../test-cli-multi-channel-long.mjs";
import {
  multiPlan,
  createRoundValidationFence,
} from "../test-cli-multi-channel.mjs";
import { runNativeChannel } from "./multi-channel-support.mjs";

test("long profile is explicit, bounded, answer-private and leaves old plan unchanged", () => {
  const old = multiPlan(["--plan"], "codex-cli 0.160.0");
  const plan = multiLongPlan(["--plan"], "codex-cli 0.160.0");
  assert.equal(plan.stageCount, 36);
  assert.equal(plan.roundsPerParticipant, 12);
  assert.deepEqual(plan.order, ["native", "final-output"]);
  assert.deepEqual(plan.limits, {
    perArmInput: 3600000,
    perArmMs: 2400000,
    maxProductRuns: 36,
  });
  assert.equal(old.stageCount, 12);
  assert.equal(old.roundsPerParticipant, 4);
  assert.notEqual(plan.baselineIdentity, old.baselineIdentity);
  assert.equal(plan.providerStarted, false);
  assert.ok(!JSON.stringify(plan).includes('"expectedAnswer"'));
  assert.ok(!JSON.stringify(plan).includes('"answer"'));
  assert.throws(() => multiLongPlan(["--paid", "--plan"], "codex-cli 0.160.0"));
});

test("validation fence isolates each speaker history, records prefix and does not revalidate successes", () => {
  const arm = {
    rounds: [
      {
        round: 1,
        speaker: "a",
        sessionId: "sa",
        answer: "a1",
        metrics: { input: 12 },
      },
      {
        round: 2,
        speaker: "b",
        sessionId: "sb",
        answer: "b1",
        metrics: { input: 13 },
      },
      {
        round: 3,
        speaker: "a",
        sessionId: "sa",
        answer: "a2",
        metrics: { input: 14 },
      },
    ],
  };
  const calls = [];
  const fence = createRoundValidationFence({
    arm,
    transcript: (id) => [{ id }],
    evidenceText: "evidence",
    expectedFor: (r) => `expected-${r.round}`,
    validate: (x) => {
      calls.push(x);
      return { status: "passed" };
    },
  });
  fence();
  fence();
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((x) => x.previousRounds.map((r) => r.answer)),
    [[], [], ["a1"]],
  );
  assert.equal(calls[2].expectedAnswer, "expected-3");
  assert.deepEqual(calls[2].events, [{ id: "sa" }]);
  assert.equal(arm.validationProcessedPrefix, 3);
});

for (const failAt of [1, 3])
  test(`validation failure at stage ${failAt} retains charges and blocks product, including final stage`, async () => {
    const arm = { rounds: [], messages: [] };
    let productStarted = false;
    const fence = createRoundValidationFence({
      arm,
      transcript: () => [],
      evidenceText: "evidence",
      expectedFor: () => "expected",
      validate: ({ round }) => {
        if (round.round === failAt)
          throw Error(
            failAt === 1 ? "missing full read" : "wrong final answer",
          );
        return { status: "passed" };
      },
    });
    await assert.rejects(async () => {
      await runNativeChannel({
        arm,
        steps: ["a", "b", "c"].map((speaker) => ({
          speaker,
          body: "question",
        })),
        cwd: "/fake",
        config: {},
        save() {},
        beforeRound: fence,
        invoke: async ({ round }) => {
          Object.assign(round, {
            answer: "raw retained",
            metrics: { input: 17 },
          });
          return `s-${round.speaker}`;
        },
      });
      fence();
      productStarted = true;
    }, /missing full read|wrong final answer/);
    assert.equal(productStarted, false);
    assert.equal(arm.rounds.length, failAt);
    assert.equal(arm.rounds.at(-1).answer, "raw retained");
    assert.equal(arm.rounds.at(-1).metrics.input, 17);
    assert.match(
      arm.rounds.at(-1).validationError,
      /missing full read|wrong final answer/,
    );
    assert.equal(arm.validationProcessedPrefix, failAt - 1);
  });

test("long executable plan performs version lookup only and does not launch providers", async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "loom-multi-long-plan-"));
  try {
    writeFileSync(
      join(dir, "codex"),
      `#!/bin/sh\necho "$*" >> '${dir}/calls'\nif [ "$#" = 1 ] && [ "$1" = --version ]; then echo 'codex-cli 0.160.0'; else exit 71; fi\n`,
      { mode: 0o700 },
    );
    const result = spawnSync(
      process.execPath,
      ["scripts/test-cli-multi-channel-long.mjs", "--plan"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: dir + ":" + process.env.PATH,
          NODE_TEST_CONTEXT: undefined,
        },
        timeout: 10000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.providerStarted, false);
    assert.equal(plan.stageCount, 36);
    assert.equal(
      plan.validationPolicy.toolEvidence.includes("fail closed"),
      true,
    );
    assert.equal(readFileSync(join(dir, "calls"), "utf8"), "--version\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
