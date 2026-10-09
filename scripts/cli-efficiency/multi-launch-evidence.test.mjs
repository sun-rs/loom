import test from "node:test";
import assert from "node:assert/strict";
import {
  multiLaunchEvidence,
  assertMultiLaunchEvidence,
} from "./multi-launch-evidence.mjs";
const cwd = "/tmp";
test("product launch receipt checks actual official memory settings without serializing credentials", () => {
  const env = {
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    ANTHROPIC_API_KEY: "SECRET",
  };
  const r = multiLaunchEvidence({
    provider: "claude",
    args: [
      "--print",
      "--setting-sources",
      "project,local",
      "--strict-mcp-config",
    ],
    env,
    cwd,
    version: "2.1.287 (Claude Code)",
  });
  assert.equal(r.memoryPolicy.status, "enforced");
  assert.ok(!JSON.stringify(r).includes("SECRET"));
  assert.throws(
    () =>
      multiLaunchEvidence({
        provider: "claude",
        args: ["--print"],
        env: {},
        cwd,
        version: "2.1.287 (Claude Code)",
      }),
    /memory/,
  );
  assert.throws(
    () =>
      multiLaunchEvidence({
        provider: "claude",
        args: ["--print", "--setting-sources", "user"],
        env,
        cwd,
        version: "2.1.287 (Claude Code)",
      }),
    /isolation/,
  );
  assert.equal(
    multiLaunchEvidence({
      provider: "claude",
      args: ["--version"],
      env: {},
      cwd,
      version: "x",
    }),
    null,
  );
});
test("audited no-memory providers require exact audited versions and OpenCode pure isolation", () => {
  const env = {
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
  };
  const r = multiLaunchEvidence({
    provider: "opencode",
    args: ["serve", "--pure"],
    env,
    cwd,
    version: "1.18.32",
  });
  assert.equal(r.memoryPolicy.status, "not-applicable");
  assert.throws(
    () =>
      multiLaunchEvidence({
        provider: "opencode",
        args: ["serve"],
        env,
        cwd,
        version: "1.18.32",
      }),
    /pure/,
  );
  assert.throws(
    () =>
      multiLaunchEvidence({
        provider: "kimi",
        args: ["acp"],
        env: {},
        cwd,
        version: "next",
      }),
    /version/,
  );
});
test("missing, foreign cwd or future launch evidence never proves memory off", () => {
  const r = multiLaunchEvidence({
    provider: "kimi",
    args: ["acp"],
    env: { RAH_RUN_ATTEMPT_ID: "r" },
    cwd,
    version: "0.39.1",
    at: "2026-10-07T00:00:01Z",
  });
  const options = {
    provider: "kimi",
    cwd,
    startedAt: "2026-10-07T00:00:01Z",
    finishedAt: "2026-10-07T00:00:02Z",
    runs: [
      {
        runAttemptId: "r",
        startedAt: "2026-10-07T00:00:01Z",
        finishedAt: "2026-10-07T00:00:02Z",
      },
    ],
  };
  assert.doesNotThrow(() => assertMultiLaunchEvidence([r], options));
  assert.throws(() => assertMultiLaunchEvidence([], options), /Missing/);
  assert.throws(
    () => assertMultiLaunchEvidence([{ ...r, cwd: "/" }], options),
    /workspace/,
  );
  assert.throws(
    () =>
      assertMultiLaunchEvidence(
        [{ ...r, at: "2026-10-07T00:00:03Z" }],
        options,
      ),
    /Missing/,
  );
});

test("cold proof binds every actual Run; warm proof binds runtime parent pid and native session", () => {
  const row = {
    provider: "kimi",
    at: "2026-10-07T00:00:01Z",
    cwd: "/tmp",
    version: "0.39.1",
    memoryPolicy: { status: "not-applicable" },
    evidence: "actual-guarded-launch-options/v1",
    runAttemptId: "r1",
    parentPid: 123,
  };
  const opts = {
    provider: "kimi",
    cwd: "/tmp",
    finishedAt: "2026-10-07T00:00:04Z",
    runs: [
      {
        runAttemptId: "r1",
        startedAt: "2026-10-07T00:00:00Z",
        finishedAt: "2026-10-07T00:00:03Z",
      },
    ],
  };
  assert.doesNotThrow(() => assertMultiLaunchEvidence([row], opts));
  for (const change of [
    { runAttemptId: "other" },
    { at: "2026-10-06T00:00:01Z" },
  ])
    assert.throws(
      () => assertMultiLaunchEvidence([{ ...row, ...change }], opts),
      /Missing/,
    );
  assert.throws(
    () =>
      assertMultiLaunchEvidence([row], {
        ...opts,
        runs: [...opts.runs, { ...opts.runs[0], runAttemptId: "r2" }],
      }),
    /Missing/,
  );
  const warm = { ...row, provider: "opencode", version: "1.18.32" };
  const w = {
    provider: "opencode",
    cwd: "/tmp",
    finishedAt: opts.finishedAt,
    sessionId: "s",
    runs: [{ instanceRuntimeId: "rt" }],
    runtimes: [{ instance_runtime_id: "rt", native_session_id: "s", pid: 123 }],
  };
  assert.doesNotThrow(() => assertMultiLaunchEvidence([warm], w));
  assert.throws(
    () => assertMultiLaunchEvidence([{ ...warm, parentPid: 456 }], w),
    /Missing/,
  );
  assert.throws(
    () => assertMultiLaunchEvidence([warm], { ...w, sessionId: "different" }),
    /Missing/,
  );
});
test("Claude 2.1.293 launch evidence retains memory and exact-version admission", () => {
  const input = {
    provider: "claude",
    args: [
      "--print",
      "--setting-sources",
      "project,local",
      "--strict-mcp-config",
    ],
    env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
    cwd,
    version: "2.1.293 (Claude Code)",
  };
  assert.equal(multiLaunchEvidence(input).memoryPolicy.status, "enforced");
  assert.throws(() => multiLaunchEvidence({ ...input, env: {} }), /memory/);
  assert.throws(
    () => multiLaunchEvidence({ ...input, version: "2.1.294 (Claude Code)" }),
    /Unregistered CLI version/,
  );
});

test("audited OpenCode formats admit launch evidence without admitting unknown versions", () => {
  for (const [provider, versions, args, env] of [
    [
      "opencode",
      ["1.18.32", "1.18.35"],
      ["serve", "--pure"],
      {
        OPENCODE_DISABLE_CLAUDE_CODE: "1",
        OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
      },
    ],
  ]) {
    for (const version of versions) {
      const receipt = multiLaunchEvidence({
        provider,
        version,
        args,
        env,
        cwd,
      });
      assert.equal(receipt.provider, provider);
      assert.equal(receipt.version, version);
      assert.throws(
        () => multiLaunchEvidence({ provider, version, args, env: {}, cwd }),
        /memory|isolation/,
      );
    }
    for (const version of ["next", ...versions.map((v) => v + "-custom")])
      assert.throws(
        () => multiLaunchEvidence({ provider, version, args, env, cwd }),
        /Unregistered CLI version/,
      );
  }
});
