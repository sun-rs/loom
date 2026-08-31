import {
  AgentWorkspaceListRequestSchema,
  AgentWorkspaceReadRequestSchema,
  AgentWorkspaceListSchema,
  AgentWorkspaceFileSchema,
  type AgentWorkspaceFile,
  type AgentWorkspaceListing,
} from "@rah-os/protocol";
import type {
  HumanApplicationPort,
  AuthenticatedActorContext,
} from "@rah-os/kernel";
import type { ZodType } from "zod";
export type AgentWorkspaceReadPort = {
  list(
    owner: string,
    path: string,
    includeHidden: boolean,
  ): Promise<AgentWorkspaceListing>;
  read(owner: string, path: string): Promise<AgentWorkspaceFile>;
};
export const AGENT_WORKSPACE_PATHS = [
  "/agents/workspace/list",
  "/agents/workspace/read",
];
export async function routeAgentWorkspace(
  human: HumanApplicationPort,
  actor: AuthenticatedActorContext,
  path: string,
  body: Record<string, unknown>,
  port: AgentWorkspaceReadPort | undefined,
  parse: <T>(schema: ZodType<T>, body: Record<string, unknown>) => T,
) {
  const input = path.endsWith("/list")
    ? parse(AgentWorkspaceListRequestSchema, body)
    : parse(AgentWorkspaceReadRequestSchema, body);
  const authorize = () =>
    human.getWorkspaceAgentManagementView(actor, input.agentDefinitionId).agent
      .definition.participantId;
  const owner = authorize();
  if (!port) throw new Error("此 Computer 尚未提供 Agent 工作区浏览能力");
  const result =
    "includeHidden" in input
      ? AgentWorkspaceListSchema.parse(
          await port.list(owner, input.path, input.includeHidden === true),
        )
      : AgentWorkspaceFileSchema.parse(await port.read(owner, input.path));
  // Do not release file content after management access was revoked during I/O.
  if (authorize() !== owner)
    throw new Error("Agent workspace owner changed during read");
  return result;
}
