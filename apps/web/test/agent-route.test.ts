import assert from "node:assert/strict";
import test from "node:test";

import {
  agentRouteFromSearch,
  agentRouteSearch,
  reconcileAgentRouteIdentity,
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
