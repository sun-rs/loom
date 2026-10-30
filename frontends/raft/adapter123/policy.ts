/** Single-release capability seam. No CSS, sizes, DOM rewrites or newer resources. */
export function adaptNativeCapabilities(code: string, path: string) {
  const quota = path.endsWith("/components/agent/CreateAgentDialog.tsx")
    ? "const atLimit = agentCapacityLimitState.reached;"
    : path.endsWith("/components/channel/CreateChannelDialog.tsx")
      ? "const atLimit = maxChannels !== -1 && channels.length >= maxChannels;"
      : undefined;
  if (quota) {
    if (code.split(quota).length !== 2)
      throw Error("Native local-capacity seam changed");
    return code.replace(
      quota,
      "const atLimit = false; // Local Loom has no Raft subscription quota.",
    );
  }
  if (!path.endsWith("/components/agent/AgentDetailPanel.tsx")) return code;
  const marker = "() => AGENT_TABS.filter((tab) => {";
  if (code.split(marker).length !== 2)
    throw Error("Native Role tab capability seam changed");
  return code.replace(
    marker,
    marker +
      '\n      // Loom has no Raft-managed MCP, integrations, reminders or global Agent session.\n      if (tab !== "profile" && tab !== "activity") return false;',
  );
}
