import type { MembershipRole, Principal, RoomKind } from "@rah-os/protocol";

const HUMAN_ROOM_ROLES = ["owner", "admin", "member"] as const;
const AGENT_ROOM_ROLES = ["member"] as const;

/** Raft edits a server-wide Human role from HumanDetailPanel. RAH OS has no
 * central Server identity, so the structural port targets the canonical Room
 * membership owner. Agent execution authority remains a separate Policy and
 * must never be granted by this presentation helper. */
export function roomMemberRoleOptions(
  subjectKind: Principal["kind"],
): readonly MembershipRole[] {
  return subjectKind === "human" ? HUMAN_ROOM_ROLES : AGENT_ROOM_ROLES;
}

export function canEditRoomMemberRole(input: {
  actorRole: MembershipRole | undefined;
  caughtUp: boolean;
  memberWrite: boolean;
  subjectKind: Principal["kind"];
}): boolean {
  return (
    input.actorRole === "owner" &&
    input.caughtUp &&
    input.memberWrite &&
    input.subjectKind === "human"
  );
}

export function canHumanLeaveRoom(input: {
  archived: boolean;
  caughtUp: boolean;
  memberWrite: boolean;
  ownerCount: number;
  role: MembershipRole | undefined;
  roomKind: RoomKind | undefined;
}): { allowed: boolean; reason?: string } {
  if (input.roomKind !== "channel") {
    return { allowed: false, reason: "只有普通频道支持退出" };
  }
  if (input.archived) {
    return { allowed: false, reason: "已归档频道不能退出" };
  }
  if (input.role === undefined) {
    return { allowed: false, reason: "当前 Human 不是此频道成员" };
  }
  if (!input.memberWrite) {
    return { allowed: false, reason: "daemon 未开放成员变更能力" };
  }
  if (!input.caughtUp) {
    return { allowed: false, reason: "Room 尚未追赶到最新位置" };
  }
  if (input.role === "owner" && input.ownerCount <= 1) {
    return {
      allowed: false,
      reason: "最后一名所有者需要先把其他 Human 设为所有者",
    };
  }
  return { allowed: true };
}

export function roomMemberRoleLabel(role: MembershipRole): string {
  return role === "owner" ? "所有者" : role === "admin" ? "管理员" : "成员";
}
