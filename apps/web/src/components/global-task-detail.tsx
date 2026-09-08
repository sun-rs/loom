import { useState, type ReactNode } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  Principal,
  Task,
  WorkerTaskHistoryResponse,
} from "@rah-os/protocol";
import { createRoomViewModel, type TaskColumnId } from "@rah-os/ui-web";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { useDialogProtocol } from "../dialog-protocol.ts";
import {
  applyGlobalTaskTransition,
  globalTaskTransition,
} from "../global-task-actions.ts";
import { raftTaskGroup } from "../global-discovery-model.ts";
import { useDiscoveryQuery } from "../use-discovery-query.ts";
import { formatRahDateTime } from "../date-time-presentation.ts";
import { DiscoveryFilter } from "./discovery-filter.tsx";
import { MessageMarkdown } from "./message-markdown.tsx";
import { TaskAssigneeControl } from "./task-assignee-control.tsx";
import type { RoomAgentTarget } from "@rah-os/ui-web";

/** Raft index-BVfbaScj db({presentation:"modal"}) / t9: a modal around the
 * existing Thread, not a second discussion or Task execution owner. */
export function TaskThreadPresentation({
  modal,
  children,
  roomName,
  task,
  error,
  onClose,
}: {
  modal: boolean;
  children: ReactNode;
  roomName?: string | undefined;
  task?: Task | undefined;
  error?: string | undefined;
  onClose: () => void;
}) {
  return modal ? (
    <TaskThreadModal
      roomName={roomName}
      task={task}
      error={error}
      onClose={onClose}
    >
      {children}
    </TaskThreadModal>
  ) : (
    children
  );
}

function TaskThreadModal({
  children,
  roomName,
  task,
  error,
  onClose,
}: Omit<Parameters<typeof TaskThreadPresentation>[0], "modal">) {
  const dialog = useDialogProtocol({
    blocked: false,
    initialFocus: "container",
    onClose,
  });
  return (
    <div className="rah-dialog-layer rah-task-detail-layer">
      <button
        className="rah-dialog-backdrop"
        aria-label="关闭任务详情背景"
        onClick={onClose}
        tabIndex={-1}
      />
      <section
        className="rah-task-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={task ? `任务 #${task.taskNumber} 详情` : "任务详情"}
        ref={dialog}
        tabIndex={-1}
        data-testid="task-thread-modal"
      >
        <header className="rah-task-detail-bar">
          <div>
            <span>#{roomName ?? "频道"}</span>
            <b>{task ? `任务 #${task.taskNumber}` : "任务详情"}</b>
          </div>
          <button
            className="sq-btn"
            aria-label="关闭任务详情"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        {error ? (
          <div className="rah-task-detail-failure" role="alert">
            {error}
          </div>
        ) : (
          children
        )}
      </section>
    </div>
  );
}

