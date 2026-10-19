// Data adapter only: render the unchanged official MessageHitRow.
import { useEffect, useRef } from "react";
import { MessageHitRow } from "../packages/web/src/components/search/MessageHitRow.tsx";
import type { DiscoveryRow } from "./discovery-client.ts";
export default function SearchMessageRow({
  row,
  query,
  selected,
  nested = false,
  onOpen,
}: {
  row: DiscoveryRow;
  query: string;
  selected: boolean;
  nested?: boolean;
  onOpen: (full: boolean) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <MessageHitRow
      resultKey={row.id}
      result={{
        id: row.message.messageId,
        channelId: row.message.roomId,
        threadId: row.message.threadId ?? null,
        parentMessageId: row.rootMessageId ?? null,
        parentMessageContent: row.rootMessagePreview ?? null,
        parentChannelId: row.message.roomId,
        parentChannelName: row.roomName,
        parentChannelType: row.channelType ?? "channel",
        parentChannelArchivedAt: row.archivedAt ?? null,
        senderId: row.message.actorId,
        senderType: row.senderType ?? "user",
        senderName: row.senderName,
        senderAvatarUrl: null,
        channelName: row.roomName,
        channelType: row.message.threadId
          ? "thread"
          : (row.channelType ?? "channel"),
        channelArchivedAt: row.archivedAt ?? null,
        content: row.message.body,
        snippet: row.message.body || "附件消息",
        createdAt: row.message.createdAt,
      }}
      nested={nested}
      selected={selected}
      sourceLabel={`${row.channelType === "dm" ? "@" : "#"}${row.roomName}`}
      agentAvatarUrl={null}
      senderMember={null}
      historyCutoffMs={null}
      query={query}
      onResultClick={(event) => {
        clearTimeout(timer.current);
        if (event.detail >= 2) onOpen(true);
        else timer.current = setTimeout(() => onOpen(false), 220);
      }}
    />
  );
}
