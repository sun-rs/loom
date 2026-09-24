// Kimi native arm: the installed `kimi -p` print mode directly, one process
// per round, the same session resumed with `--session`. Print mode reports no
// usage; the session wire does (step.end usage per generation, llm.request
// model alias and thinking level per request). Without the wire, tokens and
// generations stay unknown and only latency and delivery are judged.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { isEffectiveAnswer, summarizeGenerations } from "./metrics.mjs";
import {
  KIMI_THINKING_ENV,
  assertKimiRequests,
  checkKimiPrintLaunch,
  kimiNativeArgs,
  kimiWireRound,
  parseKimiPrintRound,
} from "./kimi-usage.mjs";
import { nativeEnvironment, runLines } from "./cli-process.mjs";
import { readKimiWire } from "./provider-files.mjs";

export async function nativeKimiRound({
  cwd,
  sessionId,
  prompt,
  save,
  round,
  config,
}) {
  const args = kimiNativeArgs({ model: config.model, prompt, sessionId });
  const env = nativeEnvironment({ [KIMI_THINKING_ENV]: config.effort });
  checkKimiPrintLaunch(args, env, config);
  const executable = execFileSync("which", ["kimi"], {
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
      env,
      onSpawn: (pid) => {
        round.pid = pid;
        save();
      },
    });
  } finally {
    round.finishedAt = new Date().toISOString();
  }
  const parsed = parseKimiPrintRound(run.entries);
  Object.assign(round, {
    exit: run.exit,
    timeout: run.timedOut || undefined,
    stderr: run.stderr,
    sessionId: parsed.sessionId,
    answer: parsed.answer,
    retries: parsed.retries,
  });
  save();
  assert.equal(run.exit, 0, "Native CLI failed");
  assert.ok(parsed.sessionId, "Native session id missing");
  if (sessionId) assert.equal(parsed.sessionId, sessionId, "Session changed");
  assert.ok(parsed.answer && parsed.finalAt, "Missing final answer");
  round.replySeconds = (parsed.finalAt - Date.parse(round.startedAt)) / 1000;
  round.metrics = measureKimiWire(parsed.sessionId, round, config, {
    fallbackToolCalls: parsed.toolCalls,
  });
  save();
  assert.ok(
    isEffectiveAnswer(parsed.answer),
    "Missing effective final answer; retain cost evidence",
  );
  return parsed.sessionId;
}

// Shared by the native and RAH Kimi arms. Model/effort mismatch in the wire
// fails closed; a missing wire leaves tokens/generations unknown (null).
export function measureKimiWire(sessionId, round, config, options = {}) {
  let wire;
  try {
    wire = kimiWireRound(readKimiWire(sessionId), {
      from: round.startedAt,
      to: round.finishedAt,
    });
  } catch (error) {
    round.wireError = String(error.message ?? error).slice(0, 200);
  }
  const base = {
    replySeconds: round.replySeconds,
    toolCalls: wire?.toolCalls ?? options.fallbackToolCalls ?? null,
  };
  if (!wire) {
    round.modelEvidence = "launch-guard-only";
    return base;
  }
  assertKimiRequests(wire.requests, config);
  round.modelEvidence = "wire";
  round.wireUsageRecords = wire.usageRecords;
  if (!wire.generations.length) return base;
  return {
    ...summarizeGenerations(wire.generations, {
      ...(options.replyAt === undefined ? {} : { replyAt: options.replyAt }),
    }),
    ...base,
  };
}
