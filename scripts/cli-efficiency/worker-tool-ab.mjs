// evo §57 paid A/B for the Loom Worker tool facade on OpenCode (owner
// decision 2026-09-27). Pure helpers: the fixed plan, the pinned model, the
// per-round OpenCode evidence, the per-sample metrics and the pre-registered
// verdict. The runner (`scripts/test-worker-tool-ab.mjs`) is opt-in `--paid`
// and never part of `npm run check`.
//
// Groups: `native` (`opencode run`, no Loom), `cli-post` (the product warm
// Role instance with the tools switched off, replying through the Worker CLI
// over bash) and `tool-post` (the same product path replying through
// `loom_message_post`). Each group runs SAMPLES new sessions of the gate's 3
// questions; blocks alternate the product arms' order (ABAB) so drift over
// the run affects both.
//
// Pre-registered verdict (owner, 2026-09-27), tool-post against cli-post:
//   - first-round reasoning-token median drops by >= 30 %;
//   - first-round reply-latency median drops by >= 3 s;
//   - no delivery failure in tool-post (every round an effective reply);
//   - no extra protocol generation in tool-post (every round's protocol
//     extra generations against its paired native sample <= 0).
// With 6 samples the result is directional only: medians, IQR and every
// sample are reported, and no significance is claimed.
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertApprovedGateModel } from "./approved-models.mjs";
import { jsonArgs, workerCall } from "./claude-usage.mjs";
import { openCodeDatabasePath } from "./drift-opencode-guard.mjs";
import { compareRounds } from "./metrics.mjs";

export const AB_GROUPS = Object.freeze(["native", "cli-post", "tool-post"]);
export const AB_SAMPLES = 6;
export const AB_ROUNDS = 3;
// Exactly the owner's authorization for this A/B (and an approved gate row).
export const AB_MODEL = "deepseek/deepseek-flash";
export const AB_EFFORT = "low";
export const AB_THRESHOLDS = Object.freeze({
  reasoningTokenDrop: 0.3,
  replySecondsDrop: 3,
});

/** The daemon switch that keeps OpenCode on the CLI reply path. */
export const CLI_POST_DAEMON_ENV = Object.freeze({
  RAH_OPENCODE_WORKER_TOOLS: "off",
});

export function parseWorkerToolAbConfig(env) {
  const model = env.LOOM_AB_MODEL ?? AB_MODEL;
  const effort = env.LOOM_AB_EFFORT ?? AB_EFFORT;
  if (model !== AB_MODEL || effort !== AB_EFFORT)
    throw new Error(
      `The worker-tool A/B is authorized only for ${AB_MODEL} / ${AB_EFFORT}`,
    );
  assertApprovedGateModel({ provider: "opencode", model, effort });
  const samples =
    env.LOOM_AB_SAMPLES === undefined
      ? AB_SAMPLES
      : Number(env.LOOM_AB_SAMPLES);
  if (!Number.isInteger(samples) || samples < 1 || samples > AB_SAMPLES)
    throw new Error(`LOOM_AB_SAMPLES must be 1..${AB_SAMPLES}`);
  return {
    provider: "opencode",
    catalogKind: "opencode-cli/v1",
    model,
    effort,
    bindingId: `local:opencode-cli/v1:${model}`,
    instructionFile: "AGENTS.md",
    productUsage: "required",
    samples,
  };
}

/** The run order: one block per sample; the product arms alternate. */
export function abPlan(samples = AB_SAMPLES) {
  const plan = [];
  for (let sample = 1; sample <= samples; sample += 1) {
    const product =
      sample % 2 === 1 ? ["cli-post", "tool-post"] : ["tool-post", "cli-post"];
    for (const group of ["native", ...product]) plan.push({ group, sample });
  }
  return plan;
}

/** Parts of a session tree inside [fromMs, toMs], oldest first. */
export function readOpenCodeRoundParts(
  sessionId,
  fromMs,
  toMs,
  dbPath = openCodeDatabasePath(),
) {
  if (!existsSync(dbPath)) throw new Error("OpenCode database not found");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare(
        `WITH RECURSIVE tree(id) AS (
           SELECT ? UNION SELECT s.id FROM session s JOIN tree t ON s.parent_id = t.id)
         SELECT time_created, data FROM part
          WHERE session_id IN (SELECT id FROM tree) AND time_created BETWEEN ? AND ?
          ORDER BY time_created, id`,
      )
      .all(sessionId, fromMs, toMs)
      .map((row) => ({ at: row.time_created, part: JSON.parse(row.data) }));
  } finally {
    db.close();
  }
}

