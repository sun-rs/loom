import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
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
  providerLaunchArguments,
  providerLaunchDefaults,
  providerLaunchPolicy,
  providerLaunchRequiredArgs,
  providerLaunchSwitches,
  validateProviderLaunchArgs,
} from "../src/provider-launch-arguments.js";

// Global personal-config isolation (review 2026-09-26): a Loom instance's
// CLI must not load the Human's user-level instructions, skills, hooks,
// notify programs, plugins or MCP servers. Every switch is process-only
// (argv/env of the Loom child); no user file is read for writing.

// FAKE `codex mcp list --json` (not Codex): it mirrors what Codex 0.156.1
// was measured to do (see provider-global-isolation-probe.test.ts, which
// checks the real CLI): it lists `$CODEX_HOME/fake-mcp-list.json` (default
// `$HOME/.codex`), drops plugin-provided servers under
// `features.plugins=false`, applies `-c mcp_servers.<name>.enabled=false`
// (splitting the key on "."), and records each call with its cwd.
// Anything else in the argv behaves as the launch recorder given.
const FAKE_CODEX_MCP_LIST = String.raw`
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
const argv = process.argv.slice(2);
if (argv[0] === "mcp") {
  const home = process.env.CODEX_HOME || join(process.env.HOME, ".codex");
  const state = JSON.parse(readFileSync(join(home, "fake-mcp-list.json"), "utf8"));
  appendFileSync(join(home, "fake-mcp-calls.jsonl"), JSON.stringify({ argv, cwd: process.cwd() }) + "\n");
  if (state.exit) {
    process.stderr.write(state.stderr ?? "FAKE failure\n");
    process.exit(state.exit);
  }
  if (state.stdout !== undefined) {
    process.stdout.write(state.stdout);
    process.exit(0);
  }
  const overrides = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === "-c") overrides.push(argv[++i]);
  const pluginsOff = overrides.includes("features.plugins=false");
  const servers = [...state.servers, ...(pluginsOff ? [] : state.pluginServers ?? [])].map((server) => ({ ...server }));
  for (const entry of overrides) {
    const [key] = entry.split("=");
    const path = key.split(".");
    if (path[0] !== "mcp_servers") continue;
    const server = servers.find((candidate) => candidate.name === path[1]);
    if (path.length !== 3 || path[2] !== "enabled" || !server) {
      process.stderr.write("Error: failed to load bootstrap configuration\n  invalid transport in " + key + "\n");
      process.exit(1);
    }
    if (!state.ignoreOverrides) server.enabled = false;
  }
  process.stdout.write(JSON.stringify(servers));
  process.exit(0);
}
`;

