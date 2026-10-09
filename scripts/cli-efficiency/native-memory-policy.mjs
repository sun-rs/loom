import {
  nativeMemoryVersionEvidence,
  NATIVE_MEMORY_VERSION_AUDITS,
  nativeMemoryAuditForVersion,
} from "./native-memory-version.mjs";
// Launch evidence only: official auto-memory settings, not file isolation or
// recall of memory already present in a resumed session. Never serialize env.
import {
  providerLaunchSwitches,
  providerMemoryConfig,
} from "../../packages/agent-host/src/provider-launch-arguments.js";

export function describeNativeMemoryPolicy(provider, version) {
  if (!["codex", "claude", "kimi", "opencode"].includes(provider))
    throw new Error(`Unknown provider ${provider}`);
  const audit =
    version === undefined
      ? NATIVE_MEMORY_VERSION_AUDITS[provider]
      : nativeMemoryAuditForVersion(provider, version);
  if (version !== undefined && NATIVE_MEMORY_VERSION_AUDITS[provider] && !audit)
    throw new Error(
      `Native audited CLI version differs for ${provider}: ${version}`,
    );
  return {
    provider,
    supported: true,
    status: "supported",
    scope: "provider-native-auto-memory",
    mechanism:
      provider === "codex"
        ? "cli-config"
        : provider === "claude"
          ? "environment"
          : "version-audit",
    ...audit,
  };
}

export function assertNativeMemoryPolicy({ provider, args, env, executable }) {
  const declared = describeNativeMemoryPolicy(provider);
  if (!declared.supported) throw new Error(`${provider}: ${declared.reason}`);
  if (provider === "kimi" || provider === "opencode")
    return {
      ...declared,
      ...nativeMemoryVersionEvidence({ provider, args, env, executable }),
    };
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
