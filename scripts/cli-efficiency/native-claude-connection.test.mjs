import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeClaudeRound } from "./native-claude.mjs";

test("native Claude launch preserves configured connection without enabling personal behavior", async () => {
  const root = mkdtempSync(join(tmpdir(), "loom-native-claude-connection-"));
  const previous = { ...process.env };
  try {
    writeFileSync(
      join(root, "settings.json"),
      JSON.stringify({
        env: {
          ANTHROPIC_API_KEY: "FAKE_TEST_KEY",
          ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-test",
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0",
          UNRELATED_USER_SETTING: "must-not-load",
        },
      }),
    );
    writeFileSync(
      join(root, "claude"),
      `#!/usr/bin/env node
require("node:fs").writeFileSync(${JSON.stringify(join(root, "launch.json"))}, JSON.stringify({
  args: process.argv.slice(2),
  key: process.env.ANTHROPIC_API_KEY,
  url: process.env.ANTHROPIC_BASE_URL,
  alias: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
  memory: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY,
  unrelated: process.env.UNRELATED_USER_SETTING,
}));
process.exit(1);
`,
      { mode: 0o700 },
    );
    for (const key of Object.keys(process.env))
      if (key.startsWith("ANTHROPIC_") || key === "CLAUDE_CODE_OAUTH_TOKEN")
        delete process.env[key];
    process.env.CLAUDE_CONFIG_DIR = root;
    process.env.PATH = root + ":" + previous.PATH;
    await assert.rejects(
      nativeClaudeRound({
        cwd: root,
        prompt: "fake test",
        round: {},
        save() {},
        config: { model: "haiku", effort: null },
      }),
      /Native CLI failed/,
    );
    const launch = JSON.parse(readFileSync(join(root, "launch.json"), "utf8"));
    assert.equal(launch.key, "FAKE_TEST_KEY");
    assert.equal(launch.url, "http://127.0.0.1:9");
    assert.equal(launch.alias, "claude-haiku-test");
    assert.equal(launch.memory, "1");
    assert.equal(launch.unrelated, undefined);
    assert.ok(launch.args.includes("--strict-mcp-config"));
    assert.equal(
      launch.args[launch.args.indexOf("--setting-sources") + 1],
      "project,local",
    );
    assert.ok(!JSON.stringify(launch.args).includes("FAKE_TEST_KEY"));
    rmSync(join(root, "launch.json"));
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = "kimi-k3";
    await assert.rejects(
      nativeClaudeRound({
        cwd: root,
        prompt: "must not launch",
        round: {},
        save() {},
        config: { model: "haiku", effort: null },
      }),
      /Configured Claude alias is outside the approved model family/,
    );
    assert.throws(() => readFileSync(join(root, "launch.json")), /ENOENT/);
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    rmSync(root, { recursive: true, force: true });
  }
});