const REFUSAL = /Effect: not_sent|\bINVALID_ARG\b|\bMISSING_CONTENT\b/u;

/**
 * One round from its stored parts: reasoning characters and tokens, and the
 * Worker post/check calls that failed (format or argument errors: the tool
 * part errored, or the CLI output says nothing was sent).
 */
export function roundPartMetrics(entries) {
  let reasoningChars = 0;
  let reasoningTokens = 0;
  let reasoningTokensKnown = true;
  let steps = 0;
  const workerCalls = [];
  for (const { at, part } of entries) {
    if (part?.type === "reasoning" && typeof part.text === "string")
      reasoningChars += part.text.length;
    if (part?.type === "step-finish") {
      steps += 1;
      const value = part.tokens?.reasoning;
      if (typeof value === "number" && Number.isFinite(value))
        reasoningTokens += value;
      else reasoningTokensKnown = false;
    }
    if (part?.type === "tool") {
      const call = workerCall(
        part.tool,
        jsonArgs(part.state?.input),
        new Date(at).toISOString(),
      );
      if (call.kind !== "box-post" && call.kind !== "box-check") continue;
      const output =
        typeof part.state?.output === "string" ? part.state.output : "";
      workerCalls.push({
        ...call,
        failed: part.state?.status === "error" || REFUSAL.test(output),
      });
    }
  }
  return {
    reasoningChars,
    reasoningTokens: steps > 0 && reasoningTokensKnown ? reasoningTokens : null,
    workerCalls,
    formatErrors: workerCalls.filter((call) => call.failed).length,
    toolPosts: workerCalls.filter(
      (call) => call.kind === "box-post" && call.via === "tool",
    ).length,
    cliPosts: workerCalls.filter(
      (call) => call.kind === "box-post" && call.via !== "tool",
    ).length,
  };
}

const finite = (value) => typeof value === "number" && Number.isFinite(value);

/**
 * One sample (one new session, AB_ROUNDS rounds). `rounds[i]` carries the
 * arm's own round record (`metrics`, `replySeconds`, `answerEffective`) and
 * `parts` (roundPartMetrics). `native` pairs a product sample with the same
 * block's native sample for the protocol-generation comparison.
 */
export function sampleMetrics({ group, sample, status, rounds, native }) {
  const complete =
    status === "complete" &&
    rounds.length === AB_ROUNDS &&
    rounds.every((round) => round.metrics && round.parts);
  const first = rounds[0];
  const sum = (key) =>
    complete && rounds.every((round) => finite(round.metrics[key]))
      ? rounds.reduce((total, round) => total + round.metrics[key], 0)
      : null;
  const protocolExtras =
    group === "native"
      ? null
      : rounds.map((round, index) => {
          const paired = native?.rounds?.[index]?.metrics;
          if (!round.metrics || !paired) return null;
          return compareRounds(paired, round.metrics).extraProtocolGenerations;
        });
  const expectedMode =
    group === "tool-post" ? "tool" : group === "cli-post" ? "cli" : undefined;
  const posts = rounds.map((round) => round.parts ?? {});
  return {
    group,
    sample,
    status,
    complete,
    firstRound: {
      reasoningChars: first?.parts?.reasoningChars ?? null,
      reasoningTokens: first?.parts?.reasoningTokens ?? null,
      replySeconds: finite(first?.replySeconds) ? first.replySeconds : null,
      generationsBeforeReply: finite(first?.metrics?.generationsBeforeReply)
        ? first.metrics.generationsBeforeReply
        : null,
      firstRequestInput: finite(first?.metrics?.firstInput)
        ? first.metrics.firstInput
        : null,
    },
    totalInput: sum("input"),
    totalOutput: sum("output"),
    formatErrors:
      group === "native"
        ? null
        : posts.reduce((total, part) => total + (part.formatErrors ?? 0), 0),
    delivered: rounds.filter((round) => round.answerEffective === true).length,
    rounds: AB_ROUNDS,
    protocolExtras,
    // The arm really ran the path it names (tool posts only in tool-post).
    modeVerified:
      expectedMode === undefined
        ? null
        : expectedMode === "tool"
          ? posts.some((part) => part.toolPosts > 0) &&
            posts.every((part) => (part.cliPosts ?? 0) === 0)
          : posts.every((part) => (part.toolPosts ?? 0) === 0) &&
            posts.some((part) => part.cliPosts > 0),
  };
}

