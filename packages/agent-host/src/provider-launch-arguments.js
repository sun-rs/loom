// Human-managed launch overrides and legacy additions; no shell evaluation. Built-in transport stays owned here.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PROVIDER_LAUNCH_ARGS_ENV = "RAH_PROVIDER_LAUNCH_ARGS_JSON";
const base = {
  codex: ["app-server"],
  claude: [
    "--print",
    "--verbose",
    "--allow-dangerously-skip-permissions",
    "--dangerously-skip-permissions",
    "--permission-mode",
    "bypassPermissions",
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--include-partial-messages",
    "--replay-user-messages",
  ],
  kimi: ["acp"],
  opencode: ["serve", "--pure"],
};
const managed = new Set([
  "--",
  "--help",
  "-h",
  "--version",
  "-v",
  "--print",
  "--verbose",
  "--allow-dangerously-skip-permissions",
  "--dangerously-skip-permissions",
  "-p",
  "--input-format",
  "--output-format",
  "--permission-mode",
  "--model",
  "-m",
  "--effort",
  "--resume",
  "--continue",
  "-c",
  "-r",
  "--session-id",
  "--system-prompt",
  "--system-prompt-file",
  "--append-system-prompt",
  "--append-system-prompt-file",
  "--disallowed-tools",
  "--allowed-tools",
  "--tools",
  "--settings",
  "--mcp-config",
  "--strict-mcp-config",
  // Global personal-config isolation (2026-09-26): Claude Code 2.1.282 reads
  // user settings, CLAUDE.md, skills, commands, agents and hooks only through
  // the `user` setting source.
  "--setting-sources",
  "--listen",
  "--port",
  "--hostname",
  "--host",
  "--cwd",
  "--directory",
  "--sandbox",
  "--approval-policy",
  "--bare",
  "--enable",
  "--disable",
  "--config",
  "--replay-user-messages",
  "--include-partial-messages",
  // evo §40 B1: permission, approval, sandbox, tool-policy and scope switches
  // are daemon-owned (Multica `claudeBlockedArgs` precedent). Claude Code
  // 2.1.282 camelCase aliases, its permission hook and extra directories
  // (Channel attached directories are fixed at creation); Codex CLI 0.156.1
  // approval/sandbox switches and profiles; kimi-code 0.39.1 modes.
  "--disallowedTools",
  "--allowedTools",
  "--permission-prompt-tool",
  "--add-dir",
  "--dangerously-bypass-approvals-and-sandbox",
  "--ask-for-approval",
  "-a",
  "-s",
  "--full-auto",
  "--profile",
  "--yolo",
  "-y",
  "--auto",
  "--plan",
]);
function validateShape(args) {
  if (
    !Array.isArray(args) ||
    args.length > 64 ||
    args.some(
      (arg) =>
        typeof arg !== "string" ||
        !arg.length ||
        arg.length > 2048 ||
        /[\0\r\n]/u.test(arg),
    ) ||
    JSON.stringify(args).length > 8192
  )
    throw new Error(
      "Invalid provider arguments (maximum 64 arguments / 8 KiB)",
    );
  return [...args];
}
export function validateProviderLaunchArgs(args) {
  validateShape(args);
  if (args.length && !args[0].startsWith("-"))
    throw new Error("Provider additions must start with an option");
  for (const arg of args)
    if (managed.has(arg.split("=")[0]))
      throw new Error(
        `RAH managed argument cannot be overridden: ${arg.split("=")[0]}`,
      );
  return [...args];
}
export function providerLaunchDefaults(runtimeId) {
  return base[runtimeId] ? [...base[runtimeId]] : [];
}
export function providerLaunchRequiredArgs(runtimeId) {
  return providerLaunchDefaults(runtimeId).filter((arg) => arg !== "--pure");
}
export function validateProviderLaunchOverride(runtimeId, args) {
  validateShape(args);
  const defaults = providerLaunchRequiredArgs(runtimeId);
  if (!defaults.length) throw new Error("Unknown provider");
  const remaining = [...args];
  for (let i = 0; i < defaults.length; i++) {
    const key = defaults[i];
    const value =
      defaults[i + 1] && !defaults[i + 1].startsWith("-")
        ? defaults[++i]
        : undefined;
    const at = remaining.indexOf(key);
    if (at < 0 || (value !== undefined && remaining[at + 1] !== value))
      throw new Error(
        `RAH managed argument required: ${key}${value ? " " + value : ""}`,
      );
    if (!key.startsWith("-") && args[0] !== key)
      throw new Error(`RAH managed subcommand must stay first: ${key}`);
    remaining.splice(at, value === undefined ? 1 : 2);
  }
  validateProviderLaunchArgs(remaining);
  return [...args];
}
export function providerLaunchArguments(runtimeId, environment = process.env) {
  const envelope = JSON.parse(environment[PROVIDER_LAUNCH_ARGS_ENV] || "{}");
  if (envelope.runtimeId !== runtimeId)
    return providerLaunchDefaults(runtimeId);
  if (Array.isArray(envelope.overrideArgs))
    return validateProviderLaunchOverride(runtimeId, envelope.overrideArgs);
  const additionalArgs = validateProviderLaunchArgs(
    envelope.additionalArgs ?? [],
  );
  return [...providerLaunchDefaults(runtimeId), ...additionalArgs];
}

