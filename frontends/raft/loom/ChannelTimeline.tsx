import { MessageProfileMembers } from "./MessageProfile.tsx";
import { projectMentionMembers } from "./member-roster.ts";
import type { Principal, Thread } from "@rah-os/protocol";
import type { Agent } from "../packages/web/src/store/agentStore.ts";
import type { ServerMember } from "../packages/web/src/store/serverStore.ts";
import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import MessageTimeline, {
  type MessageTimelineHandle,
} from "../packages/web/src/components/message/MessageTimeline.tsx";
import MessageItem from "../packages/web/src/components/message/MessageItem.tsx";
import { DateDivider } from "../packages/web/src/components/message/DateDivider.tsx";
import {
  useStableMessageGrouping,
  followedByFor,
  followsSystemFor,
} from "../packages/web/src/components/message/messageGrouping.ts";
import { buildSystemMessageRenderStates } from "../packages/web/src/components/message/systemMessageGrouping.ts";
import ThreadPanelSystemMessageGroupDisclosure from "../packages/web/src/components/message/ThreadPanelSystemMessageGroupDisclosure.tsx";
import { useTimeFormatter } from "../packages/web/src/hooks/useTimeFormatter.ts";
import type { Message } from "../packages/web/src/store/messageStore.ts";
const mentionMap = new Map();

/** ChatPanel's native system-row/disclosure composition; Loom owns only the read source. */
export default function ChannelTimeline({
  roomId,
  focusId,
  hasNewer = false,
  loadNewer = async () => {},
  messages,
  members,
  hasOlder,
  loading,
  loadOlder,
  onOpenProfile,
  onOpenThread,
  threads = [],
}: {
  roomId: string;
  focusId?: string;
  hasNewer?: boolean;
  loadNewer?: () => Promise<void>;
  messages: Message[];
  members: readonly Principal[];
  hasOlder: boolean;
  loading: boolean;
  loadOlder: () => Promise<void>;
  threads?: readonly Thread[];
  onOpenThread?: (rootMessageId: string, focusedMessageId?: string) => void;
  onOpenProfile?: (type: "agent" | "human", id: string) => void;
}) {
  const roster = useMemo(() => projectMentionMembers(members), [members]);
  const { options } = useTimeFormatter();
  const { formatMessage } = useIntl();
  const grouping = useStableMessageGrouping(
    messages,
    options.timeZone ?? undefined,
    useMemo(() => new Set(threads.map((t) => t.rootMessageId)), [threads]),
  );
  const systems = useMemo(
    () => buildSystemMessageRenderStates(messages, formatMessage),
    [messages, formatMessage],
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const timeline = useRef<MessageTimelineHandle>(null);
  const toggle = useCallback((id: string) => {
    timeline.current?.preserveAnchorOnNextLayoutChange();
    setExpanded((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const item = (message: Message, index: number) => (
    <MessageItem
      message={message}
      threadSearchActive={message.id === focusId}
      groupState={grouping.get(message.id)}
      followedBy={followedByFor(messages, index, grouping)}
      followsSystem={followsSystemFor(messages, index)}
      mentionMap={mentionMap}
      channels={[]}
      readOnlyProjection
      onOpenProfile={onOpenProfile}
      // Bounded identity-only previews; never publish these into official runtime stores.
      previewSenderAgent={
        roster.agents.find((p) => p.id === message.senderId) as
          Agent | undefined
      }
      previewSenderMember={(() => {
        const p = roster.humans.find((p) => p.id === message.senderId);
        if (!p) return undefined;
        const { id, ...profile } = p;
        return { ...profile, userId: id } as ServerMember;
      })()}
      readOnlySender={{
        displayName: message.senderDisplayName ?? "成员",
        avatarUrl: null,
        description: null,
      }}
      onOpenThread={
        onOpenThread
          ? (request) =>
              onOpenThread(
                request.parentMessageId,
                request.focusedMessageId ?? undefined,
              )
          : undefined
      }
      threadSummary={(() => {
        const t = threads.find((t) => t.rootMessageId === message.id);
        return t
          ? {
              threadChannelId: t.threadId,
              replyCount: t.replyCount,
              lastReplyAt: t.lastReplyAt ?? null,
              participantIds: t.viewerSummary?.participantIds ?? [],
              unreadCount: t.viewerSummary?.unreadCount ?? 0,
              firstUnreadMessageId:
                t.viewerSummary?.firstUnreadMessageId ?? null,
            }
          : undefined;
      })()}
      hideThreadActions={!onOpenThread}
    />
  );
  return (
    <MessageProfileMembers.Provider value={members}>
      <MessageTimeline
        ref={timeline}
        source={{
          messages,
          hasOlder,
          hasNewer,
          initialFocusMessageId: focusId,
          sentinelAutoLoadBlockKey: focusId,
          loading,
          loadOlder,
          loadNewer,
        }}
        renderItem={(message, index) => {
          const system = systems[index];
          if (system?.kind === "hide") return null;
          if (system?.kind === "summary")
            return (
              <div
                className="px-3"
                style={{ contain: "layout style", overflow: "clip visible" }}
              >
                <ThreadPanelSystemMessageGroupDisclosure
                  summary={system.content}
                  expanded={expanded.has(system.groupId)}
                  groupId={system.groupId}
                  onToggleGroup={toggle}
                >
                  {system.messageIndexes.map((i) => (
                    <Fragment key={messages[i]!.id}>
                      {item(messages[i]!, i)}
                    </Fragment>
                  ))}
                </ThreadPanelSystemMessageGroupDisclosure>
              </div>
            );
          return (
            <>
              {grouping.get(message.id)?.showDayDivider && (
                <DateDivider createdAt={message.createdAt} />
              )}
              <div
                className="px-3"
                style={{ contain: "layout style", overflow: "clip visible" }}
              >
                {item(message, index)}
              </div>
            </>
          );
        }}
        className="h-full"
        testId="loom-message-timeline"
        persistKey={`loom-channel:${roomId}`}
        sparseAnchor="top"
      />
    </MessageProfileMembers.Provider>
  );
}
