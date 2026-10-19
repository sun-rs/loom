/** Native entity search wraps each value in `suggestion`; missing peers stay unknown. */
export function activityPeerType(
  entries: readonly {
    suggestion: {
      channelId: string | null;
      agentId: string | null;
      userId: string | null;
    };
  }[],
  roomId: string,
): "agent" | "user" | undefined {
  const peer = entries.find(
    (entry) =>
      entry.suggestion.channelId === roomId &&
      (entry.suggestion.agentId || entry.suggestion.userId),
  )?.suggestion;
  return peer?.agentId ? "agent" : peer?.userId ? "user" : undefined;
}
