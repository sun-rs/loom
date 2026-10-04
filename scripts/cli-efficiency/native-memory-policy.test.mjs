import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  describeNativeMemoryPolicy,
  assertNativeMemoryPolicy,
} from "./native-memory-policy.mjs";
import {
  nativeRound,
  codexNativeArgs,
  codexNativeEnvironment,
} from "./native.mjs";
import { nativeClaudeRound } from "./native-claude.mjs";
import { nativeKimiRound } from "./native-kimi.mjs";
import { nativeOpenCodeRound } from "./native-opencode.mjs";
import { providerLaunchSwitches } from "../../packages/agent-host/src/provider-launch-arguments.js";

const memoryKeys = [
  "features.memories",
  "memories.generate_memories",
  "memories.use_memories",
];

test("memory support declarations distinguish missing policy from enforced off", () => {
  for (const provider of ["codex", "claude"]) {
    assert.equal(describeNativeMemoryPolicy(provider).supported, true);
    assert.equal(describeNativeMemoryPolicy(provider).status, "supported");
  }
  for (const provider of ["kimi", "opencode"]) {
    assert.equal(describeNativeMemoryPolicy(provider).supported, false);
    assert.equal(describeNativeMemoryPolicy(provider).status, "unsupported");
    assert.throws(
      () => assertNativeMemoryPolicy({ provider, args: [], env: {} }),
      /no verified.*memory/i,
    );
  }
  assert.throws(
    () => describeNativeMemoryPolicy("unknown"),
    /Unknown provider/u,
  );
});

test("Codex first/resume launch verifies all three actual memory overrides without exposing environment", () => {
  for (const sessionId of [undefined, "native-session"]) {
    const args = codexNativeArgs({
      model: "gpt-6-luna",
      effort: "low",
      sessionId,
      prompt: "do not start a model",
      launchArgs: providerLaunchSwitches("codex").args,
    });
    const env = codexNativeEnvironment({
      RAH_PROVIDER_LAUNCH_ARGS_JSON: '{"overrideArgs":["--enable","memories"]}',
      SECRET: "private-value",
    });
    const evidence = assertNativeMemoryPolicy({ provider: "codex", args, env });
    assert.throws(
      () =>
        assertNativeMemoryPolicy({
          provider: "codex",
          args: ["exec", "no memory overrides"],
          env,
        }),
      /memory-off.*incomplete/u,
    );
    assert.equal(evidence.status, "enforced");
    assert.deepEqual(
      evidence.config,
      Object.fromEntries(memoryKeys.map((k) => [k, false])),
    );
    assert.ok(!JSON.stringify(evidence).includes("private-value"));
    assert.equal(env.RAH_PROVIDER_LAUNCH_ARGS_JSON, undefined);
    for (const key of memoryKeys) {
      assert.throws(
        () =>
          assertNativeMemoryPolicy({
            provider: "codex",
            args: args.map((a) => (a === `${key}=false` ? `${key}=true` : a)),
            env,
          }),
        /memory/i,
      );
      assert.throws(
        () =>
          assertNativeMemoryPolicy({
            provider: "codex",
            args: [...args.slice(0, -1), "-c", `${key}=true`, args.at(-1)],
            env,
          }),
        /memory/i,
      );
    }
    for (const extra of [
      ["--enable", "memories"],
      ["--enable=memories"],
      ["-c", "memories={use_memories=true}"],
      ["--config=features.memories=true"],
    ]) {
      assert.throws(
        () =>
          assertNativeMemoryPolicy({
            provider: "codex",
            args: [...args.slice(0, -1), ...extra, args.at(-1)],
            env,
          }),
        /memory/i,
      );
    }
  }
});

test("Claude requires the actual process environment override, not prompt advice", () => {
  assert.throws(
    () =>
      assertNativeMemoryPolicy({
        provider: "claude",
        args: ["-p", "please disable memory"],
        env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0" },
      }),
    /memory/i,
  );
  const evidence = assertNativeMemoryPolicy({
    provider: "claude",
    args: [],
    env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", SECRET: "private-value" },
  });
  assert.equal(evidence.status, "enforced");
  assert.deepEqual(evidence.environment, {
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  });
  assert.ok(!JSON.stringify(evidence).includes("private-value"));
});

test("native runners record enforced first/resume settings from the spawned fake CLI; inherited Claude memory-on cannot win", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loom-native-memory-policy-"));
  const record = join(dir, "calls.jsonl");
  const oldPath = process.env.PATH;
  const oldMemory = process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
  const oldLaunch = process.env.RAH_PROVIDER_LAUNCH_ARGS_JSON;
  const script = `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';\nif(process.argv[2]==='mcp'){console.log('[]');}else{appendFileSync(${JSON.stringify(record)},JSON.stringify({args:process.argv.slice(2),memory:process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY})+'\\n');}\n`;
  for (const name of ["codex", "claude", "kimi", "opencode"])
    writeFileSync(join(dir, name), script, { mode: 0o700 });
  process.env.PATH = `${dir}:${oldPath}`;
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "0";
  process.env.RAH_PROVIDER_LAUNCH_ARGS_JSON =
    '{"runtimeId":"codex","overrideArgs":["--enable","memories"]}';
  try {
    for (const [provider, run, config] of [
      ["codex", nativeRound, { model: "gpt-6-luna", effort: "low" }],
      ["claude", nativeClaudeRound, { model: "sonnet", effort: "low" }],
    ]) {
      for (const sessionId of [undefined, "native-session"]) {
        const round = {};
        await assert.rejects(
          run({
            cwd: dir,
            prompt: "FAKE CLI: no model",
            sessionId,
            config,
            round,
            save() {},
          }),
          /Missing final answer|Native turn failed/u,
        );
        assert.equal(round.nativeMemoryPolicy.provider, provider);
        assert.equal(round.nativeMemoryPolicy.status, "enforced");
      }
    }
    const calls = readFileSync(record, "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(calls.length, 4);
    for (const call of calls.slice(0, 2))
      for (const key of memoryKeys)
        assert.ok(call.args.includes(`${key}=false`));
    for (const call of calls.slice(2)) assert.equal(call.memory, "1");
    for (const [run, config] of [
      [nativeKimiRound, { model: "kimi-code/k3", effort: "high" }],
      [
        nativeOpenCodeRound,
        { model: "deepseek/deepseek-flash", effort: "low" },
      ],
    ]) {
      for (const sessionId of [undefined, "native-session"]) {
        await assert.rejects(
          run({
            cwd: dir,
            prompt: "FAKE CLI",
            sessionId,
            config,
            round: {},
            save() {},
          }),
          /no verified.*memory/i,
        );
      }
    }
    assert.equal(
      readFileSync(record, "utf8").trim().split("\n").length,
      4,
      "unsupported policy refuses before any CLI launch",
    );
  } finally {
    for (const [key, value] of [
      ["PATH", oldPath],
      ["CLAUDE_CODE_DISABLE_AUTO_MEMORY", oldMemory],
      ["RAH_PROVIDER_LAUNCH_ARGS_JSON", oldLaunch],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
