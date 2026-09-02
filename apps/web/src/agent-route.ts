export const AGENT_ROUTE_TABS = [
  "activity",
  "profile",
  "chat",
  "reminders",
  "workspace",
  "apps",
  "mcp",
] as const;

export type AgentRouteTab = (typeof AGENT_ROUTE_TABS)[number];

export type AgentRouteSelection = {
  agentDefinitionId: string | undefined;
  tab: AgentRouteTab;
};

const AGENT_ROUTE_TAB_SET = new Set<string>(AGENT_ROUTE_TABS);

export function agentRouteFromSearch(search: string): AgentRouteSelection {
  const params = new URLSearchParams(search);
  if (params.get("surface") !== "agents") {
    return { agentDefinitionId: undefined, tab: "profile" };
  }
  const rawAgent = params.get("agent")?.trim();
  const rawTab = params.get("agentTab");
  return {
    agentDefinitionId:
      rawAgent && rawAgent.length <= 512 ? rawAgent : undefined,
    tab:
      rawTab && AGENT_ROUTE_TAB_SET.has(rawTab)
        ? (rawTab as AgentRouteTab)
        : "profile",
  };
}

export function agentRouteSearch(
  _currentSearch: string,
  selection: AgentRouteSelection,
): string {
  const params = new URLSearchParams({ surface: "agents" });
  if (selection.agentDefinitionId)
    params.set("agent", selection.agentDefinitionId);
  params.set("agentTab", selection.tab);
  return `?${params}`;
}

export function reconcileAgentRouteIdentity(
  requestedAgentDefinitionId: string | undefined,
  canonicalAgentDefinitionIds: readonly string[],
): { agentDefinitionId: string | undefined; replace: boolean } {
  if (canonicalAgentDefinitionIds.length === 0) {
    return {
      agentDefinitionId: requestedAgentDefinitionId,
      replace: false,
    };
  }
  if (
    requestedAgentDefinitionId !== undefined &&
    canonicalAgentDefinitionIds.includes(requestedAgentDefinitionId)
  ) {
    return {
      agentDefinitionId: requestedAgentDefinitionId,
      replace: false,
    };
  }
  return {
    agentDefinitionId: canonicalAgentDefinitionIds[0],
    replace: true,
  };
}
