import type { RoomAgentTarget } from "@rah-os/ui-web";
import { DiscoveryFilter, type DiscoveryOption } from "./discovery-filter.tsx";
import { Icon } from "./icon.tsx";
export type TaskViewMode = "board" | "list";
const UNASSIGNED_FILTER_ID = "__unassigned__";

export function TaskToolbar({
  agents,
  assigneeId,
  creatorId,
  currentPrincipalId,
  onAssigneeChange,
  onCreate,
  onCreatorChange,
  onViewChange,
  view,
  writeEnabled,
}: {
  agents: readonly RoomAgentTarget[];
  assigneeId: string | null | undefined;
  creatorId: string | undefined;
  currentPrincipalId: string | undefined;
  onAssigneeChange: (id: string | null | undefined) => void;
  onCreate: () => void;
  onCreatorChange: (id: string | undefined) => void;
  onViewChange: (view: TaskViewMode) => void;
  view: TaskViewMode;
  writeEnabled: boolean;
}) {
  const options: DiscoveryOption[] = [
    ...(currentPrincipalId
      ? [
          {
            id: currentPrincipalId,
            label: "我",
            leading: <Icon name="user-round" />,
          },
        ]
      : []),
    ...[...agents]
      .sort((a, b) => a.handle.localeCompare(b.handle))
      .map((agent) => ({
        id: agent.participantId,
        label: agent.handle,
        leading: <Icon name="bot" />,
      })),
  ];
  const assignee = assigneeId === null ? UNASSIGNED_FILTER_ID : assigneeId;
  return (
    <section className="tasks-toolbar" aria-label="任务筛选与视图">
      <div className="tasks-toolbar-row">
        <DiscoveryFilter
          label="创建者"
          icon="circle-user-round"
          multiple={false}
          showCount
          options={options}
          values={creatorId ? [creatorId] : []}
          onChange={(values) => onCreatorChange(values[0])}
        />
        <DiscoveryFilter
          label="负责人"
          multiple={false}
          showCount
          options={[
            {
              id: UNASSIGNED_FILTER_ID,
              label: "未分配",
              italic: true,
              leading: "—",
            },
            ...options,
          ]}
          values={assignee ? [assignee] : []}
          onChange={(values) =>
            onAssigneeChange(
              values[0] === UNASSIGNED_FILTER_ID ? null : values[0],
            )
          }
        />
        {(creatorId !== undefined || assigneeId !== undefined) && (
          <button
            className="tasks-clear"
            onClick={() => {
              onCreatorChange(undefined);
              onAssigneeChange(undefined);
            }}
          >
            清除筛选
          </button>
        )}
        <button
          className="btn btn-pink rah-task-create"
          disabled={!writeEnabled}
          onClick={onCreate}
          type="button"
        >
          <Icon name="plus" />
          新建任务
        </button>
        <div className="tasks-view" role="radiogroup" aria-label="任务视图">
          {(["board", "list"] as const).map((mode) => (
            <button
              key={mode}
              aria-checked={view === mode}
              onClick={() => onViewChange(mode)}
              role="radio"
              type="button"
            >
              <Icon name={mode === "board" ? "kanban" : "list"} />
              <span>{mode === "board" ? "看板" : "列表"}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
