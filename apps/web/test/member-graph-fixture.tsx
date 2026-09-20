import React from "react";
import { createRoot } from "react-dom/client";
import type { RahClient } from "@rah-os/client-sdk";
import "../src/product-styles.ts";
import { MemberRelationshipSurface } from "../src/components/member-relationship-graph.tsx";
import { AgentAvatar } from "../src/components/agent-avatar.tsx";
const avatarAgent = {
  avatarKey: "skull",
  displayName: "Isolated",
  participantId: "isolated",
  runtimeAvailable: false,
  state: "disabled" as const,
  connectionStatus: "offline" as const,
  presence: {
    activity: "offline" as const,
    agentId: "isolated",
    reason: "host_offline" as const,
  },
};
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
        agentId: "isolated",
        participantId: "isolated",
        type: "agent",
        avatarKey: avatarAgent.avatarKey,
        displayName: "Isolated",
        handle: "isolated",
        channelIds: [],
      },
    ],
  }),
} as unknown as RahClient;
createRoot(document.getElementById("root")!).render(
  <>
    <div data-testid="canonical-avatar">
      <AgentAvatar agent={avatarAgent} size="sidebar" showStatus={false} />
    </div>
    <MemberRelationshipSurface
      agents={[]}
      client={client}
      workspaceId="fixture"
      onBack={() => {}}
      onOpenAgent={() => {}}
    />
  </>,
);
