import React from "react";
import { createRoot } from "react-dom/client";
import type { RahClient } from "@rah-os/client-sdk";
import "../src/product-styles.ts";
import { MemberRelationshipSurface } from "../src/components/member-relationship-graph.tsx";
const client = {
  request: async () => ({
    workspaceId: "fixture",
    truncated: false,
    channels: [],
    edges: [],
    humans: [
      {
        id: "owner",
        principalId: "owner",
        type: "human",
        displayName: "Owner",
        handle: "owner",
        channelIds: [],
      },
    ],
    agents: [
      {
        id: "isolated",
        agentDefinitionId: "isolated",
        participantId: "isolated",
        type: "agent",
        displayName: "Isolated",
        handle: "isolated",
        channelIds: [],
      },
    ],
  }),
} as unknown as RahClient;
createRoot(document.getElementById("root")!).render(
  <MemberRelationshipSurface
    agents={[]}
    client={client}
    workspaceId="fixture"
    onBack={() => {}}
    onOpenAgent={() => {}}
  />,
);
