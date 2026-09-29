import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

for (const driver of [
  "claude-stream-json-driver.mjs",
  "claude-warm-driver.mjs",
]) {
  test(`${driver}: isolated CLI still receives user connection without user behavior`, () => {
    const home = mkdtempSync(join(tmpdir(), "loom-claude-auth-"));
    try {
      mkdirSync(join(home, ".claude"));
      writeFileSync(
        join(home, ".claude/settings.json"),
        JSON.stringify({
          env: {
            ANTHROPIC_AUTH_TOKEN: "fixture-only-token",
            ANTHROPIC_BASE_URL: "https://fixture.invalid",
            ANTHROPIC_DEFAULT_SONNET_MODEL: "fixture-sonnet",
            ANTHROPIC_MODEL: "forbidden-default",
            NODE_OPTIONS: "--bad",
            CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0",
          },
          hooks: { SessionStart: [{ command: "must-not-run" }] },
          enabledPlugins: { bad: true },
        }),
      );
      const output = join(home, "record.json");
      const executable = join(home, "fake-claude");
      writeFileSync(
        executable,
        `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(output)},JSON.stringify({env:process.env,args:process.argv.slice(2)}));process.exit(1);`,
        { mode: 0o700 },
      );
      spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL(`../src/${driver}`, import.meta.url)),
          "--executable",
          executable,
          "--prompt",
          "fixture",
          "--tool-access-mode",
          "full_access",
          "--model",
          "sonnet",
          "--effort",
          "low",
          ...(driver.includes("warm")
            ? ["--runtime-id", "fixture", "--host-generation", "1"]
            : []),
        ],
        {
          cwd: home,
          env: { HOME: home, PATH: process.env.PATH },
          timeout: 10_000,
          stdio: ["pipe", "pipe", "pipe", "pipe"],
        },
      );
      const captured = JSON.parse(readFileSync(output, "utf8"));
      assert.equal(captured.env.ANTHROPIC_AUTH_TOKEN, "fixture-only-token");
      assert.equal(captured.env.ANTHROPIC_BASE_URL, "https://fixture.invalid");
      assert.equal(
        captured.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
        "fixture-sonnet",
      );
      assert.equal(captured.env.ANTHROPIC_MODEL, undefined);
      assert.equal(captured.env.NODE_OPTIONS, undefined);
      assert.equal(captured.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
      assert.equal(
        captured.args[captured.args.indexOf("--setting-sources") + 1],
        "project,local",
      );
      assert.ok(captured.args.includes("--strict-mcp-config"));
      assert.equal(
        captured.args[captured.args.indexOf("--model") + 1],
        "sonnet",
      );
      assert.ok(!captured.args.join(" ").includes("fixture-only-token"));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
}

import { claudeConnectionEnvironment } from "../src/claude-connection-environment.js";

test("connection source is atomic; explicit environment and empty overrides win", () => {
  const home = mkdtempSync(join(tmpdir(), "loom-claude-source-"));
  try {
    writeFileSync(
      join(home, "settings.json"),
      JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: "private-file-token",
          ANTHROPIC_BASE_URL: "https://file.invalid",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "mapped-sonnet",
        },
      }),
    );
    const env = {
      CLAUDE_CONFIG_DIR: home,
      ANTHROPIC_BASE_URL: "https://explicit.invalid",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "",
    };
    const actual = claudeConnectionEnvironment(env);
    assert.equal(
      actual.ANTHROPIC_AUTH_TOKEN,
      undefined,
      "never send file token to explicit endpoint",
    );
    assert.equal(actual.ANTHROPIC_BASE_URL, env.ANTHROPIC_BASE_URL);
    assert.equal(actual.ANTHROPIC_DEFAULT_SONNET_MODEL, "");
    assert.deepEqual(env, {
      CLAUDE_CONFIG_DIR: home,
      ANTHROPIC_BASE_URL: "https://explicit.invalid",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "",
    });
    assert.equal(
      claudeConnectionEnvironment({
        CLAUDE_CONFIG_DIR: home,
        CLAUDE_CODE_OAUTH_TOKEN: "explicit-oauth",
      }).ANTHROPIC_AUTH_TOKEN,
      undefined,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("missing settings retain login; corrupt config fails without credential text", () => {
  const home = mkdtempSync(join(tmpdir(), "loom-claude-errors-"));
  try {
    assert.deepEqual(claudeConnectionEnvironment({ CLAUDE_CONFIG_DIR: home }), {
      CLAUDE_CONFIG_DIR: home,
    });
    writeFileSync(
      join(home, "settings.json"),
      '{"env":{"ANTHROPIC_AUTH_TOKEN":"private-sentinel",',
    );
    assert.throws(
      () => claudeConnectionEnvironment({ CLAUDE_CONFIG_DIR: home }),
      (error) =>
        error instanceof Error &&
        error.message.includes("could not be read") &&
        !error.message.includes("private-sentinel") &&
        !error.message.includes(home),
    );
    writeFileSync(
      join(home, "settings.json"),
      JSON.stringify({
        env: { ANTHROPIC_AUTH_TOKEN: { value: "private-sentinel" } },
      }),
    );
    assert.throws(
      () => claudeConnectionEnvironment({ CLAUDE_CONFIG_DIR: home }),
      /must be a string/,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("cold starts re-read rotated credentials without storing a second copy", () => {
  const home = mkdtempSync(join(tmpdir(), "loom-claude-rotation-"));
  try {
    const file = join(home, "settings.json");
    const write = (token: string) =>
      writeFileSync(
        file,
        JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: token } }),
      );
    write("first");
    assert.equal(
      claudeConnectionEnvironment({ CLAUDE_CONFIG_DIR: home })
        .ANTHROPIC_AUTH_TOKEN,
      "first",
    );
    write("second");
    assert.equal(
      claudeConnectionEnvironment({ CLAUDE_CONFIG_DIR: home })
        .ANTHROPIC_AUTH_TOKEN,
      "second",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
