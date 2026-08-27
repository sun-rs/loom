import { useState } from "react";
import type { FormEvent } from "react";

import type { RoomAgentActivity, Task, Thread } from "@rah-os/protocol";
import {
  canHumanCompleteTask,
  createRoomViewModel,
  mentionedRoomAgentIds,
  taskAssigneeForSelectedAgents,
  type RoomAgentTarget,
} from "@rah-os/ui-web";

import { Icon } from "./icon.tsx";

export function ChatPane({
  agentActivity,
  agents,
  canCreateTask,
  canPost,
  canReadThreads,
  canWriteThreads,
  loading,
  messages,
  onManageAgents,
  onOpenThread,
  onSelectedAgentIdsChange,
  onSubmit,
  roomName,
  selectedAgentIds,
  threads,
}: {
  agentActivity: readonly RoomAgentActivity[];
  agents: readonly RoomAgentTarget[];
  canCreateTask: boolean;
  canPost: boolean;
  canReadThreads: boolean;
  canWriteThreads: boolean;
  loading: boolean;
  messages: ReturnType<typeof createRoomViewModel>["messages"];
  onManageAgents: () => void;
  onOpenThread: (rootMessageId: string) => Promise<void>;
  onSelectedAgentIdsChange: (participantIds: readonly string[]) => void;
  onSubmit: (
    body: string,
    asTask: boolean,
    selectedParticipantIds: readonly string[],
  ) => Promise<void>;
  roomName: string | undefined;
  selectedAgentIds: readonly string[];
  threads: readonly Thread[];
}) {
  const [body, setBody] = useState("");
  const [asTask, setAsTask] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  let taskTargetIssue: string | undefined;
  if (asTask) {
    try {
      taskAssigneeForSelectedAgents({
        availableAgents: agents,
        selectedParticipantIds: selectedAgentIds,
      });
    } catch (caught) {
      taskTargetIssue = errorMessage(caught);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = body.trim();
    if (value === "" || pending) return;
    setPending(true);
    try {
      await onSubmit(value, asTask, selectedAgentIds);
      setBody("");
      setSubmitError(undefined);
    } catch (caught) {
      setSubmitError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="chan-pane">
      <section className="messages rah-scroll-main">
        {loading && messages.length === 0 ? (
          <p className="rah-empty-copy">正在同步 Room…</p>
        ) : null}
        {!loading && messages.length === 0 ? (
          <p className="rah-empty-copy">这个 Room 还没有消息。</p>
        ) : null}
        {messages.map((message) => {
          const thread = threads.find(
            ({ rootMessageId }) => rootMessageId === message.messageId,
          );
          return (
            <MessageArticle
              key={message.messageId}
              message={message}
              {...(canReadThreads && (thread !== undefined || canWriteThreads)
                ? {
                    threadAction: {
                      label:
                        thread === undefined
                          ? "开始 Thread"
                          : `${String(thread.replyCount)} 条回复`,
                      onClick: () => void onOpenThread(message.messageId),
                    },
                  }
                : {})}
            />
          );
        })}
      </section>
      {asTask ? (
        <AgentTargetSelector
          agents={agents}
          asTask={asTask}
          onChange={onSelectedAgentIdsChange}
          onManageAgents={onManageAgents}
          selectedAgentIds={selectedAgentIds}
          taskTargetIssue={taskTargetIssue}
        />
      ) : (
        <RoomAgentDeliverySummary
          activity={agentActivity}
          agents={agents}
          body={body}
          onManageAgents={onManageAgents}
        />
      )}
      {submitError === undefined ? null : (
        <div className="rah-inline-error">{submitError}</div>
      )}
      <form className="composer" onSubmit={submit}>
        <div className="composer-box">
          <textarea
            aria-label="消息输入框"
            disabled={!canPost && !canCreateTask}
            onChange={(event) => setBody(event.target.value)}
            placeholder={`发送消息至 #${roomName ?? "room"}`}
            rows={3}
            value={body}
          />
          <div className="composer-bar">
            <button
              className="sq-btn"
              disabled
              title="附件将在 Artifact slice 接入"
              type="button"
            >
              <Icon name="clip" />
            </button>
            <span className="composer-spacer" />
            {canCreateTask ? (
              <label className="task-check">
                <input
                  checked={asTask}
                  onChange={(event) => setAsTask(event.target.checked)}
                  type="checkbox"
                />
                <span className="box" />
                作为任务
              </label>
            ) : null}
            <button
              className="send-btn"
              disabled={
                body.trim() === "" ||
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
  asTask,
  onChange,
  onManageAgents,
  selectedAgentIds,
  taskTargetIssue,
}: {
  agents: readonly RoomAgentTarget[];
  asTask: boolean;
  onChange: (participantIds: readonly string[]) => void;
  onManageAgents: () => void;
  selectedAgentIds: readonly string[];
  taskTargetIssue: string | undefined;
}) {
  const selected = new Set(selectedAgentIds);
  let summary = `唤醒 ${String(selected.size)}/${String(agents.length)} 个 Room Agents`;
  if (asTask && selected.size === 1) {
    summary = `指派任务给 ${agents.find(({ participantId }) => selected.has(participantId))?.handle ?? "Agent"}`;
  } else if (asTask && agents.length > 0 && agents.length === selected.size) {
    summary = "开放任务：全部 Room Agents 可竞争认领";
  } else if (asTask && agents.length === 0) {
    summary = "创建未指派任务（当前 Room 无 Agent）";
  } else if (!asTask && selected.size === 0) {
    summary = "仅记录消息，不唤醒 Agent";
  }
  return (
    <section className="rah-agent-targets" aria-label="任务目标 Agents">
      <header>
        <span>
          <Icon name="members" />
          任务负责人
        </span>
        {agents.length === 0 ? (
          <button className="rah-target-link" onClick={onManageAgents}>
            添加本机 Agent
          </button>
        ) : (
          <span className="rah-target-actions">
            <button
              onClick={() =>
                onChange(agents.map(({ participantId }) => participantId))
              }
              type="button"
            >
              全选
            </button>
            <button onClick={() => onChange([])} type="button">
              清空
            </button>
          </span>
        )}
      </header>
      {agents.length === 0 ? (
        <p>当前 Room 尚未设置 Agent；消息会保留，但不会拉起任何 CLI。</p>
      ) : (
        <div className="rah-agent-target-list">
          {agents.map((agent) => (
            <label
              className={selected.has(agent.participantId) ? "is-selected" : ""}
              key={agent.participantId}
            >
              <input
                checked={selected.has(agent.participantId)}
                onChange={() => {
                  const next = new Set(selected);
                  if (next.has(agent.participantId)) {
                    next.delete(agent.participantId);
                  } else {
                    next.add(agent.participantId);
                  }
                  onChange([...next]);
                }}
                type="checkbox"
              />
              <span>{agent.handle}</span>
            </label>
          ))}
        </div>
      )}
      <p className={taskTargetIssue === undefined ? undefined : "is-error"}>
        {taskTargetIssue ?? summary}
      </p>
    </section>
  );
}

function RoomAgentDeliverySummary({
  activity,
  agents,
  body,
  onManageAgents,
}: {
  activity: readonly RoomAgentActivity[];
  agents: readonly RoomAgentTarget[];
  body: string;
  onManageAgents: () => void;
}) {
  const mentioned = new Set(mentionedRoomAgentIds({ agents, body }));
  const stateByParticipantId = new Map(
    activity.map((entry) => [entry.participantId, entry] as const),
  );
  return (
    <section className="rah-agent-targets" aria-label="Room Agent 投递状态">
      <header>
        <span>
          <Icon name="members" />
          Room Agents
        </span>
        <button className="rah-target-link" onClick={onManageAgents}>
          {agents.length === 0 ? "添加 Agent" : "管理"}
        </button>
      </header>
      {agents.length === 0 ? (
        <p>当前 Room 没有 Agent；消息仍会保留，但不会拉起 CLI。</p>
      ) : (
        <div className="rah-agent-target-list">
          {agents.map((agent) => (
            <span
              className={`rah-agent-state-${stateByParticipantId.get(agent.participantId)?.state ?? "idle"}${mentioned.has(agent.participantId) ? " is-selected" : ""}`}
              key={agent.participantId}
              title={stateByParticipantId.get(agent.participantId)?.lastError}
            >
              <i aria-hidden="true" className="rah-agent-state-dot" />
              {agent.handle}
              {` · ${roomAgentStateLabel(
                stateByParticipantId.get(agent.participantId)?.state ?? "idle",
              )}`}
              {mentioned.has(agent.participantId) ? " · mentioned" : ""}
            </span>
          ))}
        </div>
      )}
      <p>
        {agents.length === 0
          ? "Room membership 是消息投递范围"
          : `${String(agents.length)} 个 Room Agent 都会收到消息；@mention 只提高注意力`}
      </p>
    </section>
  );
}

function roomAgentStateLabel(state: RoomAgentActivity["state"]): string {
  switch (state) {
    case "waking":
      return "唤醒中";
    case "working":
      return "工作中";
    case "error":
      return "异常";
    default:
      return "空闲";
  }
}

type MessageView = ReturnType<typeof createRoomViewModel>["messages"][number];

function MessageArticle({
  message,
  threadAction,
}: {
  message: MessageView;
  threadAction?: { label: string; onClick: () => void };
}) {
  return (
    <article className="msg">
      <span className="avatar rah-avatar">
        {message.author.slice(0, 1).toUpperCase()}
      </span>
      <div className="msg-body">
        <header className="msg-head">
          <b>{message.author}</b>
          <time>{formatTime(message.createdAt)}</time>
        </header>
        <p>{message.body}</p>
        {threadAction === undefined ? null : (
          <button className="thread-preview" onClick={threadAction.onClick}>
            <span className="tp-toggle">{threadAction.label}</span>
          </button>
        )}
      </div>
    </article>
  );
}

export function ThreadPane({
  canReply,
  loading,
  onClose,
  onSubmit,
  replies,
  root,
  thread,
}: {
  canReply: boolean;
  loading: boolean;
  onClose: () => void;
  onSubmit: (body: string) => Promise<void>;
  replies: ReturnType<typeof createRoomViewModel>["messages"];
  root: MessageView | undefined;
  thread: Thread;
}) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = body.trim();
    if (value === "" || pending || !canReply) return;
    setPending(true);
    try {
      await onSubmit(value);
      setBody("");
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
          Thread <span className="thread-sub">{thread.replyCount} replies</span>
        </h2>
        <button className="sq-btn" onClick={onClose} title="关闭 Thread">
          <span className="rah-close-glyph" aria-hidden="true">
            ×
          </span>
        </button>
      </header>
      <section className="messages rah-scroll-main">
        {root === undefined ? (
          <p className="rah-empty-copy">原消息尚未载入。</p>
        ) : (
          <MessageArticle message={root} />
        )}
        <div className="rah-thread-divider">
          {replies.length === 0
            ? "尚无回复"
            : `${String(replies.length)} 条回复`}
        </div>
        {loading && replies.length === 0 ? (
          <p className="rah-empty-copy">正在同步 Thread…</p>
        ) : null}
        {replies.map((message) => (
          <MessageArticle key={message.messageId} message={message} />
        ))}
      </section>
      {submitError === undefined ? null : (
        <div className="rah-inline-error">{submitError}</div>
      )}
      <form className="composer" onSubmit={submit}>
        <div className="composer-box">
          <textarea
            aria-label="Thread 回复输入框"
            disabled={!canReply}
            onChange={(event) => setBody(event.target.value)}
            placeholder={
              canReply ? "回复 Thread" : "Thread write capability 不可用"
            }
            rows={3}
            value={body}
          />
          <div className="composer-bar">
            <span className="composer-spacer" />
            <button
              className="send-btn"
              disabled={!canReply || body.trim() === "" || pending}
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

export function TaskPane({
  canWrite,
  caughtUp,
  columns,
  currentPrincipalId,
  loading,
  onComplete,
}: {
  canWrite: boolean;
  caughtUp: boolean;
  columns: ReturnType<typeof createRoomViewModel>["taskColumns"];
  currentPrincipalId: string | undefined;
  loading: boolean;
  onComplete: (task: Task) => Promise<void>;
}) {
  const [pendingTaskId, setPendingTaskId] = useState<string>();
  const [actionError, setActionError] = useState<string>();

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

  return (
    <div className="chan-pane">
      <div className="board-toolbar">
        <span className="rah-toolbar-title">Room Tasks</span>
        <span className="toolbar-spacer" />
        <span className="view-toggle">
          <span className="sq-btn is-active" title="当前为看板视图">
            <Icon name="kanban" />
          </span>
        </span>
      </div>
      {actionError === undefined ? null : (
        <div className="rah-inline-error">{actionError}</div>
      )}
      <div className="kanban">
        {columns.map((column) => (
          <section className="kcol" key={column.id}>
            <header className={`kcol-head chip-${column.tone}`}>
              <span>{column.label}</span>
              <span className="count">{column.tasks.length}</span>
            </header>
            <div className="kcol-body">
              {column.tasks.map((task) => (
                <article className="kcard" key={task.taskId}>
                  <span className="kcard-no">#{task.taskId.slice(-6)}</span>
                  <p className="kcard-title">{task.title}</p>
                  {task.assigneeLabel === undefined ? null : (
                    <p className="rah-task-agent">
                      Agent · {task.assigneeLabel}
                    </p>
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
                    {canHumanCompleteTask({
                      caughtUp,
                      currentPrincipalId,
                      task,
                      taskWrite: canWrite,
                    }) ? (
                      <button
                        className="rah-task-complete"
                        disabled={pendingTaskId !== undefined}
                        onClick={() => void complete(task)}
                      >
                        {pendingTaskId === task.taskId ? "确认中…" : "确认完成"}
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
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "RAH OS request failed";
}
