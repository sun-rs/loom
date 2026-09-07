import { ComposerDropForm } from "./composer-drop-form.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from "react";

import type {
  HumanThreadFollowerRemoveResponse,
  NavigationTarget,
  Room,
  RoomEvent,
  Principal,
  Task,
  Thread,
} from "@rah-os/protocol";
import type { RahClient } from "@rah-os/client-sdk";
import { ChatEmptyState } from "./chat-empty-state.tsx";
import { PanelHeader } from "@rah-os/ui-web/neo-brutalist/panel-header";
import { PanelHeaderAction } from "@rah-os/ui-web/neo-brutalist/panel-header-action";
import { EmptyState } from "@rah-os/ui-web/neo-brutalist/empty-state";
import {
  useMessageSocial,
  MessageSocialButtons,
  MessageReactionSummary,
} from "./message-social.tsx";
import {
  createRoomViewModel,
  taskParticipantsForSelection,
  type RoomAgentTarget,
  type TaskParticipantSelection,
  type WorkspaceAgentView,
} from "@rah-os/ui-web";

import { MessageAgentAvatar } from "./agent-message-identity.tsx";
import { HumanIdentity } from "./human-identity.tsx";
import { AgentAvatar } from "./agent-avatar.tsx";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";
import { insertMention } from "../identity-presentation.ts";
import { formatRahDateTime } from "../date-time-presentation.ts";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import {
  MessageMarkdown,
  type MessageMarkdownReferences,
} from "./message-markdown.tsx";
import {
  ComposerFiles,
  MessageAttachments,
  useRoomUploads,
} from "./room-files.tsx";
import {
  MessageTimeline,
  type MessageTimelineHandle,
} from "./message-timeline.tsx";
import { TaskToolbar, type TaskViewMode } from "./task-toolbar.tsx";
import { GlobalTaskBoard } from "./global-task-board.tsx";
import {
  taskMatchesFilters,
  taskStatusPresentation,
} from "../task-presentation.ts";
import { conversationTarget } from "../conversation-target.ts";
import { useVisibleMessageRead } from "../use-visible-message-read.ts";
import { useComposerDraft } from "../use-composer-draft.ts";
import { handleComposerKeyDown } from "../composer-keyboard.ts";
import { CollapsibleMessage } from "./collapsible-message.tsx";
import { useSidebarPreferences } from "./sidebar-preferences.tsx";
import { roomLongMessagesCollapsed } from "../room-preferences.ts";
import {
  buildChatTimeline,
  buildThreadReceiptTimeline,
  chatDateLabel,
  chatLocalDateKey,
  chatTimelineKey,
  threadReminderReceipts,
} from "../chat-timeline-presentation.ts";
import {
  navigationSearch,
  shouldHandleClientNavigation,
} from "../navigation-target.ts";
import { useMessageContextMenu } from "../use-message-context-menu.ts";
import { MessageContextMenu } from "./message-context-menu.tsx";
import { MessageSelectionToolbar } from "./message-selection-toolbar.tsx";
import { TaskParticipantFields } from "./task-participant-fields.tsx";
import { MessageForwardDialog } from "./message-forward-dialog.tsx";
import { ForwardedMessageBundleView } from "./forwarded-message-bundle.tsx";
import {
  messageMentionReadStateIndex,
  type MessageReferenceReadStateIndex,
} from "../message-reference-read-state.ts";
import { useMessageSelectionActions } from "../use-message-selection-actions.ts";
import {
  ComposerMentionMenu,
  useComposerMention,
} from "./composer-mention.tsx";
import { useDiscoveryQuery } from "../use-discovery-query.ts";
import { messageTaskMenuAction } from "../message-task-menu-action.ts";

export type ThreadReplyPreview = {
  actorId: string;
  author: string;
  body: string;
  createdAt: string;
  messageId: string;
  threadId: string;
};

export type ThreadSearchMatch = {
  messageId: string;
  target: Extract<NavigationTarget, { kind: "message" }>;
};

