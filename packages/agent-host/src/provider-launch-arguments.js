// Human-managed launch overrides and legacy additions; no shell evaluation. Built-in transport stays owned here.
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
export function providerLaunchPolicy(runtimeId) {
  return {
    args: Object.keys(providerMemoryConfig(runtimeId)).flatMap((key) => [
      "-c",
      `${key}=false`,
    ]),
    environment:
      runtimeId === "claude" ? { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" } : {},
  };
}
