import type { RuntimeTrajectoryRecord } from "@rah-os/protocol";

export const MAX_AGENT_DIAGNOSTIC_BYTES = 4096;
export type AgentDiagnosticIdentity = {
  agentId: string;
  displayName: string;
  handle: string;
  participantId: string;
  runtimeLabels?: readonly string[];
  modelBindingId?: string;
  state?: string;
  presence?: { activity: string };
};

/** Raft zo: a current metadata snapshot, never an activity-history export. */
export function renderAgentActivityDiagnostics(
  agent: AgentDiagnosticIdentity,
  activities: readonly RuntimeTrajectoryRecord[],
  reportedAt = new Date(),
): string {
  const last = activities.at(-1);
  const status = last?.entry.kind === "status" ? last.entry : undefined;
  const activity = agent.presence?.activity ?? status?.activity ?? "unknown";
  const field = (value: string | undefined) =>
    (value?.trim() || "unknown").replace(/[\r\n]/g, " ").slice(0, 120);
  return [
    "RAH OS Agent diagnostic information",
    `reportedAtUtc: ${reportedAt.toISOString()}`,
    `agentId: ${field(agent.agentId)}`,
    `participantId: ${field(agent.participantId)}`,
    `runtime: ${field(agent.runtimeLabels?.join(", "))}`,
    `model: ${field(agent.modelBindingId)}`,
    `agentStatus: ${field(agent.state)}`,
    `activity: ${field(activity)}`,
    `activityKind: ${field(status?.detailKind ?? last?.entry.kind)}`,
    `lastActivityAtUtc: ${field(last?.observedAt)}`,
  ].join("\n");
}
