import type {
  AgentCatalogEntry,
  LocalRuntimeInventoryResponse,
  RoleListResponse,
} from "@rah-os/protocol";
import { computerInstances } from "./role-presence.ts";
export const COMPUTER_INSTANCE_PREVIEW_COUNT = 6;
export function visibleComputerInstances<T>(
  rows: readonly T[],
  expanded: boolean,
) {
  return expanded ? rows : rows.slice(0, COMPUTER_INSTANCE_PREVIEW_COUNT);
}
export function computerInstanceRows(
  runtimes: LocalRuntimeInventoryResponse["runtimes"],
  instances: RoleListResponse["instances"],
  agents: readonly AgentCatalogEntry[],
) {
  return computerInstances(runtimes, instances).map((instance) => {
    const agent = agents.find((a) => a.definition.agentId === instance.agentId);
    const runtime = runtimes.find((r) =>
      r.agentBindings.some(
        (b) =>
          b.agentId === instance.agentId &&
          b.participantId === instance.instanceId,
      ),
    );
    const model = runtime?.modelBindingDescriptors.find(
      (b) => b.modelBindingId === agent?.modelBindingId,
    );
    return {
      ...instance,
      name: agent?.currentRevision.displayName ?? instance.name,
      avatarKey: agent?.currentRevision.avatarKey,
      subtitle: [
        runtime?.displayName ?? "运行时未知",
        model?.displayName ??
          model?.modelId ??
          agent?.modelBindingId ??
          "模型未指定",
      ].join(" · "),
      stateLabel:
        agent?.definition.state === "disabled"
          ? "已停止"
          : agent?.definition.state === "enabled"
            ? "已启用"
            : "状态未知",
    };
  });
}
