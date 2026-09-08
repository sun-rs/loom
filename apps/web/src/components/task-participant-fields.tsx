import type { RoomAgentTarget } from "@rah-os/ui-web";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";

export function TaskParticipantFields({
  agents,
  assigneeId,
  disabled = false,
  initialFocus = false,
  onAssigneeChange,
  onManageAgents,
  taskTargetIssue,
}: {
  agents: readonly RoomAgentTarget[];
  assigneeId: string | undefined;
  disabled?: boolean;
  initialFocus?: boolean;
  onAssigneeChange: (participantId: string | undefined) => void;
  onManageAgents?: () => void;
  taskTargetIssue: string | undefined;
}) {
  const owner = agents.find(
    ({ participantId }) => participantId === assigneeId,
  );
  const summary =
    owner === undefined
      ? agents.length === 0
        ? "创建未指派任务（当前 Room 无 Agent）"
        : "未指定负责人"
      : `${owner.handle} 负责`;
  return (
    <section className="rah-agent-targets" aria-label="任务目标 Agents">
      <header>
        <span>
          <Icon name="members" />
          任务负责人
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
              <option value="">未指定</option>
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
        <p>当前 Room 尚未设置 Agent；任务会保留。</p>
      ) : null}
      <p className={taskTargetIssue === undefined ? undefined : "is-error"}>
        {taskTargetIssue ?? summary}
      </p>
    </section>
  );
}
