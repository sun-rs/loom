import { LoadingState } from "@rah-os/ui-web/neo-brutalist/loading-state";
import { DialogLayer } from "@rah-os/ui-web/neo-brutalist/dialog-layer";
import {
  AgentMessageContext,
  HumanIdentityContext,
  useWorkspaceEntities,
} from "./workspace-entity-context.tsx";
import { browserOpaqueId } from "../browser-opaque-id.ts";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { Principal, Task } from "@rah-os/protocol";
import { createRoomViewModel, type TaskColumnId } from "@rah-os/ui-web";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { PanelHeaderAction } from "@rah-os/ui-web/neo-brutalist/panel-header-action";
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

export type TaskProfileRenderer = (
  target: { kind: "agent" | "human"; id: string },
  onBack: () => void,
  onClose: () => void,
) => ReactNode;

/** Raft index-BVfbaScj db({presentation:"modal"}) / t9: a modal around the
 * existing Thread, not a second discussion or Task execution owner. */
export function TaskThreadPresentation({
  modal,
  compact = false,
  renderProfile,
  children,
  roomName,
  task,
  error,
  onClose,
}: {
  renderProfile?: TaskProfileRenderer | undefined;
  modal: boolean;
  compact?: boolean;
  children: ReactNode;
  roomName?: string | undefined;
  task?: Task | undefined;
  error?: string | undefined;
  onClose: () => void;
}) {
  return modal ? (
    <TaskThreadModal
      renderProfile={renderProfile}
      compact={compact}
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
  renderProfile,
  compact,
  children,
  roomName,
  task,
  error,
  onClose,
}: Omit<Parameters<typeof TaskThreadPresentation>[0], "modal">) {
  const agentIdentity = useContext(AgentMessageContext);
  const humanIdentity = useContext(HumanIdentityContext);
  const [profile, setProfile] = useState<Parameters<TaskProfileRenderer>[0]>();
  const profileTrigger = useRef<HTMLElement | null>(null);
  const openProfile = (target: Parameters<TaskProfileRenderer>[0]) => {
    profileTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setProfile(target);
  };
  const closeProfile = () => setProfile(undefined);
  const closeCurrent = profile ? closeProfile : onClose;
  const dialog = useDialogProtocol({
    blocked: false,
    initialFocus: "container",
    onClose: closeCurrent,
  });
  useEffect(() => {
    if (profile) dialog.current?.focus({ preventScroll: true });
    else profileTrigger.current?.focus({ preventScroll: true });
  }, [profile, dialog]);
  return (
    <DialogLayer
      className={`rah-dialog-layer rah-task-detail-layer${compact ? " rah-task-approval-layer" : ""}`}
    >
      <button
        className="rah-dialog-backdrop"
        aria-label="关闭任务详情背景"
        onClick={onClose}
        tabIndex={-1}
      />
      <section
        className={`rah-dialog-frame rah-task-detail-dialog${compact ? " rah-task-approval-compact" : ""}`}
        data-mobile-presentation={compact ? "compact" : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={task ? `任务 #${task.taskNumber} 详情` : "任务详情"}
        ref={dialog}
        tabIndex={-1}
        data-testid="task-thread-modal"
      >
        <header
          hidden={!!profile}
          className="rah-dialog-header rah-task-detail-bar"
        >
          <PanelHeaderAction
            className={compact ? "rah-hidden" : "rah-mobile-only"}
            aria-label="返回任务页面"
            onClick={onClose}
          >
            <Icon name="arrow-left" />
          </PanelHeaderAction>
          <div>
            <span>#{roomName ?? "频道"}</span>
            <b>{task ? `任务 #${task.taskNumber}` : "任务详情"}</b>
          </div>
          <PanelHeaderAction
            className={compact ? undefined : "rah-desktop-only"}
            aria-label="关闭任务详情"
            onClick={onClose}
          >
            <Icon name="x" />
          </PanelHeaderAction>
        </header>
        {error ? (
          <div className="rah-task-detail-failure" role="alert">
            {error}
          </div>
        ) : (
          <>
            <div className="rah-task-modal-discussion" hidden={!!profile}>
              <AgentMessageContext.Provider
                value={
                  agentIdentity && renderProfile
                    ? {
                        ...agentIdentity,
                        onOpen: (id) => openProfile({ kind: "agent", id }),
                      }
                    : agentIdentity
                }
              >
                <HumanIdentityContext.Provider
                  value={
                    humanIdentity && renderProfile
                      ? {
                          ...humanIdentity,
                          onOpenHuman: (id) =>
                            openProfile({ kind: "human", id }),
                        }
                      : humanIdentity
                  }
                >
                  {children}
                </HumanIdentityContext.Provider>
              </AgentMessageContext.Provider>
            </div>
            {profile && renderProfile ? (
              <div className="rah-task-modal-profile">
                {renderProfile(profile, closeProfile, onClose)}
              </div>
            ) : null}
          </>
        )}
      </section>
    </DialogLayer>
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
  onChanged: (task?: Task) => void;
  agents: readonly RoomAgentTarget[];
  principalId: string | undefined;
  activeMemberIds: readonly string[];
}) {
  const entities = useWorkspaceEntities();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  if (!task) return <LoadingState />;
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
      const result = await applyGlobalTaskTransition({
        client,
        task,
        target,
        canManageAnyTask: canManage,
        idempotencyKey: `task-detail-${browserOpaqueId()}`,
      });
      onChanged(result.task);
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
        <div className="rah-task-detail-assignment">
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
        <div className="rah-task-detail-assignment">
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
        <div className="rah-task-detail-creator">
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
