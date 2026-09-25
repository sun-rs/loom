// Claude native arm: the installed `claude -p` directly (no RAH worker,
// scheduler or runtime adapter), one process per round, the same session
// resumed. Usage comes from its own stream-json through the product's usage
// tracker; the session transcript cross-checks it and proves model/effort.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { isEffectiveAnswer, summarizeGenerations } from "./metrics.mjs";
import {
  claudeModelMatches,
  claudeNativeArgs,
  claudeTranscriptRound,
  parseClaudeStreamRound,
} from "./claude-usage.mjs";
import { classifyClaudeLaunch } from "./claude-guard.mjs";
import { nativeEnvironment, runLines } from "./cli-process.mjs";
import { readClaudeTranscript } from "./provider-files.mjs";

export async function nativeClaudeRound({
  cwd,
  sessionId,
  prompt,
  save,
  round,
  config,
}) {
  const args = claudeNativeArgs({
    model: config.model,
    effort: config.effort,
    prompt,
    sessionId,
  });
  assert.equal(classifyClaudeLaunch(args, config), "turn");
  const executable = execFileSync("which", ["claude"], {
    encoding: "utf8",
  }).trim();
  round.startedAt = new Date().toISOString();
  save();
  let run;
  try {
    run = await runLines({
      executable,
      args,
      cwd,
      // Same process-only memory policy as the product's Claude drivers.
      env: nativeEnvironment({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" }),
      onSpawn: (pid) => {
        round.pid = pid;
        save();
      },
    });
  } finally {
    round.finishedAt = new Date().toISOString();
  }
  const parsed = parseClaudeStreamRound(run.entries);
  Object.assign(round, {
    exit: run.exit,
    timeout: run.timedOut || undefined,
    stderr: run.stderr,
    sessionId: parsed.sessionId,
    answer: parsed.answer,
    result: parsed.result ?? null,
    models: parsed.models,
    usageGaps: parsed.gaps,
  });
  save();
  assert.equal(run.exit, 0, "Native CLI failed");
  assert.ok(parsed.result && !parsed.result.isError, "Native turn failed");
  assert.equal(parsed.sessionIds.length, 1, "Native session id changed");
  if (sessionId) assert.equal(parsed.sessionId, sessionId, "Session changed");
  // Main chain, sub-agents and the result's modelUsage (background calls).
  for (const m of [
    ...parsed.models,
    ...parsed.subagentModels,
    ...parsed.resultModels,
  ])
    assert.ok(claudeModelMatches(config.model, m), `Unapproved model ${m}`);
  assert.ok(parsed.models.length, "No native model evidence");
  assert.ok(parsed.answer && parsed.finalAt, "Missing final answer");
  round.replySeconds = (parsed.finalAt - Date.parse(round.startedAt)) / 1000;
  // A usage gap leaves the round without metrics: missing evidence, never 0.
  if (!parsed.gaps.length && parsed.generations.length)
    round.metrics = {
      ...summarizeGenerations(parsed.generations),
      replySeconds: round.replySeconds,
      toolCalls: parsed.toolCalls,
    };
  const transcript = claudeTranscriptRound(
    readClaudeTranscript(parsed.sessionId),
    {
      from: round.startedAt,
      to: round.finishedAt,
    },
  );
  round.transcriptCheck = transcriptCheck(transcript, parsed.generations);
  assert.ok(
    assertClaudeTranscriptModel(transcript, config) > 0,
    "No transcript model evidence",
  );
  save();
  assert.ok(
    isEffectiveAnswer(parsed.answer),
    "Missing effective final answer; retain cost evidence",
  );
  return parsed.sessionId;
}

// Reported cross-check (generations/input/cached) between two sources.
export function transcriptCheck(transcript, generations) {
  const sum = (key) => generations.reduce((a, g) => a + g[key], 0);
  const stream = {
    generations: generations.length,
    inputTokens: sum("inputTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
  };
  return {
    stream,
    transcript: transcript.totals,
    sidechainGenerations: transcript.sidechainGenerations,
    efforts: transcript.efforts,
    mismatches: Object.keys(stream).filter(
      (k) => stream[k] !== transcript.totals[k],
    ),
  };
}

// Post-hoc fence: the transcript's models (main chain and sub-agent
// sidechains) match the approved binding and any recorded effort equals the
// approved one (absent effort stays visible). An effortless approval (effort
// null) admits no recorded effort at all. Returns the number of observed
// model records; zero is missing evidence for the caller, never a pass.
export function assertClaudeTranscriptModel(transcript, config) {
  const models = [...transcript.models, ...(transcript.sidechainModels ?? [])];
  for (const m of models)
    assert.ok(claudeModelMatches(config.model, m), `Unapproved model ${m}`);
  for (const e of transcript.efforts)
    assert.equal(
      e,
      config.effort,
      config.effort === null
        ? `Unapproved effort in transcript (${e}; the binding admits none)`
        : "Unapproved effort in transcript",
    );
  return models.length;
}
