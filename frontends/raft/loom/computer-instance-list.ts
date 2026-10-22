import type {
  AgentCatalogEntry,
  AgentPresence,
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
  presences: readonly AgentPresence[] = [],
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
    const presence = presences.find((p) => p.agentId === instance.agentId);
    const activity =
      agent?.definition.state === "disabled" ? "offline" : presence?.activity;
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
      activity,
      stateLabel: activity
        ? {
            online: "在线",
            offline: "离线",
            working: "工作中",
            thinking: "思考中",
            error: "异常",
          }[activity]
        : "状态未知",
    };
  });
}