function writeFakeCodex(directory: string, launch = "process.exit(64);") {
  const path = join(directory, "fake-codex.mjs");
  writeFileSync(
    path,
    `#!${process.execPath}\n${FAKE_CODEX_MCP_LIST}\n${launch}\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

type FakeMcpState = {
  servers?: Array<{ name: string; enabled: boolean }>;
  pluginServers?: Array<{ name: string; enabled: boolean }>;
  exit?: number;
  stderr?: string;
  stdout?: string;
  ignoreOverrides?: boolean;
};

function withFakeCodex<T>(
  state: FakeMcpState | undefined,
  run: (input: {
    env: NodeJS.ProcessEnv;
    executable: string;
    cwd: string;
    calls: () => Array<{ argv: string[]; cwd: string }>;
    codexHome: string;
  }) => T,
): T {
  const directory = mkdtempSync(join(tmpdir(), "loom-codex-home-"));
  try {
    const codexHome = join(directory, "codex-home");
    const cwd = join(directory, "workspace");
    mkdirSync(codexHome);
    mkdirSync(cwd);
    if (state !== undefined)
      writeFileSync(
        join(codexHome, "fake-mcp-list.json"),
        JSON.stringify({ servers: [], ...state }),
      );
    const callsPath = join(codexHome, "fake-mcp-calls.jsonl");
    return run({
      env: { HOME: join(directory, "home"), CODEX_HOME: codexHome },
      executable: writeFakeCodex(directory),
      cwd,
      codexHome,
      calls: () =>
        existsSync(callsPath)
          ? readFileSync(callsPath, "utf8")
              .trim()
              .split("\n")
              .map(
                (line) => JSON.parse(line) as { argv: string[]; cwd: string },
              )
          : [],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

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
  withFakeCodex(
    {
      servers: [
        { name: "node_repl", enabled: true },
        { name: "computer-use", enabled: false },
        { name: "inline_one", enabled: true },
        { name: "é unicode name", enabled: true },
      ],
      pluginServers: [{ name: "plugin_app", enabled: true }],
    },
    ({ env, executable, cwd, calls, codexHome }) => {
      const config = join(codexHome, "config.toml");
      writeFileSync(
        config,
        "# FAKE user config: Loom never reads or writes it\n",
      );
      const beforeMtime = statSync(config).mtimeMs;
      const args = providerLaunchPolicy("codex", env, {
        codexExecutable: executable,
        cwd,
      }).args;
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
          "mcp_servers.é unicode name.enabled=false",
        ],
        "every server Codex lists, never a plugin server the launch turns off",
      );
      const [listed, verified] = calls();
      assert.equal(calls().length, 2, "one listing and one verification");
      for (const call of [listed!, verified!]) {
        assert.equal(call.cwd, realpathSync(cwd), "listed in the launch cwd");
        assert.deepEqual(call.argv.slice(0, 3), ["mcp", "list", "--json"]);
        assert.ok(
          configPairs(call.argv).includes("features.plugins=false"),
          "listed under the launch switches",
        );
      }
      assert.ok(
        configPairs(verified!.argv).includes(
          "mcp_servers.node_repl.enabled=false",
        ),
        "verified with the disable overrides",
      );
      assert.equal(statSync(config).mtimeMs, beforeMtime, "read-only");
    },
  );
});

test("Codex isolation without user MCP servers adds no MCP entries and lists once", () => {
  withFakeCodex({ servers: [] }, ({ env, executable, cwd, calls }) => {
    const pairs = configPairs(
      providerLaunchPolicy("codex", env, { codexExecutable: executable, cwd })
        .args,
    );
    assert.equal(pairs[0], "notify=[]");
    assert.deepEqual(
      pairs.filter((entry) => entry.startsWith("mcp_servers.")),
      [],
    );
    assert.equal(calls().length, 1);
  });
});

test("Codex isolation lists with the launch environment (default ~/.codex when CODEX_HOME is unset)", () => {
  const home = mkdtempSync(join(tmpdir(), "loom-codex-default-home-"));
  try {
    mkdirSync(join(home, ".codex"));
    writeFileSync(
      join(home, ".codex", "fake-mcp-list.json"),
      JSON.stringify({ servers: [{ name: "alpha", enabled: true }] }),
    );
    assert.ok(
      configPairs(
        providerLaunchPolicy(
          "codex",
          { HOME: home },
          { codexExecutable: writeFakeCodex(home), cwd: home },
        ).args,
      ).includes("mcp_servers.alpha.enabled=false"),
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Codex isolation fails closed whenever the user MCP servers cannot be resolved or disabled", () => {
  const refused: Array<[string, FakeMcpState | undefined, RegExp]> = [
    [
      "Codex cannot parse the configuration",
      {
        exit: 1,
        stderr:
          "Error: failed to load bootstrap configuration\n  TOML parse error at line 1\n",
      },
      /could not be resolved.*exited 1.*TOML parse error/su,
    ],
    ["the listing is not JSON", { stdout: "not json" }, /did not print JSON/u],
    [
      "the listing has an unexpected shape",
      { stdout: JSON.stringify([{ name: 7 }]) },
      /unexpected shape/u,
    ],
    [
      "a name `-c` cannot address",
      { servers: [{ name: "dot.name", enabled: true }] },
      /cannot be disabled.*dot\.name/u,
    ],
    [
      "a name containing '='",
      { servers: [{ name: "a=b", enabled: true }] },
      /cannot be disabled.*a=b/u,
    ],
    [
      "Codex did not apply an override",
      { servers: [{ name: "stubborn", enabled: true }], ignoreOverrides: true },
      /did not apply.*stubborn/u,
    ],
  ];
  for (const [label, state, error] of refused)
    withFakeCodex(state, ({ env, executable, cwd }) => {
      assert.throws(
        () =>
          providerLaunchPolicy("codex", env, {
            codexExecutable: executable,
            cwd,
          }),
        error,
        label,
      );
    });
  assert.throws(
    () =>
      providerLaunchPolicy(
        "codex",
        { CODEX_HOME: "/nonexistent/loom-test" },
        {
          codexExecutable: "/nonexistent/loom-test-codex",
        },
      ),
    /could not be resolved.*ENOENT/su,
    "a missing Codex CLI",
  );
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
    for (const arg of providerLaunchSwitches(runtimeId).args)
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
      providerLaunchSwitches(runtimeId).environment,
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
  "OPENCODE_CONFIG_CONTENT",
];

// FAKE `opencode debug config --pure` (not OpenCode): the resolved config
// lists one user MCP server, as the installed 1.18.32 would for a user file.
const FAKE_OPENCODE_DEBUG_CONFIG = String.raw`
if (process.argv[2] === "debug" && process.argv[3] === "config") {
  process.stdout.write(JSON.stringify({ mcp: { user_mcp: { type: "local", command: ["/usr/bin/false"] } } }));
  process.exit(0);
}
`;

function writeRecorder(directory: string, recordPath: string) {
  const path = join(directory, "fake-cli-recorder.mjs");
  writeFileSync(
    path,
    `#!${process.execPath}
${FAKE_CODEX_MCP_LIST}
${FAKE_OPENCODE_DEBUG_CONFIG}
import { appendFileSync as record } from "node:fs";
const env = {};
for (const key of ${JSON.stringify(RECORDED_ENV)}) env[key] = process.env[key] ?? null;
record(${JSON.stringify(recordPath)}, JSON.stringify({ argv: process.argv.slice(2), env }) + "\\n");
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

async function recordLaunch(
  item: DriverCase,
  extra: { driverArgs?: string[]; env?: Record<string, string> } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "loom-iso-driver-"));
  try {
    const recordPath = join(directory, "record.jsonl");
    const executable = writeRecorder(directory, recordPath);
    const wake = join(directory, "wake.md");
    writeFileSync(wake, "FAKE wake", { mode: 0o600 });
    const codexHome = join(directory, "codex-home");
    mkdirSync(codexHome);
    writeFileSync(
      join(codexHome, "fake-mcp-list.json"),
      JSON.stringify({ servers: [{ name: "user_mcp", enabled: true }] }),
    );
    const workspace = join(directory, "workspace");
    mkdirSync(workspace);
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL(`../src/${item.driver}`, import.meta.url)),
        ...item.args({ executable, directory, wake }),
        ...(extra.driverArgs ?? []),
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
          ...extra.env,
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
    const callsPath = join(codexHome, "fake-mcp-calls.jsonl");
    return {
      first: recorded,
      mcpListCwds: existsSync(callsPath)
        ? readFileSync(callsPath, "utf8")
            .trim()
            .split("\n")
            .map((line) => (JSON.parse(line) as { cwd: string }).cwd)
        : [],
      workspace: realpathSync(workspace),
      policy: providerLaunchPolicy(
        item.runtimeId,
        { HOME: join(directory, "home"), CODEX_HOME: codexHome },
        { codexExecutable: executable, cwd: workspace },
      ),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const item of drivers)
  test(`${item.driver} passes the isolation policy to the CLI and it wins over inherited values`, async () => {
    const { first, policy, mcpListCwds, workspace } = await recordLaunch(item);
    for (const [key, value] of Object.entries(policy.environment))
      assert.equal(first.env[key], value, `${item.driver} ${key}`);
    const argv = first.argv.join("\u0000");
    assert.ok(
      argv.includes(policy.args.join("\u0000")),
      `${item.driver} argv carries the policy args in order: ${first.argv.join(" ")}`,
    );
    if (item.runtimeId === "codex") {
      assert.ok(
        first.argv.includes("mcp_servers.user_mcp.enabled=false"),
        "user MCP listed by the driver's Codex executable with the child's CODEX_HOME",
      );
      assert.ok(mcpListCwds.length >= 2, "listed and verified before launch");
      for (const cwd of mcpListCwds.slice(0, 2))
        assert.equal(cwd, workspace, "listed in the launch cwd");
    }
    if (item.runtimeId === "opencode") {
      // evo §57/§59: user MCP servers switched off by name, process-only.
      const config = JSON.parse(first.env.OPENCODE_CONFIG_CONTENT ?? "{}") as {
        mcp?: Record<string, unknown>;
      };
      assert.deepEqual(config.mcp, { user_mcp: { enabled: false } });
    }
    if (item.runtimeId === "claude") {
      assert.equal(first.env.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
      assert.ok(first.argv.includes("--strict-mcp-config"));
      assert.equal(
        first.argv[first.argv.indexOf("--setting-sources") + 1],
        "project,local",
      );
    }
  });

// Owner ruling 2026-09-27: native CLI memory stays off on every launch path.
// The loop above compares each path with the policy object; this one pins the
// literal switches, so dropping one from the policy fails here too.
// - Claude Code: CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 (process environment).
// - Codex: features.memories / memories.generate_memories /
//   memories.use_memories = false, each as the last `-c` for its key (Codex
//   applies `-c` overrides in order), after any Host-built `-c` pass-through.
// - Kimi and OpenCode: no native persistent memory switch; the main-branch
//   audit docs/audits/2026-09-11-provider-auto-memory-disable.zh-CN.md added
//   none because none was verified for them, and the owner treats both as
//   having no native persistent memory. Their launches are pinned to carry no
//   invented memory switch.
// A Role launchEnvironment cannot carry the Claude key (schema and filter
// reject it); a value that slipped into the driver environment still loses.
// User launch arguments cannot re-open a memory key (validator), and a full
// override keeps only the required transport (recordLaunch uses one).
const CODEX_MEMORY_KEYS = [
  "features.memories",
  "memories.generate_memories",
  "memories.use_memories",
];
const lastConfigValue = (argv: readonly string[], key: string) =>
  configPairs(argv)
    .filter((entry) => entry.startsWith(`${key}=`))
    .at(-1);
const nativeMemoryPaths: Array<[string, DriverCase]> = [
  ["Claude cold", drivers[0]!],
  ["Claude warm", drivers[1]!],
  ["Codex cold", drivers[2]!],
  ["Codex warm", drivers[3]!],
  ["OpenCode cold", drivers[4]!],
  ["OpenCode warm", drivers[5]!],
  ["Kimi", drivers[6]!],
];

test("native memory switches are protected from Role launch environments and user launch arguments", () => {
  assert.deepEqual(
    filterUserLaunchEnvironment({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0" })
      .rejected,
    ["CLAUDE_CODE_DISABLE_AUTO_MEMORY"],
  );
  assert.equal(
    RuntimeLaunchEnvironmentSchema.safeParse({
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0",
    }).success,
    false,
  );
  for (const runtimeId of ["claude", "codex", "opencode", "kimi"])
    for (const key of CODEX_MEMORY_KEYS)
      for (const envelope of [
        { runtimeId, additionalArgs: ["-c", `${key}=true`] },
        { runtimeId, additionalArgs: ["--config", `${key}=true`] },
        {
          runtimeId,
          overrideArgs: [
            ...providerLaunchRequiredArgs(runtimeId),
            "-c",
            `${key}=true`,
          ],
        },
      ])
        assert.throws(
          () =>
            providerLaunchArguments(runtimeId, {
              RAH_PROVIDER_LAUNCH_ARGS_JSON: JSON.stringify(envelope),
            }),
          /managed/,
          JSON.stringify(envelope),
        );
});

for (const [label, item] of nativeMemoryPaths)
  test(`${label} (${item.driver}) launches with native memory off, whatever the Role environment or pass-through carries`, async () => {
    const { first } = await recordLaunch(item, {
      env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0" },
      ...(item.runtimeId === "codex"
        ? {
            driverArgs: CODEX_MEMORY_KEYS.flatMap((key) => [
              "-c",
              `${key}=true`,
            ]),
          }
        : {}),
    });
    if (item.runtimeId === "claude")
      assert.equal(first.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
    if (item.runtimeId === "codex")
      for (const key of CODEX_MEMORY_KEYS)
        assert.equal(lastConfigValue(first.argv, key), `${key}=false`, key);
    else
      assert.equal(
        first.argv.some((arg) => /memor/iu.test(arg)),
        false,
        `${label} carries no invented memory switch: ${first.argv.join(" ")}`,
      );
  });
