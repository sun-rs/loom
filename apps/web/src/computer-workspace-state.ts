import type { WorkspaceAgentView } from "@rah-os/ui-web";
// ACTIVE is observed lifecycle availability, never inferred from CLI discovery.
export function computerWorkspaceState(
  agent: Pick<WorkspaceAgentView, "state" | "presence"> | undefined,
) {
  if (!agent) return "UNKNOWN";
  if (agent.state === "disabled" || agent.presence?.reason === "paused")
    return "STOPPED";
  return agent.presence &&
    ["online", "idle", "starting", "thinking", "working"].includes(
      agent.presence.reason,
    )
    ? "ACTIVE"
    : "UNKNOWN";
}
