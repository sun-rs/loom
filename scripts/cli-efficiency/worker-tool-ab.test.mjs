import assert from "node:assert/strict";
import test from "node:test";
import {
  AB_ROUNDS,
  abPlan,
  abVerdict,
  iqr,
  median,
  parseWorkerToolAbConfig,
  roundPartMetrics,
  sampleMetrics,
  summarizeAb,
} from "./worker-tool-ab.mjs";

// Free unit tests of the evo §57 worker-tool A/B (no provider runs).

test("the A/B is pinned to the owner-authorized model and approved table", () => {
  const config = parseWorkerToolAbConfig({});
  assert.equal(config.model, "deepseek/deepseek-flash");
  assert.equal(config.effort, "low");
  assert.equal(config.samples, 6);
  for (const env of [
    { LOOM_AB_MODEL: "deepseek/deepseek-v4-flash" },
    { LOOM_AB_EFFORT: "high" },
    { LOOM_AB_MODEL: "fable" },
    { LOOM_AB_SAMPLES: "7" },
    { LOOM_AB_SAMPLES: "0" },
  ])
    assert.throws(() => parseWorkerToolAbConfig(env), JSON.stringify(env));
});

test("each block runs native then both product arms, alternating their order", () => {
  const plan = abPlan(6);
  assert.equal(plan.length, 18);
  assert.deepEqual(plan.slice(0, 6), [
    { group: "native", sample: 1 },
    { group: "cli-post", sample: 1 },
    { group: "tool-post", sample: 1 },
    { group: "native", sample: 2 },
    { group: "tool-post", sample: 2 },
    { group: "cli-post", sample: 2 },
  ]);
  for (const group of ["native", "cli-post", "tool-post"])
    assert.equal(plan.filter((step) => step.group === group).length, 6);
});

const at = 1_790_000_000_000;
const part = (value) => ({ at, part: value });

test("round parts: reasoning chars/tokens and failed Worker calls by path", () => {
  const tool = roundPartMetrics([
    part({ type: "reasoning", text: "abcd" }),
    part({ type: "step-finish", tokens: { reasoning: 30 } }),
    part({
      type: "tool",
      tool: "loom_message_post",
      state: {
        status: "completed",
        input: { target: "#m", body: "x", final: true },
        output: "error: INVALID_ARG\nEffect: not_sent\n",
      },
    }),
    part({
      type: "tool",
      tool: "loom_message_post",
      state: { status: "completed", input: { target: "#m", body: "x" } },
    }),
    part({ type: "reasoning", text: "ef" }),
    part({ type: "step-finish", tokens: { reasoning: 12 } }),
    part({ type: "tool", tool: "read", state: { status: "error" } }),
  ]);
  assert.equal(tool.reasoningChars, 6);
  assert.equal(tool.reasoningTokens, 42);
  assert.equal(tool.formatErrors, 1);
  assert.equal(tool.toolPosts, 2);
  assert.equal(tool.cliPosts, 0);
  const cli = roundPartMetrics([
    part({
      type: "tool",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: '"$RAH_WORKER_CLI" worker message-post --final' },
        output: "Sent",
      },
    }),
    part({ type: "step-finish", tokens: {} }),
  ]);
  assert.equal(cli.cliPosts, 1);
  assert.equal(cli.formatErrors, 0);
  // A step without a reasoning count is unknown, never zero.
  assert.equal(cli.reasoningTokens, null);
});

const metrics = (overrides = {}) => ({
  generations: 1,
  generationsTotal: 1,
  generationsBeforeReply: 1,
  generationsAfterReply: 0,
  input: 1000,
  cached: 0,
  uncached: 1000,
  output: 100,
  reasoning: 0,
  firstInput: 1000,
  peakInput: 1000,
  replySeconds: 10,
  toolCalls: [],
  usageSource: "product",
  productUsage: { completeness: "complete", gaps: [], totals: {} },
  ...overrides,
});

