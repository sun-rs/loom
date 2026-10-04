import { providerLaunchSwitches } from "../../packages/agent-host/src/provider-launch-arguments.js";
import { codexNativeArgs } from "./native.mjs";
import { claudeNativeArgs } from "./claude-usage.mjs";
import { kimiNativeArgs } from "./kimi-usage.mjs";
import { openCodeNativeArgs } from "./opencode-usage.mjs";

// Baseline identity uses the same argv builders as each actual native arm.
export function nativeInvocationArgs(provider, options) {
  switch (provider) {
    case "codex":
      return codexNativeArgs(options);
    case "claude":
      return claudeNativeArgs(options);
    case "kimi":
      return kimiNativeArgs(options);
    case "opencode":
      return openCodeNativeArgs(options);
    default:
      throw new Error(`Unknown native provider ${provider}`);
  }
}

export function nativeInvocationPolicy(provider) {
  return {
    ...providerLaunchSwitches(provider),
    ...(provider === "opencode" ? { cwdPolicy: "spawn-cwd-and-PWD/v1" } : {}),
    ...(provider === "claude"
      ? { connectionPolicy: "claude-connection-environment/v1" }
      : {}),
  };
}
