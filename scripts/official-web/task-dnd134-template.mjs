// Structural port of Web1.21.34 TasksPanel Rt/zt. Native raft-ui owns all drag
// sensors and visuals; Loom adds its existing per-task permission fence.
export const taskDnd134 = `
function DraggableTaskWrapper({task,children,disabled:requestedDisabled=false}:{task:Task;children:React.ReactNode;disabled?:boolean}) {
 const actions=useTaskCardActions(task);
 const disabled = requestedDisabled || !actions.canEditStatus || actions.busy;
 const id=\`task-item:\${task.id}\`;
 const data=useMemo(()=>({status:task.status,taskId:task.id}),[task.status,task.id]);
 return <div className="flex flex-col gap-2"><TaskDropPlaceholder id={id} placement="before"/><TaskDraggable id={task.id} dropId={id} dropData={data} disabled={disabled} data-testid="task-board-draggable-card" data-task-id={task.id}>{children}</TaskDraggable><TaskDropPlaceholder id={id} placement="after"/></div>;
}
function DroppableColumn({status,collapsed,onToggleCollapsed,statusTasks,activeTaskId,blockedReason,openTask,isChannelMode,scrollElementRef,canModifyTasks,hasMore=false,loadingPage=false,onLoadMore}:{status:TaskStatus;collapsed:boolean;onToggleCollapsed:(status:TaskStatus)=>void;statusTasks:Task[];activeTaskId?:string;blockedReason?:string;openTask:(task:Task)=>void;isChannelMode:boolean;scrollElementRef:React.RefObject<HTMLDivElement|null>;canModifyTasks:boolean;hasMore?:boolean;loadingPage?:boolean;onLoadMore?:()=>void}) {
 const {formatMessage}=useIntl();
 const ruiStatus=STATUS_TO_RUI_STATUS[status];
 const label=formatMessage({id:TASK_STATUS_UI[status].labelId});
 const id=\`task-status:\${status}\`;
 const data=useMemo(()=>({status}),[status]);
 const visible=useMemo(()=>activeTaskId==null?statusTasks:statusTasks.filter(t=>t.id!==activeTaskId),[activeTaskId,statusTasks]);
 const handleOpenChange=useCallback(()=>onToggleCollapsed(status),[onToggleCollapsed,status]);
 const renderTask=useCallback((task:Task)=><DraggableTaskWrapper task={task} disabled={!canModifyTasks}><TaskCard task={task} onOpen={openTask} showChannelName={!isChannelMode}/></DraggableTaskWrapper>,[canModifyTasks,openTask,isChannelMode]);
 return <TaskBoardColumn render={<TaskDropZone id={id} data={data} data-drop-collapsed={collapsed?'true':undefined}/>} open={!collapsed} onOpenChange={handleOpenChange} data-testid={\`task-board-column-\${status}\`}>
 <TaskBoardColumnTrigger aria-label={formatMessage({id:collapsed?'task.status.showGroup':'task.status.hideGroup'},{status:label})}><TaskBoardColumnHeading><TaskBoardColumnBadge status={ruiStatus}>{label}</TaskBoardColumnBadge><TaskBoardColumnCount>{statusTasks.length}</TaskBoardColumnCount></TaskBoardColumnHeading><TaskBoardColumnChevron/></TaskBoardColumnTrigger>
 <TaskBoardColumnPanel><TaskBoardColumnItems>
 {visible.length===0?(loadingPage?<TaskCardSkeleton/>:<><TaskBoardColumnEmpty><TaskBoardColumnEmptyIdle>{formatMessage({id:'task.status.emptyGroup'},{status:label})}</TaskBoardColumnEmptyIdle><TaskBoardColumnEmptyAllowed>{formatMessage({id:'task.status.dropToSet'},{status:label})}</TaskBoardColumnEmptyAllowed><TaskBoardColumnEmptyBlocked>{blockedReason??\`不能移至\${label}\`}</TaskBoardColumnEmptyBlocked></TaskBoardColumnEmpty><TaskDropPlaceholder id={id}/></>):<VirtualizedTaskStack items={visible} scrollElementRef={scrollElementRef} estimateSize={116} gap={8} getItemKey={getTaskKey} renderItem={renderTask}/>}
 {visible.length>0&&<TaskDropPlaceholder id={id}/>}
 {hasMore&&<Button type="button" size="md" variant="outline" disabled={loadingPage} onClick={onLoadMore} className="w-full" data-testid={\`task-load-more-\${status}\`}>{formatMessage({id:loadingPage?'common.loading':'task.panel.loadMore'})}</Button>}
 </TaskBoardColumnItems></TaskBoardColumnPanel></TaskBoardColumn>;
}
`;
