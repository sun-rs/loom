import type { Principal, Thread } from "@rah-os/protocol";
import { hydrateThreadRepliesScope } from "../packages/web/src/store/threadRepliesReadModel.ts";
import { roleAvatarUrl } from "./profile-avatar.ts";

/** Snapshot projection only; native renderer owns layout, count and latest-N presentation. */
export function nativeThreadReplyScope(
  thread: Thread | undefined,
  members: readonly Principal[],
) {
  const previews = thread?.viewerSummary?.previews;
  if (!thread || !previews) return undefined;
  return hydrateThreadRepliesScope(
    previews.map((reply) => {
      const member = members.find((p) => p.principalId === reply.actorId);
      return {
        messageId: reply.messageId,
        seq: reply.roomSeq,
        preview: reply.preview,
        senderId: reply.actorId,
        senderType:
          reply.senderKind === "agent" ? ("agent" as const) : ("user" as const),
        senderName: reply.senderName,
        senderDisplayName: member?.displayName ?? reply.senderName,
        senderAvatarUrl: roleAvatarUrl(member?.avatarKey ?? null),
        createdAt: reply.createdAt,
      };
    }),
    thread.replyCount,
    { parentMessageId: thread.rootMessageId, threadChannelId: thread.threadId },
  );
}