export function median(values) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(sorted, q) {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export function iqr(values) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return [quantile(sorted, 0.25), quantile(sorted, 0.75)];
}

const describe = (samples, pick) => {
  const values = samples.map(pick);
  return { median: median(values), iqr: iqr(values), values };
};

export function summarizeAb(samples) {
  return Object.fromEntries(
    AB_GROUPS.map((group) => {
      const own = samples.filter((sample) => sample.group === group);
      return [
        group,
        {
          samples: own.length,
          complete: own.filter((sample) => sample.complete).length,
          firstRoundReasoningTokens: describe(
            own,
            (s) => s.firstRound.reasoningTokens,
          ),
          firstRoundReasoningChars: describe(
            own,
            (s) => s.firstRound.reasoningChars,
          ),
          firstRoundReplySeconds: describe(
            own,
            (s) => s.firstRound.replySeconds,
          ),
          firstRoundGenerationsBeforeReply: describe(
            own,
            (s) => s.firstRound.generationsBeforeReply,
          ),
          firstRequestInput: describe(
            own,
            (s) => s.firstRound.firstRequestInput,
          ),
          totalInput: describe(own, (s) => s.totalInput),
          totalOutput: describe(own, (s) => s.totalOutput),
          formatErrors:
            group === "native"
              ? null
              : own.reduce((total, s) => total + (s.formatErrors ?? 0), 0),
          delivery: {
            delivered: own.reduce((total, s) => total + s.delivered, 0),
            expected: own.length * AB_ROUNDS,
          },
          protocolExtraRounds:
            group === "native"
              ? null
              : own.flatMap((s) => s.protocolExtras ?? []),
          modeVerified:
            group === "native"
              ? null
              : own.every((sample) => sample.modeVerified === true),
        },
      ];
    }),
  );
}

/** The pre-registered verdict: "pass" | "fail" | "missing-evidence". */
export function abVerdict(summary, expectedSamples = AB_SAMPLES) {
  const cli = summary["cli-post"];
  const tool = summary["tool-post"];
  const missing = [];
  const failures = [];
  for (const [name, group] of [
    ["cli-post", cli],
    ["tool-post", tool],
  ]) {
    if (group.samples !== expectedSamples || group.complete !== expectedSamples)
      missing.push(
        `${name}: ${group.complete}/${expectedSamples} complete samples`,
      );
    if (group.modeVerified !== true)
      missing.push(`${name}: reply path not verified`);
  }
  const cliTokens = cli.firstRoundReasoningTokens.median;
  const toolTokens = tool.firstRoundReasoningTokens.median;
  const tokenDrop =
    finite(cliTokens) && cliTokens > 0 && finite(toolTokens)
      ? 1 - toolTokens / cliTokens
      : null;
  if (tokenDrop === null) missing.push("first-round reasoning tokens");
  else if (tokenDrop < AB_THRESHOLDS.reasoningTokenDrop)
    failures.push(
      `reasoning-token median drop ${(tokenDrop * 100).toFixed(1)} % < ${AB_THRESHOLDS.reasoningTokenDrop * 100} %`,
    );
  const cliReply = cli.firstRoundReplySeconds.median;
  const toolReply = tool.firstRoundReplySeconds.median;
  const replyDrop =
    finite(cliReply) && finite(toolReply) ? cliReply - toolReply : null;
  if (replyDrop === null) missing.push("first-round reply seconds");
  else if (replyDrop < AB_THRESHOLDS.replySecondsDrop)
    failures.push(
      `reply-latency median drop ${replyDrop.toFixed(2)} s < ${AB_THRESHOLDS.replySecondsDrop} s`,
    );
  if (tool.delivery.delivered < tool.delivery.expected)
    failures.push(
      `tool-post delivered ${tool.delivery.delivered}/${tool.delivery.expected}`,
    );
  const extras = tool.protocolExtraRounds;
  if (extras.length === 0 || extras.some((value) => !finite(value)))
    missing.push("tool-post protocol generations");
  else if (extras.some((value) => value > 0))
    failures.push(
      `tool-post extra protocol generations in ${extras.filter((value) => value > 0).length} round(s)`,
    );
  return {
    status: missing.length
      ? "missing-evidence"
      : failures.length
        ? "fail"
        : "pass",
    reasoningTokenDrop: tokenDrop,
    replySecondsDrop: replyDrop,
    failures,
    missing,
    note: `${expectedSamples} samples per group: directional result, no significance claimed`,
  };
}
