import assert from "node:assert/strict";
import test from "node:test";
import {
  providerLaunchArguments,
  validateProviderLaunchArgs,
  validateProviderLaunchOverride,
} from "../src/provider-launch-arguments.js";

test("all four launchers preserve argv boundaries and isolate provider settings", () => {
  for (const runtimeId of ["codex", "claude", "kimi", "opencode"]) {
    const args = providerLaunchArguments(runtimeId, {
      RAH_PROVIDER_LAUNCH_ARGS_JSON: JSON.stringify({
        runtimeId,
        additionalArgs: ["--example", "a path; not a shell command"],
      }),
    });
    assert.deepEqual(args.slice(-2), [
      "--example",
      "a path; not a shell command",
    ]);
    assert.equal(
      providerLaunchArguments(runtimeId, {
        RAH_PROVIDER_LAUNCH_ARGS_JSON: JSON.stringify({
          runtimeId: "other",
          additionalArgs: ["--example"],
        }),
      }).includes("--example"),
      false,
    );
  }
});
test("managed transport, memory/config and model switches cannot be overridden", () => {
  for (const args of [
    ["--input-format=text"],
    ["-c", "features.memories=true"],
    ["--settings", "{}"],
    ["--model", "other"],
    ["--port", "9999"],
    ["--"],
    ["--help"],
  ])
    assert.throws(() => validateProviderLaunchArgs(args), /managed/);
  assert.throws(
    () => validateProviderLaunchArgs(["--test\n--help"]),
    /Invalid/,
  );
});

test("full override removes an ordinary default and preserves required transport", async () => {
  const { providerLaunchDefaults } =
    await import("../src/provider-launch-arguments.js");
  const overrideArgs = providerLaunchDefaults("opencode").filter(
    (arg) => arg !== "--pure",
  );
  const actual = providerLaunchArguments("opencode", {
    RAH_PROVIDER_LAUNCH_ARGS_JSON: JSON.stringify({
      runtimeId: "opencode",
      overrideArgs,
    }),
  });
  assert.deepEqual(actual, overrideArgs);
  assert.equal(actual.includes("--pure"), false);
  assert.throws(
    () =>
      providerLaunchArguments("opencode", {
        RAH_PROVIDER_LAUNCH_ARGS_JSON: JSON.stringify({
          runtimeId: "opencode",
          overrideArgs: [],
        }),
      }),
    /required|Required/,
  );
});

test("Claude stream-json requires verbose according to the installed CLI", async () => {
  const { providerLaunchDefaults } =
    await import("../src/provider-launch-arguments.js");
  assert.throws(
    () =>
      providerLaunchArguments("claude", {
        RAH_PROVIDER_LAUNCH_ARGS_JSON: JSON.stringify({
          runtimeId: "claude",
          overrideArgs: providerLaunchDefaults("claude").filter(
            (arg) => arg !== "--verbose",
          ),
        }),
      }),
    /verbose/,
  );
});

test("memory policy displayed in settings is the same launch contract consumed by drivers", async () => {
  const { providerLaunchPolicy, providerLaunchSwitches } =
    await import("../src/provider-launch-arguments.js");
  assert.deepEqual(providerLaunchPolicy("claude").environment, {
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    // Global personal-config isolation (2026-09-26).
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  });
  // Settings show the fixed switches; each launch adds the per-name user
  // MCP disables Codex lists (provider-global-isolation.test.ts).
  assert.deepEqual(providerLaunchSwitches("codex").args, [
    // Global personal-config isolation (2026-09-26): notify first.
    "-c",
    "notify=[]",
    "-c",
    "features.memories=false",
    "-c",
    "memories.generate_memories=false",
    "-c",
    "memories.use_memories=false",
    "-c",
    "features.multi_agent=false",
    "-c",
    "features.goals=false",
    "-c",
    "features.sleep_tool=false",
    "-c",
    "features.in_app_local_automation=false",
    "-c",
    "features.plugins=false",
    "-c",
    "features.apps=false",
    "-c",
    "features.hooks=false",
    "-c",
    "skills.include_instructions=false",
    "-c",
    'web_search="disabled"',
  ]);
  // Full review batch 3 P1-6 (kimi-code 0.39.1 source: both agent cores stop
  // the cron scheduler and CronCreate refuses under KIMI_DISABLE_CRON=1).
  assert.deepEqual(providerLaunchPolicy("kimi").environment, {
    KIMI_DISABLE_CRON: "1",
  });
});

// evo §40 B1: permission, approval, sandbox, tool-policy and scope switches
// belong to the daemon for all four CLIs; a stored or replayed addition can
// never re-open them (Multica `claudeBlockedArgs` precedent). Aliases count.
test("permission, approval, sandbox and tool-policy switches cannot be added by user configuration", () => {
  for (const args of [
    // Claude Code 2.1.282 aliases and permission hooks.
    ["--disallowedTools", "Bash"],
    ["--allowedTools", "Bash"],
    ["--disallowed-tools=Bash"],
    ["--permission-prompt-tool", "mcp__x__approve"],
    ["--permission-mode=default"],
    ["--add-dir", "/tmp/elsewhere"],
    // Codex CLI 0.156.1 approval and sandbox switches.
    ["--dangerously-bypass-approvals-and-sandbox"],
    ["--ask-for-approval", "on-request"],
    ["-a", "on-request"],
    ["--sandbox=read-only"],
    ["-s", "read-only"],
    ["--full-auto"],
    ["--profile", "other"],
    ["-c", "approval_policy=on-request"],
    ["--config=sandbox_mode=read-only"],
    ["--enable", "sleep_tool"],
    // kimi-code 0.39.1 permission modes.
    ["--yolo"],
    ["-y"],
    ["--auto"],
    ["--plan"],
  ])
    assert.throws(
      () => validateProviderLaunchArgs(args),
      /managed/,
      `rejects ${args.join(" ")}`,
    );
});

// Full review 2 batch 1 #7 (drivers P2-1): Codex accepts a managed
// single-letter option glued to its value (`-cKEY=VAL`), so the glued form
// is refused like the separate one, in additions and in full overrides.
test("glued single-letter managed options are refused in additions and full overrides", () => {
  for (const glued of [
    "-cfeatures.memories=true",
    "-cmcp_servers.x.command=y",
    "-sdanger-full-access",
    "-aon-request",
    "-mgpt-other",
    "-pprofile",
  ]) {
    assert.throws(
      () => validateProviderLaunchArgs([glued]),
      /managed/,
      `rejects ${glued}`,
    );
    assert.throws(
      () => validateProviderLaunchOverride("codex", ["app-server", glued]),
      /managed/,
      `override rejects ${glued}`,
    );
  }
  assert.deepEqual(validateProviderLaunchArgs(["--example=-c"]), [
    "--example=-c",
  ]);
});

// evo §40 B2: native tools that take scheduling or the Human's attention away
// from the instance's lane are disabled by launch configuration.
test("Claude launches disallow plan mode, self-scheduling, remote routines and user questions", async () => {
  const { CLAUDE_DISALLOWED_TOOLS } =
    await import("../src/claude-stream-launch.js");
  assert.deepEqual(CLAUDE_DISALLOWED_TOOLS.split(","), [
    "EnterPlanMode",
    "ExitPlanMode",
    "ScheduleWakeup",
    "CronCreate",
    "CronList",
    "CronDelete",
    "RemoteTrigger",
    "AskUserQuestion",
  ]);
});
