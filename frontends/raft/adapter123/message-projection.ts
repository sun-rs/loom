import type { Message, Principal } from "@rah-os/protocol";
/** Canonical IDs, message sequence and mention bindings survive the transport rename. */
export function nativeMessage(message: Message, members: readonly Principal[]) {
  const author = members.find((p) => p.principalId === message.actorId),
    name = author?.displayName ?? author?.handle ?? "已离开的成员";
  return {
    id: message.messageId,
    channelId: message.roomId,
    seq: message.roomSeq,
    senderId: message.actorId,
    senderType: author?.kind === "agent" ? "agent" : "user",
    senderName: name,
    senderDisplayName: name,
    content: message.body,
    createdAt: message.createdAt,
    attachments: message.attachments?.map((a) => ({
      id: a.attachmentId,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.size,
    })),
    mentions: message.mentions?.map((m) => ({
      type: m.agentId ? "agent" : "user",
      id: m.principalId,
      name: m.handle,
    })),
  };
}
