// Optional paid-gate evidence, never full argv/environment or credentials.
import assert from "node:assert/strict";
import { appendFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describeNativeMemoryPolicy } from "./native-memory-policy.mjs";
import { assertMultiProviderVersion } from "./multi-provider.mjs";
export function multiLaunchEvidence({
  provider,
  args,
  env,
  cwd,
  version,
  at = new Date().toISOString(),
  parentPid = process.ppid,
}) {
  const turn =
    provider === "claude"
      ? args.includes("--print") || args.includes("-p")
      : provider === "kimi"
        ? args[0] === "acp"
        : provider === "opencode"
          ? args[0] === "serve"
          : args[0] === "app-server";
  if (!turn || args.includes("--no-session-persistence")) return null;
  assertMultiProviderVersion(provider, version);
  const memoryPolicy = describeNativeMemoryPolicy(provider);
  if (provider === "claude") {
    assert.equal(
      env.CLAUDE_CODE_DISABLE_AUTO_MEMORY,
      "1",
      "Claude memory switch missing",
    );
    assert.ok(
      args[args.indexOf("--setting-sources") + 1] === "project,local" &&
        args.includes("--strict-mcp-config"),
      "Claude isolation missing",
    );
  } else if (provider === "opencode") {
    assert.ok(
      args.includes("--pure") &&
        env.OPENCODE_DISABLE_CLAUDE_CODE === "1" &&
        env.OPENCODE_DISABLE_EXTERNAL_SKILLS === "1",
      "OpenCode pure isolation missing",
    );
  } else if (provider === "codex") return null; // Codex uses its original session_meta proof.
  return {
    provider,
    at,
    parentPid,
    ...(typeof env.RAH_RUN_ATTEMPT_ID === "string"
      ? { runAttemptId: env.RAH_RUN_ATTEMPT_ID }
      : {}),
    cwd: realpathSync(cwd),
    version,
    memoryPolicy: {
      ...memoryPolicy,
      status: ["kimi", "opencode"].includes(provider)
        ? "not-applicable"
        : "enforced",
    },
    evidence: "actual-guarded-launch-options/v1",
  };
}
export function appendMultiLaunchEvidence(path, provider, executable) {
  const args = process.argv.slice(2);
  // Version is a local read-only command. The existing guard still owns all
  // model/effort/permission checks before forwarding the actual process.
  const version = execFileSync(executable, ["--version"], {
    encoding: "utf8",
    timeout: 10000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const row = multiLaunchEvidence({
    provider,
    args,
    env: process.env,
    cwd: process.cwd(),
    version,
  });
  if (row) appendFileSync(path, JSON.stringify(row) + "\n", { mode: 0o600 });
}
export function assertMultiLaunchEvidence(
  rows,
  { provider, cwd, finishedAt, runs, sessionId, runtimes = [] },
) {
  assert.ok(
    Array.isArray(runs) && runs.length,
    "Missing Run-scoped launch evidence",
  );
  const matches = [];
  for (const run of runs) {
    const rt = runtimes.find(
      (r) =>
        r.instance_runtime_id === run.instanceRuntimeId &&
        r.native_session_id === sessionId,
    );
    const relevant = rows.filter(
      (r) =>
        r.provider === provider &&
        Number.isFinite(Date.parse(r.at)) &&
        Date.parse(r.at) <= Date.parse(finishedAt) &&
        (provider === "opencode"
          ? rt && Number.isSafeInteger(rt.pid) && r.parentPid === rt.pid
          : r.runAttemptId === run.runAttemptId &&
            Date.parse(r.at) >= Date.parse(run.startedAt) &&
            Date.parse(r.at) <= Date.parse(run.finishedAt ?? finishedAt)),
    );
    assert.ok(
      relevant.length,
      "Missing exact Run/runtime guarded launch memory evidence",
    );
    matches.push(...relevant);
  }
  for (const r of matches) {
    assert.equal(r.evidence, "actual-guarded-launch-options/v1");
    assert.equal(
      realpathSync(r.cwd),
      realpathSync(cwd),
      "Actual CLI workspace changed",
    );
    assertMultiProviderVersion(provider, r.version);
    assert.ok(
      ["enforced", "not-applicable"].includes(r.memoryPolicy?.status),
      "Missing memory evidence",
    );
  }
  return [...new Set(matches)].map(
    ({
      provider,
      version,
      memoryPolicy,
      evidence,
      runAttemptId,
      parentPid,
      at,
    }) => ({
      provider,
      version,
      memoryPolicy,
      evidence,
      runAttemptId,
      parentPid,
      at,
    }),
  );
}
