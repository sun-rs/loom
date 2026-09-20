import { useEffect, useState } from "react";
import type { WorkspaceAgentView } from "@rah-os/ui-web";

import { latestWorkspaceActivity } from "../attention-presentation.ts";
import { AgentAvatar } from "./agent-avatar.tsx";
import { AgentStatusDot } from "./agent-status-dot.tsx";

export function WorkspaceActivityFooter({
  agents,
}: {
  agents: readonly WorkspaceAgentView[];
}) {
  const [, setClockRevision] = useState(0);
  const latest = latestWorkspaceActivity(agents);
  useEffect(() => {
    if (!latest || !Number.isFinite(latest.expiresAt)) return;
    const timer = window.setTimeout(
      () => setClockRevision((revision) => revision + 1),
      Math.max(0, latest.expiresAt - Date.now()) + 50,
    );
    return () => window.clearTimeout(timer);
  }, [latest?.agent.agentId, latest?.expiresAt]);
  if (!latest) return null;
  return (
    <footer
      className="rah-live-agent-activity-footer"
      data-testid="live-agent-activity-bar"
      title={latest.presentation.label}
    >
      <AgentAvatar agent={latest.agent} size="sidebar" showStatus={false} />
      <AgentStatusDot
        activity={latest.presentation.activity}
        className="rah-live-agent-activity-dot"
        label={latest.presentation.label}
        size="sm"
      />
      <span>{latest.presentation.label}</span>
    </footer>
  );
}
