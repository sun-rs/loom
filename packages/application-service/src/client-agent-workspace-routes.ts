import {
  AgentSkillsListSchema,
  AgentSkillsListRequestSchema,
  type AgentSkillsList,
  type ExecutionPolicyRevision,
  AgentWorkspaceSummarySchema,
  type AgentWorkspaceSummary,
  AgentWorkspaceListRequestSchema,
  AgentWorkspaceReadRequestSchema,
  AgentWorkspaceRootsRequestSchema,
  AgentWorkspaceListSchema,
  AgentWorkspaceFileSchema,
  AgentWorkspaceRootsSchema,
  type AgentWorkspaceFile,
  type AgentWorkspaceListing,
  type AgentWorkspaceRoot,
  type AgentWorkspaceRoots,
} from "@rah-os/protocol";
import type {
  HumanApplicationPort,
  AuthenticatedActorContext,
} from "@rah-os/kernel";
import type { ZodType } from "zod";
export type AgentWorkspaceReadPort = {
  skills?(
    owner: string,
    policy: ExecutionPolicyRevision,
  ): Promise<AgentSkillsList>;
  summary?(owner: string): Promise<AgentWorkspaceSummary>;
  roots(owner: string): Promise<AgentWorkspaceRoots>;
  list(
    owner: string,
    rootId: AgentWorkspaceRoot["rootId"],
    path: string,
    includeHidden: boolean,
  ): Promise<AgentWorkspaceListing>;
  read(
    owner: string,
    rootId: AgentWorkspaceRoot["rootId"],
    path: string,
  ): Promise<AgentWorkspaceFile>;
};
export const AGENT_WORKSPACE_PATHS = [
  "/agents/skills/list",
  "/agents/workspace/roots",
  "/agents/workspace/summary",
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
  if (!port) throw new Error("此 Computer 尚未提供 Agent 工作区浏览能力");
  if (path === "/agents/skills/list") {
    const input = parse(AgentSkillsListRequestSchema, body);
    const skills = port.skills;
    if (!skills) throw new Error("此 Computer 尚未提供 Skills 读取能力");
    const view = human.getWorkspaceAgentManagementView(actor, input.agentId);
    const result = await authorizedResult(
      human,
      actor,
      input.agentId,
      async (owner) =>
        AgentSkillsListSchema.parse(await skills(owner, view.policy)),
    );
    if (
      human.getWorkspaceAgentManagementView(actor, input.agentId).policy
        .executionPolicyRevisionId !== view.policy.executionPolicyRevisionId
    )
      throw new Error(
        "Agent runtime configuration changed while reading Skills; retry with current configuration",
      );
    return result;
  }
  if (path.endsWith("/summary")) {
    const input = parse(AgentWorkspaceRootsRequestSchema, body);
    const summary = port.summary;
    if (!summary) throw new Error("此 Computer 尚未提供工作区扫描能力");
    return authorizedResult(human, actor, input.agentId, async (owner) =>
      AgentWorkspaceSummarySchema.parse(await summary(owner)),
    );
  }
  if (path.endsWith("/roots")) {
    const input = parse(AgentWorkspaceRootsRequestSchema, body);
    return authorizedResult(human, actor, input.agentId, async (owner) =>
      AgentWorkspaceRootsSchema.parse(await port.roots(owner)),
    );
  }
  if (path.endsWith("/list")) {
    const input = parse(AgentWorkspaceListRequestSchema, body);
    return authorizedResult(human, actor, input.agentId, async (owner) =>
      AgentWorkspaceListSchema.parse(
        await port.list(
          owner,
          input.rootId,
          input.path,
          input.includeHidden === true,
        ),
      ),
    );
  }
  const input = parse(AgentWorkspaceReadRequestSchema, body);
  return authorizedResult(human, actor, input.agentId, async (owner) =>
    AgentWorkspaceFileSchema.parse(
      await port.read(owner, input.rootId, input.path),
    ),
  );
}

async function authorizedResult<T>(
  human: HumanApplicationPort,
  actor: AuthenticatedActorContext,
  agentId: string,
  read: (owner: string) => Promise<T>,
): Promise<T> {
  const authorize = () =>
    human.getWorkspaceAgentManagementView(actor, agentId).agent.definition
      .participantId;
  const owner = authorize();
  const result = await read(owner);
  // Do not release file content after management access was revoked during I/O.
  if (authorize() !== owner)
    throw new Error("Agent workspace owner changed during read");
  return result;
}
