import { createRoot } from "react-dom/client";
import type { RahClient } from "@rah-os/client-sdk";
import type { AgentSkillsList } from "@rah-os/protocol";
import { AgentSkillsSection } from "../src/components/agent-skills-section.tsx";
import "../src/product-styles.ts";
const scope = {
  state: "ready" as const,
  skills: [],
  truncated: false,
  issues: [],
};
const response: AgentSkillsList = {
  executionPolicyRevisionId: "fixture-policy",
  cliId: "codex",
  global: {
    ...scope,
    skills: [
      {
        name: "sample",
        displayName: "Fixture skill",
        description: "Isolated directory presentation fixture",
        sourcePath: "~/.codex/skills",
        userInvocable: false,
      },
      {
        name: "system",
        displayName: "Fixture system skill",
        description: "Independent system group",
        sourcePath: "~/.codex/skills/.system",
        userInvocable: false,
      },
    ],
  },
  workspace: scope,
};
const client = { request: async () => response } as unknown as RahClient;
createRoot(document.getElementById("root")!).render(
  <div className="rah-product-shell" data-conversation-layout="single">
    <AgentSkillsSection
      client={client}
      agentDefinitionId="fixture"
      executionPolicyRevisionId="fixture-policy"
    />
  </div>,
);
