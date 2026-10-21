// GENERATED from db5e399 official task presentation; explicit Loom permissions and writes. Do not edit.
import {
  TaskCard as RuiTaskCard,
  TaskCardBody,
  TaskCardChannel,
  TaskCardDescription,
  TaskCardLegacy,
  TaskCardMeta,
  TaskCardNumber,
  TaskCardRow,
  TaskCardTitle,
} from "raft-ui";
import {memo} from "react";
import type {Task} from "../packages/web/src/store/taskStore";
import InlineBadgeEditor from "../packages/web/src/components/InlineBadgeEditor";
import {StatusBadge} from "../packages/web/src/components/task/StatusBadge";
import {toRuiTaskStatus} from "../packages/web/src/components/task/taskStatusUi";
import {useTaskCardActions} from "./TaskBoardActions";
function TaskCard({ task, onOpen, showChannelName = true }: {
  task: Task;
  onOpen: (task: Task) => void;
  showChannelName?: boolean;
}) {
  const {formatMessage,editingStatus,busy,canEditStatus,statusOptions,style,handleStatusSelect,toggleStatusEditor,closeStatusEditor}=useTaskCardActions(task);

  return (
    <RuiTaskCard className="w-full">
      <button type="button" onClick={() => onOpen(task)} className="w-full rounded-control text-left outline-none focus-visible:shadow-focus">
        <TaskCardRow>
          <TaskCardBody>
            <TaskCardMeta>
              {showChannelName && (
                <TaskCardChannel>
                  #{task.channelName || formatMessage({ id: "task.legacyPanel.unknownChannel" })}
                </TaskCardChannel>
              )}
              <TaskCardNumber>#{task.taskNumber}</TaskCardNumber>
              {task.isLegacy && (
                <TaskCardLegacy>
                  {formatMessage({ id: "task.badge.legacy" })}
                </TaskCardLegacy>
              )}
            </TaskCardMeta>
            <TaskCardTitle>{task.title}</TaskCardTitle>
            {task.description && (
              <TaskCardDescription>
                {task.description}
              </TaskCardDescription>
            )}
          </TaskCardBody>
        </TaskCardRow>
      </button>
      {/* Raft DS TaskCard foot: the status chip is the only thing on the card
          that edits in place. A pending write only blocks pointer input. */}
      <div className="mt-2 flex min-w-0 items-center gap-2">
        {canEditStatus ? (
          <div className={`relative shrink-0 ${busy ? "pointer-events-none" : ""}`}>
            <InlineBadgeEditor
              badgeStatus={toRuiTaskStatus(task.status)}
              displayValue={formatMessage({ id: style.labelId })}
              selectedId={task.status}
              options={statusOptions}
              onSelect={handleStatusSelect}
              disabled={busy}
              open={editingStatus}
              onToggle={toggleStatusEditor}
              onRequestClose={closeStatusEditor}
              badgeClassName=""
              dropdownMinWidth="min-w-[140px]"
              dropdownAlign="left"
              dropdownTestId="task-status-menu"
              optionTestIdPrefix="task-status-option"
            />
          </div>
        ) : (
          <StatusBadge status={task.status} data-testid="task-status-readonly">
            {formatMessage({ id: style.labelId })}
          </StatusBadge>
        )}
      </div>
    </RuiTaskCard>
  );
}
export default memo(TaskCard);
