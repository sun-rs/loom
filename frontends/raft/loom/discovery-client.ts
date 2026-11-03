import { RoomSession } from "@rah-os/client-core";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  Message,
  WorkspaceSearchRequest,
  HumanActivityRequest,
  Task,
} from "@rah-os/protocol";
export type DiscoveryRow = {
  id: string;
  message: Message;
  roomName: string;
  senderName: string;
  label: string;
  unread?: number;
  markedUnread?: boolean;
  activityFrontier?: { throughSeq: number; threadId?: string };
  activityKind?: "channel" | "direct" | "thread";
  replyCount?: number;
  isFollowing?: boolean;
  senderType?: "user" | "agent";
  channelType?: "channel" | "dm";
  archivedAt?: string;
  rootMessageId?: string;
  rootMessagePreview?: string;
  task?: Task;
};
export async function searchPage(
  client: RahClient,
  request: WorkspaceSearchRequest,
  signal?: AbortSignal,
) {
  const result = await client.request("search", request, { signal });
  return {
    total: result.total,
    nextCursor: result.nextCursor,
    rows: result.hits.map((hit) => ({
      id: hit.message.messageId,
      message: hit.message,
      roomName: hit.roomName,
      senderName: hit.senderName,
      label: hit.rootMessagePreview ?? hit.roomName,
      senderType:
        (hit.senderKind ??
          result.principals.find((p) => p.principalId === hit.message.actorId)
            ?.kind) === "agent"
          ? ("agent" as const)
          : ("user" as const),
      channelType:
        (hit.roomKind ??
          result.rooms.find((r) => r.roomId === hit.message.roomId)?.kind) ===
        "direct"
          ? ("dm" as const)
          : ("channel" as const),
      archivedAt:
        hit.roomArchivedAt ??
        result.rooms.find((r) => r.roomId === hit.message.roomId)?.archivedAt,
      rootMessageId: hit.rootMessageId,
      rootMessagePreview: hit.rootMessagePreview,
    })),
  };
}
export async function activityPage(
  client: RahClient,
  request: HumanActivityRequest,
  signal?: AbortSignal,
) {
  const result = await client.request("activity.list", request, { signal });
  return {
    total: result.total,
    nextCursor: result.nextCursor,
    rows: result.items.map((item) => ({
      id: item.key,
      message: item.latestMessage,
      roomName: item.roomName,
      senderName: item.senderName,
      label: item.title,
      unread: item.unreadCount,
      markedUnread: item.markedUnread,
      activityFrontier: {
        throughSeq: item.latestSeq,
        ...(item.threadId ? { threadId: item.threadId } : {}),
      },
      activityKind: item.kind,
      replyCount: item.replyCount,
      isFollowing: item.isFollowing,
      rootMessageId: item.rootMessageId,
      task: item.task,
    })),
  };
}
export type DiscoveryPageResult = {
  total: number;
  nextCursor: string | undefined;
  rows: DiscoveryRow[];
};
export async function messageContext(
  client: RahClient,
  row: DiscoveryRow,
  signal: AbortSignal,
) {
  const room = new RoomSession({
    client,
    roomId: row.message.roomId,
    consumerId: "loom-discovery-context",
  });
  const [context] = await Promise.all([
    client.request(
      "message.context",
      { roomId: row.message.roomId, messageId: row.message.messageId },
      { signal },
    ),
    room.syncUntilCurrent({ maxPages: 10, signal }),
  ]);
  // Context is a bounded server window, not an extra transcript or read acknowledgement.
  const messages = [
    ...(context.rootMessage ? [context.rootMessage] : []),
    ...context.messages,
    context.message,
  ];
  const unique = [
    ...new Map(messages.map((m) => [m.messageId, m])).values(),
  ].sort((a, b) => a.roomSeq - b.roomSeq);
  return { messages: unique, members: room.state.snapshot?.members ?? [] };
}
