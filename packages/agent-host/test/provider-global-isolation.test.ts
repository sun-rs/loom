import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { RuntimeLaunchEnvironmentSchema } from "@rah-os/protocol";

import { filterUserLaunchEnvironment } from "../src/launch-environment-policy.ts";
import {
  providerLaunchDefaults,
  providerLaunchPolicy,
  providerLaunchRequiredArgs,
  validateProviderLaunchArgs,
} from "../src/provider-launch-arguments.js";

// Global personal-config isolation (review 2026-09-26): a Loom instance's
// CLI must not load the Human's user-level instructions, skills, hooks,
// notify programs, plugins or MCP servers. Every switch is process-only
// (argv/env of the Loom child); no user file is read for writing.

const CODEX_USER_CONFIG = `model = "gpt-6-sol"
notify = ["/Users/someone/notify-program", "turn-ended"]
web_search = "live"
developer_instructions = """
[mcp_servers.not_a_server]
mcp_servers.also_not.command = "x"
"""

[mcp_servers]
inline_one = { command = "/usr/bin/true" }

[mcp_servers.node_repl]
command = "/bin/node_repl"

[mcp_servers.node_repl.env]
CODEX_HOME = "/Users/someone/.codex"

[mcp_servers.computer-use]
command = "./client"
enabled = false

[mcp_servers."quoted_name"]
command = "/usr/bin/true"

[projects."/Users/someone/mcp_servers.fake"]
trust_level = "trusted"
`;

