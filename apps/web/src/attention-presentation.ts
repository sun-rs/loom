import type { AgentPresence, LocalComputerObservation } from "@rah-os/protocol";

type PresenceSubject = {
  state: string;
  runtimeAvailable: boolean;
  connectionStatus?: LocalComputerObservation["status"];
  presence?: AgentPresence;
};

export type SidebarRoomAttention = {
  unreadCount: number;
  hasMention: boolean;
};

/**
 * Raft sidebar attention contract: channel mention attention is independent
 * from its unread count, while Direct Rooms only expose the unread count.
 */
export function sidebarRoomAttention(
  kind: "channel" | "direct",
  value: SidebarRoomAttention | undefined,
  quiet = false,
) {
  const unreadCount = Math.max(0, Math.floor(value?.unreadCount ?? 0));
  return {
    showMention: kind === "channel" && value?.hasMention === true,
    showMuted: kind === "channel" && quiet,
    unreadCount,
    unreadTone:
      kind === "channel" && quiet ? ("quiet" as const) : ("loud" as const),
  };
}

export const RAFT_LIVE_ACTIVITY_TTL_MS = 90_000;

export function agentPresencePresentation(agent: PresenceSubject) {
  const fallback = (label: string) => ({
    activity: "offline" as const,
    label,
    pulse: false,
  });
  if (agent.state === "tombstoned") return fallback("已删除");
  if (agent.state !== "enabled") return fallback("已暂停");
  const presence = agent.presence;
  if (!presence) {
    if (agent.connectionStatus === "offline") return fallback("离线");
    if (agent.connectionStatus === "draining") return fallback("正在停止");
    return fallback("状态未知");
  }
  const labels: Record<AgentPresence["reason"], string> = {
    idle: "休眠 · 等待唤醒",
    online: "在线",
    starting: "正在启动",
    working: "工作中…",
    thinking: "思考中…",
    error: "运行异常",
    paused: "已暂停",
    host_offline: "Computer 离线",
    host_draining: "Computer 正在停止",
    unknown: "状态未知",
  };
  return {
    activity: presence.activity,
    label: labels[presence.reason],
    pulse: presence.activity === "thinking" || presence.activity === "working",
  };
}

export function agentConnectionLabel(agent: PresenceSubject): string {
  return agentPresencePresentation(agent).label;
}

/** Port of Raft O1/qj: newest Workspace thinking/working activity, expiring after 90s. */
export function latestWorkspaceActivity<T extends PresenceSubject>(
  agents: readonly T[],
  now = Date.now(),
) {
  let latest:
    | {
        agent: T;
        activityAt: number;
        expiresAt: number;
        presentation: ReturnType<typeof agentPresencePresentation>;
      }
    | undefined;
  for (const agent of agents) {
    const presentation = agentPresencePresentation(agent);
    if (
      presentation.activity !== "thinking" &&
      presentation.activity !== "working"
    )
      continue;
    const activityAt = Date.parse(agent.presence?.activityAt ?? "");
    if (
      !Number.isFinite(activityAt) ||
      activityAt > now ||
      now - activityAt >= RAFT_LIVE_ACTIVITY_TTL_MS ||
      (latest && latest.activityAt >= activityAt)
    )
      continue;
    latest = {
      agent,
      activityAt,
      expiresAt: activityAt + RAFT_LIVE_ACTIVITY_TTL_MS,
      presentation,
    };
  }
  return latest;
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
