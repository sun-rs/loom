// Native eff04722 ActivityConversationSwipe and RaftPullToRefreshController semantic port.
export function nativePullOffset(pull: number, dimension: number) {
  return pull > 0 && dimension > 0
    ? (1 - 1 / ((pull * 0.55) / dimension + 1)) * dimension
    : 0;
}
export function activityReadToggle(row: {
  activityFrontier?: unknown;
  activityKind?: string;
  isFollowing?: boolean;
  unread?: number;
  markedUnread?: boolean;
}): "read" | "unread" | undefined {
  if (
    !row.activityFrontier ||
    (row.activityKind === "thread" && row.isFollowing !== true)
  )
    return;
  return (row.unread ?? 0) > 0 || row.markedUnread ? "read" : "unread";
}
