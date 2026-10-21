// GENERATED from db5e399 official task presentation; explicit Loom permissions and writes. Do not edit.
import type { TaskStatusId } from "raft-ui";
import {
  Button,
  Card,
  PickerTriggerButton,
  PanelHeaderContent,
  PanelMeta,
  PanelSectionHeader,
  PanelTitle,
  Popover,
  PopoverTrigger,
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlLabel,
  TaskBoardColumn,
  TaskBoardColumnBadge,
  TaskBoardColumnChevron,
  TaskBoardColumnCount,
  TaskBoardColumnEmpty,
  TaskBoardColumnHeading,
  TaskBoardColumnItems,
  TaskBoardColumnPanel,
  TaskBoardColumnTrigger,
  TaskSection as RuiTaskSection,
  TaskSectionBadge,
  TaskSectionChevron,
  TaskSectionCount,
  TaskSectionEmpty,
  TaskSectionHeading,
  TaskSectionItems,
  TaskSectionPanel,
  TaskSectionTrigger,
  TasksPanelRoot,
  TasksPanelToolbar,
  TasksPanelViewport,
} from "raft-ui";
import {useCallback} from "react";
import {useIntl} from "react-intl";
import {useDraggable,useDroppable} from "@dnd-kit/core";
import {CSS} from "@dnd-kit/utilities";
import type {Task,TaskStatus} from "../packages/web/src/store/taskStore";
import {TASK_STATUS_UI} from "../packages/web/src/components/task/taskStatusUi";
import {SkeletonRow} from "../packages/web/src/components/ui/Skeleton";
import VirtualizedTaskStack from "../packages/web/src/components/task/VirtualizedTaskStack";
import TaskCard from "./OfficialTaskCard.generated";
import {useTaskCardActions} from "./TaskBoardActions";
const SKELETON_LINE_WIDTHS = ["w-1/2", "w-3/4"];
function TaskCardSkeleton() {
  return (
    <Card
      render={<SkeletonRow lineWidths={SKELETON_LINE_WIDTHS} />}
      className="flex-row items-center gap-2 p-3"
    />
  );
}
function getTaskKey(task: Task): string {
  return task.id;
}
const STATUS_TO_RUI_STATUS: Record<TaskStatus, TaskStatusId> = {
  todo: "todo",
  in_progress: "in-progress",
  in_review: "in-review",
  done: "done",
  closed: "closed",
};
function TaskSection({
  status,
  tasks,
  onOpenTask,
  collapsed = false,
  onToggleCollapsed,
  showChannelName = true,
  scrollElementRef,
  hasMore = false,
  loadingPage = false,
  onLoadMore,
}: {
  status: TaskStatus;
  tasks: Task[];
  onOpenTask: (task: Task) => void;
  collapsed?: boolean;
  onToggleCollapsed?: (status: TaskStatus) => void;
  showChannelName?: boolean;
  scrollElementRef: React.RefObject<HTMLDivElement | null>;
  /** Server-mode lazy paging: more pages exist for this status lane. */
  hasMore?: boolean;
  loadingPage?: boolean;
  onLoadMore?: () => void;
}) {
  const { formatMessage } = useIntl();
  const ruiStatus = STATUS_TO_RUI_STATUS[status];
  const handleOpenChange = useCallback(() => onToggleCollapsed?.(status), [onToggleCollapsed, status]);
  const renderTask = useCallback((task: Task) => (
    <TaskCard
      task={task}
      onOpen={onOpenTask}
      showChannelName={showChannelName}
    />
  ), [onOpenTask, showChannelName]);
  return (
    <RuiTaskSection
      open={!collapsed}
      onOpenChange={handleOpenChange}
      className="space-y-2.5"
    >
      <TaskSectionTrigger
        disabled={!onToggleCollapsed}
        aria-label={formatMessage(
          { id: collapsed ? "task.status.showGroup" : "task.status.hideGroup" },
          { status: formatMessage({ id: TASK_STATUS_UI[status].labelId }) },
        )}
        className={onToggleCollapsed ? undefined : "cursor-default"}
      >
        <TaskSectionHeading>
          <TaskSectionBadge status={ruiStatus}>
            {formatMessage({ id: TASK_STATUS_UI[status].labelId })}
          </TaskSectionBadge>
          <TaskSectionCount>{tasks.length}</TaskSectionCount>
        </TaskSectionHeading>
        {onToggleCollapsed ? (
          <TaskSectionChevron />
        ) : (
          <span />
        )}
      </TaskSectionTrigger>
      <TaskSectionPanel>
        {tasks.length === 0 ? (
          loadingPage ? (
            <TaskCardSkeleton />
          ) : (
            <TaskSectionEmpty>
              {formatMessage(
                { id: "task.status.emptyGroup" },
                { status: formatMessage({ id: TASK_STATUS_UI[status].labelId }) },
              )}
            </TaskSectionEmpty>
          )
        ) : (
          <TaskSectionItems>
            <VirtualizedTaskStack
              items={tasks}
              scrollElementRef={scrollElementRef}
              estimateSize={116}
              gap={10}
              getItemKey={getTaskKey}
              renderItem={renderTask}
            />
          </TaskSectionItems>
        )}
        {hasMore && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loadingPage}
            onClick={onLoadMore}
            className="w-full"
            data-testid={`task-load-more-${status}`}
          >
            {loadingPage ? formatMessage({ id: "common.loading" }) : formatMessage({ id: "task.panel.loadMore" })}
          </Button>
        )}
      </TaskSectionPanel>
    </RuiTaskSection>
  );
}
function DraggableTaskWrapper({
  task,
  children,
  disabled: requestedDisabled = false,
}: {
  task: Task;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const actions = useTaskCardActions(task);
  const disabled = requestedDisabled || !actions.canEditStatus || actions.busy;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, disabled });
  const dragStyle = {
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 20 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-testid="task-board-draggable-card"
      style={dragStyle}
      className={`relative ${disabled ? "" : "cursor-grab touch-none will-change-transform active:cursor-grabbing"} ${isDragging ? "opacity-90" : ""}`}
    >
      {children}
      </div>
  );
}
function DroppableColumn({
  status,
  collapsed,
  onToggleCollapsed,
  statusTasks,
  openTask,
  isChannelMode,
  scrollElementRef,
  canModifyTasks,
  hasMore = false,
  loadingPage = false,
  onLoadMore,
}: {
  status: TaskStatus;
  collapsed: boolean;
  onToggleCollapsed: (status: TaskStatus) => void;
  statusTasks: Task[];
  openTask: (task: Task) => void;
  isChannelMode: boolean;
  scrollElementRef: React.RefObject<HTMLDivElement | null>;
  canModifyTasks: boolean;
  /** Server-mode lazy paging: more pages exist for this status lane. */
  hasMore?: boolean;
  loadingPage?: boolean;
  onLoadMore?: () => void;
}) {
  const { formatMessage } = useIntl();
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !canModifyTasks });
  const ruiStatus = STATUS_TO_RUI_STATUS[status];
  const handleOpenChange = useCallback(() => onToggleCollapsed(status), [onToggleCollapsed, status]);
  const renderTask = useCallback((task: Task) => (
    <DraggableTaskWrapper task={task} disabled={!canModifyTasks}>
      <TaskCard
        task={task}
        onOpen={openTask}
        showChannelName={!isChannelMode}
      />
    </DraggableTaskWrapper>
  ), [canModifyTasks, isChannelMode, openTask]);
  return (
    <TaskBoardColumn
      ref={setNodeRef}
      open={!collapsed}
      onOpenChange={handleOpenChange}
      // The drop target is a hover-like hint: the pressed overlay, no colour
      // (Raft DS: hints have no colour). The column's own chrome is the recipe's.
      className={`rounded-container transition-colors ${isOver ? "bg-fill-pressed" : ""}`}
    >
      <TaskBoardColumnTrigger
        aria-label={formatMessage(
          { id: collapsed ? "task.status.showGroup" : "task.status.hideGroup" },
          { status: formatMessage({ id: TASK_STATUS_UI[status].labelId }) },
        )}
      >
        <TaskBoardColumnHeading>
          <TaskBoardColumnBadge status={ruiStatus}>
            {formatMessage({ id: TASK_STATUS_UI[status].labelId })}
          </TaskBoardColumnBadge>
          <TaskBoardColumnCount>{statusTasks.length}</TaskBoardColumnCount>
        </TaskBoardColumnHeading>
        <TaskBoardColumnChevron />
      </TaskBoardColumnTrigger>
      <TaskBoardColumnPanel>
        <TaskBoardColumnItems>
          {statusTasks.length === 0 ? (
            loadingPage ? (
              <TaskCardSkeleton />
            ) : (
              <TaskBoardColumnEmpty>
                {formatMessage(
                  { id: isOver ? "task.status.dropToSet" : "task.status.emptyGroup" },
                  { status: formatMessage({ id: TASK_STATUS_UI[status].labelId }) },
                )}
              </TaskBoardColumnEmpty>
            )
          ) : (
            <VirtualizedTaskStack
              items={statusTasks}
              scrollElementRef={scrollElementRef}
              estimateSize={116}
              gap={10}
              getItemKey={getTaskKey}
              renderItem={renderTask}
            />
          )}
          {hasMore && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loadingPage}
              onClick={onLoadMore}
              className="w-full"
              data-testid={`task-load-more-${status}`}
            >
              {loadingPage ? formatMessage({ id: "common.loading" }) : formatMessage({ id: "task.panel.loadMore" })}
            </Button>
          )}
        </TaskBoardColumnItems>
      </TaskBoardColumnPanel>
    </TaskBoardColumn>
  );
}
export {TaskSection,DroppableColumn};
