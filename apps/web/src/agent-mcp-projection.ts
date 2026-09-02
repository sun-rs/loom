import type {
  ManagedMcpAssignmentRecord,
  ManagedMcpServerRecord,
  ManagedMcpUsageRecord,
} from "@rah-os/protocol";

export type AgentMcpServerView = {
  assignmentEnabled: boolean;
  failedCount: number;
  lastUsedAt: string;
  mcpServerId: string;
  serverEnabled: boolean;
  serverName: string;
  tools: Array<{
    description: string | undefined;
    title: string | undefined;
    toolName: string;
    usageCount: number;
  }>;
  usageCount: number;
};

export function projectAgentMcpServers(
  servers: readonly ManagedMcpServerRecord[],
  assignments: readonly ManagedMcpAssignmentRecord[],
  calls: readonly ManagedMcpUsageRecord[],
): AgentMcpServerView[] {
  const assignmentByServer = new Map(
    assignments.map((assignment) => [assignment.mcpServerId, assignment]),
  );
  const callsByServer = new Map<string, ManagedMcpUsageRecord[]>();
  for (const call of calls) {
    const current = callsByServer.get(call.mcpServerId) ?? [];
    current.push(call);
    callsByServer.set(call.mcpServerId, current);
  }
  return servers
    .flatMap((server): AgentMcpServerView[] => {
      const assignment = assignmentByServer.get(server.mcpServerId);
      const serverCalls = callsByServer.get(server.mcpServerId) ?? [];
      if (assignment === undefined || serverCalls.length === 0) return [];
      const usageByTool = new Map<string, number>();
      for (const call of serverCalls) {
        usageByTool.set(
          call.toolName,
          (usageByTool.get(call.toolName) ?? 0) + 1,
        );
      }
      const allowedTools = new Set(assignment.allowedToolNames);
      return [
        {
          assignmentEnabled: assignment.enabled,
          failedCount: serverCalls.filter(({ state }) => state === "failed")
            .length,
          lastUsedAt: serverCalls.reduce(
            (latest, call) =>
              call.createdAt > latest ? call.createdAt : latest,
            serverCalls[0]!.createdAt,
          ),
          mcpServerId: server.mcpServerId,
          serverEnabled: server.state === "enabled",
          serverName: server.definition.serverName,
          tools: server.definition.tools
            .filter(({ toolName }) => allowedTools.has(toolName))
            .map((tool) => ({
              description: tool.description,
              title: tool.title,
              toolName: tool.toolName,
              usageCount: usageByTool.get(tool.toolName) ?? 0,
            })),
          usageCount: serverCalls.length,
        },
      ];
    })
    .sort(
      (left, right) =>
        right.lastUsedAt.localeCompare(left.lastUsedAt) ||
        left.serverName.localeCompare(right.serverName),
    );
}
