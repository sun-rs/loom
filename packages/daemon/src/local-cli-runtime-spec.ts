import type { LocalWorkbenchRuntimeSpec } from "./local-workbench-bootstrap.ts";
import { compileStandingPrompt } from "./standing-prompt-compiler.ts";

export function localCliRuntimeSpec(
  executable: string,
  workspaceCwd: string,
): LocalWorkbenchRuntimeSpec | undefined {
  if (executable === "claude") {
    return {
      adapterKind: "claude-stream-json/v1",
      agentHandle: "Claude",
      avatarKey: "claude",
      cliId: "claude",
      description: "Claude Code connected through the local account.",
      displayName: "Claude Code · native stream-json",
      executable,
      instructions:
        "Use canonical Room context, make changes only when requested, and report concise evidence.",

      modelCatalogProbe: { kind: "claude-cli/v1" },
      reasoning: "default",
      role: "Claude Code Agent using the local account",
      runtimeProfileId: "local-workbench-profile-claude",
      toolAccessMode: "full_access",
      workspaceCwd,
    };
  }
  if (executable === "codex") {
    return {
      adapterKind: "codex-app-server/v1",
      agentHandle: "Codex",
      avatarKey: "codex",
      cliId: "codex",
      description: "Codex connected through the local OpenAI account.",
      displayName: "Codex · native app-server",
      executable,
      instructions:
        "Work from canonical Room context, preserve unrelated changes, and provide verified results.",

      modelCatalogProbe: { kind: "codex-cli/v1" },
      reasoning: "default",
      role: "Codex Agent using the local account and model settings",
      runtimeProfileId: "local-workbench-profile-codex",
      toolAccessMode: "full_access",
      workspaceCwd,
    };
  }
  if (executable === "kimi") {
    return {
      adapterKind: "kimi-acp/v1",
      agentHandle: "Kimi",
      avatarKey: "kimi",
      cliId: "kimi",
      description: "Kimi CLI connected through the local Coding Plan account.",
      displayName: "Kimi CLI · native ACP",
      executable,
      instructions:
        "Use canonical Room context, complete the assigned work, and report explicit evidence.",

      modelCatalogProbe: { kind: "kimi-cli/v1" },
      reasoning: "default",
      role: "Kimi CLI Agent using the local Coding Plan settings",
      runtimeProfileId: "local-workbench-profile-kimi",
      toolAccessMode: "full_access",
      workspaceCwd,
    };
  }
  if (executable === "opencode") {
    return {
      adapterKind: "opencode-server/v1",
      agentHandle: "OpenCode",
      avatarKey: "opencode",
      cliId: "opencode",
      description: "OpenCode connected through its configured local provider.",
      displayName: "OpenCode · native local server",
      executable,
      instructions:
        "Treat canonical Room state as collaboration truth and report only verified outcomes.",

      modelCatalogProbe: { kind: "opencode-cli/v1" },
      reasoning: "default",
      role: "OpenCode Agent using the configured provider and model",
      runtimeProfileId: "local-workbench-profile-opencode",
      toolAccessMode: "full_access",
      workspaceCwd,
    };
  }
  return undefined;
}

/**
 * The no-agent-layer compilation of the standing prompt. Local CLI
 * RuntimeProfiles no longer freeze any prompt into `fixedArgs`; every launch
 * receives a per-RunAttempt compiled prompt through the daemon standing
 * prompt lease in `standing-prompt-lease.ts`, assembled layer by layer in
 * `standing-prompt-compiler.ts`. This remains for tests and diagnostics that
 * need the agent-free baseline text.
 */
export function localWorkbenchWorkerPrompt(): string {
  return compileStandingPrompt().prompt;
}
