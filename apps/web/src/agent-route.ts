export const AGENT_ROUTE_TABS = [
  "activity",
  "profile",
  "chat",
  "reminders",
  "workspace",
] as const;

export type AgentRouteTab = (typeof AGENT_ROUTE_TABS)[number];

export type AgentRouteSelection =
  | {
      agentId: undefined;
      humanPrincipalId: string;
      tab: "profile";
      view: "human";
    }
  | {
      agentId: undefined;
      tab: "profile";
      view: "relationship";
    }
  | {
      agentId: string | undefined;
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
  return { agentId: undefined, tab: "profile" };
}

export function agentRouteFromSearch(search: string): AgentRouteSelection {
  const params = new URLSearchParams(search);
  if (params.get("surface") !== "agents") {
    return agentDirectoryRootRoute();
  }
  if (params.get("memberView") === "relationship") {
    return {
      agentId: undefined,
      tab: "profile",
      view: "relationship",
    };
  }
  if (params.get("memberView") === "human") {
    const id = params.get("human")?.trim();
    return id && id.length <= 512
      ? {
          agentId: undefined,
          humanPrincipalId: id,
          tab: "profile",
          view: "human",
        }
      : agentDirectoryRootRoute();
  }
  const rawAgent = params.get("agent")?.trim();
  const rawTab = params.get("agentTab");
  return {
    agentId: rawAgent && rawAgent.length <= 512 ? rawAgent : undefined,
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
  if (selection.agentId) params.set("agent", selection.agentId);
  params.set("agentTab", selection.tab);
  return `?${params}`;
}

export function reconcileAgentRouteIdentity(
  requestedAgentDefinitionId: string | undefined,
  canonicalAgentDefinitionIds: readonly string[],
): { agentId: string | undefined; replace: boolean } {
  if (canonicalAgentDefinitionIds.length === 0) {
    return {
      agentId: requestedAgentDefinitionId,
      replace: false,
    };
  }
  if (
    requestedAgentDefinitionId !== undefined &&
    canonicalAgentDefinitionIds.includes(requestedAgentDefinitionId)
  ) {
    return {
      agentId: requestedAgentDefinitionId,
      replace: false,
    };
  }
  return {
    agentId: canonicalAgentDefinitionIds[0],
    replace: true,
  };
}

export function shouldOpenAgentMobileDetail(input: {
  humanPrincipalId?: string | undefined;
  agentId: string | undefined;
  panel: boolean;
  view: AgentRouteSelection["view"];
}): boolean {
  return (
    !input.panel &&
    (input.view === "relationship" ||
      input.agentId !== undefined ||
      (input.view === "human" && input.humanPrincipalId !== undefined))
  );
}
