import assert from "node:assert/strict";
import test from "node:test";

import {
  agentDirectoryRootRoute,
  agentRouteFromSearch,
  agentRouteSearch,
  reconcileAgentRouteIdentity,
  shouldOpenAgentMobileDetail,
  type AgentRouteSelection,
} from "../src/agent-route.ts";
import { globalSurfaceFromSearch } from "../src/global-discovery-model.ts";

test("Agent identity and tab survive refresh without carrying hidden conversation state", () => {
  const selection: AgentRouteSelection = {
    agentDefinitionId: "agent_definition_alice",
    tab: "mcp",
  };
  const search = agentRouteSearch(
    "?room=room_old&thread=room_old%3Aroot&message=message_old&filter=mentions",
    selection,
  );

  assert.equal(
    search,
    "?surface=agents&agent=agent_definition_alice&agentTab=mcp",
  );
  assert.deepEqual(agentRouteFromSearch(search), selection);
  assert.equal(globalSurfaceFromSearch(search), "agents");
});

test("Agent route rejects unknown tabs and incomplete identities", () => {
  assert.deepEqual(
    agentRouteFromSearch(
      "?surface=agents&agent=agent_definition_alice&agentTab=unknown",
    ),
    { agentDefinitionId: "agent_definition_alice", tab: "profile" },
  );
  assert.deepEqual(agentRouteFromSearch("?surface=agents&agentTab=activity"), {
    agentDefinitionId: undefined,
    tab: "activity",
  });
  assert.deepEqual(
    agentRouteFromSearch("?surface=room&agent=agent_definition_alice"),
    {
      agentDefinitionId: undefined,
      tab: "profile",
    },
  );
});

test("Agent route serialization keeps only canonical Agent navigation state", () => {
  assert.equal(
    agentRouteSearch("?surface=agents&agent=old&agentTab=chat", {
      agentDefinitionId: "agent_definition_kimi",
      tab: "workspace",
    }),
    "?surface=agents&agent=agent_definition_kimi&agentTab=workspace",
  );
});

test("relationship view is a reload-safe Agent surface mutually exclusive with Agent detail", () => {
  const relationship: AgentRouteSelection = {
    agentDefinitionId: undefined,
    tab: "profile",
    view: "relationship",
  };
  const search = agentRouteSearch(
    "?surface=agents&agent=stale&agentTab=mcp",
    relationship,
  );
  assert.equal(search, "?surface=agents&memberView=relationship");
  assert.deepEqual(agentRouteFromSearch(search), relationship);
  assert.deepEqual(
    agentRouteFromSearch(
      "?surface=agents&memberView=relationship&agent=ignored&agentTab=chat",
    ),
    relationship,
  );
});

test("Agent route keeps the requested identity while the canonical directory hydrates", () => {
  assert.deepEqual(reconcileAgentRouteIdentity("agent_definition_alice", []), {
    agentDefinitionId: "agent_definition_alice",
    replace: false,
  });
  assert.deepEqual(
    reconcileAgentRouteIdentity("agent_definition_missing", [
      "agent_definition_alice",
      "agent_definition_kimi",
    ]),
    { agentDefinitionId: "agent_definition_alice", replace: true },
  );
  assert.deepEqual(
    reconcileAgentRouteIdentity(undefined, ["agent_definition_alice"]),
    { agentDefinitionId: "agent_definition_alice", replace: true },
  );
});

test("a canonical Agent deep link reopens mobile detail after reload", () => {
  assert.equal(
    shouldOpenAgentMobileDetail({
      agentDefinitionId: "agent_definition_alice",
      panel: false,
      view: undefined,
    }),
    true,
  );
  assert.equal(
    shouldOpenAgentMobileDetail({
      agentDefinitionId: undefined,
      panel: false,
      view: undefined,
    }),
    false,
  );
  assert.equal(
    shouldOpenAgentMobileDetail({
      agentDefinitionId: undefined,
      panel: false,
      view: "relationship",
    }),
    false,
  );
  assert.equal(
    shouldOpenAgentMobileDetail({
      agentDefinitionId: "agent_definition_alice",
      panel: true,
      view: undefined,
    }),
    false,
  );
});

test("entering the mobile Agent root does not reopen a stale detail selection", () => {
  assert.deepEqual(agentDirectoryRootRoute(), {
    agentDefinitionId: undefined,
    tab: "profile",
  });
});

test("Human profile routes preserve principal identity and exclude stale Agent/Room state", () => {
  const human: AgentRouteSelection = {
    agentDefinitionId: undefined,
    humanPrincipalId: "human_owner",
    tab: "profile",
    view: "human",
  };
  const search = agentRouteSearch(
    "?surface=agents&agent=old&agentTab=chat&room=old",
    human,
  );
  assert.equal(search, "?surface=agents&memberView=human&human=human_owner");
  assert.deepEqual(agentRouteFromSearch(search), human);
  assert.deepEqual(
    agentRouteFromSearch("?surface=agents&memberView=human&human="),
    agentDirectoryRootRoute(),
  );
  assert.equal(shouldOpenAgentMobileDetail({ ...human, panel: false }), true);
});
