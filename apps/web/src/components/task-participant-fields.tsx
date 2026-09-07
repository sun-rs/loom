import type { RoomAgentTarget } from "@rah-os/ui-web";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";

export function TaskParticipantFields({
  agents,
  assigneeId,
  collaboratorIds,
  disabled = false,
  initialFocus = false,
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
  disabled?: boolean;
  initialFocus?: boolean;
  onAssigneeChange: (participantId: string | undefined) => void;
  onCollaboratorsChange: (participantIds: string[]) => void;
  onManageAgents?: () => void;
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
          onManageAgents === undefined ? null : (
            <button
              className="rah-target-link"
              disabled={disabled}
              onClick={onManageAgents}
              type="button"
            >
              添加本机 Agent
            </button>
          )
        ) : (
          <label className="rah-task-owner-select">
            <span>负责人</span>
            <select
              aria-label="任务负责人"
              autoFocus={initialFocus}
              data-dialog-initial-focus={initialFocus ? true : undefined}
              disabled={disabled}
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
        <p>当前 Room 尚未设置 Agent；任务会保留，但不会拉起任何 CLI。</p>
      ) : (
        <div className="rah-task-role-groups">
          <TaskRoleChoices
            agents={agents}
            disabled={disabled || assigneeId === undefined}
            label="协作者"
            onToggle={(participantId) =>
              toggle(collaborators, participantId, onCollaboratorsChange)
            }
            ownerId={assigneeId}
            selected={collaborators}
          />
          <TaskRoleChoices
            agents={agents}
            disabled={disabled || assigneeId === undefined}
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
    <fieldset
      className="rah-task-role-group rah-task-dialog-roles"
      disabled={disabled}
    >
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
