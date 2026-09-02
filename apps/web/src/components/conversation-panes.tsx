import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import type {
  NavigationTarget,
  Room,
  RoomEvent,
  Principal,
  Task,
  TaskReview,
  TaskSubmission,
  Thread,
} from "@rah-os/protocol";
import { ChatEmptyState } from "./chat-empty-state.tsx";
import {
  useMessageSocial,
  MessageSocialButtons,
  MessageReactionSummary,
} from "./message-social.tsx";
import {
  canHumanCancelTask,
  canHumanCompleteTask,
  canHumanForceReassignTask,
  canHumanReopenTask,
  canHumanSetTaskAssignee,
  createRoomViewModel,
  taskReviewStatus,
  taskParticipantsForSelection,
  type RoomAgentTarget,
  type TaskParticipantSelection,
  type WorkspaceAgentView,
} from "@rah-os/ui-web";

import { MessageAgentAvatar } from "./agent-message-identity.tsx";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";
import { insertMention } from "../identity-presentation.ts";
import { Icon } from "./icon.tsx";
import { MessageMarkdown } from "./message-markdown.tsx";
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
import { TaskCloseDialog, TaskReassignDialog } from "./task-dialogs.tsx";
import { taskMatchesFilters } from "../task-presentation.ts";
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

export type ThreadReplyPreview = {
  author: string;
  body: string;
  createdAt: string;
  messageId: string;
  threadId: string;
};

