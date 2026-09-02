const roomKey = (roomId: string) => `room:${roomId}`;

export function roomActivityMuted(
  mutedActivity: readonly string[] | undefined,
  roomId: string,
) {
  return mutedActivity?.includes(roomKey(roomId)) ?? false;
}

export function roomAllMessagesNotified(
  notifyAllMessages: readonly string[] | undefined,
  roomId: string,
) {
  return notifyAllMessages?.includes(roomKey(roomId)) ?? false;
}

export function roomLongMessagesCollapsed(
  expandedLongMessages: readonly string[] | undefined,
  roomId: string,
) {
  return !(expandedLongMessages?.includes(roomKey(roomId)) ?? false);
}

export function setRoomPreference(
  current: readonly string[],
  roomId: string,
  enabled: boolean,
) {
  const key = roomKey(roomId);
  if (enabled) return current.includes(key) ? [...current] : [...current, key];
  return current.filter((candidate) => candidate !== key);
}
