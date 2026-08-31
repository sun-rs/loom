import type { LocalComputerObservation } from "@rah-os/protocol";

export function agentConnectionLabel(agent: {
  state: string;
  runtimeAvailable: boolean;
  connectionStatus?: LocalComputerObservation["status"];
}): string {
  if (agent.state === "tombstoned") return "已删除";
  if (agent.state !== "enabled") return "已暂停";
  if (agent.connectionStatus === "offline") return "离线";
  if (agent.connectionStatus === "draining") return "正在停止";
  if (agent.connectionStatus !== "online") return "状态未知";
  return agent.runtimeAvailable ? "在线" : "不可用";
}

export const visibleNavigationDot = (unread: boolean, active: boolean) =>
  unread && !active;
export function computerStatusLabel(
  computer: Pick<LocalComputerObservation, "status"> | undefined,
): string {
  return computer?.status === "online"
    ? "已连接"
    : computer?.status === "offline"
      ? "离线"
      : computer?.status === "draining"
        ? "正在停止"
        : "状态未知";
}
export type SystemNotice = {
  id: string;
  title: string;
  body: string;
  target: "computers";
};
export function computerAttention(
  hostId: string | undefined,
  computer: LocalComputerObservation | undefined,
): SystemNotice[] {
  if (!hostId || !computer || computer.status !== "offline") return [];
  // lastSeen is stable during an outage; a new successful heartbeat creates a new episode.
  // observedAt must never enter the identity (it changes on every poll).
  return [
    {
      id: `computer-offline:${hostId}:${computer.instanceId ?? "unknown"}:${computer.lastSeenAt ?? "unknown"}`,
      title: `${computer.displayName} 离线`,
      body: "这台 Computer 的心跳已停止。请检查该机器上的 RAH OS 服务；CLI 是否已安装不代表连接状态。",
      target: "computers",
    },
  ];
}