export function ChatPane({
  focusedMessageId,
  onReadThrough,
  agents,
  canCreateTask,
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
  onLoadEarlier,
  onOpenThread,
  onOpenTarget,
  onSubmit,
  roomName,
  roomKind,
  roomId,
  tasks,
  threadReplyPreviews,
  threads,
}: {
  focusedMessageId?: string | undefined;
  onReadThrough?: ((throughSeq: number) => Promise<void>) | undefined;
  agents: readonly RoomAgentTarget[];
  canCreateTask: boolean;
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
  onLoadEarlier: () => Promise<void>;
  onOpenThread: (rootMessageId: string) => Promise<void>;
  onOpenTarget?: (target: NavigationTarget) => void;
  onSubmit: (
    body: string,
    asTask: boolean,
    taskParticipants: TaskParticipantSelection,
    attachmentIds?: string[],
  ) => Promise<void>;
  roomName: string | undefined;
  roomKind: Room["kind"] | undefined;
  roomId: string | undefined;
  tasks: readonly Task[];
  threadReplyPreviews: readonly ThreadReplyPreview[];
  threads: readonly Thread[];
}) {
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
                  collapseLongMessages={collapseLongMessages}
                  onMention={mention}
                  focused={message.messageId === focusedMessageId}
                  message={message}
                  {...(messageAgent === undefined ? {} : { messageAgent })}
                  {...(messagePrincipal === undefined
                    ? {}
                    : { messagePrincipal })}
                  {...(task === undefined ? {} : { task })}
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
                          onClick: () => void onOpenThread(message.messageId),
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
      {asTask ? (
        <AgentTargetSelector
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
      <form className="composer" onSubmit={submit}>
        <div className="composer-box">
          <textarea
            aria-label="消息输入框"
            onKeyDown={handleComposerKeyDown}
            ref={composerRef}
            disabled={!canPost && !canCreateTask}
            onChange={(event) => setBody(event.target.value)}
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
      </form>
    </div>
  );
}

function AgentTargetSelector({
  agents,
  assigneeId,
  collaboratorIds,
  onAssigneeChange,
  onCollaboratorsChange,
  onManageAgents,
  onReviewersChange,
  reviewerIds,
  taskTargetIssue,
}: {
  agents: readonly RoomAgentTarget[];
  assigneeId: string | undefined;
  collaboratorIds: readonly string[];
  onAssigneeChange: (participantId: string | undefined) => void;
  onCollaboratorsChange: (participantIds: string[]) => void;
  onManageAgents: () => void;
  onReviewersChange: (participantIds: string[]) => void;
  reviewerIds: readonly string[];
  taskTargetIssue: string | undefined;
}) {
  const collaborators = new Set(collaboratorIds);
  const reviewers = new Set(reviewerIds);
  const owner = agents.find(
    ({ participantId }) => participantId === assigneeId,
  );
  const summary =
    owner === undefined
      ? agents.length === 0
        ? "创建未指派任务（当前 Room 无 Agent）"
        : "开放任务：全部 Room Agents 可竞争，但只有一个 Agent 能认领"
      : `${owner.handle} 负责 · ${String(collaborators.size)} 协作 · ${String(reviewers.size)} 审阅`;
  const toggle = (
    current: Set<string>,
    participantId: string,
    onChange: (participantIds: string[]) => void,
  ) => {
    const next = new Set(current);
    if (next.has(participantId)) next.delete(participantId);
    else next.add(participantId);
    onChange([...next].sort());
  };
  return (
    <section className="rah-agent-targets" aria-label="任务目标 Agents">
      <header>
        <span>
          <Icon name="members" />
          任务协作角色
        </span>
        {agents.length === 0 ? (
          <button className="rah-target-link" onClick={onManageAgents}>
            添加本机 Agent
          </button>
        ) : (
          <label className="rah-task-owner-select">
            <span>负责人</span>
            <select
              aria-label="任务负责人"
              onChange={(event) =>
                onAssigneeChange(event.target.value || undefined)
              }
              value={assigneeId ?? ""}
            >
              <option value="">开放竞争</option>
              {agents.map((agent) => (
                <option key={agent.participantId} value={agent.participantId}>
                  {agent.handle}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      {agents.length === 0 ? (
        <p>当前 Room 尚未设置 Agent；消息会保留，但不会拉起任何 CLI。</p>
      ) : (
        <div className="rah-task-role-groups">
          <TaskRoleChoices
            agents={agents}
            disabled={assigneeId === undefined}
            label="协作者"
            onToggle={(participantId) =>
              toggle(collaborators, participantId, onCollaboratorsChange)
            }
            ownerId={assigneeId}
            selected={collaborators}
          />
          <TaskRoleChoices
            agents={agents}
            disabled={assigneeId === undefined}
            label="审阅者"
            onToggle={(participantId) =>
              toggle(reviewers, participantId, onReviewersChange)
            }
            ownerId={assigneeId}
            selected={reviewers}
          />
        </div>
      )}
      <p className={taskTargetIssue === undefined ? undefined : "is-error"}>
        {taskTargetIssue ?? summary}
      </p>
    </section>
  );
}

function TaskRoleChoices({
  agents,
  disabled,
  label,
  onToggle,
  ownerId,
  selected,
}: {
  agents: readonly RoomAgentTarget[];
  disabled: boolean;
  label: string;
  onToggle: (participantId: string) => void;
  ownerId: string | undefined;
  selected: ReadonlySet<string>;
}) {
  return (
    <fieldset className="rah-task-role-group" disabled={disabled}>
      <legend>{label}</legend>
      <div className="rah-agent-target-list">
        {agents
          .filter(({ participantId }) => participantId !== ownerId)
          .map((agent) => (
            <label
              className={selected.has(agent.participantId) ? "is-selected" : ""}
              key={agent.participantId}
            >
              <input
                checked={selected.has(agent.participantId)}
                onChange={() => onToggle(agent.participantId)}
                type="checkbox"
              />
              <span>{agent.handle}</span>
            </label>
          ))}
      </div>
    </fieldset>
  );
}

type MessageView = ReturnType<typeof createRoomViewModel>["messages"][number];

function ChatDateDivider({ label }: { label: string }) {
  return (
    <div className="rah-chat-date-divider" role="separator">
      <span aria-hidden="true" />
      <time>{label}</time>
    </div>
  );
}

function MessageArticle({
  collapseLongMessages = true,
  focused = false,
  convertTaskAction,
  message,
  messageAgent,
  messagePrincipal,
  onMention,
  task,
  threadAction,
  threadReplies,
  threadReplyCount,
}: {
  collapseLongMessages?: boolean;
  focused?: boolean;
  convertTaskAction?: () => Promise<void>;
  message: MessageView;
  messageAgent?: WorkspaceAgentView | undefined;
  messagePrincipal?: Principal | undefined;
  onMention?: (handle: string) => void;
  task?: Task;
  threadAction?: { onClick: () => void };
  threadReplies?: readonly ThreadReplyPreview[];
  threadReplyCount?: number;
}) {
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const social = useMessageSocial(message);
  const [contextMenu, setContextMenu] = useState<{
    left: number;
    top: number;
  }>();
  const [conversionPending, setConversionPending] = useState(false);
  const [conversionError, setConversionError] = useState<string>();
  useEffect(() => {
    if (contextMenu === undefined) return;
    const closeOutside = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) {
        setContextMenu(undefined);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(undefined);
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  async function convertToTask() {
    if (convertTaskAction === undefined || conversionPending) return;
    setConversionPending(true);
    try {
      await convertTaskAction();
      setContextMenu(undefined);
      setConversionError(undefined);
    } catch (caught) {
      setConversionError(errorMessage(caught));
    } finally {
      setConversionPending(false);
    }
  }

  return (
    <article
      className="msg"
      data-message-id={message.messageId}
      data-focused={focused}
      onContextMenu={
        convertTaskAction === undefined
          ? undefined
          : (event) => {
              event.preventDefault();
              setConversionError(undefined);
              setContextMenu({
                left: Math.min(event.clientX, window.innerWidth - 190),
                top: Math.min(event.clientY, window.innerHeight - 56),
              });
            }
      }
    >
      {messageAgent === undefined ? (
        messagePrincipal?.avatarKey ? (
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
      {threadAction === undefined && !social.enabled ? null : (
        <div className="msg-actions">
          {threadAction && (
            <button
              aria-label="在消息列中回复"
              className="msg-action-btn"
              onClick={threadAction.onClick}
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
        {task === undefined ? null : (
          <div className="rah-message-task-meta">
            <span>Task #{task.taskNumber}</span>
            <span>{task.state}</span>
          </div>
        )}
        <CollapsibleMessage
          collapse={collapseLongMessages}
          messageId={message.messageId}
        >
          <MessageMarkdown source={message.body} />
        </CollapsibleMessage>
        <MessageAttachments attachments={message.attachments} />
        <MessageReactionSummary view={social} />
        {threadAction === undefined || threadReplyCount === undefined ? null : (
          <button className="thread-preview" onClick={threadAction.onClick}>
            <span className="tp-toggle">
              {String(threadReplyCount)} 条回复 ›
            </span>
            {threadReplies?.map((reply) => (
              <span className="tp-line" key={reply.messageId}>
                <span className="avatar xs rah-avatar" aria-hidden="true">
                  {reply.author.slice(0, 1).toUpperCase()}
                </span>
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
      {contextMenu === undefined ? null : (
        <div
          className="rah-message-context-menu"
          ref={contextMenuRef}
          role="menu"
          style={contextMenu}
        >
          <button
            autoFocus
            disabled={conversionPending}
            onClick={() => void convertToTask()}
            role="menuitem"
          >
            <Icon name="task" />
            {conversionPending ? "Converting…" : "Convert to Task"}
          </button>
        </div>
      )}
    </article>
  );
}

export function ThreadPane({
  messageAgents = [],
  focusedMessageId,
  onReadThrough,
  canAttachFiles = false,
  canReply,
  loading,
  onClose,
  onSubmit,
  onFollow,
  onOpenTarget,
  replies,
  roomEvents = [],
  roomId,
  roomKind,
  roomName,
  root,
  threadId,
}: {
  messageAgents?: readonly WorkspaceAgentView[];
  focusedMessageId?: string | undefined;
  onReadThrough?: ((throughSeq: number) => Promise<void>) | undefined;
  canAttachFiles?: boolean;
  canReply: boolean;
  loading: boolean;
  onClose: () => void;
  onSubmit: (body: string, attachmentIds?: string[]) => Promise<void>;
  onFollow?: ((following: boolean) => Promise<void>) | undefined;
  onOpenTarget?: (target: NavigationTarget) => void;
  replies: ReturnType<typeof createRoomViewModel>["messages"];
  roomEvents?: readonly RoomEvent[];
  roomId?: string | undefined;
  roomKind?: Room["kind"] | undefined;
  roomName: string | undefined;
  root: MessageView | undefined;
  threadId?: string | undefined;
}) {
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
  const [following, setFollowing] = useState<boolean>();
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
    positionedMessage.current = undefined;
  }, [root?.messageId]);
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

  return (
    <aside className="thread" aria-label="Thread 讨论">
      <header className="thread-head">
        <h2>
          消息列{" "}
          <span className="thread-sub">
            — {roomKind === "direct" ? "@" : "#"}
            {roomName ?? "room"}
          </span>
        </h2>
        {onFollow && (
          <button
            className="btn rah-thread-follow"
            disabled={pending}
            aria-label={following === true ? "取消关注消息列" : "关注消息列"}
            onClick={() => void follow(following !== true)}
          >
            <Icon name="bell" />
            {following === true ? "已关注" : "关注"}
          </button>
        )}
        <button className="sq-btn" onClick={onClose} title="关闭 Thread">
          <span className="rah-close-glyph" aria-hidden="true">
            ×
          </span>
        </button>
      </header>
      <section className="messages rah-scroll-main" ref={messagesElement}>
        {root === undefined ? (
          <p className="rah-empty-copy">原消息尚未载入。</p>
        ) : (
          <MessageArticle
            collapseLongMessages={collapseLongMessages}
            message={root}
            messageAgent={messageAgents.find(
              (agent) => agent.participantId === root.actorId,
            )}
            onMention={mention}
            focused={root.messageId === focusedMessageId}
          />
        )}
        <div className="rah-thread-divider">
          {replies.length === 0
            ? "暂无回复"
            : `${String(replies.length)} 条回复`}
        </div>
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
              collapseLongMessages={collapseLongMessages}
              key={item.message.messageId}
              message={item.message}
              messageAgent={messageAgents.find(
                (agent) => agent.participantId === item.message.actorId,
              )}
              onMention={mention}
              focused={item.message.messageId === focusedMessageId}
            />
          ),
        )}
      </section>
      {submitError === undefined ? null : (
        <div className="rah-inline-error">{submitError}</div>
      )}
      <form className="composer" onSubmit={submit}>
        <div className="composer-box">
          <textarea
            aria-label="Thread 回复输入框"
            onKeyDown={handleComposerKeyDown}
            ref={composerRef}
            disabled={!canReply}
            onChange={(event) => setBody(event.target.value)}
            placeholder={
              canReply ? "发送消息至消息列" : "Thread write capability 不可用"
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
      </form>
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
  canOpenThread,
  canWrite,
  canReassign,
  caughtUp,
  columns,
  currentPrincipalId,
  agents,
  loading,
  onCreate,
  onCancel,
  onComplete,
  onOpenThread,
  onReopen,
  onReassign,
  onSetAssignee,
  reviews,
  submissions,
}: {
  agents: readonly RoomAgentTarget[];
  canOpenThread: boolean;
  canReassign: boolean;
  canWrite: boolean;
  caughtUp: boolean;
  columns: ReturnType<typeof createRoomViewModel>["taskColumns"];
  currentPrincipalId: string | undefined;
  loading: boolean;
  onCreate: () => void;
  onCancel: (task: Task, reason: string) => Promise<void>;
  onComplete: (task: Task) => Promise<void>;
  onOpenThread: (task: Task) => Promise<void>;
  onReopen: (task: Task) => Promise<void>;
  onReassign: (task: Task, assigneeId: string, reason: string) => Promise<void>;
  onSetAssignee: (task: Task, assigneeId: string | undefined) => Promise<void>;
  reviews: readonly TaskReview[];
  submissions: readonly TaskSubmission[];
}) {
  const [pendingTaskId, setPendingTaskId] = useState<string>();
  const [closingTask, setClosingTask] = useState<Task>();
  const [reassigningTask, setReassigningTask] = useState<Task>();
  const [ownerMenuTaskId, setOwnerMenuTaskId] = useState<string>();
  const [actionError, setActionError] = useState<string>();
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
  const visibleTaskCount = visibleColumns.reduce(
    (count, column) => count + column.tasks.length,
    0,
  );
  const filtersActive =
    creatorFilterId !== undefined || assigneeFilterId !== undefined;

  useEffect(() => {
    if (ownerMenuTaskId === undefined) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOwnerMenuTaskId(undefined);
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target
          .closest("[data-task-owner-menu-root]")
          ?.getAttribute("data-task-owner-menu-root") === ownerMenuTaskId
      )
        return;
      setOwnerMenuTaskId(undefined);
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [ownerMenuTaskId]);

  async function complete(task: Task) {
    if (pendingTaskId !== undefined) return;
    setPendingTaskId(task.taskId);
    try {
      await onComplete(task);
      setActionError(undefined);
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setPendingTaskId(undefined);
    }
  }

  async function cancel(task: Task, reason: string) {
    if (pendingTaskId !== undefined) return;
    setPendingTaskId(task.taskId);
    try {
      await onCancel(task, reason);
      setActionError(undefined);
    } catch (caught) {
      setActionError(errorMessage(caught));
      throw caught;
    } finally {
      setPendingTaskId(undefined);
    }
  }

  async function reopen(task: Task) {
    if (pendingTaskId !== undefined) return;
    setPendingTaskId(task.taskId);
    try {
      await onReopen(task);
      setActionError(undefined);
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setPendingTaskId(undefined);
    }
  }

  async function setAssignee(task: Task, assigneeId: string | undefined) {
    if (pendingTaskId !== undefined || task.assigneeId === assigneeId) return;
    setPendingTaskId(task.taskId);
    setOwnerMenuTaskId(undefined);
    try {
      await onSetAssignee(task, assigneeId);
      setActionError(undefined);
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setPendingTaskId(undefined);
    }
  }

  async function reassign(task: Task, assigneeId: string, reason: string) {
    if (pendingTaskId !== undefined) return;
    setPendingTaskId(task.taskId);
    try {
      await onReassign(task, assigneeId, reason);
      setActionError(undefined);
    } catch (caught) {
      setActionError(errorMessage(caught));
      throw caught;
    } finally {
      setPendingTaskId(undefined);
    }
  }

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
      {actionError === undefined ? null : (
        <div className="rah-inline-error">{actionError}</div>
      )}
      {visibleTaskCount === 0 && !loading ? (
        <div className="tasks-content">
          <div className="tasks-empty">
            <span className="tasks-empty-icon">
              <Icon name="task" />
            </span>
            <h2>{filtersActive ? "没有符合此筛选的任务" : "暂无任务"}</h2>
            <p>
              {filtersActive
                ? "换一个筛选组合，或清除当前选择。"
                : "用「新建任务」按钮创建一个。"}
            </p>
          </div>
        </div>
      ) : (
        <div className={`kanban${view === "list" ? " list-mode" : ""}`}>
          {visibleColumns.map((column) => (
            <section className="kcol" key={column.id}>
              <header className={`kcol-head chip-${column.tone}`}>
                <span>{column.label}</span>
                <span className="count">{column.tasks.length}</span>
              </header>
              <div className="kcol-body">
                {column.tasks.map((task) => (
                  <article className="kcard" key={task.taskId}>
                    <span className="kcard-no">#{task.taskNumber}</span>
                    <p className="kcard-title">{task.title}</p>
                    {canHumanSetTaskAssignee({
                      caughtUp,
                      currentPrincipalId,
                      task,
                      taskWrite: canWrite,
                    }) ? (
                      <div
                        className="rah-task-owner"
                        data-task-owner-menu-root={task.taskId}
                      >
                        <button
                          aria-label={`Task #${task.taskNumber} 负责人：${task.assigneeLabel ?? "未分配"}`}
                          aria-expanded={ownerMenuTaskId === task.taskId}
                          aria-haspopup="menu"
                          className="rah-task-owner-trigger"
                          disabled={pendingTaskId !== undefined}
                          onClick={() =>
                            setOwnerMenuTaskId((current) =>
                              current === task.taskId ? undefined : task.taskId,
                            )
                          }
                          type="button"
                        >
                          <span>负责人</span>
                          <b>{task.assigneeLabel ?? "未分配"}</b>
                        </button>
                        {ownerMenuTaskId === task.taskId ? (
                          <div className="rah-task-owner-menu" role="menu">
                            <header>
                              <b>负责人</b>
                              {task.assigneeId === undefined ? null : (
                                <button
                                  onClick={() =>
                                    void setAssignee(task, undefined)
                                  }
                                  type="button"
                                >
                                  清除
                                </button>
                              )}
                            </header>
                            <div className="rah-task-owner-options">
                              <button
                                aria-checked={task.assigneeId === undefined}
                                onClick={() =>
                                  void setAssignee(task, undefined)
                                }
                                role="menuitemradio"
                                type="button"
                              >
                                <span className="rah-task-owner-icon">—</span>
                                <span>未分配</span>
                              </button>
                              {agents.map((agent) => (
                                <button
                                  aria-checked={
                                    task.assigneeId === agent.participantId
                                  }
                                  key={agent.participantId}
                                  onClick={() =>
                                    void setAssignee(task, agent.participantId)
                                  }
                                  role="menuitemradio"
                                  type="button"
                                >
                                  <span className="rah-task-owner-avatar">
                                    {agent.handle.slice(0, 1).toUpperCase()}
                                  </span>
                                  <span>{agent.handle}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : task.assigneeLabel === undefined ? null : (
                      <p className="rah-task-agent">
                        Agent · {task.assigneeLabel}
                      </p>
                    )}
                    {task.collaboratorLabels.length === 0 ? null : (
                      <p className="rah-task-agent">
                        协作 · {task.collaboratorLabels.join("、")}
                      </p>
                    )}
                    {task.reviewerLabels.length === 0 ? null : (
                      <>
                        <p className="rah-task-agent">
                          审阅 · {task.reviewerLabels.join("、")}
                        </p>
                        <TaskReviewEvidence
                          reviews={reviews}
                          submissions={submissions}
                          task={task}
                        />
                      </>
                    )}
                    {task.lastProgress === undefined ? null : (
                      <p className="rah-task-evidence">{task.lastProgress}</p>
                    )}
                    {task.submissionSummary === undefined ? null : (
                      <p className="rah-task-evidence">
                        结果：{task.submissionSummary}
                      </p>
                    )}
                    <footer className="kcard-foot">
                      <span className={`chip chip-${column.tone}`}>
                        {task.state}
                      </span>
                      {canOpenThread ? (
                        <button
                          className="rah-task-thread"
                          onClick={(event) => {
                            const trigger = event.currentTarget;
                            void onOpenThread(task)
                              .then(() => {
                                requestAnimationFrame(() => {
                                  requestAnimationFrame(() => {
                                    const card = trigger.closest(".kcard");
                                    if (card instanceof HTMLElement) {
                                      card.scrollIntoView({
                                        block: "nearest",
                                        inline: "center",
                                      });
                                    }
                                  });
                                });
                              })
                              .catch((caught) => {
                                setActionError(errorMessage(caught));
                              });
                          }}
                        >
                          打开讨论
                        </button>
                      ) : null}
                      {canHumanCompleteTask({
                        caughtUp,
                        currentPrincipalId,
                        reviews,
                        submissions,
                        task,
                        taskWrite: canWrite,
                      }) ? (
                        <button
                          className="rah-task-complete"
                          disabled={pendingTaskId !== undefined}
                          onClick={() => void complete(task)}
                        >
                          {pendingTaskId === task.taskId
                            ? "确认中…"
                            : "确认完成"}
                        </button>
                      ) : null}
                      {canHumanForceReassignTask({
                        caughtUp,
                        currentPrincipalId,
                        task,
                        taskReassignment: canReassign,
                        taskWrite: canWrite,
                      }) ? (
                        <button
                          className="rah-task-status-action rah-task-reassign"
                          disabled={pendingTaskId !== undefined}
                          onClick={() => setReassigningTask(task)}
                        >
                          安全改派
                        </button>
                      ) : null}
                      {canHumanCancelTask({
                        caughtUp,
                        currentPrincipalId,
                        task,
                        taskWrite: canWrite,
                      }) ? (
                        <button
                          className="rah-task-status-action rah-task-close"
                          disabled={pendingTaskId !== undefined}
                          onClick={() => setClosingTask(task)}
                        >
                          关闭任务
                        </button>
                      ) : null}
                      {canHumanReopenTask({
                        caughtUp,
                        currentPrincipalId,
                        task,
                        taskWrite: canWrite,
                      }) ? (
                        <button
                          className="rah-task-status-action rah-task-reopen"
                          disabled={pendingTaskId !== undefined}
                          onClick={() => void reopen(task)}
                        >
                          {pendingTaskId === task.taskId
                            ? "重开中…"
                            : "重开为待办"}
                        </button>
                      ) : null}
                    </footer>
                  </article>
                ))}
                {!loading && column.tasks.length === 0 ? (
                  <div className="kcol-empty">暂无任务</div>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      )}
      {closingTask === undefined ? null : (
        <TaskCloseDialog
          onClose={() => setClosingTask(undefined)}
          onConfirm={(reason) => cancel(closingTask, reason)}
          taskTitle={`#${String(closingTask.taskNumber)} ${closingTask.title}`}
        />
      )}
      {reassigningTask === undefined ||
      reassigningTask.assigneeId === undefined ? null : (
        <TaskReassignDialog
          agents={agents}
          currentAssigneeId={reassigningTask.assigneeId}
          onClose={() => setReassigningTask(undefined)}
          onConfirm={(assigneeId, reason) =>
            reassign(reassigningTask, assigneeId, reason)
          }
          taskTitle={`#${String(reassigningTask.taskNumber)} ${reassigningTask.title}`}
        />
      )}
    </div>
  );
}

function TaskReviewEvidence({
  reviews,
  submissions,
  task,
}: {
  reviews: readonly TaskReview[];
  submissions: readonly TaskSubmission[];
  task: Task;
}) {
  const status = taskReviewStatus({ reviews, submissions, task });
  const submission = status.currentSubmission;
  const digestFingerprint = submission?.submissionDigest
    .replace(/^sha256:/u, "")
    .slice(0, 8);
  return (
    <p
      className="rah-task-review-evidence"
      data-task-review-status={status.satisfied ? "approved" : "pending"}
    >
      {submission === undefined
        ? `审阅 0/${String(status.requiredReviewerIds.length)} · 等待冻结提交`
        : `提交 #${String(submission.submissionNumber)} · 审阅 ${String(status.approvedReviewerIds.length)}/${String(status.requiredReviewerIds.length)} · sha256:${digestFingerprint}`}
    </p>
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
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    hour12: document.documentElement.dataset.rahTimeFormat === "12",
    minute: "2-digit",
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "RAH OS request failed";
}
