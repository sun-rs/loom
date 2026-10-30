import type { InstanceAvatarMap } from "./role-avatar-projection.ts";
import { roleAvatarUrl } from "./profile-avatar.ts";
import type { SavedEntry } from "../packages/web/src/store/savedStore.ts";
import type { SavedResult } from "./useSavedMessages.ts";
export function savedEntry(
  row: SavedResult["items"][number],
  avatars: InstanceAvatarMap = {},
): SavedEntry {
  const m = row.message,
    thread = !!m.threadId;
  return {
    messageId: m.messageId,
    channelId: m.roomId,
    channelName: row.roomName,
    channelType: thread
      ? "thread"
      : row.roomKind === "channel"
        ? "channel"
        : "dm",
    content: m.body,
    senderType: row.sender.kind === "agent" ? "agent" : "user",
    senderId: row.sender.principalId,
    senderName: row.senderName,
    senderAvatarUrl: roleAvatarUrl(
      avatars[row.sender.principalId] ?? row.sender.avatarKey ?? null,
    ),
    createdAt: m.createdAt,
    savedAt: row.savedAt,
    parentChannelId: thread ? m.roomId : null,
    parentChannelName: thread ? row.roomName : null,
    parentChannelType: thread
      ? row.roomKind === "channel"
        ? "channel"
        : "dm"
      : null,
    parentMessageId: row.rootMessageId ?? null,
  };
}