export function ChatPane({
  client,
  currentPrincipal,
  focusedMessageId,
  onReadThrough,
  agents,
  canManageAnyTask,
  canCreateTask,
  canForward,
  canPost,
  canAttachFiles = false,
  canReadThreads,
  canWriteThreads,
  earlierMessagesLoading,
  hasEarlierMessages,
  loading,
  messageAgents,
  messages,
  roomEvents,
  roomMembers,
  onManageAgents,
  onConvertToTask,
  onTaskWorkflow,
  onLoadEarlier,
  onOpenThread,
  onOpenTarget,
  onSubmit,
  roomName,
  roomKind,
  roomId,
  mentionReadStates: canonicalMentionReadStates,
  referenceRooms = [],
  referenceComputers = [],
  referenceEventsComplete = false,
  tasks,
  threadReplyPreviews,
  threads,
}: {
  client: RahClient;
  currentPrincipal?: Principal | undefined;
  focusedMessageId?: string | undefined;
  onReadThrough?: ((throughSeq: number) => Promise<void>) | undefined;
  agents: readonly RoomAgentTarget[];
  canManageAnyTask: boolean;
  canCreateTask: boolean;
  canForward: boolean;
  canPost: boolean;
  canAttachFiles?: boolean;
  canReadThreads: boolean;
  canWriteThreads: boolean;
  earlierMessagesLoading: boolean;
  hasEarlierMessages: boolean;
  loading: boolean;
  messageAgents: readonly WorkspaceAgentView[];
  messages: ReturnType<typeof createRoomViewModel>["messages"];
  roomEvents: readonly RoomEvent[];
  roomMembers: readonly Principal[];
  onManageAgents: () => void;
  onConvertToTask: (messageId: string) => Promise<void>;
  onTaskWorkflow: (task: Task) => Promise<void>;
  onLoadEarlier: () => Promise<void>;
  onOpenThread: (
    rootMessageId: string,
    returnFocusTarget?: HTMLElement | null,
  ) => Promise<void>;
  onOpenTarget?: ((target: NavigationTarget) => void) | undefined;
  onSubmit: (
    body: string,
    asTask: boolean,
    taskParticipants: TaskParticipantSelection,
    attachmentIds?: string[],
  ) => Promise<void>;
  roomName: string | undefined;
  roomKind: Room["kind"] | undefined;
  roomId: string | undefined;
  mentionReadStates?: MessageReferenceReadStateIndex;
  referenceRooms?: readonly {
    kind: Room["kind"];
    names: readonly string[];
    peerNames?: readonly string[];
    roomId: string;
  }[];
  referenceComputers?: NonNullable<MessageMarkdownReferences["computers"]>;
  referenceEventsComplete?: boolean;
  tasks: readonly Task[];
  threadReplyPreviews: readonly ThreadReplyPreview[];
  threads: readonly Thread[];
}) {
  const mentionReadStatesByMessage = useMemo(
    () =>
      canonicalMentionReadStates ??
      (referenceEventsComplete
        ? messageMentionReadStateIndex(roomEvents)
        : new Map()),
    [canonicalMentionReadStates, referenceEventsComplete, roomEvents],
  );
  const sidebarPreferences = useSidebarPreferences();
  const collapseLongMessages =
    roomId === undefined || sidebarPreferences?.data === undefined
      ? true
      : roomLongMessagesCollapsed(
          sidebarPreferences.data.preferences.expandedLongMessages,
          roomId,
        );
  const uploadDraftKey = roomId ? `room:${roomId}` : undefined;
  const fileUploads = useRoomUploads(roomId, uploadDraftKey);
  const {
    body,
    setBody,
    asTask,
    setAsTask,
    taskAssigneeId,
    setTaskAssigneeId,
    taskCollaboratorIds,
    setTaskCollaboratorIds,
    taskReviewerIds,
    setTaskReviewerIds,
    acceptDraft,
  } = useComposerDraft(roomId ? `room:${roomId}` : undefined);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerMentionAgents = useMemo(() => {
    const participantIds = new Set(
      agents.map(({ participantId }) => participantId),
    );
    return messageAgents.filter(({ participantId }) =>
      participantIds.has(participantId),
    );
  }, [agents, messageAgents]);
  const composerMention = useComposerMention({
    agents: composerMentionAgents,
    body,
    id: "room-composer-mentions",
    setBody,
    textareaRef: composerRef,
  });
  function mention(handle: string) {
    const element = composerRef.current;
    if (!element || element.disabled) return;
    const result = insertMention(
      body,
      handle,
      element.selectionStart,
      element.selectionEnd,
    );
    setBody(result.text);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(result.caret, result.caret);
    });
  }
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const messageSelection = useMessageSelectionActions({
    linkForMessage: (message) => {
      const target = messageNavigationTarget(message, roomId);
      return target === undefined ? undefined : navigationSearch({ target });
    },
    messages,
    roomId,
  });
  const timelineItems = useMemo(
    () =>
      buildChatTimeline({ events: roomEvents, members: roomMembers, messages }),
    [messages, roomEvents, roomMembers],
  );
  const messagesRef = useRef<HTMLElement>(null);
  useVisibleMessageRead(messagesRef, roomId, messages, onReadThrough);
  const timelineRef = useRef<MessageTimelineHandle>(null);
  const positionedMessage = useRef<string | undefined>(undefined);
  const previousFocus = useRef(focusedMessageId);
  const activeScrollRoomId = useRef<string | undefined>(undefined);
  const stickToBottom = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  useEffect(() => {
    const leftContext =
      previousFocus.current !== undefined && !focusedMessageId;
    previousFocus.current = focusedMessageId;
    if (!focusedMessageId) {
      if (leftContext) stickToBottom.current = true;
      positionedMessage.current = undefined;
      return;
    }
    if (
      positionedMessage.current === focusedMessageId ||
      !messages.some((message) => message.messageId === focusedMessageId)
    )
      return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        timelineRef.current?.scrollToMessage(focusedMessageId);
        positionedMessage.current = focusedMessageId;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedMessageId, messages]);
  useEffect(() => {
    const element = messagesRef.current;
    if (element === null || messages.length === 0) return;
    if (focusedMessageId) {
      stickToBottom.current = false;
      setAtBottom(false);
      return;
    }
    if (activeScrollRoomId.current !== roomId) {
      activeScrollRoomId.current = roomId;
      stickToBottom.current = true;
      setAtBottom(true);
      timelineRef.current?.scrollToLatest();
      return;
    }
    if (stickToBottom.current && !earlierMessagesLoading) {
      timelineRef.current?.scrollToLatest();
    }
  }, [earlierMessagesLoading, focusedMessageId, messages, roomId]);

  // A virtual row can resize after the message request completes (images,
  // markdown and measured estimates). Keep a pinned tail through that layout
  // work; only a user's scroll/read gesture can release it, not a resize echo.
  useEffect(() => {
    const element = messagesRef.current;
    const content = element?.querySelector(".rah-message-timeline");
    if (!element || !content || focusedMessageId || earlierMessagesLoading)
      return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (stickToBottom.current) timelineRef.current?.scrollToLatest();
      });
    });
    observer.observe(content);
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [earlierMessagesLoading, focusedMessageId, roomId]);

  async function loadEarlier(): Promise<void> {
    const element = messagesRef.current;
    if (element === null || earlierMessagesLoading || !hasEarlierMessages) {
      return;
    }
    const scrollerRect = element.getBoundingClientRect();
    const anchor = [...element.querySelectorAll<HTMLElement>(".msg")].find(
      (candidate) =>
        candidate.getBoundingClientRect().bottom > scrollerRect.top,
    );
    const anchorOffset =
      anchor === undefined
        ? undefined
        : anchor.getBoundingClientRect().top -
          element.getBoundingClientRect().top;
    const previousScrollHeight = element.scrollHeight;
    const previousScrollTop = element.scrollTop;
    stickToBottom.current = false;
    setAtBottom(false);
    const anchorMessageId = anchor?.dataset.messageId;
    if (anchorMessageId !== undefined && anchorOffset !== undefined) {
      timelineRef.current?.preserveAnchorOnNextChange(
        anchorMessageId,
        anchorOffset,
      );
    }
    try {
      await onLoadEarlier();
    } catch (caught) {
      timelineRef.current?.cancelPendingAnchor();
      throw caught;
    }
    if (anchorMessageId !== undefined) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const current = messagesRef.current;
        if (current === null) return;
        if (
          anchor !== undefined &&
          anchorOffset !== undefined &&
          anchor.isConnected &&
          current.contains(anchor)
        ) {
          const currentOffset =
            anchor.getBoundingClientRect().top -
            current.getBoundingClientRect().top;
          current.scrollTop += currentOffset - anchorOffset;
          return;
        }
        current.scrollTop =
          current.scrollHeight - previousScrollHeight + previousScrollTop;
      });
    });
  }
  let taskTargetIssue: string | undefined;
  let taskParticipants: TaskParticipantSelection = {
    collaboratorIds: [],
    reviewerIds: [],
  };
  if (asTask) {
    try {
      taskParticipants = taskParticipantsForSelection({
        availableAgents: agents,
        ...(taskAssigneeId === undefined ? {} : { assigneeId: taskAssigneeId }),
        collaboratorIds: taskCollaboratorIds,
        reviewerIds: taskReviewerIds,
      });
    } catch (caught) {
      taskTargetIssue = errorMessage(caught);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = body.trim();
    if (
      (value === "" && fileUploads.rows.length === 0) ||
      pending ||
      fileUploads.rows.some((row) => row.status !== "ready")
    )
      return;
    setPending(true);
    try {
      const submittedFiles = fileUploads.rows;
      await onSubmit(
        value,
        asTask,
        taskParticipants,
        submittedFiles.flatMap((row) =>
          row.attachmentId ? [row.attachmentId] : [],
        ),
      );
      if (uploadDraftKey)
        fileUploads.store?.accept(
          uploadDraftKey,
          submittedFiles.map((row) => row.id),
        );
      requestAnimationFrame(() => {
        if (activeScrollRoomId.current !== roomId || previousFocus.current)
          return;
        stickToBottom.current = true;
        setAtBottom(true);
        timelineRef.current?.scrollToLatest();
      });
      acceptDraft();
      setSubmitError(undefined);
    } catch (caught) {
      setSubmitError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="chan-pane">
      <section
        className="messages rah-scroll-main"
        onWheel={(event) => {
          if (event.deltaY < 0) {
            stickToBottom.current = false;
            setAtBottom(false);
          }
        }}
        onTouchMove={() => {
          stickToBottom.current = false;
          setAtBottom(false);
        }}
        onKeyDown={(event) => {
          if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
            stickToBottom.current = false;
            setAtBottom(false);
          }
          if (event.key === "End") {
            stickToBottom.current = true;
            setAtBottom(true);
          }
        }}
        onScroll={(event) => {
          const element = event.currentTarget;
          const nextAtBottom =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            48;
          stickToBottom.current = nextAtBottom;
          setAtBottom(nextAtBottom);
        }}
        ref={messagesRef}
      >
        {loading && timelineItems.length === 0 ? (
          <p className="rah-empty-copy">正在同步 Room…</p>
        ) : null}
        {!loading && timelineItems.length === 0 ? <ChatEmptyState /> : null}
        <MessageTimeline
          followOnAppend={
            !focusedMessageId &&
            stickToBottom.current &&
            !earlierMessagesLoading
          }
          getItemKey={chatTimelineKey}
          header={
            hasEarlierMessages ? (
              <button
                className="rah-message-history-trigger"
                disabled={earlierMessagesLoading}
                onClick={() => void loadEarlier()}
                type="button"
              >
                {earlierMessagesLoading ? "正在加载…" : "加载更早消息"}
              </button>
            ) : undefined
          }
          items={timelineItems}
          ref={timelineRef}
          renderItem={(item, itemIndex) => {
            const previous = timelineItems[itemIndex - 1];
            const showDate =
              previous === undefined ||
              chatLocalDateKey(previous.createdAt) !==
                chatLocalDateKey(item.createdAt);
            if (item.kind !== "message") {
              return (
                <>
                  {showDate ? (
                    <ChatDateDivider label={chatDateLabel(item.createdAt)} />
                  ) : null}
                  <p className="rah-chat-system-notice">
                    {item.kind === "reminder-fired" ? (
                      <NavigationReceiptLink
                        {...(onOpenTarget === undefined
                          ? {}
                          : { onOpenTarget })}
                        target={item.target}
                        text={item.text}
                      />
                    ) : (
                      item.text
                    )}
                  </p>
                </>
              );
            }
            const message = item.message;
            const messageAgent = messageAgents.find(
              ({ participantId }) => participantId === message.actorId,
            );
            const messagePrincipal = roomMembers.find(
              ({ principalId }) => principalId === message.actorId,
            );
            const task = tasks.find(
              ({ sourceMessageId }) => sourceMessageId === message.messageId,
            );
            const taskAgent = messageAgents.find(
              ({ participantId }) => participantId === task?.assigneeId,
            );
            const thread = threads.find(
              ({ rootMessageId }) => rootMessageId === message.messageId,
            );
            const recentThreadReplies =
              thread === undefined
                ? []
                : threadReplyPreviews
                    .filter(({ threadId }) => threadId === thread.threadId)
                    .slice(-3);
            return (
              <>
                {showDate ? (
                  <ChatDateDivider label={chatDateLabel(message.createdAt)} />
                ) : null}
                <MessageArticle
                  client={client}
                  canManageTask={
                    task !== undefined &&
                    (canManageAnyTask ||
                      task.creatorId === currentPrincipal?.principalId)
                  }
                  collapseLongMessages={collapseLongMessages}
                  contextRoomId={roomId}
                  contextThreadId={thread?.threadId}
                  onMention={mention}
                  onOpenTarget={onOpenTarget}
                  referenceAgents={messageAgents}
                  referenceComputers={referenceComputers}
                  referenceCurrentPrincipal={currentPrincipal}
                  referencePrincipals={roomMembers}
                  referenceRooms={referenceRooms}
                  referenceTasks={tasks}
                  referenceThreads={
                    roomId === undefined ||
                    roomKind === undefined ||
                    roomName === undefined
                      ? []
                      : threads.map((referenceThread) => ({
                          roomId,
                          roomKind,
                          roomName,
                          rootMessageId: referenceThread.rootMessageId,
                          threadId: referenceThread.threadId,
                        }))
                  }
                  focused={message.messageId === focusedMessageId}
                  message={message}
                  mentionReadStates={mentionReadStatesByMessage.get(
                    message.messageId,
                  )}
                  navigationTarget={messageNavigationTarget(message, roomId)}
                  {...(roomId === undefined
                    ? {}
                    : {
                        selection: {
                          active: messageSelection.active,
                          onEnter: () =>
                            messageSelection.selection.enterRoom(roomId, [
                              message.messageId,
                            ]),
                          onToggle: () =>
                            messageSelection.selection.toggle(
                              message.messageId,
                            ),
                          selected:
                            messageSelection.active &&
                            messageSelection.selection.selectedIds.includes(
                              message.messageId,
                            ),
                        },
                      })}
                  {...(messageAgent === undefined ? {} : { messageAgent })}
                  {...(messagePrincipal === undefined
                    ? {}
                    : { messagePrincipal })}
                  {...(task === undefined ? {} : { task })}
                  {...(task === undefined
                    ? {}
                    : { taskWorkflowAction: () => onTaskWorkflow(task) })}
                  {...(taskAgent === undefined ? {} : { taskAgent })}
                  {...(task === undefined && canCreateTask
                    ? {
                        convertTaskAction: () =>
                          onConvertToTask(message.messageId),
                      }
                    : {})}
                  {...(canReadThreads &&
                  (thread !== undefined || canWriteThreads)
                    ? {
                        threadAction: {
                          onClick: (returnFocusTarget) =>
                            void onOpenThread(
                              message.messageId,
                              returnFocusTarget,
                            ),
                        },
                      }
                    : {})}
                  {...(thread !== undefined && thread.replyCount > 0
                    ? {
                        threadReplies: recentThreadReplies,
                        threadReplyCount: thread.replyCount,
                      }
                    : {})}
                />
              </>
            );
          }}
          scrollElementRef={messagesRef}
        />
      </section>
      {!focusedMessageId && timelineItems.length > 0 && !atBottom ? (
        <button
          className="rah-scroll-to-bottom"
          onClick={() => {
            stickToBottom.current = true;
            setAtBottom(true);
            timelineRef.current?.scrollToLatest();
          }}
          type="button"
        >
          <span aria-hidden="true">↓</span> 回到底部
        </button>
      ) : null}
      {messageSelection.active ? (
        <MessageSelectionToolbar
          allSelected={messageSelection.allSelected}
          error={messageSelection.error}
          onCancel={messageSelection.selection.exit}
          onCopyLinks={() => void messageSelection.copy("links")}
          onCopyMarkdown={() => void messageSelection.copy("markdown")}
          {...(canForward ? { onForward: messageSelection.openForward } : {})}
          onSelectAll={() =>
            messageSelection.selection.selectAll(
              messageSelection.allSelected
                ? []
                : messageSelection.selectableMessageIds,
            )
          }
          selectedCount={messageSelection.selection.selectedIds.length}
        />
      ) : (
        <>
          {asTask ? (
            <TaskParticipantFields
              agents={agents}
              assigneeId={taskAssigneeId}
              collaboratorIds={taskCollaboratorIds}
              onAssigneeChange={(participantId) => {
                setTaskAssigneeId(participantId);
                if (participantId !== undefined) {
                  setTaskCollaboratorIds((current) =>
                    current.filter((candidate) => candidate !== participantId),
                  );
                  setTaskReviewerIds((current) =>
                    current.filter((candidate) => candidate !== participantId),
                  );
                }
              }}
              onCollaboratorsChange={setTaskCollaboratorIds}
              onManageAgents={onManageAgents}
              onReviewersChange={setTaskReviewerIds}
              reviewerIds={taskReviewerIds}
              taskTargetIssue={taskTargetIssue}
            />
          ) : null}
          {submitError === undefined ? null : (
            <div className="rah-inline-error">{submitError}</div>
          )}
          <ComposerDropForm
            roomId={roomId}
            draftKey={uploadDraftKey}
            disabled={pending || asTask || !canPost || !canAttachFiles}
            onSubmit={submit}
          >
            <ComposerMentionMenu
              activeIndex={composerMention.activeIndex}
              agents={composerMention.candidates}
              id="room-composer-mentions"
              onSelect={composerMention.select}
              open={composerMention.open}
            />
            <div className="composer-box">
              <textarea
                aria-activedescendant={composerMention.activeDescendant}
                aria-autocomplete="list"
                aria-controls="room-composer-mentions"
                aria-expanded={composerMention.open}
                aria-label="消息输入框"
                ref={composerRef}
                disabled={!canPost && !canCreateTask}
                onBlur={composerMention.onBlur}
                onChange={composerMention.onChange}
                onClick={(event) =>
                  composerMention.onSelectionChange(event.currentTarget)
                }
                onFocus={composerMention.onFocus}
                onKeyDown={(event) => {
                  composerMention.onKeyDown(event);
                  handleComposerKeyDown(event);
                }}
                onKeyUp={(event) =>
                  composerMention.onSelectionChange(event.currentTarget)
                }
                placeholder={`发送消息至 ${conversationTarget(
                  roomName === undefined
                    ? undefined
                    : { kind: roomKind ?? "channel", name: roomName },
                )}`}
                rows={3}
                value={body}
              />
              <div className="composer-bar">
                <ComposerFiles
                  roomId={roomId}
                  draftKey={uploadDraftKey}
                  disabled={pending || asTask || !canPost || !canAttachFiles}
                />
                <span className="composer-spacer" />
                {canCreateTask ? (
                  <label className="task-check">
                    <input
                      checked={asTask}
                      disabled={fileUploads.rows.length > 0 || pending}
                      onChange={(event) => setAsTask(event.target.checked)}
                      type="checkbox"
                    />
                    <span className="box" />
                    作为任务
                  </label>
                ) : null}
                <button
                  className="send-btn"
                  type="submit"
                  disabled={
                    (body.trim() === "" && fileUploads.rows.length === 0) ||
                    fileUploads.rows.some((row) => row.status !== "ready") ||
                    pending ||
                    taskTargetIssue !== undefined ||
                    (asTask ? !canCreateTask : !canPost)
                  }
                  title="发送"
                >
                  <Icon name="send" />
                </button>
              </div>
            </div>
          </ComposerDropForm>
        </>
      )}
      {messageSelection.forwardOpen && roomId !== undefined ? (
        <MessageForwardDialog
          client={client}
          onClose={messageSelection.closeForward}
          onComplete={() => {
            messageSelection.closeForward();
            messageSelection.selection.exit();
          }}
          sourceMessageIds={messageSelection.resolved.messages.map(
            ({ messageId }) => messageId,
          )}
          sourceRoomId={roomId}
        />
      ) : null}
    </div>
  );
}

