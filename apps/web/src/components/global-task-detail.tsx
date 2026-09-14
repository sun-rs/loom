import { useWorkspaceEntities } from "./workspace-entity-context.tsx";
import { browserOpaqueId } from "../browser-opaque-id.ts";
import { useState, type ReactNode } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { Principal, Task } from "@rah-os/protocol";
import { createRoomViewModel, type TaskColumnId } from "@rah-os/ui-web";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { useDialogProtocol } from "../dialog-protocol.ts";
import {
  applyGlobalTaskTransition,
  globalTaskTransition,
} from "../global-task-actions.ts";
import { raftTaskGroup } from "../global-discovery-model.ts";
import { TaskDetailHistory } from "./task-detail-history.tsx";
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
  activeMemberIds,
}: {
  client: RahClient;
  task?: Task | undefined;
  people: readonly Principal[];
  canManage: boolean;
  writeEnabled: boolean;
  onChanged: () => void;
  agents: readonly RoomAgentTarget[];
  principalId: string | undefined;
  activeMemberIds: readonly string[];
}) {
  const entities = useWorkspaceEntities();
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
    const candidate = people.find((item) => item.principalId === id);
    const person = candidate
      ? (entities?.resolvePerson(candidate) ?? candidate)
      : entities?.person(id);
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
        idempotencyKey: `task-detail-${browserOpaqueId()}`,
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
          <b>操作时间线</b>
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
              people={people.filter((person) =>
                activeMemberIds.includes(person.principalId),
              )}
              principalId={principalId}
              label={personName(task.assigneeId)}
              writeEnabled={writeEnabled && canManage}
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