function withCodexHome<T>(
  config: string | undefined,
  run: (env: NodeJS.ProcessEnv, configPath: string) => T,
): T {
  const directory = mkdtempSync(join(tmpdir(), "loom-codex-home-"));
  try {
    const codexHome = join(directory, "codex-home");
    mkdirSync(codexHome);
    const configPath = join(codexHome, "config.toml");
    if (config !== undefined) writeFileSync(configPath, config);
    return run(
      { HOME: join(directory, "home"), CODEX_HOME: codexHome },
      configPath,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// A CODEX_HOME that does not exist: no test reads the Human's real config.
const NO_USER_CONFIG = { CODEX_HOME: "/nonexistent/loom-test-codex-home" };

const configPairs = (args: readonly string[]) => {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++)
    if (args[i] === "-c") out.push(args[++i] ?? "");
  return out;
};

test("Claude isolation: user/claude.ai setting sources and user MCP are off, project instructions stay", () => {
  const policy = providerLaunchPolicy("claude");
  assert.deepEqual(policy.args, [
    "--setting-sources",
    "project,local",
    "--strict-mcp-config",
  ]);
  assert.deepEqual(policy.environment, {
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  });
  // Neither a relocated config home nor bare mode: both lose the keychain login.
  const everything = [...policy.args, ...providerLaunchDefaults("claude")];
  assert.equal(everything.includes("--bare"), false);
  assert.equal("CLAUDE_CONFIG_DIR" in policy.environment, false);
});

test("OpenCode isolation: cross-CLI Claude content and external skills are off without redirecting XDG", () => {
  const policy = providerLaunchPolicy("opencode");
  assert.deepEqual(policy.args, []);
  assert.deepEqual(policy.environment, {
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
  });
  assert.equal("XDG_CONFIG_HOME" in policy.environment, false);
});

test("Kimi keeps its home: no KIMI_CODE_HOME switch in this batch", () => {
  const policy = providerLaunchPolicy("kimi");
  assert.deepEqual(policy.environment, { KIMI_DISABLE_CRON: "1" });
  assert.equal("KIMI_CODE_HOME" in policy.environment, false);
});

test("Codex isolation: notify first, plugins/apps/hooks/skills off, native web search off, every user MCP disabled by name", () => {
  withCodexHome(CODEX_USER_CONFIG, (env, configPath) => {
    const before = readFileSync(configPath, "utf8");
    const beforeMtime = statSync(configPath).mtimeMs;
    const args = providerLaunchPolicy("codex", env).args;
    const pairs = configPairs(args);
    assert.equal(args.length, pairs.length * 2, "only -c pairs");
    assert.equal(pairs[0], "notify=[]", "notify is disabled first");
    for (const entry of [
      "features.memories=false",
      "memories.generate_memories=false",
      "memories.use_memories=false",
      "features.multi_agent=false",
      "features.goals=false",
      "features.sleep_tool=false",
      "features.in_app_local_automation=false",
      "features.plugins=false",
      "features.apps=false",
      "features.hooks=false",
      "skills.include_instructions=false",
      'web_search="disabled"',
    ])
      assert.ok(pairs.includes(entry), entry);
    assert.deepEqual(
      pairs.filter((entry) => entry.startsWith("mcp_servers.")),
      [
        "mcp_servers.computer-use.enabled=false",
        "mcp_servers.inline_one.enabled=false",
        "mcp_servers.node_repl.enabled=false",
        "mcp_servers.quoted_name.enabled=false",
      ],
    );
    assert.equal(readFileSync(configPath, "utf8"), before, "read-only");
    assert.equal(statSync(configPath).mtimeMs, beforeMtime, "read-only");
  });
});

test("Codex isolation without a user config adds no MCP entries and does not create the file", () => {
  withCodexHome(undefined, (env, configPath) => {
    const pairs = configPairs(providerLaunchPolicy("codex", env).args);
    assert.equal(pairs[0], "notify=[]");
    assert.deepEqual(
      pairs.filter((entry) => entry.startsWith("mcp_servers.")),
      [],
    );
    assert.equal(existsSync(configPath), false);
  });
});

test("Codex isolation reads the default ~/.codex when CODEX_HOME is unset", () => {
  const home = mkdtempSync(join(tmpdir(), "loom-codex-default-home-"));
  try {
    mkdirSync(join(home, ".codex"));
    writeFileSync(
      join(home, ".codex", "config.toml"),
      '[mcp_servers.alpha]\ncommand = "/usr/bin/true"\n',
    );
    assert.ok(
      configPairs(providerLaunchPolicy("codex", { HOME: home }).args).includes(
        "mcp_servers.alpha.enabled=false",
      ),
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Codex isolation fails closed for an MCP name that `-c` cannot address", () => {
  withCodexHome('[mcp_servers."dot.name"]\ncommand = "x"\n', (env) => {
    assert.throws(
      () => providerLaunchPolicy("codex", env),
      /cannot be disabled.*dot\.name/u,
    );
  });
});

test("isolation switches cannot be added or reopened by user launch arguments", () => {
  for (const args of [
    ["--setting-sources", "user,project,local"],
    ["--setting-sources=user"],
    ["--strict-mcp-config"],
    ["--mcp-config", "{}"],
    ["-c", "notify=['/x']"],
    ["--config", "features.plugins=true"],
    ["--enable", "plugins"],
  ])
    assert.throws(
      () => validateProviderLaunchArgs(args),
      /managed/,
      args.join(" "),
    );
  // The isolation switches are appended by the drivers from the policy, so a
  // full override that keeps only the required transport cannot drop them.
  for (const runtimeId of ["claude", "codex", "opencode", "kimi"])
    for (const arg of providerLaunchPolicy(runtimeId, NO_USER_CONFIG).args)
      if (arg.startsWith("--"))
        assert.equal(
          providerLaunchRequiredArgs(runtimeId).includes(arg),
          false,
          `${arg} comes from the policy, not the overridable defaults`,
        );
});

test("every policy environment key is protected from Role/user launch environments", () => {
  for (const runtimeId of ["claude", "codex", "opencode", "kimi"])
    for (const key of Object.keys(
      providerLaunchPolicy(runtimeId, NO_USER_CONFIG).environment,
    )) {
      assert.deepEqual(
        filterUserLaunchEnvironment({ [key]: "0" }).rejected,
        [key],
        key,
      );
      assert.equal(
        RuntimeLaunchEnvironmentSchema.safeParse({ [key]: "0" }).success,
        false,
        key,
      );
    }
});

// ------------------------------------------------------------- drivers
// Each launch path (per-turn and warm) spawns a FAKE recorder in place of the
// CLI. The recorder writes its argv and the isolation environment, then exits.

const RECORDED_ENV = [
  "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
  "ENABLE_CLAUDEAI_MCP_SERVERS",
  "KIMI_DISABLE_CRON",
  "OPENCODE_DISABLE_CLAUDE_CODE",
  "OPENCODE_DISABLE_EXTERNAL_SKILLS",
];

function writeRecorder(directory: string, recordPath: string) {
  const path = join(directory, "fake-cli-recorder.mjs");
  writeFileSync(
    path,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const env = {};
for (const key of ${JSON.stringify(RECORDED_ENV)}) env[key] = process.env[key] ?? null;
appendFileSync(${JSON.stringify(recordPath)}, JSON.stringify({ argv: process.argv.slice(2), env }) + "\\n");
process.exit(3);
`,
  );
  chmodSync(path, 0o755);
  return path;
}

type DriverCase = {
  runtimeId: "claude" | "codex" | "opencode" | "kimi";
  driver: string;
  args: (input: {
    executable: string;
    directory: string;
    wake: string;
  }) => string[];
};

const drivers: DriverCase[] = [
  {
    runtimeId: "claude",
    driver: "claude-stream-json-driver.mjs",
    args: ({ executable, wake }) => [
      "--executable",
      executable,
      "--prompt",
      "FAKE prompt",
      "--tool-access-mode",
      "full_access",
      "--wake-input-file",
      wake,
    ],
  },
  {
    runtimeId: "claude",
    driver: "claude-warm-driver.mjs",
    args: ({ executable, directory }) => [
      "--executable",
      executable,
      "--prompt",
      "FAKE prompt",
      "--tool-access-mode",
      "full_access",
      "--runtime-id",
      "fake-runtime",
      "--host-generation",
      "fake-generation",
      "--socket-dir",
      directory,
    ],
  },
  {
    runtimeId: "codex",
    driver: "codex-app-server-driver.mjs",
    args: ({ executable, wake }) => [
      "--executable",
      executable,
      "--prompt",
      "FAKE prompt",
      "--tool-access-mode",
      "full_access",
      "--wake-input-file",
      wake,
    ],
  },
  {
    runtimeId: "codex",
    driver: "codex-warm-driver.mjs",
    args: ({ executable, directory }) => [
      "--executable",
      executable,
      "--prompt",
      "FAKE prompt",
      "--tool-access-mode",
      "full_access",
      "--runtime-id",
      "fake-runtime",
      "--host-generation",
      "fake-generation",
      "--socket-dir",
      directory,
    ],
  },
  {
    runtimeId: "opencode",
    driver: "opencode-server-driver.mjs",
    args: ({ executable, wake }) => [
      "--executable",
      executable,
      "--prompt",
      "FAKE prompt",
      "--tool-access-mode",
      "full_access",
      "--wake-input-file",
      wake,
    ],
  },
  {
    runtimeId: "opencode",
    driver: "opencode-warm-driver.mjs",
    args: ({ executable, directory }) => [
      "--executable",
      executable,
      "--prompt",
      "FAKE prompt",
      "--tool-access-mode",
      "full_access",
      "--runtime-id",
      "fake-runtime",
      "--host-generation",
      "fake-generation",
      "--socket-dir",
      directory,
    ],
  },
  {
    runtimeId: "kimi",
    driver: "kimi-acp-driver.mjs",
    args: ({ executable, wake }) => [
      "--executable",
      executable,
      "--prompt",
      "FAKE prompt",
      "--tool-access-mode",
      "full_access",
      "--wake-input-file",
      wake,
    ],
  },
];

async function recordLaunch(item: DriverCase) {
  const directory = mkdtempSync(join(tmpdir(), "loom-iso-driver-"));
  try {
    const recordPath = join(directory, "record.jsonl");
    const executable = writeRecorder(directory, recordPath);
    const wake = join(directory, "wake.md");
    writeFileSync(wake, "FAKE wake", { mode: 0o600 });
    const codexHome = join(directory, "codex-home");
    mkdirSync(codexHome);
    writeFileSync(
      join(codexHome, "config.toml"),
      '[mcp_servers.user_mcp]\ncommand = "/usr/bin/true"\n',
    );
    const workspace = join(directory, "workspace");
    mkdirSync(workspace);
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL(`../src/${item.driver}`, import.meta.url)),
        ...item.args({ executable, directory, wake }),
      ],
      {
        cwd: workspace,
        env: {
          PATH: process.env.PATH,
          HOME: join(directory, "home"),
          CODEX_HOME: codexHome,
          TMPDIR: directory,
          // A value that slipped past the Role filter must still lose.
          ENABLE_CLAUDEAI_MCP_SERVERS: "true",
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0",
          OPENCODE_DISABLE_CLAUDE_CODE: "0",
          OPENCODE_DISABLE_EXTERNAL_SKILLS: "0",
          // A full override that keeps only the required transport.
          RAH_PROVIDER_LAUNCH_ARGS_JSON: JSON.stringify({
            runtimeId: item.runtimeId,
            overrideArgs: providerLaunchRequiredArgs(item.runtimeId),
          }),
        },
        stdio: ["pipe", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const deadline = Date.now() + 15_000;
    while (!existsSync(recordPath) && Date.now() < deadline) {
      if (child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    child.kill("SIGKILL");
    assert.ok(
      existsSync(recordPath),
      `${item.driver} spawned the CLI; stderr: ${stderr.slice(-2000)}`,
    );
    const [recorded] = readFileSync(recordPath, "utf8")
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            argv: string[];
            env: Record<string, string | null>;
          },
      );
    assert.ok(recorded, `${item.driver} record`);
    return {
      first: recorded,
      policy: providerLaunchPolicy(item.runtimeId, {
        HOME: join(directory, "home"),
        CODEX_HOME: codexHome,
      }),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const item of drivers)
  test(`${item.driver} passes the isolation policy to the CLI and it wins over inherited values`, async () => {
    const { first, policy } = await recordLaunch(item);
    for (const [key, value] of Object.entries(policy.environment))
      assert.equal(first.env[key], value, `${item.driver} ${key}`);
    const argv = first.argv.join("\u0000");
    assert.ok(
      argv.includes(policy.args.join("\u0000")),
      `${item.driver} argv carries the policy args in order: ${first.argv.join(" ")}`,
    );
    if (item.runtimeId === "codex")
      assert.ok(
        first.argv.includes("mcp_servers.user_mcp.enabled=false"),
        "user MCP read from the child's CODEX_HOME",
      );
    if (item.runtimeId === "claude") {
      assert.equal(first.env.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
      assert.ok(first.argv.includes("--strict-mcp-config"));
      assert.equal(
        first.argv[first.argv.indexOf("--setting-sources") + 1],
        "project,local",
      );
    }
  });
