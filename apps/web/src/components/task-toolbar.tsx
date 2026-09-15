import { useMobileLayout } from "../use-mobile-layout.ts";
import type { RoomAgentTarget } from "@rah-os/ui-web";
import { DiscoveryFilter } from "./discovery-filter.tsx";
import { taskPersonOptions } from "./task-person-options.tsx";
import { useWorkspaceEntities } from "./workspace-entity-context.tsx";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
export type TaskViewMode = "board" | "list";

export function TaskToolbar({
  agents,
  assigneeIds,
  creatorIds,
  currentPrincipalId,
  onAssigneeChange,
  onCreate,
  onCreatorChange,
  onViewChange,
  view,
  writeEnabled,
}: {
  agents: readonly RoomAgentTarget[];
  assigneeIds: string[];
  creatorIds: string[];
  currentPrincipalId: string | undefined;
  onAssigneeChange: (ids: string[]) => void;
  onCreate: () => void;
  onCreatorChange: (ids: string[]) => void;
  onViewChange: (view: TaskViewMode) => void;
  view: TaskViewMode;
  writeEnabled: boolean;
}) {
  const mobile = useMobileLayout();
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
  return (
    <section
      className="tasks-toolbar"
      data-task-scope="room"
      aria-label="任务筛选与视图"
    >
      <div className="tasks-toolbar-row">
        <DiscoveryFilter
          label="创建者"
          icon="circle-user-round"
          options={taskPersonOptions(
            people,
            currentPrincipalId,
            "creator",
            entities,
          )}
          values={creatorIds}
          onChange={onCreatorChange}
        />
        <DiscoveryFilter
          label="负责人"
          options={taskPersonOptions(
            people,
            currentPrincipalId,
            "assignee",
            entities,
          )}
          values={assigneeIds}
          onChange={onAssigneeChange}
        />
        {(creatorIds.length > 0 || assigneeIds.length > 0) && (
          <button
            className="tasks-clear rah-desktop-only"
            onClick={() => {
              onCreatorChange([]);
              onAssigneeChange([]);
            }}
          >
            全部清除
          </button>
        )}
        <button
          className="task-filter-trigger rah-task-create"
          aria-label="新建任务"
          disabled={!writeEnabled}
          onClick={onCreate}
          type="button"
        >
          <Icon name="plus" />
          <span>{mobile ? "新建任务" : "新建"}</span>
        </button>
        <div
          className="tasks-view"
          data-segment-surface="plain"
          role="radiogroup"
          aria-label="任务视图"
        >
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
