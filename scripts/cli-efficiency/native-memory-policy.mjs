// Launch evidence only: official auto-memory settings, not file isolation or
// recall of memory already present in a resumed session. Never serialize env.
import {
  providerLaunchSwitches,
  providerMemoryConfig,
} from "../../packages/agent-host/src/provider-launch-arguments.js";

export function describeNativeMemoryPolicy(provider) {
  if (!["codex", "claude", "kimi", "opencode"].includes(provider))
    throw new Error(`Unknown provider ${provider}`);
  const supported = provider === "codex" || provider === "claude";
  return {
    provider,
    supported,
    status: supported ? "supported" : "unsupported",
    scope: "provider-native-auto-memory",
    mechanism:
      provider === "codex"
        ? "cli-config"
        : provider === "claude"
          ? "environment"
          : null,
    ...(!supported
      ? {
          reason:
            "No verified native auto-memory disable policy; absence of a switch does not prove absence of the feature",
        }
      : {}),
  };
}

export function assertNativeMemoryPolicy({ provider, args, env }) {
  const declared = describeNativeMemoryPolicy(provider);
  if (!declared.supported) throw new Error(`${provider}: ${declared.reason}`);
  const evidence = {
    ...declared,
    status: "enforced",
    evidence: "spawn-configuration",
  };
  if (provider === "claude") {
    const key = "CLAUDE_CODE_DISABLE_AUTO_MEMORY";
    if (
      providerLaunchSwitches(provider).environment[key] !== "1" ||
      env[key] !== "1"
    )
      throw new Error(
        "Claude native memory must be disabled in the actual launch environment",
      );
    return { ...evidence, environment: { [key]: "1" } };
  }
  const required = providerMemoryConfig("codex");
  const seen = new Set();
  // Native prompt is the last positional value, never an option to inspect.
  const options = args.slice(0, -1);
  for (let i = 0; i < options.length; i++) {
    const arg = options[i];
    if (
      (arg === "--enable" && options[i + 1] === "memories") ||
      arg === "--enable=memories"
    )
      throw new Error(
        "Codex native memory cannot be enabled by a feature override",
      );
    let setting;
    if (arg === "-c" || arg === "--config") setting = options[++i];
    else if (arg.startsWith("--config=")) setting = arg.slice(9);
    if (typeof setting !== "string") continue;
    const separator = setting.indexOf("=");
    const key = setting
      .slice(0, separator)
      .trim()
      .replaceAll('"', "")
      .replaceAll("'", "");
    const value = setting.slice(separator + 1).trim();
    if (
      key === "features" ||
      key === "memories" ||
      key.startsWith("memories.") ||
      key === "features.memories"
    ) {
      if (
        !Object.hasOwn(required, key) ||
        required[key] !== false ||
        value !== "false" ||
        seen.has(key)
      )
        throw new Error(
          "Codex native memory requires unambiguous explicit memory-off overrides",
        );
      seen.add(key);
    }
  }
  if (seen.size !== Object.keys(required).length || seen.size === 0)
    throw new Error("Codex native memory-off launch settings are incomplete");
  return { ...evidence, config: { ...required } };
}
