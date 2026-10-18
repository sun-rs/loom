import type { HumanActivityResponse } from "@rah-os/protocol";
export type NavigationUnread = {
  workspaceId: string;
  channels: boolean;
  activity: boolean;
};
/** Presentation only: the existing sidebar request owns the authoritative summary read. */
export function navigationUnread(
  workspaceId: string,
  summary: HumanActivityResponse["summary"],
): NavigationUnread | undefined {
  if (!summary) return undefined;
  return {
    workspaceId,
    channels: summary.rooms.some((room) => room.unreadCount > 0),
    activity: summary.unreadActivityCount > 0,
  };
}
