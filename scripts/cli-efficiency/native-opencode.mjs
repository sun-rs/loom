import { assertNativeMemoryPolicy } from "./native-memory-policy.mjs";
// OpenCode native arm: the installed `opencode run` directly (no RAH worker,
// scheduler or runtime adapter), one process per round, the same session
// resumed. Usage comes from its own JSON events through the product's
// step-finish accounting; the CLI's database proves model and variant.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { isEffectiveAnswer, summarizeGenerations } from "./metrics.mjs";
import { nativeEnvironment, runLines } from "./cli-process.mjs";
import {
  assertOpenCodeAssistants,
  readOpenCodeRound,
} from "./drift-opencode-guard.mjs";
import {
  checkOpenCodeNativeLaunch,
  openCodeNativeArgs,
  openCodeNativeEnv,
  parseOpenCodeRunRound,
} from "./opencode-usage.mjs";
import { resolveOpenCodeMcpNames } from "../../packages/agent-host/src/opencode-user-mcp.js";
import { providerLaunchPolicy } from "../../packages/agent-host/src/provider-launch-arguments.js";

export async function nativeOpenCodeRound({
  cwd,
  sessionId,
  prompt,
  save,
  round,
  config,
}) {
  const args = openCodeNativeArgs({
    model: config.model,
    effort: config.effort,
    prompt,
    sessionId,
  });
  // Same process-only global-config isolation as the product's drivers,
  // user MCP servers included: OpenCode's own resolution (`debug config
  // --pure`, no model call) with this launch's environment and cwd, then
  // each name switched off (full review 2 B-P2-6).
  const baseEnv = openCodeNativeEnv(
    config,
    nativeEnvironment({
      ...providerLaunchPolicy("opencode").environment,
      PWD: cwd,
    }),
  );
  const executable = execFileSync("which", ["opencode"], {
    encoding: "utf8",
  }).trim();
  assertNativeMemoryPolicy({
    provider: "opencode",
    executable,
    args,
    env: baseEnv,
  });
  const mcpNames = await resolveOpenCodeMcpNames({
    executable,
    env: baseEnv,
    cwd,
  });
  const env = openCodeNativeEnv(
    config,
    nativeEnvironment({
      ...providerLaunchPolicy("opencode").environment,
      PWD: cwd,
    }),
    mcpNames,
  );
  checkOpenCodeNativeLaunch(args, env, config, mcpNames);
  round.nativeMemoryPolicy = assertNativeMemoryPolicy({
    provider: "opencode",
    executable,
    args,
    env,
  });
  round.userMcpDisabled = mcpNames;
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
  const parsed = parseOpenCodeRunRound(run.entries);
  const session = parsed.sessionIds[0];
  Object.assign(round, {
    exit: run.exit,
    timeout: run.timedOut || undefined,
    stderr: run.stderr,
    sessionId: session,
    answer: parsed.answer,
    usageGaps: parsed.gaps,
    errors: parsed.errors.length ? parsed.errors : undefined,
  });
  save();
  assert.equal(run.exit, 0, "Native CLI failed");
  assert.equal(parsed.errors.length, 0, "Native turn reported an error");
  assert.equal(parsed.sessionIds.length, 1, "Native session id changed");
  if (sessionId) assert.equal(session, sessionId, "Session changed");
  // Post-hoc fence: every stored assistant of the session tree in this
  // round's window used the approved model and variant; none is no evidence.
  const stored = assertOpenCodeAssistants(
    readOpenCodeRound(
      session,
      Date.parse(round.startedAt),
      Date.parse(round.finishedAt),
    ),
    config,
  );
  round.openCodeAssistants = stored.assistants;
  save();
  assert.ok(stored.assistants > 0, "No native model evidence");
  assert.ok(parsed.answer && parsed.finalAt, "Missing final answer");
  round.replySeconds = (parsed.finalAt - Date.parse(round.startedAt)) / 1000;
  // A usage gap leaves the round without metrics: missing evidence, never 0.
  if (!parsed.gaps.length && parsed.generations.length)
    round.metrics = {
      ...summarizeGenerations(parsed.generations),
      replySeconds: round.replySeconds,
      toolCalls: parsed.toolCalls,
    };
  save();
  assert.ok(
    isEffectiveAnswer(parsed.answer),
    "Missing effective final answer; retain cost evidence",
  );
  return session;
}