export function TaskDetailMetadata({
  client,
  task,
  people,
  canManage,
  writeEnabled,
  onChanged,
  agents,
  principalId,
}: {
  client: RahClient;
  task?: Task | undefined;
  people: readonly Principal[];
  canManage: boolean;
  writeEnabled: boolean;
  onChanged: () => void;
  agents: readonly RoomAgentTarget[];
  principalId: string | undefined;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  if (!task)
    return (
      <p className="rah-task-detail-loading" role="status">
        正在加载任务…
      </p>
    );
  const columns = createRoomViewModel({
    members: people,
    tasks: [task],
    messages: [],
  }).taskColumns;
  const current = raftTaskGroup(task),
    column = columns.find(({ id }) => id === current)!;
  const personName = (id: string | undefined) => {
    if (id === undefined) return "未指派";
    const person = people.find((item) => item.principalId === id);
    return person?.displayName || person?.handle || "未知成员";
  };
  async function choose(target: TaskColumnId) {
    if (!task || pending || target === current) return;
    setPending(true);
    setError(undefined);
    try {
      await applyGlobalTaskTransition({
        client,
        task,
        target,
        canManageAnyTask: canManage,
        idempotencyKey: `task-detail-${crypto.randomUUID()}`,
      });
      onChanged();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "任务更新失败，请重试",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className="rah-task-detail-metadata"
      data-testid="task-detail-metadata"
    >
      <h2>{task.title}</h2>
      {task.description ? (
        <div className="rah-task-detail-description">
          <MessageMarkdown source={task.description} />
        </div>
      ) : null}
      <div className="rah-task-detail-history">
        <button
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((value) => !value)}
        >
          <b>历史</b>
          <Icon name={historyOpen ? "chevron-down" : "chevron-right"} />
        </button>
        {historyOpen ? (
          <TaskDetailHistory
            key={`${task.taskId}:${task.updatedAt}`}
            client={client}
            task={task}
            people={people}
          />
        ) : null}
      </div>
      <dl className="rah-task-detail-properties">
        <div>
          <dt>状态</dt>
          <dd>
            <DiscoveryFilter
              label="任务状态"
              triggerLabel={column.label}
              triggerAriaLabel={`任务 #${task.taskNumber} 状态：${column.label}`}
              icon={null}
              multiple={false}
              searchable={false}
              clearable={false}
              variant="status"
              className="rah-task-state rah-task-status-picker"
              triggerClassName={`chip-${column.tone}`}
              disabled={pending || !writeEnabled || !canManage}
              values={[current]}
              selected={false}
              options={columns.map((item) => {
                const reason = globalTaskTransition(
                  task,
                  item.id,
                  canManage,
                ).reason;
                return {
                  id: item.id,
                  label: item.label,
                  ...(item.id === current || !reason
                    ? {}
                    : { disabledReason: reason }),
                };
              })}
              onChange={(values) => void choose(values[0] as TaskColumnId)}
            />
          </dd>
        </div>
        <div>
          <dt>负责人</dt>
          <dd>
            <TaskAssigneeControl
              client={client}
              task={task}
              agents={agents}
              principalId={principalId}
              label={personName(task.assigneeId)}
              writeEnabled={writeEnabled}
              onChanged={onChanged}
            />
          </dd>
        </div>
        <div>
          <dt>创建人</dt>
          <dd>{personName(task.creatorId)}</dd>
        </div>
      </dl>
      {pending ? <p role="status">正在保存任务…</p> : null}
      {error ? (
        <p role="alert" className="rah-inline-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function TaskDetailHistory({
  client,
  task,
  people,
}: {
  client: RahClient;
  task: Task;
  people: readonly Principal[];
}) {
  const [cursors, setCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const cursor = cursors.at(-1);
  const result = useDiscoveryQuery(client, "task.history", {
    roomId: task.roomId,
    taskId: task.taskId,
    limit: 50,
    ...(cursor === undefined ? {} : { cursor }),
  });
  return (
    <div className="rah-task-detail-history-body">
      {result.loading ? (
        <p role="status">正在加载历史…</p>
      ) : result.error ? (
        <div role="alert">
          <p>无法加载历史记录：{result.error}</p>
          <button className="btn" onClick={result.refresh}>
            重试
          </button>
        </div>
      ) : result.data?.events.length === 0 ? (
        <p>暂无历史记录</p>
      ) : (
        <ol>
          {result.data?.events.map((event) => (
            <li key={event.eventId}>
              <b>{taskHistoryTitle(event)}</b>
              <span>
                {people.find((person) => person.principalId === event.actorId)
                  ?.displayName ||
                  people.find((person) => person.principalId === event.actorId)
                    ?.handle ||
                  "未知成员"}{" "}
                ·{" "}
                {formatRahDateTime(event.createdAt, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
              {event.title ? <p>{event.title}</p> : null}
              {event.summary || event.progress ? (
                <p>{event.summary || event.progress}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <div className="rah-task-detail-history-pager">
        {cursors.length > 1 ? (
          <button
            className="btn"
            disabled={result.loading}
            onClick={() => setCursors((values) => values.slice(0, -1))}
          >
            较新记录
          </button>
        ) : null}
        {result.data?.nextCursor ? (
          <button
            className="btn"
            disabled={result.loading}
            onClick={() =>
              setCursors((values) => [...values, result.data!.nextCursor!])
            }
          >
            更早记录
          </button>
        ) : null}
      </div>
    </div>
  );
}

function taskHistoryTitle(
  event: WorkerTaskHistoryResponse["events"][number],
): string {
  const labels: Record<string, string> = {
    "task.created": "创建任务",
    "task.assigned": "指派负责人",
    "task.unassigned": "移除负责人",
    "task.claimed": "认领任务",
    "task.started": "开始任务",
    "task.progressed": "更新进度",
    "task.submitted": "提交任务",
    "task.completed": "完成任务",
    "task.cancelled": "关闭任务",
    "task.reopened": "重新打开任务",
    "task.blocked": "任务受阻",
    "task.unblocked": "解除阻塞",
    "review.submitted": "提交审阅",
    "input.requested": "请求输入",
    "input.resolved": "输入已收到",
    "input.cancelled": "取消输入请求",
    "input.expired": "输入请求已过期",
  };
  return labels[event.type] ?? "任务更新";
}
