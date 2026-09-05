import type { RoomAgentTarget } from "@rah-os/ui-web";
import { DiscoveryFilter } from "./discovery-filter.tsx";
import { taskPersonOptions } from "./task-person-options.tsx";
import { useWorkspaceEntities } from "./workspace-entity-context.tsx";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
export type TaskViewMode = "board" | "list";
const UNASSIGNED_FILTER_ID = "unassigned";

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
  const entities = useWorkspaceEntities();
  const people = [
    ...(currentPrincipalId
      ? [
          {
            principalId: currentPrincipalId,
            handle: "我",
            kind: "human" as const,
          },
        ]
      : []),
    ...[...agents]
      .sort((a, b) => a.handle.localeCompare(b.handle))
      .map((agent) => ({
        principalId: agent.participantId,
        handle: agent.handle,
        kind: "agent" as const,
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
          options={taskPersonOptions(
            people,
            currentPrincipalId,
            "creator",
            entities,
          )}
          values={creatorId ? [creatorId] : []}
          onChange={(values) => onCreatorChange(values[0])}
        />
        <DiscoveryFilter
          label="负责人"
          multiple={false}
          showCount
          options={taskPersonOptions(
            people,
            currentPrincipalId,
            "assignee",
            entities,
          )}
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
              className="rah-interaction-segment"
              key={mode}
              aria-checked={view === mode}
              onClick={() => onViewChange(mode)}
              role="radio"
              type="button"
            >
              <Icon name={mode === "board" ? "columns-3" : "layout-list"} />
              <span>{mode === "board" ? "看板" : "列表"}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
