// GENERATED from immutable Raft db5e399. Explicit Loom snapshot/window bindings; do not edit.
import {useMemo,useCallback,type ReactNode} from "react";
import {useIntl} from "react-intl";
import {X} from "lucide-react";
import {PanelAction,PanelMeta,PanelTitle,ThreadIcon,ThreadPanelBody,ThreadPanelContent,ThreadPanelRoot} from "raft-ui";
import type {Message} from "../packages/web/src/store/messageStore";
import type {Channel} from "../packages/web/src/store/channelStore";
import MessageItem,{type ReadOnlySenderProjection} from "../packages/web/src/components/message/MessageItem";
import MessageTimeline,{type MessageTimelineSource} from "./OfficialMessageTimeline.generated";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader";
import Tooltip from "@loom/raft-web-source/Tooltip";
import Banner from "@loom/raft-web-source/Banner";
import EmptyState from "@loom/raft-web-source/EmptyState";
import {useMessageMentionMap} from "./MessageProfile";
export interface ReadOnlyThreadData {
  threadChannelId: string;
  parentChannelId: string;
  parentMessage: Message;
  replies: Message[];
  senderByMessageId: ReadonlyMap<string, ReadOnlySenderProjection>;
  channels: Channel[];
  loading: boolean;
  error: string;
  hasOlder: boolean;
  loadOlder: () => void | Promise<void>;
}
export interface ThreadPanelProps {
  /** Optional host-owned channel-column layout action. */
  canToggleChannel?: () => boolean;
  channelCollapsed?: boolean;
  onToggleChannel?: () => void;
  presentation?: "side" | "modal" | "mobile-modal";
  onClose?: () => void;
  threadIdentity?: {
    parentMessageId: string;
    parentChannelId: string;
    threadChannelId: string | null;
    focusedMessageId?: string | null;
  };
  onFocusedMessageConsumed?: () => void;
  onOpenProfile?: (kind: "agent" | "human", id: string) => void;
  showComposer?: boolean;
  overlayComposer?: boolean;
  mobilePage?: boolean;
  composerAutoFocus?: boolean;
  hideHeader?: boolean;
  hideParentMessage?: boolean;
  parentSlot?: ReactNode;
  /** Narrow public snapshot. Supplying it mounts no authenticated thread
   * store, socket, task, member, or message data source. */
  readOnlyData?: ReadOnlyThreadData;
  loomFooter?: ReactNode;
  loomHeaderActions?: ReactNode;
  loomOnOpenProfile?: (kind: "agent" | "human", id: string) => void;
  loomFocusId?: string;
  loomHasNewer?: boolean;
  loomLoadNewer?: () => Promise<void>;
}
const READ_ONLY_THREAD_PANEL_CLASS_NAME = "isolate flex h-full min-h-0 w-full flex-col bg-layer-canvas";

const READ_ONLY_THREAD_BODY_CLASS_NAME = "relative z-0 min-h-0 flex-1 overflow-hidden";

const THREAD_PANEL_PARENT_CLASS_NAME = "border-b border-line-hairline bg-layer-canvas px-3 pt-5 pb-3";

const THREAD_CHROME_LAYER_CLASS_NAME = "relative z-20 shrink-0";

const THREAD_HEADER_CONTAINER_CLASS_NAME = THREAD_CHROME_LAYER_CLASS_NAME;

const THREAD_HEADER_SUBTITLE_CLASS_NAME = "truncate";

const READ_ONLY_THREAD_HEADER_CONTAINER_PROPS = { className: THREAD_HEADER_CONTAINER_CLASS_NAME };

const THREAD_MOBILE_BACK_PROPS = { "data-testid": "thread-mobile-back" } as const;

