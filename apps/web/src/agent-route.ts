export const AGENT_ROUTE_TABS = [
  "activity",
  "profile",
  "chat",
  "reminders",
  "workspace",
  "apps",
] as const;

export type AgentRouteTab = (typeof AGENT_ROUTE_TABS)[number];

export type AgentRouteSelection =
  | {
      agentDefinitionId: undefined;
      humanPrincipalId: string;
      tab: "profile";
      view: "human";
    }
  | {
      agentDefinitionId: undefined;
      tab: "profile";
      view: "relationship";
    }
  | {
      agentDefinitionId: string | undefined;
      tab: AgentRouteTab;
      view?: "agent";
    };

const AGENT_ROUTE_TAB_SET = new Set<string>(AGENT_ROUTE_TABS);

export function normalizeAgentRouteTab(value: unknown): AgentRouteTab {
  return typeof value === "string" && AGENT_ROUTE_TAB_SET.has(value)
    ? (value as AgentRouteTab)
    : "profile";
}

export function agentDirectoryRootRoute(): AgentRouteSelection {
  return { agentDefinitionId: undefined, tab: "profile" };
}

export function agentRouteFromSearch(search: string): AgentRouteSelection {
  const params = new URLSearchParams(search);
  if (params.get("surface") !== "agents") {
    return agentDirectoryRootRoute();
  }
  if (params.get("memberView") === "relationship") {
    return {
      agentDefinitionId: undefined,
      tab: "profile",
      view: "relationship",
    };
  }
  if (params.get("memberView") === "human") {
    const id = params.get("human")?.trim();
    return id && id.length <= 512
      ? {
          agentDefinitionId: undefined,
          humanPrincipalId: id,
          tab: "profile",
          view: "human",
        }
      : agentDirectoryRootRoute();
  }
  const rawAgent = params.get("agent")?.trim();
  const rawTab = params.get("agentTab");
  return {
    agentDefinitionId:
      rawAgent && rawAgent.length <= 512 ? rawAgent : undefined,
    tab: normalizeAgentRouteTab(rawTab),
  };
}

export function agentRouteSearch(
  _currentSearch: string,
  selection: AgentRouteSelection,
): string {
  const params = new URLSearchParams({ surface: "agents" });
  if (selection.view === "human") {
    params.set("memberView", "human");
    params.set("human", selection.humanPrincipalId);
    return `?${params}`;
  }
  if (selection.view === "relationship") {
    params.set("memberView", "relationship");
    return `?${params}`;
  }
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

export function shouldOpenAgentMobileDetail(input: {
  humanPrincipalId?: string | undefined;
  agentDefinitionId: string | undefined;
  panel: boolean;
  view: AgentRouteSelection["view"];
}): boolean {
  return (
    !input.panel &&
    input.view !== "relationship" &&
    (input.agentDefinitionId !== undefined ||
      (input.view === "human" && input.humanPrincipalId !== undefined))
  );
}
