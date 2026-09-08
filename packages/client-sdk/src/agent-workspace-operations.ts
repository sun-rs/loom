import * as P from "@rah-os/protocol";
import type { z } from "zod";
export const agentWorkspaceOperations = {
  "agent.skills.list": {
    input: P.AgentSkillsListRequestSchema,
    output: P.AgentSkillsListSchema,
    path: "/v3/client/agents/skills/list",
    method: "POST",
    authenticated: true,
  },
  "agent.workspace.summary": {
    input: P.AgentWorkspaceRootsRequestSchema,
    output: P.AgentWorkspaceSummarySchema,
    path: "/v3/client/agents/workspace/summary",
    method: "POST",
    authenticated: true,
  },
  "agent.workspace.roots": {
    input: P.AgentWorkspaceRootsRequestSchema,
    output: P.AgentWorkspaceRootsSchema,
    path: "/v3/client/agents/workspace/roots",
    method: "POST",
    authenticated: true,
  },
  "agent.workspace.list": {
    input: P.AgentWorkspaceListRequestSchema,
    output: P.AgentWorkspaceListSchema,
    path: "/v3/client/agents/workspace/list",
    method: "POST",
    authenticated: true,
  },
  "agent.workspace.read": {
    input: P.AgentWorkspaceReadRequestSchema,
    output: P.AgentWorkspaceFileSchema,
    path: "/v3/client/agents/workspace/read",
    method: "POST",
    authenticated: true,
  },
} as const;
export type AgentWorkspaceOperationMap = {
  [K in keyof typeof agentWorkspaceOperations]: {
    input: z.infer<(typeof agentWorkspaceOperations)[K]["input"]>;
    output: z.infer<(typeof agentWorkspaceOperations)[K]["output"]>;
  };
};
