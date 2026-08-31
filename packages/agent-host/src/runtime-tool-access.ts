import type { ToolAccessMode } from "@rah-os/protocol";

export type RuntimeToolAccessLaunch = Readonly<{
  args: readonly string[];
  env: Readonly<Record<string, string>>;
}>;

type LocalCliProbeKind =
  "claude-cli/v1" | "codex-cli/v1" | "kimi-cli/v1" | "opencode-cli/v1";

const RAFT_UNATTENDED_ACCESS = Object.freeze([
  "full_access",
] satisfies ToolAccessMode[]);

/**
 * Publish only modes for which the selected adapter has an exact, tested
 * mapping. This capability travels with RuntimeOffer and is consumed by both
 * placement and UI; it is not inferred from a Provider display name.
 */
export function supportedRuntimeToolAccessModes(
  _adapterKind: string,
  _probeKind: LocalCliProbeKind | string | undefined,
): readonly ToolAccessMode[] {
  return RAFT_UNATTENDED_ACCESS;
}

/**
 * Thin, versioned mapping from the product access policy to controls exposed
 * by the installed CLI. No shell command is composed and no provider config
 * file is mutated.
 */
export function resolveRuntimeToolAccessLaunch(
  probeKind: LocalCliProbeKind | string | undefined,
  mode: ToolAccessMode,
): RuntimeToolAccessLaunch {
  if (mode !== "full_access") {
    throw new Error(
      `standard Raft policy requires full_access; ${mode} is not a product Runtime mode`,
    );
  }
  if (probeKind === "claude-cli/v1") {
    return launch([
      "--allow-dangerously-skip-permissions",
      "--dangerously-skip-permissions",
      "--permission-mode",
      "bypassPermissions",
    ]);
  }
  if (probeKind === "codex-cli/v1") {
    return launch(["--sandbox", "danger-full-access"]);
  }
  if (probeKind === "kimi-cli/v1") {
    return launch(["--yolo"]);
  }
  if (probeKind === "opencode-cli/v1") {
    // Raft 1.0.18 used --dangerously-skip-permissions. Current OpenCode
    // exposes the equivalent headless contract as --auto plus the explicit
    // all-tools permission map; using the removed flag would make the current
    // CLI fail before the Activation starts.
    return launch(["--auto"], {
      OPENCODE_PERMISSION: JSON.stringify({ "*": "allow" }),
    });
  }
  return launch([]);
}

function launch(
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): RuntimeToolAccessLaunch {
  return Object.freeze({
    args: Object.freeze([...args]),
    env: Object.freeze({ ...env }),
  });
}
