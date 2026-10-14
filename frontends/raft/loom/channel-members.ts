import type { Principal, RoomAgentActivity } from "@rah-os/protocol";

/** Labels only: membership and execution facts remain owned by the Kernel. */
export function projectChannelMembers(
  roomId: string,
  members: readonly Principal[],
  activities: readonly RoomAgentActivity[],
) {
  const current = new Map(
    activities
      .filter((entry) => entry.roomId === roomId)
      .map((entry) => [entry.participantId, entry]),
  );
  return members.map((member) => {
    const activity = current.get(member.principalId);
    const state = activity
      ? {
          idle: "空闲",
          waking: "排队或启动中",
          working: "运行中",
          error: "错误",
        }[activity.state]
      : "状态未知";
    const queued =
      activity?.queued === undefined
        ? "本频道排队未知"
        : activity.queued
          ? "本频道有排队工作"
          : "本频道无排队工作";
    return {
      id: member.principalId,
      kind: member.kind,
      name: member.displayName ?? member.handle,
      detail:
        member.kind === "human"
          ? "Human"
          : [state, queued, activity?.blocked ? "有阻塞工作，需要处理" : null]
              .filter(Boolean)
              .join(" · "),
    };
  });
}