// Process-only auto-memory policy; shared by execution and Settings projection.
export function providerMemoryConfig(runtimeId) {
  return runtimeId === "codex"
    ? {
        "features.memories": false,
        "memories.generate_memories": false,
        "memories.use_memories": false,
      }
    : {};
}
// Process-only switches for native features that start turns outside the
// instance's single lane (full review batch 3). Codex 0.156.1 `codex features
// list`: `multi_agent` and `goals` are stable and on by default; `-c
// features.<key>=false` turns each off. kimi-code 0.39.1 source: both agent
// cores stop the cron scheduler and `CronCreate` refuses under
// `KIMI_DISABLE_CRON=1`, so a cron persisted in a resumed session never fires.
// Kimi goals have no process switch (only the user's config.toml `[tools]
// disabled`); the Kimi driver pins the ACP `default` (manual) mode, refuses
// to resume an active native goal and rejects goal-tool approvals instead
// (kimi-native-autonomy.js).
// evo §40 B2 (codex-cli 0.156.1 `codex features list`, both stable and on by
// default): `sleep_tool` gives the model `clock.sleep` to wait across sleeps
// inside a turn (long waiting owned by the tool loop, holding the lane) and
// `in_app_local_automation` lets it create recurring automations (a native
// scheduler outside the lane).
function providerAutonomyConfig(runtimeId) {
  return runtimeId === "codex"
    ? {
        "features.multi_agent": false,
        "features.goals": false,
        "features.sleep_tool": false,
        "features.in_app_local_automation": false,
      }
    : {};
}
// Global personal-config isolation (review 2026-09-26). Every switch is
// process-only: the Human's own CLI runs keep reading their global files and
// no user file is written.
// - Claude Code 2.1.282: `--setting-sources project,local` drops the user
//   source (~/.claude/CLAUDE.md, rules, skills incl. claude.ai-synced skills,
//   commands, agents, settings.json env/hooks); `--strict-mcp-config` drops
//   ~/.claude.json MCP servers (Loom's own `--mcp-config` stays);
//   ENABLE_CLAUDEAI_MCP_SERVERS=false drops claude.ai connectors (OAuth).
//   Neither CLAUDE_CONFIG_DIR nor --bare: both lose the keychain login.
// - OpenCode 1.18.32: OPENCODE_DISABLE_CLAUDE_CODE drops ~/.claude/CLAUDE.md
//   and ~/.claude/skills; OPENCODE_DISABLE_EXTERNAL_SKILLS drops
//   ~/.agents/skills. ~/.config/opencode is a known limitation (it holds the
//   provider/model configuration the instance needs).
// - Codex 0.156.1: see codexIsolationConfig below.
// - Kimi: no process switch short of a dedicated KIMI_CODE_HOME (known
//   limitation, owner decision pending).
const CLAUDE_ISOLATION_ARGS = [
  "--setting-sources",
  "project,local",
  "--strict-mcp-config",
];
const PROVIDER_ISOLATION_ENVIRONMENT = {
  claude: {
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  },
  kimi: { KIMI_DISABLE_CRON: "1" },
  opencode: {
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
  },
};

