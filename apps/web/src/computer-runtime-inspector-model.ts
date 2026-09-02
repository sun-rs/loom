import type {
  LocalComputerObservation,
  LocalRuntimeInventoryEntry,
} from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";

export const RAFT_RUNTIME_INSPECTOR_OPEN_DELAY_MS = 200;
export const RAFT_RUNTIME_INSPECTOR_CLOSE_DELAY_MS = 160;
export const RAFT_RUNTIME_INSPECTOR_WIDTH = 390;

export function runtimeInspectorRows(
  runtime: LocalRuntimeInventoryEntry,
): Array<{ label: string; value: string }> {
  return [
    { label: "版本", value: runtime.version ?? "版本未知" },
    {
      label: "可执行文件",
      value: runtime.resolvedExecutablePath ?? runtime.executable,
    },
    {
      label: "Runtime Profile",
      value: runtime.runtimeProfileId ?? "未配置",
    },
    { label: "Offer", value: runtime.runtimeOfferId ?? "未发布" },
    {
      label: "已验证模型",
      value: String(
        runtime.modelBindingDescriptors.filter(
          (descriptor) => descriptor.evidence !== "declared",
        ).length,
      ),
    },
    { label: "绑定 Agent", value: String(runtime.agentBindings.length) },
  ];
}

export function localComputerDiagnosticText(input: {
  agents: readonly WorkspaceAgentView[];
  computer: LocalComputerObservation | undefined;
  hostId: string;
  runtimes: readonly LocalRuntimeInventoryEntry[];
}): string {
  const computer = input.computer;
  const boundAgentDefinitionIds = new Set(
    input.runtimes.flatMap((runtime) =>
      runtime.agentBindings.map(({ agentDefinitionId }) => agentDefinitionId),
    ),
  );
  return JSON.stringify(
    {
      computer:
        computer === undefined
          ? undefined
          : {
              displayName: computer.displayName,
              hostname: computer.hostname,
              ...(computer.lastSeenAt === undefined
                ? {}
                : { lastSeenAt: computer.lastSeenAt }),
              observedAt: computer.observedAt,
              os: computer.os,
              status: computer.status,
              ...(computer.buildVersion === undefined
                ? {}
                : { buildVersion: computer.buildVersion }),
            },
      hostId: input.hostId,
      agents: input.agents
        .filter(({ agentDefinitionId }) =>
          boundAgentDefinitionIds.has(agentDefinitionId),
        )
        .map((agent) => ({
          agentDefinitionId: agent.agentDefinitionId,
          displayName: agent.displayName,
          handle: agent.handle,
          runtimeAvailable: agent.runtimeAvailable,
          state: agent.state,
        })),
      runtimes: input.runtimes.map((runtime) => ({
        available: runtime.available,
        configured: runtime.configured,
        displayName: runtime.displayName,
        executable: runtime.executable,
        ...(runtime.runtimeOfferId === undefined
          ? {}
          : { runtimeOfferId: runtime.runtimeOfferId }),
        ...(runtime.runtimeProfileId === undefined
          ? {}
          : { runtimeProfileId: runtime.runtimeProfileId }),
        ...(runtime.version === undefined ? {} : { version: runtime.version }),
      })),
    },
    null,
    2,
  );
}
