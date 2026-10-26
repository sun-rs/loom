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
import {useCallback,useMemo} from "react";
import {TaskDraggable,TaskDropZone,TaskDropPlaceholder,TaskBoardColumnEmptyIdle,TaskBoardColumnEmptyAllowed,TaskBoardColumnEmptyBlocked} from "raft-ui";
import {useIntl} from "react-intl";
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

function DraggableTaskWrapper({task,children,disabled:requestedDisabled=false}:{task:Task;children:React.ReactNode;disabled?:boolean}) {
 const actions=useTaskCardActions(task);
 const disabled = requestedDisabled || !actions.canEditStatus || actions.busy;
 const id=`task-item:${task.id}`;
 const data=useMemo(()=>({status:task.status,taskId:task.id}),[task.status,task.id]);
 return <div className="flex flex-col gap-2"><TaskDropPlaceholder id={id} placement="before"/><TaskDraggable id={task.id} dropId={id} dropData={data} disabled={disabled} data-testid="task-board-draggable-card" data-task-id={task.id}>{children}</TaskDraggable><TaskDropPlaceholder id={id} placement="after"/></div>;
}
function DroppableColumn({status,collapsed,onToggleCollapsed,statusTasks,activeTaskId,blockedReason,openTask,isChannelMode,scrollElementRef,canModifyTasks,hasMore=false,loadingPage=false,onLoadMore}:{status:TaskStatus;collapsed:boolean;onToggleCollapsed:(status:TaskStatus)=>void;statusTasks:Task[];activeTaskId?:string;blockedReason?:string;openTask:(task:Task)=>void;isChannelMode:boolean;scrollElementRef:React.RefObject<HTMLDivElement|null>;canModifyTasks:boolean;hasMore?:boolean;loadingPage?:boolean;onLoadMore?:()=>void}) {
 const {formatMessage}=useIntl();
 const ruiStatus=STATUS_TO_RUI_STATUS[status];
 const label=formatMessage({id:TASK_STATUS_UI[status].labelId});
 const id=`task-status:${status}`;
 const data=useMemo(()=>({status}),[status]);
 const visible=useMemo(()=>activeTaskId==null?statusTasks:statusTasks.filter(t=>t.id!==activeTaskId),[activeTaskId,statusTasks]);
 const handleOpenChange=useCallback(()=>onToggleCollapsed(status),[onToggleCollapsed,status]);
 const renderTask=useCallback((task:Task)=><DraggableTaskWrapper task={task} disabled={!canModifyTasks}><TaskCard task={task} onOpen={openTask} showChannelName={!isChannelMode}/></DraggableTaskWrapper>,[canModifyTasks,openTask,isChannelMode]);
 return <TaskBoardColumn render={<TaskDropZone id={id} data={data} data-drop-collapsed={collapsed?'true':undefined}/>} open={!collapsed} onOpenChange={handleOpenChange} data-testid={`task-board-column-${status}`}>
 <TaskBoardColumnTrigger aria-label={formatMessage({id:collapsed?'task.status.showGroup':'task.status.hideGroup'},{status:label})}><TaskBoardColumnHeading><TaskBoardColumnBadge status={ruiStatus}>{label}</TaskBoardColumnBadge><TaskBoardColumnCount>{statusTasks.length}</TaskBoardColumnCount></TaskBoardColumnHeading><TaskBoardColumnChevron/></TaskBoardColumnTrigger>
 <TaskBoardColumnPanel><TaskBoardColumnItems>
 {visible.length===0?(loadingPage?<TaskCardSkeleton/>:<><TaskBoardColumnEmpty><TaskBoardColumnEmptyIdle>{formatMessage({id:'task.status.emptyGroup'},{status:label})}</TaskBoardColumnEmptyIdle><TaskBoardColumnEmptyAllowed>{formatMessage({id:'task.status.dropToSet'},{status:label})}</TaskBoardColumnEmptyAllowed><TaskBoardColumnEmptyBlocked>{blockedReason??`不能移至${label}`}</TaskBoardColumnEmptyBlocked></TaskBoardColumnEmpty><TaskDropPlaceholder id={id}/></>):<VirtualizedTaskStack items={visible} scrollElementRef={scrollElementRef} estimateSize={116} gap={8} getItemKey={getTaskKey} renderItem={renderTask}/>}
 {visible.length>0&&<TaskDropPlaceholder id={id}/>}
 {hasMore&&<Button type="button" size="md" variant="outline" disabled={loadingPage} onClick={onLoadMore} className="w-full" data-testid={`task-load-more-${status}`}>{formatMessage({id:loadingPage?'common.loading':'task.panel.loadMore'})}</Button>}
 </TaskBoardColumnItems></TaskBoardColumnPanel></TaskBoardColumn>;
}

export {TaskSection,DroppableColumn};
