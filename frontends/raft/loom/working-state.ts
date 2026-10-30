import type { AgentCatalogEntry, AgentPresence } from "@rah-os/protocol";

/** Diagnostic projections only. Stable definition IDs must be joined to member principals. */
export function instanceActivity(
  principalId: string,
  catalog: readonly AgentCatalogEntry[],
  presence: readonly AgentPresence[],
) {
  const agent = catalog.find((a) => a.definition.participantId === principalId);
  return agent
    ? presence.find((p) => p.agentId === agent.definition.agentId)?.activity
    : undefined;
}

export function projectWorkingInstances(
  catalog: readonly AgentCatalogEntry[],
  presence: readonly AgentPresence[],
) {
  return presence.flatMap((p) => {
    if (p.activity !== "working" && p.activity !== "thinking") return [];
    const agent = catalog.find((a) => a.definition.agentId === p.agentId);
    if (!agent?.instanceChannelId) return [];
    return [
      {
        agentId: agent.definition.participantId,
        agentName: agent.currentRevision.displayName ?? agent.handle,
        agentAvatarUrl: agent.currentRevision.avatarKey ?? null,
        activity: p.activity,
        text: p.activity === "thinking" ? "思考中…" : "工作中…",
      },
    ];
  });
}