function sample(
  group,
  index,
  { tokens, seconds, delivered = AB_ROUNDS, mode },
) {
  const parts = {
    reasoningChars: tokens * 4,
    reasoningTokens: tokens,
    formatErrors: 0,
    toolPosts: mode === "tool" ? 1 : 0,
    cliPosts: mode === "cli" ? 1 : 0,
  };
  const rounds = Array.from({ length: AB_ROUNDS }, (_, i) => ({
    metrics: metrics({ replySeconds: seconds }),
    replySeconds: seconds,
    answerEffective: i < delivered,
    parts,
  }));
  return { group, sample: index, status: "complete", rounds };
}

function run({ cli, tool, toolDelivered = AB_ROUNDS, toolExtra = 0 }) {
  const samples = [];
  for (let i = 1; i <= 6; i += 1) {
    const native = sample("native", i, { tokens: 50, seconds: 8 });
    samples.push(sampleMetrics(native));
    samples.push(
      sampleMetrics({
        ...sample("cli-post", i, { ...cli, mode: "cli" }),
        native,
      }),
    );
    const toolSample = sample("tool-post", i, {
      ...tool,
      delivered: toolDelivered,
      mode: "tool",
    });
    if (toolExtra > 0)
      toolSample.rounds[0].metrics = metrics({
        generations: 1 + toolExtra,
        generationsTotal: 1 + toolExtra,
        generationsBeforeReply: 1 + toolExtra,
      });
    samples.push(sampleMetrics({ ...toolSample, native }));
  }
  return abVerdict(summarizeAb(samples));
}

test("the pre-registered verdict: >=30 % fewer reasoning tokens and >=3 s faster, all delivered, no extra protocol generation", () => {
  const pass = run({
    cli: { tokens: 100, seconds: 12 },
    tool: { tokens: 60, seconds: 8 },
  });
  assert.equal(pass.status, "pass", JSON.stringify(pass));
  assert.equal(pass.reasoningTokenDrop, 0.4);
  assert.equal(pass.replySecondsDrop, 4);
  assert.match(pass.note, /no significance claimed/u);
  const small = run({
    cli: { tokens: 100, seconds: 12 },
    tool: { tokens: 80, seconds: 10 },
  });
  assert.equal(small.status, "fail");
  assert.equal(small.failures.length, 2);
  const undelivered = run({
    cli: { tokens: 100, seconds: 12 },
    tool: { tokens: 60, seconds: 8 },
    toolDelivered: 2,
  });
  assert.equal(undelivered.status, "fail");
  assert.match(undelivered.failures.join(), /delivered 12\/18/u);
  const extra = run({
    cli: { tokens: 100, seconds: 12 },
    tool: { tokens: 60, seconds: 8 },
    toolExtra: 1,
  });
  assert.equal(extra.status, "fail");
  assert.match(extra.failures.join(), /extra protocol generations/u);
});

test("missing or unverified evidence never passes", () => {
  const samples = [
    sampleMetrics({
      ...sample("cli-post", 1, { tokens: 100, seconds: 12, mode: "cli" }),
    }),
    // The tool arm replied through the CLI: its path is not verified.
    sampleMetrics({
      ...sample("tool-post", 1, { tokens: 10, seconds: 1, mode: "cli" }),
    }),
  ];
  const verdict = abVerdict(summarizeAb(samples), 1);
  assert.equal(verdict.status, "missing-evidence");
  assert.match(verdict.missing.join(), /tool-post: reply path not verified/u);
  assert.match(verdict.missing.join(), /protocol generations/u);
  const failed = sampleMetrics({
    group: "tool-post",
    sample: 1,
    status: "failed",
    rounds: [],
  });
  assert.equal(failed.complete, false);
  assert.equal(failed.firstRound.reasoningTokens, null);
});

test("median and IQR ignore missing values", () => {
  assert.equal(median([3, null, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.deepEqual(iqr([1, 2, 3, 4, 5]), [2, 4]);
  assert.equal(iqr([null]), null);
});
