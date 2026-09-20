import type { LocalRuntimeInventoryEntry } from "@rah-os/protocol";
import { createWorkspaceEntities } from "../src/workspace-entities.ts";
import { WorkspaceEntityContext } from "../src/components/workspace-entity-context.tsx";
import type { RahClient } from "@rah-os/client-sdk";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { MessageArticle } from "../src/components/conversation-panes.tsx";
const agent: WorkspaceAgentView = {
  agentId: "fixture-agent",
  participantId: "fixture-agent",
  createdAt: "2026-09-14T00:00:00Z",
  createdBy: "fixture-human",
  displayName: "Fixture Agent",
  handle: "fixture-agent",
  executionPolicyRevisionId: "fixture-policy",
  role: "Assistant",
  runtimeAvailable: false,
  runtimeLabels: [],
  skillRefs: [],
  state: "enabled",
  modelBindingId: "fixture/model",
};
// No network or provider calls: exercise the shipped message component directly.
const client = {
  request: async () => {
    throw Error("Unexpected fixture request");
  },
} as unknown as RahClient;
const configuredAgents = [
  "aihubmix",
  "deepseek",
  "codex",
  "claude",
  "kimi",
  "grokbuild",
].map((id) => ({
  ...agent,
  agentId: id,
  participantId: id,
  displayName: `Fixture ${id}`,
  modelBindingId: `${id}/model`,
}));
const fallbackAgents: WorkspaceAgentView[] = [
  [
    "deleted-opencode",
    "local:opencode-cli/v1:iiiiitoken/gemini-3.8-flash-high",
  ],
  ["deleted-kimi", "local:kimi-cli/v1:kimi-code/k3"],
].map(([id, modelBindingId]) => ({
  ...agent,
  agentId: id!,
  participantId: id!,
  displayName: `Fixture ${id}`,
  state: "deleted",
  modelBindingId,
}));
const allAgents = [...configuredAgents, ...fallbackAgents];
const runtimes = configuredAgents.map((entry) => ({
  agentBindings: [
    {
      agentId: entry.agentId,
      participantId: entry.participantId,
      handle: entry.handle,
    },
  ],
  available: true,
  configured: true,
  source: "configured",
  cliId: ["codex", "claude", "kimi"].includes(entry.agentId)
    ? entry.agentId
    : entry.agentId === "grokbuild"
      ? undefined
      : "opencode",
  executable: entry.agentId,
  displayName: "Fixture runtime",
  runtimeOfferId: entry.agentId,
  runtimeProfileId: entry.agentId,
  runtimeProfileRevisionId: "fixture-revision",
  modelBindingDescriptors: [
    {
      modelBindingId: entry.modelBindingId,
      modelId: "model",
      displayName: "DeepSeek V4",
      provider: entry.agentId,
      evidence: "probed",
      capabilityClasses: [],
      supportedReasoning: [],
      supportedServiceTiers: ["default"],
    },
  ],
})) as LocalRuntimeInventoryEntry[];
const entities = createWorkspaceEntities({
  workspaceId: "fixture-workspace",
  actorId: "fixture-human",
  human: undefined,
  hostId: "fixture-host",
  computer: undefined,
  agents: [agent, ...allAgents],
  runtimes,
});
export function AgentModelMessagesFixture() {
  return (
    <WorkspaceEntityContext.Provider value={entities}>
      {[
        "agent",
        "human",
        "unconfigured",
        ...allAgents.map((entry) => entry.agentId),
      ].map((kind) => (
        <MessageArticle
          key={kind}
          client={client}
          message={{
            messageId: kind,
            actorId: kind,
            author: kind,
            body: "Appearance fixture message",
            createdAt: "2026-09-14T00:00:00Z",
            roomSeq: 1,
          }}
          {...(kind === "agent"
            ? { messageAgent: agent }
            : kind === "unconfigured"
              ? { messageAgent: { ...agent, modelBindingId: undefined } }
              : allAgents.some((entry) => entry.agentId === kind)
                ? {
                    messageAgent: allAgents.find(
                      (entry) => entry.agentId === kind,
                    )!,
                  }
                : {})}
        />
      ))}
    </WorkspaceEntityContext.Provider>
  );
}