type MessageView = ReturnType<typeof createRoomViewModel>["messages"][number];

function messageNavigationTarget(
  message: MessageView,
  roomId?: string,
  threadId?: string,
  rootMessageId?: string,
): Extract<NavigationTarget, { kind: "message" }> | undefined {
  const resolvedRoomId = message.roomId ?? roomId;
  if (!resolvedRoomId) return undefined;
  return {
    kind: "message",
    messageId: message.messageId,
    roomId: resolvedRoomId,
    ...(threadId && rootMessageId ? { rootMessageId, threadId } : {}),
  };
}

function ChatDateDivider({ label }: { label: string }) {
  return (
    <div className="rah-chat-date-divider" role="separator">
      <span aria-hidden="true" />
      <time>{label}</time>
    </div>
  );
}

function ThreadReplyAvatar({
  actorId,
  agents,
  author,
  principals,
}: {
  actorId: string;
  agents: readonly WorkspaceAgentView[];
  author: string;
  principals: readonly Principal[];
}) {
  const replyAgent = agents.find(
    ({ participantId }) => participantId === actorId,
  );
  if (replyAgent !== undefined) {
    return <AgentAvatar agent={replyAgent} showStatus={false} size="compact" />;
  }
  const replyPrincipal = principals.find(
    ({ principalId }) => principalId === actorId,
  );
  if (replyPrincipal?.avatarKey) {
    return (
      <ProfileImageAvatar
        avatarKey={replyPrincipal.avatarKey}
        name={author}
        size="compact"
      />
    );
  }
  return (
    <span className="avatar xs rah-avatar" aria-hidden="true">
      {author.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function MessageArticle({
  client,
  canManageTask = false,
  collapseLongMessages = true,
  contextRoomId,
  contextThreadId,
  focused = false,
  convertTaskAction,
  highlightQuery,
  message,
  messageAgent,
  messagePrincipal,
  mentionReadStates,
  navigationTarget,
  onMention,
  onOpenTarget,
  referenceAgents = [],
  referenceComputers = [],
  referenceCurrentPrincipal,
  referencePrincipals = [],
  referenceRooms = [],
  referenceTasks = [],
  referenceThreads = [],
  selection,
  task,
  taskAgent,
  taskWorkflowAction,
  threadAction,
  threadReplies,
  threadReplyCount,
}: {
  client: RahClient;
  canManageTask?: boolean;
  collapseLongMessages?: boolean;
  contextRoomId?: string | undefined;
  contextThreadId?: string | undefined;
  focused?: boolean;
  convertTaskAction?: () => Promise<void>;
  highlightQuery?: string | undefined;
  message: MessageView;
  messageAgent?: WorkspaceAgentView | undefined;
  messagePrincipal?: Principal | undefined;
  mentionReadStates?: MessageMarkdownReferences["mentionReadStates"];
  navigationTarget?: Extract<NavigationTarget, { kind: "message" }> | undefined;
  onMention?: (handle: string) => void;
  onOpenTarget?: ((target: NavigationTarget) => void) | undefined;
  referenceAgents?: readonly WorkspaceAgentView[];
  referenceComputers?: NonNullable<MessageMarkdownReferences["computers"]>;
  referenceCurrentPrincipal?: Principal | undefined;
  referencePrincipals?: readonly Principal[];
  referenceRooms?: readonly {
    kind: Room["kind"];
    names: readonly string[];
    peerNames?: readonly string[];
    roomId: string;
  }[];
  referenceTasks?: readonly Task[];
  referenceThreads?: NonNullable<MessageMarkdownReferences["threads"]>;
  selection?: {
    active: boolean;
    onEnter: () => void;
    onToggle: () => void;
    selected: boolean;
  };
  task?: Task;
  taskAgent?: WorkspaceAgentView;
  taskWorkflowAction?: (() => Promise<void>) | undefined;
  threadAction?: {
    onClick: (returnFocusTarget?: HTMLElement | null) => void;
  };
  threadReplies?: readonly ThreadReplyPreview[];
  threadReplyCount?: number;
}) {
  const social = useMessageSocial(message);
  const {
    anchor: contextMenu,
    closeContextMenu,
    finishContextMenuLongPress,
    moveContextMenuLongPress,
    openContextMenu,
    startContextMenuLongPress,
    triggerRef: messageRef,
  } = useMessageContextMenu<HTMLElement>();
  const [conversionPending, setConversionPending] = useState(false);
  const [conversionError, setConversionError] = useState<string>();
  const [threadFollowPending, setThreadFollowPending] = useState(false);
  const [taskActionPending, setTaskActionPending] = useState(false);
  const threadFollowers = useDiscoveryQuery(
    client,
    "thread.followers",
    {
      roomId: contextRoomId ?? "room-unavailable",
      threadId: contextThreadId ?? "thread-unavailable",
    },
    contextMenu !== undefined &&
      contextRoomId !== undefined &&
      contextThreadId !== undefined,
  );
  const taskMenuAction =
    task === undefined ? undefined : messageTaskMenuAction(task, canManageTask);
  const openThreadFromMessage = () => threadAction?.onClick(messageRef.current);

  async function convertToTask() {
    if (convertTaskAction === undefined || conversionPending) return;
    setConversionPending(true);
    try {
      await convertTaskAction();
      closeContextMenu();
      setConversionError(undefined);
    } catch (caught) {
      setConversionError(errorMessage(caught));
    } finally {
      setConversionPending(false);
    }
  }

  async function toggleThreadFollow() {
    if (
      contextRoomId === undefined ||
      contextThreadId === undefined ||
      threadFollowers.data === undefined ||
      threadFollowPending
    )
      return;
    setThreadFollowPending(true);
    try {
      await client.request("activity.follow", {
        following: !threadFollowers.data.following,
        roomId: contextRoomId,
        threadId: contextThreadId,
      });
      setConversionError(undefined);
      closeContextMenu();
    } catch (caught) {
      setConversionError(errorMessage(caught));
    } finally {
      setThreadFollowPending(false);
    }
  }

  async function updateTaskWorkflow() {
    if (
      taskWorkflowAction === undefined ||
      taskMenuAction === undefined ||
      taskMenuAction.kind === "unavailable" ||
      taskActionPending
    )
      return;
    setTaskActionPending(true);
    try {
      await taskWorkflowAction();
      setConversionError(undefined);
      closeContextMenu();
    } catch (caught) {
      setConversionError(errorMessage(caught));
    } finally {
      setTaskActionPending(false);
    }
  }

  return (
    <article
      className="msg"
      data-message-id={message.messageId}
      data-focused={focused}
      data-selected={selection?.selected || undefined}
      data-selection-active={selection?.active || undefined}
      onClick={(event) => {
        if (!selection?.active) return;
        if (
          event.target instanceof Element &&
          event.target.closest("a, button, input, label")
        )
          return;
        event.preventDefault();
        selection.onToggle();
      }}
      onContextMenu={
        navigationTarget && !selection?.active ? openContextMenu : undefined
      }
      onTouchEnd={selection?.active ? undefined : finishContextMenuLongPress}
      onTouchMove={selection?.active ? undefined : moveContextMenuLongPress}
      onTouchStart={selection?.active ? undefined : startContextMenuLongPress}
      ref={messageRef}
      tabIndex={-1}
    >
      {selection?.active ? (
        <label className="rah-message-selection-check">
          <input
            aria-label={`选择 ${message.author} 的消息`}
            checked={selection.selected}
            onChange={selection.onToggle}
            type="checkbox"
          />
        </label>
      ) : null}
      {messageAgent === undefined ? (
        messagePrincipal?.kind === "human" ? (
          <HumanIdentity
            principal={messagePrincipal}
            avatar
            className="rah-message-avatar-trigger"
          />
        ) : messagePrincipal?.avatarKey ? (
          <ProfileImageAvatar
            avatarKey={messagePrincipal.avatarKey}
            name={message.author}
            size="sidebar"
          />
        ) : (
          <span className="avatar rah-avatar">
            {message.author.slice(0, 1).toUpperCase()}
          </span>
        )
      ) : (
        <MessageAgentAvatar agent={messageAgent} />
      )}
      {selection?.active ||
      (threadAction === undefined && !social.enabled) ? null : (
        <div className="msg-actions">
          {threadAction && (
            <button
              aria-label="在消息列中回复"
              className="msg-action-btn"
              onClick={openThreadFromMessage}
              title="在消息列中回复"
              type="button"
            >
              <Icon name="chat" />
            </button>
          )}
          <MessageSocialButtons view={social} />
        </div>
      )}
      <div className="msg-body">
        <header className="msg-head">
          {messageAgent && onMention ? (
            <button
              className="rah-message-sender"
              title={`提及 @${messageAgent.handle}`}
              onClick={() => onMention(messageAgent.handle)}
            >
              {message.author}
            </button>
          ) : (
            <b>{message.author}</b>
          )}
          <time>{formatTime(message.createdAt)}</time>
        </header>
        {message.body.trim().length === 0 ? null : (
          <CollapsibleMessage
            collapse={collapseLongMessages}
            messageId={message.messageId}
          >
            <MessageMarkdown
              highlightQuery={highlightQuery}
              references={{
                agents: referenceAgents,
                computers: referenceComputers,
                currentPrincipal: referenceCurrentPrincipal,
                mentionReadStates,
                onOpenTarget,
                principals: referencePrincipals,
                rooms: referenceRooms,
                tasks: referenceTasks.map((referenceTask) => ({
                  target: {
                    kind: "task",
                    roomId: referenceTask.roomId,
                    rootMessageId: referenceTask.sourceMessageId,
                    taskId: referenceTask.taskId,
                    threadId: referenceTask.threadId,
                  },
                  taskId: referenceTask.taskId,
                  taskNumber: referenceTask.taskNumber,
                })),
                threads: referenceThreads,
              }}
              source={message.body}
            />
          </CollapsibleMessage>
        )}
        {message.forwardedBundle === undefined ? null : (
          <ForwardedMessageBundleView
            bundle={message.forwardedBundle}
            onOpenTarget={onOpenTarget}
          />
        )}
        {task === undefined ? null : (
          <button
            aria-label={`打开任务 #${task.taskNumber}：${task.title}`}
            className="rah-message-task-link"
            data-task-status={taskStatusPresentation(task).id}
            data-testid="message-task-badge"
            disabled={threadAction === undefined}
            onClick={openThreadFromMessage}
            type="button"
          >
            <Icon name="eye" />
            <span>#{task.taskNumber}</span>
            {taskAgent === undefined ? null : <span>@{taskAgent.handle}</span>}
          </button>
        )}
        <MessageAttachments attachments={message.attachments} />
        <MessageReactionSummary view={social} />
        {threadAction === undefined || threadReplyCount === undefined ? null : (
          <button className="thread-preview" onClick={openThreadFromMessage}>
            <span className="tp-toggle">
              {String(threadReplyCount)} 条回复 ›
            </span>
            {threadReplies?.map((reply) => (
              <span className="tp-line" key={reply.messageId}>
                <ThreadReplyAvatar
                  actorId={reply.actorId}
                  agents={referenceAgents}
                  author={reply.author}
                  principals={referencePrincipals}
                />
                <b>{reply.author}</b>
                <span className="tp-text">{reply.body}</span>
                <time>{formatTime(reply.createdAt)}</time>
              </span>
            ))}
          </button>
        )}
        {conversionError === undefined ? null : (
          <span className="rah-message-action-error" role="alert">
            {conversionError}
          </span>
        )}
      </div>
      {contextMenu === undefined || navigationTarget === undefined ? null : (
        <MessageContextMenu
          anchor={contextMenu}
          conversionPending={conversionPending}
          messageBody={message.body}
          onClose={closeContextMenu}
          onError={setConversionError}
          social={social}
          target={navigationTarget}
          triggerRef={messageRef}
          {...(contextRoomId === undefined || contextThreadId === undefined
            ? {}
            : {
                threadFollow: {
                  ...(threadFollowers.data === undefined
                    ? {}
                    : { following: threadFollowers.data.following }),
                  loading: threadFollowers.loading,
                  onToggle: toggleThreadFollow,
                  pending: threadFollowPending,
                },
              })}
          {...(taskMenuAction === undefined
            ? {}
            : {
                taskAction: {
                  ...(taskMenuAction.kind === "unavailable"
                    ? { disabledReason: taskMenuAction.reason }
                    : { onAction: updateTaskWorkflow }),
                  label: taskMenuAction.label,
                  pending: taskActionPending,
                },
              })}
          {...(convertTaskAction === undefined
            ? {}
            : { onConvertToTask: convertToTask })}
          {...(threadAction === undefined
            ? {}
            : { onOpenThread: openThreadFromMessage })}
          {...(selection === undefined
            ? {}
            : { onSelectMessages: selection.onEnter })}
        />
      )}
    </article>
  );
}

export function ThreadPane({
  client,
  canManageAnyTask,
  currentPrincipal,
  messageAgents = [],
  mentionAgentIds = [],
  focusedMessageId,
  followers = [],
  followersCanManage = false,
  followersError,
  followersLoading = false,
  humanFollowing,
  onReadThrough,
  canAttachFiles = false,
  canForward,
  canReply,
  earlierRepliesLoading = false,
  hasEarlierReplies = false,
  loading,
  onClose,
  onSubmit,
  onTaskWorkflow,
  onFollow,
  onLoadEarlier,
  onRefreshFollowers,
  onRemoveFollower,
  onRestoreFollower,
  onSearchThread,
  onOpenTarget,
  onViewInChannel,
  replies,
  referenceComputers = [],
  mentionReadStates: canonicalMentionReadStates,
  referenceEventsComplete = false,
  roomMembers = [],
  referenceRooms = [],
  referenceTasks = [],
  resizer,
  roomEvents = [],
  roomId,
  roomKind,
  roomName,
  root,
  task,
  taskAgent,
  threadId,
}: {
  client: RahClient;
  canManageAnyTask: boolean;
  currentPrincipal?: Principal | undefined;
  messageAgents?: readonly WorkspaceAgentView[];
  mentionAgentIds?: readonly string[];
  focusedMessageId?: string | undefined;
  followers?: readonly WorkspaceAgentView[];
  followersCanManage?: boolean;
  followersError?: string | undefined;
  followersLoading?: boolean;
  humanFollowing?: boolean | undefined;
  onReadThrough?: ((throughSeq: number) => Promise<void>) | undefined;
  canAttachFiles?: boolean;
  canForward: boolean;
  canReply: boolean;
  earlierRepliesLoading?: boolean;
  hasEarlierReplies?: boolean;
  loading: boolean;
  onClose: () => void;
  onSubmit: (body: string, attachmentIds?: string[]) => Promise<void>;
  onTaskWorkflow: (task: Task) => Promise<void>;
  onFollow?: ((following: boolean) => Promise<void>) | undefined;
  onLoadEarlier?: (() => Promise<void>) | undefined;
  onRefreshFollowers?: (() => void) | undefined;
  onRemoveFollower?:
    | ((participantId: string) => Promise<HumanThreadFollowerRemoveResponse>)
    | undefined;
  onRestoreFollower?:
    | ((input: { participantId: string; undoToken: string }) => Promise<void>)
    | undefined;
  onSearchThread?:
    | ((
        query: string,
        signal: AbortSignal,
      ) => Promise<readonly ThreadSearchMatch[]>)
    | undefined;
  onOpenTarget?: (target: NavigationTarget) => void;
  onViewInChannel?: () => void;
  replies: ReturnType<typeof createRoomViewModel>["messages"];
  referenceComputers?: NonNullable<MessageMarkdownReferences["computers"]>;
  mentionReadStates?: MessageReferenceReadStateIndex;
  referenceEventsComplete?: boolean;
  roomMembers?: readonly Principal[];
  referenceRooms?: readonly {
    kind: Room["kind"];
    names: readonly string[];
    peerNames?: readonly string[];
    roomId: string;
  }[];
  referenceTasks?: readonly Task[];
  resizer?: ReactNode;
  roomEvents?: readonly RoomEvent[];
  roomId?: string | undefined;
  roomKind?: Room["kind"] | undefined;
  roomName: string | undefined;
  root: MessageView | undefined;
  task?: Task;
  taskAgent?: WorkspaceAgentView;
  threadId?: string | undefined;
}) {
  const mentionReadStatesByMessage = useMemo(
    () =>
      canonicalMentionReadStates ??
      (referenceEventsComplete
        ? messageMentionReadStateIndex(roomEvents)
        : new Map()),
    [canonicalMentionReadStates, referenceEventsComplete, roomEvents],
  );
  const sidebarPreferences = useSidebarPreferences();
  const collapseLongMessages =
    roomId === undefined || sidebarPreferences?.data === undefined
      ? true
      : roomLongMessagesCollapsed(
          sidebarPreferences.data.preferences.expandedLongMessages,
          roomId,
        );
  const { body, setBody, acceptDraft } = useComposerDraft(
    root ? `thread:${root.messageId}` : undefined,
  );
  const uploadDraftKey = root ? `thread:${root.messageId}` : undefined;
  const fileUploads = useRoomUploads(roomId, uploadDraftKey);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerMentionAgents = useMemo(() => {
    const participantIds = new Set(mentionAgentIds);
    return messageAgents.filter(({ participantId }) =>
      participantIds.has(participantId),
    );
  }, [mentionAgentIds, messageAgents]);
  const composerMention = useComposerMention({
    agents: composerMentionAgents,
    body,
    id: "thread-composer-mentions",
    setBody,
    textareaRef: composerRef,
  });
  function mention(handle: string) {
    const element = composerRef.current;
    if (!element || element.disabled) return;
    const result = insertMention(
      body,
      handle,
      element.selectionStart,
      element.selectionEnd,
    );
    setBody(result.text);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(result.caret, result.caret);
    });
  }
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const threadMessages = root === undefined ? replies : [root, ...replies];
  const messageSelection = useMessageSelectionActions({
    linkForMessage: (message) => {
      const target = messageNavigationTarget(
        message,
        roomId,
        threadId,
        root?.messageId,
      );
      return target === undefined ? undefined : navigationSearch({ target });
    },
    messages: threadMessages,
    roomId,
    threadRootMessageId: root?.messageId,
  });
  const [following, setFollowing] = useState<boolean>();
  const [followersOpen, setFollowersOpen] = useState(false);
  const [followerPendingIds, setFollowerPendingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [followerActionError, setFollowerActionError] = useState<string>();
  const [removedFollowers, setRemovedFollowers] = useState<
    { agent: WorkspaceAgentView; undoToken: string }[]
  >([]);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [remoteSearchMatches, setRemoteSearchMatches] = useState<
    readonly ThreadSearchMatch[]
  >([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const revealedSearchMessageId = useRef<string | undefined>(undefined);
  const followersOwnerRef = useRef<HTMLDivElement>(null);
  const followersTriggerRef = useRef<HTMLButtonElement>(null);
  const followersDialogRef = useRef<HTMLDivElement>(null);
  const overflowOwnerRef = useRef<HTMLDivElement>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const threadPanelRef = useRef<HTMLElement>(null);
  const followerUndoTimers = useRef(new Map<string, number>());
  const reminderReceipts = useMemo(
    () => threadReminderReceipts(roomEvents, threadId),
    [roomEvents, threadId],
  );
  const replyTimeline = useMemo(
    () => buildThreadReceiptTimeline(replies, reminderReceipts),
    [reminderReceipts, replies],
  );
  const messagesElement = useRef<HTMLElement>(null);
  useVisibleMessageRead(
    messagesElement,
    root?.messageId,
    replies,
    onReadThrough,
  );
  const positionedMessage = useRef<string | undefined>(undefined);
  useEffect(() => {
    setFollowing(undefined);
    setFollowersOpen(false);
    setOverflowOpen(false);
    setSearchOpen(false);
    setSearchQuery("");
    setRemoteSearchMatches([]);
    setSearchError(undefined);
    revealedSearchMessageId.current = undefined;
    positionedMessage.current = undefined;
    setFollowerActionError(undefined);
    setRemovedFollowers([]);
    for (const timer of followerUndoTimers.current.values())
      window.clearTimeout(timer);
    followerUndoTimers.current.clear();
  }, [root?.messageId]);
  useEffect(
    () => () => {
      for (const timer of followerUndoTimers.current.values())
        window.clearTimeout(timer);
      followerUndoTimers.current.clear();
    },
    [],
  );
  useEffect(() => {
    const query = searchQuery.trim();
    if (!searchOpen || query === "" || onSearchThread === undefined) {
      setRemoteSearchMatches([]);
      setSearchLoading(false);
      setSearchError(undefined);
      return;
    }
    const controller = new AbortController();
    setSearchLoading(true);
    setSearchError(undefined);
    const timer = window.setTimeout(() => {
      void onSearchThread(query, controller.signal)
        .then((matches) => {
          if (!controller.signal.aborted) setRemoteSearchMatches(matches);
        })
        .catch((caught) => {
          if (!controller.signal.aborted) setSearchError(errorMessage(caught));
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchLoading(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [onSearchThread, searchOpen, searchQuery]);
  const searchMatches = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (query === "") return [];
    if (onSearchThread === undefined)
      return [root, ...replies]
        .filter(
          (message): message is MessageView =>
            message !== undefined &&
            (message.body.toLocaleLowerCase().includes(query) ||
              message.author.toLocaleLowerCase().includes(query)),
        )
        .flatMap((message) => {
          const target = messageNavigationTarget(
            message,
            roomId,
            threadId,
            root?.messageId,
          );
          return target === undefined
            ? []
            : [{ messageId: message.messageId, target }];
        });
    const rootTarget =
      root !== undefined &&
      (root.body.toLocaleLowerCase().includes(query) ||
        root.author.toLocaleLowerCase().includes(query))
        ? messageNavigationTarget(root, roomId, threadId, root.messageId)
        : undefined;
    return [
      ...(rootTarget === undefined
        ? []
        : [{ messageId: root!.messageId, target: rootTarget }]),
      ...remoteSearchMatches.filter(
        (match) => match.messageId !== root?.messageId,
      ),
    ];
  }, [
    onSearchThread,
    remoteSearchMatches,
    replies,
    roomId,
    root,
    searchQuery,
    threadId,
  ]);
  const activeSearchMessageId = searchOpen
    ? searchMatches[searchIndex]?.messageId
    : undefined;
  useEffect(() => {
    if (!searchOpen || searchMatches.length === 0) return;
    const index = Math.min(searchIndex, searchMatches.length - 1);
    if (index !== searchIndex) setSearchIndex(index);
    const match = searchMatches[index]!;
    const node = messagesElement.current?.querySelector(
      `[data-message-id="${CSS.escape(match.messageId)}"]`,
    );
    if (node) {
      node.scrollIntoView({ block: "center" });
      revealedSearchMessageId.current = match.messageId;
    } else if (
      onOpenTarget !== undefined &&
      revealedSearchMessageId.current !== match.messageId
    ) {
      revealedSearchMessageId.current = match.messageId;
      onOpenTarget(match.target);
    }
  }, [onOpenTarget, replies, root, searchIndex, searchMatches, searchOpen]);
  useEffect(() => {
    if (!followersOpen && !overflowOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (followersOpen && !followersOwnerRef.current?.contains(event.target))
        setFollowersOpen(false);
      if (overflowOpen && !overflowOwnerRef.current?.contains(event.target))
        setOverflowOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
    };
  }, [followersOpen, overflowOpen]);

  function closeThreadLayerOnEscape(
    event: ReactKeyboardEvent<HTMLDivElement>,
    layer: "followers" | "overflow",
  ) {
    moveMenuFocus(event);
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (layer === "followers") {
      setFollowersOpen(false);
      followersTriggerRef.current?.focus();
    } else {
      setOverflowOpen(false);
      overflowTriggerRef.current?.focus();
    }
  }
  useEffect(() => {
    const closeThreadOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (messageSelection.active) return;
      const target = event.target;
      if (
        !(target instanceof Node) ||
        !threadPanelRef.current?.contains(target)
      )
        return;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeThreadOnEscape);
    return () => window.removeEventListener("keydown", closeThreadOnEscape);
  }, [messageSelection.active, onClose]);
  useEffect(() => {
    if (followersOpen) followersDialogRef.current?.focus();
  }, [followersOpen]);
  useEffect(() => {
    if (!focusedMessageId) {
      positionedMessage.current = undefined;
      return;
    }
    if (positionedMessage.current === focusedMessageId) return;
    const node = messagesElement.current?.querySelector(
      `[data-message-id="${CSS.escape(focusedMessageId)}"]`,
    );
    if (!node) return;
    node.scrollIntoView({ block: "center" });
    positionedMessage.current = focusedMessageId;
  }, [focusedMessageId, replies, root]);
  async function follow(value: boolean) {
    if (!onFollow || pending) return;
    setPending(true);
    try {
      await onFollow(value);
      setFollowing(value);
      setSubmitError(undefined);
    } catch (caught) {
      setSubmitError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }
  async function removeFollower(agent: WorkspaceAgentView) {
    if (!onRemoveFollower || followerPendingIds.has(agent.participantId))
      return;
    setFollowerPendingIds((current) =>
      new Set(current).add(agent.participantId),
    );
    try {
      const result = await onRemoveFollower(agent.participantId);
      if (!result.removed) throw new Error("该 Agent 已不再关注此消息列");
      setRemovedFollowers((current) => [
        ...current.filter(
          ({ agent: removed }) => removed.participantId !== agent.participantId,
        ),
        { agent, undoToken: result.undoToken },
      ]);
      setFollowerActionError(undefined);
      const delay = Math.max(0, Date.parse(result.undoExpiresAt) - Date.now());
      const previousTimer = followerUndoTimers.current.get(agent.participantId);
      if (previousTimer !== undefined) window.clearTimeout(previousTimer);
      followerUndoTimers.current.set(
        agent.participantId,
        window.setTimeout(() => {
          setRemovedFollowers((current) =>
            current.filter(({ undoToken }) => undoToken !== result.undoToken),
          );
          followerUndoTimers.current.delete(agent.participantId);
        }, delay),
      );
    } catch (caught) {
      setFollowerActionError(errorMessage(caught));
    } finally {
      setFollowerPendingIds((current) => {
        const next = new Set(current);
        next.delete(agent.participantId);
        return next;
      });
    }
  }
  async function restoreFollower(pending: {
    agent: WorkspaceAgentView;
    undoToken: string;
  }) {
    if (!onRestoreFollower) return;
    setFollowerPendingIds((current) =>
      new Set(current).add(pending.agent.participantId),
    );
    try {
      await onRestoreFollower({
        participantId: pending.agent.participantId,
        undoToken: pending.undoToken,
      });
      setRemovedFollowers((current) =>
        current.filter(({ undoToken }) => undoToken !== pending.undoToken),
      );
      const timer = followerUndoTimers.current.get(pending.agent.participantId);
      if (timer !== undefined) window.clearTimeout(timer);
      followerUndoTimers.current.delete(pending.agent.participantId);
      setFollowerActionError(undefined);
    } catch (caught) {
      setFollowerActionError(errorMessage(caught));
    } finally {
      setFollowerPendingIds((current) => {
        const next = new Set(current);
        next.delete(pending.agent.participantId);
        return next;
      });
    }
  }
  async function loadEarlierReplies() {
    if (!onLoadEarlier || earlierRepliesLoading) return;
    const element = messagesElement.current;
    const previousHeight = element?.scrollHeight ?? 0;
    const previousTop = element?.scrollTop ?? 0;
    await onLoadEarlier();
    requestAnimationFrame(() => {
      if (element)
        element.scrollTop = previousTop + element.scrollHeight - previousHeight;
    });
  }
  function moveMenuFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "button:not([disabled])",
      ),
    ];
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowUp"
            ? (current - 1 + items.length) % items.length
            : (current + 1) % items.length;
    items[index]?.focus();
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = body.trim();
    if (
      (value === "" && fileUploads.rows.length === 0) ||
      pending ||
      !canReply ||
      fileUploads.rows.some((row) => row.status !== "ready")
    )
      return;
    setPending(true);
    try {
      const submittedFiles = fileUploads.rows;
      await onSubmit(
        value,
        submittedFiles.flatMap((row) =>
          row.attachmentId ? [row.attachmentId] : [],
        ),
      );
      if (uploadDraftKey)
        fileUploads.store?.accept(
          uploadDraftKey,
          submittedFiles.map((row) => row.id),
        );
      acceptDraft();
      setSubmitError(undefined);
    } catch (caught) {
      setSubmitError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  const displayedFollowing = following ?? humanFollowing ?? false;
  return (
    <aside
      className="thread thread-side-column"
      aria-label="Thread 讨论"
      data-testid="thread-side-column"
      ref={threadPanelRef}
    >
      {resizer}
      <PanelHeader kind="thread" className="rah-thread-head">
        <button
          className="rah-thread-title"
          data-testid="thread-scroll-to-top"
          onClick={() => messagesElement.current?.scrollTo({ top: 0 })}
          type="button"
        >
          <b>消息列</b>
          <span className="thread-sub">
            — {roomKind === "direct" ? "@" : "#"}
            {roomName ?? "room"}
          </span>
        </button>
        <div className="rah-thread-head-actions">
          {followers.length > 0 || followersLoading || followersError ? (
            <div className="rah-thread-menu-owner" ref={followersOwnerRef}>
              <button
                aria-label={`正在关注的 Agent：${followers.length}`}
                aria-expanded={followersOpen}
                className="rah-thread-followers-trigger"
                data-testid="thread-followers-header-trigger"
                onClick={() => {
                  setFollowersOpen((open) => !open);
                  setOverflowOpen(false);
                }}
                title="正在关注的 Agent"
                type="button"
                ref={followersTriggerRef}
              >
                {followersError ? (
                  <Icon name="circle-question-mark" />
                ) : (
                  <>
                    {followers.slice(0, 3).map((agent) => (
                      <AgentAvatar
                        agent={agent}
                        key={agent.participantId}
                        showStatus={false}
                        size="compact"
                      />
                    ))}
                    <span>{followersLoading ? "…" : followers.length}</span>
                  </>
                )}
              </button>
              {followersOpen ? (
                <div
                  aria-label="正在关注的 Agent"
                  className="rah-thread-followers-popover"
                  onKeyDown={(event) =>
                    closeThreadLayerOnEscape(event, "followers")
                  }
                  ref={followersDialogRef}
                  role="dialog"
                  tabIndex={-1}
                >
                  <strong>正在关注的 Agent</strong>
                  {followersError || followerActionError ? (
                    <>
                      <p role="alert">
                        {followersError ?? followerActionError}
                      </p>
                      {followersError && onRefreshFollowers ? (
                        <button
                          className="rah-thread-followers-retry"
                          onClick={onRefreshFollowers}
                          type="button"
                        >
                          重试
                        </button>
                      ) : null}
                    </>
                  ) : followers.length === 0 ? (
                    <p>暂无 Agent 正在关注。</p>
                  ) : (
                    followers.map((agent) => (
                      <div
                        className="rah-thread-follower-row"
                        key={agent.participantId}
                      >
                        <AgentAvatar
                          agent={agent}
                          showStatus={false}
                          size="member"
                        />
                        <span className="rah-thread-follower-copy">
                          <b>{agent.displayName}</b>
                          <small>
                            {agent.runtimeLabels[0] ?? agent.handle}
                          </small>
                        </span>
                        {followersCanManage && onRemoveFollower ? (
                          <button
                            aria-label={`移除 ${agent.displayName}`}
                            disabled={followerPendingIds.has(
                              agent.participantId,
                            )}
                            onClick={() => void removeFollower(agent)}
                            type="button"
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="rah-thread-menu-owner" ref={overflowOwnerRef}>
            <PanelHeaderAction
              aria-expanded={overflowOpen}
              aria-label="消息列操作"
              className="rah-thread-overflow"
              data-testid="thread-overflow-trigger"
              onClick={() => {
                setOverflowOpen((open) => !open);
                setFollowersOpen(false);
              }}
              type="button"
              ref={overflowTriggerRef}
            >
              <span aria-hidden="true">⋮</span>
            </PanelHeaderAction>
            {overflowOpen ? (
              <div
                className="rah-thread-overflow-menu"
                onKeyDown={(event) =>
                  closeThreadLayerOnEscape(event, "overflow")
                }
                role="menu"
              >
                <button
                  autoFocus
                  onClick={() => {
                    setSearchOpen(true);
                    setOverflowOpen(false);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Icon name="search" /> 在消息列中搜索
                </button>
                <button
                  disabled={onViewInChannel === undefined}
                  onClick={() => {
                    onViewInChannel?.();
                    setOverflowOpen(false);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Icon name="pin" /> 在频道中查看
                </button>
                {onFollow ? (
                  <button
                    disabled={pending}
                    onClick={() => {
                      void follow(!displayedFollowing);
                      setOverflowOpen(false);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <Icon name="bell" />
                    {displayedFollowing ? "取消关注消息列" : "关注消息列"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <PanelHeaderAction
            aria-label="关闭消息列"
            className="rah-thread-close"
            onClick={onClose}
            title="关闭消息列"
            type="button"
          >
            <span className="rah-close-glyph" aria-hidden="true">
              ×
            </span>
          </PanelHeaderAction>
        </div>
      </PanelHeader>
      {searchOpen ? (
        <div className="rah-thread-search">
          <Icon name="search" />
          <input
            aria-label="在消息列中搜索"
            autoFocus
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setSearchIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setSearchOpen(false);
              } else if (event.key === "Enter" && searchMatches.length > 0) {
                event.preventDefault();
                setSearchIndex((current) =>
                  event.shiftKey
                    ? (current - 1 + searchMatches.length) %
                      searchMatches.length
                    : (current + 1) % searchMatches.length,
                );
              }
            }}
            placeholder="在消息列中搜索"
            value={searchQuery}
          />
          <span>
            {searchLoading
              ? "…"
              : searchMatches.length === 0
                ? "0/0"
                : `${searchIndex + 1}/${searchMatches.length}`}
          </span>
          <button
            aria-label="上一个搜索结果"
            disabled={searchMatches.length === 0}
            onClick={() =>
              setSearchIndex((current) =>
                searchMatches.length === 0
                  ? 0
                  : (current - 1 + searchMatches.length) % searchMatches.length,
              )
            }
            type="button"
          >
            ↑
          </button>
          <button
            aria-label="下一个搜索结果"
            disabled={searchMatches.length === 0}
            onClick={() =>
              setSearchIndex((current) =>
                searchMatches.length === 0
                  ? 0
                  : (current + 1) % searchMatches.length,
              )
            }
            type="button"
          >
            ↓
          </button>
          <button
            aria-label="关闭消息列搜索"
            onClick={() => setSearchOpen(false)}
            type="button"
          >
            ×
          </button>
          {searchError === undefined ? null : (
            <span className="rah-thread-search-error" role="alert">
              {searchError}
            </span>
          )}
        </div>
      ) : null}
      <section className="messages rah-scroll-main" ref={messagesElement}>
        {root === undefined ? (
          <p className="rah-empty-copy">原消息尚未载入。</p>
        ) : (
          <div className="rah-thread-parent" data-testid="thread-panel-parent">
            <MessageArticle
              client={client}
              canManageTask={
                task !== undefined &&
                (canManageAnyTask ||
                  task.creatorId === currentPrincipal?.principalId)
              }
              collapseLongMessages={collapseLongMessages}
              contextRoomId={roomId}
              contextThreadId={threadId}
              highlightQuery={searchOpen ? searchQuery : undefined}
              message={root}
              mentionReadStates={mentionReadStatesByMessage.get(root.messageId)}
              navigationTarget={messageNavigationTarget(
                root,
                roomId,
                threadId,
                root.messageId,
              )}
              {...(roomId === undefined
                ? {}
                : {
                    selection: {
                      active: messageSelection.active,
                      onEnter: () =>
                        messageSelection.selection.enterThread(
                          roomId,
                          root.messageId,
                          [root.messageId],
                        ),
                      onToggle: () =>
                        messageSelection.selection.toggleWithThread(
                          root.messageId,
                          replies.map(({ messageId }) => messageId),
                        ),
                      selected:
                        messageSelection.active &&
                        messageSelection.selection.selectedIds.includes(
                          root.messageId,
                        ),
                    },
                  })}
              messageAgent={messageAgents.find(
                (agent) => agent.participantId === root.actorId,
              )}
              onMention={mention}
              onOpenTarget={onOpenTarget}
              referenceAgents={messageAgents}
              referenceComputers={referenceComputers}
              referenceCurrentPrincipal={currentPrincipal}
              referencePrincipals={roomMembers}
              referenceRooms={referenceRooms}
              referenceTasks={referenceTasks}
              referenceThreads={
                roomId === undefined ||
                roomKind === undefined ||
                root === undefined ||
                threadId === undefined
                  ? []
                  : [
                      {
                        roomId,
                        roomKind,
                        roomName:
                          referenceRooms.find(
                            (candidate) => candidate.roomId === roomId,
                          )?.names[0] ??
                          roomName ??
                          roomId,
                        rootMessageId: root.messageId,
                        threadId,
                      },
                    ]
              }
              focused={
                root.messageId === focusedMessageId ||
                root.messageId === activeSearchMessageId
              }
              {...(task === undefined ? {} : { task })}
              {...(task === undefined
                ? {}
                : { taskWorkflowAction: () => onTaskWorkflow(task) })}
              {...(taskAgent === undefined ? {} : { taskAgent })}
            />
          </div>
        )}
        {hasEarlierReplies ? (
          <button
            className="rah-message-history-trigger rah-thread-load-earlier"
            disabled={earlierRepliesLoading}
            onClick={() => void loadEarlierReplies()}
            type="button"
          >
            {earlierRepliesLoading ? "正在载入更早回复…" : "载入更早回复"}
          </button>
        ) : replies.length === 0 ? (
          <div className="rah-thread-empty-replies">暂无回复</div>
        ) : (
          <div className="rah-thread-history-heading">
            <div className="rah-thread-beginning">回复的开头</div>
            <div className="rah-thread-divider">
              {String(replies.length)} 条回复
            </div>
          </div>
        )}
        {loading && replies.length === 0 ? (
          <p className="rah-empty-copy">正在同步 Thread…</p>
        ) : null}
        {replyTimeline.map((item) =>
          item.kind === "reminder-fired" ? (
            <p
              className="rah-chat-system-notice"
              key={`reminder:${item.eventId}`}
            >
              <NavigationReceiptLink
                {...(onOpenTarget === undefined ? {} : { onOpenTarget })}
                target={item.target}
                text={item.text}
              />
            </p>
          ) : (
            <MessageArticle
              client={client}
              collapseLongMessages={collapseLongMessages}
              highlightQuery={searchOpen ? searchQuery : undefined}
              key={item.message.messageId}
              message={item.message}
              mentionReadStates={mentionReadStatesByMessage.get(
                item.message.messageId,
              )}
              navigationTarget={messageNavigationTarget(
                item.message,
                roomId,
                threadId,
                root?.messageId,
              )}
              {...(roomId === undefined || root === undefined
                ? {}
                : {
                    selection: {
                      active: messageSelection.active,
                      onEnter: () =>
                        messageSelection.selection.enterThread(
                          roomId,
                          root.messageId,
                          [item.message.messageId],
                        ),
                      onToggle: () =>
                        messageSelection.selection.toggle(
                          item.message.messageId,
                        ),
                      selected:
                        messageSelection.active &&
                        messageSelection.selection.selectedIds.includes(
                          item.message.messageId,
                        ),
                    },
                  })}
              messageAgent={messageAgents.find(
                (agent) => agent.participantId === item.message.actorId,
              )}
              onMention={mention}
              onOpenTarget={onOpenTarget}
              referenceAgents={messageAgents}
              referenceComputers={referenceComputers}
              referenceCurrentPrincipal={currentPrincipal}
              referencePrincipals={roomMembers}
              referenceRooms={referenceRooms}
              referenceTasks={referenceTasks}
              referenceThreads={
                roomId === undefined ||
                roomKind === undefined ||
                root === undefined ||
                threadId === undefined
                  ? []
                  : [
                      {
                        roomId,
                        roomKind,
                        roomName:
                          referenceRooms.find(
                            (candidate) => candidate.roomId === roomId,
                          )?.names[0] ??
                          roomName ??
                          roomId,
                        rootMessageId: root.messageId,
                        threadId,
                      },
                    ]
              }
              focused={
                item.message.messageId === focusedMessageId ||
                item.message.messageId === activeSearchMessageId
              }
            />
          ),
        )}
      </section>
      {removedFollowers.length === 0 ? null : (
        <div className="rah-thread-follower-undo-list">
          {removedFollowers.map((removedFollower) => (
            <div
              className="rah-thread-follower-undo"
              key={removedFollower.undoToken}
              role="status"
            >
              <span>已移除 {removedFollower.agent.displayName}</span>
              <button
                disabled={followerPendingIds.has(
                  removedFollower.agent.participantId,
                )}
                onClick={() => void restoreFollower(removedFollower)}
                type="button"
              >
                撤销
              </button>
            </div>
          ))}
        </div>
      )}
      {messageSelection.active ? (
        <MessageSelectionToolbar
          allSelected={messageSelection.allSelected}
          error={messageSelection.error}
          onCancel={messageSelection.selection.exit}
          onCopyLinks={() => void messageSelection.copy("links")}
          onCopyMarkdown={() => void messageSelection.copy("markdown")}
          {...(canForward ? { onForward: messageSelection.openForward } : {})}
          onSelectAll={() =>
            messageSelection.selection.selectAll(
              messageSelection.allSelected
                ? []
                : messageSelection.selectableMessageIds,
            )
          }
          selectedCount={messageSelection.selection.selectedIds.length}
        />
      ) : (
        <>
          {submitError === undefined ? null : (
            <div className="rah-inline-error">{submitError}</div>
          )}
          <ComposerDropForm
            roomId={roomId}
            draftKey={uploadDraftKey}
            disabled={pending || !canReply || !canAttachFiles}
            onSubmit={submit}
          >
            <ComposerMentionMenu
              activeIndex={composerMention.activeIndex}
              agents={composerMention.candidates}
              id="thread-composer-mentions"
              onSelect={composerMention.select}
              open={composerMention.open}
            />
            <div className="composer-box">
              <textarea
                aria-activedescendant={composerMention.activeDescendant}
                aria-autocomplete="list"
                aria-controls="thread-composer-mentions"
                aria-expanded={composerMention.open}
                aria-label="Thread 回复输入框"
                ref={composerRef}
                disabled={!canReply}
                onBlur={composerMention.onBlur}
                onChange={composerMention.onChange}
                onClick={(event) =>
                  composerMention.onSelectionChange(event.currentTarget)
                }
                onFocus={composerMention.onFocus}
                onKeyDown={(event) => {
                  composerMention.onKeyDown(event);
                  handleComposerKeyDown(event);
                }}
                onKeyUp={(event) =>
                  composerMention.onSelectionChange(event.currentTarget)
                }
                placeholder={
                  canReply
                    ? "发送消息至消息列"
                    : "Thread write capability 不可用"
                }
                rows={3}
                value={body}
              />
              <div className="composer-bar">
                <ComposerFiles
                  roomId={roomId}
                  draftKey={uploadDraftKey}
                  disabled={pending || !canReply || !canAttachFiles}
                />
                <span className="composer-spacer" />
                <button
                  className="send-btn"
                  type="submit"
                  disabled={
                    !canReply ||
                    (body.trim() === "" && fileUploads.rows.length === 0) ||
                    fileUploads.rows.some((row) => row.status !== "ready") ||
                    pending
                  }
                  title="回复"
                >
                  <Icon name="send" />
                </button>
              </div>
            </div>
          </ComposerDropForm>
        </>
      )}
      {messageSelection.forwardOpen && roomId !== undefined ? (
        <MessageForwardDialog
          client={client}
          onClose={messageSelection.closeForward}
          onComplete={() => {
            messageSelection.closeForward();
            messageSelection.selection.exit();
          }}
          sourceMessageIds={messageSelection.resolved.messages.map(
            ({ messageId }) => messageId,
          )}
          sourceRoomId={roomId}
        />
      ) : null}
    </aside>
  );
}

function NavigationReceiptLink({
  onOpenTarget,
  target,
  text,
}: {
  onOpenTarget?: (target: NavigationTarget) => void;
  target: Extract<NavigationTarget, { kind: "message" }>;
  text: string;
}) {
  return (
    <a
      href={navigationSearch({ target })}
      onClick={(event) => {
        if (onOpenTarget === undefined || !shouldHandleClientNavigation(event))
          return;
        event.preventDefault();
        onOpenTarget(target);
      }}
    >
      {text}
    </a>
  );
}

export function TaskPane({
  agents,
  canManageAnyTask,
  canOpenThread,
  canWrite,
  caughtUp,
  client,
  columns,
  currentPrincipalId,
  earlierTasksLoading,
  hasEarlierTasks,
  loading,
  onChanged,
  onCreate,
  onLoadEarlierTasks,
  onOpenThread,
  roomName,
}: {
  agents: readonly WorkspaceAgentView[];
  canManageAnyTask: boolean;
  canOpenThread: boolean;
  canWrite: boolean;
  caughtUp: boolean;
  client: RahClient;
  columns: ReturnType<typeof createRoomViewModel>["taskColumns"];
  currentPrincipalId: string | undefined;
  earlierTasksLoading: boolean;
  hasEarlierTasks: boolean;
  loading: boolean;
  onChanged: () => void;
  onCreate: () => void;
  onLoadEarlierTasks: () => Promise<void>;
  onOpenThread: (task: Task) => Promise<void>;
  roomName: string;
}) {
  const [creatorFilterId, setCreatorFilterId] = useState<string>();
  const [assigneeFilterId, setAssigneeFilterId] = useState<
    string | null | undefined
  >();
  const [view, setView] = useState<TaskViewMode>("board");
  const visibleColumns = columns.map((column) => ({
    ...column,
    tasks: column.tasks.filter((task) =>
      taskMatchesFilters(task, {
        ...(assigneeFilterId === undefined
          ? {}
          : { assigneeId: assigneeFilterId }),
        ...(creatorFilterId === undefined
          ? {}
          : { creatorId: creatorFilterId }),
      }),
    ),
  }));
  const visibleTasks = visibleColumns.flatMap((column) => column.tasks);
  const filtersActive =
    creatorFilterId !== undefined || assigneeFilterId !== undefined;
  const taskItems = visibleTasks.map((task) => ({
    canManageAnyTask,
    roomName,
    task,
  }));

  return (
    <div className="chan-pane">
      <TaskToolbar
        agents={agents}
        assigneeId={assigneeFilterId}
        creatorId={creatorFilterId}
        currentPrincipalId={currentPrincipalId}
        onAssigneeChange={setAssigneeFilterId}
        onCreate={onCreate}
        onCreatorChange={setCreatorFilterId}
        onViewChange={setView}
        view={view}
        writeEnabled={canWrite && caughtUp}
      />
      <div className="rah-room-task-pages">
        {visibleTasks.length === 0 && !loading ? (
          <div className="tasks-content">
            <EmptyState
              context="task"
              placement="fill"
              icon="task"
              title={filtersActive ? "没有符合此筛选的任务" : "暂无任务"}
              description={
                filtersActive
                  ? "换一个筛选组合，或清除当前选择。"
                  : "用「新建任务」按钮创建一个。"
              }
            />
          </div>
        ) : (
          <GlobalTaskBoard
            client={client}
            columns={visibleColumns}
            tasks={taskItems}
            view={view}
            writeEnabled={canWrite && caughtUp}
            showRoomName={false}
            onChanged={onChanged}
            onOpen={async ({ target }) => {
              if (!canOpenThread || target.kind !== "task") return false;
              const task = visibleTasks.find(
                (candidate) => candidate.taskId === target.taskId,
              );
              if (task === undefined) return false;
              await onOpenThread(task);
              return true;
            }}
          />
        )}
        {hasEarlierTasks ? (
          <button
            className="rah-message-history-trigger rah-task-history-trigger"
            disabled={earlierTasksLoading}
            onClick={() => void onLoadEarlierTasks()}
            type="button"
          >
            {earlierTasksLoading ? "正在载入更早任务…" : "载入更早任务"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function UnavailablePane({
  detail,
  title,
}: {
  detail: string;
  title: string;
}) {
  return (
    <div className="chan-pane rah-unavailable">
      <Icon name="doc" />
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}

function formatTime(value: string) {
  return formatRahDateTime(value, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "RAH OS request failed";
}