// Codex 0.156.1 (`-c` overrides, measured against a fake Responses API):
// `notify=[]` stops the user's turn-end program (it received each user
// message and reply verbatim); plugins, apps and hooks are feature switches;
// `skills.include_instructions=false` removes every skill listing from the
// prompt; `web_search="disabled"` removes the native web search tool: under
// the instance's danger-full-access sandbox Codex sends it with live web
// access even when `web_search="cached"` is configured (measured), so
// disabling is the only value independent of the user's `web_search`.
// `mcp_servers={}` merges instead of replacing, so each user MCP server is
// disabled by name.
function codexIsolationConfig(environment) {
  return [
    ["notify", "[]"],
    ["features.plugins", "false"],
    ["features.apps", "false"],
    ["features.hooks", "false"],
    ["skills.include_instructions", "false"],
    ["web_search", '"disabled"'],
    ...codexUserMcpServerNames(environment).map((name) => [
      `mcp_servers.${name}.enabled`,
      "false",
    ]),
  ];
}

function codexConfigPath(environment) {
  const codexHome =
    environment.CODEX_HOME || join(environment.HOME || homedir(), ".codex");
  return join(codexHome, "config.toml");
}

function tomlKey(raw) {
  const key = raw.trim();
  const quoted = /^"((?:[^"\\]|\\.)*)"$/u.exec(key) ?? /^'([^']*)'$/u.exec(key);
  return quoted ? quoted[1] : key;
}

// Read-only scan of the user's config.toml for MCP server names: table
// headers `[mcp_servers.<name>]` / `[mcp_servers.<name>.env]`, entries inside
// `[mcp_servers]`, and root dotted keys `mcp_servers.<name>.<field> = ...`.
// Codex splits a `-c` key on every dot, so a name containing "." or "=" cannot
// be addressed; the launch fails closed instead of loading it.
export function codexUserMcpServerNames(environment = process.env) {
  let text;
  try {
    text = readFileSync(codexConfigPath(environment), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const names = new Set();
  const segment = String.raw`(?:"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)`;
  const header = new RegExp(
    String.raw`^\[\s*mcp_servers\s*\.\s*(${segment})\s*(?:\.[^\]]*)?\]\s*(?:#.*)?$`,
    "u",
  );
  const dotted = new RegExp(
    String.raw`^mcp_servers\s*\.\s*(${segment})\s*[.=]`,
    "u",
  );
  const entry = new RegExp(String.raw`^(${segment})\s*[.=]`, "u");
  let table = "";
  let multiline;
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    // Lines inside a multi-line string are values, never keys.
    if (multiline !== undefined) {
      if (line.includes(multiline)) multiline = undefined;
      continue;
    }
    if (!line || line.startsWith("#")) continue;
    multiline = ['"""', "'''"].find(
      (fence) => line.split(fence).length % 2 === 0,
    );
    if (line.startsWith("[")) {
      table = line.replace(/\s*#[^"'\]]*$/u, "").replace(/\s+/gu, "");
      const match = header.exec(line);
      if (match) names.add(tomlKey(match[1]));
      continue;
    }
    if (table === "") {
      const match = dotted.exec(line);
      if (match) names.add(tomlKey(match[1]));
    } else if (table === "[mcp_servers]") {
      const match = entry.exec(line);
      if (match) names.add(tomlKey(match[1]));
    }
  }
  const sorted = [...names].sort();
  for (const name of sorted)
    if (!/^[^.=\s]+$/u.test(name))
      throw new Error(
        `Codex MCP server name cannot be disabled for a Loom instance (-c splits keys on "."): ${name}`,
      );
  return sorted;
}

export function providerLaunchPolicy(runtimeId, environment = process.env) {
  const falseSwitches = Object.keys({
    ...providerMemoryConfig(runtimeId),
    ...providerAutonomyConfig(runtimeId),
  }).map((key) => [key, "false"]);
  const isolation =
    runtimeId === "codex" ? codexIsolationConfig(environment) : [];
  // `notify=[]` first: nothing may reach the user's notify program.
  const config = [
    ...isolation.filter(([key]) => key === "notify"),
    ...falseSwitches,
    ...isolation.filter(([key]) => key !== "notify"),
  ];
  return {
    args: [
      ...config.flatMap(([key, value]) => ["-c", `${key}=${value}`]),
      ...(runtimeId === "claude" ? CLAUDE_ISOLATION_ARGS : []),
    ],
    environment: { ...PROVIDER_ISOLATION_ENVIRONMENT[runtimeId] },
  };
}
