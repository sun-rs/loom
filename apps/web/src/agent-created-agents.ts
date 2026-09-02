import type { ClientAgentGetResponse } from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";

export function projectCreatedAgentViews(
  detail: ClientAgentGetResponse | undefined,
  directory: readonly WorkspaceAgentView[],
): WorkspaceAgentView[] {
  if (detail === undefined) return [];
  const live = new Map(
    directory.map((agent) => [agent.agentDefinitionId, agent] as const),
  );
  return detail.createdAgents.map((entry) => {
    const current = live.get(entry.definition.agentDefinitionId);
    if (current !== undefined) return current;
    return {
      agentDefinitionId: entry.definition.agentDefinitionId,
      agentDefinitionRevisionId:
        entry.currentRevision.agentDefinitionRevisionId,
      ...(entry.currentRevision.avatarKey === undefined
        ? {}
        : { avatarKey: entry.currentRevision.avatarKey }),
      ...(entry.currentRevision.description === undefined
        ? {}
        : { description: entry.currentRevision.description }),
      createdAt: entry.definition.createdAt,
      createdBy: entry.currentRevision.createdBy,
      displayName: entry.currentRevision.displayName ?? entry.handle,
      executionPolicyRevisionId:
        entry.currentRevision.executionPolicyRevisionId,
      handle: entry.handle,
      participantId: entry.definition.participantId,
      role: entry.currentRevision.role,
      runtimeAvailable: false,
      runtimeLabels: [],
      skillRefs: entry.currentRevision.skillRefs,
      state: entry.definition.state,
    };
  });
}
