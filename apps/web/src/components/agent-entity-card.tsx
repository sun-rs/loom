import type { ReactNode } from "react";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { EntityCard } from "@rah-os/ui-web/neo-brutalist/entity-card";
import { AgentStatusDot } from "@rah-os/ui-web/neo-brutalist/status-dot";
import { agentPresencePresentation } from "../attention-presentation.ts";
import { AgentAvatar } from "./agent-avatar.tsx";

/** An already-authorized entity projection. Never fetches or guesses identity. */
export function AgentEntityCard({
  agent,
  runtimeLabel,
  showStatusLabel = false,
  onOpen,
  disabled = false,
  error,
}: {
  agent: WorkspaceAgentView;
  runtimeLabel: string | undefined;
  showStatusLabel?: boolean;
  onOpen: (id: string) => void;
  disabled?: boolean;
  error?: ReactNode;
}) {
  const presence = agentPresencePresentation(agent);
  return (
    <EntityCard
      avatar={<AgentAvatar agent={agent} size="surface" showStatus={false} />}
      name={agent.displayName}
      subtitle={runtimeLabel}
      label={`打开 ${agent.displayName} Agent 资料`}
      onClick={() => onOpen(agent.agentDefinitionId)}
      disabled={disabled}
      trailing={
        <>
          <AgentStatusDot {...presence} className="" size="md" />
          {error ??
            (showStatusLabel ? (
              <span
                className="rah-entity-card-status-label"
                title={presence.label}
              >
                {presence.label}
              </span>
            ) : null)}
        </>
      }
    />
  );
}