function ReadOnlyThreadPanel({
  presentation = "side",
  onClose,
  hideHeader = false,
  readOnlyData,
  loomFooter,
  loomHeaderActions,
  loomOnOpenProfile,
  loomFocusId,
  loomHasNewer,
  loomLoadNewer,
  hideParentMessage,
  parentSlot,
}: ThreadPanelProps & { readOnlyData: ReadOnlyThreadData }) {
  const loomMentionMap = useMessageMentionMap();
  const { formatMessage } = useIntl();
  const source = useMemo<MessageTimelineSource>(() => ({
    messages: readOnlyData.replies,
    hasOlder: readOnlyData.hasOlder,
    hasNewer: loomHasNewer ?? false,
    initialFocusMessageId: loomFocusId,
    sentinelAutoLoadBlockKey: loomFocusId,
    loading: readOnlyData.loading,
    loadOlder: readOnlyData.loadOlder,
    loadNewer: loomLoadNewer ?? (() => undefined),
  }), [loomFocusId, loomHasNewer, loomLoadNewer, readOnlyData.hasOlder, readOnlyData.loadOlder, readOnlyData.loading, readOnlyData.replies]);
  const closeButtonClassName = presentation === "modal"
    ? "flex"
    : "hidden lg:flex";
  const readOnlyParentChannelName = readOnlyData.channels.find((channel) => channel.id === readOnlyData.parentChannelId)?.name;
  const renderMessage = useCallback((message: Message) => (
    <div className="px-3" style={{ overflow: "clip visible" }}>
      <MessageItem
        message={message}
        mentionMap={loomMentionMap}
        channels={readOnlyData.channels}
        parentChannelId={readOnlyData.parentChannelId}
        parentMessageId={readOnlyData.parentMessage.id}
        readOnlyProjection
        mentionComposerChannelId={`loom-thread:${readOnlyData.parentChannelId}:${readOnlyData.parentMessage.id}`}
        onOpenProfile={loomOnOpenProfile}
        threadSearchActive={message.id === loomFocusId}
        readOnlySender={readOnlyData.senderByMessageId.get(message.id)}
        canReact={false}
        hideThreadActions
      />
    </div>
  ), [loomFocusId, loomOnOpenProfile, loomMentionMap, readOnlyData.channels, readOnlyData.parentChannelId, readOnlyData.parentMessage.id, readOnlyData.senderByMessageId]);
  const parent = parentSlot ?? (hideParentMessage ? null : (
    <div data-testid="thread-panel-parent" className={THREAD_PANEL_PARENT_CLASS_NAME}>
      <MessageItem
        message={readOnlyData.parentMessage}
        mentionMap={loomMentionMap}
        channels={readOnlyData.channels}
        parentChannelId={readOnlyData.parentChannelId}
        readOnlyProjection
        mentionComposerChannelId={`loom-thread:${readOnlyData.parentChannelId}:${readOnlyData.parentMessage.id}`}
        onOpenProfile={loomOnOpenProfile}
        readOnlySender={readOnlyData.senderByMessageId.get(readOnlyData.parentMessage.id)}
        canReact={false}
        hideThreadActions
        senderAvatarTestId="thread-parent-avatar"
      />
    </div>
  ));

  return (
    <ThreadPanelRoot className={READ_ONLY_THREAD_PANEL_CLASS_NAME} data-testid="read-only-thread-panel">
      {!hideHeader && (
        <PanelHeader
          containerProps={READ_ONLY_THREAD_HEADER_CONTAINER_PROPS}
          titleSlot={(
            <div className="flex min-w-0 flex-col">
              <PanelTitle className="min-w-0 truncate text-left">
                {formatMessage({ id: "message.threadPanel.thread" })}
              </PanelTitle>
              {readOnlyParentChannelName ? (
                <PanelMeta render={<p />} className={THREAD_HEADER_SUBTITLE_CLASS_NAME}>
                  {formatMessage({ id: "message.threadPanel.channelContext" }, { name: readOnlyParentChannelName })}
                  {" · "}
                  {formatMessage({ id: "message.inlineThreadReplies.replyCount" }, { count: readOnlyData.replies.length })}
                </PanelMeta>
              ) : null}
            </div>
          )}
          mobileBreakpoint={presentation === "side" ? "lg" : "md"}
          onMobileBack={onClose}
          mobileBackProps={THREAD_MOBILE_BACK_PROPS}
          actions={<>{loomHeaderActions}{presentation !== "mobile-modal" ? (
            <Tooltip content={formatMessage({ id: "message.threadPanel.closeThread" })}>
              <PanelAction
                onClick={onClose}
                className={closeButtonClassName}
                aria-label={formatMessage({ id: "message.threadPanel.closeThread" })}
                data-testid="thread-close"
              >
                <X />
              </PanelAction>
            </Tooltip>
          ) : undefined}</>}
        />
      )}
      <ThreadPanelContent>
      <ThreadPanelBody className={READ_ONLY_THREAD_BODY_CLASS_NAME}>
        {readOnlyData.error ? (
          <div className="flex h-full flex-col overflow-auto">
            <Banner intent="warning" className="m-3">{readOnlyData.error}</Banner>
          </div>
        ) : readOnlyData.replies.length === 0 && !readOnlyData.loading ? (
          <div className="flex h-full flex-col overflow-auto">
            {parent}
            <EmptyState
              className="flex flex-1 flex-col items-center justify-center"
              icon={<ThreadIcon width={36} height={36} />}
              title={formatMessage({ id: "message.threadPanel.noRepliesTitle" })}
            />
          </div>
        ) : (
          <MessageTimeline
            key={readOnlyData.threadChannelId}
            source={source}
            renderItem={renderMessage}
            header={parent}
            className="h-full"
            testId="thread-message-scroller"
            persistKey={`public-thread:${readOnlyData.threadChannelId}`}
          />
        )}
      </ThreadPanelBody>
      {loomFooter}
      </ThreadPanelContent>
    </ThreadPanelRoot>
  );
}
export default ReadOnlyThreadPanel;
